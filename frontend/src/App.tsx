import { useState, useRef, useEffect } from "react";
import Navbar from "./components/Navbar";
import BarraSuperior from "./components/BarraSuperior";
import Era5 from "./pages/Era5/Era5";
import Era5Procesamiento from "./pages/Era5ProcessingNc/Era5ProcessingNc";
import AlaskaSearch from "./pages/Alaska/AlaskaSearch";
import SentinelDashboard from "./pages/Alaska/SentinelDashboard";
import DownloadFiles from "./pages/Alaska/DownloadFiles";
import Alaska_procesamiento from "./pages/AlaskaProcessing/AlaskaProcessing";
import SolicitarImagenesAutomatico from "./pages/SolicitarImagenesAutomatico/SolicitarImagenesAutomatico";
import Era5SentinelComparative from "./pages/Era5SentinelComparative/Era5SentinelComparative";
import AlaskaVelocityExcel from "./pages/AlaskaVelocityExcel";

import Inicio from "./pages/Home/Home";
import api, { API_URL } from "./services/api";
import type { Scene } from "./pages/Alaska/AlaskaContent";

const SIDEBAR_WIDTH = 300;
const APP_BG = "var(--color-bg-main)";

const App: React.FC = () => {
  const [activeSection, setActiveSection] = useState<string>("inicio");
  const [, setActivePage] = useState<string>("");

  const [isHeaderHidden, setIsHeaderHidden] = useState<boolean>(false);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTopRef = useRef<number>(0);

  const [polygonWKT, setPolygonWKT] = useState<string>("");

  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate] = useState("2025-01-15");
  const [ruta, setRuta] = useState<number>(128);
  const [marco, setMarco] = useState<number>(547);
  const [flightDirection, setFlightDirection] = useState<
    "ASCENDING" | "DESCENDING" | ""
  >("");
  const [polarization, setPolarization] = useState<string>("");

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCount, setLastCount] = useState<number>(0);

  const handleChangeSection = (section: string) => {
    setActiveSection(section);
    setActivePage("");
  };

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const handleScroll = () => {
      const currentScroll = el.scrollTop;

      if (currentScroll > lastScrollTopRef.current && currentScroll > 50) {
        setIsHeaderHidden(true);
      } else {
        setIsHeaderHidden(false);
      }

      lastScrollTopRef.current = currentScroll;
    };

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  const searchScenes = async () => {
    try {
      setError(null);
      setLoading(true);

      if (!polygonWKT)
        throw new Error(
          "Dibuja y cierra un polígono (doble clic) en el mapa."
        );

      const body = {
        polygon: polygonWKT,
        start_date: `${startDate}T00:00:00Z`,
        end_date: `${endDate}T23:59:59Z`,
        ruta,
        marco,
        beam_mode: "IW",
        processing_level: "SLC",
        day_interval: 12,
        same_platform: true,
        flight_direction: flightDirection || undefined,
        polarization: polarization || undefined,
      };

      const res = await api.post("/api/search", body);

      setScenes(res.data);
      setLastCount(res.data.length);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  };


  const renderContent = () => {
    switch (activeSection) {
      case "inicio":
        return <Inicio onNavigate={handleChangeSection} />;

      case "alaska":
        return <div>Sección Alaska (elige una opción del submenú)</div>;

      case "solicitud-imagenes":
        return (
          <div>
            <AlaskaSearch
              polygonWKT={polygonWKT}
              setPolygonWKT={setPolygonWKT}
              startDate={startDate}
              endDate={endDate}
              setStartDate={setStartDate}
              setEndDate={setEndDate}
              ruta={ruta}
              marco={marco}
              setRuta={setRuta}
              setMarco={setMarco}
              flightDirection={flightDirection}
              setFlightDirection={setFlightDirection}
              polarization={polarization}
              setPolarization={setPolarization}
              onSearch={searchScenes}
              loading={loading}
              error={error}
              lastCount={lastCount}
            />
            <SentinelDashboard
              scenes={scenes}
              backendUrl={API_URL}
              ruta={ruta}
              marco={marco}
            />
          </div>
        );

      case "descarga-imagenes":
        return (
          <div>
            <DownloadFiles />
          </div>
        );

      case "procesamiento-imagenes":
        return (
          <div>
            <Alaska_procesamiento />
          </div>
        );

      case "alaska-velocity-excel":
        return (
          <div>
            <AlaskaVelocityExcel />
          </div>
        );

      case "solicitud-automatico":
        return (
          <div>
            <SolicitarImagenesAutomatico />
          </div>
        );

      case "descargar-datos":
        return (
          <div>
            <Era5 />
          </div>
        );

      case "analisis-datos":
        return (
          <div>
            <Era5Procesamiento />
          </div>
        );

      case "comparativa-era5-sentinel":
        return (
          <div>
            <Era5SentinelComparative />
          </div>
        );

      default:
        return <div>Selecciona una opción del menú.</div>;
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        gridTemplateColumns: `${SIDEBAR_WIDTH}px minmax(0, 1fr)`,
        gridTemplateRows: "auto 1fr",
        overflow: "hidden",
        backgroundColor: APP_BG,
      }}
    >
      <div style={{ gridColumn: "1 / 2", gridRow: "1 / span 2" }}>
        <Navbar
          activeSection={activeSection}
          onChangeSection={handleChangeSection}
        />
      </div>

      <div style={{ gridColumn: "2 / 3", gridRow: "1 / 2" }}>
        <BarraSuperior isHidden={isHeaderHidden} />
      </div>

      <div
        ref={contentRef}
        style={{
          gridColumn: "2 / 3",
          gridRow: "2 / 3",
          overflowY: "auto",
          minHeight: 0,
          padding: activeSection === "inicio" ? "0" : "2rem",
          color: "var(--color-text-main)",
        }}
      >

        {activeSection !== "inicio" && (
          <h2 style={{ marginTop: 0, marginBottom: "1rem", opacity: 0.9 }}>
            {activeSection.charAt(0).toUpperCase() + activeSection.slice(1)}
          </h2>
        )}

        {renderContent()}
      </div>
    </div>
  );
};

export default App;
