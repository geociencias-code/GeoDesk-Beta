import os
import shutil
import zipfile
import rasterio
import numpy as np
import matplotlib.pyplot as plt
from datetime import datetime
import re
import json
from pathlib import Path
from fastapi import UploadFile, HTTPException
from fastapi.responses import FileResponse

# Variables de configuración
CARPETA_TEMP = "temp_alaska"
CARPETA_RESULTADOS = "resultados"
CARPETA_FASE = os.path.join(CARPETA_RESULTADOS, "fase")
CARPETA_COHERENCIA = os.path.join(CARPETA_RESULTADOS, "coherencia")
CARPETA_ELEVACION = os.path.join(CARPETA_RESULTADOS, "elevacion")
os.makedirs(CARPETA_FASE, exist_ok=True)
os.makedirs(CARPETA_COHERENCIA, exist_ok=True)
os.makedirs(CARPETA_ELEVACION, exist_ok=True)

# Regex para extraer fecha de los nombres de los archivos
DATE_RE = re.compile(r"(\d{8})T\d{6}")

# Funciones auxiliares
def extraer_tifs(ruta_zip, carpeta_destino):
    """Extrae los archivos .tif del ZIP a una carpeta temporal y los copia a la carpeta de destino."""
    temp_dir = os.path.join(carpeta_destino, "temp_extraccion")
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    os.makedirs(temp_dir, exist_ok=True)

    with zipfile.ZipFile(ruta_zip, "r") as zip_ref:
        zip_ref.extractall(temp_dir)

    tifs_extraidos = []
    for root, _, files in os.walk(temp_dir):
        for f in files:
            if f.lower().endswith(".tif"):
                src = os.path.join(root, f)
                dst = os.path.join(carpeta_destino, f)
                shutil.copy2(src, dst)
                tifs_extraidos.append(dst)

    shutil.rmtree(temp_dir)
    return tifs_extraidos

def extraer_fecha(nombre_archivo):
    """Extrae la fecha del nombre del archivo (formato AAAAMMDD)."""
    match = DATE_RE.search(nombre_archivo)
    if match:
        try:
            return datetime.strptime(match.group(1), "%Y%m%d").date()
        except ValueError:
            pass
    return None

def renderizar_imagen(arr, nombre_salida, cmap, vmin, vmax, label):
    """Genera y guarda una imagen PNG desde un arreglo numpy."""
    plt.figure(figsize=(8, 6))
    im = plt.imshow(arr, cmap=cmap, vmin=vmin, vmax=vmax)
    plt.colorbar(im, label=label)
    plt.axis("off")
    plt.savefig(nombre_salida, dpi=200, bbox_inches="tight")
    plt.close()

# Procesar un ZIP (fase, coherencia, elevación)
async def procesar_zip(zip_file: UploadFile, procesar_fase=True, procesar_coherencia=True, procesar_elevacion=True):
    try:
        # Guardar el archivo ZIP temporalmente
        temp_dir = Path("temp_zip")
        temp_dir.mkdir(parents=True, exist_ok=True)
        zip_path = temp_dir / zip_file.filename
        with open(zip_path, "wb") as f:
            f.write(await zip_file.read())  # Esperar la lectura del archivo

        # Extraer los TIFFs
        tifs = extraer_tifs(zip_path, CARPETA_TEMP)

        # Filtrar por tipo (fase, coherencia, elevación)
        fase_files = [f for f in tifs if "phase" in os.path.basename(f).lower()]
        coherencia_files = [f for f in tifs if "coh" in os.path.basename(f).lower()]
        elevacion_files = [f for f in tifs if "dem" in os.path.basename(f).lower()]

        # Procesar fase
        if procesar_fase and fase_files:
            for tif in fase_files:
                fecha = extraer_fecha(os.path.basename(tif)) or "sin_fecha"
                data = rasterio.open(tif).read(1).astype(float)
                renderizar_imagen(data, os.path.join(CARPETA_FASE, f"fase_{fecha}.png"), "twilight", -np.pi, np.pi, "Fase [rad]")

        # Procesar coherencia
        if procesar_coherencia and coherencia_files:
            for tif in coherencia_files:
                fecha = extraer_fecha(os.path.basename(tif)) or "sin_fecha"
                data = rasterio.open(tif).read(1).astype(float)
                renderizar_imagen(data, os.path.join(CARPETA_COHERENCIA, f"coherencia_{fecha}.png"), "gray", 0, 1, "Coherencia [0-1]")

        # Procesar elevación
        if procesar_elevacion and elevacion_files:
            for tif in elevacion_files:
                fecha = extraer_fecha(os.path.basename(tif)) or "sin_fecha"
                data = rasterio.open(tif).read(1).astype(float)
                renderizar_imagen(data, os.path.join(CARPETA_ELEVACION, f"elevacion_{fecha}.png"), "terrain", None, None, "Elevación [m]")

        # Crear manifest.json
        manifest = {"fechas": [], "fase": [], "coherencia": [], "elevacion": []}
        for folder, label in [(CARPETA_FASE, "fase"), (CARPETA_COHERENCIA, "coherencia"), (CARPETA_ELEVACION, "elevacion")]:
            files = [f for f in os.listdir(folder) if f.endswith(".png")]
            for file in files:
                fecha = extraer_fecha(file)
                if fecha:
                    manifest[label].append({"fecha": fecha.isoformat(), "path": f"/resultados/{label}/{file}"})
                    if fecha not in manifest["fechas"]:
                        manifest["fechas"].append(fecha)
        
        manifest["fechas"] = sorted(manifest["fechas"])
        manifest["fase"] = sorted(manifest["fase"], key=lambda x: x["fecha"])
        manifest["coherencia"] = sorted(manifest["coherencia"], key=lambda x: x["fecha"])
        manifest["elevacion"] = sorted(manifest["elevacion"], key=lambda x: x["fecha"])

        # Guardar manifest.json
        with open(os.path.join(CARPETA_RESULTADOS, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

        # Limpiar archivos temporales
        shutil.rmtree(temp_dir)

        return manifest
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al procesar el archivo ZIP: {e}")

# Endpoint para procesar un archivo ZIP
@app.post("/api/alaska/upload")
async def alaska_upload(files: List[UploadFile] = File(...)):
    try:
        # Procesar cada archivo ZIP
        results = []
        for file in files:
            result = await procesar_zip(file)
            results.append(result)

        return {"ok": True, "msg": "Procesamiento completado", "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en procesamiento Alaska: {e}")

# Endpoint para obtener el manifest generado
@app.get("/api/alaska/manifest")
async def alaska_manifest():
    manifest_path = Path("resultados/manifest.json")
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="Aún no se ha generado manifest.json")
    return FileResponse(manifest_path)
