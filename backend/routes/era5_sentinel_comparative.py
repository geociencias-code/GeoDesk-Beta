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

def get_closest_time_index(ds_times, target_date: datetime):
    # Encontrar la fecha más cercana en el xarray (solo por día)
    for i, t in enumerate(ds_times):
        # Manejar diferentes tipos de tiempo de numpy/pandas
        try:
            # Si es np.datetime64
            dt = np.datetime64(t).astype("datetime64[s]").astype(datetime)
            if dt.date() == target_date.date():
                return i
        except Exception:
            pass
    return None

def extract_date_from_filename(filename: str) -> datetime:
    import re
    # Buscar formato YYYYMMDD
    m = re.search(r"(20\d{2})([01]\d)([0-3]\d)", filename)
    if m:
        y, mo, d = m.groups()
        return datetime(int(y), int(mo), int(d))
    return datetime.now()  # fallback

@router.post("/api/v1/era5_sentinel_comparative")
async def process_era5_sentinel(nc_file: UploadFile = File(...), zip_files: List[UploadFile] = File(...)):
    OUT_DIR.mkdir(exist_ok=True)
    
    # Limpiar resultados anteriores
    for f in OUT_DIR.glob("*.png"):
        f.unlink(missing_ok=True)

    # 1. Guardar y abrir el archivo .nc de ERA5
    tmp_nc = tempfile.NamedTemporaryFile(delete=False, suffix=".nc")
    try:
        content = await nc_file.read()
        tmp_nc.write(content)
        tmp_nc.close()
        ds = xr.open_dataset(tmp_nc.name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error leyendo archivo .nc: {e}")

    # Verificar que exista t2m
    if "t2m" not in ds and "temperature" not in ds and "air_temperature" not in ds:
         raise HTTPException(status_code=400, detail="El archivo .nc no contiene variable de temperatura (t2m).")
         
    tvar = "t2m" if "t2m" in ds else ("temperature" if "temperature" in ds else "air_temperature")
    
    time_var = None
    for cand in ["time", "valid_time", "times"]:
        if cand in ds:
            time_var = cand
            break
            
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
                # Extraer la fecha del nombre del archivo TIFF
                tif_date = extract_date_from_filename(tif_path.name)
                
                # Encontrar el índice temporal correpondiente en ERA5
                time_idx = get_closest_time_index(ds_times, tif_date)
                
                # Leer el raster de Sentinel
                with rasterio.open(tif_path) as src:
                    sentinel_data = src.read(1).astype(float)
                    # Normalizar Sentinel de 0 a 1 para mejor visualización base
                    s_min, s_max = np.nanmin(sentinel_data), np.nanmax(sentinel_data)
                    if s_max > s_min:
                        sentinel_norm = (sentinel_data - s_min) / (s_max - s_min)
                    else:
                        sentinel_norm = np.zeros_like(sentinel_data)
                
                # Extraer datos ERA5
                if time_idx is not None:
                    era5_slice = ds[tvar].isel({time_var: time_idx}).values
                else:
                    # Fallback si no hay match de fecha, usar la media temporal
                    era5_slice = ds[tvar].mean(dim=time_var).values
                
                # Re-muestrear ERA5 (baja resolución) al tamaño de Sentinel (alta resolución)
                target_shape = sentinel_data.shape
                # Interpolación bicúbica usando opencv para un gradiente suave
                era5_resized = cv2.resize(era5_slice, (target_shape[1], target_shape[0]), interpolation=cv2.INTER_CUBIC)
                
                # Crear máscara para las áreas sin datos (NaN o ceros en los bordes) en Sentinel
                valid_mask = ~np.isnan(sentinel_data) & (sentinel_data != 0)
                
                # Aplicar la máscara a los datos ERA5 para que coincidan con la forma irregular del Sentinel
                era5_masked = np.where(valid_mask, era5_resized, np.nan)
                
                # Promedios y estatus
                temp_promedio = float(np.nanmean(era5_resized))
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
                heatmap = plt.imshow(era5_masked, cmap='jet', alpha=0.4, extent=[0, target_shape[1], 0, target_shape[0]])
                
                # Agregar barra de color para la temperatura
                cbar = plt.colorbar(heatmap, fraction=0.046, pad=0.04)
                cbar.set_label("ERA5 Temperature (K) / Heatmap Overlay", rotation=270, labelpad=15)
                
                plt.title(f"Alineación Espacio-Temporal:\nSentinel Base + ERA5 Heatmap ({tif_date.strftime('%Y-%m-%d')})", fontsize=14, fontweight='bold')
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
                
                era5_min_val = np.nanmin(era5_masked)
                era5_max_val = np.nanmax(era5_masked)
                temp_range = max(1e-5, float(era5_max_val - era5_min_val))
                
                for r in downsample_y:
                    for c in downsample_x:
                        s_val = sentinel_data[r, c]
                        e_val = era5_masked[r, c]
                        
                        if np.isnan(e_val) or np.isnan(s_val) or s_val == 0:
                            continue
                            
                        lon, lat = transform * (c, r)
                        
                        # Un factor intuitivo: Asumiendo mayor temperatura genera mayor distorsión atmosférica (o al revés,
                        # normalizado al 100% como un diferencial relativo a los valores del área cargada)
                        error_factor = ((e_val - era5_min_val) / temp_range) * 100.0
                        
                        csv_data.append({
                            "Latitud": round(lat, 5),
                            "Longitud": round(lon, 5),
                            "Valor_Sentinel": round(float(s_val), 4),
                            "Temp_ERA5_(K)": round(float(e_val), 2),
                            "Factor_Error_(%)": round(float(error_factor), 2)
                        })
                
                df = pd.DataFrame(csv_data)
                csv_filename = f"datos_{len(resultados)}.csv"
                csv_filepath = OUT_DIR / csv_filename
                df.to_csv(csv_filepath, index=False)
                
                data_preview = df.head(100).to_dict('records')
                
                resultados.append({
                    "fecha": tif_date.strftime("%Y-%m-%d"),
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
