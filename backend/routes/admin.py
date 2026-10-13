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

    if volcano not in VOLCANOES:
        raise HTTPException(
            status_code=404,
            detail=f"Volcán '{volcano}' no reconocido. Opciones: {list(VOLCANOES.keys())}",
        )

    config = VOLCANOES[volcano]
    track  = config["track"]
    frame  = config["frame"]

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

        from tasks.orchestrator import _launch_download_for_group
        # Lanzamos la descarga especificando solo este volcán en el callback
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
            if _is_download_running(track, frame, year):
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
        launch_process_only(volcano, year)
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
            f"Se usarán {len(zips)} ZIPs de shared/. "
            "El Parquet existente será sobreescrito al finalizar."
        ),
        "volcano":    volcano,
        "year":       year,
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
