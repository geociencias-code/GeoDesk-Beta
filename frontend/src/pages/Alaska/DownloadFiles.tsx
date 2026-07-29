import React, { useState, useEffect, useMemo } from "react";
import api from "../../services/api";
import { toast } from "sonner";

type FileEntry = {
  file_name: string;
  url: string;
  size_mb?: number | null;
};

type Project = {
  name: string;
  id: string;
};

const DownloadFiles: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());

  // Cargar lista de proyectos disponibles
  const fetchProjects = async () => {
    try {
      const res = await api.get('/api/projects');
      setProjects(res.data);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError("Error al cargar los proyectos: " + (e.message || "Error desconocido"));
      } else {
        setError("Error al cargar los proyectos: Error desconocido");
      }
    }
  };

  const fetchFilesForProject = async (projectName: string) => {
    if (!projectName) {
      setFiles([]);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await api.post('/api/project-files', {
        nombre_proyecto: projectName,
        product_type: "INSAR_GAMMA",
      });

      const data: FileEntry[] = res.data;
      setFiles(data);
      setSelectedFiles(new Set());
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError("No se pudieron cargar los archivos: " + (e.message || "Error desconocido"));
      } else {
        setError("No se pudieron cargar los archivos: Error desconocido");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleProjectSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const projectName = e.target.value;
    setSelectedProject(projectName);
    fetchFilesForProject(projectName);
  };

  const allChecked = useMemo(
    () => files.length > 0 && files.every((_, idx) => selectedFiles.has(idx)),
    [files, selectedFiles]
  );

  const toggleAll = () => {
    if (allChecked) {
      setSelectedFiles(new Set());
    } else {
      const next = new Set<number>();
      files.forEach((_, idx) => next.add(idx));
      setSelectedFiles(next);
    }
  };

  const toggleOne = (idx: number) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleDownload = async (all: boolean) => {
    setLoading(true);
    setError(null);

    const itemsToDownload = all 
      ? files 
      : Array.from(selectedFiles).map((idx) => files[idx]);

    if (!itemsToDownload.length) {
      toast.warning("No hay archivos para descargar.");
      setLoading(false);
      return;
    }

    try {
      const downloadPromises = itemsToDownload.map(async (file) => {
        const res = await api.post('/api/download', {
          file_url: file.url,
          file_name: file.file_name,
        });

        const result = res.data;
        return result;
      });

      const results = await Promise.all(downloadPromises);
      const sizeStr = itemsToDownload.length > 6 ? "\n…" : "";
      toast.success(`Descargados ${results.length} archivo(s) conectamente en backend/alaska_descargas.${sizeStr}`);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError("Error al descargar los archivos: " + (e.message || "Error desconocido"));
      } else {
        setError("Error al descargar los archivos: Error desconocido");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  return (
    <div className="page-container" style={{ padding: 0 }}>
      {/* HEADER SECTION */}
      <div className="header-section">
        <div className="icon-wrapper">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 15v4c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-4M17 9l-5 5-5-5M12 12.8V2.5" />
          </svg>
        </div>
        <div>
          <h1 className="page-title">Descargar Resultados</h1>
          <p className="page-subtitle">Gestiona y descarga los procesos terminados de HyP3 en un solo click.</p>
        </div>
      </div>

      <div className="layout-grid">
        <div className="upload-panel">
          <div className="upload-card">
            <h3>Seleccionar Proyecto</h3>
            <p className="field-hint">Elige un proyecto para listar los archivos listos para descargar.</p>
            <div style={{ marginTop: "1rem" }}>
              <select className="input-field" value={selectedProject} onChange={handleProjectSelect} disabled={loading} style={{ width: "100%", padding: "12px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", background: "rgba(0,0,0,0.2)", color: "white" }}>
                <option value="">-- Seleccionar --</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.name}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            {error && <div className="error-banner" style={{ marginTop: "12px" }}>{error}</div>}
          </div>
        </div>

        <div className="results-panel">
          <div className="data-widget" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", height: "100%", minHeight: "450px" }}>
            
            <div style={{ padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <h2 style={{ fontSize: "1.1rem", margin: 0, fontWeight: 500 }}>Archivos del Proyecto {files.length > 0 && `(${files.length})`}</h2>
              {files.length > 0 && (
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  <button
                    className="submit-btn"
                    style={{ padding: "8px 16px", minWidth: "auto", fontSize: "0.9rem", background: "linear-gradient(135deg, #6366f1, #4f46e5)" }}
                    onClick={() => handleDownload(false)}
                    disabled={selectedFiles.size === 0 || loading}
                  >
                    {loading ? "Descargando..." : `Descargar Seleccionados (${selectedFiles.size})`}
                  </button>
                  <button
                    className="submit-btn"
                    style={{ padding: "8px 16px", minWidth: "auto", fontSize: "0.9rem", background: "linear-gradient(135deg, #10b981, #059669)" }}
                    onClick={() => handleDownload(true)}
                    disabled={loading}
                  >
                    {loading ? "Descargando..." : "Descargar Todo el Proyecto"}
                  </button>
                </div>
              )}
            </div>

            {loading && (
              <div style={{ padding: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <span style={{ fontSize: "0.9rem", color: "#ccc" }}>Gestionando descargas en el servidor... (esto puede tardar según la red)</span>
                </div>
                <div style={{ width: "100%", height: "8px", backgroundColor: "#333", borderRadius: "4px", overflow: "hidden" }}>
                  <div 
                    style={{ 
                      height: "100%", 
                      backgroundColor: "#007bff", 
                      width: "100%",
                      animation: "indeterminate 1.5s infinite linear",
                      transformOrigin: "left"
                    }} 
                  />
                </div>
              </div>
            )}

            {!loading && files.length > 0 && (
              <div className="table-responsive" style={{ flex: 1, overflowY: "auto" }}>
                <table className="modern-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ width: "50px", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={toggleAll}
                        />
                      </th>
                      <th>Nombre de Archivo</th>
                      <th style={{ width: "120px", textAlign: "right" }}>Tamaño</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file, idx) => (
                      <tr key={idx} style={{ backgroundColor: selectedFiles.has(idx) ? "rgba(79, 70, 229, 0.1)" : "transparent", transition: "all 0.2s" }}>
                        <td style={{ textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={selectedFiles.has(idx)}
                            onChange={() => toggleOne(idx)}
                          />
                        </td>
                        <td>
                          <div className="granule-cell" title={file.file_name} style={{ fontWeight: 500 }}>
                            {file.file_name}
                          </div>
                        </td>
                        <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                          {file.size_mb != null ? `${file.size_mb.toFixed(2)} MB` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && files.length === 0 && selectedProject && !error && (
              <div style={{ padding: "48px 24px", color: "var(--text-secondary)", textAlign: "center" }}>
                No se encontraron archivos procesados disponibles para "{selectedProject}".
              </div>
            )}

            {!loading && files.length === 0 && !selectedProject && (
              <div style={{ padding: "64px 24px", color: "var(--text-secondary)", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 15v4c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-4M17 9l-5 5-5-5M12 12.8V2.5" />
                </svg>
                <p>Selecciona un proyecto desde la columna izquierda para visualizar y descargar sus resultados.</p>
              </div>
            )}
            
          </div>
        </div>
      </div>
    </div>
  );
};

export default DownloadFiles;
