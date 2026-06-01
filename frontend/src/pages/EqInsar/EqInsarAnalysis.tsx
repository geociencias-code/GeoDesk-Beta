import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import { API_URL } from "../../services/api";
import EpicenterMap from "./EpicenterMap";

// ── Type Definitions ──────────────────────────────────────────────────────
interface EqInsarParams {
  Mw: number;
  depth_km: number;
  strike_deg: number;
  dip_deg: number;
  rake_deg: number;
  xcen_km: number;
  ycen_km: number;
  grid_size: number;
  grid_extent_km: number;
  satellite: string;
  orbit: string;
  incidence_deg?: number;
  heading_deg?: number;
  wavelength_m?: number;
  add_noise: boolean;
  noise_amplitude_m: number;
  add_orbital_ramp: boolean;
  wrap: boolean;
  nu: number;
  seed?: number;
}

interface TimeseriesParams extends EqInsarParams {
  n_pre: number;
  n_event: number;
  n_post: number;
  output_type: string;
}

interface EqInsarResult {
  metadata: Record<string, unknown>;
  images: Record<string, string>;
  statistics: Record<string, Record<string, number>>;
}

interface TimeseriesResult {
  n_frames: number;
  frames: string[];
  labels: string[];
  frame_labels: string[];
  n_pre: number;
  n_event: number;
}

interface BatchResult {
  n_samples: number;
  n_frames_per_sample: number;
  array_shape_X: number[];
  array_shape_y: number[];
  mw_statistics?: {
    min: number;
    max: number;
    mean: number;
    std: number;
  };
  preview_images: string[];
}


const card: React.CSSProperties = {
  background:"rgba(255,255,255,0.04)",
  border:"1px solid rgba(255,255,255,0.1)",
  borderRadius:14,
  padding:20,
  marginBottom:16,
};

const inputStyle: React.CSSProperties = {
  width:"100%", boxSizing:"border-box", padding:"8px 10px",
  borderRadius:8, border:"1px solid rgba(255,255,255,0.15)",
};

const label: React.CSSProperties = {
  display:"block", fontSize:"0.78rem", color:"#94a3b8", marginBottom:4, marginTop:10,
};

const btn = (): React.CSSProperties => ({
  padding:"10px 22px", borderRadius:10, border:"none", cursor:"pointer",
  background:"linear-gradient(135deg,#7c3aed,#4f46e5)",
  color:"white", fontWeight:600, fontSize:"0.9rem", marginTop:12,
  transition:"opacity 0.2s",
});

const sectionTitle: React.CSSProperties = {
  fontSize:"0.8rem", fontWeight:700, letterSpacing:"0.08em",
  color:"#7dd3fc", textTransform:"uppercase", marginBottom:10, marginTop:4,
};

// ── Generic field helpers ──────────────────────────────────────────────────
/**
 * NumField usa un string interno (raw) para que el usuario pueda:
 *   - Borrar todos los dígitos (campo vacío)
 *   - Escribir el signo negativo antes del número ("-85")
 *   - Escribir decimales ("-0.05")
 * Solo llama a onChange cuando el texto es un número válido.
 */
