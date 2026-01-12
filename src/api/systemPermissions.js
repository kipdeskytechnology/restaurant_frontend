// src/api/systemPermissions.js
import http from "./http";

export function listPermissions() {
  return http.get("/system/permissions").then((r) => r.data);
}

export function createPermission(payload) {
  return http.post("/system/permissions", payload).then((r) => r.data);
}

export function updatePermission(id, payload) {
  return http.put(`/system/permissions/${id}`, payload).then((r) => r.data);
}

export function deletePermission(id) {
  return http.delete(`/system/permissions/${id}`).then((r) => r.data);
}
