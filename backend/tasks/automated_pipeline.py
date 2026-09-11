import os
import shutil
import logging
from pathlib import Path
from celery import shared_task, chain
from redis import Redis

from utils.hyp3_client import check_hyp3_quota, submit_insar_jobs
from utils.timeseries_parquet import VOLCANOES, save_from_mintpy_timeseries_h5
from utils.shared_storage import (
    get_shared_dir,
    get_existing_pair_keys,
    pair_key_from_granules,
    get_track_frame_groups,
    cleanup_year_zips,
)
from routes.solicitar_imagenes_automatico import search_scenes, build_pairs
from routes.mintpy_analysis import _run_mintpy_pipeline
import hyp3_sdk as sdk

logger = logging.getLogger(__name__)

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
_LOCK_TTL_SECONDS = 4 * 24 * 3600  # 4 días

MIN_COHERENCE = 0.5
WORK_BASE = Path("/tmp/mintpy_auto")


def _get_redis() -> Redis:
    return Redis.from_url(_REDIS_URL, decode_responses=True)


def _pipeline_lock_key(track: int, frame: int, year: int) -> str:
    """Lock a nivel de grupo (track, frame, year) — cubre todos los volcanes del grupo."""
    return f"pipeline_lock:track{track}_frame{frame}:{year}"


def _acquire_lock(track: int, frame: int, year: int, task_id: str) -> bool:
    """Intenta adquirir el lock para este (track, frame, year).
    Retorna True si lo adquirió (puede proceder), False si ya existe.
    Usa SET NX para garantizar atomicidad.
    """
    r = _get_redis()
    key = _pipeline_lock_key(track, frame, year)
    acquired = r.set(key, task_id, ex=_LOCK_TTL_SECONDS, nx=True)
    return acquired is True


def _release_lock(track: int, frame: int, year: int, task_id: str):
    """Libera el lock sólo si lo posee esta tarea."""
    r = _get_redis()
    key = _pipeline_lock_key(track, frame, year)
    current = r.get(key)
    if current == task_id:
        r.delete(key)


def _refresh_lock(track: int, frame: int, year: int, task_id: str):
    """Renueva el TTL del lock antes de cada reintento."""
    r = _get_redis()
    key = _pipeline_lock_key(track, frame, year)
    current = r.get(key)
    if current == task_id:
        r.expire(key, _LOCK_TTL_SECONDS)


def is_download_lock_active(track: int, frame: int, year: int) -> bool:
    """Retorna True si hay un lock de descarga activo para este grupo/año."""
    r = _get_redis()
    return r.exists(_pipeline_lock_key(track, frame, year)) > 0


# ---------------------------------------------------------------------------
# TAREA 1: Buscar en ASF, filtrar pares nuevos y enviar a HyP3
# ---------------------------------------------------------------------------

