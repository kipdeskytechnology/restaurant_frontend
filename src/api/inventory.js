// src/api/inventory.js
import http from "./http";

const base = "/inventory";

function clampLimit(params = {}, max = 500) {
  const p = { ...params };
  if (p.limit == null) return p;

  const n = Number(p.limit);
  if (!Number.isFinite(n)) {
    delete p.limit;
    return p;
  }

  p.limit = Math.max(1, Math.min(max, n));
  return p;
}

// Categories
export const listInventoryCategories = () =>
  http.get(`${base}/categories`).then((r) => r.data);

export const createInventoryCategory = (payload) =>
  http.post(`${base}/categories`, payload).then((r) => r.data);

export const updateInventoryCategory = (id, payload) =>
  http.put(`${base}/categories/${id}`, payload).then((r) => r.data);

export const deleteInventoryCategory = (id) =>
  http.delete(`${base}/categories/${id}`).then((r) => r.data);

// Items
export const listInventoryItems = (params = {}) =>
  http.get(`${base}/items`, { params: clampLimit(params, 500) }).then((r) => r.data);

export const createInventoryItem = (payload) =>
  http.post(`${base}/items`, payload).then((r) => r.data);

export const updateInventoryItem = (id, payload) =>
  http.put(`${base}/items/${id}`, payload).then((r) => r.data);

// Stock + Ledger
export const listStockBalances = (params = {}) =>
  http.get(`${base}/stock`, { params: clampLimit(params, 500) }).then((r) => r.data);

export const listStockLedger = (params = {}) =>
  http.get(`${base}/ledger`, { params: clampLimit(params, 500) }).then((r) => r.data);

export const adjustStock = (payload) =>
  http.post(`${base}/stock/adjust`, payload).then((r) => r.data);

// Audits
export const listInventoryAudits = (params = {}) =>
  http.get(`${base}/audits`, { params: clampLimit(params, 300) }).then((r) => r.data);

export const createInventoryAudit = (payload) =>
  http.post(`${base}/audits`, payload).then((r) => r.data);

export const replaceInventoryAuditLines = (auditId, payload) =>
  http.put(`${base}/audits/${auditId}/lines`, payload).then((r) => r.data);
