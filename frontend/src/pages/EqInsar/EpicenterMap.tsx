import React, { useEffect } from "react";
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

// ── Fix default Leaflet icon ──────────────────────────────────────────────
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// Custom red epicenter icon
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

// Grid center icon (orange square)
const gridCenterIcon = new L.DivIcon({
  html: `
    <div style="
      width:14px; height:14px;
      background: rgba(251,146,60,0.85);
      border: 2px solid #fff;
      border-radius: 3px;
      box-shadow: 0 1px 6px rgba(0,0,0,0.5);
    "></div>`,
  className: "",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  popupAnchor: [0, -10],
});

/**
 * Convierte km a grados de latitud/longitud en una latitud dada.
 */
function kmToDeg(km: number, lat: number) {
  const latDeg = km / 111.32;
  const lonDeg = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { latDeg, lonDeg };
}

interface FlyToProps { lat: number; lon: number; }
function FlyTo({ lat, lon }: FlyToProps) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lon], map.getZoom(), { animate: true, duration: 0.8 });
  }, [lat, lon]);
  return null;
}

export interface EpicenterMapProps {
  /** Coordenadas del epicentro del sismo */
  lat: number;
  lon: number;
  /** Semiancho de la grilla en km (grid_extent_km) */
  gridExtentKm: number;
  /**
   * Offset del epicentro respecto al centro de la grilla (xcen_km, ycen_km).
   * El centro de la grilla queda en:
   *   grid_center = epicentro - (xcen_km, ycen_km)
   * Es decir, xcen_km=+20 desplaza la fuente 20 km al este del centro de grilla,
   * lo que mueve la grilla 20 km al OESTE del epicentro.
   */
  xcenKm?: number;
  ycenKm?: number;
  height?: string;
}

const EpicenterMap: React.FC<EpicenterMapProps> = ({
  lat,
  lon,
  gridExtentKm,
  xcenKm = 0,
  ycenKm = 0,
  height = "340px",
}) => {
  // Centro de la grilla en coordenadas geográficas
  // xcen_km es el offset del epicentro desde el centro de grilla en X (este)
  // ycen_km es el offset del epicentro desde el centro de grilla en Y (norte)
  // → centro_grilla = epicentro − offset
  const { lonDeg: xcenLonOff } = kmToDeg(Math.abs(xcenKm), lat);
  const { latDeg: ycenLatOff }                      = kmToDeg(Math.abs(ycenKm), lat);

  const gridCenterLat = lat - (ycenKm >= 0 ? ycenLatOff : -ycenLatOff);
  const gridCenterLon = lon - (xcenKm >= 0 ? xcenLonOff : -xcenLonOff);

  // Extensión de la grilla en grados desde el centro
  const { latDeg: extLatDeg, lonDeg: extLonDeg } = kmToDeg(gridExtentKm, gridCenterLat);

  const bounds: [[number, number], [number, number]] = [
    [gridCenterLat - extLatDeg, gridCenterLon - extLonDeg],
    [gridCenterLat + extLatDeg, gridCenterLon + extLonDeg],
  ];

  // Vuelo centrado en la grilla (no en el epicentro)
  const viewLat = gridCenterLat;
  const viewLon = gridCenterLon;

  const zoomLevel = gridExtentKm > 200 ? 6 : gridExtentKm > 80 ? 7 : gridExtentKm > 30 ? 8 : 9;

  const hasOffset = xcenKm !== 0 || ycenKm !== 0;

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(248,113,113,0.3)" }}>
      <MapContainer
        center={[viewLat, viewLon]}
        zoom={zoomLevel}
        style={{ height, width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        <FlyTo lat={viewLat} lon={viewLon} />

        {/* Rectángulo de la grilla — centrado en grid_center */}
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

        {/* Marcador del epicentro del sismo */}
        <Marker position={[lat, lon]} icon={epicenterIcon}>
          <Popup>
            <div style={{ fontFamily: "Inter, sans-serif", minWidth: 160 }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: "#dc2626" }}>
                🔴 Epicentro del Sismo
              </div>
              <div style={{ fontSize: "0.82rem", lineHeight: 1.6 }}>
                <b>Lat:</b> {lat.toFixed(5)}°<br />
                <b>Lon:</b> {lon.toFixed(5)}°
              </div>
            </div>
          </Popup>
        </Marker>

        {/* Marcador del centro de la grilla (solo si hay offset) */}
        {hasOffset && (
          <Marker position={[gridCenterLat, gridCenterLon]} icon={gridCenterIcon}>
            <Popup>
              <div style={{ fontFamily: "Inter, sans-serif", minWidth: 180 }}>
                <div style={{ fontWeight: 700, marginBottom: 4, color: "#ea580c" }}>
                  🟧 Centro de la Grilla
                </div>
                <div style={{ fontSize: "0.82rem", lineHeight: 1.6 }}>
                  <b>Lat:</b> {gridCenterLat.toFixed(5)}°<br />
                  <b>Lon:</b> {gridCenterLon.toFixed(5)}°<br />
                  <b>Offset X:</b> {xcenKm > 0 ? "+" : ""}{xcenKm} km<br />
                  <b>Offset Y:</b> {ycenKm > 0 ? "+" : ""}{ycenKm} km
                </div>
              </div>
            </Popup>
          </Marker>
        )}
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
        flexWrap: "wrap",
      }}>
        <span>
          <span style={{ color: "#f87171", marginRight: 4 }}>●</span>
          Epicentro ({lat.toFixed(4)}°, {lon.toFixed(4)}°)
        </span>
        {hasOffset && (
          <span>
            <span style={{ color: "#fb923c", marginRight: 4 }}>■</span>
            Centro grilla ({xcenKm > 0 ? "+" : ""}{xcenKm} km E, {ycenKm > 0 ? "+" : ""}{ycenKm} km N)
          </span>
        )}
        <span>
          <span style={{ color: "#fb923c", marginRight: 4 }}>◻</span>
          Grilla {gridExtentKm * 2} × {gridExtentKm * 2} km
        </span>
      </div>
    </div>
  );
};

export default EpicenterMap;
