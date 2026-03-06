import React, { useState } from "react";
import AlaskaSearch from "./AlaskaSearch";
import SentinelDashboard from "./SentinelDashboard";
import axios from "axios";
import { API_URL } from "../../services/api";

export type Scene = {
  granule: string;
  platform?: string | null;
  date_utc?: string | null;
  ruta?: number | null;
  marco?: number | null;
  beam_mode?: string | null;
  flight_direction?: string | null;
  polarization?: string | null;
  download_url?: string | null;   // cuando sea producto HyP3
  size_mb?: number | null;
};

type Props = { pageKey: string };

function toIsoDayStart(d: string) { return `${d}T00:00:00Z`; }
function toIsoDayEnd(d: string)   { return `${d}T23:59:59Z`; }

const DEFAULT_PROJECT = "prueba_api";

const AlaskaContent: React.FC<Props> = ({ pageKey }) => {
  // —— estado compartido entre pestañas ——
  const [polygonWKT, setPolygonWKT] = useState<string>("");
  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate]     = useState("2025-01-15");
  const [ruta, setRuta]   = useState<number>(128);
  const [marco, setMarco] = useState<number>(547);
  const [flightDirection, setFlightDirection] = useState<"ASCENDING" | "DESCENDING" | "">("");
  const [polarization, setPolarization] = useState<string>("");

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // prefijo para listar/descargar productos HyP3
  const [projectName, setProjectName] = useState(`${DEFAULT_PROJECT}_${ruta}_${marco}`);
  
  // —— Buscar SLC (para procesar) ——
  async function doSearch() {
    try {
      setError(null);
      setSearching(true);
      if (!polygonWKT) throw new Error("Dibuja y cierra un polígono (doble clic) en el mapa.");

      const body = {
        polygon: polygonWKT,
        start_date: toIsoDayStart(startDate),
        end_date: toIsoDayEnd(endDate),
        ruta, marco,
        beam_mode: "IW",
        processing_level: "SLC",
        day_interval: 12,
        same_platform: true,
        flight_direction: flightDirection || undefined,
        polarization: polarization || undefined,
      };

      const res = await axios.post(`${API_URL}/api/search`, body);
      const data: Scene[] = res.data;
      setScenes(data);
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && "message" in e) {
        setError(String((e as { message?: unknown }).message));
      } else {
        setError(String(e));
      }
    } finally {
      setSearching(false);
    }
  }

  // —— Cargar productos HyP3 listos por prefijo (Descargar) ——
  async function loadFromHyP3() {
    try {
      setError(null);
      const res = await axios.post(`${API_URL}/api/hyp3-files`, { nombre_proyecto: DEFAULT_PROJECT, product_type: "INSAR_GAMMA", ruta, marco });
      const data: Array<{ granule: string; download_url: string; size_mb?: number|null; }> = res.data;
      setScenes(data.map(d => ({ granule: d.granule, download_url: d.download_url, size_mb: d.size_mb ?? null })));
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && "message" in e) {
        setError(String((e as { message?: unknown }).message));
      } else {
        setError(String(e));
      }
    }
  }

  // —— Renderizar el contenido basado en el estado de las páginas
  if (pageKey === "obtener_datos") {
    return (
      <AlaskaSearch
        polygonWKT={polygonWKT}
        setPolygonWKT={setPolygonWKT}
        startDate={startDate}
        endDate={endDate}
        setStartDate={setStartDate}
        setEndDate={setEndDate}
        ruta={ruta}
        marco={marco}
        setRuta={setRuta}
        setMarco={setMarco}
        flightDirection={flightDirection}
        setFlightDirection={setFlightDirection}
        polarization={polarization}
        setPolarization={setPolarization}
        onSearch={doSearch}
        loading={searching}
        error={error}
        lastCount={scenes.length}
      />
    );
  }

  if (pageKey === "descargar") {
    return (
      <>
        <section className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
            <label>Proyecto HyP3 (prefijo)
              <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="prueba_api_128_547" />
            </label>
            <button onClick={loadFromHyP3}>Cargar productos HyP3</button>
          </div>
          {error && <div style={{ color: "#ffb4b4", marginTop: 8 }}>{error}</div>}
        </section>

        <SentinelDashboard
          scenes={scenes}
          backendUrl={API_URL}
          ruta={ruta}
          marco={marco}
        />
      </>
    );
  }

  return <div className="card">Elige una opción del encabezado.</div>;
};

export default AlaskaContent;
