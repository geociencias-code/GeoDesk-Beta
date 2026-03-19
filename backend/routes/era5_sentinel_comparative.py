from fastapi import APIRouter, UploadFile, File, HTTPException
import os
import zipfile
import tempfile
import numpy as np
import matplotlib.pyplot as plt
import xarray as xr
import rasterio
from pathlib import Path
from typing import List
from datetime import datetime
import cv2
import pandas as pd

from utils.file_handling import extract_zip, find_rasters

router = APIRouter()

OUT_DIR = Path("resultados_comparativa")

def get_closest_time_indices(ds_times, start_date: datetime, end_date: datetime):
    # Encontrar índices que caigan dentro del rango
    start_dt = np.datetime64(start_date.date())
    end_dt = np.datetime64(end_date.date())
    
    indices = []
    for i, t in enumerate(ds_times):
        try:
            dt = np.datetime64(t).astype("datetime64[D]")
            if start_dt <= dt <= end_dt:
                indices.append(i)
        except Exception:
            pass
    return indices

def extract_dates_from_filename(filename: str):
    import re
    # Buscar formato YYYYMMDD
    matches = re.finditer(r"(20\d{2})([01]\d)([0-3]\d)", filename)
    dates = []
    for m in matches:
        y, mo, d = m.groups()
        dates.append(datetime(int(y), int(mo), int(d)))
    
    if len(dates) >= 2:
        return dates[0], dates[1]
    elif len(dates) == 1:
        return dates[0], dates[0]
    return datetime.now(), datetime.now()  # fallback

