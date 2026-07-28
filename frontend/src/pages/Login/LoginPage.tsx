import React, { useState } from "react";
import { Layers, LogIn, UserX, Eye, EyeOff, AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import "./LoginPage.scss";

const LoginPage: React.FC = () => {
  const { login, enterAsGuest } = useAuth();

  const [hyp3Username, setHyp3Username] = useState("");
  const [hyp3Password, setHyp3Password] = useState("");
  const [era5Key, setEra5Key] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hyp3Username || !hyp3Password) {
      setError("El usuario y contraseña de HyP3 son obligatorios.");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      await login({ hyp3Username, hyp3Password, era5Key });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Error al conectar con el servidor. Verifica que el backend esté activo.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Background decorative circles */}
      <div className="login-page__bg-blob login-page__bg-blob--1" />
      <div className="login-page__bg-blob login-page__bg-blob--2" />

      <div className="login-card">
        {/* Brand header */}
        <div className="login-card__brand">
          <div className="login-card__icon">
            <Layers size={28} />
          </div>
          <div>
            <h1 className="login-card__title">GeoDesk Beta</h1>
            <p className="login-card__subtitle">Plataforma de Análisis InSAR</p>
          </div>
        </div>

        <div className="login-card__divider" />

        <p className="login-card__description">
          Ingresa tus credenciales personales de <strong>HyP3</strong> (Alaska Satellite Facility)
          y tu clave de <strong>ERA5</strong> (Copernicus Climate) para acceder a todas las funciones.
        </p>

        {/* Error banner */}
        {error && (
          <div className="login-card__error">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Login form */}
        <form className="login-form" onSubmit={handleLogin} noValidate>
          <fieldset className="login-form__section">
            <legend className="login-form__section-title">
              <span className="login-form__badge login-form__badge--hyp3">HyP3</span>
              Alaska Satellite Facility
            </legend>

            <div className="login-form__field">
              <label htmlFor="hyp3-username" className="login-form__label">
                Usuario / Email
              </label>
              <input
                id="hyp3-username"
                type="text"
                className="login-form__input"
                placeholder="usuario@ejemplo.com"
                autoComplete="username"
                value={hyp3Username}
                onChange={(e) => setHyp3Username(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="login-form__field">
              <label htmlFor="hyp3-password" className="login-form__label">
                Contraseña
              </label>
              <div className="login-form__input-wrap">
                <input
                  id="hyp3-password"
                  type={showPassword ? "text" : "password"}
                  className="login-form__input login-form__input--password"
                  placeholder="••••••••••"
                  autoComplete="current-password"
                  value={hyp3Password}
                  onChange={(e) => setHyp3Password(e.target.value)}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="login-form__eye-btn"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          </fieldset>

          <fieldset className="login-form__section">
            <legend className="login-form__section-title">
              <span className="login-form__badge login-form__badge--era5">ERA5</span>
              Copernicus Climate Data Store
              <span className="login-form__optional">Opcional</span>
            </legend>

            <div className="login-form__field">
              <label htmlFor="era5-key" className="login-form__label">
                API Key
              </label>
              <input
                id="era5-key"
                type="text"
                className="login-form__input login-form__input--mono"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={era5Key}
                onChange={(e) => setEra5Key(e.target.value)}
                disabled={loading}
              />
              <p className="login-form__hint">
                Solo requerida para la corrección troposférica en Análisis InSAR (MintPy).
              </p>
            </div>
          </fieldset>

          <button
            id="login-submit-btn"
            type="submit"
            className="login-btn login-btn--primary"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="login-btn__spinner" />
                Verificando credenciales…
              </>
            ) : (
              <>
                <LogIn size={18} />
                Iniciar Sesión
              </>
            )}
          </button>
        </form>

        {/* Guest entry */}
        <div className="login-card__divider login-card__divider--text">
          <span>o</span>
        </div>

        <button
          id="guest-entry-btn"
          type="button"
          className="login-btn login-btn--ghost"
          onClick={enterAsGuest}
          disabled={loading}
        >
          <UserX size={18} />
          Entrar de todas formas
        </button>

        <p className="login-card__guest-note">
          Podrás acceder a <strong>EQ-INSAR Sintético</strong> y a{" "}
          <strong>Análisis InSAR</strong> con funciones limitadas. Las demás secciones
          requerirán iniciar sesión.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
