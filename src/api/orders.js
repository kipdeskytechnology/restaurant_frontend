// src/api/orders.js
import http from "./http";

const base = "";

// Orders
export const openOrder = (payload) =>
  http.post(`${base}/orders/open`, payload).then((r) => r.data);

export const listOrders = (params = {}) =>
  http.get(`${base}/orders`, { params }).then((r) => r.data);

export const getOrder = (orderId) =>
  http.get(`${base}/orders/${orderId}`).then((r) => r.data);

export const holdOrder = (orderId) =>
  http.post(`${base}/orders/${orderId}/hold`).then((r) => r.data);

export const reopenOrder = (orderId) =>
  http.post(`${base}/orders/${orderId}/reopen`).then((r) => r.data);

export const cancelOrder = (orderId) =>
  http.post(`${base}/orders/${orderId}/cancel`).then((r) => r.data);

export const payOrder = (orderId) =>
  http.post(`${base}/orders/${orderId}/pay`).then((r) => r.data);

// Lines
export const addOrderLine = (orderId, payload) =>
  http.post(`${base}/orders/${orderId}/lines`, payload).then((r) => r.data);

export const updateOrderLine = (lineId, payload) =>
  http.put(`${base}/orders/lines/${lineId}`, payload).then((r) => r.data);

export const deleteOrderLine = (lineId) =>
  http.delete(`${base}/orders/lines/${lineId}`).then((r) => r.data);

// Discounts (ORDER scope)
export const listOrderDiscounts = (orderId) =>
  http.get(`${base}/orders/${orderId}`).then((r) => r.data.discounts || []);

export const applyOrderDiscount = (orderId, discountId) =>
  http
    .post(`${base}/orders/${orderId}/discounts`, { discount_id: discountId })
    .then((r) => r.data);

export const removeOrderDiscount = (orderId, discountId) =>
  http
    .delete(`${base}/orders/${orderId}/discounts/${discountId}`)
    .then((r) => r.data);

// Update order (tip_total, customer_name, note, etc.)
export const updateOrder = (orderId, payload) =>
  http.put(`${base}/orders/${orderId}`, payload).then((r) => r.data);

// Line modifiers
export const addLineModifier = (lineId, modifierOptionId) =>
  http
    .post(`${base}/orders/lines/${lineId}/modifiers`, { modifier_option_id: modifierOptionId })
    .then((r) => r.data);

export const deleteLineModifier = (lineModifierId) =>
  http.delete(`${base}/orders/line-modifiers/${lineModifierId}`).then((r) => r.data);