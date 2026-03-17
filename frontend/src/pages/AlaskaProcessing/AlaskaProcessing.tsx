import { useState, useEffect } from "react";
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

function MapContent({
                      bounds,
                      drawnBox,
                      setDrawnBox,
                      deformationData = [] }:
                    { bounds: BoundsType | null,
                      drawnBox: BoundsType | null,
                      setDrawnBox: (box: BoundsType | null) => void,
                      deformationData?: Array<{ lat: number, lon: number, def: number }>
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
      {deformationData.map((pt, i) => {
        return (
          <CircleMarker 
            key={i} 
            center={[pt.lat, pt.lon]} 
            radius={3}
            pathOptions={{ 
              fillColor: pt.def > 0 ? '#ff4b4b' : '#4caf50',
              color: pt.def > 0 ? '#ff4b4b' : '#4caf50',
              weight: 1,
              opacity: 0.8,
              fillOpacity: 0.6
            }}
          >
            <Tooltip>
              <span>Def: {pt.def.toFixed(2)} mm</span>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </FeatureGroup>
  );
}

export default function AlaskaProcesamiento() {
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [bounds, setBounds] = useState<{lat_min: number, lon_min: number, lat_max: number, lon_max: number} | null>(null);

  const [drawnBox, setDrawnBox] = useState<{lat_min: number, lon_min: number, lat_max: number, lon_max: number} | null>(null);
  const [croppedZipUrl, setCroppedZipUrl] = useState<string | null>(null);
  const [croppedFileName, setCroppedFileName] = useState<string>("");

  const [results, setResults] = useState<DeformationResults | null>(null);
  const [deformationCsvUrl, setDeformationCsvUrl] = useState<string | null>(null);
  const [deformationCsvBlob, setDeformationCsvBlob] = useState<Blob | null>(null);
  const [era5File, setEra5File] = useState<File | null>(null);
  const [filterBusy, setFilterBusy] = useState(false);
  const [isFiltered, setIsFiltered] = useState(false);

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
    setIsFiltered(false);
    setEra5File(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await axios.post(`${API_URL}/api/v1/alaska/preview`, formData);
      if (res.data.success) {
        setBounds(res.data.bounds);
        setMessage("Extensión leída correctamente. Dibuja un rectángulo en el mapa para recortar.");
      }
    } catch (error: unknown) {
      console.error(error);
      const msg = axios.isAxiosError(error) ? error.response?.data?.detail : String(error);
      setMessage("Error leyendo ZIP: " + msg);
    } finally {
      setBusy(false);
    }
  };

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
        { responseType: 'blob' }
      );

      const url = window.URL.createObjectURL(new Blob([res.data]));
      setCroppedZipUrl(url);
      setCroppedFileName(`cropped_${zipFile.name}`);
      setMessage("Archivos recortados exitosamente.");
    } catch(error) {
      console.error(error);
      setMessage("Error recortando imágenes.");
    } finally {
      setBusy(false);
    }
  };

  const handleCalculateDeformation = async () => {
    if (!croppedZipUrl || !zipFile) return;

    setBusy(true);
    setMessage("Procesando fase y calculando vector de deformación anual...");
    try {
      const blobRes = await fetch(croppedZipUrl);
      const blob = await blobRes.blob();
      
      const formData = new FormData();
      formData.append("file", blob, `cropped_${zipFile.name}`);

      const res = await axios.post(`${API_URL}/api/v1/alaska/velocity`, formData, { responseType: 'blob' }); // Endpoint still 'velocity'

      const zipInstance = await JSZip.loadAsync(res.data);

      const uiDataStr = await zipInstance.file("ui_data.json")?.async("string");
      if (uiDataStr) {
        const parsedData: DeformationResults = JSON.parse(uiDataStr);
        setResults(parsedData);
      }

      const csvFile = Object.values(zipInstance.files).find(f => f.name.endsWith(".csv"));
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

  const handleApplyFilter = async () => {
    if (!deformationCsvBlob || !era5File || !results?.start_date || !results?.end_date) return;

    setFilterBusy(true);
    setMessage("Aplicando corrección ERA5 (esto puede tomar unos segundos)...");
    
    try {
      const formData = new FormData();
      formData.append("csv_file", deformationCsvBlob, `deformacion_${zipFile?.name.replace('.zip', '')}.csv`);
      formData.append("nc_file", era5File, era5File.name);
      formData.append("start_date", results.start_date);
      formData.append("end_date", results.end_date);

      const res = await axios.post(`${API_URL}/api/v1/alaska/apply_era5_filter`, formData, { responseType: 'blob' });
      
      const zipInstance = await JSZip.loadAsync(res.data);
      
      const uiDataFile = Object.values(zipInstance.files).find(f => f.name.endsWith("ui_data.json"));
      if (uiDataFile) {
        const uiDataStr = await uiDataFile.async("string");
        const parsedData: DeformationResults = JSON.parse(uiDataStr);
        setResults(parsedData);
      }
      
      const csvFile = Object.values(zipInstance.files).find(f => f.name.endsWith(".csv"));
      if (csvFile) {
        const csvBlob = await csvFile.async("blob");
        setDeformationCsvUrl(window.URL.createObjectURL(csvBlob));
        setDeformationCsvBlob(csvBlob);
      }
      
      setIsFiltered(true);
      setMessage("✅ Filtro ERA5 aplicado con éxito.");
      
    } catch (error) {
      console.error(error);
      setMessage("❌ Ocurrió un error al aplicar el filtro ERA5.");
    } finally {
      setFilterBusy(false);
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
            Recorte y Deformación SNAP
          </h1>
          <p>Extrae regiones de interés de productos HyP3 y deriva modelos de deformación</p>
        </div>
      </div>

      <div className="layout-grid">
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
              <div style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", textAlign: "center", fontSize: "0.85rem", color: message.includes('❌') ? "#ffb4b4" : "var(--color-text-muted)" }}>
                {message}
              </div>
            )}
            
            {results && deformationCsvBlob && !isFiltered && (
              <div style={{ marginTop: "24px", padding: "12px", borderRadius: "8px", background: "rgba(59, 130, 246, 0.1)", border: "1px solid rgba(59, 130, 246, 0.3)" }}>
                <label style={{ color: "#93c5fd", fontWeight: "bold", fontSize: "0.9rem", display: "block", marginBottom: "8px" }}>
                  3. Corrección Atmosférica (Opcional)
                </label>
                <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginBottom: "12px" }}>
                  Sube un archivo ERA5 (.nc) que cubra el rango de fechas para mitigar errores por retardo troposférico (PWV y T).
                </p>
                
                <input
                  type="file"
                  accept=".nc"
                  onChange={e => setEra5File(e.target.files?.[0] || null)}
                  style={{ marginBottom: "12px", fontSize: "0.8rem", color: "white" }}
                />
                
                <button
                  onClick={handleApplyFilter}
                  disabled={filterBusy || !era5File}
                  className="submit-btn"
                  style={{ background: "linear-gradient(135deg, #10b981, #059669)", width: "100%", opacity: (!era5File || filterBusy) ? 0.5 : 1 }}
                >
                  {filterBusy ? "Aplicando Filtro..." : "Aplicar Filtro ERA5"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="results-panel" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          
          <div className="data-widget" style={{ padding: "0", display: "flex", flexDirection: "column", height: "500px", borderRadius: "12px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
            <MapContainer 
              center={[13.69, -89.22]} 
              zoom={8} 
              style={{ height: '100%', width: '100%', background: "#1a1a1a" }}
              zoomControl={false}
            >
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
              <MapContent bounds={bounds} drawnBox={drawnBox} setDrawnBox={setDrawnBox} deformationData={results?.sample || []} />
            </MapContainer>
          </div>

          {results && results.sample.length > 0 && (
             <div className="data-widget" style={{ padding: "20px", background: "var(--color-bg-card)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
               <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                 <h3 style={{ fontSize: "1.1rem", color: "white", margin: 0 }}>
                   Muestra de Deformación (Δt = {results.dias} días)
                   {isFiltered && <span style={{ marginLeft: "10px", fontSize: "0.8rem", background: "#059669", padding: "2px 6px", borderRadius: "4px" }}>ERA5 Filtrado</span>}
                 </h3>
                 {deformationCsvUrl && (
                   <a
                     href={deformationCsvUrl}
                     download={isFiltered ? `filtered_deformacion_${zipFile?.name.replace('.zip', '')}.csv` : `deformacion_${zipFile?.name.replace('.zip', '')}.csv`}
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
                        <th style={{ padding: "8px" }}>Deformación (mm)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.sample.slice(0, 50).map((row: { lat: number, lon: number, def: number }, idx: number) => {
                         // rojo es hundimiento, azul elevacion
                         let textColor = "white";
                         if (row.def < -5) textColor = "#fca5a5"; // subsidence (negative deformation)
                         else if (row.def > 5) textColor = "#93c5fd"; // uplift (positive deformation)
                         else textColor = "#d1d5db";

                         return (
                           <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                             <td style={{ padding: "8px", color: "var(--color-text-muted)" }}>{row.lat.toFixed(6)}</td>
                             <td style={{ padding: "8px", color: "var(--color-text-muted)" }}>{row.lon.toFixed(6)}</td>
                             <td style={{ padding: "8px", color: textColor, fontWeight: "bold" }}>
                               {row.def > 0 ? "+" : ""}{row.def.toFixed(2)}
                             </td>
                           </tr>
                         );
                      })}
                    </tbody>
                  </table>
                  {results.sample.length > 50 && (
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
