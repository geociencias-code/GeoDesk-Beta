# backend/processing/temperatura_deformacion.py
import os
import zipfile
import tempfile
import math
import re
import numpy as np
import matplotlib.pyplot as plt
from netCDF4 import Dataset, num2date
import rasterio
from rasterio.warp import transform_bounds
from datetime import datetime
from typing import List, Tuple, Optional

# -----------------------------------------------------------
# UTILIDADES
# -----------------------------------------------------------

def _safe_print(*args, **kwargs):
    # wrapper para debugging en el servidor
    print("[temp-deform]", *args, **kwargs)

def resample_array_to_shape(arr: np.ndarray, target_shape: Tuple[int, int]) -> np.ndarray:
    """
    Re-muestrea (de manera simple, por repetición) `arr` a `target_shape`.
    Evita depender de scipy; es una aproximación rápida.
    """
    if arr.ndim != 2:
        raise ValueError("resample_array_to_shape espera un array 2D")

    src_h, src_w = arr.shape
    tgt_h, tgt_w = target_shape

    if src_h == tgt_h and src_w == tgt_w:
        return arr

    # factores de repetición (usar ceil para cubrir tamaño)
    fh = math.ceil(tgt_h / src_h)
    fw = math.ceil(tgt_w / src_w)

    arr_rep = np.repeat(np.repeat(arr, fh, axis=0), fw, axis=1)

    # recortar al tamaño objetivo
    return arr_rep[:tgt_h, :tgt_w]

# -----------------------------------------------------------
# FUNCIONES PRINCIPALES
# -----------------------------------------------------------

def leer_nc_var(nc_path: str):
    """
    Lee archivo .nc y extrae:
      - t2m (expected shape: time, y, x) o similar
      - tiempo (lista de datetimes)
      - lat/lon arrays
    """
    ds = Dataset(nc_path)
    # leer variables con tolerancia a nombres distintos
    var_names = {v.lower(): v for v in ds.variables.keys()}

    # temperatura (buscar 't2m' o 'temperature' o 'air_temperature')
    tvar = None
    for cand in ("t2m", "temperature", "air_temperature", "t2m_k"):
        if cand in var_names:
            tvar = var_names[cand]
            break
    if tvar is None:
        # fallback: elegir primera variable con 3 dimensiones
        for v in ds.variables:
            if getattr(ds.variables[v], 'ndim', 0) == 3:
                tvar = v
                break
    if tvar is None:
        raise ValueError("No se encontró variable de temperatura (t2m) en el .nc")

    t2m = ds.variables[tvar][:]
    _safe_print(f"Variable temperatura detectada: {tvar}, shape={t2m.shape}")

    # tiempo
    time_var = None
    for cand in ("valid_time", "time", "times"):
        if cand in var_names:
            time_var = var_names[cand]
            break
    if time_var is None:
        # fallback: buscar primera variable 1D con nombre que contenga 'time'
        for v in ds.variables:
            if 'time' in v.lower():
                time_var = v
                break
    if time_var is None:
        raise ValueError("No se encontró variable de tiempo en el .nc")

    time_obj = ds.variables[time_var]
    # intentar convertir a datetimes con units
    try:
        if hasattr(time_obj, "units"):
            tiempo = num2date(time_obj[:], units=time_obj.units)
            tiempo = [datetime(t.year, t.month, t.day, t.hour, t.minute, t.second) for t in tiempo]
        else:
            # fallback: asumir timestamps unix en segundos
            tiempo = [datetime.utcfromtimestamp(int(t)) for t in time_obj[:]]
    except Exception as e:
        _safe_print("Error convirtiendo tiempos del .nc con num2date:", e)
        # intentar fallback de igual forma
        try:
            tiempo = [datetime.utcfromtimestamp(int(t)) for t in time_obj[:]]
        except Exception as e2:
            raise ValueError("No se pudo interpretar variable de tiempo del .nc") from e2

    # lat / lon
    lat = None
    lon = None
    for cand in ("lat", "latitude", "y"):
        if cand in var_names:
            lat = ds.variables[var_names[cand]][:]
            break
    for cand in ("lon", "longitude", "x"):
        if cand in var_names:
            lon = ds.variables[var_names[cand]][:]
            break
    if lat is None or lon is None:
        _safe_print("Advertencia: no se encontraron lat/lon explícitos en el .nc (se usará bounding box si es necesario)")

    return t2m, tiempo, lat, lon

