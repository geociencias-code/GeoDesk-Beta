from fastapi import APIRouter, UploadFile, File, Query, HTTPException, Form
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

            # Transformar a desplazamiento (m)
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

@router.post("/api/v1/alaska/apply_era5_filter")
async def apply_era5_filter(
    csv_file: UploadFile = File(...),
    nc_file: UploadFile = File(...),
    start_date: str = Form(...),
    end_date: str = Form(...)
):
    """Applies tropospheric error correction to InSAR deformation data using ERA5 data.

    This function implements the Bevis & Brown (1987) atmospheric correction model
    to remove tropospheric phase delay errors from Sentinel-1 InSAR measurements.
    It extracts water vapor (PWV) and temperature data from ERA5 at the interferogram
    acquisition dates, calculates the atmospheric error, and subtracts it from the
    measured deformation to isolate true ground motion.

    The tropospheric error is calculated using:
        error_tropo (mm) = 0.238 * Δ(PWV) + 0.035 * Δ(T)
    where Δ(PWV) is the change in water vapor column and Δ(T) is the change in
    2-meter air temperature between the two interferogram dates.

    Args:
        csv_file (UploadFile): CSV file containing InSAR deformation measurements.
            Expected columns: Latitud, Longitud, Deformacion_mm, Desplazamiento_m, Fase.
        nc_file (UploadFile): NetCDF (.nc) file containing ERA5 atmospheric data.
            Must include either 'tcwv' or 'total_column_water_vapour' (water vapor)
            and either 't2m' or 'temperature' (2m air temperature).
        start_date (str): Start date of the interferogram in format 'YYYY-MM-DD'.
        end_date (str): End date of the interferogram in format 'YYYY-MM-DD'.

    Returns:
        FileResponse: ZIP archive containing:
            - filtered_*.csv: CSV file with corrected deformation values
            - ui_data.json: JSON with visualization sample (max 100 points),
              time span in days, and date range

    Raises:
        HTTPException: With status code 400 if:
            - ERA5 file lacks 'water vapor' variable (tcwv or total_column_water_vapour)
            - ERA5 file lacks 'temperature' variable (t2m or temperature)
            - ERA5 file lacks valid time dimension
        HTTPException: With status code 500 if:
            - CSV or NetCDF files cannot be read
            - Data extraction or interpolation fails
            - Output ZIP creation fails
    """
    try:
        import xarray as xr
        from dateutil.parser import parse as parse_date
        from utils.era5_handler import safe_open_dataset
        
        csv_path = Path(tempfile.gettempdir()) / f"temp_{csv_file.filename}"
        nc_path = Path(tempfile.gettempdir()) / f"temp_{nc_file.filename}"
        
        with open(csv_path, "wb") as f:
            f.write(await csv_file.read())
        with open(nc_path, "wb") as f:
            f.write(await nc_file.read())
            
        df = pd.read_csv(csv_path)
        ds = safe_open_dataset(str(nc_path))
        
        pwv_var = 'tcwv' if 'tcwv' in ds else ('total_column_water_vapour' if 'total_column_water_vapour' in ds else None)
        t_var = 't2m' if 't2m' in ds else ('temperature' if 'temperature' in ds else None)
        time_var = 'time' if 'time' in ds else ('valid_time' if 'valid_time' in ds else None)
        
        if not pwv_var:
            raise HTTPException(status_code=400, detail="El archivo ERA5 proporcionado no contiene la variable 'Vapor de agua en toda la columna'")
        
        if not t_var:
            raise HTTPException(status_code=400, detail="El archivo ERA5 proporcionado no contiene la variable de 'Temperatura'")
            
        if not time_var:
            raise HTTPException(status_code=400, detail="El archivo ERA5 proporcionado no contiene una dimensión de tiempo válida")
        
        lon_var = [d for d in ds.dims if 'lon' in d.lower()][0]
        lat_var = [d for d in ds.dims if 'lat' in d.lower()][0]

        # Convert longitudes from 0-360 to -180+180 range for compatibility with CSV coordinates
        # Formula: lon_normalized = ((lon + 180) % 360) - 180
        if ds[lon_var].max() > 180:
            ds = ds.assign_coords(**{lon_var: (((ds[lon_var] + 180) % 360) - 180)})
            ds = ds.sortby(lon_var)
            
        start_dt = parse_date(start_date)
        end_dt = parse_date(end_date)
        
        times = pd.to_datetime(ds[time_var].values)
        
        def nearest_idx(target_dt):
            return np.argmin(np.abs(times - target_dt))
            
        idx_start = nearest_idx(start_dt)
        idx_end = nearest_idx(end_dt)
        
        ds_start = ds.isel({time_var: idx_start})
        ds_end = ds.isel({time_var: idx_end})
        
        lats_csv = xr.DataArray(df['Latitud'], dims='points')
        lons_csv = xr.DataArray(df['Longitud'], dims='points')

        # Extract water vapor (PWV) values from ERA5 at initial and final dates
        #using nearest neighbor interpolation at each CSV coordinate point
        pwv_start = ds_start[pwv_var].sel({lat_var: lats_csv, lon_var: lons_csv}, method='nearest').values
        pwv_end = ds_end[pwv_var].sel({lat_var: lats_csv, lon_var: lons_csv}, method='nearest').values
        
        t_start = ds_start[t_var].sel({lat_var: lats_csv, lon_var: lons_csv}, method='nearest').values
        t_end = ds_end[t_var].sel({lat_var: lats_csv, lon_var: lons_csv}, method='nearest').values
        
        delta_pwv = np.nan_to_num(pwv_end - pwv_start, nan=0.0)
        delta_t = np.nan_to_num(t_end - t_start, nan=0.0)
        
        # Calculate tropospheric error using Bevis & Brown (1987) empirical model
        # error_tropo (mm) = 0.238 * Δ(PWV) + 0.035 * Δ(T)
        # where PWV is water vapor (kg/m²) and T is temperature (K)
        # This error is subtracted from SAR deformation to isolate true ground motion
        error_tropo = 0.238 * delta_pwv + 0.035 * delta_t
        
        df['Deformacion_mm'] = df['Deformacion_mm'] - error_tropo
        df['Desplazamiento_m'] = df['Deformacion_mm'] / 1000.0
        
        wavelength_m = 0.055465763  # Sentinel-1 wavelength in meters

        #Convert InSAR phase to physical displacement
        df['Fase'] = - df['Desplazamiento_m'] * (4 * math.pi) / wavelength_m
        
        df['Deformacion_mm'] = df['Deformacion_mm'].round(4)
        df['Desplazamiento_m'] = df['Desplazamiento_m'].round(6)
        df['Fase'] = df['Fase'].round(4)
        
        out_csv_path = Path(tempfile.gettempdir()) / f"filtered_{csv_file.filename}"
        df.to_csv(out_csv_path, index=False)
        
        step = max(1, len(df) // 100)
        ui_sample = []
        for i in range(0, len(df), step):
            if len(ui_sample) >= 100:
                break
            ui_sample.append({
                "lat": float(df.iloc[i]['Latitud']),
                "lon": float(df.iloc[i]['Longitud']),
                "def": float(df.iloc[i]['Deformacion_mm'])
            })
            
        result_zip_path = Path(tempfile.gettempdir()) / f"filtered_result.zip"
        with zipfile.ZipFile(result_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            zipf.write(out_csv_path, f"filtered_{csv_file.filename}")
            
            ui_json_path = Path(tempfile.gettempdir()) / "ui_data.json"
            with open(ui_json_path, 'w') as jf:
                json.dump({
                    "sample": ui_sample, 
                    "dias": (end_dt - start_dt).days, 
                    "start_date": start_date, 
                    "end_date": end_date
                }, jf)
            zipf.write(ui_json_path, "ui_data.json")
            
        ds.close()
        
        return FileResponse(result_zip_path, media_type="application/zip", filename="filtered_result.zip")
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
