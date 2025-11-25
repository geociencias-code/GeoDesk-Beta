from fastapi import FastAPI, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
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
import cartopy.crs as ccrs
import cartopy.feature as cfeature



from .routes.alaska import router as alaska_router
from .processing.Era5 import router as era5_router
from .processing.Era5_procesamiento_nc import router as procesamiento_router
from .processing.solicitar_imagenes_automatico import solicitar_imagenes_automatico, SolicitudAutoIn
from .processing.deformacion import router as deformacion_router

# ← agregado
import xarray as xr
import matplotlib.pyplot as plt

# Crear la aplicación FastAPI
app = FastAPI(title="MyApp API", version="0.1.0")

# Configuración CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", 
                   "http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

############################################
# MONTAJE DE CARPETAS EXISTENTES
############################################
app.mount("/temporal_nc", StaticFiles(directory="temporal_nc"), name="temporal_nc")

# ← agregado
if not os.path.exists("temperatura_deformacion"):
    os.makedirs("temperatura_deformacion")

app.mount(
    "/temperatura_deformacion",
    StaticFiles(directory="temperatura_deformacion"),
    name="temperatura_deformacion",
)

if not os.path.exists("resultados_deformacion"):
    os.makedirs("resultados_deformacion")

app.mount(
    "/resultados_deformacion",
    StaticFiles(directory="resultados_deformacion"),
    name="resultados_deformacion",
)

############################################
# Routers ya existentes (NO tocar)
############################################
app.include_router(alaska_router)
app.include_router(era5_router)
app.include_router(procesamiento_router)
app.include_router(deformacion_router)

############################################
# FUNCIONES EXISTENTES (NO tocar)
############################################
OUT_COH = Path("resultados_coherencia")
OUT_FAS = Path("resultados_fase")
OUT_ELE = Path("resultados_elevacion")

def limpiar_resultados():
    for folder in [OUT_COH, OUT_FAS, OUT_ELE]:
        for file in folder.glob("*"):
            file.unlink()
        if folder.exists():
            folder.rmdir()

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
        sub = nz.with_suffix("")
        sub.mkdir(exist_ok=True)
        with zipfile.ZipFile(nz, 'r') as z2:
            z2.extractall(sub)
        nz.unlink()

def find_rasters(root: Path):
    return list(root.rglob("*.tif")) + list(root.rglob("*.tiff"))

def classify_kind(filepath: Path) -> str:
    name = filepath.name.lower()

    # === FASE ===
    if (
        "unw_phase" in name or
        "color_phase" in name or
        "lv_phi" in name or
        "lv_theta" in name
    ):
        return "fase"

    # === COHERENCIA ===
    if (
        "corr" in name or
        "coh" in name
    ):
        return "coherencia"

    # === ELEVACIÓN ===
    if "dem" in name:
        return "elevacion"

    # Archivos que NO debemos procesar
    if "water_mask" in name or "mask" in name:
        return "ignorar"

    # Por defecto, si es .tif lo mando como coherencia
    if filepath.suffix.lower() in [".tif", ".tiff"]:
        return "coherencia"

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

def render_raster_tiff(in_path: Path, out_tiff: Path, title: str, cmap: str = "viridis", vmin=None, vmax=None, nodata=None):
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

        fig, ax = plt.subplots(figsize=(10, 8))
        cax = ax.imshow(data, cmap=cmap, vmin=vmin, vmax=vmax)
        ax.set_title(title, fontsize=14)
        cbar = fig.colorbar(cax)
        cbar.set_label('Valor', rotation=270, labelpad=15)

        plt.tight_layout()
        plt.savefig(out_tiff, format='png')
        plt.close(fig)

    return stats


def generar_mapa_el_salvador(ruta_tif: Path, salida_png: Path):
    """
    Mapa base totalmente offline (sin descargas).
    Usa stock_img() en lugar de LAND, OCEAN, etc.
    """

    with rasterio.open(ruta_tif) as src:
        data = src.read(1)
        extent = [
            src.bounds.left,
            src.bounds.right,
            src.bounds.bottom,
            src.bounds.top,
        ]

    plt.figure(figsize=(10, 8))
    ax = plt.axes(projection=ccrs.PlateCarree())

    # === Mapa base OFFLINE ===
    ax.stock_img()  # <- NO DESCARGA NADA
    ax.coastlines()  # Este sí viene integrado

    # === Raster ===
    im = ax.imshow(
        data,
        extent=extent,
        origin="upper",
        transform=ccrs.PlateCarree(),
        cmap="jet",
    )

    plt.colorbar(im, ax=ax, orientation="vertical", label="Deformación")
    plt.savefig(salida_png, dpi=150, bbox_inches="tight")
    plt.close()


