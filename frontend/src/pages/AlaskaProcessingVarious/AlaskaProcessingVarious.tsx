import { useState } from "react";
import axios from "axios";
import { API_URL } from "../../services/api";

type Manifest = {
  fechas: string[];
  fase: { fecha: string; path: string }[];
  coherencia: { fecha: string; path: string }[];
  elevacion: { fecha: string; path: string }[];
};

export default function AlaskaViewer() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [idx, setIdx] = useState(0);
  const [zipFiles, setZipFiles] = useState<FileList | null>(null);
  const [view, setView] = useState<"fase" | "coherencia" | "elevacion">("coherencia");
  const [processing, setProcessing] = useState(false);

  // ===========================
  // Procesar archivos ZIP
  // ===========================
  const procesarZips = async () => {
    if (!zipFiles || zipFiles.length === 0) {
      alert("Seleccione al menos un archivo ZIP.");
      return;
    }

    const formData = new FormData();
    Array.from(zipFiles).forEach((file) => formData.append("files", file));

    setProcessing(true);

    try {
      const response = await axios.post(`${API_URL}/api/alaska/upload`, formData);

      const data = response.data;
      setManifest(data); // Aquí el backend debe devolver un manifest con las imágenes generadas
      setIdx(0);
    } catch (error) {
      console.error(error);
      alert("Error al procesar los ZIPs.");
    }

    setProcessing(false);
  };

  // ===========================
  // Si no hay manifest, mostrar selector de archivo
  // ===========================
  if (!manifest) {
    return (
      <div className="viewer-container">
        <h1>Procesamiento de imágenes Alaska</h1>
        <input
          type="file"
          accept=".zip"
          multiple
          onChange={(e) => setZipFiles(e.target.files)}
        />
        <button onClick={procesarZips} disabled={processing}>
          {processing ? "Procesando..." : "Procesar ZIPs"}
        </button>
      </div>
    );
  }

  // ===========================
  // Obtener imagen según vista seleccionada (fase, coherencia, elevación)
  // ===========================
  const fecha = manifest.fechas[idx];
  const getImg = (list: { fecha: string; path: string }[], fecha: string) =>
    list.find((entry) => entry.fecha === fecha)?.path ?? null;

  const img =
    view === "fase"
      ? getImg(manifest.fase, fecha)
      : view === "coherencia"
      ? getImg(manifest.coherencia, fecha)
      : getImg(manifest.elevacion, fecha);

  return (
    <div className="viewer-container">
      <h1>Resultados Alaska — {fecha}</h1>

      {/* Botones de selección de modo (fase, coherencia, elevación) */}
      <div className="mode-buttons">
        <button
          className={view === "coherencia" ? "active" : ""}
          onClick={() => setView("coherencia")}
        >
          Coherencia
        </button>
        <button
          className={view === "fase" ? "active" : ""}
          onClick={() => setView("fase")}
        >
          Fase
        </button>
        <button
          className={view === "elevacion" ? "active" : ""}
          onClick={() => setView("elevacion")}
        >
          Elevación
        </button>
      </div>

      {/* Slider para las fechas */}
      <div className="slider-container">
        <input
          type="range"
          min={0}
          max={manifest.fechas.length - 1}
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
          className="slider"
        />
      </div>

      {/* Imagen correspondiente */}
      <div className="img-box">
        {img ? <img src={`${API_URL}/${img.replace(/\\/g, "/")}`} alt={view} /> : <p>No disponible</p>}
      </div>
    </div>
  );
}
