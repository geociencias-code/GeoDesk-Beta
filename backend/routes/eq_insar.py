from __future__ import annotations

import base64
import io
import math
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from eq_insar import (
    generate_synthetic_insar,
    generate_timeseries,
    generate_training_batch,
    batch_to_arrays,
    list_satellites,
)



router = APIRouter(prefix="/api/eq_insar", tags=["EQ-INSAR"])




def _array_to_png_b64(
        arr: np.ndarray, 
        cmap: str = "RdBu_r", 
        vmin=None, 
        vmax=None
) -> str:
    """
    Convierte un arreglo NumPy a una imagen PNG codificada en base64.
    
    Genera una visualización de un arreglo 2D usando matplotlib con barra
    de colores y guarda el resultado como una imagen PNG comprimida,
    codificada en base64 para transmisión HTTP.
    
    Args:
        arr: Arreglo NumPy 2D a visualizar.
        cmap: Nombre del mapa de colores de matplotlib. Por defecto es "RdBu_r"
              (rojo-azul invertido).
        vmin: Valor mínimo para normalización del mapa de colores. Si es None,
              se usa el mínimo del arreglo.
        vmax: Valor máximo para normalización del mapa de colores. Si es None,
              se usa el máximo del arreglo.
    
    Returns:
        str: Cadena codificada en base64 de la imagen PNG.
    
    Raises:
        ValueError: Si el arreglo está vacío o contiene solo valores NaN.

    """
    fig, ax = plt.subplots(figsize=(5, 5), dpi=100)
    im = ax.imshow(arr, cmap=cmap, vmin=vmin, vmax=vmax, origin="upper")
    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    ax.set_axis_off()
    fig.tight_layout(pad=0.5)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=100)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


def _wrapped_phase_png(phase: np.ndarray) -> str:
    """
    Convierte un arreglo de fase envuelta a imagen PNG en base64.
    
    Utiliza mapa de colores HSV para visualizar fase en rango [-π, π],
    apropiado para interferogramas con fase envuelta.
    
    Args:
        phase: Arreglo NumPy 2D de valores de fase en radianes.
    
    Returns:
        str: Cadena codificada en base64 de la imagen PNG.

    """
    
    return _array_to_png_b64(phase, cmap="hsv", vmin=-math.pi, vmax=math.pi)


def _stats(arr: np.ndarray) -> dict:
    """
    Calcula estadísticas descriptivas de un arreglo.
    
    Calcula el mínimo, máximo, media y desviación estándar ignorando
    valores NaN.
    
    Args:
        arr: Arreglo NumPy de cualquier dimensión.
    
    Returns:
        dict: Diccionario con las siguientes claves:
            - 'min' (float): Valor mínimo del arreglo.
            - 'max' (float): Valor máximo del arreglo.
            - 'mean' (float): Media del arreglo.
            - 'std' (float): Desviación estándar del arreglo.
    
    Raises:
        ValueError: Si el arreglo contiene solo valores NaN.

    """
    return {
        "min": float(np.nanmin(arr)),
        "max": float(np.nanmax(arr)),
        "mean": float(np.nanmean(arr)),
        "std": float(np.nanstd(arr)),
    }


