import React, { useMemo, useRef, useState, useCallback } from "react";
import JSZip from "jszip";
import { fromArrayBuffer } from "geotiff";


//Se debe usar los endpoints definidos en el backend como /api/v1/procesar_zip
// /procesar_zip hace lo mismo pero tiene su propia instancia de FastAPI
type Kind = "coherencia" | "fase" | "elevacion" | "desconocido";

type RasterResult = {
  id: string;
  name: string;
  kind: Kind;
  date?: string;
  stats: Stats;
  width: number;
  height: number;
  data: Float32Array;
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

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function formatNumber(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "-";
  return Number(n).toFixed(digits);
}


function percentileFromHist(
  bins: Float64Array,
  q: number,
  vmin: number,
  vmax: number
): number {
  const total = bins.reduce((a, b) => a + b, 0);
  if (total <= 0) return NaN;
  let acc = 0;
  const target = total * q;

  for (let i = 0; i < bins.length; i++) {
    acc += bins[i];
    if (acc >= target) {
      const t = i / (bins.length - 1);
      return vmin + t * (vmax - vmin);
    }
  }
  return vmax;
}

function computeStats(values: Float32Array | Float64Array | number[]): Stats {
  let min = Infinity,
    max = -Infinity,
    sum = 0,
    sum2 = 0,
    count = 0;

  const BINS = 2048;
  const bins = new Float64Array(BINS);

  let vmin = Infinity,
    vmax = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    vmin = Math.min(vmin, v);
    vmax = Math.max(vmax, v);
  }
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax))
    return {
      min: NaN,
      max: NaN,
      mean: NaN,
      std: NaN,
      p2: NaN,
      p98: NaN,
      count: 0,
    };

  const invRange = 1 / (vmax - vmin);

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
    sum2 += v * v;
    count++;

    let idx = Math.floor((v - vmin) * invRange * (BINS - 1));
    idx = Math.max(0, Math.min(idx, BINS - 1));
    bins[idx]++;
  }

  const mean = sum / count;
  const variance = sum2 / count - mean * mean;
  const std = Math.sqrt(Math.max(0, variance));

  return {
    min,
    max,
    mean,
    std,
    p2: percentileFromHist(bins, 0.02, vmin, vmax),
    p98: percentileFromHist(bins, 0.98, vmin, vmax),
    count,
  };
}

function normalizeValues(values: Float32Array, vmin: number, vmax: number) {
  const out = new Float32Array(values.length);
  const range = vmax - vmin;
  for (let i = 0; i < values.length; i++) {
    out[i] = range > 0 ? clamp01((values[i] - vmin) / range) : 0;
  }
  return out;
}

function viridis(t: number): [number, number, number] {
  const a = [0.267, 0.005, 0.329];
  const b = [0.256, 0.319, 0.441];
  const c = [0.213, 1.0, 0.0];
  return [a[0] + b[0] * t + c[0] * t * (1 - t),
          a[1] + b[1] * t + c[1] * t * (1 - t),
          a[2] + b[2] * t + c[2] * t * (1 - t)];
}

function plasma(t: number): [number, number, number] {
  const a = [0.05, 0.03, 0.527];
  const b = [1.538, 0.5, -0.532];
  const c = [-0.862, 0.5, 0];
  return [a[0] + b[0] * t + c[0] * t * (1 - t),
          a[1] + b[1] * t + c[1] * t * (1 - t),
          a[2] + b[2] * t + c[2] * t * (1 - t)];
}

function twilight(t: number): [number, number, number] {
  const x = t * 2 * Math.PI;
  return [
    0.5 + 0.5 * Math.sin(x),
    0.5 + 0.5 * Math.sin(x + 2.1),
    0.5 + 0.5 * Math.sin(x + 4.2),
  ];
}

