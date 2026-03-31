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
from fastapi import APIRouter, File, HTTPException, UploadFile, Form
from fastapi.responses import FileResponse
import rasterio.warp
from rasterio.windows import Window

router = APIRouter(prefix="/api/mintpy", tags=["MintPy"])

BASE_DIR = Path(__file__).resolve().parent.parent
RESULTS_DIR = BASE_DIR / "mintpy_results"
RESULTS_DIR.mkdir(exist_ok=True)
RESULTS_FILE = RESULTS_DIR / "latest_results.json"
CSV_FILE     = RESULTS_DIR / "velocidad_deformacion.csv"

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


def _make_cfg(
    zip_dir: Path, 
    ref_lat: float = None, 
    ref_lon: float = None,
    crop_lat_min: float = None,
    crop_lat_max: float = None,
    crop_lon_min: float = None,
    crop_lon_max: float = None
) -> str:
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
    ref_lalo = f"{ref_lat},{ref_lon}" if ref_lat is not None and ref_lon is not None else "auto"

    subset_lalo = "auto"
    if crop_lat_min is not None and crop_lat_max is not None and crop_lon_min is not None and crop_lon_max is not None:
        subset_lalo = f"{crop_lat_min}:{crop_lat_max},{crop_lon_min}:{crop_lon_max}"
        subset_yx = "no"

    return f"""mintpy.load.processor    = hyp3
mintpy.load.unwFile      = {unw_pat}
mintpy.load.corFile      = {cor_pat}
mintpy.load.demFile      = {dem_pat}
mintpy.load.incAngleFile = {inc_pat}
mintpy.load.azAngleFile  = {azi_pat}
mintpy.subset.lalo       = {subset_lalo}
mintpy.subset.yx         = {subset_yx}
mintpy.network.coherenceBased     = yes
mintpy.network.minCoherence       = 0.4
mintpy.reference.lalo             = {ref_lalo}
mintpy.troposphericDelay.method   = pyaps
mintpy.troposphericDelay.weatherModel = ERA5
mintpy.deramp                     = linear
mintpy.topographicResidual        = no
mintpy.topographicResidual.stepFuncDate = no
mintpy.unwrapError.method         = no
mintpy.networkInversion.minTempCoh = 0.4
"""


