import React, { useState } from "react";
import { motion } from "framer-motion";

export default function TempDeformUploader() {
  const [ncFile, setNcFile] = useState<File | null>(null);
  const [zipFiles, setZipFiles] = useState<File[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNcChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setNcFile(e.target.files[0]);
    }
  };

  const handleZipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setZipFiles(Array.from(e.target.files));
    }
  };

  const handleUpload = async () => {
    if (!ncFile || zipFiles.length === 0) return;

    const formData = new FormData();
    formData.append("nc_file", ncFile);
    zipFiles.forEach((file) => formData.append("zip_files", file));

    setLoading(true);
    setError(null);

    try {
      const resProcess = await fetch("http://localhost:8000/api/temperatura_deformacion", {
        method: "POST",
        body: formData,
      });

      if (!resProcess.ok) {
        throw new Error(`Error del backend: ${resProcess.status}`);
      }

      // Obtener lista de imágenes generadas
      const res = await fetch("http://localhost:8000/api/temperatura_deformacion/list");
      const data = await res.json();

      if (!data.images || data.images.length === 0) {
        setImages([]);
        setError("No se generó ninguna imagen. Revisa tus archivos.");
        return;
      }

      setImages(data.images);
      setCurrentIndex(0);

    } catch (err: any) {
      setError(err.message || "Error inesperado");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const nextImage = () => {
    setCurrentIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = () => {
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-2xl mx-auto p-6"
    >
      <div className="rounded-2xl shadow-lg p-4 bg-white">
        <div className="grid gap-4">
          <h2 className="text-xl font-bold">Temperatura vs Deformación (LOS)</h2>

          {/* SELECTORES */}
          <div className="grid gap-2">
            <label className="font-medium">Archivo .nc</label>
            <input type="file" accept=".nc" onChange={handleNcChange} className="p-2 border rounded" />
          </div>

          <div className="grid gap-2">
            <label className="font-medium">Archivos .zip (1 o varios)</label>
            <input type="file" accept=".zip" multiple onChange={handleZipChange} className="p-2 border rounded" />
          </div>

          <button
            onClick={handleUpload}
            disabled={loading || !ncFile || zipFiles.length === 0}
            className="mt-2 p-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            {loading ? "Generando..." : "Procesar"}
          </button>

          {/* ERROR */}
          {error && (
            <div className="p-2 bg-red-100 text-red-700 rounded text-sm">
              {error}
            </div>
          )}

          {/* SLIDER / TIMELINE */}
          {images.length > 0 && (
            <div className="mt-6 grid gap-4">
              {/* CONTROLES */}
              <div className="flex items-center justify-between">
                <button onClick={prevImage} className="px-3 py-1 bg-gray-200 rounded">◀</button>

                <span className="font-semibold">
                  {images[currentIndex].replace("temperatura_deformacion/", "")}
                </span>

                <button onClick={nextImage} className="px-3 py-1 bg-gray-200 rounded">▶</button>
              </div>

              {/* SLIDER */}
              <input
                type="range"
                min={0}
                max={images.length - 1}
                value={currentIndex}
                onChange={(e) => setCurrentIndex(Number(e.target.value))}
                className="w-full"
              />

              {/* IMAGEN */}
              <img
                src={`http://localhost:8000/${images[currentIndex]}`}
                alt="temp_def_graph"
                className="rounded-xl shadow-md"
              />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