@router.post("/api/v1/era5_sentinel_comparative")
async def process_era5_sentinel(nc_file: UploadFile = File(...), zip_files: List[UploadFile] = File(...)):
    OUT_DIR.mkdir(exist_ok=True)
    
    # Limpiar resultados anteriores
    for f in OUT_DIR.glob("*.png"):
        f.unlink(missing_ok=True)

    # 1. Guardar y abrir el archivo .nc de ERA5
    tmp_nc = tempfile.NamedTemporaryFile(delete=False, suffix=".nc")
    try:
        from utils.era5_handler import safe_open_dataset
        content = await nc_file.read()
        tmp_nc.write(content)
        tmp_nc.close()
        ds = safe_open_dataset(tmp_nc.name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error leyendo archivo .nc: {e}")

    tvar = next((v for v in ["t2m", "temperature", "air_temperature"] if v in ds), None)
    if not tvar:
         raise HTTPException(status_code=400, detail="El archivo .nc no contiene variable de temperatura (t2m).")
         
    t10_var = next((v for v in ["skt", "skin_temperature", "t10m", "10m_temperature"] if v in ds), None)
    tcwv_var = next((v for v in ["tcwv", "total_column_water_vapour"] if v in ds), None)
    d2m_var = next((v for v in ["d2m", "2m_dewpoint_temperature"] if v in ds), None)
    
    time_var = next((cand for cand in ["time", "valid_time", "times"] if cand in ds), None)
            
    if not time_var:
        raise HTTPException(status_code=400, detail="El archivo .nc no tiene variable temporal 'time' ni 'valid_time'.")

    ds_times = ds[time_var].values
    
    resultados = []

    # 2. Procesar cada archivo .zip de Sentinel
    temp_root = Path(tempfile.mkdtemp())
    
    for zip_idx, zf in enumerate(zip_files):
        try:
            z_path = temp_root / f"temp_{zip_idx}.zip"
            with open(z_path, "wb") as f:
                f.write(await zf.read())
                
            extract_zip(z_path, temp_root / f"extracted_{zip_idx}")
            rasters = find_rasters(temp_root / f"extracted_{zip_idx}")
            
            if not rasters:
                continue
                
            for tif_path in rasters:
                # Filtrar solo Amplitud y Deformación (Fase)
                if not (tif_path.name.endswith('amp.tif') or tif_path.name.endswith('unw_phase.tif')):
                    continue
                
                layer_type = "Amplitud" if tif_path.name.endswith('amp.tif') else "Fase (Deformación)"
                
                # Extraer la fechas de inicio y fin del nombre del archivo TIFF
                start_date, end_date = extract_dates_from_filename(tif_path.name)
                
                # Encontrar el rango temporal correpondiente en ERA5
                time_indices = get_closest_time_indices(ds_times, start_date, end_date)
                
                # Leer el raster de Sentinel
                with rasterio.open(tif_path) as src:
                    sentinel_data = src.read(1).astype(float)
                    # Normalizar Sentinel de 0 a 1 para mejor visualización base
                    s_min, s_max = np.nanmin(sentinel_data), np.nanmax(sentinel_data)
                    if s_max > s_min:
                        sentinel_norm = (sentinel_data - s_min) / (s_max - s_min)
                    else:
                        sentinel_norm = np.zeros_like(sentinel_data)
                
                target_shape = sentinel_data.shape
                
                def extract_and_reproject(var_name):
                    if not var_name or var_name not in ds:
                        return None
                    if time_indices:
                        # Promedio temporal por píxel dentro del rango
                        slice_data = ds[var_name].isel({time_var: time_indices}).mean(dim=time_var).values.astype(np.float32)
                    else:
                        # Fallback si no hay match de fecha, usar la media temporal de todo el dataset
                        slice_data = ds[var_name].mean(dim=time_var).values.astype(np.float32)
                        
                    reprojected = np.full(target_shape, np.nan, dtype=np.float32)
                    
                    lons = ds[ds[var_name].dims[-1]].values
                    lats = ds[ds[var_name].dims[-2]].values
                    
                    dlon = (lons[-1] - lons[0]) / (len(lons) - 1) if len(lons) > 1 else 0.1
                    dlat = (lats[-1] - lats[0]) / (len(lats) - 1) if len(lats) > 1 else -0.1
                    
                    from rasterio.transform import Affine
                    from rasterio.warp import reproject, Resampling
                    
                    transform = Affine.translation(lons[0] - dlon/2, lats[0] - dlat/2) * Affine.scale(dlon, dlat)
                    
                    reproject(
                        source=slice_data,
                        destination=reprojected,
                        src_transform=transform,
                        src_crs="EPSG:4326",
                        dst_transform=src.transform,
                        dst_crs=src.crs,
                        src_nodata=np.nan,
                        dst_nodata=np.nan,
                        resampling=Resampling.cubic
                    )
                    return reprojected

                era5_reprojected = extract_and_reproject(tvar)
                t10_reprojected = extract_and_reproject(t10_var)
                tcwv_reprojected = extract_and_reproject(tcwv_var)
                d2m_reprojected = extract_and_reproject(d2m_var)
                
                # Crear máscara para las áreas sin datos (NaN o ceros en los bordes) en Sentinel
                valid_mask = ~np.isnan(sentinel_data) & (sentinel_data != 0)
                
                # Aplicar la máscara a los datos ERA5 re-proyectados y convertir a Celsius
                era5_masked_celsius = np.where(valid_mask, era5_reprojected - 273.15, np.nan)
                
                # Convertir a Celsius el promedio general para UI
                with np.errstate(invalid='ignore'):
                    mean_val = np.nanmean(era5_reprojected)
                temp_promedio = float(mean_val) - 273.15 if not np.isnan(mean_val) else 0.0
                disp_min = float(s_min)
                disp_max = float(s_max)
                
                # Crear la imagen compuesta
                plt.figure(figsize=(10, 8), dpi=150)
                
                # Mostrar Sentinel en escala de grises (base de alta resolución)
                # Ponemos NaN transparentes
                sentinel_disp = np.where(valid_mask, sentinel_norm, np.nan)
                plt.imshow(sentinel_disp, cmap='gray', extent=[0, target_shape[1], 0, target_shape[0]])
                
                # Superponer ERA5 como mapa de calor (Heatmap) con alpha
                # Al tener NaNs, matplotlib no pintará esas esquinas/cuadros
                heatmap = plt.imshow(era5_masked_celsius, cmap='jet', alpha=0.4, extent=[0, target_shape[1], 0, target_shape[0]])
                
                # Agregar barra de color para la temperatura
                cbar = plt.colorbar(heatmap, fraction=0.046, pad=0.04)
                cbar.set_label("ERA5 Temperature (°C) / Heatmap Overlay", rotation=270, labelpad=15, color='white')
                cbar.ax.yaxis.set_tick_params(color='white', labelcolor='white')
                
                plt.title(f"Alineación Espacio-Temporal:\nSentinel Base [Capa: {layer_type}] + ERA5 Heatmap ({start_date.strftime('%Y-%m-%d')} a {end_date.strftime('%Y-%m-%d')})", fontsize=14, fontweight='bold', color='white')
                plt.axis('off')
                plt.tight_layout()
                
                out_filename = f"comparativa_{len(resultados)}.png"
                out_filepath = OUT_DIR / out_filename
                plt.savefig(out_filepath, bbox_inches='tight', transparent=True)
                plt.close()
                
                # Generar datos tabulares con downsampling
                downsample_factor = max(1, min(target_shape[0]//50, 100)) # aprox 50x50 puntos
                
                downsample_y = np.arange(0, target_shape[0], downsample_factor)
                downsample_x = np.arange(0, target_shape[1], downsample_factor)
                
                csv_data = []
                transform = src.transform
                
                from pyproj import Transformer
                transformer = Transformer.from_crs(src.crs, "EPSG:4326", always_xy=True)
                
                era5_min_val = np.nanmin(era5_masked_celsius)
                era5_max_val = np.nanmax(era5_masked_celsius)
                temp_range = max(1e-5, float(era5_max_val - era5_min_val))
                
                for r in downsample_y:
                    for c in downsample_x:
                        s_val = sentinel_data[r, c]
                        e_val = era5_masked_celsius[r, c]
                        
                        if np.isnan(e_val) or np.isnan(s_val) or s_val == 0:
                            continue
                            
                        x_coord, y_coord = transform * (c, r)
                        lon, lat = transformer.transform(x_coord, y_coord)
                        
                        error_factor = ((e_val - era5_min_val) / temp_range) * 100.0
                        
                        # Calculate components for current pixel
                        temp_10m = float(t10_reprojected[r, c]) - 273.15 if t10_reprojected is not None and not np.isnan(t10_reprojected[r, c]) else None
                        tcwv = float(tcwv_reprojected[r, c]) if tcwv_reprojected is not None and not np.isnan(tcwv_reprojected[r, c]) else None
                        
                        # RH Calculation
                        rh = None
                        if d2m_reprojected is not None and not np.isnan(d2m_reprojected[r, c]):
                            T_c = e_val
                            Td_c = float(d2m_reprojected[r, c]) - 273.15
                            # Magnus formula for RH
                            numerator = np.exp((17.625 * Td_c) / (243.04 + Td_c))
                            denominator = np.exp((17.625 * T_c) / (243.04 + T_c))
                            rh = 100.0 * (numerator / denominator)
                        
                        row_data = {
                            "Latitud": round(lat, 5),
                            "Longitud": round(lon, 5),
                            "Valor_Sentinel": round(float(s_val), 4),
                            "Temp_2m_ERA5_(C)": round(float(e_val), 2),
                            "Temp_10m_ERA5_(C)": round(temp_10m, 2) if temp_10m is not None else "N/A",
                            "Vapor_Agua_(mm)": round(tcwv, 2) if tcwv is not None else "N/A",
                            "Humedad_Relativa_(%)": round(rh, 2) if rh is not None else "N/A",
                            "Factor_Error_(%)": round(float(error_factor), 2)
                        }
                        csv_data.append(row_data)
                
                df = pd.DataFrame(csv_data)
                csv_filename = f"datos_{len(resultados)}.csv"
                csv_filepath = OUT_DIR / csv_filename
                df.to_csv(csv_filepath, index=False)
                
                data_preview = df.head(100).to_dict('records')
                
                resultados.append({
                    "fecha": f"{start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}",
                    "disp_min": disp_min,
                    "disp_max": disp_max,
                    "temp_promedio": temp_promedio,
                    "img_url": f"resultados_comparativa/{out_filename}",
                    "csv_url": f"resultados_comparativa/{csv_filename}",
                    "data_preview": data_preview
                })
                
        except Exception as e:
            print(f"Error procesando zip {zf.filename}: {e}")
            continue

    # Limpiar archivo temporal .nc
    try:
        os.unlink(tmp_nc.name)
    except:
        pass

    if not resultados:
        raise HTTPException(status_code=400, detail="No se pudo procesar ninguna imagen válida de los archivos subidos.")

    # Ordenar resultados por fecha
    resultados.sort(key=lambda x: x["fecha"])
    return {"ok": True, "resultados": resultados}
