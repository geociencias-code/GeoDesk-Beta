import { useState } from "react";
import JSZip from "jszip";
import { API_URL } from "../../services/api";
import axios from "axios";

if (typeof window !== "undefined") {
  (window as unknown as Window & { type: string }).type = "";
}

interface DeformationResults {
  dias: number;
  start_date?: string;
  end_date?: string;
  sample: Array<{
    lat: number;
    lon: number;
    def: number;
  }>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AlaskaProcesamiento() {
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const [results, setResults] = useState<DeformationResults | null>(null);
  const [deformationCsvUrl, setDeformationCsvUrl] = useState<string | null>(null);
  const [deformationCsvBlob, setDeformationCsvBlob] = useState<Blob | null>(null);

  const handleZipFile = async (file: File) => {
    setZipFile(file);
    setResults(null);
    setDeformationCsvUrl(null);
    setDeformationCsvBlob(null);
    setMessage("Archivo cargado. Presiona 'Derivar Deformación' para procesar.");
  };

  const handleCalculateDeformation = async () => {
    if (!zipFile) return;

    setBusy(true);
    setMessage("Procesando fase y calculando vector de deformación anual...");
    try {
      const formData = new FormData();
      formData.append("file", zipFile, zipFile.name);

      const res = await axios.post(`${API_URL}/api/v1/alaska/velocity`, formData, {
        responseType: "blob",
      });

      const zipInstance = await JSZip.loadAsync(res.data);

      const uiDataStr = await zipInstance.file("ui_data.json")?.async("string");
      if (uiDataStr) {
        const parsedData: DeformationResults = JSON.parse(uiDataStr);
        setResults(parsedData);
      }

      const csvFile = Object.values(zipInstance.files).find((f) => f.name.endsWith(".csv"));
      if (csvFile) {
        const csvBlob = await csvFile.async("blob");
        setDeformationCsvUrl(window.URL.createObjectURL(csvBlob));
        setDeformationCsvBlob(csvBlob);
      }

      setMessage("Deformación calculada de manera exitosa.");
    } catch (error) {
      console.error(error);
      setMessage("Ocurrió un error al calcular la deformación.");
    } finally {
      setBusy(false);
    }
  };


  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="page-container" style={{ padding: 0 }}>
      {/* Header */}
      <div className="header-section">
        <div className="icon-wrapper">
          <span style={{ fontSize: "1.5rem" }}>🌋</span>
        </div>
        <div>
          <h1
            style={{
              background: "linear-gradient(90deg, #8b5cf6, #3b82f6)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Análisis de Deformación (Alaska)
          </h1>
          <p>Obten modelos de deformación a partir de archivos .zip de InSAR</p>
        </div>
      </div>

      <div className="layout-grid">
        {/* ── Left panel ── */}
        <div className="upload-panel">
          <div className="upload-card">
            <label
              style={{
                color: "var(--color-primary)",
                fontWeight: "bold",
                marginBottom: "8px",
                display: "inline-block",
              }}
            >
              1. Cargar Proyecto InSAR (.zip)
            </label>
            <div
              className="dropzone"
              style={{ marginTop: "12px", borderStyle: "dashed", borderColor: "rgba(255,255,255,0.2)" }}
            >
              <input
                type="file"
                accept=".zip"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleZipFile(f);
                }}
                style={{ width: "100%", opacity: 0, position: "absolute", height: "100%", cursor: "pointer" }}
              />
              <div
                className="dropzone-content"
                style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}
              >
                {zipFile ? (
                  <span className="selected-file text-center" style={{ color: "var(--color-text-main)" }}>
                    {zipFile.name}
                  </span>
                ) : (
                  <>
                    <span className="flex-1 text-center" style={{ color: "var(--color-text-muted)" }}>
                      📂 Selecciona archivo .zip
                    </span>
                    <span style={{ fontSize: "0.80rem", color: "var(--color-text-muted)", opacity: 0.7 }}>
                      Extrae georreferencia
                    </span>
                  </>
                )}
              </div>
            </div>

            {zipFile && (
              <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <button
                  onClick={handleCalculateDeformation}
                  disabled={busy}
                  className="submit-btn"
                  style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)" }}
                >
                  {busy ? "Calculando..." : "Derivar Deformación de Fase"}
                </button>
              </div>
            )}

            {message && (
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px",
                  borderRadius: "8px",
                  background: "rgba(255,255,255,0.05)",
                  textAlign: "center",
                  fontSize: "0.85rem",
                  color: message.includes("❌") ? "#ffb4b4" : "var(--color-text-muted)",
                }}
              >
                {message}
              </div>
            )}

          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="results-panel" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

          {results && results.sample.length > 0 && (
            <div
              className="data-widget"
              style={{
                padding: "20px",
                background: "var(--color-bg-card)",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "16px",
                }}
              >
                <h3 style={{ fontSize: "1.1rem", color: "white", margin: 0 }}>
                  Muestra de Deformación (Δt = {results.dias} días)
                </h3>
                {deformationCsvUrl && (
                  <a
                    href={deformationCsvUrl}
                    download={`deformacion_${zipFile?.name.replace(".zip", "")}.csv`}
                    style={{
                      background: "linear-gradient(135deg, #10b981, #059669)",
                      color: "white",
                      padding: "8px 16px",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                      fontWeight: "bold",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>📊</span> Exportar 100% a Excel
                  </a>
                )}
              </div>

              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.85rem",
                    textAlign: "left",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.1)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      <th style={{ padding: "8px" }}>Latitud</th>
                      <th style={{ padding: "8px" }}>Longitud</th>
                      <th style={{ padding: "8px" }}>Deformación (mm)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.sample
                      .slice(0, 50)
                      .map((row: { lat: number; lon: number; def: number }, idx: number) => {
                        let textColor = "white";
                        if (row.def < -5) textColor = "#fca5a5";
                        else if (row.def > 5) textColor = "#93c5fd";
                        else textColor = "#d1d5db";

                        return (
                          <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                            <td style={{ padding: "8px", color: "var(--color-text-muted)" }}>
                              {row.lat.toFixed(6)}
                            </td>
                            <td style={{ padding: "8px", color: "var(--color-text-muted)" }}>
                              {row.lon.toFixed(6)}
                            </td>
                            <td
                              style={{ padding: "8px", color: textColor, fontWeight: "bold" }}
                            >
                              {row.def > 0 ? "+" : ""}
                              {row.def.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                {results.sample.length > 50 && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "12px",
                      color: "var(--color-text-muted)",
                      fontSize: "0.8rem",
                      fontStyle: "italic",
                    }}
                  >
                    Mostrando solo las primeras 50 observaciones. Exporta a Excel para ver el
                    dataset completo.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
