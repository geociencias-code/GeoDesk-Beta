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
    <div className="page-container" style={{ padding: 0 }}>
      <div className="header-section">
        <div className="icon-wrapper">
          <span style={{ fontSize: "1.5rem" }}>⚙️</span>
        </div>
        <div>
          <h1 style={{ background: "linear-gradient(90deg, #8b5cf6, #3b82f6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Procesamiento de Raster
          </h1>
          <p>Descomprime y procesa automáticamente los productos SAR</p>
        </div>
      </div>

      <div className="layout-grid">
        {/* Left Panel: Upload and Filters */}
        <div className="upload-panel">
          <div className="upload-card">
            <label style={{ color: "var(--color-primary)", fontWeight: "bold", marginBottom: "8px", display: "inline-block" }}>
              1. Cargar Proyecto (.zip)
            </label>
            <div className="dropzone" style={{ marginTop: "12px", borderStyle: "dashed", borderColor: "rgba(255,255,255,0.2)" }}>
              <input
                type="file"
                accept=".zip"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleZipFile(f);
                }}
                style={{ width: "100%", opacity: 0, position: "absolute", height: "100%", cursor: "pointer" }}
              />
              <div className="dropzone-content" style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
                <span className="flex-1 text-center" style={{ color: "var(--color-text-muted)" }}>📂 Selecciona archivo .zip</span>
                <span style={{ fontSize: "0.80rem", color: "var(--color-text-muted)", opacity: 0.7 }}>Extraerá matrices automáticamente</span>
              </div>
            </div>
            
            {busy && (
              <div style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", textAlign: "center", fontSize: "0.85rem", color: "var(--color-primary)" }}>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Procesando ZIP en el backend…
                </span>
              </div>
            )}
          </div>

          <div className="upload-card">
            <label style={{ color: "var(--color-primary)", fontWeight: "bold", marginBottom: "12px", display: "inline-block" }}>
              2. Filtro de Bandas
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {(["todos", "coherencia", "fase", "elevacion"] as const).map(k => (
                <button
                  key={k}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "20px",
                    fontSize: "0.85rem",
                    border: filter === k ? "2px solid var(--color-primary)" : "1px solid rgba(255,255,255,0.1)",
                    background: filter === k ? "rgba(139, 92, 246, 0.2)" : "var(--color-bg-card)",
                    color: filter === k ? "white" : "var(--color-text-muted)",
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                  onClick={() => setFilter(k)}
                >
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Panel: Raster Grids */}
        <div className="results-panel">
          <div className="data-widget" style={{ padding: "20px", minHeight: "500px" }}>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "20px", color: "white" }}>Resultados (Total: {filtered.length})</h3>
            
            {filtered.length === 0 && !busy ? (
              <div style={{ textAlign: "center", padding: "60px", color: "var(--color-text-muted)" }}>
                <span style={{ fontSize: "3rem", display: "block", marginBottom: "16px", opacity: 0.5 }}>📂</span>
                Sube un ZIP de procesos HyP3 o ASF para comenzar a visualizar las gráficas.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "20px" }}>
                {filtered.map(r => (
                  <RasterCard
                    key={r.id}
                    r={r}
                    onDownload={handleDownload}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
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
