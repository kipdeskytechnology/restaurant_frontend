// src/api/setupCustomers.js
import http from "./http";

export const listCustomers = (params = {}) =>
  http.get("/setup/customers", { params }).then((r) => r.data);

export const createCustomer = (payload) =>
  http.post("/setup/customers", payload).then((r) => r.data);

export const updateCustomer = (id, payload) =>
  http.put(`/setup/customers/${id}`, payload).then((r) => r.data);

export const toggleCustomer = (id) =>
  http.post(`/setup/customers/${id}/toggle`).then((r) => r.data);
