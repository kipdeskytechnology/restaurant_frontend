// src/api/expenses.js
import http from "./http";

const base = "/expenses";

// List
export const listExpenses = (params = {}) =>
  http.get(base, { params }).then((r) => r.data);

// Get one
export const getExpense = (id) =>
  http.get(`${base}/${id}`).then((r) => r.data);

// Create / Update / Delete
export const createExpense = (payload) =>
  http.post(base, payload).then((r) => r.data);

export const updateExpense = (id, payload) =>
  http.put(`${base}/${id}`, payload).then((r) => r.data);

export const deleteExpense = (id) =>
  http.delete(`${base}/${id}`).then((r) => r.data);

// Workflow
export const approveExpense = (id, payload = {}) =>
  http.post(`${base}/${id}/approve`, payload).then((r) => r.data);

export const postExpense = (id, payload = {}) =>
  http.post(`${base}/${id}/post`, payload).then((r) => r.data);

// Accounting link: creates CashMovement with reference_type="EXPENSE"
export const payExpense = (id, payload) =>
  http.post(`${base}/${id}/pay`, payload).then((r) => r.data);

// Attachments
export const listExpenseAttachments = (expenseId) =>
  http.get(`${base}/${expenseId}/attachments`).then((r) => r.data);

export const uploadExpenseAttachment = (expenseId, file) => {
  const form = new FormData();
  form.append("file", file);
  return http
    .post(`${base}/${expenseId}/attachments`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};

export const deleteExpenseAttachment = (attachmentId) =>
  http.delete(`${base}/attachments/${attachmentId}`).then((r) => r.data);
