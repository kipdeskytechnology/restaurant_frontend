// src\api\recipes.js
import http from "./http";

const base = "/setup/recipes";

export const listRecipes = (params = {}) =>
  http.get(base, { params }).then((r) => r.data);

export const getRecipeByMenuItem = (menuItemId) =>
  http.get(`${base}/by-menu-item/${menuItemId}`).then((r) => r.data);

export const createRecipe = (payload) =>
  http.post(base, payload).then((r) => r.data);

export const replaceRecipeLines = (recipeId, payload) =>
  http.put(`${base}/${recipeId}/lines`, payload).then((r) => r.data);

export const upsertRecipeLine = (recipeId, payload) =>
  http.post(`${base}/${recipeId}/lines`, payload).then((r) => r.data);

export const deleteRecipeLine = (recipeId, lineId) =>
  http.delete(`${base}/${recipeId}/lines/${lineId}`).then((r) => r.data);
