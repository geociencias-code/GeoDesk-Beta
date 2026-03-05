from fastapi import APIRouter, UploadFile, File, HTTPException
from pathlib import Path
import tempfile
import zipfile
import rasterio
import numpy as np
import matplotlib.pyplot as plt
import os
import re
from datetime import datetime

router = APIRouter()

# === Carpeta donde se guardarán las imágenes ===
OUT_DIR = Path("resultados_deformacion")
OUT_DIR.mkdir(exist_ok=True)

# --------------------------
# Auxiliar: extraer ZIP
# --------------------------
def extract_zip(origin_zip: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(origin_zip, "r") as z:
        z.extractall(out_dir)

# --------------------------
# Auxiliar: extraer fecha del nombre
# --------------------------
def extract_date(name: str):
    m = re.search(r"(20\d{2})(\d{2})(\d{2})", name)
    if not m:
        return None
    y, mth, d = m.groups()
    return datetime(int(y), int(mth), int(d))

# --------------------------
# Auxiliar: generar imagen (SIN MAPA)
# --------------------------
def generar_imagen(data, extent, outfile):
    # Filtrar valores nulos
    masked = np.where(np.isfinite(data), data, np.nan)

    if np.isnan(masked).all():
        print("⚠️ La imagen no contiene datos visibles.")
        return

    plt.figure(figsize=(10, 6))
    plt.imshow(masked, cmap="seismic", vmin=-5, vmax=5, extent=extent)
    plt.colorbar(label="Deformación (cm)")
    plt.title("Deformación estimada entre imágenes")
    plt.axis("off")

    plt.savefig(outfile, dpi=200, bbox_inches="tight")
    plt.close()


# ---------------------------------------------------
#  POST /api/deformacion
# ---------------------------------------------------
@router.post("/api/deformacion")
async def procesar_deformacion(zip_files: list[UploadFile] = File(...)):

    # limpiar resultados anteriores
    for f in OUT_DIR.glob("*.png"):
        f.unlink()

    temp_root = Path(tempfile.mkdtemp())

    fechas = []
    tif_by_date = {}

    # -----------------------
    # 1. Guardar y extraer los ZIP
    # -----------------------
    for z in zip_files:
        # Guardar ZIP temporalmente
        with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
            tmp.write(await z.read())
            tmp_path = Path(tmp.name)

        zip_folder = temp_root / tmp_path.stem
        extract_zip(tmp_path, zip_folder)

        # buscar unw_phase.tif
        tifs = list(zip_folder.rglob("*unw_phase.tif"))
        if not tifs:
            raise HTTPException(status_code=400, detail=f"El ZIP {z.filename} no contiene unw_phase.tif")

        tif = tifs[0]

        # extraer fecha
        date = extract_date(tif.name)
        if not date:
            raise HTTPException(status_code=400, detail=f"No se pudo extraer fecha de {tif.name}")

        fechas.append(date)
        tif_by_date[date] = tif

    fechas = sorted(fechas)
    outputs = []

    # -----------------------
    # 3. Crear pares consecutivos
    # -----------------------
    for i in range(len(fechas) - 1):
        f1 = fechas[i]
        f2 = fechas[i+1]

        t1 = tif_by_date[f1]
        t2 = tif_by_date[f2]

        # cargar TIFF 1
        with rasterio.open(t1) as a:
            d1 = a.read(1).astype(float)
            transform = a.transform

            full_extent = [
                a.bounds.left,
                a.bounds.right,
                a.bounds.bottom,
                a.bounds.top,
            ]

            res_x = transform.a
            res_y = -transform.e

        # cargar TIFF 2
        with rasterio.open(t2) as b:
            d2 = b.read(1).astype(float)

        # Emparejar tamaños
        min_rows = min(d1.shape[0], d2.shape[0])
        min_cols = min(d1.shape[1], d2.shape[1])

        d1 = d1[:min_rows, :min_cols]
        d2 = d2[:min_rows, :min_cols]

        # Extent recortado
        new_left   = full_extent[0]
        new_right  = full_extent[0] + min_cols * res_x
        new_top    = full_extent[3]
        new_bottom = full_extent[3] - min_rows * res_y

        new_extent = [new_left, new_right, new_bottom, new_top]

        # --- Calcular deformación en cm ---
        deform = (d2 - d1) * 2.8  # tu factor original

        # archivo final
        outname = OUT_DIR / f"deformacion_{f1.strftime('%Y%m%d')}_vs_{f2.strftime('%Y%m%d')}.png"

        generar_imagen(deform, new_extent, outname)
        outputs.append(f"resultados_deformacion/{outname.name}")

    return {"ok": True, "resultados": outputs}


# ---------------------------------------------------
# GET /api/deformacion/list
# ---------------------------------------------------
@router.get("/api/deformacion/list")
async def listar_deformacion():
    imgs = sorted([f"resultados_deformacion/{x.name}" for x in OUT_DIR.glob("*.png")])
    return {"imagenes": imgs}
