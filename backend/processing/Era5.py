from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import cdsapi
import os
import tempfile
from datetime import datetime

router = APIRouter(prefix="/api/era5", tags=["ERA5"])

# ==========================================================
# MODELO DE ENTRADA
# ==========================================================
class ERA5Request(BaseModel):
    variable: list[str]          # Ej: ["2m_temperature"]
    year: list[str]              # Ej: ["2025"]
    month: list[str]             # Ej: ["01"]
    day: list[str]               # Ej: ["01", "02"]
    time: list[str]              # Ej: ["00:00", "12:00"]
    area: list[float]            # [N, W, S, E]
    dataset: str = "reanalysis-era5-land"
    format: str = "netcdf"

# ==========================================================
# CONFIGURACIÓN CREDENCIALES
# ==========================================================
ERA5_URL = "https://cds.climate.copernicus.eu/api"
ERA5_KEY = "f0546e0b-a487-4c2a-9b3b-fb7bcc449861"

# Horas válidas para ERA5-Land
VALID_HOURS = ["00:00", "06:00", "12:00", "18:00"]

# ==========================================================
# ENDPOINT DE DESCARGA
# ==========================================================
@router.post("/download")
def download_era5(req: ERA5Request):
    try:
        # Validar horas
        for h in req.time:
            if h not in VALID_HOURS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Hora inválida para ERA5-Land: {h}. Horas válidas: {VALID_HOURS}"
                )

        # Inicializar cliente CDSAPI
        c = cdsapi.Client(url=ERA5_URL, key=ERA5_KEY, verify=True, quiet=False)

        # Carpeta temporal
        temp_dir = tempfile.gettempdir()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = os.path.join(temp_dir, f"era5_{timestamp}.nc")

        # Construir solicitud
        request = {
            "variable": req.variable,
            "year": req.year,
            "month": req.month,
            "day": req.day,
            "time": req.time,
            "area": req.area,
            "data_format": "netcdf",       # CORRECTO
            "download_format": "unarchived" # CORRECTO 
        }

        # Descargar datos ERA5 al archivo temporal
        try:
            result = c.retrieve(req.dataset, request)
            result.download(output_path)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"❌ Error en la descarga ERA5: {str(e)}"
            )

        # Devolver el archivo directamente como descarga
        return FileResponse(
            path=output_path,
            filename=f"era5_{timestamp}.nc",
            media_type="application/x-netcdf",
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"❌ Error inesperado: {str(e)}")
