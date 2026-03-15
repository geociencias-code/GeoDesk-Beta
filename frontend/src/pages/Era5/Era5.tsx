import React, { useState } from "react";
import { MapContainer, TileLayer, Rectangle, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { API_URL } from "../../services/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface AreaCoords {
  north: number;
  south: number;
  east: number;
  west: number;
}

const Era5: React.FC = () => {
  const [area, setArea] = useState<AreaCoords | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hours, setHours] = useState<string[]>(["00:00", "12:00"]);
  const [downloading, setDownloading] = useState(false);

  const availableHours = ["00:00", "06:00", "12:00", "18:00"];

  const [startPoint, setStartPoint] = useState<L.LatLng | null>(null);
  const [endPoint, setEndPoint] = useState<L.LatLng | null>(null);

  const MapEvents = () => {
    useMapEvents({
      click(e) {
        if (!startPoint) {
          setStartPoint(e.latlng);
        } else if (!endPoint) {
          setEndPoint(e.latlng);

          const bounds = L.latLngBounds(startPoint, e.latlng);
          const north = bounds.getNorth();
          const south = bounds.getSouth();
          const east = bounds.getEast();
          const west = bounds.getWest();

          if (Math.abs(north - south) < 0.01 || Math.abs(east - west) < 0.01) {
            alert("Dibuja un rectángulo con tamaño válido.");
            setStartPoint(null);
            setEndPoint(null);
            return;
          }

          setArea({ north, south, east, west });
        }
      },
    });
    return null;
  };

  const resetArea = () => {
    setStartPoint(null);
    setEndPoint(null);
    setArea(null);
  };


  const handleDownload = async () => {

    if (!area) {
      return toast.error("Dibuja un área en el mapa para habilitar la descarga.");
      }
    if (!startDate || !endDate)
      return toast.error("Selecciona una fecha de inicio y una fecha de fin.");
    if (hours.length === 0)
      return toast.error("Selecciona al menos una hora de captura para la descarga.");

    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);

    if (start.getFullYear() !== end.getFullYear()) {
      toast.error(`Las fechas deben de estar dentro del mismo año. Años introducidos: ${start.getFullYear()} - ${end.getFullYear()}`);
      return;
    }

    setDownloading(true);

    try {
      const year = start.getFullYear().toString();

      const monthSet = new Set<string>();
      const daySet = new Set<string>();

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        monthSet.add((d.getMonth() + 1).toString().padStart(2, "0"));
        daySet.add(d.getDate().toString().padStart(2, "0"));
      }

      const months = Array.from(monthSet);
      const days = Array.from(daySet);

      const body = {
        variable: ["2m_temperature"], //puede que convierta esto a un selected
        year: [year],
        month: months,
        day: days,
        time: hours,
        area: [area.north, area.west, area.south, area.east],
        dataset: "reanalysis-era5-land",
        format: "netcdf",
      };

      const response = await fetch(
        `${API_URL}/api/era5/download`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) throw new Error("Error al procesar la solicitud.");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `era5_${year}_${months.join("")}.nc`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      toast.success("Archivo descargado correctamente.");
    } catch (err) {
      console.error(err);
      toast.error("Error al descargar el archivo. Intenta nuevamente.");
    } finally {
      setDownloading(false);
    }
  };

  const rectangleBounds =
    startPoint && endPoint ? L.latLngBounds(startPoint, endPoint) : null;

  return (
    <div className="page-container">
      <div className="header-section">
        <div className="icon-wrapper">
          <span style={{ fontSize: "1.5rem" }}>☁️</span>
        </div>
        <div>
          <h1>Descarga de Datos ERA5</h1>
          <p>Modelos climáticos de reanálisis global</p>
        </div>
      </div>

      <div className="layout-grid">
        <div className="upload-panel">
          <div className="upload-card">
            <label>1. Parámetros de Descarga</label>
            
            <div className="era5-dateRow">
              <div className="era5-dateField">
                <label>Fecha inicial:</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="era5-dateField">
                <label>Fecha final:</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="era5-hours" style={{ marginTop: '20px' }}>
              <label>2. Horas de captura:</label>
              <div className="era5-hoursList">
                {availableHours.map((h) => (
                  <label key={h} className="era5-checkboxLabel">
                    <input
                      type="checkbox"
                      checked={hours.includes(h)}
                      onChange={() =>
                        setHours((prev) =>
                          prev.includes(h)
                            ? prev.filter((x) => x !== h)
                            : [...prev, h]
                        )
                      }
                    />
                    {h}
                  </label>
                ))}
              </div>
            </div>
            
            {area && (
              <div className="era5-areaInfo" style={{ marginTop: '20px', padding: '16px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)' }}>
                <p style={{ fontWeight: 'bold', marginBottom: '8px', color: 'var(--color-primary)' }}>3. Región Seleccionada (✓)</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.85rem' }}>
                  <span>N: {area?.north.toFixed(4)}</span>
                  <span>S: {area?.south.toFixed(4)}</span>
                  <span>E: {area?.east.toFixed(4)}</span>
                  <span>W: {area?.west.toFixed(4)}</span>
                </div>
              </div>
            )}
            
            {!area && (
              <div style={{ marginTop: '20px', padding: '16px', borderRadius: '12px', background: 'rgba(255,255,255,0.02)', textAlign: 'center', fontSize: '0.85rem', color: '#94a3b8' }}>
                Dibuja un rectángulo en el mapa para habilitar la descarga.
              </div>
            )}
          </div>

          <button
            onClick={handleDownload}
            disabled={downloading || !area}
            className="submit-btn"
            style={{ marginTop: '10px' }}
          >
            {downloading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Loader2 className="animate-spin" size={20} />
                Descargando...
              </span>
            ) : (
              "Iniciar descarga"
            )}
          </button>
        </div>

        <div className="results-panel">
          <div className="data-widget" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="era5-toolbar" style={{ padding: '16px 20px', background: 'var(--color-bg-card)', borderBottom: '1px solid rgba(255,255,255,0.05)', margin: 0, justifyContent: 'space-between' }}>
              <span className="era5-hint" style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>
                Dibuja el área de trabajo
              </span>
              <button 
                className="era5-btnReset" 
                onClick={resetArea}
                style={{ padding: '6px 14px', fontSize: '0.85rem' }}
              >
                Reiniciar área
              </button>
            </div>
            
            <div className="era5-mapWrapper" style={{ margin: 0, borderRadius: 0, border: 'none', height: '500px' }}>
              {/* Voy a cambiar la forma de como seleccionar */}
              <MapContainer center={[0, 0]} zoom={2} className="era5-map" style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {rectangleBounds && (
                  <Rectangle
                    bounds={rectangleBounds as L.LatLngBoundsExpression}
                    pathOptions={{ color: "#00e5ff", weight: 3, opacity: 0.8 }} 
                  />
                )}
                <MapEvents />
              </MapContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Era5;
