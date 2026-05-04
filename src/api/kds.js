// src/api/kds.js
import http from "./http";

const base = "/kds";

export const listKdsTickets = (params = {}) =>
  http.get(`${base}/tickets`, { params }).then((r) => r.data);

export const setLineStatus = (lineId, status) =>
  http.post(`${base}/lines/${lineId}/status`, { status }).then((r) => r.data);

export const readyAllForOrder = (orderId) =>
  http.post(`${base}/orders/${orderId}/ready-all`).then((r) => r.data);

export const bumpOrder = (orderId) =>
  http.post(`${base}/orders/${orderId}/bump`).then((r) => r.data);

// Audit timeline. Pass either order_id or line_id to scope. Returns newest-first.
// Other params: event_type, since (ISO 8601), user_id, limit.
export const listKdsEvents = (params = {}) =>
  http.get(`${base}/events`, { params }).then((r) => r.data);
