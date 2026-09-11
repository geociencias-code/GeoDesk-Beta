import logging
from datetime import datetime, timedelta, timezone
from celery import shared_task, chain
from celery.result import AsyncResult

from utils.timeseries_parquet import VOLCANOES, list_available_years
from utils.shared_storage import (
    get_track_frame_groups,
    get_shared_dir,
    all_volcanoes_processed,
    is_year_complete,
    previous_year_zips_cleared,
)
from tasks.automated_pipeline import (
    pipeline_submit_hyp3,
    pipeline_wait_and_download,
    pipeline_run_mintpy,
    pipeline_finalize_and_cleanup,
    launch_process_only,
    _get_redis,
    _pipeline_lock_key,
    is_download_lock_active,
)

logger = logging.getLogger(__name__)


def _download_task_id(track: int, frame: int, year: int) -> str:
    """ID único para la tarea de descarga de un grupo track/frame/año.
    Celery descarta tareas con ID duplicado si ya están en cola o corriendo.
    """
    return f"pipeline-download-track{track}-frame{frame}-{year}"


def _is_download_running(track: int, frame: int, year: int) -> bool:
    """Retorna True si ya hay una descarga activa para este grupo/año."""
    if is_download_lock_active(track, frame, year):
        return True
    task_id = _download_task_id(track, frame, year)
    result = AsyncResult(task_id)
    return result.state in ("STARTED", "RECEIVED", "RETRY", "PENDING")


def _launch_download_for_group(track: int, frame: int, year: int,
                               start_iso: str, end_iso: str) -> None:
    """Encola la cadena de descarga (submit → wait → download) para un grupo track/frame/año.
    Tras la descarga, lanza el procesamiento MintPy para cada volcán del grupo.
    """
    if _is_download_running(track, frame, year):
        logger.info(
            "Orquestador: Descarga para track%d_frame%d/%d ya activa. Omitiendo.",
            track, frame, year,
        )
        return

    groups = get_track_frame_groups()
    volcanoes = groups.get((track, frame), [])
    group_label = f"track{track}_frame{frame}-{year}"
    logger.info("Orquestador: Lanzando descarga para %s [%s → %s]",
                group_label, start_iso, end_iso)

    # Cadena: submit → wait_download → (procesar cada volcán en secuencia)
    # Los pasos de MintPy se encolan individualmente después de la descarga
    # para no bloquear si uno falla.
    workflow = chain(
        pipeline_submit_hyp3.s(track, frame, year, start_iso, end_iso),
        pipeline_wait_and_download.s(),
        _enqueue_volcano_processing.s(volcanoes=volcanoes),
    )
    task_id = _download_task_id(track, frame, year)
    workflow.apply_async(queue="geodesk_heavy", task_id=task_id)


@shared_task(bind=True, queue="geodesk_heavy")
def _enqueue_volcano_processing(self, prev_result: dict, volcanoes: list):
    """Tarea intermedia: al finalizar la descarga, encola el procesamiento
    MintPy para cada volcán del grupo de forma independiente.
    """
    track = prev_result.get("track")
    frame = prev_result.get("frame")
    year  = prev_result.get("year")

    if prev_result.get("skipped") or prev_result.get("all_downloaded") and not prev_result.get("job_ids"):
        # No hubo descarga nueva — aun así lanzar procesamiento si hay ZIPs disponibles
        logger.info(
            "Orquestador: Sin nuevos ZIPs descargados para track%d_frame%d/%d. "
            "Verificando si hay ZIPs en shared/ para procesar.",
            track, frame, year,
        )

    shared_dir = get_shared_dir(track, frame, year)
    has_zips = shared_dir.exists() and bool(list(shared_dir.glob("*.zip")))

    if not has_zips:
        logger.warning(
            "Orquestador: No hay ZIPs en shared/ para track%d_frame%d/%d. "
            "No se lanzará procesamiento.",
            track, frame, year,
        )
        return prev_result

    logger.info(
        "Orquestador: Lanzando procesamiento MintPy para %d volcanes "
        "(track%d_frame%d/%d): %s",
        len(volcanoes), track, frame, year, volcanoes,
    )

    lock_task_id = prev_result.get("lock_task_id")

    for volcano in volcanoes:
        base = {**prev_result, "volcano": volcano, "lock_task_id": lock_task_id}
        volcano_workflow = chain(
            pipeline_run_mintpy.s(base, volcano),
            pipeline_finalize_and_cleanup.s(),
        )
        volcano_workflow.apply_async(queue="geodesk_heavy")

    return prev_result


