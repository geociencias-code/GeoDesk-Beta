import React from "react";

type BarraSuperiorProps = {
  isHidden?: boolean;
};

const BarraSuperior: React.FC<BarraSuperiorProps> = ({ isHidden }) => {
  const logoSrc: string = `${import.meta.env.BASE_URL || "/"}imagenes/logo.png`;
  const logoAlt: string = "Logo Novalis Lab";

  return (
    <header className={`topbar ${isHidden ? "is-hidden" : ""}`}>
      <div className="topbar__brand">
        <img src={logoSrc} alt={logoAlt} />
        <span className="title">GeoDesk</span>
      </div>

      <span className="topbar__subtitle">
        Procesamiento de datos Alaska & ERA-5
      </span>

      <span className="topbar__badge">
        BETA SYSTEM
      </span>
    </header>
  );
};

export default BarraSuperior;
