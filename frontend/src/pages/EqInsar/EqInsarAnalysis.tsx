import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import { API_URL } from "../../services/api";

const SATELLITES = ["sentinel1","alos2","terrasar","cosmo","radarsat2","nisar","saocom","envisat","iceye"];

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
  background:"rgba(255,255,255,0.06)", color:"#e2e8f0", fontSize:"0.87rem",
};

const label: React.CSSProperties = {
  display:"block", fontSize:"0.78rem", color:"#94a3b8", marginBottom:4, marginTop:10,
};

const btn = (color="from-violet-600 to-indigo-600"): React.CSSProperties => ({
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

  // Si el padre actualiza el valor desde afuera (p.e. reset), sincronizar el raw
  useEffect(() => {
    if (prevVal.current !== value) {
      prevVal.current = value;
      // No sobreescribir si el usuario está en mitad de escribir
      const isIntermediate =
        raw === "" || raw === "-" || raw === "." || raw === "-."
        || raw.endsWith(".");
      if (!isIntermediate) {
        setRaw(value !== undefined ? String(value) : "");
      }
    }
  }, [value]);

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
            <span key={k} style={{marginRight:10}}>{k}: <b style={{color:"#94a3b8"}}>{typeof v==="number"?v.toFixed(4):v}</b></span>
          ))}
        </div>
      )}
    </div>
  );
}

function FaultForm({p, set, showNoiseControls=true}:{p:any, set:(x:any)=>void, showNoiseControls?:boolean}) {
  return (
    <>
      <p style={sectionTitle}>Parámetros del Sismo</p>
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
        <NumField label="Tamaño grilla (px)" value={p.grid_size} onChange={v=>set({...p,grid_size:Math.round(v??p.grid_size)})}/>
        <NumField label="Extensión (km)" value={p.grid_extent_km} onChange={v=>set({...p,grid_extent_km:v??p.grid_extent_km})}/>
      </div>
      <p style={sectionTitle}>Satélite InSAR</p>
      <span style={label}>Satélite</span>
      <select style={inputStyle} value={p.satellite} onChange={e=>set({...p,satellite:e.target.value})}>
        <option value="">— Manual —</option>
        {SATELLITES.map(s=><option key={s} value={s}>{s}</option>)}
      </select>
      <span style={label}>Órbita</span>
      <select style={inputStyle} value={p.orbit} onChange={e=>set({...p,orbit:e.target.value})}>
        <option value="ascending">Ascendente</option>
        <option value="descending">Descendente</option>
      </select>
      {!p.satellite && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          <NumField label="Incidencia (°)" value={p.incidence_deg??33} onChange={v=>set({...p,incidence_deg:v??p.incidence_deg})}/>
          <NumField label="Heading (°)" value={p.heading_deg??-13} onChange={v=>set({...p,heading_deg:v??p.heading_deg})}/>
          <NumField label="Longitud de onda (m)" value={p.wavelength_m??0.05546} onChange={v=>set({...p,wavelength_m:v??p.wavelength_m})}/>
        </div>
      )}
      <p style={sectionTitle}>Opciones Avanzadas</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {showNoiseControls && (
          <>
            <ToggleField label="Agregar ruido" value={p.add_noise} onChange={v=>set({...p,add_noise:v})}/>
            <ToggleField label="Rampa orbital" value={p.add_orbital_ramp} onChange={v=>set({...p,add_orbital_ramp:v})}/>
          </>
        )}
        <ToggleField label="Fase envuelta" value={p.wrap} onChange={v=>set({...p,wrap:v})}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:4}}>
        <NumField label="Amplitud ruido (m)" value={p.noise_amplitude_m} onChange={v=>set({...p,noise_amplitude_m:v??p.noise_amplitude_m})}/>
        <NumField label="Razón de Poisson ν" value={p.nu} onChange={v=>set({...p,nu:v??p.nu})}/>
        <NumField label="Semilla (seed)" value={p.seed??0} onChange={v=>set({...p,seed:v})}/>
      </div>
    </>
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

