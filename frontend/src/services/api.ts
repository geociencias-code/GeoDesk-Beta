import axios from 'axios';

// En producción no se necesita un URL absoluto: el nginx del frontend
// hace el proxy de /api/ → backend. En desarrollo local apuntamos al
// backend directamente por puerto.
// Si se define VITE_API_URL en el build, se usa ese valor.
// Si no, usamos '' (ruta relativa) para que el proxy de nginx funcione.
export const API_URL = import.meta.env.VITE_API_URL ?? '';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const apiFormData = axios.create({
  baseURL: API_URL,
  // Let the browser set the boundary for multipart/form-data
});

// ── Credential Interceptors ───────────────────────────────────────────────────
// Injectan HyP3 y ERA5 credentials desde localStorage en cada petición.

const STORAGE_KEY = 'geodesk_credentials';

function injectCredentialHeaders(config: { headers: Record<string, string> }) {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const creds = JSON.parse(stored);
      if (creds.hyp3Username) config.headers['x-hyp3-username'] = creds.hyp3Username;
      if (creds.hyp3Password) config.headers['x-hyp3-password'] = creds.hyp3Password;
      if (creds.era5Key)      config.headers['x-era5-key']      = creds.era5Key;
    }
  } catch {
    // Ignore storage errors
  }
  return config;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
api.interceptors.request.use(injectCredentialHeaders as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
apiFormData.interceptors.request.use(injectCredentialHeaders as any);

export default api;
