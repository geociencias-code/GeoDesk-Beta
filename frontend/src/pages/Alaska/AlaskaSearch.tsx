import React from "react";
import MapComponent from "./MapComponent";
import "./AlaskaSearch.css";

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
    <section className="card">
      <h2>Obtener Datos</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12, margin: "12px 0" }}>
        <label>Inicio
          <input type="date" value={startDate} max={endDate}
                 onChange={e => setStartDate(e.target.value)} />
        </label>
        <label>Fin
          <input type="date" value={endDate} min={startDate}
                 onChange={e => setEndDate(e.target.value)} />
        </label>
        {/* Contenedor para inputs pequeños (Ruta y Marco) */}
        <div className="small-inputs">
          <label>Ruta
            <input type="number" value={ruta} onChange={e => setRuta(Number(e.target.value))} />
          </label>
          <label>Marco
            <input type="number" value={marco} onChange={e => setMarco(Number(e.target.value))} />
          </label>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12, marginBottom: 12 }}>
        <label>Dirección de vuelo
          <select
            value={flightDirection}
            onChange={e => setFlightDirection && setFlightDirection(e.target.value as "" | "ASCENDING" | "DESCENDING")}
          >
            <option value="">(cualquiera)</option>
            <option value="ASCENDING">ASCENDING</option>
            <option value="DESCENDING">DESCENDING</option>
          </select>
        </label>

        <label>Polarización
          <select
            value={polarization}
            onChange={e => setPolarization && setPolarization(e.target.value)}
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
        </label>
      </div>

      {/* Mapa para dibujar el polígono */}
      <MapComponent onPolygonChange={setPolygonWKT} height="55vh" />

      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={onSearch} disabled={loading}>
          {loading ? "Buscando…" : "Buscar escenas"}
        </button>
        {lastCount >= 0 && (
          <small style={{ opacity: .85 }}>
            {lastCount > 0
              ? `Se encontraron ${lastCount} escena(s). Ve a la pestaña `
              : "Sin resultados aún. Tras la búsqueda ve a la pestaña "}
            <b>Descargar</b>.
          </small>
        )}
      </div>

      {error && <div style={{ color: "#ffb4b4", marginTop: 8 }}>{error}</div>}
    </section>
  );
};

export default AlaskaSearch;
