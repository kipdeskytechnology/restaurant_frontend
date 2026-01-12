// src/api/http.js
import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";

const http = axios.create({
  baseURL,
  timeout: 20000,
});

// ✅ read from localStorage OR sessionStorage
const accessToken = () =>
  localStorage.getItem("access_token") || sessionStorage.getItem("access_token");

const refreshToken = () =>
  localStorage.getItem("refresh_token") || sessionStorage.getItem("refresh_token");

// ✅ store refresh result back into the same storage currently holding refresh token
function tokenStore() {
  return localStorage.getItem("refresh_token") ? localStorage : sessionStorage;
}

let isRefreshing = false;
let queue = [];

function processQueue(error, token = null) {
  queue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  queue = [];
}

http.interceptors.request.use((config) => {
  const token = accessToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    const status = err.response?.status;

    if (status === 401 && !original?._retry) {
      original._retry = true;

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          queue.push({
            resolve: (token) => {
              original.headers = original.headers || {};
              original.headers.Authorization = `Bearer ${token}`;
              resolve(http(original));
            },
            reject,
          });
        });
      }

      isRefreshing = true;

      try {
        const rt = refreshToken();
        if (!rt) throw new Error("No refresh token");

        const r = await axios.post(`${baseURL}/auth/refresh`, { refresh_token: rt });

        const newAccess = r.data.access_token;
        const newRefresh = r.data.refresh_token;

        const store = tokenStore();
        store.setItem("access_token", newAccess);
        store.setItem("refresh_token", newRefresh);

        http.defaults.headers.common.Authorization = `Bearer ${newAccess}`;

        processQueue(null, newAccess);

        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newAccess}`;
        return http(original);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        sessionStorage.removeItem("access_token");
        sessionStorage.removeItem("refresh_token");
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(err);
  }
);

export default http;
