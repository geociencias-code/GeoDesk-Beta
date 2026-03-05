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
import Alaska_procesamiento_varios from "./pages/Deformacion/Deformacion";
import Temperatura_deformacion from "./pages/TemperatureDeformation/TemperatureDeformation"

import Inicio from "./pages/Home/Home";
import api, { API_URL } from "./services/api";
import type { Scene } from "./pages/Alaska/AlaskaContent";

const SIDEBAR_WIDTH = 300; // Ancho de la barra lateral
const APP_BG = "var(--color-bg-main)"; // Color de fondo global del área principal (paleta)

const App: React.FC = () => {
  const [activeSection, setActiveSection] = useState<string>("inicio");
  const [, setActivePage] = useState<string>("");

  // 👉 NUEVO: controlamos si el header está oculto o no
  const [isHeaderHidden, setIsHeaderHidden] = useState<boolean>(false);

  // 👉 NUEVO: referencia al contenedor que hace scroll
  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTopRef = useRef<number>(0);

  // Estado de los filtros de búsqueda
  const [polygonWKT, setPolygonWKT] = useState<string>("");

  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate] = useState("2025-01-15");
  const [ruta, setRuta] = useState<number>(128);
  const [marco, setMarco] = useState<number>(547);
  const [flightDirection, setFlightDirection] = useState<
    "ASCENDING" | "DESCENDING" | ""
  >("");
  const [polarization, setPolarization] = useState<string>("");

  const [scenes, setScenes] = useState<Scene[]>([]); // Almacena las escenas encontradas
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCount, setLastCount] = useState<number>(0);

  // Cambia la sección activa
  const handleChangeSection = (section: string) => {
    setActiveSection(section);
    setActivePage(""); // Resetear página activa cuando se cambia de sección
  };

  // 👉 NUEVO: efecto para ocultar/mostrar el header según el scroll del contenido
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const handleScroll = () => {
      const currentScroll = el.scrollTop;

      if (currentScroll > lastScrollTopRef.current && currentScroll > 50) {
        // Scrolleando hacia abajo
        setIsHeaderHidden(true);
      } else {
        // Scrolleando hacia arriba o muy arriba
        setIsHeaderHidden(false);
      }

      lastScrollTopRef.current = currentScroll;
    };

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Función para realizar la búsqueda de escenas
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

  // Renderizar contenido dependiendo de la sección activa
  const renderContent = () => {
    switch (activeSection) {
      case "inicio":
        // ⬅️ Aquí usamos la portada nueva
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
              // ⬅️ aquí aprovechas el contador real
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

      case "otros-procesos":
        return <div>
          <Alaska_procesamiento_varios/>
          <Temperatura_deformacion/>
          
        </div>;

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
      {/* NAVBAR lateral fija */}
      <div style={{ gridColumn: "1 / 2", gridRow: "1 / span 2" }}>
        <Navbar
          activeSection={activeSection}
          onChangeSection={handleChangeSection}
        />
      </div>

      {/* Barra superior */}
      <div style={{ gridColumn: "2 / 3", gridRow: "1 / 2" }}>
        {/* ⬅️ Le pasamos si debe ocultarse o no */}
        <BarraSuperior isHidden={isHeaderHidden} />
      </div>

      {/* Contenido principal */}
      <div
        ref={contentRef} // ⬅️ ESTE ES EL CONTENEDOR QUE SCROLLEA
        style={{
          gridColumn: "2 / 3",
          gridRow: "2 / 3",
          overflowY: "auto",
          minHeight: 0,
          padding: "2rem",
          color: "var(--color-text-main)",
        }}
      >
        {/* ⬅️ Ocultamos el título genérico en la portada */}
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