function TabSingle() {
  const [p, setP] = useState<any>(defaultSingle);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true); setError(""); setResult(null);
    try {
      const body = {...p};
      if (!body.satellite) { delete body.satellite; }
      const res = await axios.post(`${API_URL}/api/eq_insar/generate`, body);
      setResult(res.data);
    } catch(e:any) {
      setError(e.response?.data?.detail ?? e.message);
    } finally { setBusy(false); }
  };

  return (
    <div style={{display:"grid",gridTemplateColumns:"340px 1fr",gap:20,alignItems:"start"}}>
      <div style={card}>
        <FaultForm p={p} set={setP}/>
        <button style={btn()} onClick={run} disabled={busy}>
          {busy ? "⏳ Generando..." : "🌍 Generar Interferograma"}
        </button>
        {error && <p style={{color:"#f87171",fontSize:"0.82rem",marginTop:8}}>❌ {error}</p>}
      </div>
      <div>
        {!result && !busy && (
          <div style={{...card,textAlign:"center",padding:60,color:"#475569"}}>
            <div style={{fontSize:48,marginBottom:12}}>🌋</div>
            <p>Configura los parámetros del sismo y haz clic en "Generar".</p>
          </div>
        )}
        {result && (
          <>
            <div style={{...card,marginBottom:16}}>
              <p style={sectionTitle}>Metadatos del Modelo</p>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                {[
                  ["Mw", result.metadata.Mw?.toFixed(2)],
                  ["Strike", `${result.metadata.strike_deg}°`],
                  ["Dip", `${result.metadata.dip_deg}°`],
                  ["Rake", `${result.metadata.rake_deg}°`],
                  ["Profundidad", `${result.metadata.depth_km} km`],
                  ["Satélite", result.metadata.satellite],
                  ["Incidencia", `${result.metadata.incidence_deg?.toFixed(1)}°`],
                  ["λ (cm)", `${((result.metadata.wavelength_m??0)*100).toFixed(2)}`],
                ].map(([k,v])=>(
                  <div key={k} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"8px 12px"}}>
                    <div style={{fontSize:"0.7rem",color:"#64748b"}}>{k}</div>
                    <div style={{fontWeight:700,fontSize:"0.9rem",color:"#e2e8f0"}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
              <InSARImage b64={result.images.phase_wrapped} title="Fase Envuelta (con ruido)"
                stats={result.statistics.phase_unwrapped}/>
              <InSARImage b64={result.images.phase_unwrapped} title="Fase Desenvuelta (rad)"
                stats={result.statistics.phase_unwrapped}/>
              <InSARImage b64={result.images.los_displacement} title="Desplazamiento LOS (m)"
                stats={result.statistics.los_displacement}/>
              <InSARImage b64={result.images.displacement_east} title="Desplazamiento Este (m)"
                stats={result.statistics.displacement_east}/>
              <InSARImage b64={result.images.displacement_north} title="Desplazamiento Norte (m)"
                stats={result.statistics.displacement_north}/>
              <InSARImage b64={result.images.displacement_up} title="Desplazamiento Vertical (m)"
                stats={result.statistics.displacement_up}/>
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

function TabTimeseries() {
  const [p, setP] = useState<any>(defaultTS);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [frameIdx, setFrameIdx] = useState(0);

  const run = async () => {
    setBusy(true); setError(""); setResult(null); setFrameIdx(0);
    try {
      const body = {...p};
      if (!body.satellite) delete body.satellite;
      const res = await axios.post(`${API_URL}/api/eq_insar/timeseries`, body);
      setResult(res.data);
    } catch(e:any) {
      setError(e.response?.data?.detail ?? e.message);
    } finally { setBusy(false); }
  };

  return (
    <div style={{display:"grid",gridTemplateColumns:"340px 1fr",gap:20,alignItems:"start"}}>
      <div style={card}>
        <FaultForm p={p} set={setP} showNoiseControls={false}/>
        <p style={{...sectionTitle,marginTop:16}}>Configuración de Frames</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          <NumField label="Pre-sismo" value={p.n_pre} onChange={v=>setP({...p,n_pre:Math.round(v??p.n_pre)})}/>
          <NumField label="Evento" value={p.n_event} onChange={v=>setP({...p,n_event:Math.round(v??p.n_event)})}/>
          <NumField label="Post-sismo" value={p.n_post} onChange={v=>setP({...p,n_post:Math.round(v??p.n_post)})}/>
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
      <div>
        {result ? (
          <div style={card}>
            <p style={sectionTitle}>
              Frame {frameIdx+1} / {result.n_frames} — {result.frame_labels?.[frameIdx]}
            </p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              <InSARImage b64={result.frames[frameIdx]} title="Interferograma"/>
              <InSARImage b64={result.labels[frameIdx]} title="Máscara de Deformación"/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <button disabled={frameIdx===0} onClick={()=>setFrameIdx(f=>f-1)}
                style={{...btn(),opacity:frameIdx===0?0.4:1,padding:"6px 16px",marginTop:0}}>◀ Anterior</button>
              <input type="range" min={0} max={result.n_frames-1} value={frameIdx}
                onChange={e=>setFrameIdx(parseInt(e.target.value))} style={{flex:1}}/>
              <button disabled={frameIdx===result.n_frames-1} onClick={()=>setFrameIdx(f=>f+1)}
                style={{...btn(),opacity:frameIdx===result.n_frames-1?0.4:1,padding:"6px 16px",marginTop:0}}>Siguiente ▶</button>
            </div>
            <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
              {result.frame_labels?.map((lbl:string, i:number)=>(
                <button key={i} onClick={()=>setFrameIdx(i)} style={{
                  padding:"3px 10px", borderRadius:20, border:"none", cursor:"pointer", fontSize:"0.72rem",
                  background: i===frameIdx ? "#7c3aed" :
                    i < result.n_pre ? "rgba(239,68,68,0.2)" :
                    i < result.n_pre+result.n_event ? "rgba(234,179,8,0.3)" : "rgba(34,197,94,0.2)",
                  color: i===frameIdx ? "white" : "#94a3b8",
                }}>{lbl}</button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{...card,textAlign:"center",padding:60,color:"#475569"}}>
            <div style={{fontSize:48,marginBottom:12}}>📡</div>
            <p>Genera una serie de tiempo para visualizar la secuencia pre/co/post-sismo.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// TAB 3 Generación por Lotes
function TabBatch() {
  const [p, setP] = useState({n_samples:50, mw_range:[5.0,7.0], satellite:"sentinel1", orbit:"ascending", seed:42});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true); setError(""); setResult(null);
    try {
      const res = await axios.post(`${API_URL}/api/eq_insar/batch`, p);
      setResult(res.data);
    } catch(e:any) {
      setError(e.response?.data?.detail ?? e.message);
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
          {SATELLITES.map(s=><option key={s} value={s}>{s}</option>)}
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
              {[
                ["Muestras", result.n_samples],
                ["Frames/muestra", result.n_frames_per_sample],
                ["Shape X", result.array_shape_X?.join("×")],
                ["Shape y", result.array_shape_y?.join("×")],
                ...(result.mw_statistics ? [
                  ["Mw mín", result.mw_statistics.min?.toFixed(2)],
                  ["Mw máx", result.mw_statistics.max?.toFixed(2)],
                  ["Mw media", result.mw_statistics.mean?.toFixed(2)],
                  ["Mw σ", result.mw_statistics.std?.toFixed(2)],
                ] : []),
              ].map(([k,v])=>(
                <div key={String(k)} style={{background:"rgba(0,0,0,0.3)",borderRadius:10,padding:"10px 14px"}}>
                  <div style={{fontSize:"0.7rem",color:"#64748b"}}>{k}</div>
                  <div style={{fontWeight:700,fontSize:"0.95rem",color:"#e2e8f0"}}>{v}</div>
                </div>
              ))}
            </div>
            {result.preview_images?.length > 0 && (
              <div style={card}>
                <p style={sectionTitle}>Vista previa — Primeras {result.preview_images.length} muestras</p>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
                  {result.preview_images.map((b64:string, i:number)=>(
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

      {tab==="single" && <TabSingle/>}
      {tab==="timeseries" && <TabTimeseries/>}
      {tab==="batch" && <TabBatch/>}
    </div>
  );
}
