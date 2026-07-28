import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL ?? '/api';

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
