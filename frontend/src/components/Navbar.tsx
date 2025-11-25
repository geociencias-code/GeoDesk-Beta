import React, { useState } from "react";
import "./navbar.css"; // Importa tu archivo CSS aquí

// Actualizamos cx para aceptar string | undefined
const cx = (...classes: (string | undefined)[]) => classes.filter(Boolean).join(" ");

type NavbarProps = {
  activeSection: string;
  onChangeSection: (section: string) => void;
};

export default function Navbar({ activeSection, onChangeSection }: NavbarProps) {
  const [isAlaskaOpen, setIsAlaskaOpen] = useState(false);
  const [isEra5Open, setIsEra5Open] = useState(false);

  const handleKey = (section: string, toggleSubmenu?: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (toggleSubmenu) toggleSubmenu(); // toggle submenú con teclado
      else onChangeSection(section);
    }
  };

  const Item = ({
    id,
    children,
    hasSubmenu,
    toggleSubmenu,
    submenuItems,
  }: any) => (
    <li
      role="button"
      tabIndex={0}
      // ← línea 1 corregida
      className={cx("sidebar__item", activeSection === id ? "is-active" : undefined)}
      onClick={() => {
        if (hasSubmenu && toggleSubmenu) toggleSubmenu();
        else onChangeSection(id);
      }}
      onKeyDown={handleKey(id, toggleSubmenu)}
      aria-current={activeSection === id ? "page" : undefined}
    >
      <span className="sidebar__marker" />
      <span>{children}</span>

      {/* Submenú */}
      {hasSubmenu && submenuItems && (
        <ul
          // ← línea 2 corregida
          className={cx(
            "submenu",
            (id === "alaska" && isAlaskaOpen) || (id === "era5" && isEra5Open) ? "open" : undefined
          )}
        >
          {submenuItems.map((sub: any) => (
            <li
              key={sub.id}
              onClick={() => onChangeSection(sub.id)}
              // ← línea 3 corregida
              className={cx("submenu__item", activeSection === sub.id ? "is-active" : undefined)}
            >
              {sub.label}
            </li>
          ))}
        </ul>
      )}
    </li>
  );

  return (
    <aside className="sidebar" aria-label="Barra lateral de navegación">
      <h2 className="sidebar__title">Navegación</h2>
      <nav>
        <ul className="sidebar__list">
          <Item id="inicio" hasSubmenu={false} submenuItems={[]} onChangeSection={onChangeSection}>
            Inicio
          </Item>

          <Item
            id="alaska"
            hasSubmenu={true}
            toggleSubmenu={() => setIsAlaskaOpen(!isAlaskaOpen)}
            submenuItems={[
              { id: "solicitud-imagenes", label: "Solicitud de imágenes manual" },
              { id: "solicitud-automatico", label: "Solicitud de imágenes automático"},
              { id: "descarga-imagenes", label: "Descarga de imágenes" },
              { id: "procesamiento-imagenes", label: "Procesamiento de imágenes"},
            ]}
          >
            Alaska
          </Item>

          <Item
            id="era5"
            hasSubmenu={true}
            toggleSubmenu={() => setIsEra5Open(!isEra5Open)}
            submenuItems={[
              { id: "descargar-datos", label: "Descargar datos" },
              { id: "analisis-datos", label: "Análisis de datos" },
            ]}
          >
            Era5
          </Item>

          <Item id="otros-procesos" hasSubmenu={false} submenuItems={[]}>
            Otros procesos
          </Item>
        </ul>
      </nav>
    </aside>
  );
}
