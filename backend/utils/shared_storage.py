"""
utils/shared_storage.py
-----------------------
Centraliza la lógica de rutas y deduplicación para el almacenamiento
compartido de interferogramas HyP3.

Estructura de directorios:
    alaska_descargas/shared/
        track{track}_frame{frame}/
            {year}/
                S1AA_20240903T114646_20240915T114646_VVP012_INT80_G_ueF_4836.zip
                ...
"""
from __future__ import annotations

import re
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Rutas base
# ---------------------------------------------------------------------------
SHARED_DOWNLOAD_BASE = Path("/app/alaska_descargas/shared")

# Regex para extraer la clave de par de un nombre de archivo HyP3.
# Ejemplo: S1AA_20240903T114646_20240915T114646_VVP012_INT80_G_ueF_4836.zip
#                 date1               date2
_PAIR_KEY_RE = re.compile(r"S1[AB]+_(\d{8}T\d{6})_(\d{8}T\d{6})_")


# ---------------------------------------------------------------------------
# Rutas
# ---------------------------------------------------------------------------

def get_shared_dir(track: int, frame: int, year: int) -> Path:
    """Retorna la ruta canónica donde se guardan los ZIPs compartidos para
    un track/frame/year dado.
    """
    return SHARED_DOWNLOAD_BASE / f"track{track}_frame{frame}" / str(year)


def get_track_frame_dir(track: int, frame: int) -> Path:
    """Retorna el directorio raíz de un grupo track/frame (sin año)."""
    return SHARED_DOWNLOAD_BASE / f"track{track}_frame{frame}"


# ---------------------------------------------------------------------------
# Clave de par (deduplicación)
# ---------------------------------------------------------------------------

def extract_pair_key(filename: str) -> Optional[str]:
    """Extrae la clave de par {date1}_{date2} de un nombre de archivo HyP3.

    La clave identifica unívocamente un interferograma independientemente del
    job ID (los últimos 4 caracteres del nombre varían entre jobs distintos para
    el mismo par de granules).

    Ejemplo:
        "S1AA_20240903T114646_20240915T114646_VVP012_INT80_G_ueF_4836.zip"
        -> "20240903T114646_20240915T114646"

    Retorna None si el nombre no coincide con el patrón HyP3.
    """
    m = _PAIR_KEY_RE.search(filename)
    if not m:
        return None
    return f"{m.group(1)}_{m.group(2)}"


def get_existing_pair_keys(track: int, frame: int, year: int) -> set:
    """Retorna el conjunto de pair_keys ya descargados en shared/ para un
    track/frame/year dado.

    Útil para filtrar qué pares HyP3 ya existen y no necesitan re-descargarse.
    """
    shared_dir = get_shared_dir(track, frame, year)
    if not shared_dir.exists():
        return set()

    keys = set()
    for zip_path in shared_dir.glob("*.zip"):
        key = extract_pair_key(zip_path.name)
        if key:
            keys.add(key)
        else:
            logger.warning(
                "[SharedStorage] No se pudo extraer pair_key de: %s", zip_path.name
            )
    logger.info(
        "[SharedStorage] track%d_frame%d/%d — %d ZIPs existentes en shared/",
        track, frame, year, len(keys),
    )
    return keys


def pair_key_from_granules(granule1: str, granule2: str) -> Optional[str]:
    """Intenta construir la pair_key a partir de los nombres de granule de ASF.

    Los granules de Sentinel-1 embeben la fecha de adquisición en su nombre:
        S1A_IW_SLC__1SDV_20240903T114646_...
                               fecha
    Si el formato no coincide, retorna None.
    """
    _GRANULE_DATE_RE = re.compile(r"_(\d{8}T\d{6})_")
    m1 = _GRANULE_DATE_RE.search(granule1)
    m2 = _GRANULE_DATE_RE.search(granule2)
    if m1 and m2:
        return f"{m1.group(1)}_{m2.group(1)}"
    return None


# ---------------------------------------------------------------------------
# Grupos de volcanes por track/frame
# ---------------------------------------------------------------------------

def get_track_frame_groups() -> dict:
    """Agrupa los volcanes por (track, frame) leyendo VOLCANOES de timeseries_parquet.

    Retorna un dict: {(track, frame): [volcano_name, ...]}
    """
    from utils.timeseries_parquet import VOLCANOES

    groups = {}
    for volcano, config in VOLCANOES.items():
        key = (int(config["track"]), int(config["frame"]))
        groups.setdefault(key, []).append(volcano)
    return groups


# ---------------------------------------------------------------------------
# Estado de años
# ---------------------------------------------------------------------------

def is_year_complete(year: int) -> bool:
    """Retorna True si el año ya terminó (estamos en un año posterior)."""
    return datetime.now(timezone.utc).year > year


def all_volcanoes_processed(track: int, frame: int, year: int) -> bool:
    """Retorna True si TODOS los volcanes del grupo (track, frame) tienen
    su archivo Parquet guardado para el año indicado.
    """
    from utils.timeseries_parquet import list_available_years

    groups = get_track_frame_groups()
    volcanoes_in_group = groups.get((track, frame), [])

    if not volcanoes_in_group:
        logger.warning(
            "[SharedStorage] No hay volcanes registrados para track%d_frame%d",
            track, frame,
        )
        return False

    for volcano in volcanoes_in_group:
        available = list_available_years(volcano)
        if year not in available:
            logger.info(
                "[SharedStorage] Parquet faltante: %s/%d no procesado aún.",
                volcano, year,
            )
            return False

    return True


def previous_year_zips_cleared(track: int, frame: int, year: int) -> bool:
    """Retorna True si los ZIPs del año anterior (year-1) ya fueron eliminados
    o si simplemente no existieron nunca.

    Se usa para garantizar procesamiento secuencial: no descargar el año N
    mientras los ZIPs del año N-1 siguen ocupando espacio.
    """
    prev_year = year - 1
    prev_dir = get_shared_dir(track, frame, prev_year)

    if not prev_dir.exists():
        return True

    zips_in_prev = list(prev_dir.glob("*.zip"))
    if not zips_in_prev:
        return True

    logger.info(
        "[SharedStorage] El año anterior %d aún tiene %d ZIPs en shared/ "
        "(track%d_frame%d). Esperando limpieza antes de procesar %d.",
        prev_year, len(zips_in_prev), track, frame, year,
    )
    return False


def cleanup_year_zips(track: int, frame: int, year: int) -> int:
    """Borra los ZIPs de un año del shared/ si:
       1. El año ya está completo (terminó)
       2. Todos los volcanes del grupo tienen su Parquet guardado

    Retorna el número de ZIPs borrados (0 si las condiciones no se cumplen).
    """
    if not is_year_complete(year):
        logger.info(
            "[SharedStorage] El año %d aún no ha terminado. No se borran ZIPs.", year
        )
        return 0

    if not all_volcanoes_processed(track, frame, year):
        logger.info(
            "[SharedStorage] No todos los volcanes de track%d_frame%d tienen "
            "Parquet para %d. No se borran ZIPs.",
            track, frame, year,
        )
        return 0

    shared_dir = get_shared_dir(track, frame, year)
    if not shared_dir.exists():
        return 0

    zips = list(shared_dir.glob("*.zip"))
    for z in zips:
        z.unlink(missing_ok=True)

    logger.info(
        "[SharedStorage] Limpieza completa: %d ZIPs borrados de "
        "track%d_frame%d/%d",
        len(zips), track, frame, year,
    )
    return len(zips)
