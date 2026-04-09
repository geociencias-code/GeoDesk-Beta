import React, { useState, useCallback, useRef, useEffect } from "react";
import axios from "axios";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  Legend,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { API_URL } from "../../services/api";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, FeatureGroup, useMap, Rectangle, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import { EditControl } from "react-leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";

if (typeof window !== "undefined") {
  (window as unknown as Window & { type: string }).type = "";
}

const STORAGE_KEY = "mintpy_last_crop";

type BoundsType = {
  lat_min: number;
  lon_min: number;
  lat_max: number;
  lon_max: number;
};

function isCropWithinBounds(crop: BoundsType, image: BoundsType): boolean {
  return (
    crop.lat_min >= image.lat_min &&
    crop.lat_max <= image.lat_max &&
    crop.lon_min >= image.lon_min &&
    crop.lon_max <= image.lon_max &&
    crop.lat_min < crop.lat_max &&
    crop.lon_min < crop.lon_max
  );
}

function parseCoord(raw: string): number | null {
  if (raw === "" || raw === "-" || raw === "." || raw === "-.") return null;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

type DrawEvent = {
  layer: L.Rectangle | L.Polygon | L.Circle | L.CircleMarker | L.Marker | L.Polyline;
};

function MapContent({
  bounds,
  drawnBox,
  setDrawnBox,
  deformationData = [],
  velMin = 0,
  velMax = 0,
}: {
  bounds: BoundsType | null;
  drawnBox: BoundsType | null;
  setDrawnBox: (box: BoundsType | null) => void;
  deformationData?: Array<{ lat: number; lon: number; velocidad_mm_yr: number }>;
  velMin?: number;
  velMax?: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (bounds && bounds.lat_min !== undefined) {
      const leafBounds = L.latLngBounds(
        [bounds.lat_min, bounds.lon_min],
        [bounds.lat_max, bounds.lon_max]
      );
      map.fitBounds(leafBounds, { padding: [50, 50] });
    }
  }, [bounds, map]);

  const onCreated = (e: DrawEvent) => {
    if (!(e.layer instanceof L.Rectangle)) {
      console.warn("Solo se aceptan rectángulos");
      return;
    }
    const layer = e.layer as L.Rectangle;
    const leafBounds = layer.getBounds();
    setDrawnBox({
      lat_min: leafBounds.getSouth(),
      lon_min: leafBounds.getWest(),
      lat_max: leafBounds.getNorth(),
      lon_max: leafBounds.getEast(),
    });
    map.removeLayer(layer);
  };

  return (
    <FeatureGroup>
      <EditControl
        position="topright"
        onCreated={onCreated}
        onDeleted={() => setDrawnBox(null)}
        draw={{
          rectangle: true,
          polygon: false,
          circle: false,
          circlemarker: false,
          marker: false,
          polyline: false,
        }}
        edit={{ edit: false, remove: true }}
      />
      {bounds && (
        <Rectangle
          bounds={[
            [bounds.lat_min, bounds.lon_min],
            [bounds.lat_max, bounds.lon_max],
          ]}
          pathOptions={{ color: "#3b82f6", weight: 2, fillOpacity: 0.1, dashArray: "5, 5" }}
        />
      )}
      {drawnBox && (
        <Rectangle
          bounds={[
            [drawnBox.lat_min, drawnBox.lon_min],
            [drawnBox.lat_max, drawnBox.lon_max],
          ]}
          pathOptions={{ color: "#ef4444", weight: 2, fillColor: "#ef4444", fillOpacity: 0.2 }}
        />
      )}
      {deformationData.map((pt, i) => {
        // Find color based on min/max of current data or just default to blue/red
        return (
          <CircleMarker
            key={i}
            center={[pt.lat, pt.lon]}
            radius={1.5}
            pathOptions={{
              fillColor: velocityColor(pt.velocidad_mm_yr, velMin, velMax),
              color: velocityColor(pt.velocidad_mm_yr, velMin, velMax),
              weight: 1,
              opacity: 0.8,
              fillOpacity: 0.6,
            }}
          >
            <LeafletTooltip>
              <span>Def: {pt.velocidad_mm_yr.toFixed(2)} mm/a</span>
            </LeafletTooltip>
          </CircleMarker>
        );
      })}
    </FeatureGroup>
  );
}

const COORD_FIELDS: { label: string; key: keyof BoundsType }[] = [
  { label: "Lat Mín (Sur)",  key: "lat_min" },
  { label: "Lat Máx (Norte)", key: "lat_max" },
  { label: "Lon Mín (Oeste)", key: "lon_min" },
  { label: "Lon Máx (Este)",  key: "lon_max" },
];

