// src/api/setupUom.js
import http from "./http";

// UOMs
export const listUoms = () => http.get("/setup/uom").then((r) => r.data);
export const createUom = (payload) =>
  http.post("/setup/uom", payload).then((r) => r.data);
export const updateUom = (id, payload) =>
  http.put(`/setup/uom/${id}`, payload).then((r) => r.data);

// Conversions
export const listUomConversions = () =>
  http.get("/setup/uom/conversions").then((r) => r.data);
export const createUomConversion = (payload) =>
  http.post("/setup/uom/conversions", payload).then((r) => r.data);
export const updateUomConversion = (id, payload) =>
  http.put(`/setup/uom/conversions/${id}`, payload).then((r) => r.data);
export const deleteUomConversion = (id) =>
  http.delete(`/setup/uom/conversions/${id}`).then((r) => r.data);