function drawToCanvas(
  canvas: HTMLCanvasElement,
  data01: Float32Array,
  w: number,
  h: number,
  kind: Kind,
  vmin: number,
  vmax: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = w;
  canvas.height = h + 60;

  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const t = data01[i];
    let rgb: [number, number, number];

    if (kind === "coherencia") rgb = viridis(t);
    else if (kind === "fase") rgb = twilight(t);
    else if (kind === "elevacion") rgb = plasma(t);
    else rgb = [t, t, t];

    const idx = i * 4;
    img.data[idx] = Math.round(rgb[0] * 255);
    img.data[idx + 1] = Math.round(rgb[1] * 255);
    img.data[idx + 2] = Math.round(rgb[2] * 255);
    img.data[idx + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const scaleWidth = 200;
  const scaleHeight = 20;
  const x = (w - scaleWidth) / 2;
  const y = h;

  const grad = ctx.createLinearGradient(x, y, x + scaleWidth, y);
  const palette =
    kind === "coherencia"
      ? viridis
      : kind === "fase"
      ? twilight
      : kind === "elevacion"
      ? plasma
      : (t: number) => [t, t, t];

  grad.addColorStop(0, `rgb(${palette(0).map(v => v * 255).join(",")})`);
  grad.addColorStop(1, `rgb(${palette(1).map(v => v * 255).join(",")})`);

  ctx.fillStyle = grad;
  ctx.fillRect(x, y, scaleWidth, scaleHeight);

  ctx.fillStyle = "white";
  ctx.font = "14px sans-serif";
  ctx.fillText(formatNumber(vmin), x - 45, y + 14);
  ctx.fillText(formatNumber(vmax), x + scaleWidth + 10, y + 14);
}



export default function AlaskaProcesamiento() {
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Kind | "todos">("todos");
  const [results, setResults] = useState<RasterResult[]>([]);
  const canvasesRef = useRef<Record<string, HTMLCanvasElement | null>>({});

  const filtered = useMemo(
    () => (filter === "todos" ? results : results.filter(r => r.kind === filter)),
    [results, filter]
  );

  const handleZipFile = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entries = Object.values(zip.files).filter(
        f => !f.dir && /\.(tif|tiff)$/i.test(f.name)
      );

      const out: RasterResult[] = [];

      for (const f of entries) {
        try {
          const kind: Kind =
            f.name.includes("unw_phase")
              ? "fase"
              : f.name.includes("dem")
              ? "elevacion"
              : "coherencia";

          const date =
            niceDateFromText(f.name) ||
            niceDateFromText(f.name.split("/").slice(0, -1).join("/"));

          const tiff = await fromArrayBuffer(await f.async("arraybuffer"));
          const image = await tiff.getImage();
          const W = image.getWidth();
          const H = image.getHeight();

          const maxSide = 400;
          const scale = Math.min(1, maxSide / Math.max(W, H));
          const outW = Math.max(1, Math.floor(W * scale));
          const outH = Math.max(1, Math.floor(H * scale));

          const ras = await image.readRasters({
            samples: [0],
            width: outW,
            height: outH,
            interleave: true,
          });

          const arr = new Float32Array(ras as Float32Array);
          const stats = computeStats(arr);
          const data01 = normalizeValues(arr, stats.p2, stats.p98);

          out.push({
            id: `${f.name}-${outW}x${outH}`,
            name: f.name.split("/").pop() || f.name,
            kind,
            date,
            stats,
            width: outW,
            height: outH,
            data: data01,
          });
        } catch (e) {
          console.warn("Error leyendo ", f.name, e);
        }
      }

      setResults(out);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDownload = (id: string, name: string, format: "png" | "tiff") => {
    const canvas = canvasesRef.current[id];
    if (!canvas) return;

    canvas.toBlob(
      blob => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name.replace(/\.(tif|tiff)$/i, "") + "." + format;
        a.click();
        URL.revokeObjectURL(a.href);
      },
      format === "tiff" ? "image/tiff" : "image/png"
    );
  };

  return (
    <div className="alaska-container">
      <header className="alaska-header">
        <h1>Procesamiento de Raster desde ZIP</h1>
        <p>
          Sube un archivo ZIP con GeoTIFFs. Cada raster se clasifica, normaliza, 
          colorea y visualiza automáticamente.
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
        {busy && <p className="loading">Procesando ZIP…</p>}
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
            canvasesRef={canvasesRef}
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
  canvasesRef,
  onDownload,
}: {
  r: RasterResult;
  canvasesRef: React.MutableRefObject<Record<string, HTMLCanvasElement | null>>;
  onDownload: (id: string, name: string, format: "png" | "tiff") => void;
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
          <button onClick={() => onDownload(r.id, r.name, "png")}>PNG</button>
          <button onClick={() => onDownload(r.id, r.name, "tiff")}>TIFF</button>
        </div>
      </div>

      <div className="raster-body">
        <CanvasPreview
          id={r.id}
          width={r.width}
          height={r.height}
          data01={r.data}
          kind={r.kind}
          canvasesRef={canvasesRef}
          stats={r.stats}
        />
        <StatsTable stats={r.stats} kind={r.kind} />
      </div>
    </article>
  );
}

function CanvasPreview({
  id,
  width,
  height,
  data01,
  kind,
  canvasesRef,
  stats,
}: {
  id: string;
  width: number;
  height: number;
  data01: Float32Array;
  kind: Kind;
  canvasesRef: React.MutableRefObject<Record<string, HTMLCanvasElement | null>>;
  stats: Stats;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    if (ref.current) {
      drawToCanvas(ref.current, data01, width, height, kind, stats.min, stats.max);
      canvasesRef.current[id] = ref.current;
    }
  }, [id, width, height, data01, kind, stats, canvasesRef]);

  return (
    <div className="canvas-wrapper">
      <canvas ref={ref} />
    </div>
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
