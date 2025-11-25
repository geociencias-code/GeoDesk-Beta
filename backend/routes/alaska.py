# backend/routes/alaska.py
from __future__ import annotations

import math
import os
import re
import pathlib
import urllib.parse
from typing import Any, Iterable, List, Optional, Tuple, Dict
from datetime import datetime, timezone

import requests
from dateutil import parser
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

import asf_search as asf
from asf_search import ASFSession
import hyp3_sdk as sdk

# =======================
# CARGA DE CONFIG/SECRETOS
# =======================

ASF_USERNAME="adalid_orantes"
ASF_PASSWORD="_&kgsmB92Zwtgr*"
HYP3_USERNAME="adalid_orantes"
HYP3_PASSWORD="_&kgsmB92Zwtgr*"
HYP3_PLUS_ENABLED=1
HYP3_PLUS_URL="https://hyp3-plus.asf.alaska.edu"

if not HYP3_USERNAME or not HYP3_PASSWORD:
    print("ADVERTENCIA: Faltan HYP3_USERNAME/HYP3_PASSWORD en backend/.env")
if not ASF_USERNAME or not ASF_PASSWORD:
    print("ADVERTENCIA: Faltan ASF_USERNAME/ASF_PASSWORD en backend/.env (requeridos para descargar del Data Pool)")
else:
    print("ASF_USERNAME detectado (OK)")

# =======================
# ROUTER
# =======================
router = APIRouter()

# =======================
# MODELOS (I/O)
# =======================
class SearchParams(BaseModel):
    polygon: str = Field(
        default=(
            "POLYGON(("
            "-90.1684 13.0484,"
            "-87.6389 13.0484,"
            "-87.6389 14.5881,"
            "-90.1684 14.5881,"
            "-90.1684 13.0484"
            "))"
        ),
        description="WKT Polygon",
    )
    start_date: str = "2025-01-01T00:00:00Z"
    end_date: str   = "2025-01-15T23:59:59Z"
    ruta: int = 128
    marco: int = 547
    beam_mode: str = "IW"
    processing_level: str = "SLC"
    # filtros opcionales (para SLC)
    flight_direction: Optional[str] = None   # ASCENDING | DESCENDING
    polarization: Optional[str] = None       # VV, HH, VV+VH, HH+HV
    # pares
    day_interval: int = 12
    same_platform: bool = True

class SceneOut(BaseModel):
    granule: str
    platform: Optional[str] = None
    date_utc: Optional[str] = None
    ruta: Optional[int] = None
    marco: Optional[int] = None
    beam_mode: Optional[str] = None
    flight_direction: Optional[str] = None
    polarization: Optional[str] = None
    download_url: Optional[str] = None  # (si fuese producto ya listo)

class PairOut(BaseModel):
    g1: str
    g2: str

class JobOptions(BaseModel):
    nombre_proyecto: str = "prueba_api"
    include_dem: bool = True
    include_look_vectors: bool = True
    looks: str = "20x4"

class SubmitRequest(BaseModel):
    pairs: List[PairOut]
    ruta: int = 128
    marco: int = 547
    options: JobOptions = JobOptions()

class SubmitResult(BaseModel):
    index: int
    job_name: str
    job_id: Optional[str] = None
    status: str

class SubmitResponse(BaseModel):
    submitted: List[SubmitResult]
    total: int

class StatusRequest(BaseModel):
    job_ids: List[str]

class ProjectFileDownloadRequest(BaseModel):
    nombre_proyecto: str
    product_type: str = "INSAR_GAMMA"  # Tipo de producto por defecto

class JobFile(BaseModel):
    file_name: str
    url: str
    size_mb: Optional[float] = None

class JobStatus(BaseModel):
    job_id: str
    job_name: Optional[str] = None
    status: str
    files: List[JobFile] = Field(default_factory=list)

class DownloadBody(BaseModel):
    file_url: str
    file_name: Optional[str] = None

