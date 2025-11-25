import React, { useState } from "react";
import { MapContainer, TileLayer, Rectangle, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "./era5.css";

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
            alert("⚠️ Dibuja un rectángulo con tamaño válido.");
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

  // ========================================
  // DESCARGA DE ERA5 (misma lógica de siempre)
  // ========================================
  const handleDownload = async () => {
    if (!area) return alert("⚠️ Selecciona un área en el mapa.");
    if (!startDate || !endDate)
      return alert("⚠️ Selecciona un rango de fechas válido.");
    if (hours.length === 0)
      return alert("⚠️ Selecciona al menos una hora.");

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Validar que no se cruce el año
    if (start.getFullYear() !== end.getFullYear()) {
      alert("⚠️ Solo puedes seleccionar fechas dentro del mismo año.");
      return;
    }

    setDownloading(true);

    try {
      const year = start.getFullYear().toString();

      // Generar meses y días completos
      const monthSet = new Set<string>();
      const daySet = new Set<string>();

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        monthSet.add((d.getMonth() + 1).toString().padStart(2, "0"));
        daySet.add(d.getDate().toString().padStart(2, "0"));
      }

      const months = Array.from(monthSet);
      const days = Array.from(daySet);

      const body = {
        variable: ["2m_temperature"],
        year: [year],
        month: months,
        day: days,
        time: hours,
        area: [area.north, area.west, area.south, area.east],
        dataset: "reanalysis-era5-land",
        format: "netcdf",
      };

      const response = await fetch(
        "http://127.0.0.1:8000/api/era5/download",
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

      alert("✅ Archivo descargado correctamente.");
    } catch (err) {
      console.error(err);
      alert("❌ Error al descargar datos ERA5.");
    } finally {
      setDownloading(false);
    }
  };

  const rectangleBounds =
    startPoint && endPoint ? L.latLngBounds(startPoint, endPoint) : null;

  return (
    <div className="era5-container">
      <h2 className="era5-title">🗺️ Selecciona el área de trabajo</h2>

      <div className="era5-mapWrapper">
        <MapContainer center={[0, 0]} zoom={2} className="era5-map">
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {rectangleBounds && (
            <Rectangle
              bounds={rectangleBounds}
              pathOptions={{ color: "#5D5FEF", weight: 3, opacity: 0.7 }} // azul del rectángulo
            />
          )}
          <MapEvents />
        </MapContainer>
      </div>

      <div className="era5-toolbar">
        <button className="era5-btnReset" onClick={resetArea}>
          Reiniciar área
        </button>
        {!area && (
          <small className="era5-hint">
            Haz click para iniciar y finalizar el rectángulo.
          </small>
        )}
        {area && (
          <small className="era5-hint">Área seleccionada ✓</small>
        )}
      </div>

      {area && (
        <div className="era5-areaInfo">
          <p>
            <b>📦 Región seleccionada:</b>
          </p>
          <p>🔹 Norte: {area.north.toFixed(6)}</p>
          <p>🔹 Sur: {area.south.toFixed(6)}</p>
          <p>🔹 Oeste: {area.west.toFixed(6)}</p>
          <p>🔹 Este: {area.east.toFixed(6)}</p>
        </div>
      )}

      {area && (
        <>
          <hr className="era5-divider" />
          <h3 className="era5-subtitle">📅 Parámetros de descarga</h3>

          <div className="era5-dateRow">
            <div className="era5-dateField">
              <label>Fecha inicial:</label>
              <br />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="era5-dateField">
              <label>Fecha final:</label>
              <br />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="era5-hours">
            <label>🕒 Selecciona horas:</label>
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

          <button
            onClick={handleDownload}
            disabled={downloading}
            className={`era5-downloadBtn ${
              downloading ? "is-disabled" : ""
            }`}
          >
            {downloading ? "Descargando..." : "Iniciar descarga"}
          </button>
        </>
      )}
    </div>
  );
};

export default Era5;
