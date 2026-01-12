// src/api/systemRoles.js
import http from "./http";

export function listRoles() {
  return http.get("/system/roles").then((r) => r.data);
}

export function createRole(payload) {
  return http.post("/system/roles", payload).then((r) => r.data);
}

export function updateRole(id, payload) {
  return http.put(`/system/roles/${id}`, payload).then((r) => r.data);
}

export function deleteRole(id) {
  return http.delete(`/system/roles/${id}`).then((r) => r.data);
}

export function listPermissions() {
  return http.get("/system/roles/permissions").then((r) => r.data);
}

export function setRolePermissions(roleId, permission_ids) {
  return http
    .put(`/system/roles/${roleId}/permissions`, { permission_ids })
    .then((r) => r.data);
}