class SingleParams(BaseModel):
    """
    Parámetros para generar un interferograma sintético individual.
    
    Modelo Pydantic que valida y encapsula todos los parámetros necesarios
    para generar un interferograma sintético basado en el modelo de punto
    fuente de Davis (1986).
    
    Atributos:
        Mw: Magnitud momento del evento sísmico [4.0, 9.5]. Se requiere
            Mw o M0.
        M0: Momento sísmico escalar en N·m (> 0). Alternativa a Mw.
        strike_deg: Rumbo de la falla en grados [0, 360].
        dip_deg: Buzamiento de la falla en grados [0, 90].
        rake_deg: Ángulo de deslizamiento en grados [-180, 180].
        xcen_km: Coordenada X del epicentro en km.
        ycen_km: Coordenada Y del epicentro en km.
        depth_km: Profundidad del evento en km (0, 700].
        grid_size: Tamaño de la grilla (32-512). Si es None, se calcula
                   desde grid_extent_km y grid_spacing_km.
        grid_extent_km: Semiancho de la grilla en km (> 0).
        grid_spacing_km: Espaciado de la grilla en km (> 0).
        nu: Razón de Poisson [0, 0.5]. Por defecto 0.25.
        mu: Módulo de corte en Pa (> 0). Por defecto 3e10 Pa.
        satellite: Nombre del satélite. Debe estar en SATELLITES.
        orbit: Órbita del satélite: 'ascending' o 'descending'.
        incidence_deg: Ángulo de incidencia en grados [0, 90].
        heading_deg: Rumbo del satélite en grados [-360, 360].
        wavelength_m: Longitud de onda de radiación en metros (> 0).
        add_noise: Si True, agrega ruido gaussiano al interferograma.
        noise_amplitude_m: Amplitud del ruido en metros (≥ 0).
        add_orbital_ramp: Si True, agrega rampa orbital polinómica.
        wrap: Si True, envuelve la fase a [-π, π].
        seed: Semilla para reproducibilidad (≥ 0). Si es None, es aleatoria.
    
    Raises:
        ValueError: Si no se proporciona Mw ni M0, o si el satélite
                    no es válido.
    """
    # Fuente sísmica — se necesita Mw o M0
    Mw: Optional[float] = Field(None, ge=4.0, le=9.5, description="Magnitud momento")
    M0: Optional[float] = Field(None, gt=0, description="Momento sísmico escalar en N·m")

    # Geometría de la falla
    strike_deg: float = Field(0.0, ge=0.0, le=360.0, description="Rumbo de la falla (°)")
    dip_deg: float = Field(45.0, ge=0.0, le=90.0, description="Buzamiento (°)")
    rake_deg: float = Field(90.0, ge=-180.0, le=180.0, description="Deslizamiento (°)")

    # Ubicación del epicentro
    xcen_km: float = Field(0.0, description="Epicentro X en km")
    ycen_km: float = Field(0.0, description="Epicentro Y en km")
    depth_km: float = Field(10.0, gt=0, le=700.0, description="Profundidad en km")

    # Parámetros de grilla
    grid_size: Optional[int] = Field(None, ge=32, le=512, description="Tamaño de la grilla (p.e. 128 → 128×128)")
    grid_extent_km: float = Field(50.0, gt=0, description="Semiancho de la grilla en km")
    grid_spacing_km: Optional[float] = Field(None, gt=0, description="Espaciado de la grilla en km")

    # Parámetros elásticos
    nu: float = Field(0.25, ge=0.0, le=0.5, description="Razón de Poisson")
    mu: float = Field(3e10, gt=0, description="Módulo de corte en Pa")

    # Geometría InSAR — satélite o manual
    satellite: Optional[str] = Field(None, description="Nombre del satélite")
    orbit: str = Field("ascending", pattern="^(ascending|descending)$")
    incidence_deg: Optional[float] = Field(None, ge=0.0, le=90.0)
    heading_deg: Optional[float] = Field(None, ge=-360.0, le=360.0)
    wavelength_m: Optional[float] = Field(None, gt=0)

    # Ruido y artefactos
    add_noise: bool = Field(True)
    noise_amplitude_m: float = Field(0.005, ge=0, description="Amplitud del ruido en metros")
    add_orbital_ramp: bool = Field(False)
    wrap: bool = Field(True)

    # Reproducibilidad
    seed: Optional[int] = Field(None, ge=0)

    @model_validator(mode="after")
    def check_source(self):
        """
        Valida que se proporcione al menos Mw o M0 y que el satélite sea válido.
        
        Returns:
            self: La instancia validada.
        
        Raises:
            ValueError: Si falta Mw y M0, o si el satélite no es válido.
        """
        if self.Mw is None and self.M0 is None:
            raise ValueError("Se debe proveer Mw o M0")
        satellites_dict = list_satellites()
        available_satellites = list(satellites_dict.keys())
        if self.satellite and self.satellite not in available_satellites:
            raise ValueError(
                f"Satélite '{self.satellite}' no soportado. "
                f"Opciones: {', '.join(available_satellites)}"
            )
        return self