############################################
# ENDPOINT EXISTENTE /procesar_zip (NO tocar)
############################################
@app.post("/procesar_zip")
async def procesar_zip(
    file: UploadFile = File(...),
    procesar_coherencia: bool = Query(True),
    procesar_fase: bool = Query(True),
    procesar_elev: bool = Query(True)
):
    try:
        # Limpiar carpetas de resultados
        limpiar_resultados()

        # Guardar el archivo ZIP temporalmente
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = Path(tmp.name)

        if not tmp_path.exists():
            raise HTTPException(status_code=400, detail="No se pudo guardar el ZIP temporalmente.")
        
        temp_folder = Path(tempfile.mkdtemp(prefix="process_"))
        print(f"Carpeta temporal creada: {temp_folder}")

        try:
            extract_zip(tmp_path, temp_folder)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error extrayendo ZIP: {e}")

        tifs = find_rasters(temp_folder)

        if not tifs:
            raise HTTPException(status_code=400, detail="No se encontraron archivos .tif en el ZIP")

        print(f"Archivos .tif encontrados: {len(tifs)}")

        results = []
        for tif in tifs:
            kind = classify_kind(tif)
            print(f"Clasificando archivo {tif}: {kind}")

            if (kind == "coherencia" and not procesar_coherencia) or \
               (kind == "fase" and not procesar_fase) or \
               (kind == "elevacion" and not procesar_elev):
                continue

            res = render_raster_tiff(
                tif,
                Path(f"resultados/{kind}_{tif.stem}.png"),
                f"{kind} {tif.stem}"
            )
            results.append(res)
        
        # Crear ZIP final
        zip_name = "procesados_imagenes.zip"
        zip_path = temp_folder / zip_name
        try:
            with zipfile.ZipFile(zip_path, 'w') as zipf:
                for folder in [OUT_COH, OUT_FAS, OUT_ELE]:
                    for file in folder.glob("*.png"):
                        zipf.write(file, file.name)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error creando ZIP: {e}")

        tmp_path.unlink(missing_ok=True)

        if not zip_path.exists():
            raise HTTPException(status_code=500, detail="ZIP final no se creó correctamente.")

        return FileResponse(zip_path, media_type="application/zip", filename=zip_name)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error procesando ZIP: {str(e)}")

############################################
# 🚀🚀 NUEVOS ENDPOINTS
# TEMPERATURA vs DEFORMACIÓN (LOS)
############################################

# === POST: Procesar NC + ZIP ===
@app.post("/api/temperatura_deformacion")
async def procesar_temp_def(nc_file: UploadFile = File(...), zip_files: List[UploadFile] = File(...)):

    outdir = Path("temperatura_deformacion")
    outdir.mkdir(exist_ok=True)

    # limpiar imágenes anteriores
    for f in outdir.glob("*.png"):
        f.unlink()

    # guardar temporal .nc
    tmp_nc = tempfile.NamedTemporaryFile(delete=False, suffix=".nc")
    tmp_nc.write(await nc_file.read())
    tmp_nc.close()

    # abrir dataset
    try:
        ds = xr.open_dataset(tmp_nc.name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error leyendo .nc: {e}")

    # extraer ZIPs
    temp_root = Path(tempfile.mkdtemp())
    for z in zip_files:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
            tmp.write(await z.read())
        extract_zip(Path(tmp.name), temp_root)

    rasters = find_rasters(temp_root)
    if not rasters:
        raise HTTPException(status_code=400, detail="ZIP no contiene .tif de deformación")

    # extraer temperatura
    if "t2m" not in ds:
        raise HTTPException(status_code=400, detail="El .nc no contiene variable t2m")

    temps = ds["t2m"].mean(dim=("latitude", "longitude")).values
    # ======================
    # Detectar VARIABLE TEMPORAL del .nc
    # ======================
    if "time" in ds:
        temp_dates = ds["time"].values
    elif "valid_time" in ds:
        temp_dates = ds["valid_time"].values
    else:
        raise HTTPException(
            status_code=400,
            detail="El archivo .nc no tiene variable temporal 'time' ni 'valid_time'."
        )

    # Convertir fechas a datetime nativo de Python
    try:
        temp_dates = np.array([np.datetime64(t).astype("datetime64[ms]").astype(object) for t in temp_dates])
    except:
        raise HTTPException(
            status_code=500,
            detail="No se pudieron convertir las fechas del .nc"
        )


    # graficar por cada TIF
    for i, tif in enumerate(rasters):
        with rasterio.open(tif) as im:
            data = im.read(1)

        # ----------------------------
        # 1) Grafico TEMPERATURA (tú ya lo tenías)
        # ----------------------------
        plt.figure(figsize=(10,6))
        plt.plot(temps, label="Temperatura ERA5")
        plt.title(f"Temp vs Deformación - {tif.name}")
        plt.xlabel("Índice de tiempo")
        plt.ylabel("Valor")
        plt.legend()

        outname = outdir / f"graph_{i}.png"
        plt.savefig(outname)
        plt.close()

        # ----------------------------
        # 2) NUEVO: mapa El Salvador + deformación
        # ----------------------------
        outmap = outdir / f"map_{i}.png"
        generar_mapa_el_salvador(tif, outmap)


    return {"ok": True, "images": sorted([f"temperatura_deformacion/{x.name}" for x in outdir.glob("*.png")])}

# === GET: Listar imágenes ===
@app.get("/api/temperatura_deformacion/list")
async def listar_temp_def():
    outdir = Path("temperatura_deformacion")
    imgs = sorted([f"temperatura_deformacion/{x.name}" for x in outdir.glob("*.png")])
    return {"images": imgs}

############################################
# Health Check
############################################
@app.get("/api/health")
def health_root():
    return {"ok": True, "service": "MyApp API (root)"}

############################################
# Ejecutar servidor
############################################
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
