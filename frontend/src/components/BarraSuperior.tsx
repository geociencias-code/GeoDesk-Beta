import React from "react";
import "./BarraSuperior.css";

type BarraSuperiorProps = {
  isHidden?: boolean;
};

const BarraSuperior: React.FC<BarraSuperiorProps> = ({ isHidden }) => {
  const logoSrc: string = "/imagenes/logo.png";
  const logoAlt: string = "Logo Novalis Lab";

  return (
    <header className={`barra-superior ${isHidden ? "hidden" : ""}`}>
      {/* Logo */}
      <img src={logoSrc} alt={logoAlt} />

      {/* Nombre */}
      <span className="titulo">GeoDesk Beta</span>

      {/* Palabras clave */}
      <span className="palabras">
        Puedes obtener datos Alaska/ERA-5 
      </span>

      {/* Tecnología */}
      <span className="tecnologia">React Tecnology</span>
    </header>
  );
};

export default BarraSuperior;
