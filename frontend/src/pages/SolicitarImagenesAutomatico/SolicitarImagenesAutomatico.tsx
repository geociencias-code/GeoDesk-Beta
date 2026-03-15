import React, { useState } from "react";
import axios from "axios";
import { API_URL } from "../../services/api";

interface TimeWindow {
  start: string;
  end: string;
}

interface Summary {
  found_scenes: number;
  built_pairs: number;
  submitted_jobs: number;
  output_folder_hint: string;
}

interface ApiError {
  code: string;
  message: string;
}

interface ResponseData {
  project: string;
  project_input?: string | null;
  time_window: TimeWindow | null;
  summary: Summary;
  error?: ApiError | null;
}

const SolicitarImagenesAutomatico: React.FC = () => {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!startDate || !endDate) {
      setError("Por favor, selecciona ambas fechas.");
      return;
    }

    if (!projectName.trim()) {
      setError("Por favor, escribe un nombre de proyecto.");
      return;
    }

    try {
      setLoading(true);


      const payload = {
        start_date: `${startDate}T00:00:00Z`,
        end_date: `${endDate}T23:59:59Z`,
        project_name: projectName.trim(),
      };

      // Enviar la solicitud al backend
      const response = await axios.post<ResponseData>(
        `${API_URL}/api/solicitar_imagenes`,
        payload
      );

      const data = response.data;

      if (data.error) {
        setError(data.error.message || "Ocurrió un error en el backend.");
        setResult(null);
        return;
      }

      setResult(data);
    } catch (err: unknown) {
      console.error(err);

      if (axios.isAxiosError(err)) {
        const detail =
          err.response?.data?.detail ||
          err.message ||
          "Error al solicitar imágenes.";
        setError(typeof detail === "string" ? detail : "Error al solicitar imágenes.");
      } else {
        setError("Error inesperado al solicitar imágenes.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container" style={{ padding: 0 }}>
      {/* Header */}
      <div className="header-section">
        <div className="icon-wrapper">
          <span style={{ fontSize: "1.5rem" }}>🤖</span>
        </div>
        <div>
          <h1 style={{ background: "linear-gradient(90deg, #10b981, #059669)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Solicitud Automática
          </h1>
          <p>Automatiza la búsqueda y generación de pares interferométricos</p>
        </div>
      </div>

      <div className="layout-grid">
        {/* Left Panel: Form */}
        <div className="upload-panel">
          <form className="upload-card" onSubmit={handleSubmit}>
            <label style={{ color: "var(--color-primary)", fontWeight: "bold", marginBottom: "16px", display: "inline-block" }}>
              1. Configuración de Solicitud
            </label>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "20px" }}>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Fecha de inicio:</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "var(--color-bg-main)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Fecha de fin:</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "var(--color-bg-main)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Nombre del proyecto / carpeta:</label>
              <input
                type="text"
                placeholder="Ej: Prueba2_14"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "var(--color-bg-main)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                required
              />
              <small style={{ display: "block", marginTop: "8px", color: "var(--color-text-muted)", fontSize: "0.75rem", lineHeight: "1.4" }}>
                Debe ser único. Si ya existe una carpeta con ese nombre, el servidor lo rechazará.
              </small>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="submit-btn"
              style={{ background: "linear-gradient(135deg, #10b981, #059669)", marginTop: "10px" }}
            >
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <svg className="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Procesando...
                </span>
              ) : (
                "Solicitar Imágenes"
              )}
            </button>
            
            {error && (
              <div style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", textAlign: "center", fontSize: "0.85rem", color: "#fca5a5" }}>
                <span>⚠️</span> {error}
              </div>
            )}
          </form>
        </div>

        {/* Right Panel: Result */}
        <div className="results-panel">
          <div className="data-widget" style={{ padding: "24px", minHeight: "500px", display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "20px", color: "white" }}>Resultados de la Operación</h3>
            
            {result && result.time_window ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", flex: 1 }}>
                <div style={{ padding: "20px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "12px" }}>
                  <h4 style={{ color: "#34d399", margin: "0 0 16px 0", fontSize: "1rem", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>✅</span> Solicitud exitosa
                  </h4>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px", fontSize: "0.9rem", color: "var(--color-text-main)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "8px" }}>
                      <span style={{ color: "var(--color-text-muted)" }}>Proyecto:</span>
                      <strong>{result.project}</strong>
                    </div>
                    {result.project_input && (
                      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "8px" }}>
                        <span style={{ color: "var(--color-text-muted)" }}>Nombre escrito:</span>
                        <strong>{result.project_input}</strong>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "8px" }}>
                      <span style={{ color: "var(--color-text-muted)" }}>Rango:</span>
                      <strong>{result.time_window.start} → {result.time_window.end}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "8px" }}>
                      <span style={{ color: "var(--color-text-muted)" }}>Escenas encontradas:</span>
                      <strong>{result.summary?.found_scenes ?? 0}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "8px" }}>
                      <span style={{ color: "var(--color-text-muted)" }}>Pares construidos:</span>
                      <strong>{result.summary?.built_pairs ?? 0}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "8px" }}>
                      <span style={{ color: "var(--color-text-muted)" }}>Jobs enviados:</span>
                      <strong>{result.summary?.submitted_jobs ?? 0}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--color-text-muted)" }}>Carpeta sugerida:</span>
                      <strong style={{ color: "var(--color-primary)" }}>{result.summary?.output_folder_hint}</strong>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", margin: "auto", padding: "60px", color: "var(--color-text-muted)" }}>
                 <span style={{ fontSize: "3rem", display: "block", marginBottom: "16px", opacity: 0.5 }}>⚙️</span>
                 Llena el formulario y solicita las imágenes para ver el resumen del proceso aquí.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SolicitarImagenesAutomatico;