# —— Descargar lote
class BatchItem(BaseModel):
    file_url: str
    file_name: Optional[str] = None

class BatchDownloadBody(BaseModel):
    items: List[BatchItem]

class BatchDownloadResult(BaseModel):
    ok: bool
    file_url: str
    filename: Optional[str] = None
    saved_to: Optional[str] = None
    bytes: Optional[int] = None
    error: Optional[str] = None

# —— Listar HyP3 por prefijo
class Hyp3ListRequest(BaseModel):
    nombre_proyecto: str = "prueba_api"
    product_type: str = "INSAR_GAMMA"  # o RTC_GAMMA
    ruta: Optional[int] = None
    marco: Optional[int] = None

class Hyp3FileOut(BaseModel):
    granule: str
    download_url: str
    size_mb: Optional[float] = None

# —— Enviar a HyP3 desde selección SLC
class SubmitFromGranulesBody(BaseModel):
    granules: List[str]
    ruta: int
    marco: int
    day_interval: int = 12
    same_platform: bool = True
    options: JobOptions = JobOptions()

# =======================
# UTILITARIAS
# =======================
def update_project_name(new_name: str):
    """
    Actualiza el nombre del proyecto en los objetos relacionados.
    """
    JobOptions.nombre_proyecto = new_name
    Hyp3ListRequest.nombre_proyecto = new_name


def _get_prop(scene: Any, *keys: str) -> Optional[Any]:
    for k in keys:
        if hasattr(scene, k):
            v = getattr(scene, k)
            if v not in (None, ""):
                return v
        if hasattr(scene, "properties") and isinstance(scene.properties, dict):
            if k in scene.properties and scene.properties[k] not in (None, ""):
                return scene.properties[k]
    return None

def get_granule_name(scene: Any) -> Optional[str]:
    return _get_prop(scene, "granuleName", "sceneName", "fileID", "productName", "fileName")

def get_platform(scene: Any) -> Optional[str]:
    plat = _get_prop(scene, "platform", "PLATFORM")
    if not plat:
        g = (get_granule_name(scene) or "").upper()
        if g.startswith("S1A"): return "S1A"
        if g.startswith("S1B"): return "S1B"
        return None
    return str(plat).upper()

def acquire_date(scene: Any) -> Optional[datetime]:
    candidates = ("startTime", "sceneDate", "sensingStart", "beginPosition", "acquisitionDate")
    val = _get_prop(scene, *candidates)
    if not val: return None
    try:
        dt = parser.isoparse(str(val))
        if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
        else: dt = dt.astimezone(timezone.utc)
        return dt
    except Exception:
        return None

def get_ruta(scene: Any) -> Optional[int]:
    v = _get_prop(scene, "relativeOrbit", "pathNumber", "path")
    try: return int(v) if v is not None else None
    except Exception: return None

def get_marco(scene: Any) -> Optional[int]:
    v = _get_prop(scene, "frame", "FRAME")
    try: return int(v) if v is not None else None
    except Exception: return None

def get_download_url(scene: Any) -> Optional[str]:
    return _get_prop(scene, "url", "downloadUrl", "download_url", "fileURL", "link")

def get_size_mb_from_dict(d: Dict[str, Any]) -> Optional[float]:
    size = d.get("size")
    if not size: return None
    try:
        return round(float(size) / (1024 * 1024), 2)
    except Exception:
        return None

def search_scenes(params: SearchParams) -> List[Any]:
    kwargs: Dict[str, Any] = dict(
        platform="Sentinel-1",
        processingLevel=params.processing_level,
        beamMode=params.beam_mode,
        intersectsWith=params.polygon,
        start=params.start_date,
        end=params.end_date,
        relativeOrbit=params.ruta,
        frame=params.marco,
    )
    if params.flight_direction:
        kwargs["flightDirection"] = params.flight_direction
    if params.polarization:
        kwargs["polarization"] = params.polarization
    return list(asf.search(**kwargs))

