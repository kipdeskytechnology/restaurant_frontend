// src/api/cash.js
import http from "./http";

const base = "/cash";

// Drawers
export const listCashDrawers = (params = {}) =>
  http.get("/cash/drawers", { params }).then((r) => r.data);

export const createCashDrawer = (payload) =>
  http.post("/cash/drawers", payload).then((r) => r.data);

export const updateCashDrawer = (id, payload) =>
  http.put(`/cash/drawers/${id}`, payload).then((r) => r.data);

export const toggleCashDrawer = (id) =>
  http.post(`/cash/drawers/${id}/toggle`).then((r) => r.data);

// Shifts
export const listShifts = (params = {}) =>
  http.get("/cash/shifts", { params }).then((r) => r.data);

export const currentShift = (params) =>
  http.get("/cash/shifts/current", { params }).then((r) => r.data);

export const openShift = (payload) =>
  http.post("/cash/shifts/open", payload).then((r) => r.data);

export const closeShift = (shiftId, payload) =>
  http.post(`/cash/shifts/${shiftId}/close`, payload).then((r) => r.data);

// Movements
export const listMovements = (shiftId) =>
  http.get(`/cash/shifts/${shiftId}/movements`).then((r) => r.data);

export const createMovement = (shiftId, payload) =>
  http.post(`/cash/shifts/${shiftId}/movements`, payload).then((r) => r.data);

export const listAllMovements = (params = {}) =>
  http.get("/cash/movements", { params }).then(r => r.data);

export const getCurrentShift = (outletId, cashDrawerId) =>
  http
    .get(`${base}/shifts/current`, {
      params: {
        outlet_id: outletId,
        cash_drawer_id: cashDrawerId, // preferred
        drawer_id: cashDrawerId,      // fallback if your backend uses drawer_id
      },
    })
    .then((r) => r.data);