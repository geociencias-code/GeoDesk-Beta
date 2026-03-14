import { useState, useEffect } from "react";
import JSZip from "jszip";
import { API_URL } from "../../services/api";
import axios from "axios";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, FeatureGroup, useMap, Rectangle } from "react-leaflet";
import { EditControl } from "react-leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";

if (typeof window !== "undefined") {
  (window as unknown as Window & { type: string }).type = "";
}

type BoundsType = {
  lat_min: number;
  lon_min: number;
  lat_max: number;
  lon_max: number;
};

type DrawEvent = {
  layer: L.Rectangle | L.Polygon | L.Circle | L.CircleMarker | L.Marker | L.Polyline;
};

function MapContent({
                      bounds,
                      drawnBox,
                      setDrawnBox }:
                    { bounds: BoundsType | null,
                      drawnBox: BoundsType | null,
                      setDrawnBox: (box: BoundsType | null) => void
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
      lon_max: leafBounds.getEast()
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
            [bounds.lat_max, bounds.lon_max]
          ]} 
          pathOptions={{ color: '#3b82f6', weight: 2, fillOpacity: 0.1, dashArray: '5, 5' }} 
        />
      )}
      {drawnBox && (
        <Rectangle 
          bounds={[
            [drawnBox.lat_min, drawnBox.lon_min],
            [drawnBox.lat_max, drawnBox.lon_max]
          ]} 
          pathOptions={{ color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.2 }} 
        />
      )}
    </FeatureGroup>
  );
}