function NumField({
  label: lbl,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const [raw, setRaw] = useState<string>(
    value !== undefined ? String(value) : ""
  );
  const prevVal = useRef(value);

  // Sincronizar raw ← padre SOLO cuando:
  //   1. El padre cambia a un número concreto (no undefined/mid-edit)
  //   2. El raw actual no representa ya ese mismo número
  //      (evita machacar "14.0" → "14" o "14.06" mientras el usuario escribe)
  useEffect(() => {
    if (prevVal.current === value) return;
    prevVal.current = value;

    // Si el padre manda undefined (estado intermedio propio), no tocar raw
    if (value === undefined) return;

    // Si el raw ya parsea al mismo valor, no tocar (preserva ceros intermedios)
    const parsedRaw = parseFloat(raw);
    if (!isNaN(parsedRaw) && parsedRaw === value) return;

    // Sincronizar
    setRaw(String(value));
  }, [value, raw]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const str = e.target.value;
    setRaw(str);
    // Estados intermedios: vacío, "-", ".", "-.", terminan en "."
    if (
      str === "" ||
      str === "-" ||
      str === "." ||
      str === "-." ||
      str.endsWith(".")
    ) {
      onChange(undefined);
      return;
    }
    const n = parseFloat(str);
    if (!isNaN(n)) {
      onChange(n);
    }
    // Si no es parseable, dejamos el raw visible pero no actualizamos al padre
  };

  const isInvalid =
    raw !== "" &&
    raw !== "-" &&
    raw !== "." &&
    raw !== "-." &&
    !raw.endsWith(".") &&
    isNaN(parseFloat(raw));

  return (
    <div>
      <span style={label}>{lbl}</span>
      <input
        type="text"
        inputMode="decimal"
        value={raw}
        placeholder="0"
        onChange={handleChange}
        style={{
          ...inputStyle,
          border: `1px solid ${
            isInvalid ? "rgba(239,68,68,0.7)" : "rgba(255,255,255,0.15)"
          }`,
        }}
      />
    </div>
  );
}

function ToggleField({label:lbl, value, onChange}:{label:string,value:boolean,onChange:(v:boolean)=>void}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,marginTop:10}}>
      <span style={{...label,marginTop:0,marginBottom:0}}>{lbl}</span>
      <button onClick={()=>onChange(!value)} style={{
        padding:"4px 14px", borderRadius:20, border:"none", cursor:"pointer",
        background: value ? "#7c3aed" : "rgba(255,255,255,0.1)",
        color: value ? "white" : "#94a3b8", fontSize:"0.8rem", fontWeight:600,
      }}>{value ? "Sí" : "No"}</button>
    </div>
  );
}

