import { useState } from "react";
import axios from "axios";
import { API_URL } from "../../services/api";

type Manifest = {
  fechas: string[];
  fase: { fecha: string; path: string }[];
  coherencia: { fecha: string; path: string }[];
  elevacion: { fecha: string; path: string }[];
};

export default function AlaskaViewer() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [idx, setIdx] = useState(0);
  const [zipFiles, setZipFiles] = useState<FileList | null>(null);
  const [view, setView] = useState<"fase" | "coherencia" | "elevacion">("coherencia");
  const [processing, setProcessing] = useState(false);

  // ===========================
  // Procesar archivos ZIP
  // ===========================
  const procesarZips = async () => {
    if (!zipFiles || zipFiles.length === 0) {
      alert("Seleccione al menos un archivo ZIP.");
      return;
    }

    const formData = new FormData();
    Array.from(zipFiles).forEach((file) => formData.append("files", file));

    setProcessing(true);

    try {
      const response = await axios.post(`${API_URL}/api/alaska/upload`, formData);

      const data = response.data;
      setManifest(data); // Aquí el backend debe devolver un manifest con las imágenes generadas
      setIdx(0);
    } catch (error) {
      console.error(error);
      alert("Error al procesar los ZIPs.");
    }

    setProcessing(false);
  };

  // ===========================
  // Si no hay manifest, mostrar selector de archivo
  // ===========================
  if (!manifest) {
    return (
      <div className="page-container" style={{ padding: 0 }}>
        <div className="header-section">
          <div className="icon-wrapper">
            <span style={{ fontSize: "1.5rem" }}>🖼️</span>
          </div>
          <div>
            <h1 style={{ background: "linear-gradient(90deg, #3b82f6, #06b6d4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Visualizador Alaska
            </h1>
            <p>Procesa múltiples archivos ZIP satelitales a la vez</p>
          </div>
        </div>
        <div className="layout-grid">
          <div className="upload-panel">
            <div className="upload-card">
              <label style={{ color: "var(--color-primary)", fontWeight: "bold", marginBottom: "8px", display: "inline-block" }}>
                Archivos a procesar
              </label>
              <div className="dropzone" style={{ marginTop: "12px", borderStyle: "dashed", borderColor: "rgba(255,255,255,0.2)" }}>
                <input
                  type="file"
                  accept=".zip"
                  multiple
                  onChange={(e) => setZipFiles(e.target.files)}
                  style={{ width: "100%", opacity: 0, position: "absolute", height: "100%", cursor: "pointer" }}
                />
                <div className="dropzone-content" style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
                  {zipFiles && zipFiles.length > 0 ? (
                    <span className="selected-file text-center" style={{ color: "var(--color-text-main)" }}>
                      {zipFiles.length} {zipFiles.length === 1 ? 'archivo seleccionado' : 'archivos seleccionados'}
                    </span>
                  ) : (
                    <span className="flex-1 text-center" style={{ color: "var(--color-text-muted)" }}>📂 Seleccionar múltiples .zip</span>
                  )}
                </div>
              </div>

              <button
                onClick={procesarZips}
                disabled={processing || !zipFiles || zipFiles.length === 0}
                className="submit-btn"
                style={{ background: "linear-gradient(135deg, #3b82f6, #06b6d4)", marginTop: "16px" }}
              >
                {processing ? (
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                    <svg className="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                    Procesando...
                  </span>
                ) : (
                  "Procesar ZIPs"
                )}
              </button>
            </div>
          </div>
          <div className="results-panel">
            <div className="data-widget" style={{ padding: "60px", textAlign: "center", color: "var(--color-text-muted)", minHeight: "500px", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
              <span style={{ fontSize: "3rem", display: "block", marginBottom: "16px", opacity: 0.5 }}>📤</span>
              Sube tus ZIPs para iniciar el procesamiento en lote
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===========================
  // Obtener imagen según vista seleccionada (fase, coherencia, elevación)
  // ===========================
  const fecha = manifest.fechas[idx];
  const getImg = (list: { fecha: string; path: string }[], f: string) =>
    list.find((entry) => entry.fecha === f)?.path ?? null;

  const img =
    view === "fase"
      ? getImg(manifest.fase, fecha)
      : view === "coherencia"
      ? getImg(manifest.coherencia, fecha)
      : getImg(manifest.elevacion, fecha);

  return (
    <div className="page-container" style={{ padding: 0 }}>
      <div className="header-section">
        <div className="icon-wrapper">
          <span style={{ fontSize: "1.5rem" }}>🖼️</span>
        </div>
        <div>
          <h1 style={{ background: "linear-gradient(90deg, #3b82f6, #06b6d4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Visualizador Alaska
          </h1>
          <p>Resultados del procesamiento para <b>{fecha}</b></p>
        </div>
      </div>

      <div className="layout-grid">
        {/* Left Panel: Params */}
        <div className="upload-panel">
          <div className="upload-card">
            <label style={{ color: "var(--color-primary)", fontWeight: "bold", marginBottom: "16px", display: "inline-block" }}>
              1. Selección de Capa
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button
                style={{
                  padding: "10px", borderRadius: "8px", textAlign: "left",
                  background: view === "coherencia" ? "rgba(59, 130, 246, 0.2)" : "var(--color-bg-main)",
                  border: view === "coherencia" ? "1px solid #3b82f6" : "1px solid rgba(255,255,255,0.1)",
                  color: view === "coherencia" ? "white" : "var(--color-text-muted)",
                  cursor: "pointer", transition: "all 0.2s"
                }}
                onClick={() => setView("coherencia")}
              >
                Coherencia
              </button>
              <button
                style={{
                  padding: "10px", borderRadius: "8px", textAlign: "left",
                  background: view === "fase" ? "rgba(59, 130, 246, 0.2)" : "var(--color-bg-main)",
                  border: view === "fase" ? "1px solid #3b82f6" : "1px solid rgba(255,255,255,0.1)",
                  color: view === "fase" ? "white" : "var(--color-text-muted)",
                  cursor: "pointer", transition: "all 0.2s"
                }}
                onClick={() => setView("fase")}
              >
                Fase
              </button>
              <button
                style={{
                  padding: "10px", borderRadius: "8px", textAlign: "left",
                  background: view === "elevacion" ? "rgba(59, 130, 246, 0.2)" : "var(--color-bg-main)",
                  border: view === "elevacion" ? "1px solid #3b82f6" : "1px solid rgba(255,255,255,0.1)",
                  color: view === "elevacion" ? "white" : "var(--color-text-muted)",
                  cursor: "pointer", transition: "all 0.2s"
                }}
                onClick={() => setView("elevacion")}
              >
                Elevación
              </button>
            </div>
            
            <button
              onClick={() => { setManifest(null); setZipFiles(null); setIdx(0); }}
              className="submit-btn"
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", marginTop: "24px", color: "white" }}
            >
              Cargar nuevos archivos
            </button>
          </div>
        </div>

        {/* Right Panel: Viewer */}
        <div className="results-panel">
          <div className="data-widget" style={{ padding: 0, display: "flex", flexDirection: "column", minHeight: "500px" }}>
            <div style={{ padding: "16px 20px", background: "var(--color-bg-card)", borderBottom: "1px solid rgba(255,255,255,0.05)", borderRadius: "12px" }}>
              <input
                type="range"
                min={0}
                max={manifest.fechas.length - 1}
                value={idx}
                onChange={(e) => setIdx(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#3b82f6" }}
              />
            </div>
            
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.2)", borderRadius: "12px", overflow: "hidden", marginTop: "20px" }}>
              {img ? (
                <img
                  src={`${API_URL}/${img.replace(/\\/g, "/")}`}
                  alt={view}
                  style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain", borderRadius: "8px" }}
                />
              ) : (
                <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
                  Imagen no disponible para esta fecha
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
