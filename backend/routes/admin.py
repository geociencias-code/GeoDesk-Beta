"""
routes/admin.py
---------------
Endpoints de administración del pipeline automatizado.
Solo accesibles para usuarios con rol 'admin' (JWT).
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from utils.jwt_auth import require_admin, TokenData
from utils.timeseries_parquet import VOLCANOES, list_all_available, parquet_path
from utils.shared_storage import get_shared_dir

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["Admin"])


class ReprocessRequest(BaseModel):
    volcano: str
    year: int
    download_if_missing: bool = False  # Si True y no hay ZIPs, lanza la descarga en HyP3
    force: bool = False                # Si True, limpia cualquier lock huérfano previo en Redis


@router.get("/storage-status")
def get_storage_status(current_user: TokenData = Depends(require_admin)):
    """Diagnóstico detallado de almacenamiento compartido, parquets y bloqueos en Redis."""
    from utils.timeseries_parquet import VOLCANOES, parquet_path, list_available_years
    from utils.shared_storage import get_shared_dir, get_track_frame_groups
    from tasks.automated_pipeline import is_download_lock_active, _pipeline_lock_key, _get_redis
    import pandas as pd

    groups = get_track_frame_groups()
    shared_status = []
    years_to_check = [2024, 2025, 2026]

    for (track, frame), volcanoes in groups.items():
        for year in years_to_check:
            s_dir = get_shared_dir(track, frame, year)
            exists = s_dir.exists()
            zips = list(s_dir.glob("*.zip")) if exists else []
            total_size_mb = round(sum(z.stat().st_size for z in zips) / (1024 ** 2), 2) if zips else 0
            has_lock = is_download_lock_active(track, frame, year)
            lock_val = None
            if has_lock:
                try:
                    lock_val = _get_redis().get(_pipeline_lock_key(track, frame, year))
                except Exception:
                    pass

            shared_status.append({
                "group": f"track{track}_frame{frame}",
                "track": track,
                "frame": frame,
                "year": year,
                "volcanoes": volcanoes,
                "dir_exists": exists,
                "dir_path": str(s_dir),
                "zips_count": len(zips),
                "total_size_mb": total_size_mb,
                "has_redis_lock": has_lock,
                "lock_task_id": lock_val,
            })

    # Analizar parquets con detalle de datos reales vs ceros
    volcanoes_status = {}
    for volcano_key, vinfo in VOLCANOES.items():
        years = list_available_years(volcano_key)
        y_entries = []
        for year in years:
            p_path = parquet_path(volcano_key, year)
            size_kb = round(p_path.stat().st_size / 1024, 2) if p_path.exists() else 0
            row_count = 0
            non_zero_count = 0
            is_flat_zeros = True
            try:
                df = pd.read_parquet(p_path)
                row_count = len(df)
                if "deformation" in df.columns:
                    non_zero = df[df["deformation"] != 0.0]
                    non_zero_count = len(non_zero)
                    is_flat_zeros = (non_zero_count == 0)
            except Exception as e:
                logger.warning("Error leyendo %s: %s", p_path, e)

            y_entries.append({
                "year": year,
                "size_kb": size_kb,
                "row_count": row_count,
                "non_zero_points": non_zero_count,
                "is_flat_zeros": is_flat_zeros,
                "path": str(p_path),
            })

        volcanoes_status[volcano_key] = {
            "name": vinfo["name"],
            "track": vinfo["track"],
            "frame": vinfo["frame"],
            "years": y_entries,
        }

    return {
        "ok": True,
        "shared_storage": shared_status,
        "volcanoes": volcanoes_status,
    }


@router.get("/debug-redis")
def debug_redis(current_user: TokenData = Depends(require_admin)):
    """Diagnóstico de conectividad a Redis desde el backend."""
    import os
    import socket
    from redis import Redis

    redis_env = os.getenv("REDIS_URL", "NO DEFINIDA (fallback a localhost)")
    info = {
        "REDIS_URL_env": redis_env,
        "dns_resolution": {},
        "ping_result": None,
        "error": None,
    }

    # Probar resolver 'redis' por DNS
    for host in ["redis", "localhost", "127.0.0.1"]:
        try:
            ip = socket.gethostbyname(host)
            info["dns_resolution"][host] = ip
        except Exception as e:
            info["dns_resolution"][host] = f"Error: {e}"

    # Probar ping directo
    try:
        r = Redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"), socket_timeout=3)
        info["ping_result"] = r.ping()
    except Exception as e:
        info["error"] = str(e)

    return info


@router.post("/reprocess")
def reprocess_volcano(
    req: ReprocessRequest,
    current_user: TokenData = Depends(require_admin),
):
    """
    Fuerza el reprocesamiento MintPy + guardado Parquet para un volcán y año concretos.
    Si download_if_missing=True y no hay ZIPs en shared/, lanza la descarga desde HyP3
    y luego ejecuta MintPy para ese volcán.
    """
    volcano = req.volcano
    year    = req.year
    download_if_missing = req.download_if_missing
    force   = req.force

    if volcano not in VOLCANOES:
        raise HTTPException(
            status_code=404,
            detail=f"Volcán '{volcano}' no reconocido. Opciones: {list(VOLCANOES.keys())}",
        )

    config = VOLCANOES[volcano]
    track  = config["track"]
    frame  = config["frame"]

    if force:
        from tasks.automated_pipeline import _release_lock
        logger.info("[Admin] Forzando liberación de lock previo para track%d_frame%d/%d", track, frame, year)
        _release_lock(track, frame, year)

    shared_dir = get_shared_dir(track, frame, year)
    zips = list(shared_dir.glob("*.zip")) if shared_dir.exists() else []

    if not zips:
        if not download_if_missing:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"No hay ZIPs en shared/ para track{track}_frame{frame}/{year}. "
                    f"Ruta esperada: {shared_dir}. "
                    "Para descargar automáticamente de HyP3 y procesar, incluye: "
                    "'download_if_missing': true en la petición."
                ),
            )

        # Encolar descarga completa de HyP3 para este grupo/año y procesar solo el volcán solicitado
        start_iso = f"{year}-01-01T00:00:00Z"
        end_iso   = f"{year}-12-31T23:59:59Z"

        from celery import chain
        from tasks.automated_pipeline import (
            pipeline_submit_hyp3,
            pipeline_wait_and_download,
        )
        from tasks.orchestrator import (
            _is_download_running,
            _download_task_id,
            _enqueue_volcano_processing,
        )

        try:
            if not force and _is_download_running(track, frame, year):
                return {
                    "ok": False,
                    "message": f"Ya hay una descarga o procesamiento en curso para track{track}_frame{frame}/{year}.",
                    "volcano": volcano,
                    "year": year,
                }

            from celery_app import celery_app
            celery_app.set_current()

            s_submit = celery_app.signature(
                "tasks.automated_pipeline.pipeline_submit_hyp3",
                args=[track, frame, year, start_iso, end_iso],
            )
            s_wait = celery_app.signature(
                "tasks.automated_pipeline.pipeline_wait_and_download",
            )
            s_proc = celery_app.signature(
                "tasks.orchestrator._enqueue_volcano_processing",
                kwargs={"volcanoes": [volcano]},
            )

            workflow = chain(s_submit, s_wait, s_proc)
            task_id = _download_task_id(track, frame, year)
            workflow.apply_async(queue="geodesk_heavy", task_id=task_id)
        except Exception as exc:
            logger.exception("[Admin] Error al encolar descarga HyP3: %s", exc)
            raise HTTPException(
                status_code=500,
                detail=f"Error al encolar descarga en Celery: {exc}",
            )

        logger.info(
            "[Admin] Descarga HyP3 y procesamiento encolados por '%s': volcán=%s año=%d (task_id=%s)",
            current_user.username, volcano, year, task_id,
        )

        return {
            "ok": True,
            "message": (
                f"Descarga desde HyP3 iniciada para track{track}_frame{frame}/{year} [{start_iso} → {end_iso}]. "
                f"Una vez completada la descarga, se procesará automáticamente MintPy para '{volcano}' "
                f"y se guardará el Parquet con los datos calculados."
            ),
            "volcano": volcano,
            "year": year,
            "task_id": task_id,
            "queued_by": current_user.username,
        }

    try:
        from tasks.automated_pipeline import launch_process_only
        task_id = launch_process_only(volcano, year)
    except Exception as exc:
        logger.error("[Admin] Error encolando reprocesamiento %s/%d: %s", volcano, year, exc)
        raise HTTPException(status_code=500, detail=f"Error al encolar tarea Celery: {exc}")

    logger.info(
        "[Admin] Reprocesamiento encolado por '%s': volcán=%s año=%d (%d ZIPs)",
        current_user.username, volcano, year, len(zips),
    )

    return {
        "ok":         True,
        "message":    (
            f"Reprocesamiento encolado para '{volcano}' / {year}. "
            f"Se usarán {len(zips)} ZIPs existentes en shared/. "
            "El Parquet existente será sobreescrito al finalizar."
        ),
        "volcano":    volcano,
        "year":       year,
        "task_id":    task_id,
        "zips_found": len(zips),
        "shared_dir": str(shared_dir),
        "queued_by":  current_user.username,
    }


@router.get("/parquet")
def get_parquet_status(
    current_user: TokenData = Depends(require_admin),
):
    """Devuelve estado de todos los Parquet disponibles (volcán, año, tamaño)."""
    available = list_all_available()
    result = {}

    for volcano_key in VOLCANOES:
        years = available.get(volcano_key, [])
        entries = []
        for year in years:
            path = parquet_path(volcano_key, year)
            size_mb = round(path.stat().st_size / (1024 ** 2), 2) if path.exists() else 0
            entries.append({"year": year, "size_mb": size_mb, "path": str(path)})
        result[volcano_key] = {
            "name":  VOLCANOES[volcano_key]["name"],
            "years": entries,
            "count": len(years),
        }

    return {"ok": True, "parquet_status": result}


@router.delete("/parquet")
def delete_parquet(
    volcano: str,
    year: int,
    current_user: TokenData = Depends(require_admin),
):
    """
    Elimina el Parquet de un volcán/año. Tras borrarlo, el orquestador diario
    lo detectará como faltante y lo regenerará automáticamente.

    Query params: ?volcano=san_miguel&year=2024
    """
    if volcano not in VOLCANOES:
        raise HTTPException(status_code=404, detail=f"Volcán '{volcano}' no reconocido.")

    path = parquet_path(volcano, year)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No existe Parquet para '{volcano}' año {year}.",
        )

    path.unlink()
    logger.warning("[Admin] Parquet eliminado por '%s': %s", current_user.username, path)

    return {
        "ok":         True,
        "message":    f"Parquet de '{volcano}' / {year} eliminado.",
        "path":       str(path),
        "deleted_by": current_user.username,
    }
