import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileUp, CloudRain, Image as ImageIcon, ChevronLeft, ChevronRight, X, Info, Download, Table2 } from "lucide-react";
import axios from "axios";
import { API_URL } from "../../services/api";

type AnalysisResult = {
  fecha: string;
  disp_min: number;
  disp_max: number;
  temp_promedio: number;
  img_url: string;
  csv_url?: string;
  data_preview?: Array<{
    Latitud: number;
    Longitud: number;
    Valor_Sentinel: number;
    "Temp_ERA5_(K)": number;
    "Factor_Error_(%)": number;
  }>;
};

export default function Era5SentinelComparative() {
  const [ncFile, setNcFile] = useState<File | null>(null);
  const [zipFiles, setZipFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

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

  const removeZipFile = (index: number) => {
    setZipFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (!ncFile || zipFiles.length === 0) {
      setError("Por favor, selecciona un archivo .nc de ERA5 y al menos un .zip de Sentinel.");
      return;
    }

    const formData = new FormData();
    formData.append("nc_file", ncFile);
    zipFiles.forEach((file) => formData.append("zip_files", file));

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const res = await axios.post(`${API_URL}/api/v1/era5_sentinel_comparative`, formData);
      const data = res.data;

      if (!data.resultados || data.resultados.length === 0) {
        setError("No se pudo generar la comparativa con los archivos proporcionados.");
        return;
      }

      setResults(data.resultados);
      setCurrentIndex(0);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response) {
        setError(err.response.data.detail || "Error al procesar archivos");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Error inesperado al conectar con el servidor.");
      }
      console.error("Error upload:", err);
    } finally {
      setLoading(false);
    }
  };

  const nextImage = () => setCurrentIndex((prev) => (prev + 1) % results.length);
  const prevImage = () => setCurrentIndex((prev) => (prev - 1 + results.length) % results.length);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="w-full max-w-5xl mx-auto py-8"
    >
      <div className="bg-white/80 backdrop-blur-xl border border-white/20 shadow-2xl rounded-3xl p-8 transition-all">
        <div className="flex items-center gap-3 mb-8 pb-4 border-b border-gray-100">
          <div className="bg-blue-600/10 p-3 rounded-2xl">
            <CloudRain className="w-8 h-8 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-indigo-600">
              Comparativa ERA5 & Sentinel
            </h1>
            <p className="text-gray-500 mt-1 font-medium">Unificación espacio-temporal y contextual</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Upload Section */}
          <div className="col-span-1 lg:col-span-5 space-y-6">
            <div className="bg-gray-50/50 p-5 rounded-2xl border border-gray-100">
              <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <CloudRain className="w-4 h-4 text-blue-500" />
                Contexto Meteorológico (ERA5)
              </label>
              <div className="relative group">
                <input
                  type="file"
                  accept=".nc"
                  onChange={handleNcChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="flex items-center justify-center p-4 border-2 border-dashed border-blue-200 rounded-xl bg-blue-50/30 group-hover:bg-blue-50 transition-colors">
                  {ncFile ? (
                    <span className="text-sm font-medium text-blue-700 truncate px-2">{ncFile.name}</span>
                  ) : (
                    <span className="text-sm text-gray-400 font-medium">Click para seleccionar archivo .nc</span>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-gray-50/50 p-5 rounded-2xl border border-gray-100">
              <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-indigo-500" />
                Imágenes Satelitales (Sentinel)
              </label>
              <div className="relative group mb-3">
                <input
                  type="file"
                  accept=".zip"
                  multiple
                  onChange={handleZipChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="flex items-center justify-center p-4 border-2 border-dashed border-indigo-200 rounded-xl bg-indigo-50/30 group-hover:bg-indigo-50 transition-colors">
                  <span className="text-sm text-gray-400 font-medium flex-1 text-center">Seleccionar múltiples archivos .zip</span>
                  <FileUp className="w-5 h-5 text-indigo-400" />
                </div>
              </div>

              {zipFiles.length > 0 && (
                <ul className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                  {zipFiles.map((file, i) => (
                    <li key={i} className="flex justify-between items-center text-xs bg-white border border-gray-100 p-2 rounded-lg shadow-sm">
                      <span className="truncate flex-1 font-medium text-gray-600">{file.name}</span>
                      <button
                        onClick={() => removeZipFile(i)}
                        className="p-1 hover:bg-red-50 text-red-400 hover:text-red-500 rounded-md transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="pt-2">
              <button
                onClick={handleUpload}
                disabled={loading || !ncFile || zipFiles.length === 0}
                className="w-full relative overflow-hidden group bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold py-4 px-6 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-500/30"
              >
                <div className="absolute inset-0 w-full h-full bg-white/20 group-hover:translate-x-full transition-transform duration-500 -translate-x-full skew-x-12" />
                <span className="relative flex justify-center items-center gap-2">
                  {loading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Procesando...
                    </>
                  ) : (
                    "Generar Comparativa"
                  )}
                </span>
              </button>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-red-50/80 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-start gap-2 shadow-sm"
                >
                  <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <p className="font-medium font-sans leading-relaxed">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Results Display */}
          <div className="col-span-1 lg:col-span-7 flex flex-col">
            {results.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-3xl bg-gray-50/50 min-h-[400px]">
                <div className="text-gray-300 mb-4">
                  <ImageIcon className="w-20 h-20" />
                </div>
                <h3 className="text-lg font-medium text-gray-500">No hay resultados visibles</h3>
                <p className="text-sm text-gray-400 mt-2 max-w-sm text-center">
                  Sube los datos meteorológicos y satelitales para visualizar el cruce de variables (heatmap overlay).
                </p>
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col gap-6"
              >
                {/* Visualizer */}
                <div className="relative rounded-3xl overflow-hidden shadow-2xl bg-gray-900 group">
                  <img
                    src={`${API_URL}/${results[currentIndex].img_url}`}
                    alt={`Comparativa ${results[currentIndex].fecha}`}
                    className="w-full h-auto object-cover max-h-[600px] transition-transform duration-700 ease-out hover:scale-[1.02]"
                  />
                  
                  {/* Floating Controls Overlay */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-gray-900/90 via-gray-900/40 to-transparent p-6 pt-20">
                    <div className="flex items-end justify-between">
                      <div className="text-white">
                        <div className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-300 drop-shadow-sm mb-1">
                          {results[currentIndex].fecha}
                        </div>
                        <div className="flex gap-4 text-xs font-medium text-gray-300 bg-black/40 px-3 py-1.5 rounded-lg backdrop-blur-md border border-white/10 w-fit">
                          <span>Temp (ERA5): {results[currentIndex].temp_promedio.toFixed(2)} K</span>
                          <div className="w-px bg-gray-600"></div>
                          <span>Disp Min: {results[currentIndex].disp_min.toFixed(2)}</span>
                          <div className="w-px bg-gray-600"></div>
                          <span>Disp Max: {results[currentIndex].disp_max.toFixed(2)}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={prevImage}
                          className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white border border-white/10 transition-all hover:scale-110 active:scale-95 shadow-lg"
                        >
                          <ChevronLeft className="w-5 h-5" />
                        </button>
                        <span className="text-white font-medium px-2 py-1 bg-black/40 rounded-lg min-w-[3rem] text-center text-sm border border-white/10">
                          {currentIndex + 1} / {results.length}
                        </span>
                        <button
                          onClick={nextImage}
                          className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white border border-white/10 transition-all hover:scale-110 active:scale-95 shadow-lg"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Timeline Slider */}
                <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 shadow-sm">
                  <div className="flex justify-between text-xs font-semibold text-gray-400 mb-3 px-1 uppercase tracking-wider">
                    <span>Inicio</span>
                    <span>T={results.length}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={results.length - 1}
                    value={currentIndex}
                    onChange={(e) => setCurrentIndex(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 outline-none
                               hover:accent-blue-700 transition-colors"
                  />
                  <div className="mt-4 flex flex-wrap gap-2 justify-center">
                    {results.map((_, idx) => (
                      <button
                        key={idx}
                        onClick={() => setCurrentIndex(idx)}
                        className={`w-2 h-2 rounded-full transition-all duration-300 ${
                          currentIndex === idx ? "bg-blue-600 w-6 shadow-md shadow-blue-500/30" : "bg-gray-300 hover:bg-gray-400"
                        }`}
                        aria-label={`Ir a imagen ${idx}`}
                      />
                    ))}
                  </div>
                </div>

                {/* Data Preview & Download */}
                {results[currentIndex].csv_url && results[currentIndex].data_preview && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white p-6 rounded-3xl border border-gray-100 shadow-xl overflow-hidden"
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                      <div className="flex items-center gap-3">
                        <div className="bg-emerald-100 p-2.5 rounded-xl">
                          <Table2 className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                          <h4 className="text-lg font-bold text-gray-800">Datos y Factor de Error</h4>
                          <p className="text-sm text-gray-500 font-medium tracking-wide">Previsualización de coordenadas locales</p>
                        </div>
                      </div>
                      
                      <a
                        href={`${API_URL}/${results[currentIndex].csv_url}`}
                        download
                        className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-5 py-2.5 rounded-xl font-semibold shadow-md shadow-emerald-500/20 hover:shadow-lg hover:-translate-y-0.5 transition-all outline-none focus:ring-4 focus:ring-emerald-500/30"
                      >
                        <Download className="w-4 h-4" />
                        <span>Exportar CSV Completo</span>
                      </a>
                    </div>
                    
                    <div className="overflow-x-auto rounded-xl border border-gray-100 max-h-72 custom-scrollbar">
                      <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-gray-50/80 sticky top-0 backdrop-blur-md shadow-sm">
                          <tr className="text-gray-600">
                            <th className="px-5 py-3.5 font-semibold">Latitud</th>
                            <th className="px-5 py-3.5 font-semibold">Longitud</th>
                            <th className="px-5 py-3.5 font-semibold text-center border-l border-gray-100">Temp ERA5 (K)</th>
                            <th className="px-5 py-3.5 font-semibold border-l border-gray-100">Sentinel (Base)</th>
                            <th className="px-5 py-3.5 font-bold text-red-600 border-l border-gray-100 text-center">Factor Error (%)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-gray-600">
                          {results[currentIndex].data_preview.map((row, i) => (
                            <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                              <td className="px-5 py-2.5 font-mono text-xs">{row.Latitud.toFixed(5)}</td>
                              <td className="px-5 py-2.5 font-mono text-xs">{row.Longitud.toFixed(5)}</td>
                              <td className="px-5 py-2.5 font-mono text-xs text-center border-l border-gray-100">{row["Temp_ERA5_(K)"].toFixed(2)}</td>
                              <td className="px-5 py-2.5 font-mono text-xs border-l border-gray-100 text-gray-500">{row.Valor_Sentinel.toFixed(4)}</td>
                              <td className="px-5 py-2.5 border-l border-gray-100">
                                <div className="flex items-center justify-end gap-2">
                                  <span className="font-mono font-bold text-xs" style={{ color: `hsl(${120 - (row["Factor_Error_(%)"] * 1.2)}, 70%, 45%)` }}>
                                    {row["Factor_Error_(%)"].toFixed(2)}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="text-center mt-3 text-xs text-gray-400">
                      Mostrando muestra de hasta 100 filas (downsampled). Descarga el CSV para ver {">"} 20,000+ puntos.
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
