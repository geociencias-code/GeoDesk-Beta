"""
Real MintPy InSAR velocity analysis backend.

Correct HyP3 → MintPy flow using the Python API directly:
  1. Extract HyP3 ZIPs into a work directory
  2. Write smallbaselineApp.cfg with glob patterns pointing to the TIFs
  3. Instantiate TimeSeriesAnalysis and call tsa.run() with the correct
     MintPy step names:
       load_data → reference_point → network_inversion → deramp → velocity
     (load_data internally calls prep_hyp3 to generate .rsc sidecar files)
  4. Read velocity.h5 with h5py → return JSON + write multi-sheet Excel
"""

import json
import logging
import os
import re
import shutil
import sys
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import List

from dotenv import load_dotenv
load_dotenv()

import h5py
import numpy as np
import pandas as pd
import rasterio
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/mintpy", tags=["MintPy"])

BASE_DIR = Path(__file__).resolve().parent.parent
RESULTS_DIR = BASE_DIR / "mintpy_results"
RESULTS_DIR.mkdir(exist_ok=True)
RESULTS_FILE = RESULTS_DIR / "latest_results.json"
EXCEL_FILE   = RESULTS_DIR / "velocidad_deformacion.xlsx"

MIN_INTERFEROGRAMS = 3
DATE_RE = re.compile(r"(20\d{6})T")


def _extract_dates(filename: str):
    matches = DATE_RE.findall(filename)
    if len(matches) >= 2:
        try:
            d1 = datetime.strptime(matches[0], "%Y%m%d").date()
            d2 = datetime.strptime(matches[1], "%Y%m%d").date()
            return d1, d2
        except ValueError:
            pass
    return None, None


def _make_cfg(zip_dir: Path) -> str:
    """
    Build smallbaselineApp.cfg content with glob patterns pointing to the
    extracted TIF files. MintPy's load_data step expands these globs.
    Also calculates the minimum grid intersection to avoid dropping interferograms.
    """
    unw_pat = str(zip_dir / "*" / "*_unw_phase.tif")
    cor_pat = str(zip_dir / "*" / "*_corr.tif")
    dem_pat = str(zip_dir / "*" / "*_dem.tif")
    inc_pat = str(zip_dir / "*" / "*_lv_theta.tif")
    azi_pat = str(zip_dir / "*" / "*_lv_phi.tif")

    # Find minimum dimensions across all unw_phase.tif to construct a subset bounding box
    tifs = list(zip_dir.glob("*/*_unw_phase.tif"))
    min_h = min_w = "auto"
    if tifs:
        heights = []
        widths = []
        for t in tifs:
            try:
                with rasterio.open(str(t)) as src:
                    heights.append(src.height)
                    widths.append(src.width)
            except Exception as e:
                logging.warning(f"Error reading {t} con rasterio: {e}")
        if heights and widths:
            min_h = min(heights)
            min_w = min(widths)
    
    subset_yx = f"0:{min_h},0:{min_w}" if min_h != "auto" else "auto"

    return f"""mintpy.load.processor    = hyp3
mintpy.load.unwFile      = {unw_pat}
mintpy.load.corFile      = {cor_pat}
mintpy.load.demFile      = {dem_pat}
mintpy.load.incAngleFile = {inc_pat}
mintpy.load.azAngleFile  = {azi_pat}
mintpy.subset.yx         = {subset_yx}
mintpy.network.coherenceBased     = yes
mintpy.network.minCoherence       = 0.4
mintpy.reference.lalo             = auto
mintpy.troposphericDelay.method   = pyaps
mintpy.troposphericDelay.weatherModel = ERA5
mintpy.deramp                     = linear
mintpy.topographicResidual        = no
mintpy.topographicResidual.stepFuncDate = no
mintpy.unwrapError.method         = no
mintpy.networkInversion.minTempCoh = 0.4
"""


