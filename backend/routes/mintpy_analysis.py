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
import mintpy.ifgram_inversion as inv
import numpy as np
import pandas as pd
import rasterio
from fastapi import APIRouter, File, HTTPException, UploadFile, Form
from fastapi.responses import FileResponse
import rasterio.warp
from rasterio.windows import Window
from scipy.interpolate import griddata

# Bugfix: MintPy's calc_inv_quality returns a 1D array of size 1 for single-pixel inversions,
# which crashes NumPy 1.24+ with "ValueError: setting an array element with a sequence."
# We monkey-patch the estimate_timeseries function globally here to prevent multi-patching
# across sequential API calls.
from mintpy.ifgram_inversion import estimate_timeseries as original_estimate_timeseries

def patched_estimate_timeseries(*args, **kwargs):
    tsi, inv_quali, num_obsi = original_estimate_timeseries(*args, **kwargs)
    if getattr(inv_quali, "size", 0) == 1:
        inv_quali = float(inv_quali.item())
    return tsi, inv_quali, num_obsi

inv.estimate_timeseries = patched_estimate_timeseries

router = APIRouter(prefix="/api/mintpy", tags=["MintPy"])

BASE_DIR = Path(__file__).resolve().parent.parent
RESULTS_DIR = BASE_DIR / "mintpy_results"
RESULTS_DIR.mkdir(exist_ok=True)
RESULTS_FILE = RESULTS_DIR / "latest_results.json"
CSV_FILE     = RESULTS_DIR / "velocidad_deformacion.csv"
XLSX_FILE    = RESULTS_DIR / "resumen_interferogramas.xlsx"

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
    subset_yx_val = "auto"
    ref_yx_val = "auto"
    
    if tifs:
        heights = []
        widths = []
        lefts, bottoms, rights, tops = [], [], [], []
        crs = None
        for t in tifs:
            try:
                with rasterio.open(str(t)) as src:
                    heights.append(src.height)
                    widths.append(src.width)
                    lefts.append(src.bounds.left)
                    bottoms.append(src.bounds.bottom)
                    rights.append(src.bounds.right)
                    tops.append(src.bounds.top)
                    if crs is None:
                        crs = src.crs
            except Exception as e:
                logging.warning(f"Error reading {t} con rasterio: {e}")
                
        if lefts:
            common_bounds = (max(lefts), max(bottoms), min(rights), min(tops))
            with rasterio.open(str(tifs[0])) as src:
                window = rasterio.windows.from_bounds(*common_bounds, transform=src.transform)
                width, height = int(window.width), int(window.height)
                transform = rasterio.windows.transform(window, src.transform)

            transformer = None
            if crs and crs.to_epsg() != 4326:
                transformer = pyproj.Transformer.from_crs(4326, crs.to_epsg() or 32616, always_xy=True)

            c_off, r_off = 0, 0

            if crop_lat_min is not None and crop_lat_max is not None and crop_lon_min is not None and crop_lon_max is not None:
                if transformer:
                    ll_x, ll_y = transformer.transform(crop_lon_min, crop_lat_min)
                    ur_x, ur_y = transformer.transform(crop_lon_max, crop_lat_max)
                    lr_x, lr_y = transformer.transform(crop_lon_max, crop_lat_min)
                    ul_x, ul_y = transformer.transform(crop_lon_min, crop_lat_max)
                    
                    min_x = min(ll_x, ur_x, lr_x, ul_x)
                    max_x = max(ll_x, ur_x, lr_x, ul_x)
                    min_y = min(ll_y, ur_y, lr_y, ul_y)
                    max_y = max(ll_y, ur_y, lr_y, ul_y)
                else:
                    min_x, max_x = crop_lon_min, crop_lon_max
                    min_y, max_y = crop_lat_min, crop_lat_max
                
                win = rasterio.windows.from_bounds(min_x, min_y, max_x, max_y, transform=transform)
                c_off = int(max(0, win.col_off))
                r_off = int(max(0, win.row_off))
                c_end = int(min(width, win.col_off + win.width))
                r_end = int(min(height, win.row_off + win.height))
                
                if c_end > c_off and r_end > r_off:
                    subset_yx_val = f"{r_off}:{r_end},{c_off}:{c_end}"

            if ref_lat is not None and ref_lon is not None:
                if transformer:
                    ref_lon_proj, ref_lat_proj = transformer.transform(ref_lon, ref_lat)
                else:
                    ref_lon_proj, ref_lat_proj = ref_lon, ref_lat
                
                r_ref, c_ref = rasterio.transform.rowcol(transform, ref_lon_proj, ref_lat_proj)
                ry = int(r_ref) - r_off
                rx = int(c_ref) - c_off
                
                ry = max(0, ry)
                rx = max(0, rx)
                ref_yx_val = f"{ry},{rx}"
                
        if heights and widths:
            min_h = min(heights)
            min_w = min(widths)
    
    if subset_yx_val == "auto" and min_h != "auto":
        subset_yx_val = f"0:{min_h},0:{min_w}"

    return f"""mintpy.load.processor    = hyp3
mintpy.load.unwFile      = {unw_pat}
mintpy.load.corFile      = {cor_pat}
mintpy.load.demFile      = {dem_pat}
mintpy.load.incAngleFile = {inc_pat}
mintpy.load.azAngleFile  = {azi_pat}
mintpy.subset.lalo       = no
mintpy.subset.yx         = {subset_yx_val}
mintpy.network.coherenceBased     = yes
mintpy.network.minCoherence       = 0.4
mintpy.reference.lalo             = no
mintpy.reference.yx               = {ref_yx_val}
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
        original_cwd = os.getcwd()
        tsa = TimeSeriesAnalysis(
            customTemplateFile=str(cfg_path),
            workDir=str(work_dir),
        )
        tsa.open()

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
        os.chdir(original_cwd)
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
    if len(files) < MIN_INTERFEROGRAMS:
        raise HTTPException(status_code=400, detail=f"Se requieren al menos {MIN_INTERFEROGRAMS} interferogramas.")

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
                raise HTTPException(status_code=400, detail="Error fechas zip.")

            with zipfile.ZipFile(zip_bytes, "r") as zf:
                top_level = {p.split('/')[0] for p in zf.namelist() if '/' in p}
                zf.extractall(zip_dir)
            zip_bytes.unlink()

            igram_pre_meta.append({
                "filename": zname,
                "date1": d1,
                "date2": d2,
                "days": abs((d2 - d1).days),
                "extracted_folder": list(top_level)[0] if top_level else zname.replace('.zip', '')
            })

        igram_pre_meta.sort(key=lambda x: (x["date1"], x["date2"], x["filename"]))

        igram_meta = []
        asc_paths = []
        desc_paths = []
        for idx, meta in enumerate(igram_pre_meta):
            old_path = zip_dir / meta["extracted_folder"]
            new_path = zip_dir / f"{idx:04d}_{meta['extracted_folder']}"
            if old_path.exists(): old_path.rename(new_path)
            
            track_dir = "ASC"
            phi_files = list(new_path.glob("*_lv_phi.tif"))
            if phi_files:
                with rasterio.open(str(phi_files[0])) as src:
                    out_h, out_w = max(1, src.height // 10), max(1, src.width // 10)
                    data = src.read(1, out_shape=(1, out_h, out_w))
                    if src.nodata is not None: data[data == src.nodata] = np.nan
                    mean_phi = np.nanmean(data)
                    if not np.isnan(mean_phi):
                        mean_phi_deg = (np.degrees(mean_phi) + 360) % 360
                        if 90 < mean_phi_deg < 270: track_dir = "DESC"
            
            if track_dir == "ASC": asc_paths.append(new_path)
            else: desc_paths.append(new_path)

            igram_meta.append({
                "filename": meta["filename"],
                "date1": meta["date1"].isoformat(),
                "date2": meta["date2"].isoformat(),
                "days": meta["days"],
                "track": track_dir
            })

        is_2d_mode = len(asc_paths) >= MIN_INTERFEROGRAMS and len(desc_paths) >= MIN_INTERFEROGRAMS
        
        if is_2d_mode:
            work_dir_asc = work_dir / "asc"
            work_dir_desc = work_dir / "desc"
            work_dir_asc.mkdir(); work_dir_desc.mkdir()
            zip_dir_asc = work_dir_asc / "hyp3_products"
            zip_dir_desc = work_dir_desc / "hyp3_products"
            zip_dir_asc.mkdir(); zip_dir_desc.mkdir()
            
            for p in asc_paths: shutil.move(str(p), str(zip_dir_asc / p.name))
            for p in desc_paths: shutil.move(str(p), str(zip_dir_desc / p.name))
                
            try:
                _run_mintpy_pipeline(work_dir_asc, zip_dir_asc, ref_lat, ref_lon, crop_lat_min, crop_lat_max, crop_lon_min, crop_lon_max)
                _run_mintpy_pipeline(work_dir_desc, zip_dir_desc, ref_lat, ref_lon, crop_lat_min, crop_lat_max, crop_lon_min, crop_lon_max)
            except ValueError as exc:
                raise HTTPException(status_code=500, detail=str(exc))
                
            vel_h5_asc = work_dir_asc / "velocity.h5"
            vel_h5_desc = work_dir_desc / "velocity.h5"
            geo_asc = work_dir_asc / "inputs" / "geometryGeo.h5"
            geo_desc = work_dir_desc / "inputs" / "geometryGeo.h5"
            
            if not vel_h5_asc.exists() or not vel_h5_desc.exists() or not geo_asc.exists() or not geo_desc.exists():
                raise HTTPException(status_code=500, detail="MintPy no generó los archivos H5 para 2D.")
                
            with h5py.File(vel_h5_asc, "r") as vf_a, h5py.File(vel_h5_desc, "r") as vf_d:
                vel_asc = vf_a["velocity"][:] * 1000.0
                vel_desc = vf_d["velocity"][:] * 1000.0
                vel_attrs = dict(vf_a.attrs)
                
            with h5py.File(geo_asc, "r") as gf_a, h5py.File(geo_desc, "r") as gf_d:
                inc_asc = np.radians(gf_a["incidenceAngle"][:])
                azi_asc = np.radians(gf_a["azimuthAngle"][:])
                inc_desc = np.radians(gf_d["incidenceAngle"][:])
                azi_desc = np.radians(gf_d["azimuthAngle"][:])

                def get_lat_lon(vf, gf):
                    lat = gf["latitude"][:] if "latitude" in gf else None
                    lon = gf["longitude"][:] if "longitude" in gf else None
                    if lat is None or lon is None:
                        attrs = dict(vf.attrs)
                        lat0, lon0 = float(attrs.get("Y_FIRST", 0)), float(attrs.get("X_FIRST", 0))
                        dlat, dlon = float(attrs.get("Y_STEP", -0.001)), float(attrs.get("X_STEP", 0.001))
                        lat_arr = lat0 + np.arange(vf["velocity"].shape[0]) * dlat
                        lon_arr = lon0 + np.arange(vf["velocity"].shape[1]) * dlon
                        lon, lat = np.meshgrid(lon_arr, lat_arr)
                        if abs(lat0) > 90 or abs(lon0) > 180:
                            epsg = int(attrs.get("EPSG", 32616))
                            transformer = pyproj.Transformer.from_crs(epsg, 4326, always_xy=True)
                            lon, lat = transformer.transform(lon, lat)
                    return lat, lon

                lat_asc, lon_asc = get_lat_lon(vf_a, gf_a)
                lat_desc, lon_desc = get_lat_lon(vf_d, gf_d)

            # Spatial resampling (interpolation) of Ascending to Descending master grid
            valid_mask_a = np.isfinite(vel_asc) & (vel_asc != 0)
            
            if np.any(valid_mask_a):
                valid_pts_a = np.column_stack((lat_asc[valid_mask_a], lon_asc[valid_mask_a]))
                vel_asc = griddata(valid_pts_a, vel_asc[valid_mask_a], (lat_desc, lon_desc), method='linear', fill_value=np.nan)
                inc_asc = griddata(valid_pts_a, inc_asc[valid_mask_a], (lat_desc, lon_desc), method='linear', fill_value=np.nan)
                azi_asc = griddata(valid_pts_a, azi_asc[valid_mask_a], (lat_desc, lon_desc), method='linear', fill_value=np.nan)
            else:
                vel_asc = np.full_like(vel_desc, np.nan)
                inc_asc = np.full_like(vel_desc, np.nan)
                azi_asc = np.full_like(vel_desc, np.nan)

            lat_grid, lon_grid = lat_desc, lon_desc

            # Matrix inversion
            A_asc_up = np.cos(inc_asc)
            A_asc_ew = -np.sin(inc_asc) * np.cos(azi_asc)
            A_desc_up = np.cos(inc_desc)
            A_desc_ew = -np.sin(inc_desc) * np.cos(azi_desc)
            
            det = (A_asc_ew * A_desc_up) - (A_asc_up * A_desc_ew)
            
            mask_a = np.isfinite(vel_asc) & (vel_asc != 0)
            med_a = np.nanmedian(vel_asc[mask_a])
            if not np.isnan(med_a): vel_asc[mask_a] -= med_a
            
            mask_d = np.isfinite(vel_desc) & (vel_desc != 0)
            med_d = np.nanmedian(vel_desc[mask_d])
            if not np.isnan(med_d): vel_desc[mask_d] -= med_d
            
            valid = mask_a & mask_d & (det != 0) & np.isfinite(det)
            vel_ew = np.full_like(vel_desc, np.nan)
            vel_up = np.full_like(vel_desc, np.nan)
            vel_ew[valid] = (A_desc_up[valid] * vel_asc[valid] - A_asc_up[valid] * vel_desc[valid]) / det[valid]
            vel_up[valid] = (-A_desc_ew[valid] * vel_asc[valid] + A_asc_ew[valid] * vel_desc[valid]) / det[valid]

            lats_v, lons_v = lat_grid[valid].flatten(), lon_grid[valid].flatten()
            ew_v, up_v = vel_ew[valid].flatten(), vel_up[valid].flatten()
            
            results = [
                {"lat": round(float(lats_v[i]), 4), "lon": round(float(lons_v[i]), 4), "velocidad_mm_yr": round(float(up_v[i]), 2), "vel_ew_mm_yr": round(float(ew_v[i]), 2), "vel_up_mm_yr": round(float(up_v[i]), 2)}
                for i in range(len(ew_v))
            ]
            
            df_csv = pd.DataFrame(results)
            df_csv.columns = ["Latitud", "Longitud", "Velocidad_mm_amo", "Velocidad_EW_mm_amo", "Velocidad_UP_mm_amo"]
            df_csv.to_csv(CSV_FILE, index=False)
            if XLSX_FILE.exists(): XLSX_FILE.unlink()
            
            all_dates = [m["date1"] for m in igram_meta] + [m["date2"] for m in igram_meta]
            stats = {
                "min": round(float(np.min(up_v) if len(up_v) else 0), 2),
                "max": round(float(np.max(up_v) if len(up_v) else 0), 2),
                "mean": round(float(np.mean(up_v) if len(up_v) else 0), 2),
                "std": round(float(np.std(up_v) if len(up_v) else 0), 2),
                "min_ew": round(float(np.min(ew_v) if len(ew_v) else 0), 2),
                "max_ew": round(float(np.max(ew_v) if len(ew_v) else 0), 2),
                "n_points": len(results),
                "n_interferograms": len(files),
                "date_start": min(all_dates),
                "date_end": max(all_dates),
                "era5_successful": True,
            }
            
            step_s = max(1, len(results) // 1000)
            sample = results[::step_s][:1000]
            
            output = {"stats": stats, "interferograms": igram_meta, "igram_stats": [], "sample": sample, "mode": "2D"}
            RESULTS_DIR.mkdir(parents=True, exist_ok=True)
            RESULTS_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2))
            return output

        else:
            try:
                _run_mintpy_pipeline(work_dir, zip_dir, ref_lat, ref_lon, crop_lat_min, crop_lat_max, crop_lon_min, crop_lon_max)
            except ValueError as exc:
                raise HTTPException(status_code=500, detail=str(exc))

            velocity_h5 = work_dir / "velocity.h5"
            if not velocity_h5.exists():
                raise HTTPException(status_code=500, detail="MintPy no generó velocity.h5 en modo LOS.")

            geometry_geo = work_dir / "inputs" / "geometryGeo.h5"
            with h5py.File(velocity_h5, "r") as vf:
                vel_data  = vf["velocity"][:]
                vel_mm    = vel_data * 1000.0
                vel_attrs = dict(vf.attrs)

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
                lat0, lon0 = float(vel_attrs.get("Y_FIRST", 0)), float(vel_attrs.get("X_FIRST", 0))
                dlat, dlon = float(vel_attrs.get("Y_STEP", -0.001)), float(vel_attrs.get("X_STEP", 0.001))
                lat_arr = lat0 + np.arange(vel_mm.shape[0]) * dlat
                lon_arr = lon0 + np.arange(vel_mm.shape[1]) * dlon
                lon_grid, lat_grid = np.meshgrid(lon_arr, lat_arr)
                if abs(lat0) > 90 or abs(lon0) > 180:
                    epsg = int(vel_attrs.get("EPSG", 32616))
                    transformer = pyproj.Transformer.from_crs(epsg, 4326, always_xy=True)
                    lon_grid, lat_grid = transformer.transform(lon_grid, lat_grid)

            valid = np.isfinite(vel_mm) & (vel_mm != 0.0)
            lats_v, lons_v, vels_v = lat_grid[valid].flatten(), lon_grid[valid].flatten(), vel_mm[valid].flatten()
            if len(vels_v) == 0:
                raise HTTPException(status_code=422, detail="No coherentes.")

            results = [{"lat": round(float(lats_v[i]), 4), "lon": round(float(lons_v[i]), 4), "velocidad_mm_yr": round(float(vels_v[i]), 2)} for i in range(len(vels_v))]
            
            all_dates = [m["date1"] for m in igram_meta] + [m["date2"] for m in igram_meta]
            stats = {
                "min": round(float(np.min(vels_v)), 2),
                "max": round(float(np.max(vels_v)), 2),
                "mean": round(float(np.mean(vels_v)), 2),
                "std": round(float(np.std(vels_v)), 2),
                "n_points": len(results),
                "n_interferograms": len(files),
                "date_start": min(all_dates),
                "date_end": max(all_dates),
                "era5_successful": (work_dir / "inputs/ERA5.h5").exists(),
            }

            step_s = max(1, len(results) // 1000)
            sample = results[::step_s][:1000]
            
            # Simple dataframe
            df_csv = pd.DataFrame(results)
            df_csv.columns = ["Latitud", "Longitud", "Velocidad_mm_año"]
            df_csv.to_csv(CSV_FILE, index=False)
            
            igram_stats = []
            if_stack = work_dir / "inputs" / "ifgramStack.h5"
            if if_stack.exists():
                with h5py.File(if_stack, "r") as stack_f:
                    if "unwrapPhase" in stack_f and "date" in stack_f:
                        dates_array = stack_f["date"][:]
                        phase_array = stack_f["unwrapPhase"][:]
                        wvl = float(stack_f.attrs.get("WAVELENGTH", 0.05546576))
                        rad2mm = (-1 * wvl / (4 * np.pi)) * 1000.0

                        for idx, d_pair in enumerate(dates_array):
                            if isinstance(d_pair, (list, tuple, np.ndarray)) and len(d_pair) >= 2:
                                d1 = d_pair[0].decode("utf-8")
                                d2 = d_pair[1].decode("utf-8")
                            else:
                                continue

                            phase_2d = phase_array[idx].copy()
                            pmask = np.isfinite(phase_2d) & (phase_2d != 0.0)
                            median_phase = np.nanmedian(phase_2d[pmask])
                            if not np.isnan(median_phase):
                                phase_2d[pmask] -= median_phase

                            phase_1d = phase_2d[valid].flatten()
                            def_mm_arr = phase_1d * rad2mm
                            
                            if len(def_mm_arr) > 0 and d1 and d2:
                                igram_stats.append({
                                    "date1": d1,
                                    "date2": d2,
                                    "label": f"{d1} -> {d2}",
                                    "mean": round(float(np.mean(def_mm_arr)), 2),
                                    "std": round(float(np.std(def_mm_arr)), 2),
                                    "max": round(float(np.max(def_mm_arr)), 2),
                                    "min": round(float(np.min(def_mm_arr)), 2),
                                })

            if igram_stats:
                df_stats = pd.DataFrame(igram_stats)
                df_stats = df_stats[["label", "date1", "date2", "mean", "min", "max"]]
                df_stats.columns = ["Interferograma", "Fecha Inicio", "Fecha Fin", "Velocidad Media (mm/a)", "Velocidad Min (mm/a)", "Velocidad Max (mm/a)"]
                df_stats.to_excel(XLSX_FILE, index=False)
            else:
                if XLSX_FILE.exists(): XLSX_FILE.unlink()

            output = {"stats": stats, "interferograms": igram_meta, "igram_stats": igram_stats, "sample": sample, "mode": "LOS"}
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

@router.get("/export_xlsx")
def export_xlsx():
    if not XLSX_FILE.exists():
        raise HTTPException(
            status_code=404,
            detail="No hay datos en XLSX para exportar. Procesa interferogramas primero.",
        )
    return FileResponse(
        XLSX_FILE,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="resumen_interferogramas_mintpy.xlsx",
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

@router.post("/preview_plan")
async def preview_plan(files: List[UploadFile] = File(...)):
    """Determines how many files are Ascending vs Descending to plan the 2D decomposition."""
    if not files:
         raise HTTPException(status_code=400, detail="No files provided.")

    work_dir = Path(tempfile.mkdtemp(prefix="mintpy_prev_plan_"))
    zip_dir = work_dir / "hyp3_products"
    zip_dir.mkdir()
    
    asc_count = 0
    desc_count = 0
    try:
        for file in files:
            raw = await file.read()
            zname = file.filename or "interferogram.zip"
            zip_bytes = zip_dir / zname
            zip_bytes.write_bytes(raw)
            
            with zipfile.ZipFile(zip_bytes, "r") as zf:
                phi_files = [f for f in zf.namelist() if f.endswith("_lv_phi.tif")]
                if phi_files:
                    zf.extract(phi_files[0], zip_dir)
                    phi_path = zip_dir / phi_files[0]
                    with rasterio.open(str(phi_path)) as src:
                        # Read a small subset for speed
                        out_h = max(1, src.height // 10)
                        out_w = max(1, src.width // 10)
                        data = src.read(1, out_shape=(1, out_h, out_w))
                        if src.nodata is not None:
                            data[data == src.nodata] = np.nan
                        mean_phi = np.nanmean(data)
                        if not np.isnan(mean_phi):
                            mean_phi_deg = (np.degrees(mean_phi) + 360) % 360
                            # Descending heading is ~192 deg, Ascending is ~348 deg
                            if 90 < mean_phi_deg < 270:
                                desc_count += 1
                            else:
                                asc_count += 1
            zip_bytes.unlink()
            
        mode = "2D" if asc_count >= MIN_INTERFEROGRAMS and desc_count >= MIN_INTERFEROGRAMS else "LOS"
        return {
            "success": True,
            "asc_count": asc_count,
            "desc_count": desc_count,
            "mode": mode
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error previewing plan: {str(e)}")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
