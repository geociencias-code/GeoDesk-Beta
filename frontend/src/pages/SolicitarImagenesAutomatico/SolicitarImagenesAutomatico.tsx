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
  const [startDate, setStartDateRaw] = useState("");
  const [endDate, setEndDateRaw] = useState("");
  const [projectName, setProjectName] = useState("");
  const [dayInterval, setDayInterval] = useState<number>(12);
  const [flightDirection, setFlightDirectionRaw] = useState<"ASCENDING" | "DESCENDING" | "">("");
  const [polarization, setPolarizationRaw] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Map / path-frame discovery state
  const [polygonWKT, setPolygonWKT] = useState("");
  const [pathFrameOptions, setPathFrameOptions] = useState<PathFrameOption[]>([]);
  const [pathFrameLoading, setPathFrameLoading] = useState(false);
  const [ruta, setRuta] = useState<number | null>(null);
  const [marco, setMarco] = useState<number | null>(null);

  // Lock filters once routes are discovered
  const fieldsLocked = pathFrameOptions.length > 0 || pathFrameLoading;
  const drawingEnabled = !!flightDirection && !!polarization && !!startDate && !!endDate;

  const resetDiscovery = useCallback(() => {
    setPathFrameOptions([]);
    setPathFrameLoading(false);
    setPolygonWKT("");
    setRuta(null);
    setMarco(null);
    setResult(null);
    setError(null);
  }, []);

  // Wrap setters to reset discovery when filters change
  const setStartDate = useCallback((v: string) => { resetDiscovery(); setStartDateRaw(v); }, [resetDiscovery]);
  const setEndDate = useCallback((v: string) => { resetDiscovery(); setEndDateRaw(v); }, [resetDiscovery]);
  const setFlightDirection = useCallback((v: "ASCENDING" | "DESCENDING" | "") => { resetDiscovery(); setFlightDirectionRaw(v); }, [resetDiscovery]);
  const setPolarization = useCallback((v: string) => { resetDiscovery(); setPolarizationRaw(v); }, [resetDiscovery]);

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
        polarization: polarization || undefined,
      };

      const res = await axios.post<PathFrameOption[]>(`${API_URL}/api/discover_paths`, body);
      const options = res.data;
      setPathFrameOptions(options);

      // Auto-select the path/frame with the MOST scenes available
      if (options.length > 0) {
        const best = options.reduce((a, b) => b.scene_count > a.scene_count ? b : a, options[0]);
        setRuta(best.ruta);
        setMarco(best.marco);
      }
    } catch (e) {
      console.error("Error discovering paths:", e);
    } finally {
      setPathFrameLoading(false);
    }
  }, [startDate, endDate, flightDirection, polarization]);

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


  const inputStyle = (locked: boolean): React.CSSProperties => ({
    width: "100%", padding: "10px", borderRadius: "8px",
    background: locked ? "rgba(0,0,0,0.2)" : "var(--color-bg-main)",
    border: `1px solid ${locked ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.1)"}`,
    color: locked ? "#64748b" : "white",
    cursor: locked ? "not-allowed" : "auto",
    opacity: locked ? 0.6 : 1,
  });

  const missingFilters: string[] = [];
  if (!flightDirection) missingFilters.push("Dirección de vuelo");
  if (!polarization)   missingFilters.push("Polarización");
  if (!startDate || !endDate) missingFilters.push("Fechas");

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

            {/* Dates */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "20px" }}>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Fecha de inicio:</label>
                <input
                  type="date" value={startDate}
                  disabled={fieldsLocked}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={inputStyle(fieldsLocked)}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Fecha de fin:</label>
                <input
                  type="date" value={endDate}
                  disabled={fieldsLocked}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={inputStyle(fieldsLocked)}
                  required
                />
              </div>
            </div>

            {/* Flight direction */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                Dirección de vuelo: <span style={{ color: "#f87171" }}>*</span>
              </label>
              <select
                value={flightDirection}
                disabled={fieldsLocked}
                onChange={(e) => setFlightDirection(e.target.value as "" | "ASCENDING" | "DESCENDING")}
                style={inputStyle(fieldsLocked)}
              >
                <option value="">— Seleccionar —</option>
                <option value="DESCENDING">DESCENDING</option>
                <option value="ASCENDING">ASCENDING</option>
              </select>
            </div>

            {/* Polarization */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                Polarización: <span style={{ color: "#f87171" }}>*</span>
              </label>
              <select
                value={polarization}
                disabled={fieldsLocked}
                onChange={(e) => setPolarization(e.target.value)}
                style={inputStyle(fieldsLocked)}
              >
                <option value="">— Seleccionar —</option>
                <option value="VV+VH">VV+VH</option>
                <option value="HH+HV">HH+HV</option>
                <option value="VV">VV</option>
                <option value="HH">HH</option>
                <option value="Dual HH">Dual HH</option>
                <option value="Dual HV">Dual HV</option>
                <option value="Dual VH">Dual VH</option>
              </select>
            </div>

            {/* Read-only ruta/marco display */}
            <label style={{ color: "var(--color-primary)", fontWeight: "bold", display: "block", marginBottom: "8px" }}>
              2. Ruta y Marco Orbital
            </label>
            <p style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginBottom: "10px" }}>
              {drawingEnabled
                ? "Dibuja el área y la ruta con más imágenes se seleccionará automáticamente."
                : `Completa primero: ${missingFilters.join(", ")}.`}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "20px" }}>
              {(["Ruta (Path)", "Marco (Frame)"] as const).map((label, i) => {
                const val = i === 0 ? ruta : marco;
                return (
                  <div key={label}>
                    <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>{label}</label>
                    <div style={{ padding: "10px", borderRadius: "8px", background: "rgba(0,0,0,0.3)", border: `1px solid ${val != null ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.08)"}`, color: val != null ? "#86efac" : "#64748b", fontWeight: val != null ? 600 : 400, minHeight: "42px", display: "flex", alignItems: "center" }}>
                      {pathFrameLoading ? "⏳" : val != null ? val : "—"}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Project name */}
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

            {/* Day interval */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                Intervalo máximo de días entre imágenes: {dayInterval}
              </label>
              <input
                type="range" min="6" max="48" step="6" value={dayInterval}
                onChange={(e) => setDayInterval(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--color-primary)" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                <span>6 días</span><span>48 días</span>
              </div>
            </div>

            {/* Lock notice */}
            {fieldsLocked && (
              <div style={{ marginBottom: "12px", padding: "10px 14px", borderRadius: "8px", background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.25)", fontSize: "0.8rem", color: "#93c5fd", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span>🔒 Parámetros bloqueados. Haz clic en "Reiniciar área" para modificarlos.</span>
                <button
                  type="button"
                  onClick={resetDiscovery}
                  style={{ whiteSpace: "nowrap", background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)", color: "#93c5fd", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "0.78rem" }}
                >
                  Reiniciar área
                </button>
              </div>
            )}

            {!fieldsLocked && !drawingEnabled && (
              <div style={{ marginBottom: "12px", padding: "10px 14px", borderRadius: "8px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", fontSize: "0.8rem", color: "#fde68a" }}>
                ⚠️ Selecciona <strong>{missingFilters.join(" y ")}</strong> para poder dibujar el área.
              </div>
            )}

            {!fieldsLocked && drawingEnabled && !canSubmit && (
              <div style={{ marginBottom: "12px", padding: "10px 14px", borderRadius: "8px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", fontSize: "0.8rem", color: "#fde68a" }}>
                ℹ️ Dibuja el área en el mapa para que se seleccione automáticamente la mejor ruta.
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
                {pathFrameLoading
                  ? "⏳ Buscando rutas disponibles…"
                  : pathFrameOptions.length > 0
                    ? `${pathFrameOptions.length} ruta(s) — mejor: ${ruta}/${marco} (${(pathFrameOptions.find(o => o.ruta === ruta && o.marco === marco)?.scene_count ?? 0)} imágenes)`
                    : "Dibuja el área de búsqueda"}
              </span>
              {pathFrameOptions.length > 0 && (
                <div style={{ marginTop: "6px", display: "flex", gap: "12px", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                  <span><span style={{ color: "#22c55e" }}>■</span> Mejor (auto-seleccionada)</span>
                  <span><span style={{ color: "#3b82f6" }}>■</span> Disponible</span>
                </div>
              )}
            </div>

            {/* Progress bar */}
            {pathFrameLoading && (
              <div style={{ height: "3px", background: "rgba(16,185,129,0.15)", position: "relative", overflow: "hidden" }}>
                <div style={{
                  position: "absolute", top: 0, left: 0, height: "100%", width: "40%",
                  background: "linear-gradient(90deg, #10b981, #059669)",
                  animation: "slide-bar 1.4s ease-in-out infinite",
                }} />
              </div>
            )}

            <div style={{ minHeight: "400px", position: "relative" }}>
              {/* Overlay when drawing not allowed */}
              {!drawingEnabled && !fieldsLocked && (
                <div style={{
                  position: "absolute", inset: 0, zIndex: 1000,
                  background: "rgba(0,0,0,0.55)", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 12, backdropFilter: "blur(2px)",
                }}>
                  <span style={{ fontSize: "2rem" }}>🔒</span>
                  <p style={{ color: "#fde68a", fontWeight: 600, textAlign: "center", maxWidth: 260, margin: 0 }}>
                    Selecciona primero la dirección de vuelo y la polarización
                  </p>
                </div>
              )}
              <MapComponent
                onPolygonChange={handlePolygonChange}
                pathFrameOptions={pathFrameOptions}
                selectedRuta={ruta}
                selectedMarco={marco}
                onPathFrameSelect={handlePathFrameSelect}
                pathFrameLoading={pathFrameLoading}
                height="400px"
                onReset={resetDiscovery}
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
