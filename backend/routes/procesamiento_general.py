from fastapi import APIRouter, UploadFile, File, Query, HTTPException
import json
from fastapi.responses import FileResponse
import tempfile
import zipfile
import numpy as np
import rasterio
import pandas as pd
import pyproj
from pathlib import Path
import re
from utils.file_handling import extract_zip, find_rasters
from services.image_processing import classify_kind, render_raster_tiff, generar_mapa_el_salvador
import datetime
import math
from shapely.geometry import box
import geopandas as gpd
from rasterio.mask import mask

router = APIRouter()

OUT_COH = Path("resultados_coherencia")
OUT_FAS = Path("resultados_fase")
OUT_ELE = Path("resultados_elevacion")

def limpiar_resultados():
    """Cleans up all result directories by removing files and folders.

    Removes all files from the output directories (coherencia, fase, and elevacion)
    and then deletes the empty directories. This function is called at the start
    of processing to ensure a clean state before generating new results.

    The directories cleaned are:
        - OUT_COH: Coherencia results
        - OUT_FAS: Fase results
        - OUT_ELE: Elevacion results

    Raises:
        OSError: If a file cannot be deleted or if the directory removal fails.
    """
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
    """Processes a ZIP file containing TIFF images and generates PNG outputs.

        Extracts TIFF images from an uploaded ZIP file, classifies them by type
        (coherencia, fase, or elevacion), renders them as PNG images, and creates
        a new ZIP file containing the processed images and their statistics.

        Args:
            file (UploadFile): The ZIP file to process containing TIFF images.
            procesar_coherencia (bool, optional): Whether to process coherencia images.
            procesar_fase (bool, optional): Whether to process fase images.
            procesar_elev (bool, optional): Whether to process elevacion images.

        Returns:
            FileResponse: A ZIP file containing processed PNG images and stats.json
                with image statistics and metadata.

        Raises:
            HTTPException: With status code 400 if:
                - ZIP file cannot be saved temporarily
                - No TIFF files are found in the ZIP
            HTTPException: With status code 500 if:
                - ZIP extraction fails
                - ZIP creation fails
                - Final ZIP file is not created properly
                - Any unexpected error occurs during processing
        """
    try:
        limpiar_resultados()
        
        OUT_COH.mkdir(exist_ok=True)
        OUT_FAS.mkdir(exist_ok=True)
        OUT_ELE.mkdir(exist_ok=True)

        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False, mode="wb") as tmp:
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

