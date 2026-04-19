import React, { useState, useCallback } from "react";
import axios from "axios";
import { API_URL } from "../../services/api";
import MapComponent from "../Alaska/MapComponent";
import type { PathFrameOption } from "../Alaska/MapComponent";

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
  const [dayInterval, setDayInterval] = useState<number>(12);
  const [flightDirection, setFlightDirection] = useState<"ASCENDING" | "DESCENDING" | "">("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Map / path-frame discovery state
  const [polygonWKT, setPolygonWKT] = useState("");
  const [pathFrameOptions, setPathFrameOptions] = useState<PathFrameOption[]>([]);
  const [pathFrameLoading, setPathFrameLoading] = useState(false);
  const [ruta, setRuta] = useState<number | null>(null);
  const [marco, setMarco] = useState<number | null>(null);

  const discoverPaths = useCallback(async (polygon: string) => {
    if (!polygon) {
      setPathFrameOptions([]);
      setRuta(null);
      setMarco(null);
      return;
    }
    try {
      setPathFrameLoading(true);
      setPathFrameOptions([]);
      setRuta(null);
      setMarco(null);

      const body = {
        polygon,
        start_date: startDate ? `${startDate}T00:00:00Z` : "2025-01-01T00:00:00Z",
        end_date: endDate ? `${endDate}T23:59:59Z` : "2025-01-31T23:59:59Z",
        beam_mode: "IW",
        processing_level: "SLC",
        flight_direction: flightDirection || undefined,
      };

      const res = await axios.post<PathFrameOption[]>(`${API_URL}/api/discover_paths`, body);
      const options = res.data;
      setPathFrameOptions(options);

      // Auto-select preferred option
      const preferred = options.find(o => o.is_preferred);
      const autoSelect = preferred ?? options[0];
      if (autoSelect) {
        setRuta(autoSelect.ruta);
        setMarco(autoSelect.marco);
      }
    } catch (e) {
      console.error("Error discovering paths:", e);
    } finally {
      setPathFrameLoading(false);
    }
  }, [startDate, endDate, flightDirection]);

  const handlePolygonChange = useCallback((wkt: string) => {
    setPolygonWKT(wkt);
    discoverPaths(wkt);
  }, [discoverPaths]);

  const handlePathFrameSelect = useCallback((r: number, m: number) => {
    setRuta(r);
    setMarco(m);
  }, []);

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
    if (!polygonWKT) {
      setError("Dibuja el área de interés en el mapa.");
      return;
    }
    if (ruta == null || marco == null) {
      setError("Selecciona una ruta/marco haciendo clic en un rectángulo del mapa.");
      return;
    }

    try {
      setLoading(true);
      const payload = {
        start_date: `${startDate}T00:00:00Z`,
        end_date: `${endDate}T23:59:59Z`,
        project_name: projectName.trim(),
        day_interval: dayInterval,
        flight_direction: flightDirection || "DESCENDING",
        ruta,
        marco,
        polygon: polygonWKT,
      };

      const response = await axios.post<ResponseData>(`${API_URL}/api/solicitar_imagenes`, payload);
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
        const detail = err.response?.data?.detail || err.message || "Error al solicitar imágenes.";
        setError(typeof detail === "string" ? detail : "Error al solicitar imágenes.");
      } else {
        setError("Error inesperado al solicitar imágenes.");
      }
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = !!polygonWKT && ruta != null && marco != null;

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
                  type="date" value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "var(--color-bg-main)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Fecha de fin:</label>
                <input
                  type="date" value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "var(--color-bg-main)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Dirección de vuelo:</label>
              <select
                value={flightDirection}
                onChange={(e) => setFlightDirection(e.target.value as "" | "ASCENDING" | "DESCENDING")}
                style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "var(--color-bg-main)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
              >
                <option value="DESCENDING">DESCENDING</option>
                <option value="ASCENDING">ASCENDING</option>
                <option value="">Cualquiera</option>
              </select>
            </div>

            {/* Read-only ruta/marco display */}
            <label style={{ color: "var(--color-primary)", fontWeight: "bold", display: "block", marginBottom: "8px" }}>
              2. Ruta y Marco Orbital
            </label>
            <p style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginBottom: "10px" }}>
              Dibuja el área y haz clic en un rectángulo del mapa.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "20px" }}>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Ruta (Path)</label>
                <div style={{ padding: "10px", borderRadius: "8px", background: "rgba(0,0,0,0.3)", border: `1px solid ${ruta != null ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.08)"}`, color: ruta != null ? "#86efac" : "#64748b", fontWeight: ruta != null ? 600 : 400, minHeight: "42px", display: "flex", alignItems: "center" }}>
                  {pathFrameLoading ? "⏳" : ruta != null ? ruta : "—"}
                </div>
              </div>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Marco (Frame)</label>
                <div style={{ padding: "10px", borderRadius: "8px", background: "rgba(0,0,0,0.3)", border: `1px solid ${marco != null ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.08)"}`, color: marco != null ? "#86efac" : "#64748b", fontWeight: marco != null ? 600 : 400, minHeight: "42px", display: "flex", alignItems: "center" }}>
                  {pathFrameLoading ? "⏳" : marco != null ? marco : "—"}
                </div>
              </div>
            </div>

            <label style={{ color: "var(--color-primary)", fontWeight: "bold", display: "block", marginBottom: "8px" }}>
              3. Proyecto
            </label>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Nombre del proyecto / carpeta:</label>
              <input
                type="text" placeholder="Ej: Prueba2_14" value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "var(--color-bg-main)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                required
              />
              <small style={{ display: "block", marginTop: "8px", color: "var(--color-text-muted)", fontSize: "0.75rem", lineHeight: "1.4" }}>
                Debe ser único. Si ya existe una carpeta con ese nombre, el servidor lo rechazará.
              </small>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                Intervalo máximo de días entre imágenes: {dayInterval}
              </label>
              <input
                type="range" min="6" max="48" step="6" defaultValue={dayInterval}
                onChange={(e) => setDayInterval(Number(e.target.value))}
                onInput={(e) => setDayInterval(Number((e.target as HTMLInputElement).value))}
                style={{ width: "100%", accentColor: "var(--color-primary)" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                <span>6 días</span><span>48 días</span>
              </div>
            </div>

            {!canSubmit && (
              <div style={{ marginBottom: "12px", padding: "10px 14px", borderRadius: "8px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", fontSize: "0.8rem", color: "#fde68a" }}>
                ℹ️ Dibuja el área en el mapa y selecciona una ruta para continuar.
              </div>
            )}

            <button
              type="submit" disabled={loading || !canSubmit} className="submit-btn"
              style={{ background: !canSubmit ? "rgba(16,185,129,0.3)" : "linear-gradient(135deg, #10b981, #059669)", marginTop: "10px", cursor: !canSubmit ? "not-allowed" : "pointer" }}
            >
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <svg className="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Procesando...
                </span>
              ) : "Solicitar Imágenes"}
            </button>

            {error && (
              <div style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", textAlign: "center", fontSize: "0.85rem", color: "#fca5a5" }}>
                <span>⚠️</span> {error}
              </div>
            )}
          </form>
        </div>

        {/* Right Panel: Map + Result */}
        <div className="results-panel" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Map */}
          <div className="data-widget" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 20px", background: "var(--color-bg-card)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span style={{ fontWeight: 600, color: "var(--color-text-main)", fontSize: "0.95rem" }}>
                {pathFrameOptions.length > 0
                  ? `${pathFrameOptions.length} ruta(s) disponible(s) — haz clic para seleccionar`
                  : "1. Dibuja el área de búsqueda"}
              </span>
              {pathFrameOptions.length > 0 && (
                <div style={{ marginTop: "6px", display: "flex", gap: "12px", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                  <span><span style={{ color: "#f59e0b" }}>■</span> Preferida</span>
                  <span><span style={{ color: "#3b82f6" }}>■</span> Disponible</span>
                  <span><span style={{ color: "#22c55e" }}>■</span> Seleccionada</span>
                </div>
              )}
            </div>
            <div style={{ minHeight: "400px" }}>
              <MapComponent
                onPolygonChange={handlePolygonChange}
                pathFrameOptions={pathFrameOptions}
                selectedRuta={ruta}
                selectedMarco={marco}
                onPathFrameSelect={handlePathFrameSelect}
                pathFrameLoading={pathFrameLoading}
                height="400px"
              />
            </div>
          </div>

          {/* Result */}
          <div className="data-widget" style={{ padding: "24px", display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "20px", color: "white" }}>Resultados de la Operación</h3>

            {result && result.time_window ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", flex: 1 }}>
                <div style={{ padding: "20px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "12px" }}>
                  <h4 style={{ color: "#34d399", margin: "0 0 16px 0", fontSize: "1rem", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>✅</span> Solicitud exitosa
                  </h4>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px", fontSize: "0.9rem", color: "var(--color-text-main)" }}>
                    {[
                      ["Proyecto", result.project],
                      ...(result.project_input ? [["Nombre escrito", result.project_input]] : []),
                      ["Rango", `${result.time_window.start} → ${result.time_window.end}`],
                      ["Escenas encontradas", String(result.summary?.found_scenes ?? 0)],
                      ["Pares construidos", String(result.summary?.built_pairs ?? 0)],
                      ["Jobs enviados", String(result.summary?.submitted_jobs ?? 0)],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "8px" }}>
                        <span style={{ color: "var(--color-text-muted)" }}>{label}:</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
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