# max_retries=30: cubre hasta 90 días de espera (30 reintentos × 3 días cada uno)
@shared_task(bind=True, max_retries=30, default_retry_delay=3600, queue="geodesk_heavy")
def pipeline_submit_hyp3(self, track: int, frame: int, year: int,
                         start_date_iso: str, end_date_iso: str):
    """Busca imágenes en ASF para el rango de fechas dado, filtra los pares que
    ya están en shared/, y envía a HyP3 únicamente los pares nuevos.

    El lock opera a nivel de (track, frame, year) para cubrir todos los volcanes
    del mismo grupo con un solo job de descarga.
    """
    task_id = self.request.id
    group_label = f"track{track}_frame{frame}-{year}"

    if not _acquire_lock(track, frame, year, task_id):
        existing = _get_redis().get(_pipeline_lock_key(track, frame, year))
        logger.warning(
            "[%s] Descarga ya en curso (task_id=%s). "
            "Descartando ejecución duplicada (task_id=%s).",
            group_label, existing, task_id,
        )
        return {"job_ids": [], "track": track, "frame": frame,
                "year": year, "skipped": True}

    try:
        logger.info("[%s] Buscando SLCs en ASF [%s → %s]...",
                    group_label, start_date_iso, end_date_iso)

        results = search_scenes(
            start_date_iso, end_date_iso,
            ruta=track, marco=frame,
            direction="DESCENDING",
        )
        all_pairs = build_pairs(results, day_interval=12)
        logger.info("[%s] Pares encontrados en ASF: %d", group_label, len(all_pairs))

        if not all_pairs:
            logger.info("[%s] No hay pares en ASF para este rango. Fin.", group_label)
            _release_lock(track, frame, year, task_id)
            return {"job_ids": [], "track": track, "frame": frame, "year": year}

        # Filtrar pares que ya están descargados en shared/
        existing_keys = get_existing_pair_keys(track, frame, year)
        new_pairs = [
            (g1, g2) for g1, g2 in all_pairs
            if pair_key_from_granules(g1, g2) not in existing_keys
        ]
        skipped = len(all_pairs) - len(new_pairs)
        logger.info(
            "[%s] Pares ya en disco: %d. Pares nuevos a enviar a HyP3: %d.",
            group_label, skipped, len(new_pairs),
        )

        if not new_pairs:
            logger.info("[%s] Todos los pares ya están descargados. Nada que hacer.", group_label)
            _release_lock(track, frame, year, task_id)
            return {"job_ids": [], "track": track, "frame": frame,
                    "year": year, "all_downloaded": True}

        # Verificar cuota HyP3
        username = os.getenv("HYP3_USERNAME")
        password = os.getenv("HYP3_PASSWORD")
        if not check_hyp3_quota(username, password, required_credits=len(new_pairs)):
            logger.warning(
                "[%s] Cuota insuficiente en HyP3 (requeridos: %d). "
                "Reintentando en 3 días. (Intento %d/%d)",
                group_label, len(new_pairs),
                self.request.retries + 1, self.max_retries,
            )
            _refresh_lock(track, frame, year, task_id)
            raise self.retry(countdown=259200)  # 3 días

        # Enviar pares nuevos a HyP3
        project_name = f"auto_track{track}_frame{frame}_{year}"
        logger.info("[%s] Enviando %d pares nuevos a HyP3...", group_label, len(new_pairs))
        summaries = submit_insar_jobs(new_pairs, project_name, username, password)
        job_ids = [s["job_id"] for s in summaries if s.get("job_id")]

        logger.info("[%s] %d trabajos enviados exitosamente a HyP3.", group_label, len(job_ids))
        return {
            "job_ids": job_ids,
            "track": track,
            "frame": frame,
            "year": year,
            "lock_task_id": task_id,
        }

    except Exception as exc:
        from celery.exceptions import Retry
        if isinstance(exc, Retry):
            raise
        _release_lock(track, frame, year, task_id)
        raise


# ---------------------------------------------------------------------------
# TAREA 2: Esperar a HyP3 y descargar al directorio compartido
# ---------------------------------------------------------------------------