def extraer_fecha_de_zip(nombre_zip: str) -> Optional[datetime]:
    """
    Extrae fecha del nombre del ZIP si está en formatos comunes:
      - dd_mm_YYYY, dd-mm-YYYY, ddmmYYYY
      - YYYY_mm_dd
      - o grupos de 8 dígitos (YYYYMMDD)
    Devuelve datetime con hora 00:00
    """
    name = os.path.basename(nombre_zip)
    name = name.replace(".zip", "")

    # buscar YYYYMMDD
    m = re.search(r"(20\d{2})([01]\d)([0-3]\d)", name)
    if m:
        y, mo, d = m.groups()
        try:
            return datetime(int(y), int(mo), int(d))
        except:
            pass

    # buscar dd_mm_YYYY o dd-mm-YYYY
    m = re.search(r"([0-3]\d)[-_]([01]\d)[-_](20\d{2})", name)
    if m:
        d, mo, y = m.groups()
        try:
            return datetime(int(y), int(mo), int(d))
        except:
            pass

    # buscar YYYY_MM_DD
    m = re.search(r"(20\d{2})[_\-]?([01]\d)[_\-]?([0-3]\d)", name)
    if m:
        y, mo, d = m.groups()
        try:
            return datetime(int(y), int(mo), int(d))
        except:
            pass

    return None