class TimeseriesParams(SingleParams):
    """
    Parámetros para generar una serie temporal de interferogramas sintéticos.
    
    Extiende SingleParams con parámetros específicos para series temporales
    que incluyen frames pre-sísmicos, co-sísmicos y post-sísmicos.
    
    Atributos:
        n_pre: Número de frames pre-sismo [0, 20]. Por defecto 5.
        n_event: Número de frames del evento sísmico [1, 5]. Por defecto 1.
        n_post: Número de frames post-sismo [0, 20]. Por defecto 5.
        output_type: Tipo de salida: 'phase' (fase envuelta) o 'displacement'
                     (desplazamiento LOS). Por defecto 'phase'.
        deformation_threshold_m: Umbral de deformación en metros (≥ 0).
                                 Por defecto 0.005 m.
    
    Nota:
        Los parámetros add_noise y add_orbital_ramp de SingleParams son
        ignorados por la función generate_timeseries, que controla internamente
        el ruido mediante noise_amplitude_m.

    """
    n_pre: int = Field(5, ge=0, le=20, description="Frames pre-sismo")
    n_event: int = Field(1, ge=1, le=5, description="Frames del evento")
    n_post: int = Field(5, ge=0, le=20, description="Frames post-sismo")
    output_type: str = Field("phase", pattern="^(phase|displacement)$")
    deformation_threshold_m: float = Field(0.005, ge=0)


class BatchParams(BaseModel):
    """
    Parámetros para generar un lote de interferogramas sintéticos.
    
    Modelo Pydantic para especificar parámetros de generación de lotes
    de interferogramas sintéticos para entrenamiento de modelos.
    
    Atributos:
        n_samples: Número de muestras en el lote [1, 5000]. Por defecto 100.
        mw_range: Rango de magnitud [min, max] en escala de magnitud momento.
                  Por defecto [5.0, 7.0].
        satellite: Nombre del satélite. Debe estar en SATELLITES.
                   Por defecto "sentinel1".
        orbit: Órbita del satélite: 'ascending' o 'descending'.
               Por defecto "ascending".
        seed: Semilla para reproducibilidad (≥ 0). Si es None, es aleatoria.
    
    Raises:
        ValueError: Si mw_range no tiene exactamente 2 elementos, si
                    mw_range[0] >= mw_range[1], o si el satélite es inválido.

    """
    n_samples: int = Field(100, ge=1, le=5000, description="Número de muestras")
    mw_range: List[float] = Field([5.0, 7.0], description="Rango de magnitud [min, max]")
    satellite: str = Field("sentinel1")
    orbit: str = Field("ascending", pattern="^(ascending|descending)$")
    seed: Optional[int] = Field(None, ge=0)

    @model_validator(mode="after")
    def check_mw_range(self):
        """
        Valida que mw_range sea válido y que el satélite sea soportado.
        
        Returns:
            self: La instancia validada.
        
        Raises:
            ValueError: Si mw_range no tiene 2 elementos, es inválido,
                        o si el satélite no está soportado.
        """
        if len(self.mw_range) != 2:
            raise ValueError("mw_range debe tener exactamente 2 elementos [min, max]")
        if self.mw_range[0] >= self.mw_range[1]:
            raise ValueError("mw_range[0] debe ser menor que mw_range[1]")
        satellites_dict = list_satellites()
        available_satellites = list(satellites_dict.keys())
        if self.satellite not in available_satellites:
            raise ValueError(f"Satélite '{self.satellite}' no soportado.")
        return self


@router.get("/satellites")
def get_satellites() -> dict:
    """
    Obtiene la lista de satélites soportados.
    
    Endpoint GET que retorna todos los satélites disponibles para
    simulaciones de InSAR.
    
    Returns:
        dict: Diccionario con clave 'satellites' que contiene una lista
              de nombres de satélites soportados.
    """
    satellites_dict = list_satellites()
    satellite_names = list(satellites_dict.keys())
    return {"satellites": satellite_names}


