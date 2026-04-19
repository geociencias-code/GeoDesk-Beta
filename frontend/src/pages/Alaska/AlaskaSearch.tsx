import React from "react";
import MapComponent from "./MapComponent";
import type { PathFrameOption } from "./MapComponent";

type Props = {
  polygonWKT: string;
  setPolygonWKT: (wkt: string) => void;
  startDate: string;
  endDate: string;
  setStartDate: (v: string) => void;
  setEndDate: (v: string) => void;
  ruta: number | null;
  marco: number | null;

  flightDirection?: "ASCENDING" | "DESCENDING" | "";
  setFlightDirection?: (v: "ASCENDING" | "DESCENDING" | "") => void;
  polarization?: string;
  setPolarization?: (v: string) => void;
  dayInterval?: number;
  setDayInterval?: (v: number) => void;

  onSearch: () => void;
  loading: boolean;
  error: string | null;
  lastCount: number;

  pathFrameOptions?: PathFrameOption[];
  pathFrameLoading?: boolean;
  onPathFrameSelect?: (ruta: number, marco: number) => void;

  // New props
  fieldsLocked?: boolean;
  drawingEnabled?: boolean;
  onResetDiscovery?: () => void;
};

const AlaskaSearch: React.FC<Props> = ({
  setPolygonWKT,
  startDate, endDate, setStartDate, setEndDate,
  ruta, marco,
  flightDirection = "",
  setFlightDirection,
  polarization = "",
  setPolarization,
  dayInterval = 12,
  setDayInterval,
  onSearch, loading, error, lastCount,
  pathFrameOptions = [],
  pathFrameLoading = false,
  onPathFrameSelect,
  fieldsLocked = false,
  drawingEnabled = false,
  onResetDiscovery,
}) => {
  const canSearch = ruta != null && marco != null;

  // Which filters still need to be filled before drawing is allowed
  const missingFilters: string[] = [];
  if (!flightDirection) missingFilters.push("Dirección de vuelo");
  if (!polarization)   missingFilters.push("Polarización");
  if (!startDate || !endDate) missingFilters.push("Fechas");

  const inputStyle = (locked: boolean): React.CSSProperties => ({
    width: "100%", padding: "10px", borderRadius: "8px",
    background: locked ? "rgba(0,0,0,0.2)" : "var(--color-bg-main)",
    border: `1px solid ${locked ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.1)"}`,
    color: locked ? "#64748b" : "white",
    cursor: locked ? "not-allowed" : "auto",
    opacity: locked ? 0.6 : 1,
  });

  return (
    <div className="page-container" style={{ padding: 0 }}>
      <div className="header-section">
        <div className="icon-wrapper">
          <span style={{ fontSize: "1.5rem" }}>🛰️</span>
        </div>
        <div>
          <h1 style={{ background: "linear-gradient(90deg, #8b5cf6, #3b82f6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Buscador Sentinel
          </h1>
          <p>Localiza imágenes de radar (SAR) sobre tu región de interés</p>
        </div>
      </div>

      <div className="layout-grid">
        {/* ── Left panel ── */}
        <div className="upload-panel">
          <div className="upload-card">

            {/* 1. Dates */}
            <label style={{ color: "var(--color-primary)", fontWeight: "bold" }}>
              1. Fechas de búsqueda
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "20px" }}>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Inicio</label>
                <input
                  type="date" value={startDate} max={endDate}
                  disabled={fieldsLocked}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={inputStyle(fieldsLocked)}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Fin</label>
                <input
                  type="date" value={endDate} min={startDate}
                  disabled={fieldsLocked}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={inputStyle(fieldsLocked)}
                />
              </div>
            </div>

            {/* 2. Route/frame (read-only display) */}
            <label style={{ color: "var(--color-primary)", fontWeight: "bold" }}>
              2. Ruta y Marco Orbital
            </label>
            <p style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginBottom: "10px", marginTop: "4px" }}>
              {drawingEnabled
                ? "Dibuja el área en el mapa y haz clic en un rectángulo para seleccionar la ruta."
                : `Completa primero: ${missingFilters.join(", ")}.`}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "20px" }}>
              {(["Ruta (Path)", "Marco (Frame)"] as const).map((label, i) => {
                const val = i === 0 ? ruta : marco;
                return (
                  <div key={label}>
                    <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>{label}</label>
                    <div style={{
                      width: "100%", padding: "10px", borderRadius: "8px",
                      background: "rgba(0,0,0,0.3)",
                      border: `1px solid ${val != null ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.08)"}`,
                      color: val != null ? "#86efac" : "#64748b",
                      fontSize: "0.95rem", fontWeight: val != null ? 600 : 400,
                      minHeight: "42px", display: "flex", alignItems: "center",
                    }}>
                      {pathFrameLoading ? "⏳ Buscando…" : val != null ? val : "—"}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 3. Satellite filters */}
            <label style={{ color: "var(--color-primary)", fontWeight: "bold" }}>
              3. Filtros Satelitales
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: "20px" }}>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                  Dirección de vuelo <span style={{ color: "#f87171" }}>*</span>
                </label>
                <select
                  value={flightDirection}
                  disabled={fieldsLocked}
                  onChange={(e) => setFlightDirection && setFlightDirection(e.target.value as "" | "ASCENDING" | "DESCENDING")}
                  style={inputStyle(fieldsLocked)}
                >
                  <option value="">— Seleccionar —</option>
                  <option value="ASCENDING">ASCENDING</option>
                  <option value="DESCENDING">DESCENDING</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                  Polarización <span style={{ color: "#f87171" }}>*</span>
                </label>
                <select
                  value={polarization}
                  disabled={fieldsLocked}
                  onChange={(e) => setPolarization && setPolarization(e.target.value)}
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
            </div>

            {/* 4. Day interval */}
            <label style={{ color: "var(--color-primary)", fontWeight: "bold" }}>
              4. Configuración de Pares
            </label>
            <div style={{ marginBottom: "20px", marginTop: "12px" }}>
              <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                Intervalo máximo de días (Temporal Baseline): {dayInterval}
              </label>
              <input
                type="range" min="6" max="48" step="6"
                value={dayInterval}
                onChange={(e) => setDayInterval?.(Number(e.target.value))}
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
                  onClick={onResetDiscovery}
                  style={{ whiteSpace: "nowrap", background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)", color: "#93c5fd", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "0.78rem" }}
                >
                  Reiniciar área
                </button>
              </div>
            )}

            {/* Missing filters notice */}
            {!fieldsLocked && !drawingEnabled && (
              <div style={{ marginBottom: "12px", padding: "10px 14px", borderRadius: "8px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", fontSize: "0.8rem", color: "#fde68a" }}>
                ⚠️ Selecciona <strong>{missingFilters.join(" y ")}</strong> para poder dibujar el área.
              </div>
            )}

            {/* Ready but no frame selected */}
            {!fieldsLocked && drawingEnabled && !canSearch && (
              <div style={{ marginBottom: "12px", padding: "10px 14px", borderRadius: "8px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", fontSize: "0.8rem", color: "#fde68a" }}>
                ℹ️ Dibuja el área de interés en el mapa para ver las rutas disponibles.
              </div>
            )}

            <button
              onClick={onSearch}
              disabled={loading || !canSearch}
              className="submit-btn"
              style={{
                background: !canSearch ? "rgba(99,102,241,0.3)" : "linear-gradient(135deg, #8b5cf6, #3b82f6)",
                marginTop: "10px",
                cursor: !canSearch ? "not-allowed" : "pointer",
              }}
            >
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <svg className="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Buscando en ASF...
                </span>
              ) : "Buscar escenas"}
            </button>

            {lastCount >= 0 && (
              <div style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", textAlign: "center", fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
                {lastCount > 0
                  ? <span>✅ Se encontraron <b style={{ color: "#34d399" }}>{lastCount}</b> escena(s) · Ruta {ruta} / Marco {marco}. Ve a la pestaña de descarga.</span>
                  : canSearch ? "Presiona buscar para consultar las imágenes." : "Dibuja en el mapa y presiona buscar."}
              </div>
            )}

            {error && (
              <div className="error-banner" style={{ marginTop: "12px" }}>
                <span>⚠️</span> {error}
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel (map) ── */}
        <div className="results-panel">
          <div className="data-widget" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ padding: "16px 20px", background: "var(--color-bg-card)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span style={{ fontWeight: 600, color: "var(--color-text-main)", fontSize: "0.95rem" }}>
                {pathFrameLoading
                  ? "⏳ Buscando rutas disponibles…"
                  : pathFrameOptions.length > 0
                    ? `${pathFrameOptions.length} ruta(s) disponible(s) — haz clic para seleccionar`
                    : "Dibuja el área de búsqueda"}
              </span>
              {pathFrameOptions.length > 0 && (
                <div style={{ marginTop: "6px", display: "flex", gap: "12px", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                  <span><span style={{ color: "#f59e0b" }}>■</span> Preferida</span>
                  <span><span style={{ color: "#3b82f6" }}>■</span> Disponible</span>
                  <span><span style={{ color: "#22c55e" }}>■</span> Seleccionada</span>
                </div>
              )}
            </div>

            {/* Progress bar */}
            {pathFrameLoading && (
              <div style={{ height: "3px", background: "rgba(99,102,241,0.15)", position: "relative", overflow: "hidden" }}>
                <div style={{
                  position: "absolute", top: 0, left: 0, height: "100%", width: "40%",
                  background: "linear-gradient(90deg, #8b5cf6, #3b82f6)",
                  animation: "slide-bar 1.4s ease-in-out infinite",
                }} />
              </div>
            )}

            <div style={{ flex: 1, minHeight: "500px", position: "relative" }}>
              {/* Overlay when drawing is not allowed */}
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
                onPolygonChange={setPolygonWKT}
                pathFrameOptions={pathFrameOptions}
                selectedRuta={ruta}
                selectedMarco={marco}
                onPathFrameSelect={onPathFrameSelect}
                pathFrameLoading={pathFrameLoading}
                onReset={onResetDiscovery}
              />
            </div>
          </div>
        </div>
      </div>

      {/* CSS for the progress bar animation */}
      <style>{`
        @keyframes slide-bar {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(250%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
};

export default AlaskaSearch;
