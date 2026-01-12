// src/api/systemOutlets.js
import http from "./http";

export function listOutlets() {
  return http.get("/system/outlets").then((r) => r.data);
}

export function getMyOutlet() {
  return http.get("/system/outlets/me").then((r) => r.data);
}

export function createOutlet(payload) {
  return http.post("/system/outlets", payload).then((r) => r.data);
}

export function updateOutlet(id, payload) {
  return http.put(`/system/outlets/${id}`, payload).then((r) => r.data);
}

export function deleteOutlet(id) {
  return http.delete(`/system/outlets/${id}`).then((r) => r.data);
}