function InSARImage({b64, title, stats}:{b64:string,title:string,stats?:Record<string,number>}) {
  return (
    <div style={{background:"rgba(0,0,0,0.3)",borderRadius:12,padding:12,textAlign:"center"}}>
      <p style={{margin:"0 0 6px",fontWeight:600,fontSize:"0.82rem",color:"#93c5fd"}}>{title}</p>
      <img src={`data:image/png;base64,${b64}`} alt={title}
        style={{width:"100%",borderRadius:8,display:"block"}} />
      {stats && (
        <div style={{marginTop:6,fontSize:"0.72rem",color:"#64748b",textAlign:"left"}}>
          {Object.entries(stats).map(([k,v])=>(
            <span key={k} style={{marginRight:10}}>{k}: <b style={{color:"#94a3b8"}}>{v.toFixed(4)}</b></span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Epicenter map state passed down from parent tab ──────────────────────────
interface FaultFormProps {
  p: Partial<EqInsarParams>;
  set: (x: Partial<EqInsarParams>) => void;
  showNoiseControls?: boolean;
  satellites?: string[];
  // geo location
  epicLat: number | undefined;
  epicLon: number | undefined;
  onEpicLatChange: (v: number | undefined) => void;
  onEpicLonChange: (v: number | undefined) => void;
  onShowMap: () => void;
}

function FaultForm({
  p, set, showNoiseControls=true, satellites=[],
  epicLat, epicLon, onEpicLatChange, onEpicLonChange, onShowMap,
}: FaultFormProps) {
  const safeSatellites = Array.isArray(satellites) ? satellites : [];
  const canShowMap = epicLat !== undefined && epicLon !== undefined
    && !isNaN(epicLat) && !isNaN(epicLon);

  return (
    <>
      {/* ── Ubicación geográfica ─────────────────────────────── */}
      <p style={sectionTitle}>📍 Ubicación del Epicentro</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <NumField
          label="Latitud (°)"
          value={epicLat}
          onChange={onEpicLatChange}
        />
        <NumField
          label="Longitud (°)"
          value={epicLon}
          onChange={onEpicLonChange}
        />
      </div>
      <button
        style={{
          ...btn(),
          marginTop: 10,
          width: "100%",
          background: canShowMap
            ? "linear-gradient(135deg,#dc2626,#ea580c)"
            : "rgba(255,255,255,0.07)",
          color: canShowMap ? "white" : "#64748b",
          cursor: canShowMap ? "pointer" : "not-allowed",
          fontSize: "0.85rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
        onClick={canShowMap ? onShowMap : undefined}
        disabled={!canShowMap}
        title={canShowMap ? "Actualizar mapa" : "Ingresa latitud y longitud válidas"}
      >
        🗺️ Ver en mapa
      </button>

      {/* ── Parámetros físicos ───────────────────────────────── */}
      <p style={{...sectionTitle, marginTop:16}}>Parámetros del Sismo</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <NumField label="Magnitud Mw" value={p.Mw} onChange={v=>set({...p,Mw:v??p.Mw})}/>
        <NumField label="Profundidad (km)" value={p.depth_km} onChange={v=>set({...p,depth_km:v??p.depth_km})}/>
        <NumField label="Rumbo Strike (°)" value={p.strike_deg} onChange={v=>set({...p,strike_deg:v??p.strike_deg})}/>
        <NumField label="Buzamiento Dip (°)" value={p.dip_deg} onChange={v=>set({...p,dip_deg:v??p.dip_deg})}/>
        <NumField label="Deslizamiento Rake (°)" value={p.rake_deg} onChange={v=>set({...p,rake_deg:v??p.rake_deg})}/>
        <NumField label="Epicentro X (km)" value={p.xcen_km} onChange={v=>set({...p,xcen_km:v??p.xcen_km})}/>
        <NumField label="Epicentro Y (km)" value={p.ycen_km} onChange={v=>set({...p,ycen_km:v??p.ycen_km})}/>
      </div>
      <p style={sectionTitle}>Grilla</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <NumField label="Tamaño grilla (px)" value={p.grid_size} onChange={v=>set({...p,grid_size:Math.round(v??(p.grid_size??128))})}/>
        <NumField label="Extensión (km)" value={p.grid_extent_km} onChange={v=>set({...p,grid_extent_km:v??(p.grid_extent_km??50)})}/>
      </div>
      <p style={sectionTitle}>Satélite InSAR</p>
      <span style={label}>Satélite</span>
      <select style={inputStyle} value={p.satellite} onChange={e=>set({...p,satellite:e.target.value})}>
        <option value="">— Manual —</option>
        {safeSatellites.map(s=><option key={s} value={s}>{s}</option>)}
      </select>
      <span style={label}>Órbita</span>
      <select style={inputStyle} value={p.orbit} onChange={e=>set({...p,orbit:e.target.value})}>
        <option value="ascending">Ascendente</option>
        <option value="descending">Descendente</option>
      </select>
      {!p.satellite && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          <NumField label="Incidencia (°)" value={p.incidence_deg??33} onChange={v=>set({...p,incidence_deg:v??(p.incidence_deg??33)})}/>
          <NumField label="Heading (°)" value={p.heading_deg??-13} onChange={v=>set({...p,heading_deg:v??(p.heading_deg??-13)})}/>
          <NumField label="Longitud de onda (m)" value={p.wavelength_m??0.05546} onChange={v=>set({...p,wavelength_m:v??(p.wavelength_m??0.05546)})}/>
        </div>
      )}
      <p style={sectionTitle}>Opciones Avanzadas</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {showNoiseControls && (
          <>
            <ToggleField label="Agregar ruido" value={p.add_noise??true} onChange={v=>set({...p,add_noise:v})}/>
            <ToggleField label="Rampa orbital" value={p.add_orbital_ramp??false} onChange={v=>set({...p,add_orbital_ramp:v})}/>
          </>
        )}
        <ToggleField label="Fase envuelta" value={p.wrap??true} onChange={v=>set({...p,wrap:v})}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:4}}>
        <NumField label="Amplitud ruido (m)" value={p.noise_amplitude_m} onChange={v=>set({...p,noise_amplitude_m:v??(p.noise_amplitude_m??0.005)})}/>
        <NumField label="Razón de Poisson ν" value={p.nu} onChange={v=>set({...p,nu:v??(p.nu??0.25)})}/>
        <NumField label="Semilla (seed)" value={p.seed??0} onChange={v=>set({...p,seed:v})}/>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Botón de exportación a Excel
// ══════════════════════════════════════════════════════════════════════════
function ExportXlsxButton({ params }: { params: Partial<EqInsarParams> }) {
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState("");

  const handleExport = async () => {
    setDownloading(true);
    setDlError("");
    try {
      const body = { ...params };
      if (body.satellite === undefined || body.satellite === "") {
        delete (body as Partial<Record<string, unknown>>).satellite;
      }

      const res = await fetch(`${API_URL}/api/eq_insar/export_xlsx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        setDlError(err.detail ?? res.statusText);
        return;
      }

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      // Nombre sugerido desde el header Content-Disposition, o genérico
      const cd   = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="?([^"]+)"?/);
      a.download = match ? match[1] : "eq_insar_data.xlsx";
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Error desconocido";
      setDlError(errorMessage);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleExport}
        disabled={downloading}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 18px", borderRadius: 8, border: "none",
          cursor: downloading ? "wait" : "pointer",
          background: downloading
            ? "rgba(34,197,94,0.3)"
            : "linear-gradient(135deg,#059669,#047857)",
          color: "white", fontWeight: 600, fontSize: "0.85rem",
          opacity: downloading ? 0.75 : 1,
          transition: "opacity 0.2s",
        }}
      >
        {downloading ? (
          <>⏳ Exportando...</>
        ) : (
          <>📥 Exportar a Excel (.xlsx)</>
        )}
      </button>
      {dlError && (
        <p style={{ color: "#f87171", fontSize: "0.78rem", marginTop: 4, maxWidth: 280 }}>
          ❌ {dlError}
        </p>
      )}
    </div>
  );
}

// TAB 1 Interferograma Individual

const defaultSingle = {
  Mw:6.0, depth_km:10, strike_deg:45, dip_deg:30, rake_deg:90,
  xcen_km:0, ycen_km:0, grid_size:128, grid_extent_km:50,
  satellite:"sentinel1", orbit:"ascending",
  add_noise:true, noise_amplitude_m:0.005, add_orbital_ramp:false,
  wrap:true, nu:0.25,
};

function TabSingle({satellites=[]}:{satellites?:string[]}) {
  const [p, setP] = useState<Partial<EqInsarParams>>(defaultSingle);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EqInsarResult | null>(null);
  const [error, setError] = useState("");

  // Geo epicenter state
  const [epicLat, setEpicLat] = useState<number | undefined>(undefined);
  const [epicLon, setEpicLon] = useState<number | undefined>(undefined);
  // Committed values shown on map (only update on button click)
  const [mapEpic, setMapEpic] = useState<{lat:number,lon:number} | null>(null);

  const handleShowMap = () => {
    if (epicLat !== undefined && epicLon !== undefined) {
      setMapEpic({ lat: epicLat, lon: epicLon });
    }
  };

  const run = async () => {
    setBusy(true); setError(""); setResult(null);
    try {
      const body = { ...p } as Record<string, unknown>;
      if (!body.satellite) delete body.satellite;
      const res = await axios.post(`${API_URL}/api/eq_insar/generate`, body);
      setResult(res.data);
    } catch(e) {
      const error = e instanceof Error ? e.message : "Error desconocido";
      setError(error);
    } finally { setBusy(false); }
  };

  return (
    <div style={{display:"grid",gridTemplateColumns:"340px 1fr",gap:20,alignItems:"start"}}>
      <div style={card}>
        <FaultForm
          p={p} set={setP} satellites={satellites}
          epicLat={epicLat} epicLon={epicLon}
          onEpicLatChange={setEpicLat}
          onEpicLonChange={setEpicLon}
          onShowMap={handleShowMap}
        />
        <button style={btn()} onClick={run} disabled={busy}>
          {busy ? "⏳ Generando..." : "🌍 Generar Interferograma"}
        </button>
        {error && <p style={{color:"#f87171",fontSize:"0.82rem",marginTop:8}}>❌ {error}</p>}
      </div>

      {/* Panel de resultados */}
      <div>
        {/* Mapa siempre visible en el panel derecho cuando hay coordenadas */}
        {mapEpic && (
          <div style={{marginBottom:16}}>
            <EpicenterMap
              lat={mapEpic.lat}
              lon={mapEpic.lon}
              gridExtentKm={p.grid_extent_km ?? 50}
              xcenKm={p.xcen_km ?? 0}
              ycenKm={p.ycen_km ?? 0}
              height="400px"
            />
          </div>
        )}

        {!result && !busy && !mapEpic && (
          <div style={{...card,textAlign:"center",padding:60,color:"#475569"}}>
            <div style={{fontSize:48,marginBottom:12}}>🌋</div>
            <p>Configura los parámetros del sismo y haz clic en "Generar".</p>
            <p style={{fontSize:"0.8rem",marginTop:8}}>Ingresa la latitud y longitud del epicentro para previsualizar la grilla en el mapa.</p>
          </div>
        )}
        {!result && !busy && mapEpic && (
          <div style={{...card,textAlign:"center",padding:20,color:"#475569",marginTop:0}}>
            <p style={{margin:0,fontSize:"0.85rem"}}>Haz clic en <b style={{color:"#a78bfa"}}>Generar Interferograma</b> para calcular los resultados.</p>
          </div>
        )}
        {result && (
          <>
            <div style={{...card,marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                <p style={{...sectionTitle,margin:0}}>Metadatos del Modelo</p>
                <ExportXlsxButton params={p}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginTop:10}}>
                {(
                  [
                    ["Mw", (result.metadata.Mw as number)?.toFixed(2)],
                    ["Strike", `${result.metadata.strike_deg}°`],
                    ["Dip", `${result.metadata.dip_deg}°`],
                    ["Rake", `${result.metadata.rake_deg}°`],
                    ["Profundidad", `${result.metadata.depth_km} km`],
                    ["Satélite", result.metadata.satellite],
                    ["Incidencia", `${(result.metadata.incidence_deg as number)?.toFixed(1)}°`],
                    ["λ (cm)", `${(((result.metadata.wavelength_m as number)??0)*100).toFixed(2)}`],
                  ] as [unknown, unknown][]
                ).map(([k,v])=>(
                  <div key={String(k)} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"8px 12px"}}>
                    <div style={{fontSize:"0.7rem",color:"#64748b"}}>{String(k)}</div>
                    <div style={{fontWeight:700,fontSize:"0.9rem",color:"#e2e8f0"}}>{String(v)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
              <InSARImage b64={(result.images as Record<string, string>).phase_wrapped} title="Fase Envuelta (con ruido)"
                stats={(result.statistics as Record<string, Record<string, number>>).phase_unwrapped}/>
              <InSARImage b64={(result.images as Record<string, string>).phase_unwrapped} title="Fase Desenvuelta (rad)"
                stats={(result.statistics as Record<string, Record<string, number>>).phase_unwrapped}/>
              <InSARImage b64={(result.images as Record<string, string>).los_displacement} title="Desplazamiento LOS (m)"
                stats={(result.statistics as Record<string, Record<string, number>>).los_displacement}/>
              <InSARImage b64={(result.images as Record<string, string>).displacement_east} title="Desplazamiento Este (m)"
                stats={(result.statistics as Record<string, Record<string, number>>).displacement_east}/>
              <InSARImage b64={(result.images as Record<string, string>).displacement_north} title="Desplazamiento Norte (m)"
                stats={(result.statistics as Record<string, Record<string, number>>).displacement_north}/>
              <InSARImage b64={(result.images as Record<string, string>).displacement_up} title="Desplazamiento Vertical (m)"
                stats={(result.statistics as Record<string, Record<string, number>>).displacement_up}/>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// TAB 2 Serie de Tiempo
const defaultTS = {
  ...defaultSingle, n_pre:5, n_event:1, n_post:5, output_type:"phase",
};

function TabTimeseries({satellites=[]}:{satellites?:string[]}) {
  const [p, setP] = useState<Partial<TimeseriesParams>>(defaultTS);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TimeseriesResult | null>(null);
  const [error, setError] = useState("");
  const [frameIdx, setFrameIdx] = useState(0);

  // Geo epicenter state
  const [epicLat, setEpicLat] = useState<number | undefined>(undefined);
  const [epicLon, setEpicLon] = useState<number | undefined>(undefined);
  const [mapEpic, setMapEpic] = useState<{lat:number,lon:number} | null>(null);

  const handleShowMap = () => {
    if (epicLat !== undefined && epicLon !== undefined) {
      setMapEpic({ lat: epicLat, lon: epicLon });
    }
  };

  const run = async () => {
    setBusy(true); setError(""); setResult(null); setFrameIdx(0);
    try {
      const body = {...p} as Record<string, unknown>;
      if (!body.satellite) delete body.satellite;
      const res = await axios.post(`${API_URL}/api/eq_insar/timeseries`, body);
      setResult(res.data);
    } catch(e) {
      const errorMsg = e instanceof Error ? e.message : "Error desconocido";
      setError(errorMsg);
    } finally { setBusy(false); }
  };

  return (
    <div style={{display:"grid",gridTemplateColumns:"340px 1fr",gap:20,alignItems:"start"}}>
      <div style={card}>
        <FaultForm
          p={p} set={setP} showNoiseControls={false} satellites={satellites}
          epicLat={epicLat} epicLon={epicLon}
          onEpicLatChange={setEpicLat}
          onEpicLonChange={setEpicLon}
          onShowMap={handleShowMap}
        />
        <p style={{...sectionTitle,marginTop:16}}>Configuración de Frames</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          <NumField label="Pre-sismo" value={p.n_pre} onChange={v=>setP({...p,n_pre:Math.round(v??(p.n_pre??5))})}/>
          <NumField label="Evento" value={p.n_event} onChange={v=>setP({...p,n_event:Math.round(v??(p.n_event??1))})}/>
          <NumField label="Post-sismo" value={p.n_post} onChange={v=>setP({...p,n_post:Math.round(v??(p.n_post??5))})}/>
        </div>
        <span style={label}>Tipo de salida</span>
        <select style={inputStyle} value={p.output_type} onChange={e=>setP({...p,output_type:e.target.value})}>
          <option value="phase">Fase (rad)</option>
          <option value="displacement">Desplazamiento (m)</option>
        </select>
        <button style={btn()} onClick={run} disabled={busy}>
          {busy ? "⏳ Generando..." : "📽️ Generar Serie de Tiempo"}
        </button>
        {error && <p style={{color:"#f87171",fontSize:"0.82rem",marginTop:8}}>❌ {error}</p>}
      </div>

      {/* Panel de resultados */}
      <div>
        {/* Mapa al tope del panel derecho */}
        {mapEpic && (
          <div style={{marginBottom:16}}>
            <EpicenterMap
              lat={mapEpic.lat}
              lon={mapEpic.lon}
              gridExtentKm={p.grid_extent_km ?? 50}
              xcenKm={p.xcen_km ?? 0}
              ycenKm={p.ycen_km ?? 0}
              height="380px"
            />
          </div>
        )}

        {result ? (
          <div style={card}>
            <p style={sectionTitle}>
              Frame {frameIdx+1} / {(result.n_frames as number)} — {(result.frame_labels as string[])?.[frameIdx]}
            </p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              <InSARImage b64={(result.frames as string[])[frameIdx]} title="Interferograma"/>
              <InSARImage b64={(result.labels as string[])[frameIdx]} title="Máscara de Deformación"/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <button disabled={frameIdx===0} onClick={()=>setFrameIdx(f=>f-1)}
                style={{...btn(),opacity:frameIdx===0?0.4:1,padding:"6px 16px",marginTop:0}}>◀ Anterior</button>
              <input type="range" min={0} max={(result.n_frames as number)-1} value={frameIdx}
                onChange={e=>setFrameIdx(parseInt(e.target.value))} style={{flex:1}}/>
              <button disabled={frameIdx===(result.n_frames as number)-1} onClick={()=>setFrameIdx(f=>f+1)}
                style={{...btn(),opacity:frameIdx===(result.n_frames as number)-1?0.4:1,padding:"6px 16px",marginTop:0}}>Siguiente ▶</button>
            </div>
            <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
              {(result.frame_labels as string[])?.map((lbl:string, i:number)=>(
                <button key={i} onClick={()=>setFrameIdx(i)} style={{
                  padding:"3px 10px", borderRadius:20, border:"none", cursor:"pointer", fontSize:"0.72rem",
                  background: i===frameIdx ? "#7c3aed" :
                    i < (result.n_pre as number) ? "rgba(239,68,68,0.2)" :
                    i < (result.n_pre as number)+(result.n_event as number) ? "rgba(234,179,8,0.3)" : "rgba(34,197,94,0.2)",
                  color: i===frameIdx ? "white" : "#94a3b8",
                }}>{lbl}</button>
              ))}
            </div>
          </div>
        ) : (
          !mapEpic && (
            <div style={{...card,textAlign:"center",padding:60,color:"#475569"}}>
              <div style={{fontSize:48,marginBottom:12}}>📡</div>
              <p>Genera una serie de tiempo para visualizar la secuencia pre/co/post-sismo.</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// TAB 3 Generación por Lotes
function TabBatch({satellites=[]}:{satellites?:string[]}) {
  const [p, setP] = useState({n_samples:50, mw_range:[5.0,7.0], satellite:"sentinel1", orbit:"ascending", seed:42});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState("");
  const safeSatellites = Array.isArray(satellites) ? satellites : [];

  const run = async () => {
    setBusy(true); setError(""); setResult(null);
    try {
      const res = await axios.post(`${API_URL}/api/eq_insar/batch`, p);
      setResult(res.data);
    } catch(e) {
      const errorMessage = e instanceof Error ? e.message : "Error desconocido";
      setError(errorMessage);
    } finally { setBusy(false); }
  };

  return (
    <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:20,alignItems:"start"}}>
      <div style={card}>
        <p style={sectionTitle}>Configuración del Lote</p>
        <NumField label="Número de muestras" value={p.n_samples} onChange={v=>setP({...p,n_samples:Math.round(v??p.n_samples)})}/>
        <span style={label}>Rango de Magnitud Mw</span>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <NumField label="Mw mínimo" value={p.mw_range[0]} onChange={v=>setP({...p,mw_range:[v??p.mw_range[0],p.mw_range[1]]})}/>
          <NumField label="Mw máximo" value={p.mw_range[1]} onChange={v=>setP({...p,mw_range:[p.mw_range[0],v??p.mw_range[1]]})}/>
        </div>
        <span style={label}>Satélite</span>
        <select style={inputStyle} value={p.satellite} onChange={e=>setP({...p,satellite:e.target.value})}>
          {safeSatellites.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <span style={label}>Órbita</span>
        <select style={inputStyle} value={p.orbit} onChange={e=>setP({...p,orbit:e.target.value})}>
          <option value="ascending">Ascendente</option>
          <option value="descending">Descendente</option>
        </select>
        <NumField label="Semilla (seed)" value={p.seed} onChange={v=>setP({...p,seed:Math.round(v??p.seed)})}/>
        <button style={btn()} onClick={run} disabled={busy}>
          {busy ? `⏳ Generando ${p.n_samples} muestras...` : "🔬 Generar Lote ML"}
        </button>
        {error && <p style={{color:"#f87171",fontSize:"0.82rem",marginTop:8}}>❌ {error}</p>}
      </div>
      <div>
        {result ? (
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
              {(
                [
                  ["Muestras", result.n_samples],
                  ["Frames/muestra", result.n_frames_per_sample],
                  ["Shape X", (result.array_shape_X as number[])?.join("×")],
                  ["Shape y", (result.array_shape_y as number[])?.join("×")],
                  ...(result.mw_statistics ? [
                    ["Mw mín", (result.mw_statistics as Record<string, number>).min?.toFixed(2)],
                    ["Mw máx", (result.mw_statistics as Record<string, number>).max?.toFixed(2)],
                    ["Mw media", (result.mw_statistics as Record<string, number>).mean?.toFixed(2)],
                    ["Mw σ", (result.mw_statistics as Record<string, number>).std?.toFixed(2)],
                  ] : []),
                ] as [unknown, unknown][]
              ).map(([k,v])=>(
                <div key={String(k)} style={{background:"rgba(0,0,0,0.3)",borderRadius:10,padding:"10px 14px"}}>
                  <div style={{fontSize:"0.7rem",color:"#64748b"}}>{String(k)}</div>
                  <div style={{fontWeight:700,fontSize:"0.95rem",color:"#e2e8f0"}}>{String(v)}</div>
                </div>
              ))}
            </div>
            {(result.preview_images as string[])?.length > 0 && (
              <div style={card}>
                <p style={sectionTitle}>Vista previa — Primeras {(result.preview_images as string[]).length} muestras</p>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
                  {(result.preview_images as string[]).map((b64:string, i:number)=>(
                    <InSARImage key={i} b64={b64} title={`Muestra ${i+1}`}/>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{...card,textAlign:"center",padding:60,color:"#475569"}}>
            <div style={{fontSize:48,marginBottom:12}}>🤖</div>
            <p>Genera un lote de interferogramas sintéticos aleatorios para entrenamiento ML.</p>
            <p style={{fontSize:"0.8rem",marginTop:8}}>Los arrays resultantes se pueden usar directamente como X, y en PyTorch/TensorFlow.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const TABS = [
  {id:"single", label:"🌍 Interferograma Individual"},
  {id:"timeseries", label:"📽️ Serie de Tiempo"},
  {id:"batch", label:"🤖 Lote para ML"},
];

export default function EqInsarAnalysis() {
  const [tab, setTab] = useState("single");
  const [satellites, setSatellites] = useState<string[]>([]);

  useEffect(() => {
    const fetchSatellites = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/eq_insar/satellites`);
        setSatellites(res.data.satellites || []);
      } catch (err) {
        console.error("Error cargando satélites:", err);
        setSatellites([]);
      }
    };
    fetchSatellites();
  }, []);

  return (
    <div style={{
      minHeight:"100vh",
      background:"linear-gradient(135deg,#0a0f1e 0%,#0d1b2a 50%,#0a1628 100%)",
      color:"white", fontFamily:"'Inter',sans-serif", padding:24,
    }}>
      {/* Header */}
      <div style={{marginBottom:28}}>
        <h1 style={{
          fontSize:"1.8rem", fontWeight:700, margin:0, marginBottom:6,
          background:"linear-gradient(135deg,#f87171,#fb923c,#fbbf24)",
          WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
        }}>
          EQ-INSAR — Interferogramas Sintéticos de Sismo
        </h1>
        <p style={{color:"#94a3b8",fontSize:"0.88rem",margin:0}}>
          Modelo de punto fuente Davis (1986) · Modelo de momento Aki &amp; Richards (2002) · 9 satélites SAR soportados
        </p>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:8,marginBottom:24,borderBottom:"1px solid rgba(255,255,255,0.08)",paddingBottom:0}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            padding:"10px 20px", border:"none", cursor:"pointer",
            background: tab===t.id ? "rgba(124,58,237,0.2)" : "transparent",
            color: tab===t.id ? "#a78bfa" : "#64748b",
            borderBottom: tab===t.id ? "2px solid #7c3aed" : "2px solid transparent",
            fontWeight: tab===t.id ? 700 : 400,
            fontSize:"0.88rem", transition:"all 0.2s",
          }}>{t.label}</button>
        ))}
      </div>

      {tab==="single" && <TabSingle satellites={satellites}/>}
      {tab==="timeseries" && <TabTimeseries satellites={satellites}/>}
      {tab==="batch" && <TabBatch satellites={satellites}/>}
    </div>
  );
}
