import zipfile
from pathlib import Path
import re
from datetime import datetime

def extract_zip(zip_path: Path, out_dir: Path):
    """Extracts a zip file to the output directory and recursively extracts nested zips."""
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, 'r') as z:
        z.extractall(out_dir)

    nested = list(out_dir.rglob("*.zip"))
    for nz in nested:
        sub = nz.with_suffix("")
        sub.mkdir(exist_ok=True)
        with zipfile.ZipFile(nz, 'r') as z2:
            z2.extractall(sub)
        nz.unlink()

def find_rasters(root: Path):
    """Finds all .tif and .tiff files in a directory."""
    return list(root.rglob("*.tif")) + list(root.rglob("*.tiff"))

def nice_date_from_text(text: str) -> str:
    """Extracts a date from text in format YYYY-MM-DD or returns empty string."""
    m = re.search(r"(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)", text)
    if not m:
        return ""
    y, mo, d = m.groups()
    try:
        return datetime(int(y), int(mo), int(d)).strftime("%Y-%m-%d")
    except Exception:
        return ""

def extract_date(name: str):
    """Extracts date from standard filename (e.g. YYYYMMDD)"""
    m = re.search(r"(20\d{2})(\d{2})(\d{2})", name)
    if not m:
        return None
    y, mth, d = m.groups()
    try:
        return datetime(int(y), int(mth), int(d))
    except Exception:
        return None
