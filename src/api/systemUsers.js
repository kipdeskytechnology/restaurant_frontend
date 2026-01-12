// src/api/systemUsers.js
import http from "./http";

export const listUsers = () => http.get("/system/users").then(r => r.data);
export const createUser = (payload) => http.post("/system/users", payload).then(r => r.data);
export const updateUser = (id, payload) => http.put(`/system/users/${id}`, payload).then(r => r.data);
export const resetUserPassword = (id) => http.post(`/system/users/${id}/reset-password`).then(r => r.data);
