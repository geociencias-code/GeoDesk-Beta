import React, { useEffect, useMemo, useState } from "react";
import type { Scene } from "./AlaskaContent";
import { toast } from "sonner";

type Props = {
  scenes: Scene[];
  backendUrl: string;
  ruta?: number;
  marco?: number;
};

const formatDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString() : "";

const SentinelDashboard: React.FC<Props> = ({ scenes, backendUrl, ruta, marco }) => {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState<null | "download">(null);
  const [error, setError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>("prueba_api");

  useEffect(() => { setSelected({}); }, [scenes]);

  const allChecked = useMemo(
    () => scenes.length > 0 && scenes.every(s => selected[s.granule]),
    [scenes, selected]
  );

  const toggleAll = () => {
    if (allChecked) setSelected({});
    else {
      const next: Record<string, boolean> = {};
      scenes.forEach(s => (next[s.granule] = true));
      setSelected(next);
    }
  };
  const toggleOne = (g: string) => setSelected(p => ({ ...p, [g]: !p[g] }));

  async function downloadBatch(items: Scene[]) {
    setError(null);
    const targets = items
      .filter(s => !!s.download_url)
      .map(s => ({ file_url: s.download_url!, file_name: `${s.granule}.zip` }));
    if (!targets.length) {
      toast.error("No hay URLs de descarga disponibles (¿ya cargaste productos HyP3?).");
      return;
    }
    setLoading("download");
    try {
      const res = await fetch(`${backendUrl}/api/download-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: targets }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: Array<{ ok: boolean; filename?: string; bytes?: number; error?: string; }> = await res.json();

      const ok = data.filter(d => d.ok);
      const fail = data.filter(d => !d.ok);

      if (ok.length) {
        const msg = ok.slice(0, 6).map(d =>
          `✔ ${d.filename} (${((d.bytes || 0) / (1024*1024)).toFixed(1)} MB)`
        ).join("\n");
        toast.success(`Descargados ${ok.length} archivo(s) en backend/alaska_descargas.\n${msg}${ok.length > 6 ? "\n…" : ""}`, {
          duration: 5000,
        });
      }
      if (fail.length) {
        const msg = fail.slice(0, 6).map(d => `✖ ${d.error || "error"}`).join("\n");
        toast.error(`Algunos fallaron (${fail.length}).\n${msg}`, {
          duration: 5000,
        });
      }
    } catch (e: unknown) {
      if (e instanceof Error) setError(e.message);
      else setError(String(e));
    } finally {
      setLoading(null);
    }
  }

  // ——— Procesar SLC seleccionadas (no tienen download_url) ———
  async function processWithHyP3(items: Scene[]) {
    const granules = items.map(s => s.granule);
    if (!granules.length) { toast.error("No hay escenas seleccionadas."); return; }
    if (ruta == null || marco == null) { toast.error("Ruta/Marco requeridos."); return; }

    setLoading("download");
    try {
      const res = await fetch(`${backendUrl}/api/submit-from-granules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          granules, ruta, marco,
          options: { nombre_proyecto: projectName, include_dem: true, include_look_vectors: true, looks: "20x4" }
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      type SubmittedItem = { status?: string };
      const data = await res.json() as { submitted?: SubmittedItem[] };
      const ok = (data.submitted || []).filter(s => s.status === "submitted").length;
      toast.success(`Se enviaron ${ok} job(s) a HyP3. Cuando estén listos, usa "Cargar productos HyP3" en este mismo tab para descargarlos.`, {
        duration: 5000,
      });
    } catch (e: unknown) {
      if (e instanceof Error) setError(e.message);
      else setError(String(e));
    } finally {
      setLoading(null);
    }
  }

  const selectedRows = scenes.filter(s => selected[s.granule]);
  const hasDownloadURLs = scenes.some(s => !!s.download_url);

  const primaryAction = () => {
    if (hasDownloadURLs) downloadBatch(selectedRows);
    else processWithHyP3(selectedRows);
  };

  const primaryAll = () => {
    if (hasDownloadURLs) downloadBatch(scenes);
    else processWithHyP3(scenes);
  };

  const showRutaMarco = useMemo(() => scenes.some(r => r.ruta != null || r.marco != null), [scenes]);
  const showBeam       = useMemo(() => scenes.some(r => !!r.beam_mode), [scenes]);
  const showFlight     = useMemo(() => scenes.some(r => !!r.flight_direction), [scenes]);
  const showPol        = useMemo(() => scenes.some(r => !!r.polarization), [scenes]);
  const showSize       = useMemo(() => scenes.some(r => r.size_mb != null), [scenes]);

  // Función para actualizar el nombre del proyecto
  const handleProjectNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProjectName(e.target.value);
  };

  const handleUpdateProjectName = () => {
    toast.success(`Nombre del proyecto actualizado a: ${projectName}`);
  };

  return (
    <section className="card">
      <h2>Descargar / Procesar ({scenes.length})</h2>

      {/* Campo para cambiar el nombre del proyecto */}
      <div style={{ marginBottom: 12 }}>
        <label>Nombre del Proyecto:
          <input
            type="text"
            value={projectName}
            onChange={handleProjectNameChange}
            placeholder="Ingrese el nombre del proyecto"
          />
        </label>
        <button onClick={handleUpdateProjectName}>Actualizar Nombre del Proyecto</button>
      </div>

      {scenes.length > 0 && (
        <>
          <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
            <button onClick={primaryAction} disabled={loading === "download"}>
              {loading === "download" ? "Procesando…" :
                (hasDownloadURLs ? "Descargar seleccionadas" : "Procesar seleccionadas (HyP3)")}
            </button>
            <button onClick={primaryAll} disabled={loading === "download"}>
              {loading === "download" ? "Procesando…" :
                (hasDownloadURLs ? "Descargar todas" : "Procesar todas (HyP3)")}
            </button>
          </div>

          <div className="table-responsive">
            <table className="modern-table">
              <thead>
              <tr>
                <th><input type="checkbox" checked={scenes.length>0 && scenes.every(s => selected[s.granule])} onChange={toggleAll} /></th>
                <th>Granule</th>
                <th>Plataforma</th>
                {showRutaMarco && <th>Ruta/Marco</th>}
                {showBeam && <th>Beam</th>}
                {showFlight && <th>Dirección</th>}
                {showPol && <th>Polarización</th>}
                {showSize && <th>Tamaño</th>}
                <th>Fecha (UTC)</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {scenes.map(s => (
                <tr key={s.granule}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!selected[s.granule]}
                      onChange={() => toggleOne(s.granule)}
                    />
                  </td>
                  <td>
                    <div className="granule-cell" title={s.granule}>
                      {s.granule}
                    </div>
                  </td>
                  <td>{s.platform || "-"}</td>

                  {showRutaMarco && <td>{(s.ruta ?? "-") + "/" + (s.marco ?? "-")}</td>}
                  {showBeam && <td>{s.beam_mode || "-"}</td>}
                  {showFlight && <td>{s.flight_direction || "-"}</td>}
                  {showPol && <td>{s.polarization || "-"}</td>}
                  {showSize && <td>{s.size_mb != null ? `${s.size_mb.toFixed(2)} MB` : "-"}</td>}

                  <td>{formatDate(s.date_utc)}</td>
                  <td>
                    {s.download_url
                      ? <a href={s.download_url} target="_blank" rel="noreferrer">Ver</a>
                      : <span style={{ opacity: .6 }}>N/D</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>

          {error && <div style={{ color: "#ffb4b4", marginTop: 8 }}>{error}</div>}
        </>
      )}

      {scenes.length === 0 && <small>No hay resultados aún. Ve a la pestaña <b>Obtener Datos</b>, busca y vuelve aquí.</small>}
    </section>
  );
};

export default SentinelDashboard;
