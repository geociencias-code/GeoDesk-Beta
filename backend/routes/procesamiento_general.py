from fastapi import APIRouter, UploadFile, File, Query, HTTPException
from fastapi.responses import FileResponse
import tempfile
import zipfile
import xarray as xr
import numpy as np
import rasterio
import matplotlib.pyplot as plt
from pathlib import Path
from typing import List

from utils.file_handling import extract_zip, find_rasters
from services.image_processing import classify_kind, render_raster_tiff, generar_mapa_el_salvador

router = APIRouter()

OUT_COH = Path("resultados_coherencia")
OUT_FAS = Path("resultados_fase")
OUT_ELE = Path("resultados_elevacion")

def limpiar_resultados():
    for folder in [OUT_COH, OUT_FAS, OUT_ELE]:
        for file in folder.glob("*"):
            file.unlink()
        if folder.exists():
            folder.rmdir()

@router.post("/api/v1/procesar_zip")
async def procesar_zip(
    file: UploadFile = File(...),
    procesar_coherencia: bool = Query(True),
    procesar_fase: bool = Query(True),
    procesar_elev: bool = Query(True)
):
    try:
        limpiar_resultados()
        
        OUT_COH.mkdir(exist_ok=True)
        OUT_FAS.mkdir(exist_ok=True)
        OUT_ELE.mkdir(exist_ok=True)

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

        results = []
        for tif in tifs:
            kind = classify_kind(tif)
            if (kind == "coherencia" and not procesar_coherencia) or \
               (kind == "fase" and not procesar_fase) or \
               (kind == "elevacion" and not procesar_elev):
                continue
            
            # Map kind to the correct output folder
            out_folder = OUT_COH if kind == "coherencia" else (OUT_FAS if kind == "fase" else OUT_ELE)
            res = render_raster_tiff(
                tif,
                out_folder / f"{kind}_{tif.stem}.png",
                f"{kind} {tif.stem}"
            )
            results.append(res)
        
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

@router.post("/api/v1/temperatura_deformacion")
async def procesar_temp_def(nc_file: UploadFile = File(...), zip_files: List[UploadFile] = File(...)):
    outdir = Path("temperatura_deformacion")
    outdir.mkdir(exist_ok=True)

    for f in outdir.glob("*.png"):
        f.unlink()

    tmp_nc = tempfile.NamedTemporaryFile(delete=False, suffix=".nc")
    tmp_nc.write(await nc_file.read())
    tmp_nc.close()

    try:
        ds = xr.open_dataset(tmp_nc.name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error leyendo .nc: {e}")

    temp_root = Path(tempfile.mkdtemp())
    for z in zip_files:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
            tmp.write(await z.read())
        extract_zip(Path(tmp.name), temp_root)

    rasters = find_rasters(temp_root)
    if not rasters:
        raise HTTPException(status_code=400, detail="ZIP no contiene .tif de deformación")

    if "t2m" not in ds:
        raise HTTPException(status_code=400, detail="El .nc no contiene variable t2m")

    temps = ds["t2m"].mean(dim=("latitude", "longitude")).values
    
    if "time" in ds:
        temp_dates = ds["time"].values
    elif "valid_time" in ds:
        temp_dates = ds["valid_time"].values
    else:
        raise HTTPException(status_code=400, detail="El archivo .nc no tiene variable temporal 'time' ni 'valid_time'.")

    try:
        temp_dates = np.array([np.datetime64(t).astype("datetime64[ms]").astype(object) for t in temp_dates])
    except:
        raise HTTPException(status_code=500, detail="No se pudieron convertir las fechas del .nc")

    for i, tif in enumerate(rasters):
        with rasterio.open(tif) as im:
            data = im.read(1)

        plt.figure(figsize=(10,6))
        plt.plot(temps, label="Temperatura ERA5")
        plt.title(f"Temp vs Deformación - {tif.name}")
        plt.xlabel("Índice de tiempo")
        plt.ylabel("Valor")
        plt.legend()

        outname = outdir / f"graph_{i}.png"
        plt.savefig(outname)
        plt.close()

        outmap = outdir / f"map_{i}.png"
        generar_mapa_el_salvador(tif, outmap)

    return {"ok": True, "images": sorted([f"temperatura_deformacion/{x.name}" for x in outdir.glob("*.png")])}

@router.get("/api/v1/temperatura_deformacion/list")
async def listar_temp_def():
    outdir = Path("temperatura_deformacion")
    imgs = sorted([f"temperatura_deformacion/{x.name}" for x in outdir.glob("*.png")])
    return {"images": imgs}
