import React from "react";
import MapComponent from "./MapComponent";

type Props = {
  polygonWKT: string;
  setPolygonWKT: (wkt: string) => void;
  startDate: string;
  endDate: string;
  setStartDate: (v: string) => void;
  setEndDate: (v: string) => void;
  ruta: number;
  marco: number;
  setRuta: (v: number) => void;
  setMarco: (v: number) => void;

  flightDirection?: "ASCENDING" | "DESCENDING" | "";
  setFlightDirection?: (v: "ASCENDING" | "DESCENDING" | "") => void;
  polarization?: string;
  setPolarization?: (v: string) => void;

  onSearch: () => void;
  loading: boolean; 
  error: string | null;
  lastCount: number;
};

const AlaskaSearch: React.FC<Props> = ({
  setPolygonWKT,
  startDate, endDate, setStartDate, setEndDate,
  ruta, marco, setRuta, setMarco,
  flightDirection = "",
  setFlightDirection,
  polarization = "",
  setPolarization,
  onSearch, loading, error, lastCount
}) => {
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
        <div className="upload-panel">
          <div className="upload-card">
            <label style={{ color: "var(--color-primary)", fontWeight: "bold" }}>
              1. Fechas de búsqueda
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "20px" }}>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Inicio</label>
                <input
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "var(--color-bg-main)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Fin</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "var(--color-bg-main)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                />
              </div>
            </div>

            <label style={{ color: "var(--color-primary)", fontWeight: "bold" }}>
              2. Parámetros Orbitales
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "20px" }}>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Ruta (Path)</label>
                <input
                  type="number"
                  value={ruta}
                  onChange={(e) => setRuta(Number(e.target.value))}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "var(--color-bg-main)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Marco (Frame)</label>
                <input
                  type="number"
                  value={marco}
                  onChange={(e) => setMarco(Number(e.target.value))}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "var(--color-bg-main)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                />
              </div>
            </div>

            <label style={{ color: "var(--color-primary)", fontWeight: "bold" }}>
              3. Filtros Satelitales
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: "20px" }}>
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Dirección de vuelo</label>
                <select
                  value={flightDirection}
                  onChange={(e) => setFlightDirection && setFlightDirection(e.target.value as "" | "ASCENDING" | "DESCENDING")}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "var(--color-bg-main)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                >
                  <option value="">(cualquiera)</option>
                  <option value="ASCENDING">ASCENDING</option>
                  <option value="DESCENDING">DESCENDING</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>Polarización</label>
                <select
                  value={polarization}
                  onChange={(e) => setPolarization && setPolarization(e.target.value)}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", background: "var(--color-bg-main)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                >
                  <option value="">(cualquiera)</option>
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
            
            <button
              onClick={onSearch}
              disabled={loading}
              className="submit-btn"
              style={{ background: "linear-gradient(135deg, #8b5cf6, #3b82f6)", marginTop: "10px" }}
            >
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <svg className="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Buscando en ASF...
                </span>
              ) : (
                "Buscar escenas"
              )}
            </button>
            
            {lastCount >= 0 && (
              <div style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", textAlign: "center", fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
                {lastCount > 0
                  ? <span>✅ Se encontraron <b style={{ color: "#34d399" }}>{lastCount}</b> escena(s). Ve a la pestaña de descarga.</span>
                  : "Dibuja en el mapa y presiona buscar."}
              </div>
            )}
            
            {error && (
              <div className="error-banner" style={{ marginTop: "12px" }}>
                <span>⚠️</span> {error}
              </div>
            )}
          </div>
        </div>

        <div className="results-panel">
          <div className="data-widget" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ padding: "16px 20px", background: "var(--color-bg-card)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span style={{ fontWeight: 600, color: "var(--color-text-main)", fontSize: "0.95rem" }}>
                🗺️ Dibuja el área de búsqueda
              </span>
            </div>
            <div style={{ flex: 1, minHeight: "500px" }}>
              <MapComponent onPolygonChange={setPolygonWKT} height="100%" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlaskaSearch;
