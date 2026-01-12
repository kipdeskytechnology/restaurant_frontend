import http from "./http";

// Outlets (you already have /system/outlets)
export const listOutlets = (params = {}) =>
  http.get("/system/outlets", { params }).then((r) => r.data);

// UOMs (assuming you built /setup/uom endpoints as /setup/uom and /setup/uom/conversions etc.)
export const listUoms = (params = {}) =>
  http.get("/setup/uom", { params }).then((r) => r.data);
