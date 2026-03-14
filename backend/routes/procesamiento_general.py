from fastapi import APIRouter, UploadFile, File, Query, HTTPException
import json
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
        stats_dict = {}
        for tif in tifs:
            kind = classify_kind(tif)
            if (kind == "coherencia" and not procesar_coherencia) or \
               (kind == "fase" and not procesar_fase) or \
               (kind == "elevacion" and not procesar_elev):
                continue
            
            # Map kind to the correct output folder
            out_folder = OUT_COH if kind == "coherencia" else (OUT_FAS if kind == "fase" else OUT_ELE)
            out_name = f"{kind}_{tif.stem}.png"
            res = render_raster_tiff(
                tif,
                out_folder / out_name,
                f"{kind} {tif.stem}"
            )
            stats_dict[out_name] = res
            results.append(res)
        
        stats_path = temp_folder / "stats.json"
        with open(stats_path, "w", encoding="utf-8") as f:
            json.dump(stats_dict, f, ensure_ascii=False)

        zip_name = "procesados_imagenes.zip"
        zip_path = temp_folder / zip_name
        try:
            with zipfile.ZipFile(zip_path, 'w') as zipf:
                zipf.write(stats_path, stats_path.name)
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