def build_pairs_from_results(results: Iterable[Any], day_interval: int, same_platform: bool) -> List[Tuple[str, str]]:
    valid = []
    for r in results:
        g = get_granule_name(r)
        d = acquire_date(r)
        if g and d:
            valid.append((r, g, d))
    if not valid: return []
    valid.sort(key=lambda t: t[2])

    pairs: List[Tuple[str, str]] = []
    for i in range(len(valid) - 1):
        r1, g1, d1 = valid[i]
        r2, g2, d2 = valid[i + 1]
        if same_platform:
            p1, p2 = get_platform(r1), get_platform(r2)
            if p1 and p2 and p1 != p2:
                continue
        if abs((d2 - d1).days) <= day_interval:
            pairs.append((g1, g2))
    return pairs

# --- sesión ASF (EDL/URS) y descarga robusta ---
def make_asf_session() -> ASFSession:
    s = ASFSession()
    if ASF_USERNAME and ASF_PASSWORD:
        s.auth = (ASF_USERNAME, ASF_PASSWORD)
    return s

def ensure_dir(dir_path: pathlib.Path) -> pathlib.Path:
    dir_path.mkdir(parents=True, exist_ok=True)
    return dir_path

def human_size(nbytes: int) -> str:
    if nbytes is None:
        return "?"
    if nbytes == 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    e = min(int(math.log(nbytes, 1024)), len(units)-1)
    return f"{nbytes/1024**e:.2f} {units[e]}"

def safe_filename(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]+', '_', name)

def download_file(url: str, dest_path: pathlib.Path, chunk=1024*1024) -> None:
    with requests.get(url, stream=True) as r:
        r.raise_for_status()
        total = int(r.headers.get('Content-Length', 0))
        written = 0
        with open(dest_path, 'wb') as f:
            for part in r.iter_content(chunk_size=chunk):
                if not part:
                    continue
                f.write(part)
                written += len(part)
                if total:
                    done = int(50 * written / total)
                    bar = f"[{'='*done}{'.'*(50-done)}]"
                    print(f"\r  {bar} {written/1024/1024:.1f}/{total/1024/1024:.1f} MB", end='')
        if total:
            print("\r  [==================================================] done     ")
            
def ensure_dir(dir_path: str) -> pathlib.Path:
    p = pathlib.Path(dir_path).expanduser().resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


ASF_HOSTS = {"asf.alaska.edu", "datapool.asf.alaska.edu", "vertex.daac.asf.alaska.edu"}

def pick_filename_from_headers(resp: requests.Response) -> Optional[str]:
    cd = resp.headers.get("Content-Disposition") or resp.headers.get("content-disposition")
    if not cd: return None
    m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^\";]+)"?', cd, flags=re.IGNORECASE)
    return m.group(1).strip() if m else None

def guess_filename_from_url(url: str) -> str:
    path = urllib.parse.urlparse(url).path
    base = pathlib.Path(path).name or "archivo.bin"
    return safe_filename(base)

def pick_session_for(url: str) -> requests.Session:
    host = urllib.parse.urlparse(url).hostname or ""
    if any(host.endswith(h) for h in ASF_HOSTS):
        return make_asf_session()
    return requests.Session()

# =======================
# ENDPOINTS
# =======================
@router.post("/api/update-project-name")
def api_update_project_name(new_name: str):
    """
    Endpoint para actualizar el nombre del proyecto.
    """
    update_project_name(new_name)
    return {"ok": True, "new_name": new_name}

@router.get("/health")
def health():
    return {"ok": True, "service": "Sentinel-1 HyP3 API"}