def _run_mintpy_pipeline(work_dir: Path, zip_dir: Path) -> None:
    """
    Run MintPy TimeSeriesAnalysis pipeline via Python API.
    Raises ValueError with details on failure.

    Correct MintPy step names (from smallbaselineApp.py):
      load_data, reference_point, network_inversion, deramp, velocity
    """
    import warnings
    warnings.filterwarnings("ignore")

    # Configure MintPy logging to go to a file so it doesn't pollute FastAPI logs
    log_path = work_dir / "mintpy_run.log"
    mintpy_logger = logging.getLogger("mintpy")
    fh = logging.FileHandler(log_path)
    fh.setLevel(logging.DEBUG)
    mintpy_logger.addHandler(fh)

    cfg_path = work_dir / "mintpy.cfg"
    cfg_path.write_text(_make_cfg(zip_dir))

    # Escribir el archivo .cdsapirc requerido por PyAPS para descargar ERA5
    cds_url = os.getenv("ERA5_URL", "https://cds.climate.copernicus.eu/api")
    cds_key = os.getenv("ERA5_KEY")
    if cds_key:
        cdsapirc_path = Path.home() / ".cdsapirc"
        cdsapirc_path.write_text(f"url: {cds_url}\nkey: {cds_key}\n")

    try:
        from mintpy.smallbaselineApp import TimeSeriesAnalysis

        tsa = TimeSeriesAnalysis(
            customTemplateFile=str(cfg_path),
            workDir=str(work_dir),
        )
        tsa.open()

        # Bugfix: MintPy's calc_inv_quality returns a 1D array of size 1 for single-pixel inversions,
        # which crashes NumPy 1.24+ with "ValueError: setting an array element with a sequence."
        # We monkey-patch the estimate_timeseries function to extract the scalar and prevent the crash.
        import mintpy.ifgram_inversion as inv
        original_estimate = inv.estimate_timeseries
        
        def patched_estimate(*args, **kwargs):
            tsi, inv_quali, num_obsi = original_estimate(*args, **kwargs)
            if getattr(inv_quali, "size", 0) == 1:
                inv_quali = float(inv_quali.item())
            return tsi, inv_quali, num_obsi
            
        inv.estimate_timeseries = patched_estimate

        # Official step names from smallbaselineApp.run()
        steps = [
            "load_data",
            "reference_point",
            "invert_network",
            "correct_troposphere",
            "deramp",
            "velocity",
        ]
        tsa.run(steps=steps)

    except SystemExit as e:
        # MintPy sometimes calls sys.exit(0) on success — that's OK
        if str(e) != "0" and e.code != 0:
            log_tail = log_path.read_text()[-3000:] if log_path.exists() else "(no log)"
            raise ValueError(f"MintPy pipeline exited with code {e.code}.\nLog:\n{log_tail}")
    except Exception as e:
        log_tail = log_path.read_text()[-3000:] if log_path.exists() else "(no log)"
        
        # Intercept common MintPy failures
        err_str = str(e).lower()
        if isinstance(e, ValueError) and "sequence" in err_str:
            raise ValueError(
                "MintPy falló en la inversión de red (network_inversion). "
                "Esto casi siempre significa que MintPy descartó interferogramas "
                "(por tener distinto tamaño de grid o baja coherencia) y quedaron "
                "menos de 3 operativos. Por favor, sube más interferogramas del mismo frame."
            )
            
        raise ValueError(f"{type(e).__name__}: {e}\nLog:\n{log_tail}")
    finally:
        mintpy_logger.removeHandler(fh)
        fh.close()


# ── Main endpoint ──────────────────────────────────────────────────────────────