function CoordPanel({
  drawnBox,
  setDrawnBox,
  imageBounds,
}: {
  drawnBox: BoundsType;
  setDrawnBox: (b: BoundsType) => void;
  imageBounds: BoundsType | null;
}) {
  const [raw, setRaw] = useState<Record<keyof BoundsType, string>>({
    lat_min: String(drawnBox.lat_min),
    lat_max: String(drawnBox.lat_max),
    lon_min: String(drawnBox.lon_min),
    lon_max: String(drawnBox.lon_max),
  });

  const prevBox = useRef(drawnBox);
  useEffect(() => {
    if (prevBox.current !== drawnBox) {
      setRaw({
        lat_min: String(drawnBox.lat_min),
        lat_max: String(drawnBox.lat_max),
        lon_min: String(drawnBox.lon_min),
        lon_max: String(drawnBox.lon_max),
      });
      prevBox.current = drawnBox;
    }
  }, [drawnBox]);

  const handleChange = (key: keyof BoundsType, value: string) => {
    setRaw((r) => ({ ...r, [key]: value }));
    const n = parseCoord(value);
    if (n !== null) {
      setDrawnBox({ ...drawnBox, [key]: n });
    }
  };

  const isValid = imageBounds ? isCropWithinBounds(drawnBox, imageBounds) : true;

  return (
    <div
      style={{
        marginTop: "16px",
        padding: "16px",
        background: "rgba(0,0,0,0.2)",
        borderRadius: "12px",
        border: `1px solid ${isValid ? "rgba(255,255,255,0.08)" : "rgba(239,68,68,0.5)"}`,
      }}
    >
      <label
        style={{
          color: "#e2e8f0",
          fontWeight: 600,
          fontSize: "0.9rem",
          display: "block",
          marginBottom: "12px",
        }}
      >
        ✂️ Coordenadas de Recorte
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "8px" }}>
        {COORD_FIELDS.map(({ label, key }) => (
          <div key={key} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span
              style={{
                fontSize: "0.75rem",
                color: "#94a3b8",
                marginBottom: "4px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {label}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={raw[key]}
              placeholder="ej. -89.2"
              onChange={(e) => handleChange(key, e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px",
                borderRadius: "6px",
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.03)",
                color: "white",
                fontSize: "0.85rem",
              }}
            />
          </div>
        ))}
      </div>
      {imageBounds && !isValid && (
        <p style={{ fontSize: "0.75rem", color: "#fca5a5", margin: 0, marginTop: "8px" }}>
          ⚠️ El recorte debe estar dentro de los límites de la imagen ({imageBounds.lat_min.toFixed(4)}°N–{imageBounds.lat_max.toFixed(4)}°N, {imageBounds.lon_min.toFixed(4)}°E–{imageBounds.lon_max.toFixed(4)}°E).
        </p>
      )}
    </div>
  );
}




interface IgramMeta {
  filename: string;
  date1: string;
  date2: string;
  days: number;
}

interface VelocityStats {
  min: number;
  max: number;
  mean: number;
  std: number;
  n_points: number;
  n_interferograms: number;
  date_start: string;
  date_end: string;
  era5_successful?: boolean;
  tropo_method?: string;
  min_ew?: number;
  max_ew?: number;
  mean_ew?: number;
  std_ew?: number;
}

interface VelocityPoint {
  lat: number;
  lon: number;
  velocidad_mm_yr: number;
  vel_ew_mm_yr?: number;
  vel_up_mm_yr?: number;
}

interface IgramStat {
  date1: string;
  date2: string;
  label: string;
  mean: number;
  std: number;
  min: number;
  max: number;
}

interface ProcessingResults {
  stats: VelocityStats;
  interferograms: IgramMeta[];
  igram_stats?: IgramStat[];
  sample: VelocityPoint[];
  mode?: "2D" | "LOS";
}


/**
 * Maps a ground deformation velocity value to an RGB color string.
 * 
 * Uses a five-point color scale that transitions from subsidence (red) through
 * stable conditions (green) to uplift (blue). The color mapping is normalized
 * to the range of input data, allowing proper visualization of asymmetric
 * deformation patterns.
 * 
 * @param {number} val - The velocity value in mm/year to be mapped to a color
 * @param {number} min - The minimum velocity value in the dataset (typically subsidence)
 * @param {number} max - The maximum velocity value in the dataset (typically uplift)
 * @returns {string} An RGB color string in the format "rgb(r,g,b)" where r,g,b are 0-255
 *
 * @see The color scale follows InSAR conventions:
 * - 0.0 (Max Subsidence) → Red rgb(255,0,0)
 * - 0.25 → Yellow rgb(255,255,0)
 * - 0.50 (Stable 0 mm/yr) → Green rgb(0,255,0)
 * - 0.75 → Cyan rgb(0,255,255)
 * - 1.00 (Max Uplift) → Blue rgb(0,0,255)
 */
function velocityColor(val: number, min: number, max: number): string {
  const limit = Math.max(Math.abs(min), Math.abs(max));
  if (limit === 0) return "rgb(0, 255, 0)";

  const t = Math.max(0, Math.min(1, (val + limit) / (2 * limit)));

  
  if (t < 0.25) {
    const u = t / 0.25; 
    return `rgb(255, ${Math.round(255 * u)}, 0)`;
  } else if (t < 0.5) {
    const u = (t - 0.25) / 0.25;
    return `rgb(${Math.round(255 * (1 - u))}, 255, 0)`;
  } else if (t < 0.75) {
    const u = (t - 0.5) / 0.25;
    return `rgb(0, 255, ${Math.round(255 * u)})`;
  } else {
    const u = (t - 0.75) / 0.25;
    return `rgb(0, ${Math.round(255 * (1 - u))}, 255)`;
  }
}


