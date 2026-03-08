# GeoDesk

Plataforma de geoprocesamiento para análisis de imágenes satelitales Sentinel-1 mediante interferometría SAR (InSAR), extracción de datos meteorológicos ERA5 y visualización de deformación terrestre.

---

## Tabla de Contenidos

1. [Conceptos Fundamentales](#conceptos-fundamentales)
2. [Flujo Completo de la Aplicación](#flujo-completo-de-la-aplicación)
3. [Guía de Uso por Sección](#guía-de-uso-por-sección)
4. [Instalación y Ejecución](#instalación-y-ejecución)

---

## Conceptos Fundamentales

### ¿Qué es un Granule?

Un **granule** es la unidad mínima de datos satelitales. Representa una imagen SAR (Radar de Apertura Sintética) capturada por el satélite Sentinel-1 en un momento y lugar específicos.

Cada granule contiene:
- Imagen radar en formato SLC (Single Look Complex)
- Metadatos (fecha, coordenadas, órbita, polarización)
- Cobertura de aproximadamente 250 km × 100 km

### ¿Por qué se necesitan PARES de granules?

La técnica **InSAR (Interferometría SAR)** requiere **dos imágenes** del mismo lugar tomadas en fechas diferentes para detectar cambios en la superficie terrestre.

```
Granule 1 (Fecha A)     Granule 2 (Fecha B)
        ↓                       ↓
    [Imagen SAR]           [Imagen SAR]
              ↘           ↙
              COMPARACIÓN
                   ↓
           INTERFEROGRAMA
        (diferencia de fase)
                   ↓
        MAPA DE DEFORMACIÓN
```

**Ejemplo práctico:**
- Granule A: 1 de enero 2025
- Granule B: 13 de enero 2025 (12 días después, ciclo orbital de Sentinel-1)
- Resultado: Interferograma que muestra movimientos del terreno entre esas fechas

Con **3 granules consecutivos** (A, B, C) se generan **2 pares**: (A↔B) y (B↔C).

### Requisitos para formar un par válido

| Criterio | Razón |
|----------|-------|
| Misma órbita (ruta/marco) | Geometría de adquisición idéntica |
| Intervalo ≤ 12 días | Evitar decorrelación temporal |
| Misma plataforma (S1A o S1B) | Consistencia del sensor |

---

## ¿Qué hace HyP3?

**HyP3 (Hybrid Pluggable Processing Pipeline)** es un servicio de Alaska Satellite Facility que procesa pares de granules en la nube. Realiza todo el procesamiento InSAR automáticamente.

### Pasos que ejecuta HyP3 (INSAR_GAMMA):

```
┌─────────────────────────────────────────────────────────────┐
│  1. CORREGISTRO                                             │
│     → Alinear las dos imágenes con precisión subpixel       │
├─────────────────────────────────────────────────────────────┤
│  2. GENERACIÓN DE INTERFEROGRAMA                            │
│     → Calcular la diferencia de fase entre ambas imágenes   │
├─────────────────────────────────────────────────────────────┤
│  3. FILTRADO (Goldstein)                                    │
│     → Reducir el ruido speckle característico del radar     │
├─────────────────────────────────────────────────────────────┤
│  4. DESENROLLADO DE FASE (Phase Unwrapping)                 │
│     → Convertir fase cíclica (-π a +π) a valores continuos  │
├─────────────────────────────────────────────────────────────┤
│  5. GEOCODIFICACIÓN                                         │
│     → Proyectar a coordenadas geográficas (lat/lon)         │
├─────────────────────────────────────────────────────────────┤
│  6. GENERACIÓN DE DEM                                       │
│     → Modelo Digital de Elevación del área                  │
├─────────────────────────────────────────────────────────────┤
│  7. CÁLCULO DE COHERENCIA                                   │
│     → Medir calidad/confiabilidad de la señal (0-1)         │
└─────────────────────────────────────────────────────────────┘
```

### Productos de salida de HyP3

| Archivo | Descripción | Uso |
|---------|-------------|-----|
| `*_unw_phase.tif` | Fase desenrollada | Indica deformación del terreno |
| `*_corr.tif` | Coherencia (0-1) | Calidad de la medición |
| `*_amp.tif` | Amplitud | Intensidad de la señal radar |
| `*_dem.tif` | Modelo de Elevación | Topografía del área |
| `*_lv_phi.tif` | Vector de vista (azimut) | Geometría de observación |
| `*_lv_theta.tif` | Vector de vista (incidencia) | Geometría de observación |
| `*_water_mask.tif` | Máscara de agua | Identifica cuerpos de agua |

---

## Flujo Completo de la Aplicación

```
┌──────────────────────────────────────────────────────────────────────┐
│                        FLUJO DE TRABAJO                              │
└──────────────────────────────────────────────────────────────────────┘

   PASO 1: BÚSQUEDA                    PASO 2: ENVÍO A HyP3
   ─────────────────                   ────────────────────
   
   [Sentinel] → Buscar escenas    →    [HyP3] → Procesar pares
       ↓         por área/fecha             ↓      en la nube
   Lista de                            Jobs en
   Granules                            procesamiento
                                       (30-60 min)

   PASO 3: DESCARGA                    PASO 4: VISUALIZACIÓN
   ────────────────                    ─────────────────────
   
   [HyP3] → Descargar productos   →    [Procesamiento] → Ver imágenes
       ↓      procesados (.zip)             ↓              coloreadas
   Archivos                            PNGs de coherencia,
   .tif                                fase, elevación


   OPCIONAL: ANÁLISIS AVANZADO
   ───────────────────────────
   
   [ERA5] → Datos meteorológicos  →    [Temp+Deformación] → Correlacionar
       ↓      (temperatura)                  ↓               variables
   Archivo                             Gráficas de
   .nc                                 análisis
```

---

## Guía de Uso por Sección

### 1. Sentinel (Búsqueda Manual)

**Propósito:** Buscar y procesar imágenes Sentinel-1 de cualquier área del mundo.

#### Pestaña "Obtener Datos"

| Campo | Descripción | Ejemplo |
|-------|-------------|---------|
| **Fecha Inicio/Fin** | Rango temporal de búsqueda | 2025-01-01 a 2025-01-31 |
| **Ruta** | Órbita relativa del satélite (1-175) | 128 |
| **Marco** | Subdivisión de la órbita | 547 |
| **Dirección de vuelo** | ASCENDING (sur→norte) o DESCENDING (norte→sur) | ASCENDING |
| **Polarización** | Tipo de señal radar (ver tabla abajo) | VV+VH |
| **Polígono** | Dibuja en el mapa el área de interés | Doble clic para cerrar |

##### Tipos de Polarización

| Polarización | Significado | Mejor para |
|--------------|-------------|------------|
| **VV** | Vertical transmitida, Vertical recibida | Agua, superficies lisas |
| **VH** | Vertical transmitida, Horizontal recibida | Vegetación, bosques |
| **VV+VH** | Dual polarización vertical | Análisis completo (recomendado) |
| **HH** | Horizontal transmitida, Horizontal recibida | Hielo, zonas polares |
| **HV** | Horizontal transmitida, Vertical recibida | Biomasa, agricultura |
| **HH+HV** | Dual polarización horizontal | Regiones polares |

> **Nota:** La polarización VV+VH es la más común para Sentinel-1 modo IW y ofrece la mejor versatilidad.

#### Pestaña "Descargar"

1. **Procesar seleccionadas (HyP3):** Envía los granules seleccionados a HyP3
2. **Cargar productos HyP3:** Recupera los archivos procesados cuando estén listos
3. **Descargar:** Descarga los ZIPs al servidor

> ⚠️ **Importante:** Se necesitan mínimo 2 granules para formar un par de interferometría.

---

### 2. Solicitar Imágenes (Automático)

**Propósito:** Búsqueda y procesamiento automatizado para **El Salvador** con parámetros predefinidos.

| Campo | Descripción |
|-------|-------------|
| **Fecha inicio** | Inicio del período de análisis |
| **Fecha fin** | Fin del período de análisis |
| **Nombre del proyecto** | Identificador único para este análisis |

**Parámetros fijos:**
- Área: El Salvador (polígono predefinido)
- Ruta: 128, Marco: 547
- Modo: IW, Nivel: SLC
- Intervalo entre pares: 12 días

**Resultado:** Muestra escenas encontradas, pares construidos y jobs enviados.

---

### 3. Procesamiento SNAP

**Propósito:** Visualizar los productos de HyP3 como imágenes PNG coloreadas.

**Cómo usar:**
1. Sube el archivo `.zip` descargado de HyP3
2. El sistema clasifica automáticamente cada `.tif`:
   - **Coherencia:** Mapa de calidad (0-1)
   - **Fase:** Mapa de deformación
   - **Elevación:** Modelo digital del terreno
3. Filtra por tipo usando los botones
4. Descarga las imágenes PNG procesadas

**¿Qué NO hace esta sección?**
- No reemplaza SNAP para análisis avanzados
- No permite reproyección ni filtros adicionales
- No genera series temporales (SBAS/PSInSAR)

Es un **visor simplificado** para inspección rápida de resultados.

---

### 4. ERA5

**Propósito:** Descargar datos meteorológicos de Copernicus Climate Data Store.

**Cómo usar:**
1. **Dibuja un rectángulo** en el mapa (2 clics)
2. Selecciona **rango de fechas** (mismo año)
3. Elige las **horas** de muestreo (00:00, 06:00, 12:00, 18:00)
4. Descarga el archivo `.nc` (NetCDF)

**Variables disponibles:** Temperatura a 2m (t2m)

---

### 5. Temperatura + Deformación

**Propósito:** Correlacionar datos de temperatura ERA5 con mapas de deformación InSAR.

**Cómo usar:**
1. Sube el archivo `.nc` de ERA5
2. Sube uno o más `.zip` con productos de deformación
3. Visualiza gráficas comparativas

---

## Instalación y Ejecución

### Requisitos Previos

- Docker y Docker Compose instalados
- Cuenta en [ASF/Earthdata](https://urs.earthdata.nasa.gov/) (para HyP3)
- Cuenta en [Copernicus CDS](https://cds.climate.copernicus.eu/) (para ERA5)

### Iniciar la Aplicación

```bash
# Clonar el repositorio
git clone <url-del-repositorio>
cd GeoDesk-Beta

# Construir e iniciar los contenedores
docker-compose up --build
```

### Acceder a la Aplicación

| Servicio | URL |
|----------|-----|
| **Frontend** | http://localhost:5173 |
| **Backend API** | http://localhost:8000 |
| **Health Check** | http://localhost:8000/api/health |

### Comandos Útiles

```bash
# Iniciar en segundo plano
docker-compose up -d

# Ver logs
docker-compose logs -f

# Detener los contenedores
docker-compose down

# Reconstruir después de cambios
docker-compose up --build
```

---

