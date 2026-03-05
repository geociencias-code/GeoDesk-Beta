import axios from 'axios';

export const API_URL = 'http://localhost:8000';

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

export default api;
