import React, { useState } from "react";
import axios from "axios";
import { API_URL } from "../../services/api";
const Era5Procesamiento: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDateIndex, setSelectedDateIndex] = useState(0);
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // ----------------------------
  // 1. Manejar carga de archivo
  // ----------------------------
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  // ----------------------------
  // 2. Enviar archivo al backend
  // ----------------------------
  const handleUpload = async () => {
    if (!file) {
      setMessage("⚠️ Selecciona un archivo .nc antes de continuar.");
      return;
    }

    setLoading(true);
    setMessage("⏳ Procesando archivo, por favor espera...");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await axios.post(`${API_URL}/procesar_nc`, formData);

      const data = res.data;
      setDates(data.fechas);
      setImages(data.imagenes);
      setSelectedDateIndex(0);
      setMessage("✅ Archivo procesado correctamente.");
    } catch (error: unknown) {
      setMessage("❌ Error al cargar o procesar el archivo.");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------
  // 3. Cambiar fecha con slider
  // ----------------------------
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedDateIndex(Number(e.target.value));
  };

  return (
    <div className="page-container" style={{ padding: 0 }}>
      <div className="header-section">
        <div className="icon-wrapper">
          <span style={{ fontSize: "1.5rem" }}>🌡️</span>
        </div>
        <div>
          <h1 style={{ background: "linear-gradient(90deg, #f59e0b, #ef4444)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Procesamiento ERA5
          </h1>
          <p>Genera mapas térmicos interactivos a partir de archivos NetCDF (.nc)</p>
        </div>
      </div>

      <div className="layout-grid">
        {/* Left Panel: Upload Params */}
        <div className="upload-panel">
          <div className="upload-card">
            <label style={{ color: "var(--color-primary)", fontWeight: "bold", marginBottom: "8px", display: "inline-block" }}>
              1. Selecciona un archivo .nc
            </label>
            <div className="dropzone" style={{ marginTop: "12px", borderStyle: "dashed", borderColor: "rgba(255,255,255,0.2)" }}>
              <input
                id="file-upload"
                type="file"
                accept=".nc"
                onChange={handleFileChange}
                style={{ width: "100%", opacity: 0, position: "absolute", height: "100%", cursor: "pointer" }}
              />
              <div className="dropzone-content" style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
                {file ? (
                  <span className="selected-file text-center" style={{ color: "var(--color-text-main)" }}>
                    {file.name}
                  </span>
                ) : (
                  <>
                    <span className="flex-1 text-center" style={{ color: "var(--color-text-muted)" }}>📂 Selecciona archivo .nc</span>
                    <span style={{ fontSize: "0.80rem", color: "var(--color-text-muted)", opacity: 0.7 }}>Extraerá coordenadas automáticamente</span>
                  </>
                )}
              </div>
            </div>

            <button
              onClick={handleUpload}
              disabled={!file || loading}
              className="submit-btn"
              style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)", marginTop: "16px" }}
            >
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <svg className="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Procesando...
                </span>
              ) : (
                "Subir y procesar"
              )}
            </button>
            
            {message && (
              <div style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", textAlign: "center", fontSize: "0.85rem", color: message.includes('❌') ? "#ffb4b4" : "var(--color-text-muted)" }}>
                {message}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Map viewer */}
        <div className="results-panel">
          <div className="data-widget" style={{ padding: "20px", display: "flex", flexDirection: "column", minHeight: "500px" }}>
            {images.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '20px' }}>
                <div style={{ padding: "16px 20px", background: "var(--color-bg-card)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", color: "white" }}>
                    🗓️ Fecha: {dates[selectedDateIndex]}
                  </h3>
                  <input
                    type="range"
                    min={0}
                    max={images.length - 1}
                    value={selectedDateIndex}
                    onChange={handleSliderChange}
                    style={{ width: "100%", marginTop: "16px", accentColor: "#f59e0b" }}
                  />
                </div>

                <div className="image-viewer" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.2)", borderRadius: "12px", overflow: "hidden" }}>
                  <img
                    src={`${API_URL}/${images[selectedDateIndex]}`}
                    alt={`Mapa de temperatura ${dates[selectedDateIndex]}`}
                    style={{
                      maxWidth: "100%",
                      maxHeight: "60vh",
                      objectFit: "contain",
                      borderRadius: "8px"
                    }}
                  />
                </div>
              </div>
            ) : (
               <div style={{ textAlign: "center", margin: "auto", padding: "60px", color: "var(--color-text-muted)" }}>
                 <span style={{ fontSize: "3rem", display: "block", marginBottom: "16px", opacity: 0.5 }}>🗺️</span>
                 Sube un archivo NetCDF (.nc) para visualizar los mapas térmicos de la región.
               </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Era5Procesamiento;
