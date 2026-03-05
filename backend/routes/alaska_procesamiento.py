from fastapi import FastAPI, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
import os
import shutil
import zipfile
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from datetime import datetime
import tempfile
import re
from typing import List, Optional

# Crear la aplicación FastAPI
app = FastAPI(title="Procesamiento de imágenes raster", version="0.1")

# -------------------------
# Configuración de carpetas
# -------------------------
OUT_COH = Path("resultados_coherencia")
OUT_FAS = Path("resultados_fase")
OUT_ELE = Path("resultados_elevacion")

# Limpiar las carpetas de resultados
def limpiar_resultados():
    for folder in [OUT_COH, OUT_FAS, OUT_ELE]:
        for file in folder.glob("*"):
            file.unlink()
        if folder.exists():
            folder.rmdir()

# -------------------------
# Utilidades
# -------------------------
def nice_date_from_text(text: str) -> str:
    m = re.search(r"(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)", text)
    if not m:
        return ""
    y, mo, d = m.groups()
    try:
        return datetime(int(y), int(mo), int(d)).strftime("%Y-%m-%d")
    except Exception:
        return ""


def extract_zip(zip_path: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, 'r') as z:
        z.extractall(out_dir)

    nested = list(out_dir.rglob("*.zip"))
    for nz in nested:
        sub = nz.with_suffix("")  # carpeta con el mismo nombre
        sub.mkdir(exist_ok=True)
        with zipfile.ZipFile(nz, 'r') as z2:
            z2.extractall(sub)
        nz.unlink()  # opcional: borrar el zip anidado


def find_rasters(root: Path):
    return list(root.rglob("*.tif")) + list(root.rglob("*.tiff"))


def classify_kind(filepath: Path) -> str:
    """
    Clasifica el tipo de archivo basado en su nombre.
    Asegurarse de que las imágenes de coherencia, fase y elevación se clasifiquen correctamente.
    """
    name = filepath.name.lower()
    full = str(filepath).lower()

    print(f"Analizando archivo: {name}")  # Depuración: ver clasificación
    if "unw_phase" in name:
        return "fase"
    if "dem" in name:
        return "elevacion"
    if filepath.suffix.lower() == ".tif":  # Todos los archivos .tif son coherencia
        return "coherencia"
    
    # Si no se encuentra ninguno de estos, retornar desconocido
    return "desconocido"


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

# Función de renderizado de las imágenes con su respectiva escala de color
def render_raster_tiff(in_path: Path, out_tiff: Path, title: str, cmap: str = "viridis",
                       vmin=None, vmax=None, nodata=None):
    with rasterio.open(in_path) as ds:
        data = ds.read(1)

        if nodata is None and ds.nodata is not None:
            nodata = ds.nodata

        stats = compute_stats(data, nodata=nodata)
        if vmin is None or vmax is None:
            if stats:
                vmin = stats["p2"] if vmin is None else vmin
                vmax = stats["p98"] if vmax is None else vmax

        if nodata is not None:
            data = np.where(data == nodata, np.nan, data)

        # Crear la figura para la imagen
        fig, ax = plt.subplots(figsize=(10, 8))

        # Mostrar la imagen con el mapa de colores especificado
        cax = ax.imshow(data, cmap=cmap, vmin=vmin, vmax=vmax)

        # Agregar título
        ax.set_title(title, fontsize=14)

        # Agregar barra de color
        cbar = fig.colorbar(cax)
        cbar.set_label('Valor', rotation=270, labelpad=15)

        # Guardar la imagen generada
        plt.tight_layout()
        plt.savefig(out_tiff, format='png')
        plt.close(fig)

    return stats

def process_one(in_tif: Path, kind: str):
    date_txt = nice_date_from_text(in_tif.name) or nice_date_from_text(str(in_tif.parent))
    date_txt = f" ({date_txt})" if date_txt else ""

    if kind == "coherencia":
        out_dir = OUT_COH
        title = f"Coherencia{date_txt}"
        cmap = "viridis"
    elif kind == "fase":
        out_dir = OUT_FAS
        title = f"Fase{date_txt}"
        cmap = "twilight"
    elif kind == "elevacion":
        out_dir = OUT_ELE
        title = f"Elevación / Ángulo de incidencia{date_txt}"
        cmap = "plasma"
    else:
        return None

    out_name = f"{kind}_{in_tif.stem}.png"  # Guardamos la imagen en formato PNG
    out_png = out_dir / out_name
    stats = render_raster_tiff(in_tif, out_png, title=title, cmap=cmap)
    return out_png, stats


# -------------------------
# Endpoint para procesar el archivo ZIP
# -------------------------
@app.post("/procesar_zip")
async def procesar_zip(file: UploadFile = File(...), procesar_coherencia: bool = Query(True),
                        procesar_fase: bool = Query(True), procesar_elev: bool = Query(True)):
    try:
        # Limpiar carpetas de resultados
        limpiar_resultados()

        # Guardar el archivo ZIP temporalmente
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = Path(tmp.name)

        # Crear carpeta temporal para procesar archivos
        temp_folder = Path(tempfile.mkdtemp(prefix="process_"))
        extract_zip(tmp_path, temp_folder)
        tifs = find_rasters(temp_folder)

        results = []
        for tif in tifs:
            kind = classify_kind(tif)
            if (kind == "coherencia" and not procesar_coherencia) or \
               (kind == "fase" and not procesar_fase) or \
               (kind == "elevacion" and not procesar_elev):
                continue

            res = process_one(tif, kind)
            if res:
                out_png, stats = res
                results.append({
                    "kind": kind,
                    "source_tif": tif.name,
                    "png_file": out_png.name,  # Cambié tiff_file a png_file
                    "stats": stats
                })

        # Crear archivo ZIP con los PNGs generados
        zip_name = "procesados_imagenes.png.zip"
        zip_path = temp_folder / zip_name
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            # Añadir PNGs de todas las carpetas de salida
            for folder in [OUT_COH, OUT_FAS, OUT_ELE]:
                for file in folder.glob("*.png"):
                    zipf.write(file, file.name)

        # Eliminar archivo temporal del ZIP original
        tmp_path.unlink(missing_ok=True)

        return FileResponse(zip_path, media_type="application/zip", filename=zip_name)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error procesando el archivo ZIP: {e}")


# -------------------------
# Correr el servidor
# -------------------------
# Para correr el servidor FastAPI, en terminal:
# uvicorn main:app --reload  
