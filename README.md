# GeoDesk

Plataforma interactiva de geoprocesamiento para análisis interferométrico de imágenes Sentinel-1, extracción de series temporales de deformación terrestre y corrección atmosférica avanzada utilizando el algoritmo SBAS de MintPy apoyado en modelos climáticos de Copernicus ERA5.

---

## Tabla de Contenidos

1. [Tecnologías de base](#tecnologías-de-base)
2. [Interferometría SAR (InSAR)](#interferometría-sar-insar)
3. [Procesamiento Híbrido: ASF HyP3](#procesamiento-híbrido-asf-hyp3)
4. [Análisis de Series Temporales (SBAS) con MintPy](#análisis-de-series-temporales-sbas-con-mintpy)
5. [Corrección Atmosférica (PyAPS + ERA5)](#corrección-atmosférica-pyaps--era5)
6. [Instalación y Uso](#instalación-y-uso)

---

## Tecnologías de base

### Sentinel-1

**Sentinel-1** es una constelación de satélites de la ESA (Agencia Espacial Europea) equipados con radar de apertura sintética (SAR) operando en banda C (longitud de onda $\lambda \approx 5.546$ cm). Opera independientemente de la luz solar y penetra coberturas nubosas, asegurando capturas sistemáticas con un periodo de revisita de 12 días bajo geometrías orbitales exactas.

Las imágenes ingeridas por el ecosistema son de nivel **SLC (Single Look Complex)**, lo que preserva tanto la amplitud como la fase de la onda electromagnética en retrodispersión, un requerimiento absoluto para las técnicas geodésicas.

---

## Interferometría SAR (InSAR)

La **interferometría SAR** mide desplazamientos submétricos en la superficie del terreno comparando las variaciones de fase entre adquisiciones SAR separadas en el tiempo.

### Principio físico

Cuando el radar emite un pulso, este rebota y vuelve con un retardo de ida y vuelta. Este retardo se registra como **fase** ($\phi$) en valores angulares cíclicos de $-\pi$ a $+\pi$. Al sustraer matemáticamente la fase de dos imágenes SLC de la misma trayectoria (formando un **interferograma**), las franjas espectrales resultantes mapean las alteraciones de distancia en la Línea de Visión del radar (LOS).

La fase interferométrica $\Delta\phi$ agrupa múltiples componentes físicas:
$$ \Delta\phi = \phi_{\text{def}} + \phi_{\text{topo}} + \phi_{\text{atm}} + \phi_{\text{orb}} + \phi_{\text{ruido}} $$

Donde:
- **$\phi_{\text{def}}$** = Señal real de deformación tectónica o geológica.
- **$\phi_{\text{topo}}$** = Fase topográfica intrínseca (removida usando un DEM).
- **$\phi_{\text{atm}}$** = Retardo introducido por la tropósfera y ionósfera.
- **$\phi_{\text{orb}}$** = Errores de trayectoria orbital (rampas de fase).
- **$\phi_{\text{ruido}}$** = Ruido térmico y decorrelación temporal/espacial.

Mediante el algoritmo del sistema, la topografía se aísla, se "desenrolla" la fase (*unwrapping* a una serie métrica continua), y el residuo se despliega como movimiento en terreno:
$$ d = \frac{-\Delta\phi \cdot \lambda}{4\pi} $$

---

## Procesamiento Híbrido: ASF HyP3

GeoDesk conecta bidireccionalmente sus lotes de trabajo con **HyP3 (Hybrid Pluggable Processing Pipeline)**, el servicio distribuido de Alaska Satellite Facility.

HyP3 ejecuta el núcleo pesado en la nube usando el software GAMMA, desarrollando los siguientes bloques por cada par SLC:
1. **Corregistro Subpíxel**: Sincroniza las mallas con las efemérides Precise Orbit Ephemerides (POEORB).
2. **Generación del Interferograma** diferencial multicanal.
3. **Desenrollado Geodésico** a través de SNAPHU (Statistical-Cost, Network-Flow Algorithm).
4. **Geocodificación** y eyección de modelos Digital Elevation Models (DEM) y mapas angulares en espacio afín WGS84 (EPSG:4326).

---

## Análisis de Series Temporales (SBAS) con MintPy

Los interferogramas crudos contienen artefactos significativos de atmósfera y error orbital. Para mitigar esto y extraer subsidencia milimétrica robusta, GeoDesk confía en un pipeline backend automatizado impulsado por **MintPy (Miami INsar Time-series software in PYthon)**.

MintPy aplica la técnica **SBAS (Small Baseline Subset)**. En vez de depender de un solo par de imágenes espartanas, el algoritmo lee decenas de matrices interferométricas simultáneamente. Evaluando la redundancia geométrica de una red fuertemente conectada de pares temporales, realiza una inversión matricial por **Mínimos Cuadrados Ponderados (WLS)** o **Descomposición en Valores Singulares (SVD)** para separar matemáticamente la historia cronológica de deformación del error estocástico.

GeoDesk invoca asíncronamente las siguientes capas científicas de MintPy:
- Corrección de plano residual (Deramping).
- Aislamiento y validación de puntos de referencia espacial con coherencia superior a 0.85 (Seed Points), eliminando la necesidad de sustracciones empíricas (como restar la mediana estadística) que falsifican los movimientos sísmicos reales asimétricos oscureciéndolos a cero.
- Mapeo dinámico y tabulación generada a Microsoft Excel, dividiendo el historial consolidado de velocidad y el vector discreto de cada paso temporal.

### Descomposición Geométrica 2D (Vertical & Este-Oeste)

Cuando se provee al motor una ingesta combinada de interferogramas de órbita **Ascendente** (apuntando al Este) y **Descendente** (apuntando al Oeste), GeoDesk resuelve automáticamente la descomposición 2D. Esta técnica aprovecha las matrices de ángulos de incidencia ($\theta$) y acimut ($\alpha$) del sensor para separar la velocidad unidimensional bidireccional (LOS) en vectores puros tridimensionales (Proyectando el vector Norte-Sur muy cercano al plano orbital como despreciable).

Dada una geometría:
- Componente Ascendente Este-Oeste: $A_{\text{asc\_ew}} = -\sin(\theta_{\text{asc}}) \cos(\alpha_{\text{asc}})$
- Componente Ascendente Vertical: $A_{\text{asc\_up}} = \cos(\theta_{\text{asc}})$
- La matriz analítica se resuelve mediante la Regla de Cramer iterando el determinante diferencial (Jacobiano) sobre cada píxel superpuesto geográficamente:
$$ \text{Det} = (A_{\text{asc\_ew}} \cdot A_{\text{desc\_up}}) - (A_{\text{asc\_up}} \cdot A_{\text{desc\_ew}}) $$
$$ V_{\text{EW}} = \frac{A_{\text{desc\_up}} V_{\text{asc}} - A_{\text{asc\_up}} V_{\text{desc}}}{\text{Det}} $$
$$ V_{\text{UP}} = \frac{-A_{\text{desc\_ew}} V_{\text{asc}} + A_{\text{asc\_ew}} V_{\text{desc}}}{\text{Det}} $$

### Precisión Topológica y Proyección Subpíxel (GDAL/WGS84)

La integración entre backend (procesos matriz) e interfaz (Leaflet) requiere evitar truncamientos geométricos debido a la rotación entre el sistema coordenado universal (Lat/Lon) y las redes proyectadas (UTM) subyacentes a Sentinel-1 geocodificado:
1. **Recorte Inteligente (`subset.lalo`)**: El geoprocesador delega el cálculo afín al parser interno GDAL nativo de MintPy, interceptando la caja delimitadora espacial real generada por el usuario en lugar de aproximar las áreas de memoria truncando con las esquinas rotadas (error clásico que causa desbordamientos subpíxel norte-sur).
2. **Registro de Pixeles Grid-Node**: En topologías InSAR afines, las coordenadas almacenadas ($X_{\text{FIRST}}$, $Y_{\text{FIRST}}$) definen la **arista superior izquierda** absoluta de la matriz para facilitar las mallas de color continuo. GeoDesk aplica matemáticamente un *half-pixel shift* de mapeo ($+ 0.5 \cdot Y_{\text{STEP}}$) garantizando que la cartografía final posicione los centroides de manera que encajen perfectos a fracción de milímetro con variables geodésicas en GIS y MapBox/Leaflet.

---

## Corrección Atmosférica (PyAPS + ERA5)

El mayor desafío del InSAR geodésico es el Retraso Troposférico Ceníteo (ZTD): bolsas invisibles de humedad y condensación termo-barométrica retrasan asimétricamente la transmisión de pulsos electromagnéticos provocando deformación terrestre *fantasma*.

Para la validación científica de sus datos, el motor GeoDesk implementa una capa de integración nativa con **PyAPS (Python-based Atmospheric Phase Screen)** y el conjunto de datos de reanálisis **ERA5** de ECMWF.

**Dinámica computacional:**
1. Al invocar MintPy, la plataforma inyecta de forma segura los tokens API (CDS API) hacia el backend dockerizado.
2. MintPy invoca `correct_troposphere` antes de la inversión lineal de SBAS.
3. El módulo escanea las líneas temporales de las capturas InSAR, interceptando el centro de la escena, y lanza un canal de descarga para solicitar a la Agencia Espacial Europea los volúmenes climáticos GRIB GCM (Global Climate Models) a los niveles de presión precisos en el instante de tiempo *exacto* de la captura satelital original.
4. Extrapolando la elevación tridimensional de los píxeles radar a través del DEM, el **Phase Screen atmosférico** es calculado tridimensionalmente e invertido para ser sustraído del interferograma en la Línea de Visión (LOS), extinguiendo el error hidroestático antes del procesamiento de subsidencia.

Esta robusta sinergia geofísica convierte el output crudo del radar en datos aptos para toma de decisión sísmica e infraestructura.

---

## Instalación y Uso

### Dependencias Externas Requeridas

- Docker / Docker Compose.
- Cuenta en [ASF / NASA Earthdata](https://urs.earthdata.nasa.gov/).
- Cuenta en [Copernicus Climate Data Store (CDS)](https://cds.climate.copernicus.eu/) para acceder al pipeline atmosférico ERA5.

### Configuración del Entorno de Explotación

Crea un archivo `.env` en el directorio `backend/` conteniendo lo siguiente:

```env
# NASA Earthdata (Acceso a SLCs e HyP3)
ASF_USERNAME=tu_usuario
ASF_PASSWORD=tu_contraseña

# ASF HyP3 Enterprise API
HYP3_USERNAME=tu_usuario
HYP3_PASSWORD=tu_contraseña

# Copernicus ERA5 API (Tropospheric Sync)
ERA5_URL=https://cds.climate.copernicus.eu/api
ERA5_KEY=tu_uid:tu_api_key_copernicus
```

### Inicialización

Construye la matriz de contenedores ejecutando:

```bash
docker compose up --build
```

- La interfaz visual está delegada hacia `http://localhost:5173`.
- El servicio orquestador de análisis Python / MintPy operando por debajo escuchará en `http://localhost:8000`.