export default function AlaskaProcesamiento() {
  // Estados principales
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [bounds, setBounds] = useState<{lat_min: number, lon_min: number, lat_max: number, lon_max: number} | null>(null);
  
  // Estados de recorte y dibujo
  const [drawnBox, setDrawnBox] = useState<{lat_min: number, lon_min: number, lat_max: number, lon_max: number} | null>(null);
  const [croppedZipUrl, setCroppedZipUrl] = useState<string | null>(null);
  const [croppedFileName, setCroppedFileName] = useState<string>("");

  // Estados de cálculo de velocidad
  const [velocityData, setVelocityData] = useState<Array<{ lat: number; lon: number; vel:number }>>([]);
  const [velocityDias, setVelocityDias] = useState<number>(0);
  const [velocityCsvUrl, setVelocityCsvUrl] = useState<string | null>(null);

  const handleZipFile = async (file: File) => {
    setZipFile(file);
    setBusy(true);
    setMessage("⏳ Leyendo extensión del archivo...");
    setBounds(null);
    setDrawnBox(null);
    setCroppedZipUrl(null);
    setVelocityData([]);
    setVelocityCsvUrl(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await axios.post(`${API_URL}/api/v1/alaska/preview`, formData);
      if (res.data.success) {
        setBounds(res.data.bounds);
        setMessage("✅ Extensión leída correctamente. Dibuja un rectángulo en el mapa para recortar.");
      }
    } catch (error: unknown) {
      console.error(error);
      const msg = axios.isAxiosError(error) ? error.response?.data?.detail : String(error);
      setMessage("❌ Error leyendo ZIP: " + msg);
    } finally {
      setBusy(false);
    }
  };

  const handleCrop = async () => {
    if (!zipFile || !drawnBox) return;

    setBusy(true);
    setMessage("✂️ Recortando rásteres. Por favor espera...");
    try {
      const formData = new FormData();
      formData.append("file", zipFile);
      
      const res = await axios.post(
        `${API_URL}/api/v1/alaska/crop?lat_min=${drawnBox.lat_min}&lon_min=${drawnBox.lon_min}&lat_max=${drawnBox.lat_max}&lon_max=${drawnBox.lon_max}`,
        formData,
        { responseType: 'blob' }
      );

      const url = window.URL.createObjectURL(new Blob([res.data]));
      setCroppedZipUrl(url);
      setCroppedFileName(`cropped_${zipFile.name}`);
      setMessage("✅ Archivos recortados exitosamente.");
    } catch(error) {
      console.error(error);
      setMessage("Error recortando imágenes.");
    } finally {
      setBusy(false);
    }
  };

  const handleCalculateVelocity = async () => {
    if (!croppedZipUrl || !zipFile) return;

    setBusy(true);
    setMessage("📈 Procesando fase y calculando vector de velocidad anual...");
    try {
      // Necesitamos re-descargar el blob recortado para enviarlo al backend de velocity (o usar el origin File pero queremos la porcion chica)
      const blobRes = await fetch(croppedZipUrl);
      const blob = await blobRes.blob();
      
      const formData = new FormData();
      formData.append("file", blob, `cropped_${zipFile.name}`);

      const res = await axios.post(`${API_URL}/api/v1/alaska/velocity`, formData, { responseType: 'blob' });
      
      // La respuesta es un ZIP conteniendo el CSV + JSON (Muestra UI)
      const zipInstance = await JSZip.loadAsync(res.data);
      
      // 1. Extraer JSON UI
      const uiDataStr = await zipInstance.file("ui_data.json")?.async("string");
      if (uiDataStr) {
        const uiData = JSON.parse(uiDataStr);
        setVelocityData(uiData.sample);
        setVelocityDias(uiData.dias);
      }

      // 2. Extraer CSV blob url para descarga (manteniendo el archivo en RAM client side)
      const csvFile = Object.values(zipInstance.files).find(f => f.name.endsWith(".csv"));
      if (csvFile) {
        const csvBlob = await csvFile.async("blob");
        setVelocityCsvUrl(window.URL.createObjectURL(csvBlob));
      }
      
      setMessage("✅ Velocidad calculada de manera exitosa.");

    } catch (error) {
      console.error(error);
      setMessage("❌ Ocurrió un error al calcular la velocidad.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-container" style={{ padding: 0 }}>
      {/* Header */}
      <div className="header-section">
        <div className="icon-wrapper">
          <span style={{ fontSize: "1.5rem" }}>✂️</span>
        </div>
        <div>
          <h1 style={{ background: "linear-gradient(90deg, #8b5cf6, #3b82f6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Recorte y Velocidad SNAP
          </h1>
          <p>Extrae regiones de interés de productos HyP3 y deriva modelos de velocidad</p>
        </div>
      </div>

      <div className="layout-grid">
        {/* Left Panel: Controles Principales */}
        <div className="upload-panel">
          <div className="upload-card">
            <label style={{ color: "var(--color-primary)", fontWeight: "bold", marginBottom: "8px", display: "inline-block" }}>
              1. Cargar Proyecto InSAR (.zip)
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
                {zipFile ? (
                   <span className="selected-file text-center" style={{ color: "var(--color-text-main)" }}>
                     {zipFile.name}
                   </span>
                ) : (
                  <>
                    <span className="flex-1 text-center" style={{ color: "var(--color-text-muted)" }}>📂 Selecciona archivo .zip</span>
                    <span style={{ fontSize: "0.80rem", color: "var(--color-text-muted)", opacity: 0.7 }}>Extrae georreferencia</span>
                  </>
                )}
              </div>
            </div>

            {drawnBox && !croppedZipUrl && (
              <div style={{ marginTop: "16px", padding: "12px", background: "rgba(0,0,0,0.2)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)" }}>
                <label style={{ color: "var(--color-primary)", fontWeight: "bold", fontSize: "0.85rem", display: "block", marginBottom: "8px" }}>
                  Coordenadas de Selección Exactas
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Lat Mín (Sur)</span>
                    <input type="number" step="any" value={drawnBox.lat_min} onChange={e => setDrawnBox({...drawnBox, lat_min: parseFloat(e.target.value) || 0})} style={{ width: "100%", boxSizing: "border-box", padding: "6px", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.05)", color: "white", fontSize: "0.80rem" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Lat Máx (Norte)</span>
                    <input type="number" step="any" value={drawnBox.lat_max} onChange={e => setDrawnBox({...drawnBox, lat_max: parseFloat(e.target.value) || 0})} style={{ width: "100%", boxSizing: "border-box", padding: "6px", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.05)", color: "white", fontSize: "0.80rem" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Lon Mín (Oeste)</span>
                    <input type="number" step="any" value={drawnBox.lon_min} onChange={e => setDrawnBox({...drawnBox, lon_min: parseFloat(e.target.value) || 0})} style={{ width: "100%", boxSizing: "border-box", padding: "6px", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.05)", color: "white", fontSize: "0.80rem" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Lon Máx (Este)</span>
                    <input type="number" step="any" value={drawnBox.lon_max} onChange={e => setDrawnBox({...drawnBox, lon_max: parseFloat(e.target.value) || 0})} style={{ width: "100%", boxSizing: "border-box", padding: "6px", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.05)", color: "white", fontSize: "0.80rem" }} />
                  </div>
                </div>
              </div>
            )}

            {bounds && !croppedZipUrl && (
              <button
                 onClick={handleCrop}
                 disabled={busy || !drawnBox}
                 className="submit-btn"
                 style={{ background: "linear-gradient(135deg, #3b82f6, #06b6d4)", marginTop: "16px" }}
              >
                 {busy ? "Procesando recorte..." : "Recortar Selección"}
              </button>
            )}

            {croppedZipUrl && (
              <div style={{ marginTop: "16px", display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <a
                  href={croppedZipUrl}
                  download={croppedFileName}
                  className="submit-btn"
                  style={{ display: "block", textAlign: "center", textDecoration: "none", background: "rgba(16, 185, 129, 0.2)", border: "1px solid #10b981", color: "#34d399", padding: "10px", borderRadius: "8px" }}
                >
                  ⬇️ Descargar Recorte ZIP
                </a>
                
                <hr style={{ borderColor: "rgba(255,255,255,0.1)", margin: "8px 0" }} />
                
                <label style={{ color: "var(--color-primary)", fontWeight: "bold", fontSize: "0.9rem" }}>
                  2. Estimación de Desplazamiento
                </label>
                <button
                  onClick={handleCalculateVelocity}
                  disabled={busy}
                  className="submit-btn"
                  style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)" }}
                >
                  {busy ? "Calculando..." : "Derivar Velocidad de Fase"}
                </button>
              </div>
            )}
            
            {message && (
              <div style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", textAlign: "center", fontSize: "0.85rem", color: message.includes('❌') ? "#ffb4b4" : "var(--color-text-muted)" }}>
                {message}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Mapa Interactivo */}
        <div className="results-panel" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          
          <div className="data-widget" style={{ padding: "0", display: "flex", flexDirection: "column", height: "500px", borderRadius: "12px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
            <MapContainer 
              center={[13.69, -89.22]} 
              zoom={8} 
              style={{ height: '100%', width: '100%', background: "#1a1a1a" }}
              zoomControl={false}
            >
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
              <MapContent bounds={bounds} drawnBox={drawnBox} setDrawnBox={setDrawnBox} />
            </MapContainer>
          </div>

          {/* Tabla de Resultados Velocidad */}
          {velocityData.length > 0 && (
             <div className="data-widget" style={{ padding: "20px", background: "var(--color-bg-card)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
               <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                 <h3 style={{ fontSize: "1.1rem", color: "white", margin: 0 }}>Muestra de Velocidad (Δt = {velocityDias} días)</h3>
                 {velocityCsvUrl && (
                   <a
                     href={velocityCsvUrl}
                     download={`velocidad_${zipFile?.name.replace('.zip', '')}.csv`}
                     style={{
                       background: "linear-gradient(135deg, #10b981, #059669)",
                       color: "white", padding: "8px 16px", borderRadius: "6px",
                       fontSize: "0.85rem", fontWeight: "bold", textDecoration: "none",
                       display: "inline-flex", alignItems: "center", gap: "6px"
                     }}
                   >
                     <span>📊</span> Exportar 100% a Excel
                   </a>
                 )}
               </div>

               <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "var(--color-text-muted)" }}>
                        <th style={{ padding: "8px" }}>Latitud</th>
                        <th style={{ padding: "8px" }}>Longitud</th>
                        <th style={{ padding: "8px" }}>Velocidad Anual (mm/yr)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {velocityData.slice(0, 50).map((row, idx) => {
                         // Color mapping para velocidad: rojo es hundimiento, azul elevacion
                         let textColor = "white";
                         if (row.vel < -5) textColor = "#fca5a5"; // Rojo
                         else if (row.vel > 5) textColor = "#93c5fd"; // Azul
                         else textColor = "#d1d5db"; // Gris/Estable

                         return (
                           <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                             <td style={{ padding: "8px", color: "var(--color-text-muted)" }}>{row.lat.toFixed(6)}</td>
                             <td style={{ padding: "8px", color: "var(--color-text-muted)" }}>{row.lon.toFixed(6)}</td>
                             <td style={{ padding: "8px", color: textColor, fontWeight: "bold" }}>
                               {row.vel > 0 ? "+" : ""}{row.vel.toFixed(2)}
                             </td>
                           </tr>
                         );
                      })}
                    </tbody>
                  </table>
                  {velocityData.length > 50 && (
                     <div style={{ textAlign: "center", padding: "12px", color: "var(--color-text-muted)", fontSize: "0.8rem", fontStyle: "italic" }}>
                        Mostrando solo las primeras 50 observaciones. Exporta a Excel para ver el dataset completo.
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
