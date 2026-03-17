import os
import shutil
import uuid
import numpy as np
import xarray as xr
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, HTTPException
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import cartopy.crs as ccrs
import cartopy.feature as cfeature


# ======================================================
# CONFIGURACIÓN BASE
# ======================================================
router = APIRouter()
CARPETA_TEMPORAL = "temporal_nc"
os.makedirs(CARPETA_TEMPORAL, exist_ok=True)


# ======================================================
# FUNCIÓN PRINCIPAL
# ======================================================
@router.post("/procesar_nc")
async def procesar_nc(file: UploadFile = File(...)):
    """
    Procesa un archivo .nc, genera visualizaciones (cada ~12 días)
    y devuelve las rutas de las imágenes generadas.
    """
    try:
        # ----------------------------
        # 1. Limpiar carpeta temporal
        # ----------------------------
        if os.path.exists(CARPETA_TEMPORAL):
            shutil.rmtree(CARPETA_TEMPORAL)
        os.makedirs(CARPETA_TEMPORAL, exist_ok=True)

        # ----------------------------
        # 2. Guardar archivo subido
        # ----------------------------
        filename = file.filename
        if not filename.endswith(".nc"):
            raise HTTPException(status_code=400, detail="El archivo debe tener extensión .nc")

        ruta_local = os.path.join(CARPETA_TEMPORAL, filename)
        with open(ruta_local, "wb") as f:
            contenido = await file.read()
            f.write(contenido)

        # ----------------------------
        # 3. Cargar con xarray
        # ----------------------------
        from utils.era5_handler import safe_open_dataset
        dataset = safe_open_dataset(str(ruta_local))

        # Buscar variable principal (t2m o similar)
        var_nombre = None
        for v in ["t2m", "temperature", "temp"]:
            if v in dataset:
                var_nombre = v
                break

        if var_nombre is None:
            raise HTTPException(status_code=400, detail="No se encontró variable de temperatura ('t2m', 'temperature', 'temp').")

        temp_c = dataset[var_nombre] - 273.15  # Conversión a °C

        # ----------------------------
        # 4. Detectar dimensión temporal
        # ----------------------------
        if "time" in temp_c.dims:
            dim_tiempo = "time"
        elif "valid_time" in temp_c.dims:
            dim_tiempo = "valid_time"
        elif "forecast_reference_time" in temp_c.dims:
            dim_tiempo = "forecast_reference_time"
        else:
            raise HTTPException(status_code=400, detail="No se detectó ninguna dimensión temporal ('time', 'valid_time', 'forecast_reference_time').")

        fechas = np.array(dataset[dim_tiempo].values)
        fechas_dt = sorted(list(set(np.datetime_as_string(fechas, unit="D"))))
        if len(fechas_dt) == 0:
            raise HTTPException(status_code=400, detail="No se detectaron fechas en el archivo.")

        # ----------------------------
        # 5. Muestreo (una cada 12 días aprox)
        # ----------------------------
        fechas_muestreadas = fechas_dt[::12] if len(fechas_dt) >= 12 else fechas_dt

        # ----------------------------
        # 6. Detectar coordenadas
        # ----------------------------
        lat_name = "latitude" if "latitude" in temp_c.dims else "lat"
        lon_name = "longitude" if "longitude" in temp_c.dims else "lon"

        if lat_name not in temp_c.dims or lon_name not in temp_c.dims:
            raise HTTPException(status_code=400, detail="No se detectaron dimensiones de latitud/longitud en el dataset.")

        # ----------------------------
        # 7. Generar imágenes con escala fija 0-50°C
        # ----------------------------
        rutas_imagenes = []
        vmin_global = 0.0
        vmax_global = 50.0

        for fecha_str in fechas_muestreadas:
            indices = np.where(np.datetime_as_string(fechas, unit="D") == fecha_str)[0]
            if len(indices) == 0:
                continue

            # Promedio sobre la dimensión temporal seleccionada
            temp_prom = temp_c.isel({dim_tiempo: indices}).mean(dim=dim_tiempo)

            fig = plt.figure(figsize=(8, 6))
            ax = plt.axes(projection=ccrs.PlateCarree())

            latitudes = temp_prom[lat_name].values
            longitudes = temp_prom[lon_name].values

            ax.set_extent([
                float(np.min(longitudes)),
                float(np.max(longitudes)),
                float(np.min(latitudes)),
                float(np.max(latitudes))
            ], crs=ccrs.PlateCarree())

            im = ax.pcolormesh(
                longitudes,
                latitudes,
                temp_prom,
                cmap="inferno",
                shading="auto",
                vmin=vmin_global,
                vmax=vmax_global,
                transform=ccrs.PlateCarree()
            )

            ax.coastlines()
            ax.add_feature(cfeature.BORDERS, linestyle=':')
            ax.add_feature(cfeature.LAND, facecolor='lightgray')
            ax.add_feature(cfeature.LAKES, alpha=0.4)
            ax.add_feature(cfeature.RIVERS, edgecolor='blue', alpha=0.4)
            ax.gridlines(draw_labels=True)
            ax.set_title(f"Temperatura media - {fecha_str}", fontsize=10)
            plt.colorbar(im, ax=ax, orientation="vertical", label="°C")

            nombre_png = f"mapa_{fecha_str}_{uuid.uuid4().hex[:6]}.png"
            ruta_png = os.path.join(CARPETA_TEMPORAL, nombre_png)
            plt.savefig(ruta_png, bbox_inches="tight", dpi=150)
            plt.close(fig)

            rutas_imagenes.append(ruta_png.replace("\\", "/"))


        return {"fechas": fechas_muestreadas, "imagenes": rutas_imagenes}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error procesando el archivo: {str(e)}")