def _run_mintpy_pipeline(
    work_dir: Path, 
    zip_dir: Path, 
    ref_lat: float = None, 
    ref_lon: float = None,
    crop_lat_min: float = None,
    crop_lat_max: float = None,
    crop_lon_min: float = None,
    crop_lon_max: float = None
) -> None:
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
    cfg_path.write_text(_make_cfg(zip_dir, ref_lat, ref_lon, crop_lat_min, crop_lat_max, crop_lon_min, crop_lon_max))

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
async def process_interferograms(
    files: List[UploadFile] = File(...),
    ref_lat: float = Form(None),
    ref_lon: float = Form(None),
    crop_lat_min: float = Form(None),
    crop_lat_max: float = Form(None),
    crop_lon_min: float = Form(None),
    crop_lon_max: float = Form(None)
):
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
        igram_pre_meta = []
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

            with zipfile.ZipFile(zip_bytes, "r") as zf:
                top_level = {p.split('/')[0] for p in zf.namelist() if '/' in p}
                zf.extractall(zip_dir)
            zip_bytes.unlink()

            extracted_folder = list(top_level)[0] if top_level else zname.replace('.zip', '')
            igram_pre_meta.append({
                "filename": zname,
                "date1": d1,
                "date2": d2,
                "days": abs((d2 - d1).days),
                "extracted_folder": extracted_folder
            })

        # Forzar un determinismo estricto ordenando cronológicamente
        igram_pre_meta.sort(key=lambda x: (x["date1"], x["date2"], x["filename"]))

        igram_meta = []
        for idx, meta in enumerate(igram_pre_meta):
            old_path = zip_dir / meta["extracted_folder"]
            new_path = zip_dir / f"{idx:04d}_{meta['extracted_folder']}"
            if old_path.exists():
                old_path.rename(new_path)
            
            igram_meta.append({
                "filename": meta["filename"],
                "date1": meta["date1"].isoformat(),
                "date2": meta["date2"].isoformat(),
                "days": meta["days"],
            })

        try:
            _run_mintpy_pipeline(work_dir, zip_dir, ref_lat, ref_lon, crop_lat_min, crop_lat_max, crop_lon_min, crop_lon_max)
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

        era5_model = work_dir / "inputs" / "ERA5.h5"
        era5_success = era5_model.exists()

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
            "era5_successful":  era5_success,
        }

        step_s = max(1, len(results) // 1000)
        sample = results[::step_s][:1000]

        igram_stats = []
        if_stack = work_dir / "inputs" / "ifgramStack.h5"

        if if_stack.exists():
            with h5py.File(if_stack, "r") as stack_f:
                if "unwrapPhase" in stack_f and "date" in stack_f:
                    dates_array = stack_f["date"][:]
                    phase_array = stack_f["unwrapPhase"][:]
                    wvl = float(stack_f.attrs.get("WAVELENGTH", 0.05546576))
                    rad2mm = (-1 * wvl / (4 * np.pi)) * 1000.0

                    aps_array = None
                    aps_dates = None
                    if era5_model.exists():
                        with h5py.File(era5_model, "r") as ef:
                            if "unwrapPhase" in ef:
                                aps_array = ef["unwrapPhase"][:]
                            elif "timeseries" in ef and "date" in ef:
                                aps_array = ef["timeseries"][:]
                                aps_dates = [d.decode("utf-8") for d in ef["date"][:]]

                    df_all_data = pd.DataFrame()
                    df_all_data["Lat"] = np.round(lats_v, 6)
                    df_all_data["Lon"] = np.round(lons_v, 6)
                    df_all_data["Velocidad_mm_año"] = np.round(vels_v, 2)
                    
                    for idx, d_pair in enumerate(dates_array):
                        if isinstance(d_pair, (list, tuple, np.ndarray)) and len(d_pair) >= 2:
                            d1 = d_pair[0].decode("utf-8")
                            d2 = d_pair[1].decode("utf-8")
                            col_suffix = f"{d1}_{d2}"
                        else:
                            col_suffix = f"Unk_{idx}"
                            d1 = d2 = None
                            
                        phase_2d = phase_array[idx].copy()
                        pmask = np.isfinite(phase_2d) & (phase_2d != 0.0)
                        median_phase = np.nanmedian(phase_2d[pmask])
                        if not np.isnan(median_phase):
                            phase_2d[pmask] -= median_phase

                        phase_1d = phase_2d[valid].flatten()
                        def_mm_arr = phase_1d * rad2mm
                        df_all_data[f"Def_{col_suffix}_mm"] = np.round(def_mm_arr, 2)
                        
                        if d1 and d2:
                            igram_stats.append({
                                "date1": d1,
                                "date2": d2,
                                "label": f"{d1} -> {d2}",
                                "mean": round(float(np.mean(def_mm_arr)), 2),
                                "std": round(float(np.std(def_mm_arr)), 2),
                                "max": round(float(np.max(def_mm_arr)), 2),
                                "min": round(float(np.min(def_mm_arr)), 2),
                            })
                            
                        if aps_array is not None:
                            aps_1d = None
                            if aps_dates is not None and d1 and d2:
                                if d1 in aps_dates and d2 in aps_dates:
                                    idx1 = aps_dates.index(d1)
                                    idx2 = aps_dates.index(d2)
                                    aps_2d = aps_array[idx2] - aps_array[idx1]
                                    aps_1d = aps_2d[valid].flatten()
                            else:
                                if idx < len(aps_array):
                                    aps_2d = aps_array[idx]
                                    aps_1d = aps_2d[valid].flatten()
                                    
                            if aps_1d is not None:
                                df_all_data[f"Err_{col_suffix}_mm"] = np.round(aps_1d * 1000.0, 4)
                                
                    df_all_data.to_csv(CSV_FILE, index=False)
        else:
            df_csv = pd.DataFrame(results)
            df_csv.columns = ["Latitud", "Longitud", "Velocidad_mm_año"]
            df_csv.to_csv(CSV_FILE, index=False)

        output = {
            "stats": stats, 
            "interferograms": igram_meta, 
            "igram_stats": igram_stats,
            "sample": sample
        }
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        RESULTS_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2))

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


