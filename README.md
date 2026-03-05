# GeoDesk

Plataforma de geoprocesamiento para análisis de imágenes satelitales, extracción de datos meteorológicos y visualización de modelos de elevación y deformación.

Esta aplicación tiene una arquitectura separada (Backend en FastAPI + Python y Frontend en React + Vite).

---

## Estructura del Proyecto

### Backend (`/backend`)

El backend utiliza **FastAPI** para servir los endpoints y gestionar el procesamiento intensivo de datos espaciales.

**Estructura principal:**

- `app.py`: Punto de entrada de la aplicación. Configura middlewares, CORS, rutas estáticas y enlaza todos los _routers_ de los distintos módulos.
- `requirements.txt`: Dependencias del sistema (FastAPI, rasterio, asf_search, xarray, matplotlib, etc.).
- `routes/`: Contiene los controladores que definen los endpoints de la API, organizados modularmente:
  - `alaska.py`: Búsqueda y descarga de imágenes desde la API de ASF (Alaska Satellite Facility).
  - `alaska_procesamiento.py` / `alaska_procesamiento_varios.py`: Rutas dedicadas al procesamiento masivo de archivos InSAR y metadatos desde ASF.
  - `era5.py` / `era5_procesamiento_nc.py`: Descarga y extracción de variables climáticas en formato NetCDF (`.nc`) provenientes de Copernicus (ERA5).
  - `deformacion.py` / `temperatura_deformacion.py`: Herramientas matemáticas y visuales para graficar o cruzar variables de temperatura con modelos de deformación en series de tiempo.
  - `procesamiento_general.py`: Utilerías compartidas o endpoints para tareas geográficas de carácter general.
- `services/`:
  - `image_processing.py`: Contiene la capa de lógica de negocio pura para manipular rasters (clasificar variables como fase/elevación, transformar geometrías, generar proyecciones y exportar pngs).
- `utils/`:
  - `file_handling.py`: Manejo modular de archivos. Extracción en memoria de ZIPs, creación de directorios temporales rotativos y lectura iterativa rápida de metadatos espaciales.

### Frontend (`/frontend`)

Aplicación SPA moderna construida con **React, TypeScript y Vite**.

**Estructura principal:**

- `src/App.tsx`: Layout principal que orquesta el enrutamiento de la interfaz lógica según el estado de `activeSection` y envuelve a los componentes principales.
- `src/main.tsx`: Punto de montaje inicial de React al DOM.
- `src/services/api.ts`: **Capa centralizada de llamadas a la API**. Exporta instancias de `axios` pre-configuradas y la variable `API_URL` maestra para facilitar cualquier conexión unificada al backend sin importar del entorno.
- `src/components/`: Componentes transversales reutilizables como la barra lateral (`Navbar.tsx`).
- `src/pages/`:
  - `Home/`: Pantalla inicial de bienvenida ("Cover") del proyecto (con diseño glassmorphism y métricas rápidas).
  - `Alaska/`: Integración con Alaska Satellite Facility (búsqueda interactiva de escenas mediante polígonos, filtrado y submenús de descarga de proyectos analíticos InSAR/GAMMA).
  - `AlaskaProcessing/` & `AlaskaProcessingVarious/`: Dashboards especiales con _canvas_ inyectados para renderizar de manera interactiva visualizaciones generadas por el backend (Coherencia, Fase, Elevación).
  - `Era5/` & `Era5ProcessingNc/`: Interfaz para selección visual (mediante un mapa con dibujado de rectángulo) de un área temporal y espacial a procesar hacia formato NC.
  - `Deformacion/` & `TemperatureDeformation/`: Secciones para cargar y visualizar analíticas y variables en formato gráfico para comparar tendencias.

---

## Instalación y Ejecución

### Requisitos Previos

- Python 3.10+
- Node.js 18+
- npm (o yarn/pnpm)

### Iniciar el Backend (Modo Desarrollo)

1. Abrir una terminal en el directorio base: `cd backend`
2. Crear un entorno virtual: `python -m venv .venv`
3. Activar entorno virtual:
   - Linux/Mac: `source .venv/bin/activate`
   - Windows: `.venv\Scripts\activate`
4. Instalar dependencias: `pip install -r requirements.txt`
5. Ejecutar la API: `python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload`
   _(El backend quedará levantado en `http://127.0.0.1:8000`)_

### Iniciar el Frontend (Modo Desarrollo)

1. Abrir una nueva terminal. Ir a frontend: `cd frontend`
2. Instalar las dependencias de node: `npm install`
3. Levantar entorno dev: `npm run dev`
   _(El frontend levantará usualmente bajo `http://localhost:5173` o el puerto que designe vite)_

---

## Notas de Desarrollo (Refactorización de Arquitectura)

Esta aplicación fue recientemente refactorizada para:

- **Segregación de Responsabilidades Técnicas:** Mover lógica algorítmica y de manipulación de archivos que previamente existían en `app.py` crudo y endpoints hacia los módulos limpios de la carpeta `/services` y `/utils`.
- **Integración de Axios centralizada:** Sustituir llamadas dispersas en el frontend mediante el API manager en (`frontend/src/services/api.ts`).
- **Nomenclatura (CamelCase / PascalCase):** Estandarización unificada de nombres de directorios para React conformando a guías globales de estilo Frontend.