# --- BUSCAR SLC ---
@router.post("/api/search", response_model=List[SceneOut])
def api_search(params: SearchParams):
    try:
        res = search_scenes(params)
        out: List[SceneOut] = []
        for r in res:
            out.append(SceneOut(
                granule=get_granule_name(r) or "<sin_nombre>",
                platform=get_platform(r),
                date_utc=(acquire_date(r).isoformat() if acquire_date(r) else None),
                ruta=get_ruta(r),
                marco=get_marco(r),
                beam_mode=params.beam_mode,
                flight_direction=params.flight_direction,
                polarization=params.polarization,
                download_url=None,
            ))
        out.sort(key=lambda x: (x.date_utc or "", x.granule))
        return out
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en búsqueda: {e}")

# --- CONSTRUIR PARES (opcional) ---
@router.post("/api/pairs", response_model=List[PairOut])
def api_pairs(params: SearchParams):
    try:
        res = search_scenes(params)
        pairs = build_pairs_from_results(res, params.day_interval, params.same_platform)
        return [PairOut(g1=g1, g2=g2) for (g1, g2) in pairs]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error construyendo pares: {e}")

# --- ENVIAR JOBS HyP3 DESDE PARES (flujo clásico) ---
@router.post("/api/submit", response_model=SubmitResponse)
def api_submit(body: SubmitRequest):
    if not HYP3_USERNAME or not HYP3_PASSWORD:
        raise HTTPException(status_code=400, detail="Faltan HYP3_USERNAME/HYP3_PASSWORD en backend/.env")
    try:
        hyp3 = sdk.HyP3(username=HYP3_USERNAME, password=HYP3_PASSWORD)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"No se pudo autenticar en HyP3: {e}")

    submitted: List[SubmitResult] = []
    for idx, p in enumerate(body.pairs, start=1):
        job_name = f"{body.options.nombre_proyecto}_{body.ruta}_{body.marco}_{idx:02d}"
        try:
            job = hyp3.submit_insar_job(
                granule1=p.g1, granule2=p.g2, name=job_name,
                include_dem=body.options.include_dem,
                include_look_vectors=body.options.include_look_vectors,
                looks=body.options.looks,
            )
            job_id = getattr(job, "job_id", None) or getattr(job, "id", None)
            submitted.append(SubmitResult(index=idx, job_name=job_name, job_id=job_id, status="submitted"))
        except Exception as e:
            submitted.append(SubmitResult(index=idx, job_name=job_name, job_id=None, status=f"error: {e}"))

    return SubmitResponse(submitted=submitted, total=len(submitted))

# --- ENVIAR JOBS HyP3 DESDE LISTA DE GRANULES SLC (selección de la tabla) ---
@router.post("/api/submit-from-granules", response_model=SubmitResponse)
def api_submit_from_granules(body: SubmitFromGranulesBody):
    if not HYP3_USERNAME or not HYP3_PASSWORD:
        raise HTTPException(status_code=400, detail="Faltan HYP3_USERNAME/HYP3_PASSWORD en backend/.env")

    # Recuperar metadatos de esos granules SLC
    try:
        try:
            results = list(asf.search(platform="Sentinel-1", processingLevel="SLC", granule_list=body.granules))
        except TypeError:
            results = []
            for g in body.granules:
                results.extend(list(asf.search(platform="Sentinel-1", processingLevel="SLC", granule=g)))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"No se pudieron leer metadatos de granules: {e}")

    # Armar pares según reglas
    valid = []
    for r in results:
        g = get_granule_name(r)
        d = acquire_date(r)
        if g and d: valid.append((r, g, d))
    valid.sort(key=lambda t: t[2])

    pairs: List[Tuple[str, str]] = []
    for i in range(len(valid) - 1):
        r1, g1, d1 = valid[i]
        r2, g2, d2 = valid[i + 1]
        if body.same_platform:
            p1, p2 = get_platform(r1), get_platform(r2)
            if p1 and p2 and p1 != p2:
                continue
        if abs((d2 - d1).days) <= body.day_interval:
            pairs.append((g1, g2))

    # Enviar a HyP3
    try:
        hyp3 = sdk.HyP3(username=HYP3_USERNAME, password=HYP3_PASSWORD)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"No se pudo autenticar en HyP3: {e}")

    submitted: List[SubmitResult] = []
    for idx, (g1, g2) in enumerate(pairs, start=1):
        job_name = f"{body.options.nombre_proyecto}_{body.ruta}_{body.marco}_{idx:02d}"
        try:
            job = hyp3.submit_insar_job(
                granule1=g1, granule2=g2, name=job_name,
                include_dem=body.options.include_dem,
                include_look_vectors=body.options.include_look_vectors,
                looks=body.options.looks,
            )
            job_id = getattr(job, "job_id", None) or getattr(job, "id", None)
            submitted.append(SubmitResult(index=idx, job_name=job_name, job_id=job_id, status="submitted"))
        except Exception as e:
            submitted.append(SubmitResult(index=idx, job_name=job_name, job_id=None, status=f"error: {e}"))
    return SubmitResponse(submitted=submitted, total=len(submitted))

