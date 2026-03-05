from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Tuple, Iterable  # Importa Iterable
from datetime import datetime, timezone
import os
import re

from dateutil import parser
import asf_search as asf
import hyp3_sdk as sdk

# =========================
#  CONFIGURACIÓN ESTÁNDAR
# =========================
USERNAME = "adalid_orantes"
PASSWORD = "_&kgsmB92Zwtgr*"

# Valor por defecto si el usuario NO manda nombre de proyecto
NOMBRE_PROYECTO_POR_DEFECTO = "prueba_api_2023_01"

# Carpeta base donde se crearán las carpetas de proyecto
CARPETA_BASE_SALIDA = "."  # puedes cambiarla si quieres otro root


# AOI por defecto (WKT)
POLYGON = (
    "POLYGON(("
    "-90.1684 13.0484,"
    "-87.6389 13.0484,"
    "-87.6389 14.5881,"
    "-90.1684 14.5881,"
    "-90.1684 13.0484"
    "))"
)

# Filtros estándar para búsqueda Sentinel-1
RUTA = 128              # relativeOrbit
MARCO = 547             # frame
BEAM_MODE = "IW"
PROC_LEVEL = "SLC"
PLATFORM = "Sentinel-1"

# Parámetros estándar de HyP3 InSAR
DAY_INTERVAL = 12
INCLUDE_DEM = True
INCLUDE_LOOK_VECTORS = True
LOOKS = "20x4"


# =========================
#  TIPOS / MODELOS
# =========================
@dataclass
class SolicitudAutoIn:
    """Variables que vienen desde el frontend."""
    start_date: str   # ISO-8601
    end_date: str     # ISO-8601
    project_name: Optional[str] = None   # nombre del proyecto/carpeta
    output_folder: Optional[str] = None  # carpeta base en el servidor


@dataclass
class TimeWindow:
    start: str
    end: str


@dataclass
class SceneInfo:
    granule: Optional[str]
    platform: Optional[str]
    acquire_utc: Optional[str]


@dataclass
class JobSummary:
    job_id: Optional[str]
    name: str
    granule1: str
    granule2: str
    status: Optional[str] = None


