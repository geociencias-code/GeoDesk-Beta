from fastapi import FastAPI, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
import zipfile
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from datetime import datetime
import tempfile
import re
from typing import List
import cartopy.crs as ccrs
import xarray as xr
import uvicorn
import sys
import os

# Add the backend directory to sys.path so absolute imports work when uvicorn is run from the project root
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from routes.alaska import router as alaska_router
from routes.era5 import router as era5_router
from routes.era5_procesamiento_nc import router as era5_nc_router
from routes.deformacion import router as deformacion_router
from routes.procesamiento_general import router as proc_general_router

app = FastAPI(title="MyApp API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", 
                   "http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

############################################
# MONTAJE DE CARPETAS EXISTENTES
############################################
os.makedirs("temporal_nc", exist_ok=True)
app.mount("/temporal_nc", StaticFiles(directory="temporal_nc"), name="temporal_nc")

os.makedirs("temperatura_deformacion", exist_ok=True)
app.mount(
    "/temperatura_deformacion",
    StaticFiles(directory="temperatura_deformacion"),
    name="temperatura_deformacion",
)

os.makedirs("resultados_deformacion", exist_ok=True)
app.mount(
    "/resultados_deformacion",
    StaticFiles(directory="resultados_deformacion"),
    name="resultados_deformacion",
)

############################################
# Routers
############################################
app.include_router(alaska_router)
app.include_router(era5_router)
app.include_router(era5_nc_router)
app.include_router(deformacion_router)
app.include_router(proc_general_router)

# Health Check
@app.get("/api/health")
def health_root():
    return {"ok": True, "service": "MyApp API (root)"}

if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
