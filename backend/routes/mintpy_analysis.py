import json
import logging
import os
import re
import shutil
import tempfile
import zipfile
import pyproj
from datetime import datetime
from pathlib import Path
from typing import List
import warnings
from dotenv import load_dotenv
load_dotenv()
import h5py
from mintpy.smallbaselineApp import TimeSeriesAnalysis
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
    """Generates a MintPy configuration file for SBAS processing.

    Constructs a configuration file (.cfg) with the necessary parameters
    to run the MintPy time-series analysis pipeline. The function automatically
    detects the minimum dimensions of available interferograms to ensure
    compatibility across all files.

    Args:
        zip_dir (Path): Path to the directory containing extracted interferograms.
            Expected to follow the standard HyP3 directory structure with
            subdirectories for each interferogram.

    Returns:
        str: Formatted configuration string with MintPy parameters ready for
            processing. Contains paths to input files (unwrapped phase, coherence,
            DEM, angles) and pipeline control parameters.

    Raises:
        ValueError: If zip_dir does not contain valid interferograms (.tif files).

    Warning:
        DO NOT add tabs (\t) to the returned string.
        MintPy requires whitespace characters as configuration delimiters.
        Tabs will cause parsing errors and silent failures in network inversion.

    """
    unw_pat = str(zip_dir / "*" / "*_unw_phase.tif")
    cor_pat = str(zip_dir / "*" / "*_corr.tif")
    dem_pat = str(zip_dir / "*" / "*_dem.tif")
    inc_pat = str(zip_dir / "*" / "*_lv_theta.tif")
    azi_pat = str(zip_dir / "*" / "*_lv_phi.tif")

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
    """Executes the complete MintPy SBAS time-series analysis pipeline.

    Orchestrates the full MintPy processing workflow from interferogram loading
    through deformation velocity estimation. Handles configuration generation,
    atmospheric data setup, and applies necessary patches for NumPy compatibility.

    Args:
        work_dir (Path): Working directory where MintPy outputs and logs will be
            stored. Created files include velocity.h5, interferogram stack, and
            atmospheric correction models.
        zip_dir (Path): Directory containing extracted HyP3 interferogram products.
            Should have been populated by unzipping multiple HyP3 product archives.

    Returns:
        None

    Raises:
        ValueError: If the MintPy pipeline fails during any processing step. The
            exception message includes the last 3000 characters of the log file
            for debugging. Specific error conditions include:
            - Network inversion failures
            - NumPy array dimension mismatches
            - MintPy SystemExit with non-zero code
            - Missing or incompatible interferogram data


    Note:
        - Executes 6 sequential processing steps:
          1. load_data: Load interferograms and associated data
          2. reference_point: Establish reference point for unwrapped phase
          3. invert_network: Invert interferogram network for time series
          4. correct_troposphere: Apply ERA5-based atmospheric delay correction
          5. deramp: Remove linear phase ramps from interferograms
          6. velocity: Calculate deformation velocities
    """
    warnings.filterwarnings("ignore")

    log_path = work_dir / "mintpy_run.log"
    mintpy_logger = logging.getLogger("mintpy")
    fh = logging.FileHandler(log_path)
    fh.setLevel(logging.DEBUG)
    mintpy_logger.addHandler(fh)

    cfg_path = work_dir / "mintpy.cfg"
    cfg_path.write_text(_make_cfg(zip_dir))

    cds_url = os.getenv("ERA5_URL", "https://cds.climate.copernicus.eu/api")
    cds_key = os.getenv("ERA5_KEY")
    if cds_key:
        cdsapirc_path = Path.home() / ".cdsapirc"
        cdsapirc_path.write_text(f"url: {cds_url}\nkey: {cds_key}\n")

    try:
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
        if str(e) != "0" and e.code != 0:
            log_tail = log_path.read_text()[-3000:] if log_path.exists() else "(no log)"
            raise ValueError(f"MintPy pipeline exited with code {e.code}.\nLog:\n{log_tail}")
    except Exception as e:
        log_tail = log_path.read_text()[-3000:] if log_path.exists() else "(no log)"

        err_str = str(e).lower()
        if isinstance(e, ValueError) and "sequence" in err_str:
            raise ValueError(
                "MintPy falló en la inversión de red (network_inversion)."
            )
            
        raise ValueError(f"{type(e).__name__}: {e}\nLog:\n{log_tail}")
    finally:
        mintpy_logger.removeHandler(fh)
        fh.close()



