"""
Script de diagnóstico para archivos ERA5 descargados
"""
import os
import sys
import xarray as xr


def diagnose_file(file_path):
    """Diagnostica un archivo ERA5"""
    print(f"\n{'='*80}")
    print(f"DIAGNÓSTICO DEL ARCHIVO: {file_path}")
    print(f"{'='*80}\n")
    
    # Verificar existencia
    if not os.path.exists(file_path):
        print(f"❌ ERROR: El archivo NO existe: {file_path}")
        return False
    
    print(f"✅ Archivo existe")
    
    # Tamaño
    size = os.path.getsize(file_path)
    print(f"📊 Tamaño: {size} bytes ({size / 1024 / 1024:.2f} MB)")
    
    if size == 0:
        print(f"⚠️  ADVERTENCIA: El archivo está VACÍO (0 bytes)")
        return False
    
    # Tipo de archivo por header
    with open(file_path, 'rb') as f:
        header = f.read(16)
    
    print(f"🔍 Header (primeros 16 bytes): {header[:16]}")
    
    if header[:4] == b'GRIB':
        print("   → Formato: GRIB")
    elif b'HDF' in header:
        print("   → Formato: HDF5/NetCDF4")
    elif header[:3] == b'CDF':
        print("   → Formato: NetCDF3")
    else:
        print("   → Formato: DESCONOCIDO")
    
    # Intentar abrir con xarray
    print("\n🔧 Intentando abrir con xarray...")
    
    for engine in ['netcdf4', 'h5netcdf', 'cfgrib', 'scipy']:
        try:
            ds = xr.open_dataset(file_path, engine=engine)
            print(f"   ✅ {engine}: ÉXITO")
            print(f"\n📋 Dataset info:")
            print(f"   Variables: {list(ds.data_vars)}")
            print(f"   Dimensiones: {dict(ds.dims)}")
            print(f"   Coordenadas: {list(ds.coords)}")
            ds.close()
            return True
        except Exception as e:
            print(f"   ❌ {engine}: {type(e).__name__}: {str(e)[:60]}")
    
    print(f"\n❌ No se pudo abrir el archivo con ningún engine")
    return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python diagnose_era5.py <ruta_archivo>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    success = diagnose_file(file_path)
    sys.exit(0 if success else 1)

