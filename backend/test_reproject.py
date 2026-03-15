import xarray as xr
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import Affine
import numpy as np
import tempfile

# Dummy era5
ds = xr.Dataset(
    {"t2m": (("lat", "lon"), np.random.rand(10, 10).astype(np.float32))},
    coords={"lat": np.linspace(14, 13, 10), "lon": np.linspace(-90, -89, 10)}
)

lons = ds["lon"].values
lats = ds["lat"].values

dlon = (lons[-1] - lons[0]) / (len(lons) - 1) if len(lons) > 1 else 0.1
dlat = (lats[-1] - lats[0]) / (len(lats) - 1) if len(lats) > 1 else -0.1

era5_transform = Affine.translation(lons[0] - dlon/2, lats[0] - dlat/2) * Affine.scale(dlon, dlat)

# Dummy sentinel
target_shape = (1000, 1000)
dst_transform = Affine.translation(-89.8, 13.8) * Affine.scale(0.0001, -0.0001)

era5_slice = ds["t2m"].values
era5_reproj = np.zeros(target_shape, dtype=np.float32)
reproject(
    source=era5_slice,
    destination=era5_reproj,
    src_transform=era5_transform,
    src_crs="EPSG:4326",
    dst_transform=dst_transform,
    dst_crs="EPSG:4326",
    src_nodata=np.nan,
    dst_nodata=np.nan,
    resampling=Resampling.cubic
)
print("Reprojected successfully. Count of non-nan:", np.count_nonzero(~np.isnan(era5_reproj)))
