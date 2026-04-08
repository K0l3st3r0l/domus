import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.REACT_APP_BACKEND_URL || 'http://localhost:3000',
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('domus_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('domus_token');
      localStorage.removeItem('domus_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default apiClient;
