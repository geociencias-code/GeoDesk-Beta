import React, { useState } from "react";
import axios from "axios";
// import "../styles/solicitar_imagenes_automatico.css";

interface TimeWindow {
  start: string;
  end: string;
}

interface Summary {
  found_scenes: number;
  built_pairs: number;
  submitted_jobs: number;
  output_folder_hint: string;
}

interface ApiError {
  code: string;
  message: string;
}

interface ResponseData {
  project: string;
  project_input?: string | null;
  time_window: TimeWindow | null;
  summary: Summary;
  error?: ApiError | null;
}

const SolicitarImagenesAutomatico: React.FC = () => {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [projectName, setProjectName] = useState(""); // Nombre del proyecto que ingresa el usuario
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    // Validación: asegurarse de que las fechas y el nombre estén completos
    if (!startDate || !endDate) {
      setError("Por favor, selecciona ambas fechas.");
      return;
    }

    if (!projectName.trim()) {
      setError("Por favor, escribe un nombre de proyecto.");
      return;
    }

    try {
      setLoading(true);

      // Preparar los datos para enviarlos al backend
      const payload = {
        start_date: startDate,
        end_date: endDate,
        project_name: projectName.trim(), // Nombre del proyecto tal como el usuario lo ingresa
      };

      // Enviar la solicitud al backend para solicitar las imágenes
      const response = await axios.post<ResponseData>(
        "http://localhost:8000/api/solicitar_imagenes",
        payload
      );

      const data = response.data;

      // Si el backend devuelve un error (por ejemplo, nombre repetido)
      if (data.error) {
        setError(data.error.message || "Ocurrió un error en el backend.");
        setResult(null);
        return;
      }

      // Si la solicitud fue exitosa, mostrar el resultado
      setResult(data);
    } catch (err: unknown) {
      console.error(err);

      // Manejo de errores
      if (axios.isAxiosError(err)) {
        const detail =
          err.response?.data?.detail ||
          err.message ||
          "Error al solicitar imágenes.";
        setError(typeof detail === "string" ? detail : "Error al solicitar imágenes.");
      } else {
        setError("Error inesperado al solicitar imágenes.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auto-page">
      <h1>🛰️ Solicitar Imágenes Automático</h1>

      <form className="auto-form" onSubmit={handleSubmit}>
        {/* Campo para la fecha de inicio */}
        <div className="form-group">
          <label>Fecha de inicio:</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>

        {/* Campo para la fecha de fin */}
        <div className="form-group">
          <label>Fecha de fin:</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>

        {/* Campo para el nombre del proyecto */}
        <div className="form-group">
          <label>Nombre del proyecto / carpeta:</label>
          <input
            type="text"
            placeholder="Ej: Prueba2_14"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            required
          />
          <small>
            Debe ser único. Si ya existe una carpeta con ese nombre, el servidor lo
            rechazará.
          </small>
        </div>

        {/* Botón de envío */}
        <button type="submit" disabled={loading}>
          {loading ? "Procesando..." : "Solicitar Imágenes"}
        </button>
      </form>

      {/* Mostrar error si ocurre */}
      {error && <p className="error-msg">{error}</p>}

      {/* Mostrar el resultado si la solicitud fue exitosa */}
      {result && result.time_window && (
        <div className="result-card">
          <h2>✅ Resultado</h2>
          <p>
            <strong>Proyecto usado:</strong> {result.project}
          </p>
          {result.project_input && (
            <p>
              <strong>Nombre escrito:</strong> {result.project_input}
            </p>
          )}
          <p>
            <strong>Rango:</strong> {result.time_window.start} →{" "}
            {result.time_window.end}
          </p>
          <p>
            <strong>Escenas encontradas:</strong>{" "}
            {result.summary?.found_scenes ?? 0}
          </p>
          <p>
            <strong>Pares construidos:</strong>{" "}
            {result.summary?.built_pairs ?? 0}
          </p>
          <p>
            <strong>Jobs enviados:</strong>{" "}
            {result.summary?.submitted_jobs ?? 0}
          </p>
          <p>
            <strong>Carpeta sugerida:</strong>{" "}
            {result.summary?.output_folder_hint}
          </p>
        </div>
      )}
    </div>
  );
};

export default SolicitarImagenesAutomatico;
