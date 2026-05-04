// src/api/alerts.js
import http from "./http";

// Trigger the daily low-stock alert immediately for the caller's store.
// Useful from a "Send test alert" button on Store Profile.
export const runLowStockAlert = () =>
  http.post("/alerts/low-stock/run").then((r) => r.data);
