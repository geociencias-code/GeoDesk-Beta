import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
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
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col justify-between">
      {/* 
        ========================
        Capa 1: Globo Terráqueo 3D
        ========================
      */}
      <div className="absolute inset-0 z-0 opacity-80 cursor-grab active:cursor-grabbing">
        <Globe
          ref={globeEl}
          globeImageUrl={globeImageUrl}
          bumpImageUrl={bumpImageUrl}
          backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
          showAtmosphere={true}
          atmosphereColor="#3b82f6"
          atmosphereAltitude={0.15}
        />
        {/* Capa de nubes manual superpuesta usando HTML/CSS no soportado nativamente, pero podemos dejar el globo en rotación suave */}
      </div>
      
      {/* Gradiente sutil para oscurecer los bordes del globo y destacar el texto */}
      <div className="absolute inset-0 z-0 bg-gradient-to-t from-black via-transparent to-black pointer-events-none opacity-60"></div>

      {/* 
        ========================
        Capa 2: Interfaz de Usuario (Glassmorphism)
        ========================
      */}
      <div className="absolute inset-0 z-20 w-full max-w-7xl mx-auto px-6 py-12 h-screen flex flex-col justify-between pointer-events-none">
        
        {/* HEADER / TITULO */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="mt-8 md:mt-16 pointer-events-auto max-w-2xl"
        >
          <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md mb-6 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
            <Globe2 className="w-5 h-5 text-blue-400" />
            <span className="text-sm font-medium tracking-wide text-blue-100">BETA SYSTEM V1.04</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-white mb-4 leading-tight">
            Descifra la <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
              Dinámica Terrestre
            </span>
          </h1>

          <p className="text-lg md:text-xl text-gray-300 mb-10 leading-relaxed font-light">
            GeoDesk es un entorno de geoprocesamiento avanzado. Combina el poder de la 
            interferometría SAR (HyP3) y la reanudación meteorológica (ERA5) para 
            analizar subsidencias, temperaturas y velocidades de deformación a nivel milimétrico.
          </p>

          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => setCurrentPage("procesamiento-imagenes")}
              className="px-8 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-lg shadow-[0_0_30px_rgba(79,70,229,0.4)] transition-all hover:scale-105 active:scale-95"
            >
              Iniciar Análisis InSAR
            </button>
            <button
              onClick={() => onNavigate("comparativa-era5")}
              className="px-8 py-4 rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 text-white font-medium text-lg backdrop-blur-md transition-all hover:scale-105"
            >
              Explorar Clima ERA5
            </button>
          </div>
        </motion.div>

        <div className="flex-grow"></div>

        {/* CARDS / FEATURES BOTTOM */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 pointer-events-auto"
        >
          {/* Card 1 */}
          <div className="group border border-white/10 bg-black/40 backdrop-blur-xl p-6 rounded-2xl hover:bg-black/60 transition-all hover:-translate-y-1">
            <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center mb-4 text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition-colors">
              <Cpu className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Alaska HyP3</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Orquestación satelital en la nube. Procesa pares de imágenes Sentinel-1 para generar fase desenrollada y mapas de coherencia con precisión orbital.
            </p>
          </div>

          {/* Card 2 */}
          <div className="group border border-white/10 bg-black/40 backdrop-blur-xl p-6 rounded-2xl hover:bg-black/60 transition-all hover:-translate-y-1">
            <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center mb-4 text-purple-400 group-hover:bg-purple-500 group-hover:text-white transition-colors">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Velocidad y Extracción</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Herramienta interactiva para recortar geometrías espaciales sobre el globo. Convierte radianes interferométricos a una tabla de desplazamientos anuales (mm/yr).
            </p>
          </div>

          {/* Card 3 */}
          <div className="group border border-white/10 bg-black/40 backdrop-blur-xl p-6 rounded-2xl hover:bg-black/60 transition-all hover:-translate-y-1">
            <div className="w-12 h-12 rounded-xl bg-teal-500/20 flex items-center justify-center mb-4 text-teal-400 group-hover:bg-teal-500 group-hover:text-white transition-colors">
              <CloudRain className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Copernicus ERA5</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Modelado climático. Mapea la temperatura térmica de NetCDFs europeos exactamente sobre los radares InSAR para correlacionar distorsiones atmosféricas.
            </p>
          </div>
        </motion.div>

        {/* FOOTER METADATA */}
        <div className="flex items-center justify-between text-xs text-gray-500 border-t border-white/10 pt-4 pointer-events-auto">
          <p>© {year} GeoDesk Project. Diseñado con Three.js & React-Globe.</p>
          <div className="flex gap-4">
            <span>Sentinel-1</span>
            <span>|</span>
            <span>Copernicus</span>
            <span>|</span>
            <span>ASF</span>
          </div>
        </div>

      </div>
    </div>
  );
}
