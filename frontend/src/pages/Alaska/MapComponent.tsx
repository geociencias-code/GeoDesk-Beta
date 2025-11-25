import React, { useState, useCallback } from "react";
import { MapContainer, TileLayer, Polygon, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

interface MapComponentProps {
  onPolygonChange: (polygonWkt: string) => void;
  height?: string;
  className?: string; // <--- NUEVO: Permite estilos externos
}

const MapComponent: React.FC<MapComponentProps> = ({
  onPolygonChange,
  height = "55vh",
  className = "",
}) => {
  const [points, setPoints] = useState<L.LatLng[]>([]);
  const [closed, setClosed] = useState(false);

  const toWKT = useCallback((pts: L.LatLng[]) => {
    const ring = [...pts.map((p) => `${p.lng} ${p.lat}`)];
    ring.push(`${pts[0].lng} ${pts[0].lat}`);
    return `POLYGON((${ring.join(",")}))`;
  }, []);

  const MapEvents = () => {
    useMapEvents({
      click(e) {
        if (closed || points.length === 2) return;

        setPoints((prev) => {
          const newPoints = [...prev, e.latlng];
          if (newPoints.length === 2) {
            const [p1, p2] = newPoints;

            const p3 = L.latLng(p1.lat, p2.lng);
            const p4 = L.latLng(p2.lat, p1.lng);

            const rectangle = [p1, p3, p2, p4];

            setClosed(true);
            onPolygonChange(toWKT(rectangle));

            return rectangle;
          }
          return newPoints;
        });
      },
    });
    return null;
  };

  const reset = () => {
    setPoints([]);
    setClosed(false);
    onPolygonChange("");
  };

  return (
    <div className={`alaska-map-container ${className}`}>
      {/* Wrapper con estilos modernos */}
      <div className="alaska-map-card">

        {/* Encabezado */}
        <div className="map-header">
          <h3>Área de interés</h3>
          <p>Dibuja un rectángulo con dos clics</p>
        </div>

        {/* Mapa */}
        <div className="alaska-map-wrapper" style={{ height }}>
          <MapContainer
            center={[13.7, -88.9]}
            zoom={8}
            className="alaska-map"
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom
            doubleClickZoom={false}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

            {points.length === 4 && (
              <Polygon
                positions={points}
                pathOptions={{ color: "#5D5FEF", weight: 3, opacity: 0.7 }}
              />
            )}

            <MapEvents />
          </MapContainer>
        </div>

        {/* Footer */}
        <div className="alaska-map-footer">
          <button className="alaska-btn" onClick={reset}>Reiniciar área</button>

          {!closed && (
            <small className="map-hint">Haz dos clics para formar el área.</small>
          )}
          {closed && <small className="map-hint success">Cuadro cerrado ✓</small>}
        </div>

      </div>
    </div>
  );
};

export default MapComponent;
