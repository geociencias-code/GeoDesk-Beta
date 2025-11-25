import React, { useState } from "react";

export default function DeformacionPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleUpload = async () => {
    if (files.length < 2) {
      alert("Debes subir mínimo 2 ZIP");
      return;
    }

    setLoading(true);
    const form = new FormData();
    files.forEach(f => form.append("zip_files", f));

    const res = await fetch("http://127.0.0.1:8000/api/deformacion", {
      method: "POST",
      body: form,
    });

    const data = await res.json();
    setImages(data.resultados || []);
    setLoading(false);
  };

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-3">Deformación</h1>

      <input
        type="file"
        multiple
        accept=".zip"
        onChange={e => setFiles(Array.from(e.target.files || []))}
        className="mb-3"
      />

      <button onClick={handleUpload} className="px-4 py-2 bg-blue-600 text-white rounded">
        Procesar
      </button>

      {loading && <p>Procesando...</p>}

      {/* Slider simple */}
      {images.length > 0 && (
        <div className="mt-6">
          {images.map((img, i) => (
            <img key={i} src={`http://127.0.0.1:8000/${img}`} className="mb-4 border" />
          ))}
        </div>
      )}
    </div>
  );
}