@router.post("/preview_reference")
async def preview_reference(
        files: List[UploadFile] = File(...),
        crop_lat_min: float = Form(None),
        crop_lat_max: float = Form(None),
        crop_lon_min: float = Form(None),
        crop_lon_max: float = Form(None),
):
    """Generates a preview of optimal reference points for MintPy from ZIP files containing interferograms.

    This function receives multiple ZIP files with interferograms, extracts coherence maps, computes the coherence sum
    in the common region, and determines the point with the highest coherence. Optionally, it crops the area of
    interest according to the provided geographic bounds. Returns the suggested seed points for MintPy spatial
    referencing.

    Args:
        files (List[UploadFile]): List of uploaded ZIP files, each containing an interferogram.
        crop_lat_min (float, optional): Lower latitude bound for geographic cropping.
        crop_lat_max (float, optional): Upper latitude bound for geographic cropping.
        crop_lon_min (float, optional): Lower longitude bound for geographic cropping.
        crop_lon_max (float, optional): Upper longitude bound for geographic cropping.

    Returns:
        dict: Dictionary with the key 'seed_points', containing a list of suggested reference
        points (lat, lon, is_mintpy_default).

    Raises:
        HTTPException: If there are fewer than the required minimum interferograms, if no coherence
        files are found, or if there are no valid pixels in the selected area.
    """
    
    if len(files) < MIN_INTERFEROGRAMS:
        raise HTTPException(
            status_code=400,
            detail=f"Se requieren al menos {MIN_INTERFEROGRAMS} interferogramas."
        )

    work_dir = Path(tempfile.mkdtemp(prefix="mintpy_prev_"))
    zip_dir = work_dir / "hyp3_products"
    zip_dir.mkdir()

    try:
        for upload in files:
            raw = await upload.read()
            zname = upload.filename or "interferogram.zip"
            zip_bytes = zip_dir / zname
            zip_bytes.write_bytes(raw)
            with zipfile.ZipFile(zip_bytes, "r") as zf:
                zf.extractall(zip_dir)
            zip_bytes.unlink()

        tifs = list(zip_dir.glob("*/*_corr.tif"))
        if not tifs:
            raise HTTPException(
                status_code=400,
                detail="No se encontraron archivos de coherencia en el ZIP."
            )

        lefts, bottoms, rights, tops = [], [], [], []
        crs = None

        for t in tifs:
            with rasterio.open(str(t)) as src:
                lefts.append(src.bounds.left)
                bottoms.append(src.bounds.bottom)
                rights.append(src.bounds.right)
                tops.append(src.bounds.top)
                if crs is None:
                    crs = src.crs

        common_bounds = (max(lefts), max(bottoms), min(rights), min(tops))

        with rasterio.open(str(tifs[0])) as src:
            window = rasterio.windows.from_bounds(*common_bounds, transform=src.transform)
            win_width, win_height = int(window.width), int(window.height)
            transform = rasterio.windows.transform(window, src.transform)

        coh_sum = np.zeros((win_height, win_width), dtype=np.float32)

        for t in tifs:
            with rasterio.open(str(t)) as src:
                t_window = rasterio.windows.from_bounds(*common_bounds, transform=src.transform)
                t_win_col, t_win_row = int(t_window.col_off), int(t_window.row_off)
                exact_window = Window(t_win_col, t_win_row, win_width, win_height)
                
                data = src.read(1, window=exact_window).astype(np.float32)
                if src.nodata is not None:
                    data[data == src.nodata] = np.nan

                valid = ~np.isnan(data)
                coh_sum[valid] += data[valid]

        if coh_sum is None:
            raise HTTPException(status_code=500, detail="Error combinando mapas de coherencia.")

        if crop_lat_min is not None and crop_lat_max is not None and crop_lon_min is not None and crop_lon_max is not None:
            c_arr = np.arange(win_width)
            r_arr = np.arange(win_height)
            c_grid, r_grid = np.meshgrid(c_arr, r_arr)
            lon_proj, lat_proj = transform * (c_grid + 0.5, r_grid + 0.5)

            if crs and crs.to_epsg() != 4326:
                transformer_inv = pyproj.Transformer.from_crs(crs.to_epsg() or 32616, 4326, always_xy=True)
                lon_val, lat_val = transformer_inv.transform(lon_proj, lat_proj)
            else:
                lon_val, lat_val = lon_proj, lat_proj

            mask = (lat_val >= crop_lat_min) & (lat_val <= crop_lat_max) & \
                   (lon_val >= crop_lon_min) & (lon_val <= crop_lon_max)

            coh_sum[~mask] = -1.0

        max_val = np.nanmax(coh_sum)
        if np.isnan(max_val) or max_val < 0:
            raise HTTPException(status_code=422, detail="No hay pixeles de coherencia en el área seleccionada.")

        ys, xs = np.where(coh_sum == max_val)

        transformer = None
        if crs and crs.to_epsg() != 4326:
            transformer = pyproj.Transformer.from_crs(crs.to_epsg() or 32616, 4326, always_xy=True)

        tied_points = []
        for i in range(len(ys)):
            r, c = ys[i], xs[i]
            lon_proj, lat_proj = transform * (c + 0.5, r + 0.5)

            if transformer:
                lon_val, lat_val = transformer.transform(lon_proj, lat_proj)
            else:
                lon_val, lat_val = lon_proj, lat_proj

            tied_points.append({
                "lat": round(float(lat_val), 4),
                "lon": round(float(lon_val), 4),
                "is_mintpy_default": (i == 0)
            })

        return {"seed_points": tied_points}

    finally:

        shutil.rmtree(work_dir, ignore_errors=True)