@router.post("/generate")
def generate_single(params: SingleParams) -> JSONResponse:
    """
    Genera un interferograma sintético individual.
    
    Endpoint POST que genera un interferograma sintético basado en el
    modelo de punto fuente de Davis (1986). Retorna imágenes PNG
    codificadas en base64 para fase envuelta, fase desenvuelta,
    desplazamiento LOS y componentes de desplazamiento 3D.
    
    Args:
        params: Instancia de SingleParams con parámetros de simulación.
    
    Returns:
        JSONResponse: Respuesta JSON con estructura:
            {
                "success": True,
                "images": {
                    "phase_wrapped": str (PNG base64),
                    "phase_unwrapped": str (PNG base64),
                    "los_displacement": str (PNG base64),
                    "displacement_east": str (PNG base64),
                    "displacement_north": str (PNG base64),
                    "displacement_up": str (PNG base64)
                },
                "statistics": {
                    "los_displacement": {min, max, mean, std},
                    "phase_unwrapped": {min, max, mean, std},
                    "displacement_east": {min, max, mean, std},
                    "displacement_north": {min, max, mean, std},
                    "displacement_up": {min, max, mean, std}
                },
                "metadata": dict,
                "grid_shape": [height, width]
            }
    
    Raises:
        HTTPException: Si ocurre un error en la simulación (status 400).

    """

    try:
        kwargs = params.model_dump(exclude_none=True)
        result = generate_synthetic_insar(**kwargs)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Imágenes
    phase_noisy = result["phase_noisy"]
    phase_unwrapped = result["phase_unwrapped"]
    los_disp = result["los_displacement"]
    Ue = result["Ue"]
    Un = result["Un"]
    Uz = result["Uz"]

    # Escala para imágenes de desplazamiento
    max_abs_los = float(np.abs(los_disp).max()) or 1.0

    images = {
        "phase_wrapped": _wrapped_phase_png(phase_noisy),
        "phase_unwrapped": _array_to_png_b64(phase_unwrapped, "RdBu_r"),
        "los_displacement": _array_to_png_b64(los_disp, "RdBu_r", -max_abs_los, max_abs_los),
        "displacement_east": _array_to_png_b64(Ue, "seismic"),
        "displacement_north": _array_to_png_b64(Un, "seismic"),
        "displacement_up": _array_to_png_b64(Uz, "seismic"),
    }

    # Estadísticas
    statistics = {
        "los_displacement": _stats(los_disp),
        "phase_unwrapped": _stats(phase_unwrapped),
        "displacement_east": _stats(Ue),
        "displacement_north": _stats(Un),
        "displacement_up": _stats(Uz),
    }

    return JSONResponse({
        "success": True,
        "images": images,
        "statistics": statistics,
        "metadata": result["metadata"],
        "grid_shape": list(result["X_km"].shape),
    })


@router.post("/timeseries")
def generate_ts(params: TimeseriesParams) -> JSONResponse:
    """
    Genera una serie temporal de interferogramas sintéticos.
    
    Endpoint POST que genera una serie de interferogramas sintéticos
    que simula la evolución temporal de la deformación sísmica, incluyendo
    frames pre-sísmicos (solo ruido), co-sísmicos (señal + ruido) y
    post-sísmicos (solo ruido).
    
    Args:
        params: Instancia de TimeseriesParams con parámetros de la serie.
    
    Returns:
        JSONResponse: Respuesta JSON con estructura:
            {
                "success": True,
                "n_frames": int,
                "n_pre": int,
                "n_event": int,
                "n_post": int,
                "frames": [str, ...] (PNG base64),
                "labels": [str, ...] (PNG base64 de máscaras),
                "frame_labels": [str, ...] (etiquetas de frames),
                "metadata": dict
            }
    
    Raises:
        HTTPException: Si ocurre un error en la simulación (status 400).
    """

    try:
        all_kwargs = params.model_dump(exclude_none=True)

        TIMESERIES_EXCLUDED = {"add_noise", "add_orbital_ramp"}
        kwargs = {k: v for k, v in all_kwargs.items() if k not in TIMESERIES_EXCLUDED}

        result = generate_timeseries(**kwargs)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    timeseries_arr = result["timeseries"]       # (T, H, W)
    labels_arr = result["labels"]               # (T, H, W) — masks
    n_frames = timeseries_arr.shape[0]

    # Convertir cada frame a PNG
    frames_b64: List[str] = []
    label_b64: List[str] = []

    is_phase = params.output_type == "phase"
    cmap = "hsv" if is_phase else "RdBu_r"
    vmin = -math.pi if is_phase else None
    vmax = math.pi if is_phase else None

    for i in range(n_frames):
        frames_b64.append(_array_to_png_b64(timeseries_arr[i], cmap, vmin, vmax))
        label_b64.append(_array_to_png_b64(labels_arr[i], "Greys_r", 0, 1))

    frame_labels = (
        [f"Pre-{params.n_pre - i}" for i in range(params.n_pre)]
        + [f"Evento-{i + 1}" for i in range(params.n_event)]
        + [f"Post-{i + 1}" for i in range(params.n_post)]
    )

    return JSONResponse({
        "success": True,
        "n_frames": n_frames,
        "n_pre": params.n_pre,
        "n_event": params.n_event,
        "n_post": params.n_post,
        "frames": frames_b64,
        "labels": label_b64,
        "frame_labels": frame_labels,
        "metadata": result.get("metadata", {}),
    })


