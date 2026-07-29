import React, { useState, useEffect, useCallback } from "react";
import AlaskaSearch from "./AlaskaSearch";
import SentinelDashboard from "./SentinelDashboard";
import api, { API_URL } from "../../services/api";
import type { PathFrameOption } from "./MapComponent";

export type Scene = {
  granule: string;
  platform?: string | null;
  date_utc?: string | null;
  ruta?: number | null;
  marco?: number | null;
  beam_mode?: string | null;
  flight_direction?: string | null;
  polarization?: string | null;
  download_url?: string | null;
  size_mb?: number | null;
};

type Props = { pageKey: string };

function toIsoDayStart(d: string) { return `${d}T00:00:00Z`; }
function toIsoDayEnd(d: string)   { return `${d}T23:59:59Z`; }

const DEFAULT_PROJECT = "prueba_api";

const AlaskaContent: React.FC<Props> = ({ pageKey }) => {
  const [polygonWKT, setPolygonWKT] = useState<string>("");
  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate]     = useState("2025-01-15");
  const [ruta, setRuta]   = useState<number | null>(null);
  const [marco, setMarco] = useState<number | null>(null);
  const [flightDirection, setFlightDirection] = useState<"ASCENDING" | "DESCENDING" | "">("");
  const [polarization, setPolarization] = useState<string>("");
  const [dayInterval, setDayInterval] = useState<number>(12);

  // Path/frame discovery state
  const [pathFrameOptions, setPathFrameOptions] = useState<PathFrameOption[]>([]);
  const [pathFrameLoading, setPathFrameLoading] = useState(false);

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectName, setProjectName] = useState(DEFAULT_PROJECT);

  // When the user selects a path/frame rectangle on the map
  const handlePathFrameSelect = useCallback((r: number, m: number) => {
    setRuta(r);
    setMarco(m);
    setScenes([]); // clear previous results when selection changes
  }, []);

  // Discover available paths whenever the AOI polygon or date/direction filters change
  const discoverPaths = useCallback(async (polygon: string) => {
    console.log("[AlaskaContent] discoverPaths called, polygon length:", polygon.length);
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
      console.log("[AlaskaContent] fetching discover_paths...");

      const body = {
        polygon,
        start_date: toIsoDayStart(startDate),
        end_date: toIsoDayEnd(endDate),
        beam_mode: "IW",
        processing_level: "SLC",
        flight_direction: flightDirection || undefined,
        polarization: polarization || undefined,
      };

      const res = await api.post<PathFrameOption[]>('/api/discover_paths', body);
      const options: PathFrameOption[] = res.data;
      setPathFrameOptions(options);

      // Auto-select the preferred option if available
      const preferred = options.find(o => o.is_preferred);
      const autoSelect = preferred ?? options[0];
      if (autoSelect) {
        setRuta(autoSelect.ruta);
        setMarco(autoSelect.marco);
      }
    } catch (e: unknown) {
      console.error("Error discovering paths:", e);
    } finally {
      setPathFrameLoading(false);
    }
  }, [startDate, endDate, flightDirection, polarization]);

  // Trigger discover when polygon changes
  const handlePolygonChange = useCallback((wkt: string) => {
    console.log("[AlaskaContent] handlePolygonChange called with WKT length:", wkt.length);
    setPolygonWKT(wkt);
    discoverPaths(wkt);
  }, [discoverPaths]);

  // Re-discover when filters change (if polygon is already set)
  useEffect(() => {
    if (polygonWKT) {
      discoverPaths(polygonWKT);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, flightDirection, polarization]);

  // —— Buscar SLC (para procesar) ——
  async function doSearch() {
    try {
      setError(null);
      setSearching(true);
      if (!polygonWKT) throw new Error("Dibuja y cierra un polígono en el mapa.");
      if (ruta == null || marco == null) throw new Error("Selecciona una ruta/marco en el mapa haciendo clic en uno de los rectángulos.");

      const body = {
        polygon: polygonWKT,
        start_date: toIsoDayStart(startDate),
        end_date: toIsoDayEnd(endDate),
        ruta, marco,
        beam_mode: "IW",
        processing_level: "SLC",
        day_interval: dayInterval,
        same_platform: true,
        flight_direction: flightDirection || undefined,
        polarization: polarization || undefined,
      };

      const res = await api.post('/api/search', body);
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

  async function loadFromHyP3() {
    try {
      setError(null);
      const res = await api.post('/api/hyp3-files', { nombre_proyecto: DEFAULT_PROJECT, product_type: "INSAR_GAMMA", ruta, marco });
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

  if (pageKey === "obtener_datos") {
    return (
      <AlaskaSearch
        polygonWKT={polygonWKT}
        setPolygonWKT={handlePolygonChange}
        startDate={startDate}
        endDate={endDate}
        setStartDate={setStartDate}
        setEndDate={setEndDate}
        ruta={ruta}
        marco={marco}
        flightDirection={flightDirection}
        setFlightDirection={setFlightDirection}
        polarization={polarization}
        setPolarization={setPolarization}
        dayInterval={dayInterval}
        setDayInterval={setDayInterval}
        onSearch={doSearch}
        loading={searching}
        error={error}
        lastCount={scenes.length}
        pathFrameOptions={pathFrameOptions}
        pathFrameLoading={pathFrameLoading}
        onPathFrameSelect={handlePathFrameSelect}
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
          ruta={ruta ?? undefined}
          marco={marco ?? undefined}
          dayInterval={dayInterval}
        />
      </>
    );
  }

  return <div className="card">Elige una opción del encabezado.</div>;
};

export default AlaskaContent;
