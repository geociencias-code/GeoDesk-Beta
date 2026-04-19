import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Rectangle,
  useMapEvents,
  Tooltip as LeafletTooltip,
  Marker,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

export interface PathFrameOption {
  ruta: number;
  marco: number;
  scene_count: number;
  bbox: { lat_min: number; lat_max: number; lon_min: number; lon_max: number };
  is_preferred: boolean;
}

interface MapComponentProps {
  onPolygonChange: (polygonWkt: string) => void;
  height?: string;
  className?: string;
  pathFrameOptions?: PathFrameOption[];
  selectedRuta?: number | null;
  selectedMarco?: number | null;
  onPathFrameSelect?: (ruta: number, marco: number) => void;
  pathFrameLoading?: boolean;
}

function toWKT(p1: L.LatLng, p2: L.LatLng): string {
  const coords = [
    [p1.lng, p1.lat],
    [p1.lng, p2.lat],
    [p2.lng, p2.lat],
    [p2.lng, p1.lat],
    [p1.lng, p1.lat],
  ];
  return `POLYGON((${coords.map((c) => `${c[0]} ${c[1]}`).join(",")}))`;
}

function toLeafletRect(p1: L.LatLng, p2: L.LatLng): L.LatLng[] {
  return [p1, L.latLng(p1.lat, p2.lng), p2, L.latLng(p2.lat, p1.lng)];
}

// DrawLayer must be a separate component (defined outside) to avoid stale closure in useMapEvents
interface DrawLayerProps {
  anchorRef: React.MutableRefObject<L.LatLng | null>;
  doneRef: React.MutableRefObject<boolean>;
  onAnchorSet: (ll: L.LatLng) => void;
  onMouseMove: (ll: L.LatLng) => void;
  onCommit: (ll: L.LatLng) => void;
}

const DrawLayer: React.FC<DrawLayerProps> = ({ anchorRef, doneRef, onAnchorSet, onMouseMove, onCommit }) => {
  useMapEvents({
    click(e) {
      if (doneRef.current) return;
      if (!anchorRef.current) {
        // First click — set anchor
        console.log("[MapComponent] Anchor set", e.latlng);
        onAnchorSet(e.latlng);
      } else {
        // Second click — commit
        console.log("[MapComponent] Committing polygon", anchorRef.current, e.latlng);
        onCommit(e.latlng);
      }
    },
    mousemove(e) {
      if (anchorRef.current && !doneRef.current) {
        onMouseMove(e.latlng);
      }
    },
  });
  return null;
};

