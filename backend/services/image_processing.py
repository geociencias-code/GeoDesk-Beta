import numpy as np
import rasterio
import matplotlib.pyplot as plt
from pathlib import Path
import cartopy.crs as ccrs
import datetime

def classify_kind(filepath: Path) -> str:
    name = filepath.name.lower()
    if any(k in name for k in ["unw_phase", "color_phase", "lv_phi", "lv_theta"]):
        return "fase"
    if any(k in name for k in ["corr", "coh"]):
        return "coherencia"
    if "dem" in name:
        return "elevacion"
    if any(k in name for k in ["water_mask", "mask"]):
        return "ignorar"
    if filepath.suffix.lower() in [".tif", ".tiff"]:
        return "coherencia"
    return "desconocido"

def compute_stats(arr: np.ndarray, nodata=None):
    a = arr.astype(float)
    if nodata is not None:
        a = np.where(a == nodata, np.nan, a)
    finite = np.isfinite(a)
    if not finite.any():
        return {}
    vals = a[finite]
    return {
        "min": float(np.nanmin(vals)),
        "max": float(np.nanmax(vals)),
        "mean": float(np.nanmean(vals)),
        "std": float(np.nanstd(vals)),
        "p2": float(np.nanpercentile(vals, 2)),
        "p98": float(np.nanpercentile(vals, 98)),
        "count": int(vals.size),
    }

def render_raster_tiff(in_path: Path, out_tiff: Path, title: str, cmap: str = "viridis", vmin=None, vmax=None, nodata=None):
    with rasterio.open(in_path) as ds:
        data = ds.read(1)
        if nodata is None and ds.nodata is not None:
            nodata = ds.nodata

        stats = compute_stats(data, nodata=nodata)
        if vmin is None or vmax is None:
            if stats:
                vmin = stats.get("p2", vmin)
                vmax = stats.get("p98", vmax)

        if nodata is not None:
            data = np.where(data == nodata, np.nan, data)

        fig, ax = plt.subplots(figsize=(10, 8))
        cax = ax.imshow(data, cmap=cmap, vmin=vmin, vmax=vmax)
        ax.set_title(title, fontsize=14)
        cbar = fig.colorbar(cax)
        cbar.set_label('Valor', rotation=270, labelpad=15)

        plt.tight_layout()
        plt.savefig(out_tiff, format='png')
        plt.close(fig)

    return stats

def generar_mapa_el_salvador(ruta_tif: Path, salida_png: Path):
    """
    Mapa base totalmente offline (sin descargas).
    Usa stock_img() en lugar de LAND, OCEAN, etc.
    """
    with rasterio.open(ruta_tif) as src:
        data = src.read(1)
        extent = [
            src.bounds.left,
            src.bounds.right,
            src.bounds.bottom,
            src.bounds.top,
        ]

    plt.figure(figsize=(10, 8))
    ax = plt.axes(projection=ccrs.PlateCarree())
    ax.stock_img()
    ax.coastlines()
    im = ax.imshow(
        data,
        extent=extent,
        origin="upper",
        transform=ccrs.PlateCarree(),
        cmap="jet",
    )
    plt.colorbar(im, ax=ax, orientation="vertical", label="Deformación")
    plt.savefig(salida_png, dpi=150, bbox_inches="tight")
    plt.close()

def generar_imagen_sin_mapa(data, extent, outfile):
    masked = np.where(np.isfinite(data), data, np.nan)
    if np.isnan(masked).all():
        print("⚠️ La imagen no contiene datos visibles.")
        return

    plt.figure(figsize=(10, 6))
    plt.imshow(masked, cmap="seismic", vmin=-5, vmax=5, extent=extent)
    plt.colorbar(label="Deformación (cm)")
    plt.title("Deformación estimada entre imágenes")
    plt.axis("off")
    plt.savefig(outfile, dpi=200, bbox_inches="tight")
    plt.close()