function buildHistogram(points: VelocityPoint[], bins = 20): { range: string; count: number }[] {
  /**
 * Builds a distribution histogram of ground deformation velocity values.
 *
 * Groups velocity values into bins and counts how many points fall within each range.
 * Each bin is labeled with its minimum value and contains the count of points within
 * that range.
 *
 * @param {VelocityPoint[]} points - Array of points containing ground deformation velocity data
 * @param {number} [bins=20] - Number of bins to divide the velocity range into. Defaults to 20.
 * @returns {{ range: string; count: number }[]} Array of objects with two properties:
 *          - range: string with the minimum value of the range (e.g., "-5.0")
 *          - count: number with the quantity of points in that bin
 *
 **/
  if (!points.length) return [];
  const vals = points.map((p) => p.velocidad_mm_yr);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  if (mn === mx) return [{ range: `${mn.toFixed(2)}`, count: vals.length }];
  const step = (mx - mn) / bins;
  const buckets = Array.from({ length: bins }, (_, i) => ({
    range: `${(mn + i * step).toFixed(1)}`,
    count: 0,
  }));
  vals.forEach((v) => {
    const idx = Math.min(Math.floor((v - mn) / step), bins - 1);
    buckets[idx].count++;
  });
  return buckets;
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface SeedPoint {
  lat: number;
  lon: number;
  is_mintpy_default: boolean;
}

interface PlanData {
  success: boolean;
  asc_count: number;
  desc_count: number;
  mode: "2D" | "LOS";
}

export default function MintPyAnalysis() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<ProcessingResults | null>(null);
  const [seedPoints, setSeedPoints] = useState<SeedPoint[]>([]);
  const [selectedSeed, setSelectedSeed] = useState<SeedPoint | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MIN_IGRAMS = 3;

  const [plan, setPlan] = useState<PlanData | null>(null);
  const [viewMode, setViewMode] = useState<"UP" | "EW">("UP");

  const [bounds, setBounds] = useState<BoundsType | null>(null);
  const [drawnBox, setDrawnBox] = useState<BoundsType | null>(null);

  useEffect(() => {
    if (drawnBox) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drawnBox));
      // When the crop changes, the previously found seed points are no longer valid
      // (a seed from a previous crop area may be outside the new one → 500 error).
      // Force the user to re-run the preview so seeds are recalculated within the new bounds.
      setSeedPoints([]);
      setSelectedSeed(null);
    }
  }, [drawnBox]);

  const fetchPlan = async (fileList: File[]) => {
    if (!fileList.length) return;
    try {
      const formData = new FormData();
      fileList.forEach(f => formData.append("files", f));
      const res = await axios.post(`${API_URL}/api/mintpy/preview_plan`, formData);
      if (res.data.success) {
        setPlan(res.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchBounds = async (fileList: File[]) => {
    if (!fileList.length) return;
    try {
      const formData = new FormData();
      formData.append("files", fileList[0]);
      const res = await axios.post(`${API_URL}/api/mintpy/preview_bounds`, formData);
      if (res.data.success) {
        setBounds(res.data.bounds);
        
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          try {
            const savedCrop: BoundsType = JSON.parse(saved);
            if (isCropWithinBounds(savedCrop, res.data.bounds)) {
              setDrawnBox(savedCrop);
            }
          } catch (err) {
            console.error("Invalid saved crop in storage", err);
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (files.length > 0 && !busy) {
      if (!bounds) fetchBounds(files);
      if (!plan) fetchPlan(files);
    } else if (files.length === 0) {
      setPlan(null);
      setBounds(null);
    }
  }, [files, bounds, plan, busy]);



  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(true); }, []);
  const onDragLeave = useCallback(() => setDragging(false), []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith(".zip"));
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...dropped.filter((f) => !names.has(f.name))];
    });
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selected = Array.from(e.target.files).filter((f) => f.name.toLowerCase().endsWith(".zip"));
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...selected.filter((f) => !names.has(f.name))];
    });
  };

  const removeFile = (name: string) => setFiles((prev) => prev.filter((f) => f.name !== name));

  // ── Process ──────────────────────────────────────────────────────────────────

  const handlePreview = async () => {
    if (files.length < MIN_IGRAMS) {
      setMessage(`❌ Se requieren al menos ${MIN_IGRAMS} interferogramas.`);
      return;
    }

    setBusy(true);
    setProgress(0);
    setSeedPoints([]);
    setSelectedSeed(null);
    setMessage("🔍 Buscando los puntos semilla de mayor coherencia...");

    try {
      const formData = new FormData();
      files.forEach((f) => formData.append("files", f, f.name));
      if (drawnBox) {
        formData.append("crop_lat_min", drawnBox.lat_min.toString());
        formData.append("crop_lat_max", drawnBox.lat_max.toString());
        formData.append("crop_lon_min", drawnBox.lon_min.toString());
        formData.append("crop_lon_max", drawnBox.lon_max.toString());
      }

      const response = await axios.post(`${API_URL}/api/mintpy/preview_reference`, formData, {
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
        },
      });

      const pts = response.data.seed_points as SeedPoint[];
      setSeedPoints(pts);
      const def = pts.find(p => p.is_mintpy_default) || pts[0];
      setSelectedSeed(def);
      setMessage(`✅ Se encontraron ${pts.length} puntos con coherencia máxima. Selecciona uno para anclar el cálculo.`);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const detail = error.response?.data?.detail || error.message;
        setMessage(`❌ Error: ${detail}`);
      } else {
        setMessage("❌ Error desconocido al previsualizar.");
      }
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const handleProcess = async () => {
    if (files.length < MIN_IGRAMS) {
      setMessage(`Se requieren al menos ${MIN_IGRAMS} interferogramas. Actualmente tienes ${files.length}.`);
      return;
    }

    setBusy(true);
    setProgress(0);
    setResults(null);
    setMessage("Ejecutando inversión SBAS con el punto semilla seleccionado...");

    try {
      const formData = new FormData();
      files.forEach((f) => formData.append("files", f, f.name));
      if (selectedSeed) {
        formData.append("ref_lat", selectedSeed.lat.toString());
        formData.append("ref_lon", selectedSeed.lon.toString());
      }
      if (drawnBox) {
        formData.append("crop_lat_min", drawnBox.lat_min.toString());
        formData.append("crop_lat_max", drawnBox.lat_max.toString());
        formData.append("crop_lon_min", drawnBox.lon_min.toString());
        formData.append("crop_lon_max", drawnBox.lon_max.toString());
      }

      const response = await axios.post(`${API_URL}/api/mintpy/process`, formData, {
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 50));
        },
      });

      setProgress(100);
      setResults(response.data as ProcessingResults);
      setMessage(`Análisis completado: ${response.data.stats.n_points.toLocaleString()} puntos procesados.`);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const detail = error.response?.data?.detail || error.message;
        setMessage(`Error: ${detail}`);
      } else {
        setMessage("Error desconocido al procesar.");
      }
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const handleReset = () => {
    setFiles([]);
    setResults(null);
    setSeedPoints([]);
    setSelectedSeed(null);
    setBounds(null);
    setMessage("");
    setProgress(0);
  };

  const cropIsValid = drawnBox && bounds ? isCropWithinBounds(drawnBox, bounds) : !!drawnBox;


  const activeData = results ? (results.mode === "2D" ? results.sample.map(p => ({
    lat: p.lat, lon: p.lon, velocidad_mm_yr: viewMode === "EW" ? (p.vel_ew_mm_yr || 0) : (p.vel_up_mm_yr || 0)
  })) : results.sample) : [];
  
  const histogramData = results ? buildHistogram(activeData) : [];
  const velMin = results && results.mode === "2D" && viewMode === "EW" ? (results.stats.min_ew ?? 0) : (results?.stats.min ?? 0);
  const velMax = results && results.mode === "2D" && viewMode === "EW" ? (results.stats.max_ew ?? 0) : (results?.stats.max ?? 0);


  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0a0f1e 0%, #0d1b2a 50%, #0a1628 100%)",
        color: "white",
        fontFamily: "'Inter', sans-serif",
        padding: "24px",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1
          style={{
            fontSize: "1.8rem",
            fontWeight: 700,
            background: "linear-gradient(135deg, #38bdf8, #818cf8)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            margin: 0,
            marginBottom: "6px",
          }}
        >
          Análisis InSAR — MintPy
        </h1>
        <p style={{ color: "#94a3b8", fontSize: "0.9rem", margin: 0 }}>
          Inversión SBAS de velocidad de deformación del suelo (mm/año) a partir de múltiples interferogramas HyP3/ASF.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: "24px", alignItems: "start" }}>
        {/* Left Panel: Upload */}
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "16px",
            padding: "24px",
          }}
        >
          <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "#e2e8f0", marginBottom: "16px" }}>
            📂 Subir Interferogramas
          </h2>

          {/* Drop Zone */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? "#38bdf8" : "rgba(255,255,255,0.15)"}`,
              borderRadius: "12px",
              padding: "32px 20px",
              textAlign: "center",
              cursor: "pointer",
              background: dragging ? "rgba(56,189,248,0.06)" : "rgba(255,255,255,0.02)",
              transition: "all 0.2s",
              marginBottom: "16px",
            }}
          >
            <div style={{ fontSize: "2rem", marginBottom: "8px" }}>📦</div>
            <p style={{ color: "#94a3b8", fontSize: "0.85rem", margin: 0 }}>
              Arrastra archivos <strong style={{ color: "#e2e8f0" }}>.zip</strong> aquí o haz clic para seleccionar
            </p>
            <p style={{ color: "#64748b", fontSize: "0.75rem", marginTop: "6px" }}>
              Mínimo {MIN_IGRAMS} interferogramas requeridos
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".zip"
              style={{ display: "none" }}
              onChange={onFileChange}
            />
          </div>

          {/* Validation badge */}
          {files.length > 0 && (
            <div
              style={{
                marginBottom: "12px",
                padding: "8px 12px",
                borderRadius: "8px",
                background:
                  files.length >= MIN_IGRAMS
                    ? "rgba(16,185,129,0.12)"
                    : "rgba(239,68,68,0.12)",
                border: `1px solid ${files.length >= MIN_IGRAMS ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
                fontSize: "0.8rem",
                color: files.length >= MIN_IGRAMS ? "#6ee7b7" : "#fca5a5",
              }}
            >
              {files.length >= MIN_IGRAMS
                ? `✅ ${files.length} interferogramas listos`
                : `⚠️ ${files.length}/${MIN_IGRAMS} — faltan ${MIN_IGRAMS - files.length} más`}
            </div>
          )}

          {plan && (
            <div
              style={{
                marginBottom: "12px",
                padding: "8px 12px",
                borderRadius: "8px",
                background: plan.mode === "2D" ? "rgba(56,189,248,0.12)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${plan.mode === "2D" ? "rgba(56,189,248,0.3)" : "rgba(255,255,255,0.1)"}`,
                fontSize: "0.8rem",
                color: "#cbd5e1",
              }}
            >
              <div style={{fontWeight: 600, color: plan.mode === "2D" ? "#38bdf8" : "#cbd5e1"}}>
                {plan.mode === "2D" ? "🚀 Descomposición 2D" : "📏 LOS Estándar"}
              </div>
              <div style={{ color: "#94a3b8", marginTop: "4px", fontSize: "0.75rem" }}>
                Ascendentes: {plan.asc_count} | Descendentes: {plan.desc_count}
              </div>
            </div>
          )}


          {/* File list */}
          {files.length > 0 && (
            <div
              style={{
                maxHeight: "220px",
                overflowY: "auto",
                marginBottom: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              {files.map((f) => (
                <div
                  key={f.name}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 10px",
                    background: "rgba(255,255,255,0.04)",
                    borderRadius: "8px",
                    fontSize: "0.75rem",
                  }}
                >
                  <span
                    style={{
                      color: "#cbd5e1",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "240px",
                    }}
                    title={f.name}
                  >
                    📄 {f.name}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(f.name); }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#94a3b8",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                      padding: "0 4px",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Progress bar */}
          {busy && progress > 0 && (
            <div
              style={{
                height: "6px",
                background: "rgba(255,255,255,0.1)",
                borderRadius: "4px",
                overflow: "hidden",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, #38bdf8, #818cf8)",
                  transition: "width 0.3s ease",
                  borderRadius: "4px",
                }}
              />
            </div>
          )}

          {/* Message */}
          {message && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                background: message.startsWith("❌")
                  ? "rgba(239,68,68,0.1)"
                  : message.startsWith("✅")
                  ? "rgba(16,185,129,0.1)"
                  : "rgba(56,189,248,0.1)",
                border: `1px solid ${
                  message.startsWith("❌")
                    ? "rgba(239,68,68,0.3)"
                    : message.startsWith("✅")
                    ? "rgba(16,185,129,0.3)"
                    : "rgba(56,189,248,0.3)"
                }`,
                fontSize: "0.8rem",
                color: "#e2e8f0",
                marginBottom: "12px",
                lineHeight: "1.5",
              }}
            >
              {message}
            </div>
          )}

          {/* Coordinate panel — visible when bounds are available */}
          {bounds && !results && (
            <CoordPanel
              drawnBox={drawnBox ?? { lat_min: 0, lon_min: 0, lat_max: 0, lon_max: 0 }}
              setDrawnBox={setDrawnBox}
              imageBounds={bounds}
            />
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
            {seedPoints.length === 0 ? (
              <button
                onClick={handlePreview}
                disabled={busy || files.length < MIN_IGRAMS || (!!drawnBox && !cropIsValid)}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "10px",
                  border: "none",
                  background:
                    busy || files.length < MIN_IGRAMS || (!!drawnBox && !cropIsValid)
                      ? "rgba(99,102,241,0.3)"
                      : "linear-gradient(135deg, #0ea5e9, #3b82f6)",
                  color: "white",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  cursor: busy || files.length < MIN_IGRAMS || (!!drawnBox && !cropIsValid) ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                }}
              >
                {busy ? "⏳ Buscando Semillas…" : "🔍 Buscar Puntos Semilla"}
              </button>
            ) : (
              <button
                onClick={handleProcess}
                disabled={busy || files.length < MIN_IGRAMS || (!!drawnBox && !cropIsValid)}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "10px",
                  border: "none",
                  background:
                    busy || files.length < MIN_IGRAMS || (!!drawnBox && !cropIsValid)
                      ? "rgba(16,185,129,0.3)"
                      : "linear-gradient(135deg, #10b981, #059669)",
                  color: "white",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  cursor: busy || files.length < MIN_IGRAMS || (!!drawnBox && !cropIsValid) ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                }}
              >
                {busy ? "⏳ Procesando…" : "🚀 Ejecutar Análisis SBAS"}
              </button>
            )}
            {(files.length > 0 || results) && (
              <button
                onClick={handleReset}
                disabled={busy}
                style={{
                  padding: "12px 16px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "transparent",
                  color: "#94a3b8",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                }}
              >
                ↺
              </button>
            )}
          </div>

          {/* Seed Points Selection */}
          {seedPoints.length > 0 && !results && (
            <div style={{ marginTop: "20px" }}>
              <h3 style={{ fontSize: "0.85rem", color: "#e2e8f0", marginBottom: "10px" }}>
                📍 Selecciona el Punto Cero (Semilla):
              </h3>
              <p style={{ fontSize: "0.75rem", color: "#94a3b8", marginBottom: "12px" }}>
                Estos puntos empataron con la máxima coherencia espacial.
              </p>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "180px", overflowY: "auto", paddingRight: "4px" }}>
                {seedPoints.map((p, i) => {
                  const isSelected = selectedSeed === p;
                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedSeed(p)}
                      style={{
                        padding: "10px 12px",
                        background: isSelected ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${isSelected ? "#38bdf8" : "rgba(255,255,255,0.1)"}`,
                        borderRadius: "8px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        transition: "all 0.2s"
                      }}
                    >
                      <div style={{ fontSize: "0.8rem", color: isSelected ? "#e0f2fe" : "#cbd5e1" }}>
                        Lat: {p.lat.toFixed(4)} <br/>
                        Lon: {p.lon.toFixed(4)}
                      </div>
                      {p.is_mintpy_default && (
                        <span style={{ fontSize: "0.65rem", padding: "2px 6px", background: "#f59e0b", color: "#fff", borderRadius: "10px" }}>
                          MintPy Default
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Interferogram list (after processing) */}
          {results && (
            <div style={{ marginTop: "20px" }}>
              <h3 style={{ fontSize: "0.85rem", color: "#94a3b8", marginBottom: "10px" }}>
                Interferogramas procesados:
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {results.interferograms.map((ig, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "8px 10px",
                      background: "rgba(99,102,241,0.08)",
                      border: "1px solid rgba(99,102,241,0.2)",
                      borderRadius: "8px",
                      fontSize: "0.75rem",
                    }}
                  >
                    <div style={{ color: "#a5b4fc", fontWeight: 600, marginBottom: "2px" }}>
                      {ig.date1} → {ig.date2}
                    </div>
                    <div style={{ color: "#64748b" }}>{ig.days} días | {ig.filename.slice(0, 40)}…</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Panel: Results & Map */}
        <div>
          {!results && bounds ? (
            <div
              className="data-widget"
              style={{
                padding: "0",
                display: "flex",
                flexDirection: "column",
                height: "600px",
                borderRadius: "16px",
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <MapContainer
                center={[(bounds.lat_min + bounds.lat_max)/2, (bounds.lon_min + bounds.lon_max)/2]}
                zoom={8}
                style={{ height: "100%", width: "100%", background: "#1a1a1a" }}
              >
                <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                <MapContent
                  bounds={bounds}
                  drawnBox={drawnBox}
                  setDrawnBox={setDrawnBox}
                />
              </MapContainer>
            </div>
          ) : !results && !bounds ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "600px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "16px",
                color: "#475569",
              }}
            >
              <div style={{ fontSize: "3rem", marginBottom: "12px" }}>🗺️</div>
              <p style={{ fontSize: "0.9rem" }}>
                Sube interferogramas para visualizar sus límites geográficos
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

              {results && results.mode === "2D" && (
                <div style={{ display: "flex", gap: "10px", marginBottom: "4px" }}>
                  <button
                    onClick={() => setViewMode("UP")}
                    style={{
                      flex: 1, padding: "8px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)",
                      background: viewMode === "UP" ? "rgba(56,189,248,0.2)" : "transparent",
                      color: viewMode === "UP" ? "#e0f2fe" : "#94a3b8", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600
                    }}
                  >⬆️ Movimiento Vertical</button>
                  <button
                    onClick={() => setViewMode("EW")}
                    style={{
                      flex: 1, padding: "8px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)",
                      background: viewMode === "EW" ? "rgba(56,189,248,0.2)" : "transparent",
                      color: viewMode === "EW" ? "#e0f2fe" : "#94a3b8", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600
                    }}
                  >↔️ Movimiento Este-Oeste</button>
                </div>
              )}
              {/* Stats cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "12px",
                }}
              >
                {[
                  { label: "Vel. Mínima", value: `${(viewMode === "EW" && results.mode === "2D" && results.stats.min_ew !== undefined ? results.stats.min_ew : results.stats.min).toFixed(2)} mm/a`, color: "#60a5fa" },
                  { label: "Vel. Máxima", value: `${(viewMode === "EW" && results.mode === "2D" && results.stats.max_ew !== undefined ? results.stats.max_ew : results.stats.max).toFixed(2)} mm/a`, color: "#f87171" },
                  { label: "Vel. Media", value: `${(viewMode === "EW" && results.mode === "2D" && results.stats.mean_ew !== undefined ? results.stats.mean_ew : results.stats.mean).toFixed(2)} mm/a`, color: "#34d399" },
                  { label: "Desv. Est.", value: `${(viewMode === "EW" && results.mode === "2D" && results.stats.std_ew !== undefined ? results.stats.std_ew : results.stats.std).toFixed(2)} mm/a`, color: "#a78bfa" },
                ].map((s) => (
                  <div
                    key={s.label}
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "12px",
                      padding: "16px",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: "1.3rem", fontWeight: 700, color: s.color }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "4px" }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                {/* Velocity legend map */}
                <div
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "14px",
                    padding: "20px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "14px",
                    }}
                  >
                    <h3 style={{ fontSize: "0.9rem", color: "#e2e8f0", margin: 0 }}>
                      🗺️ Mapa de Velocidad de Deformación
                    </h3>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <a
                        href={`${API_URL}/api/mintpy/export_xlsx`}
                        download
                        style={{
                          padding: "6px 14px",
                          background: "linear-gradient(135deg, #10b981, #059669)",
                          color: "white",
                          borderRadius: "8px",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          textDecoration: "none",
                        }}
                      >
                        📊 Resumen XLSX
                      </a>
                      <a
                        href={`${API_URL}/api/mintpy/export_csv`}
                        download
                        style={{
                          padding: "6px 14px",
                          background: "linear-gradient(135deg, #6366f1, #4f46e5)",
                          color: "white",
                          borderRadius: "8px",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          textDecoration: "none",
                        }}
                      >
                        ⬇️ Exportar Datos a CSV
                      </a>
                    </div>
                  </div>

                  {/* Color scale strip */}
                  <div style={{ marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "0.7rem", color: "#64748b" }}>{velMin.toFixed(1)}</span>
                    <div
                      style={{
                        flex: 1,
                        height: "10px",
                        borderRadius: "6px",
                        background: `linear-gradient(to right, ${velocityColor(velMin, velMin, velMax)}, ${velocityColor((velMin + velMax) / 2, velMin, velMax)}, ${velocityColor(velMax, velMin, velMax)})`,
                      }}
                    />
                    <span style={{ fontSize: "0.7rem", color: "#64748b" }}>{velMax.toFixed(1)} mm/a</span>
                  </div>

                  {/* Map Layer Visualization */}
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      height: "400px",
                      background: "rgba(0,0,0,0.3)",
                      borderRadius: "10px",
                      overflow: "hidden",
                      border: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <MapContainer
                      center={
                        bounds 
                          ? [(bounds.lat_min + bounds.lat_max)/2, (bounds.lon_min + bounds.lon_max)/2] 
                          : [0, 0]
                      }
                      zoom={8}
                      style={{ height: "100%", width: "100%", background: "#1a1a1a" }}
                      zoomControl={false}
                    >
                      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                      <MapContent
                        bounds={bounds}
                        drawnBox={drawnBox}
                        setDrawnBox={setDrawnBox}
                        deformationData={activeData}
                        velMin={velMin}
                        velMax={velMax}
                      />
                    </MapContainer>
                  </div>

                  <div
                    style={{
                      marginTop: "12px",
                      fontSize: "0.7rem",
                      color: "#475569",
                      textAlign: "center",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "10px"
                    }}
                  >
                    <span>Periodo: {results.stats.date_start} → {results.stats.date_end} | {results.stats.n_interferograms} interferogramas</span>
                    {results.stats.era5_successful !== undefined && (
                      <span style={{
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: "rgba(16,185,129,0.15)",
                        color: "#10b981",
                        fontWeight: 600
                      }}>
                        {results.stats.tropo_method === "ERA5"
                          ? "☁️ ERA5 OK"
                          : `🌄 Troposf: ${results.stats.tropo_method ?? "height_corr"}`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Histogram */}
                <div
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "14px",
                    padding: "20px",
                  }}
                >
                  <h3 style={{ fontSize: "0.9rem", color: "#e2e8f0", marginBottom: "14px" }}>
                    📊 Distribución de Velocidades
                  </h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={histogramData} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis
                        dataKey="range"
                        tick={{ fontSize: 9, fill: "#64748b" }}
                        angle={-45}
                        textAnchor="end"
                        label={{ value: "Velocidad (mm/a)", position: "insideBottom", offset: -16, fill: "#64748b", fontSize: 10 }}
                      />
                      <YAxis tick={{ fontSize: 10, fill: "#64748b" }} />
                      <Tooltip
                        contentStyle={{
                          background: "#0f172a",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "8px",
                          color: "white",
                          fontSize: "0.8rem",
                        }}
                        formatter={(v: number) => [`${v} píxeles`, "Frecuencia"]}
                      />
                      <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Line Chart for Igram Stats */}
              {results?.igram_stats && results.igram_stats.length > 0 && (
                <div
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "14px",
                    padding: "20px",
                  }}
                >
                  <h3 style={{ fontSize: "0.9rem", color: "#e2e8f0", marginBottom: "14px" }}>
                    📈 Deformación Media por Par de Fechas (Población Total)
                  </h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={results?.igram_stats} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 9, fill: "#64748b" }}
                        angle={-45}
                        textAnchor="end"
                      />
                      <YAxis tick={{ fontSize: 10, fill: "#64748b" }} />
                      <Tooltip
                        contentStyle={{
                          background: "#0f172a",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "8px",
                          color: "white",
                          fontSize: "0.8rem",
                        }}
                      />
                      <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: "0.8rem", color: "#94a3b8" }} />
                      <Line type="monotone" name="Media (mm)" dataKey="mean" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      <Line type="monotone" name="Max (mm)" dataKey="max" stroke="#f87171" strokeWidth={1} strokeDasharray="3 3" dot={false} />
                      <Line type="monotone" name="Min (mm)" dataKey="min" stroke="#34d399" strokeWidth={1} strokeDasharray="3 3" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Data table */}
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "14px",
                  padding: "20px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "14px",
                  }}
                >
                  <h3 style={{ fontSize: "0.9rem", color: "#e2e8f0", margin: 0 }}>
                    📋 Muestra de Resultados
                    <span
                      style={{
                        marginLeft: "10px",
                        fontSize: "0.75rem",
                        color: "#64748b",
                        fontWeight: "normal",
                      }}
                    >
                      ({results.sample.length} de {results.stats.n_points.toLocaleString()} puntos)
                    </span>
                  </h3>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <a
                      href={`${API_URL}/api/mintpy/export_xlsx`}
                      download
                      style={{
                        padding: "6px 14px",
                        background: "linear-gradient(135deg, #10b981, #059669)",
                        color: "white",
                        borderRadius: "8px",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      📊 Resumen XLSX
                    </a>
                    <a
                      href={`${API_URL}/api/mintpy/export_csv`}
                      download
                      style={{
                        padding: "6px 14px",
                        background: "linear-gradient(135deg, #6366f1, #4f46e5)",
                        color: "white",
                        borderRadius: "8px",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      ⬇️ Exportar Datos a CSV
                    </a>
                  </div>
                </div>

                <div style={{ overflowX: "auto", maxHeight: "340px", overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.04)", position: "sticky", top: 0 }}>
                        {["#", "Latitud", "Longitud", "Velocidad (mm/año)"].map((h) => (
                          <th
                            key={h}
                            style={{
                              padding: "10px 12px",
                              textAlign: "left",
                              color: "#94a3b8",
                              fontWeight: 600,
                              fontSize: "0.78rem",
                              borderBottom: "1px solid rgba(255,255,255,0.08)",
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.sample.map((p, idx) => {
                        const color = velocityColor(p.velocidad_mm_yr, velMin, velMax);
                        return (
                          <tr
                            key={idx}
                            style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                          >
                            <td style={{ padding: "8px 12px", color: "#475569" }}>{idx + 1}</td>
                            <td style={{ padding: "8px 12px", color: "#94a3b8" }}>
                              {p.lat.toFixed(6)}
                            </td>
                            <td style={{ padding: "8px 12px", color: "#94a3b8" }}>
                              {p.lon.toFixed(6)}
                            </td>
                            <td
                              style={{
                                padding: "8px 12px",
                                fontWeight: 700,
                                color,
                              }}
                            >
                              {results.mode === "2D" ? (
                                viewMode === "EW" ? (
                                  (p.vel_ew_mm_yr || 0) > 0 ? "+" : ""
                                ) + (p.vel_ew_mm_yr || 0).toFixed(2) : (
                                  (p.vel_up_mm_yr || 0) > 0 ? "+" : ""
                                ) + (p.vel_up_mm_yr || 0).toFixed(2)
                              ) : (
                                (p.velocidad_mm_yr > 0 ? "+" : "") + p.velocidad_mm_yr.toFixed(2)
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {results.sample.length < results.stats.n_points && (
                  <p
                    style={{
                      textAlign: "center",
                      color: "#475569",
                      fontSize: "0.75rem",
                      marginTop: "12px",
                      fontStyle: "italic",
                    }}
                  >
                    Mostrando muestra de {results.sample.length} puntos. Descarga el CSV para el dataset completo.
                  </p>
                )}
              </div>
              
              {/* Static Vector Map (Quiver) */}
              {results.mode === "2D" && (
                <div
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "14px",
                    padding: "20px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "14px",
                    }}
                  >
                    <h3 style={{ fontSize: "0.9rem", color: "#e2e8f0", margin: 0 }}>
                      🧭 Mapa Vectorial Estático (Cartopy Quiver)
                    </h3>
                    <a
                      href={`${API_URL}/api/mintpy/export_quiver_${viewMode.toLowerCase()}`}
                      download
                      style={{
                        padding: "6px 14px",
                        background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
                        color: "white",
                        borderRadius: "8px",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      📸 Descargar Mapa
                    </a>
                  </div>
                  <div style={{ textAlign: "center", background: "rgba(0,0,0,0.2)", borderRadius: "10px", padding: "10px", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <img 
                      src={`${API_URL}/api/mintpy/export_quiver_${viewMode.toLowerCase()}?t=${results.stats.date_end}`} 
                      alt={`Mapa Vectorial ${viewMode}`} 
                      style={{ maxWidth: "100%", maxHeight: "600px", borderRadius: "6px", objectFit: "contain" }}
                    />
                    <p style={{ color: "#94a3b8", fontSize: "0.75rem", marginTop: "10px", fontStyle: "italic" }}>
                      Mostrando estadísticamente ~33% de los vectores calculados para preservar las direcciones y claridad visual (Proyección PlateCarree).
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
