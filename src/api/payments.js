// src/api/payments.js
import http from "./http";

const base = "";

// Payments
export const listPayments = (params = {}) =>
  http.get(`${base}/payments`, { params }).then((r) => r.data);

export const getPayment = (paymentId) =>
  http.get(`${base}/payments/${paymentId}`).then((r) => r.data);
