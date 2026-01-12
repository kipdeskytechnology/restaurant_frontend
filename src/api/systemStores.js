// src/api/systemStores.js
import http from "./http";

export function getMyStoreProfile() {
  return http.get("/system/stores/me").then((r) => r.data);
}

export function updateMyStoreProfile(payload) {
  return http.put("/system/stores/me", payload).then((r) => r.data);
}

export function uploadMyStoreLogo(file) {
  const fd = new FormData();
  fd.append("file", file);
  return http
    .post("/system/stores/me/logo", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
}
