from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn
import sys
import os
from routes.alaska import router as alaska_router
from routes.era5 import router as era5_router
from routes.era5_procesamiento_nc import router as era5_nc_router
from routes.era5_sentinel_comparative import router as era5_sentinel_router
from routes.procesamiento_general import router as proc_general_router
from routes.solicitar_imagenes_automatico import router as solicitar_imagenes_router
from routes.alaska_velocity_excel import router as alaska_velocity_router

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
app = FastAPI(title="MyApp API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", 
                   "http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MONTAJE DE CARPETAS EXISTENTES
os.makedirs("temporal_nc", exist_ok=True)
app.mount("/temporal_nc", StaticFiles(directory="temporal_nc"), name="temporal_nc")

os.makedirs("resultados_comparativa", exist_ok=True)
app.mount(
    "/resultados_comparativa",
    StaticFiles(directory="resultados_comparativa"),
    name="resultados_comparativa",
)

app.include_router(alaska_router)
app.include_router(era5_router)
app.include_router(era5_nc_router)
app.include_router(era5_sentinel_router)
app.include_router(proc_general_router)
app.include_router(solicitar_imagenes_router)
app.include_router(alaska_velocity_router)

@app.get("/api/health")
def health_root():
    return {"ok": True, "service": "MyApp API (root)"}

if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