@router.post("/process")
async def process_interferograms(files: List[UploadFile] = File(...)):
    """
    Runs the real MintPy SBAS pipeline on a set of HyP3 interferogram ZIPs.
    """
    if len(files) < MIN_INTERFEROGRAMS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Se requieren al menos {MIN_INTERFEROGRAMS} interferogramas. "
                f"Se subieron {len(files)}."
            ),
        )
    for f in files:
        if not (f.filename or "").lower().endswith(".zip"):
            raise HTTPException(
                status_code=400,
                detail=f"'{f.filename}' no es un .zip.",
            )

    work_dir = Path(tempfile.mkdtemp(prefix="mintpy_run_"))
    zip_dir  = work_dir / "hyp3_products"
    zip_dir.mkdir()

    try:
        # ── 1. Save + extract ZIPs ─────────────────────────────────────────────
        igram_meta = []
        for upload in files:
            raw  = await upload.read()
            zname = upload.filename or "interferogram.zip"
            zip_bytes = zip_dir / zname
            zip_bytes.write_bytes(raw)

            d1, d2 = _extract_dates(zname)
            if d1 is None or d2 is None:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"No se pudieron extraer fechas de '{zname}'. "
                        "El nombre debe seguir el formato HyP3/ASF estándar."
                    ),
                )
            igram_meta.append({
                "filename": zname,
                "date1": d1.isoformat(),
                "date2": d2.isoformat(),
                "days": abs((d2 - d1).days),
            })

            # The ZIP contains a top-level folder — extract directly into zip_dir
            with zipfile.ZipFile(zip_bytes, "r") as zf:
                zf.extractall(zip_dir)
            zip_bytes.unlink()  # remove .zip to save space

        # ── 2. Run MintPy pipeline ─────────────────────────────────────────────
        try:
            _run_mintpy_pipeline(work_dir, zip_dir)
        except ValueError as exc:
            raise HTTPException(status_code=500, detail=str(exc))

        velocity_h5 = work_dir / "velocity.h5"
        if not velocity_h5.exists():
            # Check the log for clues
            log_tail = (work_dir / "mintpy_run.log").read_text()[-3000:] \
                if (work_dir / "mintpy_run.log").exists() else "(no log)"
            
            if "WARNING: NOT all input unwrapped interferograms have the same row/column number" in log_tail:
                 raise HTTPException(
                     status_code=422,
                     detail="MintPy descartó algunos interferogramas porque tienen diferente tamaño (filas/columnas). Sube más archivos para asegurar al menos 3 válidos."
                 )
                
            h5_found = [str(f.relative_to(work_dir)) for f in work_dir.rglob("*.h5")]
            raise HTTPException(
                status_code=500,
                detail=(
                    f"MintPy no generó velocity.h5.\n"
                    f"H5 encontrados: {h5_found}\n"
                    f"Log:\n{log_tail}"
                ),
            )

        geometry_geo = work_dir / "inputs" / "geometryGeo.h5"

        # ── 4. Read results ────────────────────────────────────────────────────
        with h5py.File(velocity_h5, "r") as vf:
            vel_data  = vf["velocity"][:]          # 2D (rows × cols) in m/yr
            vel_mm    = vel_data * 1000.0           # → mm/yr
            vel_attrs = dict(vf.attrs)

        use_grid = False
        if geometry_geo.exists():
            with h5py.File(geometry_geo, "r") as gf:
                if "latitude" in gf and "longitude" in gf:
                    lat_grid = gf["latitude"][:]
                    lon_grid = gf["longitude"][:]
                    use_grid = True
        
        if not use_grid:
            lat0 = float(vel_attrs.get("Y_FIRST", 0))
            lon0 = float(vel_attrs.get("X_FIRST", 0))
            dlat = float(vel_attrs.get("Y_STEP",  -0.001))
            dlon = float(vel_attrs.get("X_STEP",   0.001))
            rows, cols = vel_mm.shape
            lat_arr = lat0 + np.arange(rows) * dlat
            lon_arr = lon0 + np.arange(cols) * dlon
            lon_grid, lat_grid = np.meshgrid(lon_arr, lat_arr)

        # Valid pixels = finite and inside temporal-coherence mask (MintPy sets NaN/0 for masked px)
        valid = np.isfinite(vel_mm) & (vel_mm != 0.0)

        lats_v = lat_grid[valid].flatten()
        lons_v = lon_grid[valid].flatten()
        vels_v = vel_mm[valid].flatten()

        if len(vels_v) == 0:
            raise HTTPException(
                status_code=422,
                detail="MintPy no encontró píxeles coherentes. "
                       "Verifica la cobertura y coherencia de tus interferogramas.",
            )

        # ── 5. Build results list ──────────────────────────────────────────────
        results = [
            {
                "lat": round(float(lats_v[i]), 4),
                "lon": round(float(lons_v[i]), 4),
                "velocidad_mm_yr": round(float(vels_v[i]), 2),
            }
            for i in range(len(vels_v))
        ]

        # ── 6. Statistics ──────────────────────────────────────────────────────
        all_dates = [m["date1"] for m in igram_meta] + [m["date2"] for m in igram_meta]
        stats = {
            "min":              round(float(np.min(vels_v)),  2),
            "max":              round(float(np.max(vels_v)),  2),
            "mean":             round(float(np.mean(vels_v)), 2),
            "std":              round(float(np.std(vels_v)),  2),
            "n_points":         len(results),
            "n_interferograms": len(files),
            "date_start":       min(all_dates),
            "date_end":         max(all_dates),
        }

        step_s = max(1, len(results) // 500)
        sample = results[::step_s][:500]

        output = {"stats": stats, "interferograms": igram_meta, "sample": sample}
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        RESULTS_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2))

        # ── 7. Multi-sheet Excel ───────────────────────────────────────────────
        EXCEL_MAX = 1_000_000
        with pd.ExcelWriter(EXCEL_FILE, engine="openpyxl") as writer:
            # Hoja 1: Velocidad Lineal Promedio
            df_res = pd.DataFrame(results)
            df_res.columns = ["Latitud", "Longitud", "Velocidad_mm_año"]
            if len(df_res) > EXCEL_MAX:
                df_res = df_res.iloc[:: len(df_res) // EXCEL_MAX].head(EXCEL_MAX)
            df_res.to_excel(writer, sheet_name="Velocidad_SBAS", index=False)

            # Hoja 2: Metadata de Interferogramas
            df_igs = pd.DataFrame(igram_meta)
            df_igs.columns = ["Archivo", "Fecha_1", "Fecha_2", "Días_baseline"]
            df_igs.to_excel(writer, sheet_name="Interferogramas_Info", index=False)

            # Hojas 3+: Una por interferograma con sus desplazamientos 
            if_stack = work_dir / "inputs" / "ifgramStack.h5"
            era5_model = work_dir / "inputs" / "ERA5.h5"
            
            if if_stack.exists():
                with h5py.File(if_stack, "r") as stack_f:
                    if "unwrapPhase" in stack_f and "date" in stack_f:
                        dates_array = stack_f["date"][:]
                        phase_array = stack_f["unwrapPhase"][:]
                        
                        # Extraer wavelength para InSAR Math
                        wvl = float(stack_f.attrs.get("WAVELENGTH", 0.05546576))
                        rad2mm = (-1 * wvl / (4 * np.pi)) * 1000.0

                        # Tratar de cargar el modelo atmosférico si existe
                        aps_array = None
                        if era5_model.exists():
                            with h5py.File(era5_model, "r") as ef:
                                if "unwrapPhase" in ef:
                                    aps_array = ef["unwrapPhase"][:]
                                elif "timeseries" in ef:
                                    # PyAPS ERA5 a veces genera un cubo por fecha, no por interferograma original
                                    # lo ignoramos para mantener la robustez si el shape no coincide
                                    pass

                        # Recorrer cada interferograma pero usando los mismos índices de 'sample'
                        sample_indices = list(range(0, len(lats_v), step_s))[:500]
                        
                        for idx, d_pair in enumerate(dates_array):
                            # d_pair es típicamente b'20250101-20250113'
                            sheet_title = d_pair[0].decode("utf-8") if isinstance(d_pair, np.ndarray) and len(d_pair) > 0 else "Unk"
                            if isinstance(d_pair, (list, tuple, np.ndarray)) and len(d_pair) >= 2:
                                sheet_title = f"{d_pair[0].decode('utf-8')}_{d_pair[1].decode('utf-8')}"
                            
                            # Fase de este interferograma: [rows, cols]
                            phase_2d = phase_array[idx]
                            phase_1d = phase_2d[valid].flatten()
                            phase_sample = [phase_1d[i] for i in sample_indices]
                            
                            # Desplazamiento = Fase_rad * rad2mm
                            disp_mm = [p * rad2mm for p in phase_sample]

                            sheet_data = {
                                "Lat": [s["lat"] for s in sample],
                                "Lon": [s["lon"] for s in sample],
                                "Desplazamiento_mm": [round(float(d), 2) for d in disp_mm]
                            }

                            if aps_array is not None and idx < len(aps_array):
                                aps_2d = aps_array[idx]
                                aps_1d = aps_2d[valid].flatten()
                                aps_sample = [aps_1d[i] for i in sample_indices]
                                # APS en interferogramas ERA5 ya suele estar en radianes o metros
                                # MintPy guarda APS típicamente en metros en ERA5.h5
                                sheet_data["ERA5_APS_m"] = [round(float(a), 4) for a in aps_sample]

                            df_if = pd.DataFrame(sheet_data)
                            # Truncar nombre a 31 chars máximo para Excel
                            sheet_name_safe = sheet_title[:31] 
                            df_if.to_excel(writer, sheet_name=sheet_name_safe, index=False)

        stats["excel_rows"] = len(df_res)
        return output

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


# ── Read-only endpoints ────────────────────────────────────────────────────────

@router.get("/results")
def get_results():
    if not RESULTS_FILE.exists():
        raise HTTPException(
            status_code=404,
            detail="No hay resultados. Procesa interferogramas primero.",
        )
    return json.loads(RESULTS_FILE.read_text())


@router.get("/export")
def export_excel():
    if not EXCEL_FILE.exists():
        raise HTTPException(
            status_code=404,
            detail="No hay datos para exportar. Procesa interferogramas primero.",
        )
    return FileResponse(
        EXCEL_FILE,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="velocidad_deformacion_mintpy.xlsx",
    )