# =========================
#  UTILIDADES GENERALES
# =========================
def _parse_iso_utc(value: str) -> datetime:
    """Parsea ISO y asegura timezone-aware en UTC."""
    dt = parser.isoparse(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt


def _iso_utc(dt: datetime) -> str:
    """Devuelve ISO siempre en UTC con sufijo 'Z'."""
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _get_prop(scene: Any, *keys: str) -> Optional[Any]:
    """Obtiene un atributo del objeto o de su dict properties."""
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
    """Granule name esperado por HyP3 (granuleName/sceneName/fileID/productName)."""
    return _get_prop(scene, "granuleName", "sceneName", "fileID", "productName")


def get_platform(scene: Any) -> Optional[str]:
    """Devuelve 'S1A' o 'S1B' si está disponible (para emparejar la misma plataforma)."""
    plat = _get_prop(scene, "platform", "PLATFORM")
    if not plat:
        g = get_granule_name(scene) or ""
        if g.startswith("S1A"):
            return "S1A"
        if g.startswith("S1B"):
            return "S1B"
        return None
    plat = str(plat).upper()
    if "S1A" in plat:
        return "S1A"
    if "S1B" in plat:
        return "S1B"
    return None


def acquire_date(scene: Any) -> Optional[datetime]:
    """Extrae datetime de adquisición en UTC."""
    candidates = ("startTime", "sceneDate", "sensingStart", "beginPosition", "acquisitionDate")
    val = _get_prop(scene, *candidates)
    if not val:
        return None
    try:
        return _parse_iso_utc(str(val))
    except Exception:
        return None


# =========================
#  UTILIDADES PROYECTO
# =========================
def _sanear_nombre_proyecto(raw: Optional[str]) -> str:
    """
    Devuelve el nombre del proyecto tal como lo ingresa el usuario, sin modificaciones.
    """
    if not raw or not raw.strip():
        return NOMBRE_PROYECTO_POR_DEFECTO

    name = raw.strip()  # El nombre tal como lo ingresa el usuario
    return name  # No se modifican los números ni se agregan caracteres extra


def _ruta_carpeta_salida(nombre_proyecto: str, base: Optional[str] = None) -> str:
    """Devuelve la ruta completa donde se guardaría la carpeta del proyecto."""
    base_dir = base or CARPETA_BASE_SALIDA
    return os.path.join(base_dir, nombre_proyecto)


def _validar_nombre_proyecto_unico(
    nombre_proyecto: str,
    base: Optional[str] = None,
) -> Optional[str]:
    """
    Valida que NO exista ya una carpeta con ese nombre.
    Si ya existe, devuelve un mensaje de error (string).
    Si está OK, devuelve None.
    """
    carpeta = _ruta_carpeta_salida(nombre_proyecto, base=base)
    if os.path.exists(carpeta):
        return (
            f"Ya existe una carpeta/proyecto llamada '{nombre_proyecto}'. "
            "Por favor elige otro nombre para evitar sobreescribir datos."
        )
    return None


# =========================
#  LÓGICA PRINCIPAL
# =========================
def search_scenes(start_iso: str, end_iso: str) -> List[Any]:
    """Busca escenas en ASF para el AOI y filtros estándar."""
    results = asf.search(
        platform=PLATFORM,
        processingLevel=PROC_LEVEL,
        beamMode=BEAM_MODE,
        intersectsWith=POLYGON,
        start=start_iso,
        end=end_iso,
        relativeOrbit=RUTA,
        frame=MARCO,
    )
    return list(results)


def build_pairs(results: Iterable[Any]) -> List[Tuple[str, str]]:
    """Ordena por fecha y construye pares (misma plataforma, separación ≤ DAY_INTERVAL)."""
    valid: List[Tuple[Any, str, datetime]] = []
    for r in results:
        g = get_granule_name(r)
        d = acquire_date(r)
        if g and d:
            valid.append((r, g, d))

    if not valid:
        return []

    valid.sort(key=lambda t: t[2])

    pairs: List[Tuple[str, str]] = []
    for i in range(len(valid) - 1):
        r1, g1, d1 = valid[i]
        r2, g2, d2 = valid[i + 1]
        plat1 = get_platform(r1)
        plat2 = get_platform(r2)
        if plat1 and plat2 and plat1 != plat2:
            continue
        delta_days = abs((d2 - d1).days)
        if delta_days <= DAY_INTERVAL:
            pairs.append((g1, g2))

    return pairs


def submit_jobs(
    pairs: List[Tuple[str, str]],
    project_name: str,
) -> List[JobSummary]:
    """Envía jobs InSAR a HyP3 y devuelve resumen por par."""
    if not pairs:
        return []

    hyp3 = sdk.HyP3(username=USERNAME, password=PASSWORD)
    summaries: List[JobSummary] = []

    for idx, (g1, g2) in enumerate(pairs, 1):
        # Usa el nombre de proyecto como prefijo para identificar el proyecto
        job_name = f"{project_name}_{RUTA}_{MARCO}_{idx:02d}"
        try:
            job = hyp3.submit_insar_job(
                granule1=g1,
                granule2=g2,
                name=job_name,
                include_dem=INCLUDE_DEM,
                include_look_vectors=INCLUDE_LOOK_VECTORS,
                looks=LOOKS,
            )
            job_id = getattr(job, "job_id", None) or getattr(job, "id", None)
            status = getattr(job, "status", None)
            summaries.append(JobSummary(
                job_id=str(job_id) if job_id else None,
                name=job_name,
                granule1=g1,
                granule2=g2,
                status=str(status) if status else None
            ))
        except Exception as e:
            summaries.append(JobSummary(
                job_id=None,
                name=job_name,
                granule1=g1,
                granule2=g2,
                status=f"ERROR: {e}"
            ))
    return summaries


def solicitar_imagenes_automatico(payload: SolicitudAutoIn) -> Dict[str, Any]:
    """
    Punto de entrada para el endpoint.
    - Recibe start_date, end_date, project_name, output_folder.
    - Valida que el nombre de proyecto no se repita como carpeta local.
    - Devuelve un dict serializable.
    """
    # 0) Normalizar/validar nombre de proyecto
    project_name = _sanear_nombre_proyecto(payload.project_name)
    base_dir = payload.output_folder or CARPETA_BASE_SALIDA
    carpeta_salida = _ruta_carpeta_salida(project_name, base=base_dir)

    error_nombre = _validar_nombre_proyecto_unico(project_name, base=base_dir)
    if error_nombre:
        # No hacemos nada más: devolvemos error y un resumen mínimo
        return {
            "project_input": payload.project_name,
            "project": project_name,
            "time_window": None,
            "aoi": None,
            "insar_options": None,
            "summary": {
                "found_scenes": 0,
                "built_pairs": 0,
                "submitted_jobs": 0,
                "output_folder_hint": carpeta_salida,
            },
            "scenes": [],
            "pairs": [],
            "jobs": [],
            "error": {
                "code": "PROJECT_NAME_ALREADY_EXISTS",
                "message": error_nombre,  # El mensaje con el error de nombre repetido
            },
        }

    # 1) Normaliza fechas a ISO UTC (con 'Z')
    start_dt = _parse_iso_utc(payload.start_date)
    end_dt = _parse_iso_utc(payload.end_date)

    start_iso = _iso_utc(start_dt)
    end_iso = _iso_utc(end_dt)

    # 2) Buscar escenas
    results = search_scenes(start_iso, end_iso)

    # 3) Resumen de escenas (útil para el frontend)
    escenas: List[SceneInfo] = []
    for r in results:
        acq_dt = acquire_date(r)
        escenas.append(SceneInfo(
            granule=get_granule_name(r),
            platform=get_platform(r),
            acquire_utc=_iso_utc(acq_dt) if acq_dt else None
        ))

    # 4) Construir pares
    pairs = build_pairs(results)

    # 5) Enviar jobs
    jobs = submit_jobs(pairs, project_name=project_name)

    # 6) Respuesta
    response: Dict[str, Any] = {
        "project_input": payload.project_name,      # lo que escribió el usuario crudo
        "project": project_name,                    # nombre saneado/real que se usa
        "time_window": asdict(TimeWindow(start=start_iso, end=end_iso)),
        "aoi": {
            "polygon_wkt": POLYGON,
            "relative_orbit": RUTA,
            "frame": MARCO,
            "beam_mode": BEAM_MODE,
            "processing_level": PROC_LEVEL,
            "platform": PLATFORM,
        },
        "insar_options": {
            "day_interval": DAY_INTERVAL,
            "include_dem": INCLUDE_DEM,
            "include_look_vectors": INCLUDE_LOOK_VECTORS,
            "looks": LOOKS,
        },
        "summary": {
            "found_scenes": len(results),
            "built_pairs": len(pairs),
            "submitted_jobs": len([j for j in jobs if j.job_id]),
            "output_folder_hint": carpeta_salida,
        },
        "scenes": [asdict(s) for s in escenas],
        "pairs": [{"granule1": g1, "granule2": g2} for (g1, g2) in pairs],
        "jobs": [asdict(j) for j in jobs],
        "error": None,
    }
    return response


# Ejecución directa (opcional) para pruebas locales rápidas:
if __name__ == "__main__":
    ejemplo = SolicitudAutoIn(
        start_date="2024-02-01T00:00:00Z",
        end_date="2024-03-15T23:59:59Z",
        project_name="mi_proyecto_insar_prueba",
        output_folder=".",  # o la ruta que quieras
    )
    out = solicitar_imagenes_automatico(ejemplo)
    print(
        f"[{out['project']}] escenas={out['summary']['found_scenes']}, "
        f"pares={out['summary']['built_pairs']}, jobs_ok={out['summary']['submitted_jobs']}, "
        f"error={out['error']}"
    )
