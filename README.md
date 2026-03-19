# GeoDesk

Plataforma de geoprocesamiento para análisis interferométrico de imágenes Sentinel-1, corrección atmosférica con datos ERA5 y visualización de deformación terrestre.

---

## Tabla de Contenidos

1. [Tecnologías de base](#tecnologías-de-base)
2. [Interferometría SAR (InSAR)](#interferometría-sar-insar)
3. [HyP3 — Procesamiento en la nube](#hyp3--procesamiento-en-la-nube)
4. [ERA5 y el Filtro Atmosférico](#era5-y-el-filtro-atmosférico)
5. [Parámetros de adquisición fijos](#parámetros-de-adquisición-fijos)
6. [Instalación](#instalación)

---

## Tecnologías de base

### Sentinel-1

**Sentinel-1** es una constelación de satélites de la ESA (Agencia Espacial Europea) equipados con radar SAR (Synthetic Aperture Radar) en banda C (longitud de onda ≈ 5.55 cm). A diferencia de los sensores ópticos, opera independientemente de la luz solar y penetra nubes, lo que garantiza adquisiciones regulares y predecibles.

La constelación está formada por **Sentinel-1A** (lanzado en 2014) y **Sentinel-1B** (lanzado en 2016, actualmente inactivo). Cada satélite recorre su órbita completa en 12 días, de modo que el mismo punto de la Tierra es observado con la misma geometría radar cada 12 días desde una misma plataforma.

Las imágenes utilizadas en GeoDesk son de nivel **SLC (Single Look Complex)**: contienen la amplitud y la fase de la señal radar, siendo la fase el dato fundamental para la interferometría.

---

### Interferometría SAR (InSAR)

La **interferometría SAR** es una técnica geodésica que mide cambios submétricos en la distancia entre el satélite y la superficie terrestre comparando la **fase** de dos imágenes radar adquiridas en pasadas distintas.

#### Principio físico

Cuando el satélite emite un pulso de microondas, el eco vuelve con un retardo proporcional a la distancia. Ese retardo se codifica como **fase** φ (un valor cíclico entre −π y +π). Al restar la fase de dos imágenes del mismo lugar tomadas en fechas diferentes, se obtiene un **interferograma**: una imagen en la que los patrones de franjas (∼5.6 cm por franja) revelan cambios en la línea de visión del radar (LOS, Line-of-Sight).

```
φ_interferograma = φ₂ − φ₁ = (4π / λ) · Δr + φ_topo + φ_atm + φ_ruido
```

Donde:
- **λ** = longitud de onda del radar (0.05546576 m para Sentinel-1 banda C)
- **Δr** = desplazamiento real de la superficie en la dirección LOS
- **φ_topo** = contribución topográfica (removida con un DEM)
- **φ_atm** = error introducido por la atmósfera (principalmente vapor de agua)
- **φ_ruido** = decorrelación temporal y espacial

Una vez eliminada la contribución topográfica y desenrollada la fase (conversión de valores cíclicos −π/+π a valores continuos acumulativos), el desplazamiento en milímetros se obtiene como:

```
Desplazamiento (m) = (fase_desenrollada × λ) / (−4π)
Deformación (mm)   = Desplazamiento (m) × 1000
```

Este es exactamente el cálculo implementado en GeoDesk (`λ = 0.05546576 m`).

#### ¿Por qué pares de imágenes?

El interferograma requiere dos escenas: una **imagen de referencia (master)** y una **imagen secundaria (slave)**. Las escenas deben compartir la misma geometría de adquisición (misma órbita relativa y marco) para que los píxeles se correspondan espacialmente. Si el intervalo temporal es demasiado largo, la vegetación y otras superficies cambian suficientemente para destruir la correlación de fase (**decorrelación temporal**). Por eso Sentinel-1 opera con ciclos de 12 días: es el compromiso óptimo entre cobertura temporal y coherencia de la señal.

#### Coherencia

La **coherencia** (0 a 1) mide la estabilidad de la fase entre ambas imágenes. Un valor cercano a 1 indica que la superficie no cambió entre adquisiciones (suelos desnudos, estructuras urbanas). Valores bajos indican zonas que han cambiado o son inherentemente inestables (agua, vegetación densa). La coherencia se usa como máscara de calidad: píxeles con coherencia baja se descartan del análisis de deformación.

---

## HyP3 — Procesamiento en la nube

**HyP3 (Hybrid Pluggable Processing Pipeline)** es el servicio de procesamiento en la nube de **Alaska Satellite Facility (ASF)**. Ejecuta el flujo completo de InSAR sobre pares de granules Sentinel-1 usando el procesador **GAMMA** sin requerir infraestructura local.

### Pipeline INSAR_GAMMA

| Paso | Operación | Descripción |
|------|-----------|-------------|
| 1 | Corregistro | Alinea ambas imágenes SLC con precisión subpíxel usando la efemérides orbital y el DEM |
| 2 | Generación de interferograma | Multiplica una imagen por el conjugado complejo de la otra → diferencia de fase |
| 3 | Filtrado Goldstein | Reduce el ruido speckle preservando la señal de deformación |
| 4 | Desenrollado de fase | Convierte la fase cíclica (−π, +π) a valores continuos acumulativos |
| 5 | Geocodificación | Proyecta los resultados al sistema de coordenadas WGS84 (EPSG:4326) |
| 6 | Generación de DEM | Incluye el Modelo Digital de Elevación utilizado para remover la topografía |
| 7 | Cálculo de coherencia | Genera el mapa de calidad de la señal (0–1) |

### Productos de salida

| Archivo | Contenido | Uso en GeoDesk |
|---------|-----------|----------------|
| `*_unw_phase.tif` | Fase desenrollada (radianes) | Base para calcular deformación en mm |
| `*_corr.tif` | Coherencia (0–1) | Máscara de calidad |
| `*_amp.tif` | Amplitud radar | Referencia geométrica |
| `*_dem.tif` | Modelo Digital de Elevación | Contexto topográfico |
| `*_lv_phi.tif` / `*_lv_theta.tif` | Vectores LOS (azimut e incidencia) | Geometría de observación |
| `*_water_mask.tif` | Máscara de cuerpos de agua | Exclusión de zonas sin coherencia |

GeoDesk recibe estos ZIP directamente desde HyP3, extrae el `*_unw_phase.tif`, aplica la conversión de fase a milímetros y exporta los resultados en CSV georreferenciado con columnas: `Latitud`, `Longitud`, `Fase`, `Desplazamiento_m`, `Deformacion_mm`.

---

## ERA5 y el Filtro Atmosférico

### ¿Qué es ERA5?

**ERA5** es el reanálisis atmosférico global de quinta generación del **Centro Europeo de Previsión Meteorológica a Plazo Medio (ECMWF)**, distribuido gratuitamente a través del **Climate Data Store (CDS) de Copernicus**. Combina modelos numéricos de predicción del tiempo con millones de observaciones reales para generar una representación coherente del estado de la atmósfera desde 1940 hasta el presente.

GeoDesk utiliza ERA5 en resolución estándar (~31 km) con los siguientes productos:
- **`tcwv`** — Total Column Water Vapour (Vapor de Agua en Columna Total), en kg/m²
- **`t2m`** — Temperatura del aire a 2 metros de altura, en Kelvin

### El problema: retardo troposférico

La señal radar de Sentinel-1 viaja dos veces a través de la troposfera (bajada + subida del eco). El vapor de agua ralentiza la propagación de las microondas, introduciendo un **retardo de fase aparente** que puede confundirse con deformación real del terreno. Este error es espacialmente variable y temporalmente impredecible, y puede alcanzar varias decenas de milímetros.

### El modelo de corrección implementado

GeoDesk implementa una corrección empírica troposférica basada en los dos componentes del retardo húmedo y seco:

```
Error_atmosférico (mm) = 0.238 · Δ(PWV) + 0.035 · Δ(T)
```

Donde:
- **Δ(PWV)** = cambio en vapor de agua total entre la fecha inicial y final del interferograma (kg/m²)
- **Δ(T)** = cambio en temperatura a 2 m entre ambas fechas (K)
- **0.238** = coeficiente de conversión húmedo (mm de retardo por kg/m² de PWV)
- **0.035** = coeficiente de conversión seco/térmico (mm de retardo por K)

La deformación corregida se calcula restando este error al valor InSAR observado:

```
Deformación_corregida (mm) = Deformación_InSAR (mm) − Error_atmosférico (mm)
```

#### Origen y validación de los coeficientes

Los coeficientes **0.238** y **0.035** provienen de la literatura geodésica clásica sobre retardos troposféricos en señales de microondas. Su base física fue establecida por **Bevis et al. (1992)** en el contexto del GPS y la estimación del agua precipitable atmosférica, y extendida a InSAR por **Zebker et al. (1997)** y **Hanssen (2001)**, quienes cuantificaron el impacto estadístico del vapor de agua sobre las mediciones interferométricas.

La validez de esta aproximación lineal reside en:

1. **Componente húmedo (0.238 · ΔPWV):** El vapor de agua es el principal contribuyente al retardo húmedo. La relación entre PWV y el retardo en señales de microondas es aproximadamente lineal en el rango de condiciones troposféricas normales. El factor 0.238 relaciona el retardo en milímetros con el contenido de vapor en kg/m² a lo largo de toda la columna atmosférica. Este valor fue derivado experimentalmente comparando observaciones GPS/GNSS con radiómetros de vapor de agua y validado extensamente en zonas de alta variabilidad troposférica (zonas tropicales, costas).

2. **Componente seco/térmico (0.035 · ΔT):** Representa la variación del índice de refracción del aire seco debida a cambios de temperatura. Aunque su magnitud es menor que la del componente húmedo, es relevante en zonas de alta variabilidad térmica o en interferogramas con períodos de tiempo prolongados. El coeficiente fue ajustado a partir del modelo de Smith-Weintraub para la refractectividad atmosférica.

El filtro actúa de forma **diferencial**: no corrige el retardo absoluto de ninguna imagen, sino el **cambio** del retardo entre ambas fechas del interferograma, lo cual es consistente con la naturaleza diferencial de la propia medición InSAR.

> **Nota sobre la centralización de datos:** Los valores de deformación InSAR exportados por HyP3 contienen un offset de fase arbitrario heredado del procesamiento. GeoDesk centra los datos restando la mediana del campo de deformación antes de aplicar el filtro ERA5, asumiendo que la mayor parte del área analizada es geológicamente estable. Esto elimina el sesgo global sin alterar los gradientes espaciales de deformación.

---

## Parámetros de adquisición fijos

Para el modo de solicitud automática de imágenes (El Salvador), GeoDesk utiliza los siguientes parámetros, derivados de la geometría orbital de Sentinel-1 sobre Centroamérica:

| Parámetro | Valor | Razón |
|-----------|-------|-------|
| **Ruta relativa** | 128 | Órbita de Sentinel-1 que cubre El Salvador en geometría descendente |
| **Marco** | 547 | Subdivisión de la órbita que centra la imagen sobre el territorio |
| **Modo de haz** | IW (Interferometric Wide) | Modo estándar de Sentinel-1 para nivel L1 SLC, 250 km de swath |
| **Nivel de procesamiento** | SLC | Fase preservada, requisito indispensable para InSAR |
| **Intervalo entre pares** | 12 días | Ciclo orbital de Sentinel-1; maximiza la coherencia temporal |
| **Restricción de plataforma** | Misma (S1A ó S1B) | Evitar inconsistencias de sensor entre adquisiciones |
| **Multi-look** | 20×4 | Balance entre resolución espacial y reducción de ruido speckle |

---

## Instalación

### Requisitos

- Docker y Docker Compose
- Cuenta en [NASA Earthdata / ASF](https://urs.earthdata.nasa.gov/) — para búsqueda y descarga de granules
- Cuenta en [Copernicus CDS](https://cds.climate.copernicus.eu/) — para descarga de datos ERA5

### Configuración

Crea el archivo `backend/.env` con las siguientes variables:

```env
ASF_USERNAME=tu_usuario_earthdata
ASF_PASSWORD=tu_contraseña_earthdata
HYP3_USERNAME=tu_usuario_earthdata
HYP3_PASSWORD=tu_contraseña_earthdata
ERA5_URL=https://cds.climate.copernicus.eu/api/v2
ERA5_KEY=tu_uid:tu_api_key_copernicus
```

### Ejecución

```bash
docker compose up --build
```

La aplicación estará disponible en `http://localhost:5173` (frontend) y `http://localhost:8000` (API).