# --- LISTAR ARCHIVOS LISTOS EN HyP3 POR PREFIJO ---
@router.post("/api/hyp3-files", response_model=List[Hyp3FileOut])
def api_hyp3_files(body: Hyp3ListRequest):
    if not HYP3_USERNAME or not HYP3_PASSWORD:
        raise HTTPException(status_code=400, detail="Faltan HYP3_USERNAME/HYP3_PASSWORD en backend/.env")
    try:
        hyp3 = sdk.HyP3(username=HYP3_USERNAME, password=HYP3_PASSWORD)

        # Buscar trabajos usando el prefijo del nombre del proyecto
        batch = (
            hyp3.find_jobs(job_type=body.product_type)
                .filter_jobs(running=False, include_expired=False, succeeded=True)
        )

        prefix = body.nombre_proyecto
        if body.ruta is not None and body.marco is not None:
            prefix = f"{body.nombre_proyecto}_{body.ruta}_{body.marco}_"

        out: List[Hyp3FileOut] = []
        
        # Filtrar trabajos por el prefijo del nombre del proyecto
        for job in batch.jobs:
            if prefix and not str(job.name or "").startswith(prefix):
                continue
            for f in (job.files or []):
                url = f.get("url")
                if not url: continue
                name = f.get("name") or f.get("filename") or f.get("key") or "producto.zip"
                out.append(Hyp3FileOut(
                    granule=name,
                    download_url=url,
                    size_mb=get_size_mb_from_dict(f),
                ))

        out.sort(key=lambda x: x.granule)
        return out
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listando HyP3: {e}")

@router.get("/api/projects")
def get_projects():
    """ Devuelve una lista de proyectos disponibles """
    try:
        hyp3 = sdk.HyP3(username=HYP3_USERNAME, password=HYP3_PASSWORD)
        # Buscar trabajos disponibles para obtener los proyectos
        batch = hyp3.find_jobs().filter_jobs(running=False, include_expired=False, succeeded=True)

        projects = []
        for job in batch.jobs:
            project_name = job.name
            if project_name not in [p['name'] for p in projects]:
                projects.append({"id": job.job_id, "name": project_name})

        return projects
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al obtener proyectos: {str(e)}")


