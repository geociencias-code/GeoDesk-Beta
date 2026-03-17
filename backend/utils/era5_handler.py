"""
Utilidades para manejar archivos ERA5 en diferentes formatos
"""
import tempfile
import os
import xarray as xr
import zipfile


def detect_file_format(file_path: str) -> str:
    """
    Detecta el formato real del archivo (ZIP, NetCDF, HDF5, GRIB, etc.)
    """
    try:
        with open(file_path, 'rb') as f:
            header = f.read(8)
        
        print(f"[DEBUG] Header bytes: {header[:8]}")
        
        # Verificar ZIP
        if header[:2] == b'PK':
            print("[DEBUG] Detectado como ZIP por header PK")
            return 'zip'
        
        # Verificar GRIB
        if header[:4] == b'GRIB':
            print("[DEBUG] Detectado como GRIB por header GRIB")
            return 'grib'
        
        # Verificar NetCDF (HDF5 o NetCDF3)
        if b'HDF' in header:
            print("[DEBUG] Detectado como NetCDF por header HDF")
            return 'netcdf'
        
        if header[:3] == b'CDF':
            print("[DEBUG] Detectado como NetCDF por header CDF")
            return 'netcdf'
        
        return 'unknown'
    except Exception as e:
        print(f"Error detectando formato: {e}")
        return 'unknown'


def extract_netcdf_from_zip(zip_path: str) -> str:
    """
    Extrae el archivo NetCDF de un ZIP de COPERNICUS.
    Retorna la ruta del archivo NetCDF extraído.
    """
    try:
        print(f"[DEBUG] Extrayendo NetCDF del ZIP: {zip_path}")
        
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # Listar archivos en el ZIP
            file_list = zip_ref.namelist()
            print(f"[DEBUG] Archivos en ZIP: {file_list}")
            
            # Buscar archivos .nc o .grib
            nc_files = [f for f in file_list if f.endswith('.nc') or f.endswith('.grib') or f.endswith('.grb')]
            
            if not nc_files:
                raise Exception(f"No se encontraron archivos .nc ni .grib en el ZIP. Archivos: {file_list}")
            
            # Extraer el primer archivo NetCDF
            nc_file = nc_files[0]
            print(f"[DEBUG] Extrayendo: {nc_file}")
            
            # Extraer a un archivo temporal
            temp_nc = tempfile.NamedTemporaryFile(delete=False, suffix='.nc')
            temp_nc_path = temp_nc.name
            temp_nc.close()
            
            # Leer el contenido del ZIP y escribirlo al temp
            with zip_ref.open(nc_file) as source:
                with open(temp_nc_path, 'wb') as target:
                    target.write(source.read())
            
            print(f"[DEBUG] NetCDF extraído a: {temp_nc_path}")
            return temp_nc_path
            
    except Exception as e:
        print(f"[ERROR] Error extrayendo NetCDF del ZIP: {e}")
        raise


def safe_open_dataset(file_path: str, engine: str = 'netcdf4'):
    """
    Abre un dataset ERA5 detectando automáticamente el formato.
    Maneja ZIP, NetCDF, HDF5 y otros formatos.
    """
    # Convertir a ruta absoluta si es relativa
    file_path_abs = os.path.abspath(file_path)
    print(f"[DEBUG] Ruta absoluta: {file_path_abs}")
    print(f"[DEBUG] Archivo existe: {os.path.exists(file_path_abs)}")
    
    if os.path.exists(file_path_abs):
        try:
            file_size = os.path.getsize(file_path_abs)
            print(f"[DEBUG] Tamaño archivo: {file_size} bytes")
        except Exception as e:
            print(f"[DEBUG] Error obteniendo información del archivo: {e}")
    
    # Detectar formato
    file_format = detect_file_format(file_path_abs)
    
    # Si es ZIP, extraer el NetCDF
    if file_format == 'zip':
        print("[DEBUG] Archivo ZIP detectado, extrayendo NetCDF...")
        try:
            file_path_abs = extract_netcdf_from_zip(file_path_abs)
            file_format = detect_file_format(file_path_abs)
            print(f"[DEBUG] Después de extracción, nuevo formato: {file_format}")
        except Exception as e:
            raise Exception(f"Error extrayendo ZIP: {e}")
    
    # Almacenar errores para reportar al final
    errors = {}
    
    # Intentar con netcdf4 primero (más común)
    print("[DEBUG] Intentando abrir con netcdf4...")
    try:
        ds = xr.open_dataset(file_path_abs, engine='netcdf4')
        print("[DEBUG] ✓ Abierto exitosamente con netcdf4")
        return ds
    except Exception as e:
        errors['netcdf4'] = str(e)
        print(f"[DEBUG] netcdf4 falló: {type(e).__name__}")
    
    # Intentar con h5netcdf
    print("[DEBUG] Intentando abrir con h5netcdf...")
    try:
        ds = xr.open_dataset(file_path_abs, engine='h5netcdf')
        print("[DEBUG] ✓ Abierto exitosamente con h5netcdf")
        return ds
    except Exception as e:
        errors['h5netcdf'] = str(e)
        print(f"[DEBUG] h5netcdf falló: {type(e).__name__}")
    
    # Si ningún engine funcionó
    error_msg = f"No se pudo abrir el archivo '{file_path_abs}' con ningún engine disponible.\n"
    error_msg += f"Errores:\n"
    for engine_name, error in errors.items():
        error_msg += f"  • {engine_name}: {error[:100]}\n"
    
    raise Exception(error_msg)

