import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileUp, CloudRain, Image as ImageIcon, ChevronLeft, ChevronRight, X, Info, Download, Table2 } from "lucide-react";
import axios from "axios";
import { API_URL } from "../../services/api";

type AnalysisResult = {
  fecha: string;
  disp_min: number;
  disp_max: number;
  temp_promedio: number;
  img_url: string;
  csv_url?: string;
  data_preview?: Array<{
    Latitud: number;
    Longitud: number;
    Valor_Sentinel: number;
    "Temp_2m_ERA5_(C)": number | string;
    "Temp_10m_ERA5_(C)": number | string;
    "Vapor_Agua_(mm)": number | string;
    "Humedad_Relativa_(%)": number | string;
    "Factor_Error_(%)": number;
  }>;
};

export default function Era5SentinelComparative() {
  const [ncFile, setNcFile] = useState<File | null>(null);
  const [zipFiles, setZipFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleNcChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setNcFile(e.target.files[0]);
    }
  };

  const handleZipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setZipFiles(Array.from(e.target.files));
    }
  };

  const removeZipFile = (index: number) => {
    setZipFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (!ncFile || zipFiles.length === 0) {
      setError("Por favor, selecciona un archivo .nc de ERA5 y al menos un .zip de Sentinel.");
      return;
    }

    const formData = new FormData();
    formData.append("nc_file", ncFile);
    zipFiles.forEach((file) => formData.append("zip_files", file));

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const res = await axios.post(`${API_URL}/api/v1/era5_sentinel_comparative`, formData);
      const data = res.data;

      if (!data.resultados || data.resultados.length === 0) {
        setError("No se pudo generar la comparativa con los archivos proporcionados.");
        return;
      }

      setResults(data.resultados);
      setCurrentIndex(0);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response) {
        setError(err.response.data.detail || "Error al procesar archivos");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Error inesperado al conectar con el servidor.");
      }
      console.error("Error upload:", err);
    } finally {
      setLoading(false);
    }
  };

  const nextImage = () => setCurrentIndex((prev) => (prev + 1) % results.length);
  const prevImage = () => setCurrentIndex((prev) => (prev - 1 + results.length) % results.length);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="page-container"
    >
      <div className="header-section">
        <div className="icon-wrapper">
          <CloudRain className="w-8 h-8" />
        </div>
        <div>
          <h1>Comparativa ERA5 & Sentinel</h1>
          <p>Unificación espacio-temporal y contextual</p>
        </div>
      </div>

      <div className="layout-grid">
        {/* Upload Section */}
        <div className="upload-panel">
          <div className="upload-card">
            <label>
              <CloudRain className="w-4 h-4" />
              Contexto Meteorológico (ERA5)
            </label>
            <div className="dropzone">
              <input
                type="file"
                accept=".nc"
                onChange={handleNcChange}
              />
              <div className="dropzone-content">
                {ncFile ? (
                  <span className="selected-file">{ncFile.name}</span>
                ) : (
                  <span>Click para seleccionar archivo .nc</span>
                )}
              </div>
            </div>
          </div>

          <div className="upload-card">
            <label>
              <ImageIcon className="w-4 h-4" />
              Imágenes Satelitales (Sentinel)
            </label>
            <div className="dropzone">
              <input
                type="file"
                accept=".zip"
                multiple
                onChange={handleZipChange}
              />
              <div className="dropzone-content" style={{ flexDirection: 'column', gap: '8px' }}>
                {zipFiles.length > 0 ? (
                  <>
                    <span className="selected-file text-center">
                      {zipFiles.length} {zipFiles.length === 1 ? 'archivo seleccionado' : 'archivos seleccionados'}
                    </span>
                    <ul className="file-list" style={{ width: '100%', marginTop: '0', background: 'transparent', padding: '0', border: 'none' }}>
                      {zipFiles.map((file, i) => (
                        <li key={i} style={{ background: 'rgba(0,0,0,0.3)', marginBottom: '4px' }}>
                          <span className="truncate flex-1">{file.name}</span>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              removeZipFile(i);
                            }}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-center">Seleccionar múltiples archivos .zip</span>
                    <FileUp className="w-5 h-5" />
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={handleUpload}
              disabled={loading || !ncFile || zipFiles.length === 0}
              className="submit-btn"
            >
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <svg className="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Procesando...
                </span>
              ) : (
                "Generar Comparativa"
              )}
            </button>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="error-banner"
              >
                <Info className="w-5 h-5" />
                <p>{error}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Results Display */}
        <div className="results-panel">
          {results.length === 0 ? (
            <div className="empty-state">
              <ImageIcon className="w-16 h-16" />
              <h3>No hay resultados</h3>
              <p>Sube los datos meteorológicos y satelitales para visualizar el cruce.</p>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
            >
              {/* Visualizer */}
              <div className="image-viewer">
                <img
                  src={`${API_URL}/${results[currentIndex].img_url}`}
                  alt={`Comparativa ${results[currentIndex].fecha}`}
                />
                
                <div className="overlay-controls">
                  <div className="image-info">
                    <h2>{results[currentIndex].fecha}</h2>
                    <div className="metrics">
                      <span>Temp (ERA5): {results[currentIndex].temp_promedio.toFixed(2)} K</span>
                      <span className="divider"></span>
                      <span>Disp Min: {results[currentIndex].disp_min.toFixed(2)}</span>
                      <span className="divider"></span>
                      <span>Disp Max: {results[currentIndex].disp_max.toFixed(2)}</span>
                    </div>
                  </div>
                  
                  <div className="navigation">
                    <button onClick={prevImage} className="nav-btn">
                      <ChevronLeft />
                    </button>
                    <span className="counter">
                      {currentIndex + 1} / {results.length}
                    </span>
                    <button onClick={nextImage} className="nav-btn">
                      <ChevronRight />
                    </button>
                  </div>
                </div>
              </div>

              {/* Data Preview & Download */}
              {results[currentIndex].csv_url && results[currentIndex].data_preview && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="data-widget"
                >
                  <div className="widget-header">
                    <div className="title-block">
                      <div className="icon-box">
                        <Table2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h4>Datos y Factor de Error</h4>
                        <p>Previsualización de coordenadas locales</p>
                      </div>
                    </div>
                    
                    <a
                      href={`${API_URL}/${results[currentIndex].csv_url}`}
                      download
                      className="export-btn"
                    >
                      <Download className="w-4 h-4" />
                      <span>Exportar CSV</span>
                    </a>
                  </div>
                  
                  <div className="table-responsive">
                    <table className="modern-table">
                      <thead>
                        <tr>
                          <th>Latitud</th>
                          <th>Longitud</th>
                          <th style={{textAlign: 'center'}}>Sentinel (Base)</th>
                          <th style={{textAlign: 'center'}}>Temp 2m (°C)</th>
                          <th style={{textAlign: 'center'}}>Temp 10m (°C)</th>
                          <th style={{textAlign: 'center'}}>Vapor (mm)</th>
                          <th style={{textAlign: 'center'}}>HR (%)</th>
                          <th style={{textAlign: 'right'}}>Factor Error (%)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results[currentIndex].data_preview.map((row, i) => (
                          <tr key={i}>
                            <td>{row.Latitud.toFixed(5)}</td>
                            <td>{row.Longitud.toFixed(5)}</td>
                            <td style={{textAlign: 'center', color: 'var(--color-text-muted)'}}>{typeof row.Valor_Sentinel === 'number' ? row.Valor_Sentinel.toFixed(4) : row.Valor_Sentinel}</td>
                            <td style={{textAlign: 'center'}}>{typeof row["Temp_2m_ERA5_(C)"] === 'number' ? row["Temp_2m_ERA5_(C)"].toFixed(2) : row["Temp_2m_ERA5_(C)"]}</td>
                            <td style={{textAlign: 'center', color: 'var(--color-text-muted)'}}>{typeof row["Temp_10m_ERA5_(C)"] === 'number' ? row["Temp_10m_ERA5_(C)"].toFixed(2) : row["Temp_10m_ERA5_(C)"]}</td>
                            <td style={{textAlign: 'center', color: 'var(--color-text-muted)'}}>{typeof row["Vapor_Agua_(mm)"] === 'number' ? row["Vapor_Agua_(mm)"].toFixed(2) : row["Vapor_Agua_(mm)"]}</td>
                            <td style={{textAlign: 'center', color: 'var(--color-text-muted)'}}>{typeof row["Humedad_Relativa_(%)"] === 'number' ? row["Humedad_Relativa_(%)"].toFixed(2) : row["Humedad_Relativa_(%)"]}</td>
                            <td className="error-col" style={{ color: `hsl(${120 - ((typeof row["Factor_Error_(%)"] === 'number' ? row["Factor_Error_(%)"] : 0) * 1.2)}, 70%, 45%)` }}>
                              {typeof row["Factor_Error_(%)"] === 'number' ? row["Factor_Error_(%)"].toFixed(2) : row["Factor_Error_(%)"]}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="note">
                    Mostrando muestra representativa de puntos. Descarga el CSV para ver {">"} 20,000 puntos.
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
