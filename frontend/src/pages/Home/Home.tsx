// Refactorized Cover.tsx
import React, { useState } from "react";
import { motion } from "framer-motion";
import { MapPin } from "lucide-react";
import "./Home.css";

import Alaska_procesamiento from "../AlaskaProcessing/AlaskaProcessing";

type GeoDeskCoverProps = {
  onNavigate: (page: string) => void;   // ⬅️ ahora obligatorio
};

export default function GeoDeskCover({ onNavigate }: GeoDeskCoverProps): React.ReactNode {
  const year = new Date().getFullYear();

  const [currentPage, setCurrentPage] = useState<string | null>(null);

  const renderPage = () => {
    switch (currentPage) {
      case "procesamiento-imagenes":
        return (
          <div className="p-4">
            <Alaska_procesamiento/>
          </div>
        );

      case "descarga-imagenes":
        return <div className="p-4">(Aquí iría tu módulo de descargas)</div>;

      default:
        return null;
    }
  };

  // SI currentPage EXISTE, MOSTRAR ESA PÁGINA Y NO LA PORTADA
  if (currentPage) {
    return <>{renderPage()}</>;
  }

  // -------------------------
  //       PORTADA
  // -------------------------
  return (
    <div className="min-h-screen flex items-center justify-center bg-container p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-8 items-center"
      >
        {/* LEFT PANEL */}
        <section className="p-8 rounded-2xl glass-card backdrop-blur-md">
          <div className="seccion-contenido">

            {/* HEADER */}
            <div className="flex items-center gap-6 mb-8">
              <div className="cover-header mb-8">
                <div className="cover-logo rounded-2xl flex items-center justify-center">
                  <MapPin className="w-8 h-8" />
                </div>

                <div className="cover-title">
                  <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">GeoDesk</h1>
                  <p className="text-sm uppercase tracking-wide opacity-80">Plataforma de geoprocesamiento</p>
                </div>

                <div className="cover-img bg-[var(--color-bg-soft)] border border-[var(--color-bg-soft)] shadow-md">
                  <img src="/imagenes/mapaMundi.png" alt="Mapa_Mundi" />
                </div>
              </div>
            </div>

            <div className="descripcion">
              <p className="prose-lg mb-6 opacity-90">
                GeoDesk es una aplicación para el procesamiento y visualización de datos geoespaciales,
                integrando herramientas como Alaska y Shiny Days para análisis, elevación y procesamiento de imágenes.
              </p>
            </div>


            <div className="mt-8">
             <a
              className="btn-cta"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                console.log("[Inicio] click — onNavigate:", typeof onNavigate, onNavigate);
                try {
                  setCurrentPage("procesamiento-imagenes");

                } catch (err) {
                  console.error("[Inicio] error calling onNavigate:", err);
                }
              }}
              aria-label="Abrir proyecto GeoDesk"
            >
              Abrir proyecto
              </a>
            </div>
    </div>

          <div className="info">
            {/* METADATOS */}
            <div className="meta flex flex-wrap gap-4 items-center mt-6">
              <h1> </h1>
              <h1> </h1>
              <h1> </h1>
              <div className="chip">Proyecto: GeoDesk</div>
              <div className="chip">Versión: 1.04</div>
              <div className="chip">{year}</div>
            </div>

            {/* AUTORES */}
            <div className="mt-8 text-sm opacity-80">
              <strong>Autores:</strong>
              <ul className="list-inside list-disc ml-4 mt-2">
                <li>Usuario: Frank</li>
                <li>Usuario: Joshua</li>
                <li>Usuario: Stanley</li>
                <li>Usuario: Adalid</li>
              </ul>
            </div>

          </div>
        </section>

        {/* RIGHT PANEL */}
        <aside className="p-6 rounded-2xl visual-card relative overflow-hidden">
          <motion.div
            initial={{ scale: 0.97 }}
            animate={{ scale: 1 }}
            transition={{ duration: 1 }}
            className="absolute inset-0 pointer-events-none opacity-70"
          >
            <svg className="w-full h-full" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
              <defs>
                <linearGradient id="g1" x1="0" x2="1">
                  <stop offset="0%" stopColor="#161616ff" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#232324ff" stopOpacity="0.85" />
                </linearGradient>
              </defs>

              <rect x="0" y="0" width="800" height="600" fill="url(#g1)" />

              <g strokeOpacity="0.35" strokeWidth="1.2" fill="none">
                <path stroke="#475569" d="M10 500 C150 420 300 520 480 390 S760 120 790 60" />
                <path stroke="#64748b" d="M0 420 C120 360 260 460 420 350 S700 90 780 40" />
                <path stroke="#334155" d="M20 560 C180 460 340 560 520 430 S780 140 800 80" />
              </g>

              <g transform="translate(60,60)">
                <rect x="0" y="0" width="120" height="80" rx="8" fill="#ffffff0A" />
                <rect x="140" y="30" width="160" height="100" rx="12" fill="#ffffff08" />
                <rect x="340" y="10" width="180" height="120" rx="10" fill="#ffffff06" />
              </g>
            </svg>
          </motion.div>

          <div className="relative z-10 rounded-xl overflow-hidden shadow-xl mb-6 mt-2 image-slot">
            <div className="flex items-center justify-center h-40 opacity-50 text-xs">

            </div>
          </div>

          <div className="datos">
            <div className="card inline-block p-4 rounded-xl">
              <h3 className="text-lg font-semibold">Procesamiento por lotes</h3>
              <p className="text-sm opacity-80">Automatiza la extracción, filtrado y análisis de imágenes.</p>
            </div>

            <div className="card inline-block p-4 rounded-xl">
              <h3 className="text-lg font-semibold">Modelo de elevación</h3>
              <p className="text-sm opacity-80">Visualiza DEMs y genera perfiles de elevación.</p>
            </div>

            <div className="card inline-block p-4 rounded-xl">
              <h3 className="text-lg font-semibold">Integración Shiny</h3>
              <p className="text-sm opacity-80">Dashboards interactivos para análisis exploratorio.</p>
            </div>
          </div>

          <div className="absolute bottom-6 right-6 text-xs opacity-50">GeoDesk • {year}</div>
        </aside>
      </motion.div>
    </div>
  );
}
