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


@router.post("/reprocess")
def reprocess_volcano(
    req: ReprocessRequest,
    current_user: TokenData = Depends(require_admin),
):
    """
    Fuerza el reprocesamiento MintPy + guardado Parquet para un volcán y año concretos.
    El Parquet existente (aunque sea de ceros) será sobreescrito al finalizar.
    """
    volcano = req.volcano
    year    = req.year

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
        raise HTTPException(
            status_code=422,
            detail=(
                f"No hay ZIPs en shared/ para track{track}_frame{frame}/{year}. "
                f"Ruta esperada: {shared_dir}. "
                "Primero ejecuta una descarga completa del año desde HyP3."
            ),
        )

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
