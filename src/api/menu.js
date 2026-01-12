// src/api/menu.js
import http from "./http";

const base = "/setup/menu";

// Categories
export const listMenuCategories = () =>
  http.get(`${base}/categories`).then((r) => r.data);

export const createMenuCategory = (payload) =>
  http.post(`${base}/categories`, payload).then((r) => r.data);

export const updateMenuCategory = (id, payload) =>
  http.put(`${base}/categories/${id}`, payload).then((r) => r.data);

export const deleteMenuCategory = (id) =>
  http.delete(`${base}/categories/${id}`).then((r) => r.data);

// Items
export const listMenuItems = (params = {}) =>
  http.get(`${base}/items`, { params }).then((r) => r.data);

export const createMenuItem = (payload) =>
  http.post(`${base}/items`, payload).then((r) => r.data);

export const updateMenuItem = (id, payload) =>
  http.put(`${base}/items/${id}`, payload).then((r) => r.data);

export const deleteMenuItem = (id) =>
  http.delete(`${base}/items/${id}`).then((r) => r.data);

// Item Image
export const uploadMenuItemImage = (itemId, file) => {
  const fd = new FormData();
  fd.append("file", file);
  return http
    .post(`${base}/items/${itemId}/image`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};

// Outlet Overrides
export const listItemOverrides = (itemId) =>
  http.get(`${base}/items/${itemId}/overrides`).then((r) => r.data);

export const upsertItemOverride = (itemId, outletId, payload) =>
  http
    .put(`${base}/items/${itemId}/overrides/${outletId}`, payload)
    .then((r) => r.data);

export const deleteItemOverride = (itemId, outletId) =>
  http
    .delete(`${base}/items/${itemId}/overrides/${outletId}`)
    .then((r) => r.data);

    // Combos (MenuItem is_combo=true)
export const listCombos = (params = {}) =>
  http.get(`${base}/combos`, { params }).then((r) => r.data);

export const createCombo = (payload) =>
  http.post(`${base}/combos`, payload).then((r) => r.data);

export const updateCombo = (id, payload) =>
  http.put(`${base}/combos/${id}`, payload).then((r) => r.data);

export const deleteCombo = (id) =>
  http.delete(`${base}/combos/${id}`).then((r) => r.data);

// Combo components
export const listComboItems = (comboId) =>
  http.get(`${base}/combos/${comboId}/items`).then((r) => r.data);

export const addComboItem = (comboId, payload) =>
  http.post(`${base}/combos/${comboId}/items`, payload).then((r) => r.data);

export const updateComboItem = (comboId, comboItemId, payload) =>
  http.put(`${base}/combos/${comboId}/items/${comboItemId}`, payload).then((r) => r.data);

export const deleteComboItem = (comboId, comboItemId) =>
  http.delete(`${base}/combos/${comboId}/items/${comboItemId}`).then((r) => r.data);