@router.get("/export_csv")
def export_csv():
    if not CSV_FILE.exists():
        raise HTTPException(
            status_code=404,
            detail="No hay datos en CSV para exportar. Procesa interferogramas primero.",
        )
    return FileResponse(
        CSV_FILE,
        media_type="text/csv",
        filename="velocidad_deformacion_mintpy.csv",
    )



@router.post("/preview_bounds")
async def preview_bounds(files: List[UploadFile] = File(...)):
    """Extracts geographic bounds from the first HyP3 interferogram ZIP file.

    Processes the first uploaded ZIP file containing HyP3 interferogram products,
    extracts its contents, and retrieves the geographic bounding box by reading
    the GeoTIFF metadata. Coordinates are automatically transformed to WGS84
    (EPSG:4326) format regardless of the source CRS.

    Args:
        files (List[UploadFile]): List of uploaded ZIP files. Only the first file
            is processed. Each ZIP should contain HyP3 product files including
            at least one GeoTIFF file (*_dem.tif or any *.tif).

    Returns:
        dict: A dictionary with the following structure:
            {
                "success": bool,
                "bounds": {
                    "lat_min": float,  # Minimum latitude in WGS84 (south edge)
                    "lon_min": float,  # Minimum longitude in WGS84 (west edge)
                    "lat_max": float,  # Maximum latitude in WGS84 (north edge)
                    "lon_max": float   # Maximum longitude in WGS84 (east edge)
                }
            }

    Raises:
        HTTPException (400): If the files list is empty or if no GeoTIFF files
            (*_dem.tif or *.tif) are found in the extracted ZIP. Status code 400.

    Note:
        - Only the first file in the files list is processed.
        - The function creates a temporary directory for extraction which is
          cleaned up after processing, even if an error occurs.
        - DEM files (*_dem.tif) are preferred, but any *.tif file will be used
          if DEM files are not found.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    file = files[0]
    work_dir = Path(tempfile.mkdtemp(prefix="mintpy_prev_bounds_"))
    zip_dir = work_dir /"hyp3_products"
    zip_dir.mkdir()

    try:
        raw = await file.read()
        zname = file.filename or "interferogram.zip"
        zip_bytes = zip_dir / zname
        zip_bytes.write_bytes(raw)

        with zipfile.ZipFile(zip_bytes, "r") as zf:
            zf.extractall(zip_dir)
        zip_bytes.unlink()

        tifs = list(zip_dir.glob("*/*_dem.tif")) or list(zip_dir.glob(""
                                                                      "*/*.tif"))
        if not tifs:
            raise HTTPException(status_code=400, detail="No .tif files found in ZIP")

        with rasterio.open(str(tifs[0])) as src:
            left, bottom, right, top = rasterio.warp.transform_bounds(src.crs, "EPSG:4326", *src.bounds)

        return {
            "success": True,
            "bounds": {
                "lat_min": bottom,
                "lon_min": left,
                "lat_max": top,
                "lon_max": right
            }
        }

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