# ---------------------------------------------------------------------------
# CRON: Actualización mensual (día 1 de cada mes)
# ---------------------------------------------------------------------------

@shared_task(name="tasks.orchestrator.monthly_cron_update")
def monthly_cron_update():
    """Se ejecuta el primer día de cada mes.
    Descarga SOLO las imágenes del mes que acaba de terminar para cada
    grupo (track, frame). No re-descarga meses anteriores.
    """
    now = datetime.now(timezone.utc)

    # Calcular el mes anterior
    first_of_this_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_month_end = first_of_this_month - timedelta(seconds=1)
    last_month_start = last_month_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    year = last_month_end.year

    start_iso = last_month_start.strftime("%Y-%m-%dT00:00:00Z")
    end_iso   = last_month_end.strftime("%Y-%m-%dT%H:%M:%SZ")

    logger.info(
        "Orquestador [cron mensual]: Descargando imágenes de %s → %s (año %d)",
        start_iso, end_iso, year,
    )

    groups = get_track_frame_groups()
    for (track, frame) in groups:
        _launch_download_for_group(track, frame, year, start_iso, end_iso)


# ---------------------------------------------------------------------------
# CRON: Bootstrap de datos históricos (diario, 06:00 AM)
# ---------------------------------------------------------------------------

@shared_task(name="tasks.orchestrator.bootstrap_historical")
def bootstrap_historical():
    """Verifica qué años históricos faltan y lanza el pipeline para calcularlos.

    Procesa los años en orden estricto (2024 → 2025 → ...):
    - No inicia el año N+1 si el año N aún no terminó (Parquet no guardado
      o ZIPs del año N todavía presentes en shared/).
    - Si los ZIPs ya están en shared/ (p.ej. después de la migración), lanza
      directamente el procesamiento MintPy sin re-descargar.
    """
    logger.info("Orquestador [bootstrap]: Verificando datos históricos faltantes...")

    current_year = datetime.now(timezone.utc).year
    # Procesar desde 2024 hasta el año en curso
    historical_years = list(range(2024, current_year + 1))

    groups = get_track_frame_groups()

    for (track, frame), volcanoes in groups.items():
        group_label = f"track{track}_frame{frame}"

        for year in historical_years:
            # --- Verificar si todos los volcanes del grupo ya tienen Parquet ---
            if all_volcanoes_processed(track, frame, year):
                logger.info(
                    "[%s] Año %d ya procesado para todos los volcanes. Continuando.",
                    group_label, year,
                )
                continue

            # --- Verificar secuencia: no empezar año N si N-1 no está limpio ---
            if not previous_year_zips_cleared(track, frame, year):
                logger.info(
                    "[%s] El año anterior (%d) aún tiene ZIPs en shared/. "
                    "Esperando antes de procesar %d.",
                    group_label, year - 1, year,
                )
                # No procesar años posteriores de este grupo en esta vuelta
                break

            # --- Verificar si ya hay descarga/proceso en curso ---
            if _is_download_running(track, frame, year):
                logger.info(
                    "[%s] Pipeline para %d ya activo. Omitiendo.",
                    group_label, year,
                )
                # Tampoco continuar con años posteriores mientras este siga
                break

            # --- Verificar si los ZIPs ya están en shared/ (caso post-migración) ---
            shared_dir = get_shared_dir(track, frame, year)
            has_existing_zips = (
                shared_dir.exists() and bool(list(shared_dir.glob("*.zip")))
            )

            if has_existing_zips:
                # Los ZIPs ya están — solo lanzar el procesamiento MintPy
                logger.info(
                    "[%s/%d] ZIPs encontrados en shared/ (%d archivos). "
                    "Lanzando solo procesamiento MintPy (sin re-descargar).",
                    group_label, year,
                    len(list(shared_dir.glob("*.zip"))),
                )
                for volcano in volcanoes:
                    from utils.timeseries_parquet import list_available_years
                    if year in list_available_years(volcano):
                        logger.info(
                            "[%s/%d] %s ya tiene Parquet. Omitiendo.",
                            group_label, year, volcano,
                        )
                        continue
                    launch_process_only(volcano, year)
            else:
                # No hay ZIPs — descargar el año completo
                start_iso = f"{year}-01-01T00:00:00Z"
                end_iso   = f"{year}-12-31T23:59:59Z"
                logger.info(
                    "[%s/%d] No hay ZIPs en shared/. Lanzando descarga completa del año.",
                    group_label, year,
                )
                _launch_download_for_group(track, frame, year, start_iso, end_iso)

            # Solo procesar un año a la vez por grupo para evitar saturar el disco
            break
