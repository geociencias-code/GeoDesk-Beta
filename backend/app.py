from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn
import sys
import os
from routes.alaska import router as alaska_router


from routes.solicitar_imagenes_automatico import router as solicitar_imagenes_router
from routes.mintpy_analysis import router as mintpy_router
from routes.eq_insar import router as eq_insar_router

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
app = FastAPI(title="MyApp API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "[https://geociencias.ues.edu.sv](https://geociencias.ues.edu.sv)"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("resultados_comparativa", exist_ok=True)
app.mount(
    "/resultados_comparativa",
    StaticFiles(directory="resultados_comparativa"),
    name="resultados_comparativa",
)

os.makedirs("mintpy_results", exist_ok=True)
app.mount("/mintpy_results", StaticFiles(directory="mintpy_results"), name="mintpy_results")

app.include_router(alaska_router)


app.include_router(solicitar_imagenes_router)
app.include_router(mintpy_router)
app.include_router(eq_insar_router)

@app.get("/api/health")
def health_root():
    return {"ok": True, "service": "MyApp API (root)"}

if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