@shared_task(bind=True, max_retries=168, default_retry_delay=3600, queue="geodesk_heavy")
def pipeline_wait_and_download(self, prev_result: dict):
    """Espera a que los trabajos de HyP3 terminen y los descarga al shared/.
    Descarga solo ZIPs que no existan ya (comprueba por nombre de archivo).
    Reintenta cada hora, hasta 1 semana.
    """
    job_ids = prev_result.get("job_ids", [])
    track   = prev_result.get("track")
    frame   = prev_result.get("frame")
    year    = prev_result.get("year")
    group_label = f"track{track}_frame{frame}-{year}"

    if not job_ids:
        logger.info("[%s] Sin job_ids que esperar. Pasando al procesamiento.", group_label)
        return prev_result

    logger.info("[%s] Revisando estado de %d trabajos en HyP3...",
                group_label, len(job_ids))
    username = os.getenv("HYP3_USERNAME")
    password = os.getenv("HYP3_PASSWORD")
    hyp3 = sdk.HyP3(username=username, password=password)

    pending = 0
    failed = 0
    completed_jobs = []

    for jid in job_ids:
        try:
            job = hyp3.get_job_by_id(jid)
            if not job.complete():
                pending += 1
            elif job.status_code == "FAILED":
                failed += 1
            elif job.status_code == "SUCCEEDED":
                completed_jobs.append(job)
        except Exception as e:
            logger.error("[%s] Error consultando job %s: %s", group_label, jid, e)
            pending += 1

    if pending > 0:
        logger.info("[%s] %d trabajos pendientes. Reintentando en 1 hora.",
                    group_label, pending)
        raise self.retry(countdown=3600)

    logger.info("[%s] Todos terminados. %d éxitos, %d fallos.",
                group_label, len(completed_jobs), failed)

    if not completed_jobs:
        raise ValueError(f"[{group_label}] Todos los trabajos de HyP3 fallaron.")

    # Descargar al directorio compartido
    shared_dir = get_shared_dir(track, frame, year)
    shared_dir.mkdir(parents=True, exist_ok=True)

    # Construir el conjunto de nombres ya presentes para no re-descargar
    existing_names = {f.name for f in shared_dir.glob("*.zip")}

    downloaded = 0
    skipped = 0
    for job in completed_jobs:
        try:
            # HyP3 SDK indica los archivos disponibles antes de descargar
            for file_info in job.files:
                filename = Path(file_info["filename"]).name
                if filename in existing_names:
                    logger.info("[%s] ZIP ya existe, omitiendo: %s", group_label, filename)
                    skipped += 1
                    continue
                job.download_files(str(shared_dir))
                downloaded += 1
        except Exception as e:
            logger.error("[%s] Error descargando job %s: %s", group_label, job.job_id, e)

    logger.info(
        "[%s] Descarga completada — nuevos: %d, omitidos (ya existían): %d.",
        group_label, downloaded, skipped,
    )
    prev_result["shared_dir"] = str(shared_dir)
    return prev_result


# ---------------------------------------------------------------------------
# TAREA 3: Procesar un volcán con MintPy (lee desde shared/)
# ---------------------------------------------------------------------------

@shared_task(bind=True, queue="geodesk_heavy")
def pipeline_run_mintpy(self, prev_result: dict, volcano: str):
    """Ejecuta el análisis MintPy para un volcán específico usando los ZIPs del
    shared/. La fuente de datos es compartida entre volcanes del mismo track/frame;
    el recorte espacial (crop) se aplica por volcán a través del bbox.
    """
    track = prev_result.get("track")
    frame = prev_result.get("frame")
    year  = prev_result.get("year")
    group_label = f"{volcano}-{year}"

    # El directorio de ZIPs es siempre el shared/ del grupo
    shared_dir = get_shared_dir(track, frame, year)
    if not shared_dir.exists() or not list(shared_dir.glob("*.zip")):
        logger.error(
            "[%s] No hay ZIPs en shared/ (%s). No se puede procesar.",
            group_label, shared_dir,
        )
        return {**prev_result, "volcano": volcano, "work_dir": None}

    config = VOLCANOES.get(volcano)
    if not config:
        raise ValueError(f"Volcán no encontrado en VOLCANOES: {volcano}")

    bbox = config["bbox"]
    lat_min = min(bbox[0], bbox[2])
    lat_max = max(bbox[0], bbox[2])
    lon_min = min(bbox[1], bbox[3])
    lon_max = max(bbox[1], bbox[3])

    work_dir = WORK_BASE / f"{volcano}_{year}"
    work_dir.mkdir(parents=True, exist_ok=True)

    logger.info(
        "[%s] Iniciando MintPy. ZIPs desde shared/: %s. "
        "Recorte: lat=[%.4f,%.4f] lon=[%.4f,%.4f]",
        group_label, shared_dir, lat_min, lat_max, lon_min, lon_max,
    )

    try:
        era5_key = os.getenv("ERA5_KEY")
        _run_mintpy_pipeline(
            work_dir=work_dir,
            zip_dir=shared_dir,   # <-- usa el shared/ compartido
            ref_lat=None,
            ref_lon=None,
            crop_lat_min=lat_min,
            crop_lat_max=lat_max,
            crop_lon_min=lon_min,
            crop_lon_max=lon_max,
            has_triplets=True,
            min_coherence=MIN_COHERENCE,
            era5_key=era5_key,
        )
        logger.info("[%s] MintPy completado.", group_label)
        return {**prev_result, "volcano": volcano, "work_dir": str(work_dir)}
    except Exception as e:
        logger.error("[%s] Falló MintPy: %s", group_label, e)
        raise


