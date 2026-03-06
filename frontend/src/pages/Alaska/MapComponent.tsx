import React, { useState, useCallback } from "react";
import { MapContainer, TileLayer, Polygon, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

interface MapComponentProps {
  onPolygonChange: (polygonWkt: string) => void;
  height?: string;
  className?: string;
}

const MapComponent: React.FC<MapComponentProps> = ({
  onPolygonChange,
  height = "55vh",
  className = "",
}) => {
  const [startPoint, setStartPoint] = useState<L.LatLng | null>(null);
  const [endPoint, setEndPoint] = useState<L.LatLng | null>(null);
  const [closed, setClosed] = useState(false);

  const toWKT = useCallback((p1: L.LatLng, p2: L.LatLng) => {
    const p3 = L.latLng(p1.lat, p2.lng);
    const p4 = L.latLng(p2.lat, p1.lng);
    const ring = [
      `${p1.lng} ${p1.lat}`,
      `${p3.lng} ${p3.lat}`,
      `${p2.lng} ${p2.lat}`,
      `${p4.lng} ${p4.lat}`,
      `${p1.lng} ${p1.lat}`
    ];
    return `POLYGON((${ring.join(",")}))`;
  }, []);

  const getRectanglePoints = useCallback((p1: L.LatLng, p2: L.LatLng) => {
    const p3 = L.latLng(p1.lat, p2.lng);
    const p4 = L.latLng(p2.lat, p1.lng);
    return [p1, p3, p2, p4];
  }, []);

  const MapEvents = () => {
    useMapEvents({
      dblclick(e) {
        if (closed) return;
        setStartPoint(e.latlng);
        setEndPoint(e.latlng);
      },
      click(e) {
        if (closed) return;
        
        if (startPoint) {
          setEndPoint(e.latlng);
          setClosed(true);
          onPolygonChange(toWKT(startPoint, e.latlng));
        }
      },
      mousemove(e) {
        // dynamic drawing as ptr moves
        if (startPoint && !closed) {
          setEndPoint(e.latlng);
        }
      },
    });
    return null;
  };

  const reset = () => {
    setStartPoint(null);
    setEndPoint(null);
    setClosed(false);
    onPolygonChange("");
  };

  const currentRect = startPoint && endPoint ? getRectanglePoints(startPoint, endPoint) : [];

  return (
    <div className={`alaska-map-container ${className}`}>
      <div className="alaska-map-card">

        <div className="map-header">
          <h3>Área de interés</h3>
          <p>Selecciona la región en el mapa</p>
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

            {currentRect.length === 4 && (
              <Polygon
                positions={currentRect}
                pathOptions={{ color: "#5D5FEF", weight: 3, opacity: 0.7 }}
              />
            )}

            <MapEvents />
          </MapContainer>
        </div>

        <div className="alaska-map-footer">
          <button className="alaska-btn" onClick={reset}>Reiniciar área</button>

          {!closed && startPoint === null && (
            <small className="map-hint">Haz doble clic para iniciar la selección.</small>
          )}
          {!closed && startPoint !== null && (
            <small className="map-hint">Mueve el puntero y haz un clic para confirmar.</small>
          )}
          {closed && <small className="map-hint success">Cuadro cerrado ✓</small>}
        </div>

      </div>
    </div>
  );
};

export default MapComponent;
