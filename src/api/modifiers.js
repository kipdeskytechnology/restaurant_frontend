// src/api/modifiers.js
import http from "./http";

const base = "/setup/modifiers";

// Groups
export const listModifierGroups = (params = {}) =>
  http.get(`${base}/groups`, { params }).then((r) => r.data);

export const createModifierGroup = (payload) =>
  http.post(`${base}/groups`, payload).then((r) => r.data);

export const updateModifierGroup = (id, payload) =>
  http.put(`${base}/groups/${id}`, payload).then((r) => r.data);

export const deleteModifierGroup = (id) =>
  http.delete(`${base}/groups/${id}`).then((r) => r.data);

// Options
export const listModifierOptions = (groupId) =>
  http.get(`${base}/groups/${groupId}/options`).then((r) => r.data);

export const createModifierOption = (groupId, payload) =>
  http.post(`${base}/groups/${groupId}/options`, payload).then((r) => r.data);

export const updateModifierOption = (optionId, payload) =>
  http.put(`${base}/options/${optionId}`, payload).then((r) => r.data);

export const deleteModifierOption = (optionId) =>
  http.delete(`${base}/options/${optionId}`).then((r) => r.data);

export const listItemModifierGroups = (menuItemId) =>
  http.get(`${base}/menu-items/${menuItemId}/groups`).then((r) => r.data);

export const listModifierGroupOptions = (groupId) => listModifierOptions(groupId);

// Attach / detach groups to menu items
export const attachModifierGroupToItem = (menuItemId, groupId) =>
  http.put(`${base}/menu-items/${menuItemId}/groups/${groupId}`).then((r) => r.data);

export const detachModifierGroupFromItem = (menuItemId, groupId) =>
  http.delete(`${base}/menu-items/${menuItemId}/groups/${groupId}`).then((r) => r.data);

export const listOptionIngredientDeltas = (optionId) =>
  http.get(`${base}/options/${optionId}/ingredient-deltas`).then((r) => r.data);

export const upsertOptionIngredientDelta = (optionId, payload) =>
  http.put(`${base}/options/${optionId}/ingredient-deltas`, payload).then((r) => r.data);

export const deleteOptionIngredientDelta = (optionId, inventoryItemId) =>
  http.delete(`${base}/options/${optionId}/ingredient-deltas/${inventoryItemId}`).then((r) => r.data);