@router.post("/batch")
def generate_batch(params: BatchParams) -> JSONResponse:
    """
    Genera un lote de interferogramas sintéticos para entrenamiento.
    
    Endpoint POST que genera un conjunto de interferogramas sintéticos
    aleatorios para entrenamiento de modelos de aprendizaje automático.
    Retorna estadísticas del lote y ejemplos visuales representativos
    en lugar de todas las imágenes (para lotes grandes).
    
    Args:
        params: Instancia de BatchParams con parámetros del lote.
    
    Returns:
        JSONResponse: Respuesta JSON con estructura:
            {
                "success": True,
                "n_samples": int,
                "n_frames_per_sample": int,
                "array_shape_X": [N, T, H, W],
                "array_shape_y": [N, T, H, W],
                "mw_statistics": {
                    "min": float,
                    "max": float,
                    "mean": float,
                    "std": float
                },
                "preview_images": [str, ...] (hasta 4 PNG base64),
                "params": {
                    "satellite": str,
                    "mw_range": [float, float],
                    "seed": int or None
                }
            }
    
    Raises:
        HTTPException: Si ocurre un error en la generación (status 400).
    """

    try:
        batch = generate_training_batch(
            n_samples=params.n_samples,
            mw_range=tuple(params.mw_range),
            satellite=params.satellite,
            seed=params.seed,
        )
        X, y = batch_to_arrays(batch)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # X: (N, T, H, W), y: (N, T, H, W)
    n_samples = X.shape[0]
    n_frames = X.shape[1]

    n_preview = min(4, n_samples)
    previews: List[str] = []
    for i in range(n_preview):
        # Tomar el frame del evento (último del pre-evento, si hay más de uno)
        frame_idx = n_frames // 2
        previews.append(
            _array_to_png_b64(X[i, frame_idx], "hsv", -math.pi, math.pi)
        )

    # Estadísticas de magnitudes del batch
    mw_values = [s["Mw"] for s in batch if "Mw" in s]
    if not mw_values and batch:
        # Intentar recuperar desde metadata
        mw_values = []
        for item in batch:
            if isinstance(item, dict) and "metadata" in item:
                mw_values.append(item["metadata"].get("Mw", None))
        mw_values = [m for m in mw_values if m is not None]

    mw_stats = {}
    if mw_values:
        mw_arr = np.array(mw_values)
        mw_stats = {
            "min": float(mw_arr.min()),
            "max": float(mw_arr.max()),
            "mean": float(mw_arr.mean()),
            "std": float(mw_arr.std()),
        }

    return JSONResponse({
        "success": True,
        "n_samples": n_samples,
        "n_frames_per_sample": n_frames,
        "array_shape_X": list(X.shape),
        "array_shape_y": list(y.shape),
        "mw_statistics": mw_stats,
        "preview_images": previews,
        "params": {
            "satellite": params.satellite,
            "mw_range": params.mw_range,
            "seed": params.seed,
        },
    })