@router.post("/api/project-files", response_model=List[JobFile])
def get_project_files(body: ProjectFileDownloadRequest):
    """Obtiene los archivos de un proyecto específico basado en su nombre y tipo de producto."""
    nombre_proyecto = body.nombre_proyecto
    product_type = body.product_type

    if not nombre_proyecto:
        raise HTTPException(status_code=400, detail="El nombre del proyecto es obligatorio")

    try:
        hyp3 = sdk.HyP3(username=ASF_USERNAME, password=ASF_PASSWORD)

        # Buscar trabajos de HyP3 usando el nombre del proyecto y tipo de producto
        batch = (
            hyp3.find_jobs(name=nombre_proyecto, job_type=product_type)
                .filter_jobs(running=False, include_expired=False, succeeded=True)
        )

        if len(batch) == 0:
            raise HTTPException(status_code=404, detail="No se encontraron trabajos disponibles")

        files = []
        index = 1
        for job in batch.jobs:
            job_files = job.files or []
            for f in job_files:
                name = f.get('name') or f.get('filename') or f.get('key') or 'archivo_sin_nombre'
                url = f.get('url')
                size = f.get('size')
                
                if url:
                    files.append({
                        'file_name': name,
                        'url': url,
                        'size_mb': get_size_mb_from_dict(f),
                    })
                    index += 1
        
        if not files:
            raise HTTPException(status_code=404, detail="No hay archivos disponibles para este proyecto")

        return files

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al obtener los archivos del proyecto: {str(e)}")


# --- DESCARGA A DISCO DEL SERVIDOR ---
@router.post("/api/download")
def api_download(body: DownloadBody):
    try:
        downloads_dir = ensure_dir(pathlib.Path(__file__).resolve().parent.parent / "alaska_descargas")
        sess = requests.Session()
        with sess.get(body.file_url, stream=True, allow_redirects=True, timeout=120) as r:
            if r.status_code in (401, 403):
                raise HTTPException(status_code=403, detail="Permisos EDL/URS requeridos")
            r.raise_for_status()
            fname = (body.file_name or "").strip() or safe_filename(body.file_name)
            dst = downloads_dir / fname
            download_file(body.file_url, dst)
        return {"ok": True, "saved_to": str(dst), "bytes": dst.stat().st_size, "filename": fname}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al descargar: {e}")

@router.post("/api/download-batch")
def api_download_batch(body: BatchDownloadBody):
    results: List[BatchDownloadResult] = []
    downloads_dir = ensure_dir(pathlib.Path(__file__).resolve().parent.parent / "alaska_descargas")  # Define your directory for downloads

    # Iterar sobre los archivos seleccionados
    for it in body.items:
        try:
            sess = pick_session_for(it.file_url)  # Usar la sesión HTTP correcta
            with sess.get(it.file_url, stream=True, allow_redirects=True, timeout=120) as r:
                if r.status_code in (401, 403):
                    results.append(BatchDownloadResult(ok=False, file_url=it.file_url, error="403/401 (EDL/URS requerido)"))
                    continue
                r.raise_for_status()
                fname = (it.file_name or "").strip() or pick_filename_from_headers(r) or guess_filename_from_url(r.url)
                fname = safe_filename(fname)
                dst = downloads_dir / fname  # Guardar el archivo en la carpeta adecuada

                # Guardar el archivo en el servidor local
                with open(dst, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            f.write(chunk)
                results.append(BatchDownloadResult(ok=True, file_url=it.file_url, filename=fname, saved_to=str(dst), bytes=dst.stat().st_size))
        except requests.HTTPError as ex:
            results.append(BatchDownloadResult(ok=False, file_url=it.file_url, error=f"HTTP {ex.response.status_code}"))
        except Exception as e:
            results.append(BatchDownloadResult(ok=False, file_url=it.file_url, error=str(e)))

    return results


# ---- Verificación de Earthdata Login/URS ----
@router.get("/api/check-edl")
def api_check_edl(test_url: str = Query("https://datapool.asf.alaska.edu/")):
    try:
        sess = requests.Session()
        r = sess.head(test_url, allow_redirects=True, timeout=30)
        if r.status_code in (200, 301, 302, 303, 307, 308):
            return {"ok": True, "status": r.status_code, "url": r.url}
        if r.status_code in (401, 403):
            return {"ok": False, "status": r.status_code, "detail": "Falta login/permiso en URS/EDL"}
        return {"ok": False, "status": r.status_code, "detail": "Respuesta inesperada"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error check-edl: {e}")
