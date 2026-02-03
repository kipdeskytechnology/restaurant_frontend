// src/api/purchasing.js
import http from "./http";

const base = "/purchases";

function clampLimit(params = {}, max = 500) {
  const p = { ...params };
  if (p.limit == null) return p;

  const n = Number(p.limit);
  if (!Number.isFinite(n)) {
    delete p.limit;
    return p;
  }

  p.limit = Math.max(1, Math.min(max, n));
  return p;
}

function normalizeActiveParam(active) {
  if (active === true) return "1";
  if (active === false) return "0";
  if (active === 1) return "1";
  if (active === 0) return "0";
  if (active === "1" || active === "0" || active === "all") return active;
  return "1";
}

function normalizeSupplierParams(params = {}) {
  let p = { ...params };
  if (p.active == null) p.active = "1";
  p.active = normalizeActiveParam(p.active);

  if (p.q != null) {
    const s = String(p.q).trim();
    if (!s) delete p.q;
    else p.q = s;
  }

  p = clampLimit(p, 500);
  return p;
}

function normalizePoListParams(params = {}) {
  const p = { ...params };
  p.limit = p.limit ?? 200;

  if (p.status == null || p.status === "") p.status = "all";
  p.status = String(p.status).toLowerCase();

  if (p.outlet_id === "" || p.outlet_id == null) delete p.outlet_id;
  else p.outlet_id = Number(p.outlet_id);

  if (p.supplier_id === "" || p.supplier_id == null) delete p.supplier_id;
  else p.supplier_id = Number(p.supplier_id);

  if (p.q != null) {
    const s = String(p.q).trim();
    if (!s) delete p.q;
    else p.q = s;
  }

  return clampLimit(p, 500);
}

/* -------------------- SUPPLIERS -------------------- */

export const listSuppliers = (params = {}) =>
  http.get(`${base}/suppliers`, { params: normalizeSupplierParams(params) }).then((r) => r.data);

export const getSupplier = (id) =>
  http.get(`${base}/suppliers/${id}`).then((r) => r.data);

export const createSupplier = (payload) =>
  http.post(`${base}/suppliers`, payload).then((r) => r.data);

export const updateSupplier = (id, payload) =>
  http.put(`${base}/suppliers/${id}`, payload).then((r) => r.data);

/* -------------------- SUPPLIER PRICE LOOKUP -------------------- */

export const lookupSupplierPrice = (params) =>
  http.get(`${base}/supplier-prices/lookup`, { params }).then((r) => r.data);

/* -------------------- PURCHASE ORDERS -------------------- */

export const listPurchaseOrders = (params = {}) =>
  http.get(`${base}/orders`, { params: normalizePoListParams(params) }).then((r) => r.data);

export const getPurchaseOrder = (id) =>
  http.get(`${base}/orders/${id}`).then((r) => r.data);

export const createPurchaseOrder = (payload) =>
  http.post(`${base}/orders`, payload).then((r) => r.data);

export const updatePurchaseOrder = (id, payload) =>
  http.put(`${base}/orders/${id}`, payload).then((r) => r.data);

export const replacePurchaseOrderItems = (id, itemsPayloadArray) =>
  http.put(`${base}/orders/${id}/items`, itemsPayloadArray).then((r) => r.data);

export const sendPurchaseOrder = (id) =>
  http.post(`${base}/orders/${id}/send`).then((r) => r.data);

export const cancelPurchaseOrder = (id) =>
  http.post(`${base}/orders/${id}/cancel`).then((r) => r.data);

/* -------------------- PURCHASE RECEIPTS -------------------- */

export const listPurchaseReceipts = (params = {}) =>
  http.get(`${base}/receipts`, { params: clampLimit(params, 500) }).then((r) => r.data);

export const getPurchaseReceipt = (id) =>
  http.get(`${base}/receipts/${id}`).then((r) => r.data);

export const createPurchaseReceipt = (payload) =>
  http.post(`${base}/receipts`, payload).then((r) => r.data);

export const replacePurchaseReceiptItems = (receiptId, payload) =>
  http.put(`${base}/receipts/${receiptId}/items`, payload).then((r) => r.data);

/* ✅ Direct intake */
export const createDirectReceipt = (payload) =>
  http.post(`${base}/receipts/direct`, payload).then((r) => r.data);

export const updateDirectReceipt = (receiptId, payload) =>
  http.put(`${base}/receipts/${receiptId}/direct`, payload).then((r) => r.data);

export const voidReceipt = (receiptId, payload = {}) =>
  http.post(`${base}/receipts/${receiptId}/void`, payload).then((r) => r.data);

/* -------------------- ALIASES -------------------- */
export const listReceipts = listPurchaseReceipts;
export const getReceipt = getPurchaseReceipt;
export const createReceipt = createPurchaseReceipt;
export const replaceReceiptItems = replacePurchaseReceiptItems;
