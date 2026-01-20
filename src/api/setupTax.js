// src\api\setupTax.js
import http from "./http";

// Tax Rates
export const listTaxRates = () => http.get("/setup/tax/rates").then(r => r.data);
export const createTaxRate = (payload) => http.post("/setup/tax/rates", payload).then(r => r.data);
export const updateTaxRate = (id, payload) => http.put(`/setup/tax/rates/${id}`, payload).then(r => r.data);

// Tax Profiles
export const listTaxProfiles = () => http.get("/setup/tax/profiles").then(r => r.data);
export const createTaxProfile = (payload) => http.post("/setup/tax/profiles", payload).then(r => r.data);
export const updateTaxProfile = (id, payload) => http.put(`/setup/tax/profiles/${id}`, payload).then(r => r.data);
