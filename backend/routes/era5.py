from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import cdsapi
import os
import tempfile
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

ERA5_URL = os.getenv("ERA5_URL")
ERA5_KEY = os.getenv("ERA5_KEY")
router = APIRouter(prefix="/api/era5", tags=["ERA5"])

class ERA5Request(BaseModel):
    variable: list[str]
    year: list[str]
    month: list[str]
    day: list[str]
    time: list[str]
    area: list[float]
    dataset: str = "reanalysis-era5-single-levels"
    format: str = "netcdf"



VALID_HOURS = ["00:00", "06:00", "12:00", "18:00"]

@router.post("/download")
def download_era5(req: ERA5Request):
    try:
        for h in req.time:
            if h not in VALID_HOURS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Hora inválida para ERA5: {h}. Horas válidas seleccionables: {VALID_HOURS}"
                )

        c = cdsapi.Client(url=ERA5_URL, key=ERA5_KEY, verify=True, quiet=False)

        temp_dir = tempfile.gettempdir()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = os.path.join(temp_dir, f"era5_{timestamp}.nc")

        request = {
            "variable": req.variable,
            "year": req.year,
            "month": req.month,
            "day": req.day,
            "time": req.time,
            "area": req.area,
            "product_type": "reanalysis",
            "format": "netcdf",
        }

        try:
            result = c.retrieve(req.dataset, request)
            result.download(output_path)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Error en la descarga ERA5: {str(e)}"
            )

        return FileResponse(
            path=output_path,
            filename=f"era5_{timestamp}.nc",
            media_type="application/x-netcdf",
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error inesperado: {str(e)}")
