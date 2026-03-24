import React, { useState, useCallback, useRef } from "react";
import axios from "axios";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { API_URL } from "../../services/api";


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
}

interface VelocityPoint {
  lat: number;
  lon: number;
  velocidad_mm_yr: number;
}

interface ProcessingResults {
  stats: VelocityStats;
  interferograms: IgramMeta[];
  sample: VelocityPoint[];
}


function velocityColor(val: number, min: number, max: number): string {
  const limit = Math.max(Math.abs(min), Math.abs(max));
  if (limit === 0) return "rgb(0, 255, 0)";

  const t = Math.max(0, Math.min(1, (val + limit) / (2 * limit)));
  
  // Deformation colormap:
  // 0.0 (Max Subsidence) = Red (255,0,0)
  // 0.25 = Yellow (255,255,0)
  // 0.50 (Stable 0 mm/yr) = Green (0,255,0)
  // 0.75 = Cyan (0,255,255)
  // 1.00 (Max Uplift) = Blue (0,0,255)
  
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

// ── Histogram helper ───────────────────────────────────────────────────────────

function buildHistogram(points: VelocityPoint[], bins = 20): { range: string; count: number }[] {
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

export default function MintPyAnalysis() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<ProcessingResults | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MIN_IGRAMS = 3;

  // ── Drag & drop ─────────────────────────────────────────────────────────────

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

  const handleProcess = async () => {
    if (files.length < MIN_IGRAMS) {
      setMessage(`❌ Se requieren al menos ${MIN_IGRAMS} interferogramas. Actualmente tienes ${files.length}.`);
      return;
    }

    setBusy(true);
    setProgress(0);
    setResults(null);
    setMessage("⏳ Enviando archivos al servidor y ejecutando inversión SBAS…");

    try {
      const formData = new FormData();
      files.forEach((f) => formData.append("files", f, f.name));

      const response = await axios.post(`${API_URL}/api/mintpy/process`, formData, {
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 50));
        },
      });

      setProgress(100);
      setResults(response.data as ProcessingResults);
      setMessage(`✅ Análisis completado: ${response.data.stats.n_points.toLocaleString()} puntos procesados.`);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const detail = error.response?.data?.detail || error.message;
        setMessage(`❌ Error: ${detail}`);
      } else {
        setMessage("❌ Error desconocido al procesar.");
      }
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const handleReset = () => {
    setFiles([]);
    setResults(null);
    setMessage("");
    setProgress(0);
  };

  // ── Histogram data ───────────────────────────────────────────────────────────

  const histogramData = results ? buildHistogram(results.sample) : [];
  const velMin = results?.stats.min ?? 0;
  const velMax = results?.stats.max ?? 0;

  // ── Render ───────────────────────────────────────────────────────────────────

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
          🛰️ Análisis InSAR — Estilo MintPy
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

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={handleProcess}
              disabled={busy || files.length < MIN_IGRAMS}
              style={{
                flex: 1,
                padding: "12px",
                borderRadius: "10px",
                border: "none",
                background:
                  busy || files.length < MIN_IGRAMS
                    ? "rgba(99,102,241,0.3)"
                    : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "white",
                fontWeight: 600,
                fontSize: "0.9rem",
                cursor: busy || files.length < MIN_IGRAMS ? "not-allowed" : "pointer",
                transition: "all 0.2s",
              }}
            >
              {busy ? "⏳ Procesando…" : "🚀 Procesar"}
            </button>
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

        {/* Right Panel: Results */}
        <div>
          {!results ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "400px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "16px",
                color: "#475569",
              }}
            >
              <div style={{ fontSize: "3rem", marginBottom: "12px" }}>🛰️</div>
              <p style={{ fontSize: "0.9rem" }}>
                Sube interferogramas y presiona <strong style={{ color: "#6366f1" }}>Procesar</strong>
              </p>
              <p style={{ fontSize: "0.8rem", marginTop: "6px" }}>
                Los resultados de velocidad aparecerán aquí
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Stats cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "12px",
                }}
              >
                {[
                  { label: "Vel. Mínima", value: `${results.stats.min.toFixed(2)} mm/a`, color: "#60a5fa" },
                  { label: "Vel. Máxima", value: `${results.stats.max.toFixed(2)} mm/a`, color: "#f87171" },
                  { label: "Vel. Media", value: `${results.stats.mean.toFixed(2)} mm/a`, color: "#34d399" },
                  { label: "Desv. Est.", value: `${results.stats.std.toFixed(2)} mm/a`, color: "#a78bfa" },
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
                    <a
                      href={`${API_URL}/api/mintpy/export`}
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
                      📊 Exportar Excel
                    </a>
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

                  {/* Scatter grid visualization */}
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      height: "280px",
                      background: "rgba(0,0,0,0.3)",
                      borderRadius: "10px",
                      overflow: "hidden",
                      border: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    {(() => {
                      const pts = results.sample;
                      if (!pts.length) return null;
                      const lats = pts.map((p) => p.lat);
                      const lons = pts.map((p) => p.lon);
                      const latMin = Math.min(...lats), latMax = Math.max(...lats);
                      const lonMin = Math.min(...lons), lonMax = Math.max(...lons);
                      const latRange = latMax - latMin || 1;
                      const lonRange = lonMax - lonMin || 1;
                      const dotSize = Math.max(2, Math.min(6, Math.round(280 / Math.sqrt(pts.length))));
                      return pts.map((p, i) => (
                        <div
                          key={i}
                          title={`Lat: ${p.lat.toFixed(4)}\nLon: ${p.lon.toFixed(4)}\nVelocidad: ${p.velocidad_mm_yr.toFixed(2)} mm/a`}
                          style={{
                            position: "absolute",
                            left: `${((p.lon - lonMin) / lonRange) * 100}%`,
                            bottom: `${((p.lat - latMin) / latRange) * 100}%`,
                            width: `${dotSize}px`,
                            height: `${dotSize}px`,
                            borderRadius: "50%",
                            background: velocityColor(p.velocidad_mm_yr, velMin, velMax),
                            transform: "translate(-50%, 50%)",
                            opacity: 0.85,
                          }}
                        />
                      ));
                    })()}
                    <div
                      style={{
                        position: "absolute",
                        bottom: "6px",
                        left: "8px",
                        fontSize: "0.65rem",
                        color: "#475569",
                      }}
                    >
                      {results.sample.length} puntos mostrados de {results.stats.n_points.toLocaleString()}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: "8px",
                      fontSize: "0.7rem",
                      color: "#475569",
                      textAlign: "center",
                    }}
                  >
                    Periodo: {results.stats.date_start} → {results.stats.date_end} | {results.stats.n_interferograms} interferogramas
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
                        formatter={(v: any) => [`${v} píxeles`, "Frecuencia"]}
                      />
                      <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

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
                  <a
                    href={`${API_URL}/api/mintpy/export`}
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
                    ⬇️ Descargar Excel completo
                  </a>
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
                              {p.velocidad_mm_yr > 0 ? "+" : ""}
                              {p.velocidad_mm_yr.toFixed(2)}
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
                    Mostrando muestra de {results.sample.length} puntos. Descarga el Excel para el dataset completo.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
