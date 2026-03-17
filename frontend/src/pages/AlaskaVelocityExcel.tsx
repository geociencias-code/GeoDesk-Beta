import React, { useState } from 'react';
import axios from 'axios';
import { API_URL } from "../services/api";

export default function AlaskaVelocityExcel() {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const handleRemoveFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleCalculate = async () => {
    if (files.length < 5) {
      setMessage("❌ Se requieren al menos 5 archivos para calcular la velocidad.");
      return;
    }

    setBusy(true);
    setMessage("Calculando velocidad (esto puede tomar un minuto)...");
    setResultUrl(null);

    try {
      const formData = new FormData();
      files.forEach(file => {
        formData.append("files", file);
      });

      const res = await axios.post(`${API_URL}/api/v1/alaska/velocity_excel`, formData, {
        responseType: 'blob'
      });

      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      setResultUrl(url);
      setMessage("✅ Cálculo finalizado con éxito.");
    } catch (error: any) {
      console.error(error);
      setMessage(`❌ Error al calcular: ${error.response?.data?.detail || error.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-container">
      <div className="header-section">
        <div className="icon-wrapper">
          <span style={{ fontSize: "1.5rem" }}>📈</span>
        </div>
        <div>
          <h1 style={{ background: "linear-gradient(90deg, #10b981, #3b82f6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Cálculo de Velocidad (Excel)
          </h1>
          <p>Calcula la velocidad de desplazamiento anual a partir de múltiples archivos de deformación</p>
        </div>
      </div>

      <div className="data-widget" style={{ maxWidth: "800px", margin: "0 auto", padding: "24px", background: "var(--color-bg-card)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
        <h3 style={{ marginBottom: "16px", color: "var(--color-primary)" }}>Archivos de Entrada</h3>
        
        <div className="dropzone" style={{ borderStyle: "dashed", borderColor: "rgba(255,255,255,0.2)", padding: "30px", textAlign: "center", marginBottom: "20px", position: "relative" }}>
          <input
            type="file"
            multiple
            accept=".csv, .xls, .xlsx"
            onChange={handleFileChange}
            style={{ width: "100%", opacity: 0, position: "absolute", top: 0, left: 0, height: "100%", cursor: "pointer" }}
          />
          <div style={{ pointerEvents: "none" }}>
            <span style={{ display: "block", fontSize: "2rem", marginBottom: "8px" }}>📁</span>
            <span style={{ color: "var(--color-text-main)", fontWeight: "bold" }}>Arrastra tus archivos CSV o Excel aquí</span>
            <span style={{ display: "block", fontSize: "0.85rem", color: "var(--color-text-muted)", marginTop: "4px" }}>
              (O haz clic para seleccionar)
            </span>
          </div>
        </div>

        {files.length > 0 && (
          <div style={{ marginBottom: "20px", maxHeight: "200px", overflowY: "auto", background: "rgba(0,0,0,0.2)", padding: "12px", borderRadius: "8px" }}>
            <div style={{ marginBottom: "8px", fontWeight: "bold", color: "var(--color-text-muted)", fontSize: "0.9rem" }}>
              {files.length} archivo(s) seleccionado(s)
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {files.map((f, i) => (
                <li key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: "0.85rem" }}>
                  <span style={{ color: "var(--color-text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: "10px" }}>{f.name}</span>
                  <button onClick={() => handleRemoveFile(i)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>✖</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
          <button
            onClick={handleCalculate}
            disabled={busy || files.length < 5}
            className="submit-btn"
            style={{ width: "100%", background: "linear-gradient(135deg, #10b981, #059669)", opacity: (busy || files.length < 5) ? 0.5 : 1 }}
          >
            {busy ? "Procesando..." : "Calcular Velocidad Anual"}
          </button>
          
          {files.length > 0 && files.length < 5 && (
            <span style={{ color: "#f59e0b", fontSize: "0.85rem" }}>⚠️ Por favor selecciona al menos 5 archivos (actualmente: {files.length})</span>
          )}

          {message && (
            <div style={{ marginTop: "8px", padding: "12px", width: "100%", boxSizing: "border-box", borderRadius: "8px", background: "rgba(255,255,255,0.05)", textAlign: "center", fontSize: "0.9rem", color: message.includes('❌') ? "#ffb4b4" : "var(--color-text-main)" }}>
              {message}
            </div>
          )}

          {resultUrl && (
            <a
              href={resultUrl}
              download="velocidad_promedio.xlsx"
              className="submit-btn"
              style={{ display: "block", width: "100%", boxSizing: "border-box", textAlign: "center", textDecoration: "none", background: "rgba(59, 130, 246, 0.2)", border: "1px solid #3b82f6", color: "#93c5fd", padding: "12px", borderRadius: "8px", marginTop: "8px" }}
            >
              ⬇️ Descargar Excel con Velocidades
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
