# backend/processing/processing_utils.py

import zipfile
from pathlib import Path
import rasterio
import numpy as np
import matplotlib.pyplot as plt
from datetime import datetime
import re

# Función para extraer ZIPs
def extract_zip(zip_path: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, 'r') as z:
        z.extractall(out_dir)

    # Buscar y extraer Zips anidados
    nested = list(out_dir.rglob("*.zip"))
    for nz in nested:
        sub = nz.with_suffix("")  # Crear carpeta con el mismo nombre
        sub.mkdir(exist_ok=True)
        with zipfile.ZipFile(nz, 'r') as z2:
            z2.extractall(sub)
        nz.unlink()  # Opcional: borrar el zip anidado

# Función para encontrar todos los archivos TIFF
def find_rasters(root: Path):
    return list(root.rglob("*.tif")) + list(root.rglob("*.tiff"))

# Función para clasificar el tipo de archivo basado en su nombre
def classify_kind(filepath: Path) -> str:
    name = filepath.name.lower()
    if "unw_phase" in name:
        return "fase"
    if "dem" in name:
        return "elevacion"
    if filepath.suffix.lower() == ".tif":
        return "coherencia"
    return "desconocido"

# Función para calcular estadísticas de un arreglo de datos
def compute_stats(arr: np.ndarray, nodata=None):
    a = arr.astype(float)
    if nodata is not None:
        a = np.where(a == nodata, np.nan, a)
    finite = np.isfinite(a)
    if not finite.any():
        return {}
    vals = a[finite]
    return {
        "min": float(np.nanmin(vals)),
        "max": float(np.nanmax(vals)),
        "mean": float(np.nanmean(vals)),
        "std": float(np.nanstd(vals)),
        "p2": float(np.nanpercentile(vals, 2)),
        "p98": float(np.nanpercentile(vals, 98)),
        "count": int(vals.size),
    }

# Función para obtener la fecha desde el nombre del archivo o carpeta
def nice_date_from_text(text: str) -> str:
    """
    Extrae una fecha del texto (nombre de archivo o carpeta) y la devuelve
    en formato "YYYY-MM-DD". Si no se encuentra una fecha, retorna una cadena vacía.
    """
    m = re.search(r"(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)", text)
    if not m:
        return ""
    y, mo, d = m.groups()
    try:
        return datetime(int(y), int(mo), int(d)).strftime("%Y-%m-%d")
    except Exception:
        return ""
