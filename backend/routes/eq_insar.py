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
import matplotlib.colors as mcolors

# EQ-INSAR
try:
    from eq_insar import (
        generate_synthetic_insar,
        generate_timeseries,
        generate_training_batch,
        batch_to_arrays,
        list_satellites,
    )
    EQ_INSAR_AVAILABLE = True
except ImportError:
    EQ_INSAR_AVAILABLE = False


router = APIRouter(prefix="/api/eq_insar", tags=["EQ-INSAR"])

SATELLITES = [
    "sentinel1", "alos2", "terrasar", "cosmo",
    "radarsat2", "nisar", "saocom", "envisat", "iceye",
]


def _check_available() -> None:
    if not EQ_INSAR_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="La librería eq-insar no está instalada. "
                   "Ejecuta: pip install eq-insar",
        )


def _array_to_png_b64(arr: np.ndarray, cmap: str = "RdBu_r", vmin=None, vmax=None) -> str:
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
    return _array_to_png_b64(phase, cmap="hsv", vmin=-math.pi, vmax=math.pi)


def _stats(arr: np.ndarray) -> dict:
    return {
        "min": float(np.nanmin(arr)),
        "max": float(np.nanmax(arr)),
        "mean": float(np.nanmean(arr)),
        "std": float(np.nanstd(arr)),
    }


class SingleParams(BaseModel):
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
        if self.Mw is None and self.M0 is None:
            raise ValueError("Se debe proveer Mw o M0")
        if self.satellite and self.satellite not in SATELLITES:
            raise ValueError(
                f"Satélite '{self.satellite}' no soportado. "
                f"Opciones: {', '.join(SATELLITES)}"
            )
        return self


class TimeseriesParams(SingleParams):
    n_pre: int = Field(5, ge=0, le=20, description="Frames pre-sismo")
    n_event: int = Field(1, ge=1, le=5, description="Frames del evento")
    n_post: int = Field(5, ge=0, le=20, description="Frames post-sismo")
    output_type: str = Field("phase", pattern="^(phase|displacement)$")
    deformation_threshold_m: float = Field(0.005, ge=0)


class BatchParams(BaseModel):
    n_samples: int = Field(100, ge=1, le=5000, description="Número de muestras")
    mw_range: List[float] = Field([5.0, 7.0], description="Rango de magnitud [min, max]")
    satellite: str = Field("sentinel1")
    orbit: str = Field("ascending", pattern="^(ascending|descending)$")
    seed: Optional[int] = Field(None, ge=0)

    @model_validator(mode="after")
    def check_mw_range(self):
        if len(self.mw_range) != 2:
            raise ValueError("mw_range debe tener exactamente 2 elementos [min, max]")
        if self.mw_range[0] >= self.mw_range[1]:
            raise ValueError("mw_range[0] debe ser menor que mw_range[1]")
        if self.satellite not in SATELLITES:
            raise ValueError(f"Satélite '{self.satellite}' no soportado.")
        return self


@router.get("/satellites")
def get_satellites():
    return {"satellites": SATELLITES}


@router.post("/generate")
def generate_single(params: SingleParams):
    """
    Genera un interferograma sintético individual basado en el modelo
    de punto fuente de Davis (1986).

    Retorna imágenes PNG en base64: fase envuelta, fase desenvuelta,
    desplazamiento LOS, y los tres componentes de desplazamiento.
    """
    _check_available()

    try:
        kwargs = params.model_dump(exclude_none=True)
        result = generate_synthetic_insar(**kwargs)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # --- Imágenes ---
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

    # --- Estadísticas ---
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
def generate_ts(params: TimeseriesParams):
    """
    Genera una serie de tiempo de interferogramas sintéticos.
    Incluye frames pre-sismo (solo ruido), co-sísmicos (señal + ruido)
    y post-sísmicos (solo ruido).
    """
    _check_available()

    try:
        kwargs = params.model_dump(exclude_none=True)
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
def generate_batch(params: BatchParams):
    """
    Genera un lote de interferogramas sintéticos aleatorios para
    entrenamiento de modelos de ML/DL.

    Retorna estadísticas descriptivas del lote. No devuelve imágenes
    individuales (lotes grandes), sino ejemplos representativos.
    """
    _check_available()

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

    # Algunos ejemplos visuales (primeros 4)
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
