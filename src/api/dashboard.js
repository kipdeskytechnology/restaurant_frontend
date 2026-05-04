// src/api/dashboard.js
//
// Three-call shape mirroring pos/frontenda/src/views/Dashboard.vue's data
// fetching: KPIs, blocks, and the time-series chart fetch independently
// so the KPI strip can refresh without re-running the heavier queries.
import http from "./http";

export const getDashboardCounts = (params) =>
  http.get("/dashboard/counts", { params }).then((r) => r.data);

export const getDashboardData = (params) =>
  http.get("/dashboard/data", { params }).then((r) => r.data);

export const getDashboardSalesChart = (params) =>
  http.get("/dashboard/sales-chart", { params }).then((r) => r.data);
