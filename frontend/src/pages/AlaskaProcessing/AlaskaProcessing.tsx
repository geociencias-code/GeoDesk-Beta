import { useState, useEffect, useRef } from "react";
import JSZip from "jszip";
import { API_URL } from "../../services/api";
import axios from "axios";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, FeatureGroup, useMap, Rectangle, CircleMarker, Tooltip } from "react-leaflet";
import { EditControl } from "react-leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";

if (typeof window !== "undefined") {
  (window as unknown as Window & { type: string }).type = "";
}

const STORAGE_KEY = "geodesk_last_crop";

type BoundsType = {
  lat_min: number;
  lon_min: number;
  lat_max: number;
  lon_max: number;
};

interface DeformationResults {
  dias: number;
  start_date?: string;
  end_date?: string;
  sample: Array<{
    lat: number;
    lon: number;
    def: number;
  }>;
}

type DrawEvent = {
  layer: L.Rectangle | L.Polygon | L.Circle | L.CircleMarker | L.Marker | L.Polyline;
};

/** Returns true when the crop box is fully contained within the image bounds */
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

/** Clamp a string value into a numeric field, tolerating mid-edit strings like "-89." */
function parseCoord(raw: string): number | null {
  // Allow an empty string or a trailing decimal / sign — return null to keep as text only
  if (raw === "" || raw === "-" || raw === "." || raw === "-.") return null;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

// ─── Map sub-component ────────────────────────────────────────────────────────

function MapContent({
  bounds,
  drawnBox,
  setDrawnBox,
  deformationData = [],
}: {
  bounds: BoundsType | null;
  drawnBox: BoundsType | null;
  setDrawnBox: (box: BoundsType | null) => void;
  deformationData?: Array<{ lat: number; lon: number; def: number }>;
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
      {deformationData.map((pt, i) => (
        <CircleMarker
          key={i}
          center={[pt.lat, pt.lon]}
          radius={3}
          pathOptions={{
            fillColor: pt.def > 0 ? "#ff4b4b" : "#4caf50",
            color: pt.def > 0 ? "#ff4b4b" : "#4caf50",
            weight: 1,
            opacity: 0.8,
            fillOpacity: 0.6,
          }}
        >
          <Tooltip>
            <span>Def: {pt.def.toFixed(2)} mm</span>
          </Tooltip>
        </CircleMarker>
      ))}
    </FeatureGroup>
  );
}

// ─── Coordinate input row ─────────────────────────────────────────────────────

type CoordField = { label: string; key: keyof BoundsType };

const COORD_FIELDS: CoordField[] = [
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
  // Keep raw string values so the user can type "-89." without it being forced to 0
  const [raw, setRaw] = useState<Record<keyof BoundsType, string>>({
    lat_min: String(drawnBox.lat_min),
    lat_max: String(drawnBox.lat_max),
    lon_min: String(drawnBox.lon_min),
    lon_max: String(drawnBox.lon_max),
  });

  // When drawnBox changes externally (e.g. from map draw), sync raw values
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

  const isValid = isCropWithinBounds(drawnBox, imageBounds ?? drawnBox);

  return (
    <div
      style={{
        marginTop: "16px",
        padding: "12px",
        background: "rgba(0,0,0,0.2)",
        borderRadius: "8px",
        border: `1px solid ${isValid || !imageBounds ? "rgba(255,255,255,0.1)" : "rgba(239,68,68,0.5)"}`,
      }}
    >
      <label
        style={{
          color: "var(--color-primary)",
          fontWeight: "bold",
          fontSize: "0.85rem",
          display: "block",
          marginBottom: "8px",
        }}
      >
        Coordenadas de Selección Exactas
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "8px" }}>
        {COORD_FIELDS.map(({ label, key }) => (
          <div key={key} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-muted)",
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
                padding: "6px",
                borderRadius: "4px",
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.05)",
                color: "white",
                fontSize: "0.80rem",
              }}
            />
          </div>
        ))}
      </div>
      {imageBounds && !isValid && (
        <p style={{ fontSize: "0.75rem", color: "#fca5a5", margin: 0, marginTop: "4px" }}>
          ⚠️ El recorte debe estar dentro de los límites de la imagen ({imageBounds.lat_min.toFixed(4)}°N–{imageBounds.lat_max.toFixed(4)}°N,&nbsp;
          {imageBounds.lon_min.toFixed(4)}°E–{imageBounds.lon_max.toFixed(4)}°E).
        </p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AlaskaProcesamiento() {
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [bounds, setBounds] = useState<BoundsType | null>(null);

  const [drawnBox, setDrawnBox] = useState<BoundsType | null>(null);
  const [croppedZipUrl, setCroppedZipUrl] = useState<string | null>(null);
  const [croppedFileName, setCroppedFileName] = useState<string>("");

  const [results, setResults] = useState<DeformationResults | null>(null);
  const [deformationCsvUrl, setDeformationCsvUrl] = useState<string | null>(null);
  const [deformationCsvBlob, setDeformationCsvBlob] = useState<Blob | null>(null);

  // ── Persist last crop to localStorage ──────────────────────────────────────
  // Save whenever drawnBox changes (and after a successful crop)
  useEffect(() => {
    if (drawnBox) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drawnBox));
    }
  }, [drawnBox]);

  // ── handleZipFile ───────────────────────────────────────────────────────────
  const handleZipFile = async (file: File) => {
    setZipFile(file);
    setBusy(true);
    setMessage("Leyendo extensión del archivo...");
    setBounds(null);
    setDrawnBox(null);
    setCroppedZipUrl(null);
    setResults(null);
    setDeformationCsvUrl(null);
    setDeformationCsvBlob(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await axios.post(`${API_URL}/api/v1/alaska/preview`, formData);
      if (res.data.success) {
        const imageBounds: BoundsType = res.data.bounds;
        setBounds(imageBounds);

        // Try to restore last saved crop — only use it if it fits within this image
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          try {
            const savedCrop: BoundsType = JSON.parse(saved);
            if (isCropWithinBounds(savedCrop, imageBounds)) {
              setDrawnBox(savedCrop);
              setMessage(
                "Extensión leída. Se restauró el último recorte guardado (válido para esta imagen). Puedes ajustarlo o dibujarlo de nuevo."
              );
            } else {
              setMessage(
                "Extensión leída. El último recorte guardado no cabe en esta imagen — dibuja uno nuevo en el mapa."
              );
            }
          } catch {
            setMessage("Extensión leída correctamente. Dibuja un rectángulo en el mapa para recortar.");
          }
        } else {
          setMessage("Extensión leída correctamente. Dibuja un rectángulo en el mapa o escribe las coordenadas para recortar.");
        }
      }
    } catch (error: unknown) {
      console.error(error);
      const msg = axios.isAxiosError(error) ? error.response?.data?.detail : String(error);
      setMessage("Error leyendo ZIP: " + msg);
    } finally {
      setBusy(false);
    }
  };

  // ── handleCrop ──────────────────────────────────────────────────────────────
  const handleCrop = async () => {
    if (!zipFile || !drawnBox) return;

    setBusy(true);
    setMessage("Recortando rásteres. Por favor espera...");
    try {
      const formData = new FormData();
      formData.append("file", zipFile);

      const res = await axios.post(
        `${API_URL}/api/v1/alaska/crop?lat_min=${drawnBox.lat_min}&lon_min=${drawnBox.lon_min}&lat_max=${drawnBox.lat_max}&lon_max=${drawnBox.lon_max}`,
        formData,
        { responseType: "blob" }
      );

      const url = window.URL.createObjectURL(new Blob([res.data]));
      setCroppedZipUrl(url);
      setCroppedFileName(`cropped_${zipFile.name}`);
      setMessage("Archivos recortados exitosamente.");

      // Persist the successful crop
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drawnBox));
    } catch (error) {
      console.error(error);
      setMessage("Error recortando imágenes.");
    } finally {
      setBusy(false);
    }
  };

  // ── handleCalculateDeformation ──────────────────────────────────────────────
  const handleCalculateDeformation = async () => {
    if (!croppedZipUrl || !zipFile) return;

    setBusy(true);
    setMessage("Procesando fase y calculando vector de deformación anual...");
    try {
      const blobRes = await fetch(croppedZipUrl);
      const blob = await blobRes.blob();

      const formData = new FormData();
      formData.append("file", blob, `cropped_${zipFile.name}`);

      const res = await axios.post(`${API_URL}/api/v1/alaska/velocity`, formData, {
        responseType: "blob",
      });

      const zipInstance = await JSZip.loadAsync(res.data);

      const uiDataStr = await zipInstance.file("ui_data.json")?.async("string");
      if (uiDataStr) {
        const parsedData: DeformationResults = JSON.parse(uiDataStr);
        setResults(parsedData);
      }

      const csvFile = Object.values(zipInstance.files).find((f) => f.name.endsWith(".csv"));
      if (csvFile) {
        const csvBlob = await csvFile.async("blob");
        setDeformationCsvUrl(window.URL.createObjectURL(csvBlob));
        setDeformationCsvBlob(csvBlob);
      }

      setMessage("Deformación calculada de manera exitosa.");
    } catch (error) {
      console.error(error);
      setMessage("Ocurrió un error al calcular la deformación.");
    } finally {
      setBusy(false);
    }
  };


  // ── Derived state ───────────────────────────────────────────────────────────
  const cropIsValid = drawnBox && bounds ? isCropWithinBounds(drawnBox, bounds) : !!drawnBox;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="page-container" style={{ padding: 0 }}>
      {/* Header */}
      <div className="header-section">
        <div className="icon-wrapper">
          <span style={{ fontSize: "1.5rem" }}>✂️</span>
        </div>
        <div>
          <h1
            style={{
              background: "linear-gradient(90deg, #8b5cf6, #3b82f6)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Recorte y Deformación SNAP
          </h1>
          <p>Extrae regiones de interés de productos HyP3 y deriva modelos de deformación</p>
        </div>
      </div>

      <div className="layout-grid">
        {/* ── Left panel ── */}
        <div className="upload-panel">
          <div className="upload-card">
            <label
              style={{
                color: "var(--color-primary)",
                fontWeight: "bold",
                marginBottom: "8px",
                display: "inline-block",
              }}
            >
              1. Cargar Proyecto InSAR (.zip)
            </label>
            <div
              className="dropzone"
              style={{ marginTop: "12px", borderStyle: "dashed", borderColor: "rgba(255,255,255,0.2)" }}
            >
              <input
                type="file"
                accept=".zip"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleZipFile(f);
                }}
                style={{ width: "100%", opacity: 0, position: "absolute", height: "100%", cursor: "pointer" }}
              />
              <div
                className="dropzone-content"
                style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}
              >
                {zipFile ? (
                  <span className="selected-file text-center" style={{ color: "var(--color-text-main)" }}>
                    {zipFile.name}
                  </span>
                ) : (
                  <>
                    <span className="flex-1 text-center" style={{ color: "var(--color-text-muted)" }}>
                      📂 Selecciona archivo .zip
                    </span>
                    <span style={{ fontSize: "0.80rem", color: "var(--color-text-muted)", opacity: 0.7 }}>
                      Extrae georreferencia
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Coordinate panel — visible as soon as we have image bounds, regardless of drawn box */}
            {bounds && !croppedZipUrl && (
              <CoordPanel
                drawnBox={drawnBox ?? { lat_min: 0, lon_min: 0, lat_max: 0, lon_max: 0 }}
                setDrawnBox={setDrawnBox}
                imageBounds={bounds}
              />
            )}

            {bounds && !croppedZipUrl && (
              <button
                onClick={handleCrop}
                disabled={busy || !drawnBox || !cropIsValid}
                className="submit-btn"
                style={{
                  background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
                  marginTop: "16px",
                  opacity: busy || !drawnBox || !cropIsValid ? 0.5 : 1,
                }}
              >
                {busy ? "Procesando recorte..." : "Recortar Selección"}
              </button>
            )}

            {croppedZipUrl && (
              <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <a
                  href={croppedZipUrl}
                  download={croppedFileName}
                  className="submit-btn"
                  style={{
                    display: "block",
                    textAlign: "center",
                    textDecoration: "none",
                    background: "rgba(16, 185, 129, 0.2)",
                    border: "1px solid #10b981",
                    color: "#34d399",
                    padding: "10px",
                    borderRadius: "8px",
                  }}
                >
                  ⬇️ Descargar Recorte ZIP
                </a>

                <hr style={{ borderColor: "rgba(255,255,255,0.1)", margin: "8px 0" }} />

                <label
                  style={{
                    color: "var(--color-primary)",
                    fontWeight: "bold",
                    fontSize: "0.9rem",
                  }}
                >
                  2. Estimación de Desplazamiento
                </label>
                <button
                  onClick={handleCalculateDeformation}
                  disabled={busy}
                  className="submit-btn"
                  style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)" }}
                >
                  {busy ? "Calculando..." : "Derivar Deformación de Fase"}
                </button>
              </div>
            )}

            {message && (
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px",
                  borderRadius: "8px",
                  background: "rgba(255,255,255,0.05)",
                  textAlign: "center",
                  fontSize: "0.85rem",
                  color: message.includes("❌") ? "#ffb4b4" : "var(--color-text-muted)",
                }}
              >
                {message}
              </div>
            )}

          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="results-panel" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div
            className="data-widget"
            style={{
              padding: "0",
              display: "flex",
              flexDirection: "column",
              height: "500px",
              borderRadius: "12px",
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <MapContainer
              center={[13.69, -89.22]}
              zoom={8}
              style={{ height: "100%", width: "100%", background: "#1a1a1a" }}
              zoomControl={false}
            >
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
              <MapContent
                bounds={bounds}
                drawnBox={drawnBox}
                setDrawnBox={setDrawnBox}
                deformationData={results?.sample || []}
              />
            </MapContainer>
          </div>

          {results && results.sample.length > 0 && (
            <div
              className="data-widget"
              style={{
                padding: "20px",
                background: "var(--color-bg-card)",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "16px",
                }}
              >
                <h3 style={{ fontSize: "1.1rem", color: "white", margin: 0 }}>
                  Muestra de Deformación (Δt = {results.dias} días)
                </h3>
                {deformationCsvUrl && (
                  <a
                    href={deformationCsvUrl}
                    download={`deformacion_${zipFile?.name.replace(".zip", "")}.csv`}
                    style={{
                      background: "linear-gradient(135deg, #10b981, #059669)",
                      color: "white",
                      padding: "8px 16px",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                      fontWeight: "bold",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>📊</span> Exportar 100% a Excel
                  </a>
                )}
              </div>

              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.85rem",
                    textAlign: "left",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.1)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      <th style={{ padding: "8px" }}>Latitud</th>
                      <th style={{ padding: "8px" }}>Longitud</th>
                      <th style={{ padding: "8px" }}>Deformación (mm)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.sample
                      .slice(0, 50)
                      .map((row: { lat: number; lon: number; def: number }, idx: number) => {
                        let textColor = "white";
                        if (row.def < -5) textColor = "#fca5a5";
                        else if (row.def > 5) textColor = "#93c5fd";
                        else textColor = "#d1d5db";

                        return (
                          <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                            <td style={{ padding: "8px", color: "var(--color-text-muted)" }}>
                              {row.lat.toFixed(6)}
                            </td>
                            <td style={{ padding: "8px", color: "var(--color-text-muted)" }}>
                              {row.lon.toFixed(6)}
                            </td>
                            <td
                              style={{ padding: "8px", color: textColor, fontWeight: "bold" }}
                            >
                              {row.def > 0 ? "+" : ""}
                              {row.def.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                {results.sample.length > 50 && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "12px",
                      color: "var(--color-text-muted)",
                      fontSize: "0.8rem",
                      fontStyle: "italic",
                    }}
                  >
                    Mostrando solo las primeras 50 observaciones. Exporta a Excel para ver el
                    dataset completo.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