@router.post("/api/v1/alaska/preview")
async def preview_zip(file: UploadFile = File(...)):
    try:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp.write(await file.read())
            tmp_path = Path(tmp.name)
        
        temp_folder = Path(tempfile.mkdtemp(prefix="preview_"))
        extract_zip(tmp_path, temp_folder)
        tifs = find_rasters(temp_folder)
        
        if not tifs:
            raise HTTPException(status_code=400, detail="No TIFs found in ZIP")

        unw_phase_tif = next((t for t in tifs if "unw_phase" in t.name), tifs[0])
        
        with rasterio.open(unw_phase_tif) as src:
            left, bottom, right, top = rasterio.warp.transform_bounds(src.crs, "EPSG:4326", *src.bounds)
            
        tmp_path.unlink()
        
        return {
            "success": True,
            "filename": file.filename,
            "bounds": {
                "lat_min": bottom,
                "lon_min": left,
                "lat_max": top,
                "lon_max": right
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/v1/alaska/crop")
async def crop_zip(
    file: UploadFile = File(...), 
    lat_min: float = Query(...), 
    lon_min: float = Query(...), 
    lat_max: float = Query(...), 
    lon_max: float = Query(...)
):
    try:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp.write(await file.read())
            tmp_path = Path(tmp.name)

        temp_folder = Path(tempfile.mkdtemp(prefix="crop_"))
        out_folder = Path(tempfile.mkdtemp(prefix="crop_out_"))
        extract_zip(tmp_path, temp_folder)
        tifs = find_rasters(temp_folder)

        bbox = box(lon_min, lat_min, lon_max, lat_max)
        geo = gpd.GeoDataFrame({'geometry': [bbox]}, crs="EPSG:4326")

        for tif in tifs:
            with rasterio.open(tif) as src:
                geo_proj = geo.to_crs(src.crs)
                shapes = [features["geometry"] for features in json.loads(geo_proj.to_json())['features']]
                
                out_image, out_transform = rasterio.mask.mask(src, shapes, crop=True)
                out_meta = src.meta.copy()
                
                out_meta.update({
                    "driver": "GTiff",
                    "height": out_image.shape[1],
                    "width": out_image.shape[2],
                    "transform": out_transform
                })

                out_tif_path = out_folder / tif.name
                with rasterio.open(out_tif_path, "w", **out_meta) as dest:
                    dest.write(out_image)

        cropped_zip_path = Path(tempfile.gettempdir()) / f"cropped_{file.filename}"
        with zipfile.ZipFile(cropped_zip_path, 'w') as zipf:
            for cropped_tif in out_folder.glob("*.tif"):
                zipf.write(cropped_tif, cropped_tif.name)

        tmp_path.unlink()
        return FileResponse(cropped_zip_path, media_type="application/zip", filename=f"cropped_{file.filename}")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/v1/alaska/velocity")
async def process_velocity(file: UploadFile = File(...)):
    """Processes an InSAR ZIP file to compute deformation velocity and displacement data.

    This endpoint processes a ZIP archive containing Sentinel-1 InSAR unwrapped phase TIFF
    files. It extracts phase data, converts it to deformation measurements (displacement in
    meters and deformation in millimeters), and generates geographic coordinates. The results
    are exported as a CSV file with detailed measurements and a JSON file with UI sample data.

    The phase-to-displacement conversion uses the Sentinel-1 wavelength approximation:
        - Wavelength (λ): ~0.05546576 meters
        - Conversion formula: disp_m = (phase * λ) / (-4 * π)
        - Final deformation: deformation_mm = displacement_m * 1000

    Args:
        file (UploadFile): A ZIP file containing InSAR TIFF products. Must include at least
            one file with "unw_phase" in its filename. The file naming convention should
            follow the pattern: *_YYYYMMDDTHHMMSS_YYYYMMDDTHHMMSS_*.tif

    Returns:
        FileResponse: A ZIP file containing:
            - deformacion_{filename}.csv: CSV file with columns:
                - Latitud (float): Geographic latitude in WGS84 (EPSG:4326)
                - Longitud (float): Geographic longitude in WGS84 (EPSG:4326)
                - Fase (float): Raw unwrapped phase values
                - Desplazamiento_m (float): Displacement in meters
                - Deformacion_mm (float): Deformation in millimeters
            - ui_data.json: JSON file containing:
                - sample (list): Up to 100 sample points with lat, lon, and def fields
                - dias (int): Time interval in days between the two acquisition dates
                - start_date (str): Start acquisition date in YYYYMMDD format
                - end_date (str): End acquisition date in YYYYMMDD format

    Raises:
        HTTPException: With status code 400 if:
            - No TIFF files are found in the ZIP archive
            - The unw_phase.tif file is not found in the extracted data
        HTTPException: With status code 500 if:
            - An error occurs during ZIP extraction
            - An error occurs while reading or processing TIFF files
            - An error occurs during coordinate transformation
            - An error occurs while creating the output ZIP file
            - Any unexpected error occurs during processing
    """

    try:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp.write(await file.read())
            tmp_path = Path(tmp.name)

        temp_folder = Path(tempfile.mkdtemp(prefix="vel_"))
        extract_zip(tmp_path, temp_folder)
        tifs = find_rasters(temp_folder)

        unw_phase_tif = next((t for t in tifs if "unw_phase" in t.name), None)
        if not unw_phase_tif:
            raise HTTPException(status_code=400, detail="No se encontró unw_phase.tif")

        date_pattern = re.compile(r'(\d{8})T')
        matches = date_pattern.findall(unw_phase_tif.name)
        
        if len(matches) >= 2:
            d1 = datetime.datetime.strptime(matches[0], "%Y%m%d")
            d2 = datetime.datetime.strptime(matches[1], "%Y%m%d")
            diff_days = abs((d2 - d1).days)
        else:
            diff_days = 12

        with rasterio.open(unw_phase_tif) as src:
            fase = src.read(1)
            transform = src.transform
            nodata = src.nodata

            # Transformar la fase a desplazamiento en metros usando la fórmula:
            # disp_m = (fase * lambda) / (-4 * pi) => Sentinel-1 lambda approx 0.05546576 m
            valid_mask = (fase != nodata) & np.isfinite(fase)
            
            fase_valid = fase[valid_mask]
            
            disp_m = (fase_valid * 0.05546576) / (-4 * math.pi)

            deformacion_mm = disp_m * 1000.0

            rows, cols = np.where(valid_mask)

            xs, ys = transform * (cols, rows)
            
            if src.crs and src.crs.to_epsg() != 4326:
                transformer = pyproj.Transformer.from_crs(src.crs, "EPSG:4326", always_xy=True)
                lons, lats = transformer.transform(xs, ys)
            else:
                lons, lats = xs, ys

            csv_path = Path(tempfile.gettempdir()) / f"velocidad_{file.filename}.csv"
            df = pd.DataFrame({
                "Latitud": np.round(lats, 6),
                "Longitud": np.round(lons, 6),
                "Fase": np.round(fase_valid, 4),
                "Desplazamiento_m": np.round(disp_m, 6),
                "Deformacion_mm": np.round(deformacion_mm, 4)
            })
            df.to_csv(csv_path, index=False)

            step = max(1, len(rows) // 100)
            ui_sample = []
            
            for i in range(0, len(rows), step):
                if len(ui_sample) >= 100:
                    break
                ui_sample.append({
                    "lat": float(lats[i]),
                    "lon": float(lons[i]),
                    "def": float(deformacion_mm[i])
                })

        result_zip_path = Path(tempfile.gettempdir()) / f"deformation_result_{file.filename}.zip"
        with zipfile.ZipFile(result_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            zipf.write(csv_path, f"deformacion_{file.filename}.csv")
            ui_json_path = Path(tempfile.gettempdir()) / "ui_data.json"
            with open(ui_json_path, 'w') as jf:
                json.dump({"sample": ui_sample, "dias": diff_days, "start_date": matches[0] if len(matches) > 0 else None, "end_date": matches[1] if len(matches) > 1 else None}, jf)
            zipf.write(ui_json_path, "ui_data.json")

        return FileResponse(result_zip_path, media_type="application/zip", filename=f"deformacion_{file.filename}.zip")

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