# ---------------------------------------------------------------------------
# TAREA 4: Guardar Parquet y limpiar trabajo temporal
# ---------------------------------------------------------------------------

@shared_task(bind=True, queue="geodesk_heavy")
def pipeline_finalize_and_cleanup(self, prev_result: dict):
    """Guarda el resultado Parquet para un volcán/año y limpia el directorio
    de trabajo temporal de MintPy.

    Los ZIPs del shared/ NO se borran aquí — solo se borran cuando el año
    está completo Y todos los volcanes del grupo tienen su Parquet guardado
    (esto lo hace cleanup_year_zips).
    """
    work_dir      = prev_result.get("work_dir")
    track         = prev_result.get("track")
    frame         = prev_result.get("frame")
    volcano       = prev_result.get("volcano")
    year          = prev_result.get("year")
    lock_task_id  = prev_result.get("lock_task_id")
    group_label   = f"{volcano}-{year}"

    if not work_dir:
        logger.warning("[%s] Sin work_dir. Saltando guardado de Parquet.", group_label)
        _release_lock(track, frame, year, lock_task_id)
        return prev_result

    logger.info("[%s] Guardando resultados Parquet...", group_label)

    h5_path = Path(work_dir) / "timeseries.h5"
    parquet_saved = False

    if h5_path.exists():
        config = VOLCANOES[volcano]
        bbox = config["bbox"]
        try:
            out_path = save_from_mintpy_timeseries_h5(
                h5_path=h5_path,
                volcano=volcano,
                year=year,
                lat_min=min(bbox[0], bbox[2]),
                lat_max=max(bbox[0], bbox[2]),
                lon_min=min(bbox[1], bbox[3]),
                lon_max=max(bbox[1], bbox[3]),
                overwrite=True,
            )
            logger.info("[%s] Parquet guardado en: %s", group_label, out_path)
            parquet_saved = True
        except Exception as e:
            logger.error("[%s] Error guardando Parquet: %s", group_label, e)
    else:
        logger.error("[%s] No se encontró timeseries.h5 en %s", group_label, work_dir)

    # Limpiar directorio de trabajo temporal de MintPy (no los ZIPs compartidos)
    shutil.rmtree(work_dir, ignore_errors=True)
    logger.info("[%s] Directorio de trabajo temporal eliminado: %s", group_label, work_dir)

    # Intentar borrar ZIPs del shared/ si el año cerró y todos los volcanes están procesados.
    # Esta función verifica las condiciones internamente y no borra si no se cumplen.
    if parquet_saved:
        deleted = cleanup_year_zips(track, frame, year)
        if deleted > 0:
            logger.info(
                "[%s] Año %d completo: %d ZIPs borrados del shared/.",
                group_label, year, deleted,
            )

    _release_lock(track, frame, year, lock_task_id)
    logger.info("[%s] Pipeline finalizado.", group_label)
    return {"success": parquet_saved, "volcano": volcano, "year": year}


# ---------------------------------------------------------------------------
# Helper: lanzar la cadena completa de procesamiento para un volcán/año
# (sin descargar — usa los ZIPs ya presentes en shared/)
# ---------------------------------------------------------------------------

def launch_process_only(volcano: str, year: int) -> None:
    """Encola solo las tareas de procesamiento MintPy + Parquet para un volcán/año.
    Útil cuando los ZIPs ya están en shared/ (ej: después de la migración o
    cuando bootstrap_historical detecta datos sin procesar).
    """
    config = VOLCANOES.get(volcano)
    if not config:
        raise ValueError(f"Volcán no encontrado: {volcano}")

    track = config["track"]
    frame = config["frame"]

    base_result = {"track": track, "frame": frame, "year": year,
                   "volcano": volcano, "lock_task_id": None}

    workflow = chain(
        pipeline_run_mintpy.s(base_result, volcano),
        pipeline_finalize_and_cleanup.s(),
    )
    workflow.apply_async(queue="geodesk_heavy")
    logger.info(
        "[launch_process_only] Encolado procesamiento MintPy para %s/%d", volcano, year
    )