@router.post("/process")
async def process_interferograms(files: List[UploadFile] = File(...)):
    """Processes HyP3 interferogram products through the MintPy SBAS pipeline.

    Orchestrates the complete workflow for time-series deformation analysis:
    receives compressed HyP3 interferogram products, validates input, extracts
    and decompresses data, runs the MintPy Small Baseline Subset (SBAS) processing
    pipeline, and generates comprehensive velocity and displacement results with
    geographic georeferencing.

    This endpoint handles coordinate system transformations (UTM to WGS84 if needed),
    median filtering to remove reference point bias, and exports results in both
    JSON and Excel formats with detailed per-interferogram displacement data.

    Args:
        files (List[UploadFile]): List of uploaded ZIP files containing HyP3
            interferogram products. Each ZIP must contain:
            - *_unw_phase.tif: Unwrapped interferometric phase (radians)
            - *_corr.tif: Coherence map [0, 1]
            - *_dem.tif: Digital elevation model (meters)
            - *_lv_theta.tif: Local incidence angle (radians)
            - *_lv_phi.tif: Local azimuth angle (radians)

            Filenames must follow HyP3/ASF naming convention:
            S1[AB]A_YYYYMMDDTHHMMSS_YYYYMMDDTHHMMSS_*.zip

    Returns:
        dict: Processing results containing:
            - stats (dict): Summary statistics with keys:
                - min (float): Minimum velocity in mm/yr
                - max (float): Maximum velocity in mm/yr
                - mean (float): Mean velocity in mm/yr
                - std (float): Standard deviation of velocities
                - n_points (int): Number of valid measurements
                - n_interferograms (int): Number of input interferograms
                - date_start (str): ISO format start date
                - date_end (str): ISO format end date
                - excel_rows (int): Total rows exported to Excel

            - interferograms (list): Metadata for each input interferogram with keys:
                - filename (str): Input ZIP filename
                - date1 (str): ISO format acquisition start date
                - date2 (str): ISO format acquisition end date
                - days (int): Temporal baseline in days

            - sample (list): Georeferenced velocity sample (max 500 points) with keys:
                - lat (float): WGS84 latitude, precision 4 decimals
                - lon (float): WGS84 longitude, precision 4 decimals
                - velocidad_mm_yr (float): LOS deformation velocity, precision 2 decimals

    Raises:
        HTTPException (400): If fewer than MIN_INTERFEROGRAMS (3) files provided,
            if any file is not a .zip archive, or if date extraction from filename
            fails. Status code 400.

        HTTPException (422): If MintPy rejects interferograms due to dimension
            mismatch (rows/columns differ across dataset), or if final velocity.h5
            contains no coherent pixels. Status code 422.

        HTTPException (500): If MintPy pipeline execution fails, velocity.h5 is not
            generated after successful pipeline run, or critical intermediate files
            are missing. Response includes last 3000 characters of mintpy_run.log
            for debugging. Status code 500.
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

            with zipfile.ZipFile(zip_bytes, "r") as zf:
                zf.extractall(zip_dir)
            zip_bytes.unlink()

        try:
            _run_mintpy_pipeline(work_dir, zip_dir)
        except ValueError as exc:
            raise HTTPException(status_code=500, detail=str(exc))

        velocity_h5 = work_dir / "velocity.h5"
        if not velocity_h5.exists():
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

        with h5py.File(velocity_h5, "r") as vf:
            vel_data  = vf["velocity"][:] # 2D (rows × cols) in m/yr
            vel_mm    = vel_data * 1000.0
            vel_attrs = dict(vf.attrs)

        # Centrar la velocidad restando la mediana estadística (evita el sesgo del píxel de referencia de MintPy)
        vmask = np.isfinite(vel_mm) & (vel_mm != 0.0)
        median_vel = np.nanmedian(vel_mm[vmask])
        if not np.isnan(median_vel):
            vel_mm[vmask] -= median_vel


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
            
            # Si los valores exceden los límites de grados, están en proyeccion UTM
            if abs(lat0) > 90 or abs(lon0) > 180:
                epsg = vel_attrs.get("EPSG", 32616)
                if isinstance(epsg, (np.ndarray, bytes)):
                    try:
                        epsg = int(epsg)
                    except ValueError:
                        epsg = 32616
                try:
                    transformer = pyproj.Transformer.from_crs(int(epsg), 4326, always_xy=True)
                    lon_grid, lat_grid = transformer.transform(lon_grid, lat_grid)
                except Exception as e:
                    logging.warning(f"Error convirtiendo de UTM a WGS84: {e}")

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

        results = [
            {
                "lat": round(float(lats_v[i]), 4),
                "lon": round(float(lons_v[i]), 4),
                "velocidad_mm_yr": round(float(vels_v[i]), 2),
            }
            for i in range(len(vels_v))
        ]

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

        EXCEL_MAX = 1_000_000
        
        # Decide which indices to use for Excel exports to avoid exceeding max rows
        step_excel = 1
        if len(results) > EXCEL_MAX:
            step_excel = len(results) // EXCEL_MAX
        
        excel_indices = list(range(0, len(results), step_excel))[:EXCEL_MAX]
        
        with pd.ExcelWriter(EXCEL_FILE, engine="openpyxl") as writer:
            # Hoja 1: Velocidad Lineal Promedio
            df_res = pd.DataFrame([results[i] for i in excel_indices])
            df_res.columns = ["Latitud", "Longitud", "Velocidad_mm_año"]
            df_res.to_excel(writer, sheet_name="Velocidad_SBAS", index=False)

            # Hoja 2: Metadata de Interferogramas
            df_igs = pd.DataFrame(igram_meta)
            df_igs.columns = ["Archivo", "Fecha_1", "Fecha_2", "Días_baseline"]
            df_igs.to_excel(writer, sheet_name="Interferogramas_Info", index=False)

            # Hoja 3: Todos los interferogramas juntos (Desplazamiento y Error APS en mm)
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
                        aps_dates = None
                        if era5_model.exists():
                            with h5py.File(era5_model, "r") as ef:
                                if "unwrapPhase" in ef:
                                    aps_array = ef["unwrapPhase"][:]
                                elif "timeseries" in ef and "date" in ef:
                                    aps_array = ef["timeseries"][:]
                                    aps_dates = [d.decode("utf-8") for d in ef["date"][:]]
                        
                        # Inicializar datos con coordenadas completas
                        sheet_data = {
                            "Lat": [results[i]["lat"] for i in excel_indices],
                            "Lon": [results[i]["lon"] for i in excel_indices]
                        }
                        
                        for idx, d_pair in enumerate(dates_array):
                            if isinstance(d_pair, (list, tuple, np.ndarray)) and len(d_pair) >= 2:
                                d1 = d_pair[0].decode("utf-8")
                                d2 = d_pair[1].decode("utf-8")
                                col_suffix = f"{d1}_{d2}"
                            else:
                                col_suffix = f"Unk_{idx}"
                                d1 = d2 = None
                            
                            # Fase de este interferograma: [rows, cols]
                            phase_2d = phase_array[idx]
                            
                            # Centrar por mediana
                            pmask = np.isfinite(phase_2d) & (phase_2d != 0.0)
                            median_phase = np.nanmedian(phase_2d[pmask])
                            if not np.isnan(median_phase):
                                phase_2d[pmask] -= median_phase

                            phase_1d = phase_2d[valid].flatten()
                            
                            # Desplazamiento = Fase_rad * rad2mm
                            disp_mm = [round(float(phase_1d[i] * rad2mm), 2) for i in excel_indices]
                            sheet_data[f"Def_{col_suffix}_mm"] = disp_mm
                            
                            if aps_array is not None:
                                aps_1d = None
                                if aps_dates is not None and d1 and d2:
                                    # Viene de un cubo timeseries
                                    if d1 in aps_dates and d2 in aps_dates:
                                        idx1 = aps_dates.index(d1)
                                        idx2 = aps_dates.index(d2)
                                        aps_2d = aps_array[idx2] - aps_array[idx1]
                                        aps_1d = aps_2d[valid].flatten()
                                else:
                                    # Viene de un cubo ifgramStack
                                    if idx < len(aps_array):
                                        aps_2d = aps_array[idx]
                                        aps_1d = aps_2d[valid].flatten()
                                
                                if aps_1d is not None:
                                    # Convertimos el valor asumiendo m -> mm (multiplicando por 1000)
                                    aps_mm = [round(float(aps_1d[i] * 1000.0), 4) for i in excel_indices]
                                    sheet_data[f"Err_{col_suffix}_mm"] = aps_mm

                        df_if = pd.DataFrame(sheet_data)
                        df_if.to_excel(writer, sheet_name="Interferogramas_Datos", index=False)

        stats["excel_rows"] = len(df_res)
        return output

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)



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
