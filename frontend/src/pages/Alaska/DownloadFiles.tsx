import React, { useState, useEffect } from "react";
import axios from "axios";
import { API_URL } from "../../services/api";
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
      const res = await axios.get(`${API_URL}/api/projects`);
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
    if (!projectName) return;
    setLoading(true);
    setError(null);

    try {
      const res = await axios.post(`${API_URL}/api/project-files`, {
        nombre_proyecto: projectName,
        product_type: "INSAR_GAMMA",
      });

      const data: FileEntry[] = res.data;
      setFiles(data);
      setSelectedFiles(new Set());
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(
          "No se pudieron cargar los archivos: " + (e.message || "Error desconocido")
        );
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

  const handleFileSelection = (idx: number) => {
    setSelectedFiles((prevSelectedFiles) => {
      const newSelectedFiles = new Set(prevSelectedFiles);
      if (newSelectedFiles.has(idx)) {
        newSelectedFiles.delete(idx);
      } else {
        newSelectedFiles.add(idx);
      }
      return newSelectedFiles;
    });
  };

  // Manejar la descarga de archivos seleccionados vía backend
  const handleDownload = async () => {
    setLoading(true);
    setError(null);

    const selectedItems = Array.from(selectedFiles).map((idx) => files[idx]);

    try {
      const downloadPromises = selectedItems.map(async (file) => {
        const res = await axios.post(`${API_URL}/api/download`, {
          file_url: file.url,
          file_name: file.file_name,
        });

        const result = res.data;
        console.log(result);
        return result;
      });

      await Promise.all(downloadPromises);
      toast.success("Archivos descargados correctamente.");
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(
          "Error al descargar los archivos: " + (e.message || "Error desconocido")
        );
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
    <div className="download-files">
      <div>
        <label>Seleccionar Proyecto: </label>
        <select value={selectedProject} onChange={handleProjectSelect}>
          <option value="">Seleccionar un proyecto</option>
          {projects.map((project) => (
            <option key={project.id} value={project.name}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      {error && <div style={{ color: "red", marginTop: 8 }}>{error}</div>}

      {files.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>Archivos disponibles:</h3>
          <ul>
            {files.map((file, idx) => (
              <li key={idx}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(idx)}
                    onChange={() => handleFileSelection(idx)}
                  />
                  {" "}
                  {file.file_name}{" "}
                  {file.size_mb != null && `(${file.size_mb.toFixed(2)} MB)`}
                </label>
              </li>
            ))}
          </ul>

          <button
            onClick={handleDownload}
            disabled={selectedFiles.size === 0 || loading}
          >
            {loading ? "Descargando..." : "Descargar seleccionados"}
          </button>
        </div>
      )}

      {files.length === 0 && !error && selectedProject && (
        <div style={{ marginTop: 12 }}>
          No se encontraron archivos para este proyecto.
        </div>
      )}
    </div>
  );
};

export default DownloadFiles;
