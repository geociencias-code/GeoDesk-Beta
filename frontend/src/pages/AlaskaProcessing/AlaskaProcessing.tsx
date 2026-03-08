import { useMemo, useState, useCallback } from "react";
import JSZip from "jszip";
import { API_URL } from "../../services/api";

type Kind = "coherencia" | "fase" | "elevacion" | "desconocido";

type RasterResult = {
  id: string;
  name: string;
  kind: Kind;
  date?: string;
  stats: Stats;
  objectUrl: string;
};

type Stats = {
  min: number;
  max: number;
  mean: number;
  std: number;
  p2: number;
  p98: number;
  count: number;
};

function formatNumber(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "-";
  return Number(n).toFixed(digits);
}

function niceDateFromText(text: string): string | undefined {
  const m = /(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)/.exec(text);
  if (!m) return undefined;
  const [, y, mo, d] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  if (isNaN(dt.getTime())) return undefined;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
}

export default function AlaskaProcesamiento() {
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Kind | "todos">("todos");
  const [results, setResults] = useState<RasterResult[]>([]);

  const filtered = useMemo(
    () => (filter === "todos" ? results : results.filter(r => r.kind === filter)),
    [results, filter]
  );

  const handleZipFile = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_URL}/api/v1/procesar_zip`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Error en el procesamiento: ${res.statusText}`);
      }

      const zipBlob = await res.blob();
      const zip = await JSZip.loadAsync(zipBlob);

      const statsFile = zip.file("stats.json");
      let statsDict: Record<string, Stats> = {};
      if (statsFile) {
        const statsStr = await statsFile.async("string");
        statsDict = JSON.parse(statsStr);
      }

      const out: RasterResult[] = [];
      const imageFiles = Object.values(zip.files).filter(f => !f.dir && f.name.endsWith(".png"));

      for (const f of imageFiles) {
        try {
          const kindMatch = f.name.match(/^(coherencia|fase|elevacion)_/);
          const kind: Kind = kindMatch ? kindMatch[1] as Kind : "desconocido";

          const blob = await f.async("blob");
          const objectUrl = URL.createObjectURL(blob);

          const stats = statsDict[f.name] || { min: 0, max: 0, mean: 0, std: 0, p2: 0, p98: 0, count: 0 };
          
          const name = f.name.replace(/^(coherencia|fase|elevacion)_/, '');

          const date =
            niceDateFromText(name) ||
            niceDateFromText(name.split("/").slice(0, -1).join("/"));

          out.push({
            id: f.name,
            name,
            kind,
            date,
            stats,
            objectUrl,
          });
        } catch (e) {
          console.warn("Error leyendo ", f.name, e);
        }
      }

      setResults(out);
    } catch (error: unknown) {
       console.error("Error unzipping or fetching from backend", error);
       const message = error instanceof Error ? error.message : String(error);
       alert("Hubo un error al procesar el archivo: " + message);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDownload = (r: RasterResult) => {
    const a = document.createElement("a");
    a.href = r.objectUrl;
    a.download = r.name; // the original png
    a.click();
  };

  return (
    <div className="alaska-container">
      <header className="alaska-header">
        <h1>Procesamiento de Raster desde ZIP</h1>
        <p>
          Sube un archivo ZIP con GeoTIFFs. El backend procesará las imágenes y te devolverá las versiones coloreadas con sus estadísticas.
        </p>
      </header>

      <section className="upload-card">
        <label>Selecciona archivo .zip</label>
        <input
          type="file"
          accept=".zip"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleZipFile(f);
          }}
        />
        {busy && <p className="loading">Procesando ZIP en el backend…</p>}
      </section>

      <div className="filter-buttons-container">
        {(["todos", "coherencia", "fase", "elevacion"] as const).map(k => (
          <button
            key={k}
            className={`filter-btn ${filter === k ? "active" : ""}`}
            onClick={() => setFilter(k)}
          >
            {k}
          </button>
        ))}
      </div>


      <section className="results-grid">
        {filtered.map(r => (
          <RasterCard
            key={r.id}
            r={r}
            onDownload={handleDownload}
          />
        ))}
      </section>

      {filtered.length === 0 && !busy && (
        <p className="no-results">
          No hay resultados. Sube un ZIP para comenzar.
        </p>
      )}
    </div>
  );
}

function RasterCard({
  r,
  onDownload,
}: {
  r: RasterResult;
  onDownload: (r: RasterResult) => void;
}) {
  return (
    <article className="raster-card">
      <div className="raster-header">
        <div>
          <h3>
            {r.kind.toUpperCase()} — {r.name}
          </h3>
          {r.date && <span className="raster-date">{r.date}</span>}
        </div>

        <div className="download-buttons">
          <button onClick={() => onDownload(r)}>Descargar PNG</button>
        </div>
      </div>

      <div className="raster-body">
        <div className="canvas-wrapper">
          <img src={r.objectUrl} alt={r.name} style={{ maxWidth: '100%', height: 'auto' }} />
        </div>
        <StatsTable stats={r.stats} kind={r.kind} />
      </div>
    </article>
  );
}

function StatsTable({ stats, kind }: { stats: Stats; kind: Kind }) {
  const unit =
    kind === "coherencia"
      ? "dB"
      : kind === "fase"
      ? "rad"
      : kind === "elevacion"
      ? "m"
      : "";

  const rows: Array<[string, number]> = [
    ["min", stats.min],
    ["max", stats.max],
    ["mean", stats.mean],
    ["std", stats.std],
    ["p2", stats.p2],
    ["p98", stats.p98],
    ["count", stats.count],
  ];

  return (
    <table className="stats-table">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="stat-key">{k}</td>
            <td className="stat-value">
              {k === "count" ? v : formatNumber(v)} {unit}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
