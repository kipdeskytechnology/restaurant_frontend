// src/api/setupDiscounts.js
import http from "./http";

export const listDiscounts = () =>
  http.get("/setup/discounts").then((r) => r.data);

export const createDiscount = (payload) =>
  http.post("/setup/discounts", payload).then((r) => r.data);

export const updateDiscount = (id, payload) =>
  http.put(`/setup/discounts/${id}`, payload).then((r) => r.data);

export const toggleDiscount = (id) =>
  http.post(`/setup/discounts/${id}/toggle`).then((r) => r.data);