const MapComponent: React.FC<MapComponentProps> = ({
  onPolygonChange,
  height = "55vh",
  className = "",
  pathFrameOptions = [],
  selectedRuta = null,
  selectedMarco = null,
  onPathFrameSelect,
  pathFrameLoading = false,
}) => {
  const [anchor, setAnchor] = useState<L.LatLng | null>(null);
  const [live, setLive] = useState<L.LatLng | null>(null);
  const [done, setDone] = useState(false);

  // Refs so DrawLayer can read current values without stale closure
  const anchorRef = useRef<L.LatLng | null>(null);
  const doneRef = useRef(false);
  const onPolygonChangeRef = useRef(onPolygonChange);
  useEffect(() => { onPolygonChangeRef.current = onPolygonChange; });

  const handleAnchorSet = useCallback((ll: L.LatLng) => {
    anchorRef.current = ll;
    setAnchor(ll);
    setLive(ll);
    setDone(false);
  }, []);

  const handleMouseMove = useCallback((ll: L.LatLng) => {
    setLive(ll);
  }, []);

  const handleCommit = useCallback((ll: L.LatLng) => {
    const a = anchorRef.current;
    if (!a) return;
    const dist = a.distanceTo(ll);
    if (dist < 5000) {
      console.log("[MapComponent] Too small, ignoring", dist, "m");
      return;
    }
    const wkt = toWKT(a, ll);
    console.log("[MapComponent] WKT ready, calling onPolygonChange:", wkt);
    doneRef.current = true;
    setDone(true);
    setLive(ll);
    // Call directly — no setTimeout needed
    onPolygonChangeRef.current(wkt);
    console.log("[MapComponent] onPolygonChange called");
  }, []);

  const reset = useCallback(() => {
    anchorRef.current = null;
    doneRef.current = false;
    setAnchor(null);
    setLive(null);
    setDone(false);
    onPolygonChangeRef.current("");
  }, []);

  const aoi = anchor && live ? toLeafletRect(anchor, live) : null;

  const getOptionColor = (opt: PathFrameOption): string => {
    if (opt.ruta === selectedRuta && opt.marco === selectedMarco) return "#22c55e";
    if (opt.is_preferred) return "#f59e0b";
    return "#3b82f6";
  };

  const hint = (() => {
    if (pathFrameLoading) return { text: "⏳ Buscando rutas disponibles…", color: "#64748b" };
    if (!anchor) return { text: "Haz clic para el primer extremo del área.", color: "var(--color-text-muted)" };
    if (!done) return { text: "Haz clic para confirmar el área.", color: "#93c5fd" };
    if (done && pathFrameOptions.length === 0)
      return { text: "⚠️ No se encontraron rutas — prueba otras fechas.", color: "#f59e0b" };
    if (done && selectedRuta != null)
      return { text: `✓ Ruta ${selectedRuta} / Marco ${selectedMarco} seleccionada`, color: "#34d399" };
    if (done)
      return { text: `Haz clic en un rectángulo para seleccionar la ruta (${pathFrameOptions.length} disponibles).`, color: "var(--color-text-muted)" };
    return null;
  })();

  return (
    <div className={`alaska-map-container ${className}`} style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: height }}>
      <div style={{ flex: 1, position: "relative" }}>
        <MapContainer
          center={[13.7, -88.9]}
          zoom={8}
          style={{ height, width: "100%" }}
          scrollWheelZoom
          doubleClickZoom={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          <DrawLayer
            anchorRef={anchorRef}
            doneRef={doneRef}
            onAnchorSet={handleAnchorSet}
            onMouseMove={handleMouseMove}
            onCommit={handleCommit}
          />

          {/* Show anchor marker while drawing */}
          {anchor && !done && (
            <Marker position={anchor} />
          )}

          {/* Path/frame rectangles */}
          {pathFrameOptions.map((opt) => {
            const color = getOptionColor(opt);
            const isSelected = opt.ruta === selectedRuta && opt.marco === selectedMarco;
            return (
              <Rectangle
                key={`${opt.ruta}-${opt.marco}`}
                bounds={[
                  [opt.bbox.lat_min, opt.bbox.lon_min],
                  [opt.bbox.lat_max, opt.bbox.lon_max],
                ]}
                pathOptions={{
                  color,
                  weight: isSelected ? 3 : 2,
                  fillColor: color,
                  fillOpacity: isSelected ? 0.25 : 0.12,
                  dashArray: isSelected ? undefined : "6 4",
                }}
                eventHandlers={{ click: () => onPathFrameSelect?.(opt.ruta, opt.marco) }}
              >
                <LeafletTooltip sticky>
                  <div style={{ lineHeight: 1.5 }}>
                    <strong>Ruta {opt.ruta} / Marco {opt.marco}</strong><br />
                    {opt.scene_count} imagen(es)<br />
                    {opt.is_preferred && <span style={{ color: "#f59e0b" }}>⭐ Preferida</span>}
                    {isSelected && <span style={{ color: "#22c55e" }}> ✓ Seleccionada</span>}
                  </div>
                </LeafletTooltip>
              </Rectangle>
            );
          })}

          {/* AOI preview */}
          {aoi && (
            <Polygon
              positions={aoi}
              pathOptions={{ color: "#5D5FEF", weight: 2, opacity: 0.85, fillOpacity: 0.1 }}
            />
          )}
        </MapContainer>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "var(--color-bg-card)", flexWrap: "wrap", gap: 8 }}>
        <button className="alaska-btn" onClick={reset} style={{ fontSize: "0.8rem" }}>Reiniciar área</button>
        {pathFrameOptions.length > 0 && (
          <div style={{ display: "flex", gap: "10px", fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
            <span><span style={{ color: "#f59e0b" }}>■</span> Preferida</span>
            <span><span style={{ color: "#3b82f6" }}>■</span> Disponible</span>
            <span><span style={{ color: "#22c55e" }}>■</span> Seleccionada</span>
          </div>
        )}
        {hint && <small style={{ color: hint.color, fontSize: "0.8rem" }}>{hint.text}</small>}
      </div>
    </div>
  );
};

export default MapComponent;
