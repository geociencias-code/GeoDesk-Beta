FROM python:3.11-slim
LABEL authors="alexander"

WORKDIR /app

# System deps: GDAL dev headers + build tools (needed to compile gdal Python wheel),
# HDF5 headers (for h5py), git (for mintpy), and rasterio runtime libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    libexpat1 \
    libgdal-dev \
    gdal-bin \
    libhdf5-dev \
    git \
    g++ \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Install GDAL Python bindings (osgeo) that match the system GDAL version
# Must be done before requirements.txt because mintpy imports osgeo at load time
RUN pip install --no-cache-dir "gdal==$(gdal-config --version)"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]