// src\api\dashboard.js
import http from "./http";

export const getDashboardSummary = (params) =>
  http.get("/dashboard/summary", { params }).then((r) => r.data);
