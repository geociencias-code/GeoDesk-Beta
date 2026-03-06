import React, { useState } from "react";
import axios from "axios";
import { API_URL } from "../../services/api";
const Era5Procesamiento: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDateIndex, setSelectedDateIndex] = useState(0);
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // ----------------------------
  // 1. Manejar carga de archivo
  // ----------------------------
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  // ----------------------------
  // 2. Enviar archivo al backend
  // ----------------------------
  const handleUpload = async () => {
    if (!file) {
      setMessage("⚠️ Selecciona un archivo .nc antes de continuar.");
      return;
    }

    setLoading(true);
    setMessage("⏳ Procesando archivo, por favor espera...");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await axios.post(`${API_URL}/procesar_nc`, formData);

      const data = res.data;
      setDates(data.fechas);
      setImages(data.imagenes);
      setSelectedDateIndex(0);
      setMessage("✅ Archivo procesado correctamente.");
    } catch (error: unknown) {
      setMessage("❌ Error al cargar o procesar el archivo.");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------
  // 3. Cambiar fecha con slider
  // ----------------------------
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedDateIndex(Number(e.target.value));
  };

  return (
    <div style={{ padding: "24px", color: "#eee", backgroundColor: "#0a0a0a", minHeight: "100vh" }}>
      <h2 style={{ fontSize: "28px", marginBottom: "16px" }}>🌡️ Procesamiento ERA5</h2>

      <div style={{ marginBottom: "16px" }}>
        <label htmlFor="file-upload">Selecciona un archivo .nc:</label>
        <input
          id="file-upload"
          type="file"
          accept=".nc"
          onChange={handleFileChange}
          style={{ display: "block", marginTop: "8px" }}
        />
      </div>

      <button
        onClick={handleUpload}
        disabled={!file || loading}
        style={{
          padding: "10px 20px",
          backgroundColor: "#0055ff",
          color: "white",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
        }}
      >
        {loading ? "Procesando..." : "Subir y procesar"}
      </button>

      {message && <p style={{ marginTop: "12px" }}>{message}</p>}

      {/* ---------------------------- */}
      {/* Mostrar slider e imagen      */}
      {/* ---------------------------- */}
      {images.length > 0 && (
        <div style={{ marginTop: "32px" }}>
          <h3>🗓️ Fecha seleccionada: {dates[selectedDateIndex]}</h3>

          <input
            type="range"
            min={0}
            max={images.length - 1}
            value={selectedDateIndex}
            onChange={handleSliderChange}
            style={{ width: "100%", marginTop: "12px" }}
          />

          <div style={{ textAlign: "center", marginTop: "20px" }}>
            <img
              src={`${API_URL}/${images[selectedDateIndex]}`}
              alt="Mapa de temperatura"
              style={{
                maxWidth: "100%",
                borderRadius: "12px",
                border: "2px solid #333",
                marginTop: "10px",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Era5Procesamiento;
