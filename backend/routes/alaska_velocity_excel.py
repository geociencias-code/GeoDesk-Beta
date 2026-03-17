from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from typing import List
import pandas as pd
import tempfile
from pathlib import Path
import re
from datetime import datetime
import os

router = APIRouter()

def extract_dates(filename: str):
    matches = list(re.finditer(r"(20\d{2})([01]\d)([0-3]\d)", filename))
    if len(matches) >= 2:
        d1 = datetime(int(matches[0].group(1)), int(matches[0].group(2)), int(matches[0].group(3)))
        d2 = datetime(int(matches[1].group(1)), int(matches[1].group(2)), int(matches[1].group(3)))
        return d1, d2
    return None, None

@router.post("/api/v1/alaska/velocity_excel")
async def calculate_velocity_from_excel(files: List[UploadFile] = File(...)):
    if len(files) < 5:
        raise HTTPException(status_code=400, detail="Se requiere un mínimo de 5 archivos para calcular la velocidad.")

    all_data = []

    for file in files:
        contents = await file.read()
        suffix = Path(file.filename).suffix.lower()
        
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(contents)
                tmp_path = tmp.name

            if suffix == '.csv':
                df = pd.read_csv(tmp_path)
            elif suffix in ['.xls', '.xlsx']:
                df = pd.read_excel(tmp_path)
            else:
                os.unlink(tmp_path)
                raise HTTPException(status_code=400, detail=f"Formato de archivo no soportado: {file.filename}. Debe ser CSV o Excel.")
            
            os.unlink(tmp_path)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Error leyendo el archivo {file.filename}: {e}")

        # Extraer fechas para calcular deltatime
        d1, d2 = extract_dates(file.filename)
        if not d1 or not d2:
            raise HTTPException(status_code=400, detail=f"No se pudieron extraer las fechas del archivo {file.filename}")
        
        diff_days = abs((d2 - d1).days)
        if diff_days == 0:
            diff_days = 1 # Evitar división por cero
            
        years = diff_days / 365.25

        # Asumimos que el df tiene 'Latitud', 'Longitud' y 'Deformacion_mm'
        if not all(col in df.columns for col in ['Latitud', 'Longitud', 'Deformacion_mm']):
            raise HTTPException(status_code=400, detail=f"El archivo {file.filename} no tiene las columnas esperadas (Latitud, Longitud, Deformacion_mm)")

        # Calcular velocidad para este intervalo
        df['Velocidad_mm_año'] = df['Deformacion_mm'] / years
        
        # Guardar lat, lon, y velocidad
        all_data.append(df[['Latitud', 'Longitud', 'Velocidad_mm_año']])

    # Concatenar todos los dataframes
    combined = pd.concat(all_data, ignore_index=True)
    
    # Agrupar por Latitud y Longitud, y calcular el promedio
    # Redondeamos un poco las coordenadas para asegurar que coincidan debido a precisiones flotantes
    combined['Latitud_round'] = combined['Latitud'].round(5)
    combined['Longitud_round'] = combined['Longitud'].round(5)
    
    avg_velocity = combined.groupby(['Latitud_round', 'Longitud_round'])['Velocidad_mm_año'].mean().reset_index()
    avg_velocity.rename(columns={'Latitud_round': 'Latitud', 'Longitud_round': 'Longitud'}, inplace=True)
    
    avg_velocity['Velocidad_mm_año'] = avg_velocity['Velocidad_mm_año'].round(4)
    avg_velocity.sort_values(by=['Latitud', 'Longitud'], inplace=True)

    # Generar archivo Excel de salida
    out_dir = Path(tempfile.gettempdir())
    out_file = out_dir / f"velocidad_promedio_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    
    avg_velocity.to_excel(out_file, index=False)

    return FileResponse(
        out_file, 
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 
        filename="velocidad_promedio.xlsx"
    )
