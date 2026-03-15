import React, { useState, useEffect, useRef } from "react";

import { Globe2, Layers, Cpu, CloudRain } from "lucide-react";
import Globe from "react-globe.gl";
import type { GlobeMethods } from "react-globe.gl";

import Alaska_procesamiento from "../AlaskaProcessing/AlaskaProcessing";

type GeoDeskCoverProps = {
  onNavigate: (page: string) => void;
};

export default function GeoDeskCover({ onNavigate }: GeoDeskCoverProps): React.ReactNode {
  const year = new Date().getFullYear();
  const [currentPage, setCurrentPage] = useState<string | null>(null);
  const globeEl = useRef<GlobeMethods | undefined>(undefined);

  // Configuración de texturas para el globo
  const globeImageUrl = "//unpkg.com/three-globe/example/img/earth-dark.jpg";
  const bumpImageUrl = "//unpkg.com/three-globe/example/img/earth-topology.png";

  useEffect(() => {
    // Configura la cámara inicial para que mire a Centro/Norte América con una perspectiva adecuada
    if (globeEl.current) {
      globeEl.current.pointOfView({ lat: 15, lng: -90, altitude: 2.0 });
      globeEl.current.controls().autoRotate = true;
      globeEl.current.controls().autoRotateSpeed = 0.5;
    }
  }, []);

  const renderPage = () => {
    switch (currentPage) {
      case "procesamiento-imagenes":
        return (
          <div className="p-4">
            <Alaska_procesamiento />
          </div>
        );
      default:
        return null;
    }
  };

  if (currentPage) {
    return <>{renderPage()}</>;
  }

  return (
    <div className="home-wrapper">
      {/* SECTION 1: GLOBE HERO */}
      <div className="home-hero">
        <div className="home-globe-container">
          <Globe
            ref={globeEl}
            globeImageUrl={globeImageUrl}
            bumpImageUrl={bumpImageUrl}
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
            showAtmosphere={true}
            atmosphereColor="#3b82f6"
            atmosphereAltitude={0.15}
          />
        </div>
        
        <div className="home-hero-content">
          <div className="home-badge">
            <Globe2 />
            <span>BETA SYSTEM V1.04</span>
          </div>

          <h1 className="home-title">
            Descifra la <br/>
            <span className="gradient-text">
              Dinámica Terrestre
            </span>
          </h1>

          <p className="home-subtitle">
            GeoDesk es un entorno de geoprocesamiento avanzado. Combina el poder de la 
            interferometría SAR (HyP3) y la reanudación meteorológica (ERA5) para 
            analizar subsidencias, temperaturas y velocidades de deformación a nivel milimétrico.
          </p>

          <div className="home-actions">
            <button
              onClick={() => setCurrentPage("procesamiento-imagenes")}
              className="btn-primary"
            >
              Iniciar Análisis InSAR
            </button>
            <button
              onClick={() => onNavigate("comparativa-era5")}
              className="btn-secondary"
            >
              Explorar Clima ERA5
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 2: CARDS / FEATURES */}
      <div className="home-features">
        <div className="home-feature-card">
          <div className="feature-icon feature-insar">
            <Cpu />
          </div>
          <h3>Alaska HyP3</h3>
          <p>
            Orquestación satelital en la nube. Procesa pares de imágenes Sentinel-1 para generar fase desenrollada y mapas de coherencia con precisión orbital.
          </p>
        </div>

        <div className="home-feature-card">
          <div className="feature-icon feature-velocidad">
            <Layers />
          </div>
          <h3>Velocidad y Extracción</h3>
          <p>
            Herramienta interactiva para recortar geometrías espaciales sobre el globo. Convierte radianes interferométricos a una tabla de desplazamientos anuales (mm/yr).
          </p>
        </div>

        <div className="home-feature-card">
          <div className="feature-icon feature-clima">
            <CloudRain />
          </div>
          <h3>Copernicus ERA5</h3>
          <p>
            Modelado climático. Mapea la temperatura térmica de NetCDFs europeos exactamente sobre los radares InSAR para correlacionar distorsiones atmosféricas.
          </p>
        </div>
      </div>

      {/* SECTION 3: FOOTER */}
      <footer className="home-footer">
        <p>© {year} GeoDesk Project. Diseñado con Three.js & React-Globe.</p>
        <div className="footer-links">
          <span>Sentinel-1</span>
          <span>|</span>
          <span>Copernicus</span>
          <span>|</span>
          <span>ASF</span>
        </div>
      </footer>
    </div>
  );
}
