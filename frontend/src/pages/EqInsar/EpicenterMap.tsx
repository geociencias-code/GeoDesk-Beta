import React, { useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Rectangle,
  Popup,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// ── Fix default Leaflet icon (webpack/vite bundler issue) ──────────────────
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// Custom red/orange epicenter icon
const epicenterIcon = new L.DivIcon({
  html: `
    <div style="
      width:22px; height:22px;
      background: radial-gradient(circle, #f87171 30%, #dc2626 70%);
      border: 3px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 0 3px rgba(239,68,68,0.5), 0 2px 8px rgba(0,0,0,0.6);
      position:relative;
    ">
      <div style="
        position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
        width:6px; height:6px; background:#fff; border-radius:50%;
      "></div>
    </div>`,
  className: "",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -14],
});

// Helper: degrees-per-km at a given latitude
function kmToDeg(km: number, lat: number) {
  const latDeg = km / 111.32;
  const lonDeg = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { latDeg, lonDeg };
}

interface FlyToProps {
  lat: number;
  lon: number;
}
function FlyTo({ lat, lon }: FlyToProps) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lon], map.getZoom(), { animate: true, duration: 0.8 });
  }, [lat, lon]);
  return null;
}

export interface EpicenterMapProps {
  lat: number;
  lon: number;
  gridExtentKm: number;
  /** Height of the map div */
  height?: string;
}

const EpicenterMap: React.FC<EpicenterMapProps> = ({
  lat,
  lon,
  gridExtentKm,
  height = "340px",
}) => {
  const { latDeg, lonDeg } = kmToDeg(gridExtentKm / 2, lat);

  const bounds: [[number, number], [number, number]] = [
    [lat - latDeg, lon - lonDeg],
    [lat + latDeg, lon + lonDeg],
  ];

  // Zoom level heuristic based on grid size
  const zoomLevel = gridExtentKm > 200 ? 6 : gridExtentKm > 80 ? 7 : gridExtentKm > 30 ? 8 : 9;

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(248,113,113,0.3)" }}>
      <MapContainer
        center={[lat, lon]}
        zoom={zoomLevel}
        style={{ height, width: "100%" }}
        scrollWheelZoom
      >
        {/* Dark / satellite tile */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {/* Fly to new epicenter when props change */}
        <FlyTo lat={lat} lon={lon} />

        {/* Grid bounding box */}
        <Rectangle
          bounds={bounds}
          pathOptions={{
            color: "#f97316",
            weight: 2,
            fillColor: "#fb923c",
            fillOpacity: 0.08,
            dashArray: "6 4",
          }}
        />

        {/* Epicenter marker */}
        <Marker position={[lat, lon]} icon={epicenterIcon}>
          <Popup>
            <div style={{ fontFamily: "Inter, sans-serif", minWidth: 160 }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: "#dc2626" }}>
                🔴 Epicentro
              </div>
              <div style={{ fontSize: "0.82rem", lineHeight: 1.6 }}>
                <b>Lat:</b> {lat.toFixed(4)}°<br />
                <b>Lon:</b> {lon.toFixed(4)}°<br />
                <b>Grilla:</b> ±{(gridExtentKm / 2).toFixed(0)} km
              </div>
            </div>
          </Popup>
        </Marker>
      </MapContainer>

      {/* Legend */}
      <div style={{
        background: "rgba(10,15,30,0.9)",
        padding: "6px 12px",
        fontSize: "0.72rem",
        color: "#94a3b8",
        display: "flex",
        gap: 16,
        alignItems: "center",
      }}>
        <span>
          <span style={{ color: "#f87171", marginRight: 4 }}>●</span>
          Epicentro ({lat.toFixed(4)}°, {lon.toFixed(4)}°)
        </span>
        <span>
          <span style={{ color: "#fb923c", marginRight: 4 }}>◻</span>
          Grilla {gridExtentKm} × {gridExtentKm} km
        </span>
      </div>
    </div>
  );
};

export default EpicenterMap;