def leer_displacement_zip(zip_path: str) -> Tuple[np.ndarray, Tuple[float, float, float, float]]:
    """
    Descomprime temporalmente y busca archivo tiff de desplazamiento LOS.
    Devuelve:
      - array de desplazamiento (2D)
      - bounds geográficos del raster (left, bottom, right, top)
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(tmpdir)

        # Buscar archivos .tif en extraídos
        tiff_candidates = []
        for root, _, files in os.walk(tmpdir):
            for f in files:
                if f.lower().endswith((".tif", ".tiff")):
                    tiff_candidates.append(os.path.join(root, f))

        if not tiff_candidates:
            raise ValueError("No se encontraron archivos .tif dentro del ZIP.")

        # Priorizar archivos que parezcan contener desplazamiento/los/velocity
        priority_keywords = ("los", "disp", "displ", "velocity", "vlos", "velocity")
        chosen = None
        for p in tiff_candidates:
            name = os.path.basename(p).lower()
            if any(k in name for k in priority_keywords):
                chosen = p
                break

        # si no encontramos por prioridad, tomar el primero disponible
        if chosen is None:
            chosen = tiff_candidates[0]
            _safe_print("Advertencia: no se encontró un TIFF claramente identificado como 'displacement'—usando el primero encontrado:", chosen)

        # Leer raster
        try:
            with rasterio.open(chosen) as src:
                disp = src.read(1).astype(float)
                bounds = src.bounds  # left, bottom, right, top (Affine coords)
        except Exception as e:
            raise ValueError(f"Error leyendo raster {chosen}: {e}")

        return disp, (bounds.left, bounds.bottom, bounds.right, bounds.top)

def verificar_region(bounds_zip: Tuple[float, float, float, float], lat, lon, tol_deg: float = 0.5) -> bool:
    """
    Verifica si la región del ZIP (bounds) coincide con la del .nc (lat/lon).
    Permite tolerancia en grados (tol_deg).
    bounds_zip: (left, bottom, right, top)
    lat/lon pueden ser None — si no existen, no hacemos la verificación estricta.
    """
    if lat is None or lon is None:
        _safe_print("Lat/lon no disponibles en el .nc; se omite verificación espacial.")
        return True

    nc_min_lat, nc_max_lat = float(np.min(lat)), float(np.max(lat))
    nc_min_lon, nc_max_lon = float(np.min(lon)), float(np.max(lon))

    z_min_lon, z_min_lat, z_max_lon, z_max_lat = bounds_zip

    # aplicar tolerancia
    if (z_max_lat < nc_min_lat - tol_deg or z_min_lat > nc_max_lat + tol_deg or
        z_max_lon < nc_min_lon - tol_deg or z_min_lon > nc_max_lon + tol_deg):
        return False

    return True

def graficar_comparacion(fecha: str, disp: np.ndarray, t2m_slice: np.ndarray, out_path: str,
                         escala_disp: Tuple[float, float], escala_temp: Tuple[float, float]):
    """
    Genera un gráfico combinando desplazamiento LOS y temperatura.
    Guardar PNG en out_path.
    """
    try:
        # Asegurar que t2m_slice sea 2D
        if t2m_slice.ndim != 2:
            raise ValueError("t2m_slice no es 2D")

        # Si las formas difieren, re-muestrear la temperatura a la forma del desplazamiento
        if t2m_slice.shape != disp.shape:
            _safe_print(f"Resampleando temperatura {t2m_slice.shape} -> {disp.shape}")
            t2m_display = resample_array_to_shape(t2m_slice, disp.shape)
        else:
            t2m_display = t2m_slice

        plt.figure(figsize=(12,6))

        ax1 = plt.subplot(1,2,1)
        ax1.set_title(f"Desplazamiento LOS ({fecha})")
        im1 = ax1.imshow(disp, vmin=escala_disp[0], vmax=escala_disp[1])
        cbar1 = plt.colorbar(im1, ax=ax1, fraction=0.046, pad=0.04)
        cbar1.set_label("mm")

        ax2 = plt.subplot(1,2,2)
        ax2.set_title(f"Temperatura 2m ({fecha})")
        im2 = ax2.imshow(t2m_display, vmin=escala_temp[0], vmax=escala_temp[1])
        cbar2 = plt.colorbar(im2, ax=ax2, fraction=0.046, pad=0.04)
        cbar2.set_label("Kelvin")

        plt.tight_layout()
        # asegurar carpeta destino
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        plt.savefig(out_path, dpi=150)
        plt.close()
        _safe_print("Imagen guardada:", out_path)
    except Exception as e:
        raise RuntimeError(f"Error generando figura para {fecha}: {e}")

# -----------------------------------------------------------
# PROCESAMIENTO GENERAL
# -----------------------------------------------------------

def procesar_zip_y_nc(nc_path: str, zip_paths: List[str], output_dir: str = "temperatura_deformacion"):
    os.makedirs(output_dir, exist_ok=True)

    # Leer NC
    try:
        t2m, tiempo, lat, lon = leer_nc_var(nc_path)
    except Exception as e:
        raise RuntimeError(f"Error leyendo .nc: {e}")

    # Determinar escalas globales de temperatura (en caso de ser necesarias)
    temp_min, temp_max = float(np.nanmin(t2m)), float(np.nanmax(t2m))

    report = []

    for zip_path in zip_paths:
        try:
            _safe_print("Procesando ZIP:", zip_path)
            fecha_zip = extraer_fecha_de_zip(os.path.basename(zip_path))
            if fecha_zip is None:
                _safe_print("No se pudo extraer fecha del ZIP:", zip_path)
                continue

            disp, bounds = leer_displacement_zip(zip_path)

            # Validar región (permite omitir si lat/lon no existen)
            if not verificar_region(bounds, lat, lon):
                raise ValueError(f"Regiones incompatibles entre {zip_path} y el .nc")

            # Buscar fecha en NC — coincidencia por día (no por hora)
            idx = None
            for i, t in enumerate(tiempo):
                try:
                    if isinstance(t, datetime):
                        fecha_nc = t
                    else:
                        fecha_nc = datetime.utcfromtimestamp(int(t))
                except Exception:
                    # si t ya es tipo numpy.datetime64 u otro, convertir con strptime fallback
                    try:
                        fecha_nc = datetime.strptime(str(t), "%Y-%m-%dT%H:%M:%S")
                    except Exception:
                        fecha_nc = None

                if fecha_nc is None:
                    continue

                if fecha_nc.date() == fecha_zip.date():
                    idx = i
                    break

            if idx is None:
                _safe_print(f"No se encontró fecha equivalente en el .nc para {fecha_zip.strftime('%Y-%m-%d')}")
                continue

            # extraer slice de t2m
            try:
                t2m_slice = t2m[idx]
            except Exception as e:
                raise RuntimeError(f"No se pudo extraer slice de t2m para index {idx}: {e}")

            # Determinar escala de desplazamiento
            disp_min = float(np.nanmin(disp))
            disp_max = float(np.nanmax(disp))

            out_img = os.path.join(output_dir, f"graph_{fecha_zip.strftime('%d-%m-%Y')}.png")
            graficar_comparacion(
                fecha_zip.strftime("%d-%m-%Y"),
                disp,
                t2m_slice,
                out_img,
                (disp_min, disp_max),
                (temp_min, temp_max)
            )

            report.append({
                "fecha": fecha_zip.strftime("%d-%m-%Y"),
                "disp_min": disp_min,
                "disp_max": disp_max,
                "temp_promedio": float(np.nanmean(t2m_slice))
            })

        except Exception as e:
            _safe_print(f"ERROR procesando {zip_path}: {e}")
            # continuar con el siguiente ZIP en lugar de abortar todo
            continue

    # ordenar report por fecha
    try:
        report_sorted = sorted(report, key=lambda r: datetime.strptime(r["fecha"], "%d-%m-%Y"))
    except Exception:
        report_sorted = report

    return report_sorted
