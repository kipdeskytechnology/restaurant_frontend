<!-- src/views/expenses/Expenses.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import { useToast } from "vue-toastification";
import { useRouter } from "vue-router";

import DefaultLayout from "../../layouts/DefaultLayout.vue";
import SearchSelect from "../../components/SearchSelect.vue";

import { listOutlets } from "../../api/systemOutlets";
import {
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
} from "../../api/expenses";

const toast = useToast();
const router = useRouter();

const loading = ref(true);
const saving = ref(false);

const expenses = ref([]);
const outlets = ref([]);

const outletId = ref(null);
const status = ref("all"); // all|draft|approved|posted|cancelled
const q = ref("");
const fromDate = ref("");
const toDate = ref("");

const modalEl = ref(null);
let modalInstance = null;

const editId = ref(null);
const triedSubmit = ref(false);

const form = ref({
  outlet_id: null,
  title: "",
  category: "GENERAL",
  expense_date: "", // yyyy-mm-dd
  vendor_name: "",
  reference_no: "",
  subtotal: 0,
  tax_total: 0,
  total_amount: "", // optional
  notes: "",
});

const isEditMode = computed(() => !!editId.value);

const outletOptions = computed(() =>
  (outlets.value || []).map((o) => ({
    label: o.name ?? `Outlet #${o.id}`,
    value: o.id,
  }))
);

const outletNameById = computed(() => {
  const m = new Map();
  for (const o of outlets.value || []) m.set(Number(o.id), o.name ?? `Outlet #${o.id}`);
  return m;
});
const outletLabel = (id) => outletNameById.value.get(Number(id)) || (id ? `Outlet #${id}` : "");

const filtered = computed(() => {
  const qq = q.value.trim().toLowerCase();
  if (!qq) return expenses.value || [];
  return (expenses.value || []).filter((e) => {
    const hay = `${e.expense_no || ""} ${e.title || ""} ${e.category || ""}`.toLowerCase();
    return hay.includes(qq);
  });
});

const fmtMoney = (v) => {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

async function ensureModal() {
  if (modalInstance) return;
  try {
    const m = await import("bootstrap/js/dist/modal");
    modalInstance = new m.default(modalEl.value, { backdrop: "static", keyboard: false });
  } catch {
    modalInstance = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(modalEl.value, { backdrop: "static", keyboard: false })
      : null;
  }
}

function resetForm() {
  editId.value = null;
  triedSubmit.value = false;
  form.value = {
    outlet_id: outletId.value ?? null,
    title: "",
    category: "GENERAL",
    expense_date: "",
    vendor_name: "",
    reference_no: "",
    subtotal: 0,
    tax_total: 0,
    total_amount: "",
    notes: "",
  };
}

function setFormFromRow(row) {
  editId.value = row.id;
  triedSubmit.value = false;
  form.value = {
    outlet_id: row.outlet_id ?? null,
    title: row.title ?? "",
    category: row.category ?? "GENERAL",
    expense_date: row.expense_date ?? "",
    vendor_name: row.vendor_name ?? "",
    reference_no: row.reference_no ?? "",
    subtotal: Number(row.subtotal ?? 0),
    tax_total: Number(row.tax_total ?? 0),
    total_amount: row.total_amount ?? "",
    notes: row.notes ?? "",
  };
}

async function openCreate() {
  resetForm();
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

async function openEdit(row) {
  setFormFromRow(row);
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

function closeModal() {
  modalInstance?.hide();
}

function validate() {
  triedSubmit.value = true;

  const out = Number(form.value.outlet_id);
  if (!out) {
    toast.error("Outlet is required");
    return false;
  }
  if (!String(form.value.title || "").trim()) {
    toast.error("Title is required");
    return false;
  }
  return true;
}

async function loadOutlets() {
  try {
    outlets.value = await listOutlets();
  } catch (e) {
    outlets.value = [];
    toast.error(e?.response?.data?.detail || "Failed to load outlets");
  }
}

async function load() {
  loading.value = true;
  try {
    expenses.value = await listExpenses({
      outlet_id: outletId.value ?? undefined,
      status: status.value,
      q: q.value?.trim() || undefined,
      from_date: fromDate.value || undefined,
      to_date: toDate.value || undefined,
      limit: 200,
    });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load expenses");
    expenses.value = [];
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!validate()) return;

  saving.value = true;
  try {
    const payload = {
      outlet_id: Number(form.value.outlet_id),
      title: String(form.value.title || "").trim(),
      category: String(form.value.category || "GENERAL").toUpperCase(),
      expense_date: form.value.expense_date || undefined,
      vendor_name: String(form.value.vendor_name || "").trim() || undefined,
      reference_no: String(form.value.reference_no || "").trim() || undefined,
      subtotal: Number(form.value.subtotal || 0),
      tax_total: Number(form.value.tax_total || 0),
      total_amount:
        form.value.total_amount === "" || form.value.total_amount === null
          ? undefined
          : Number(form.value.total_amount),
      notes: String(form.value.notes || "").trim() || undefined,
    };

    if (editId.value) {
      await updateExpense(editId.value, payload);
      toast.success("Expense updated");
    } else {
      await createExpense(payload);
      toast.success("Expense created");
    }

    closeModal();
    resetForm();
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save expense");
  } finally {
    saving.value = false;
  }
}

async function remove(row) {
  if (!confirm(`Delete expense ${row.expense_no}?`)) return;
  try {
    await deleteExpense(row.id);
    toast.success("Deleted");
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete");
  }
}

function goView(row) {
  router.push({ name: "expense-view", params: { id: row.id } });
}

function clearFilters() {
  outletId.value = null;
  status.value = "all";
  q.value = "";
  fromDate.value = "";
  toDate.value = "";
}

onMounted(async () => {
  resetForm();
  await loadOutlets();
  await load();
});
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Expenses</h4>
        <div class="text-muted small">Create, approve, post and attach receipts</div>
      </div>

      <button class="btn btn-primary" @click="openCreate">
        <i class="ri-add-line me-1"></i> Add Expense
      </button>
    </div>

    <div v-if="loading" class="card" style="zoom: 80%;">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading expenses...</div>
      </div>
    </div>

    <div v-else class="row" style="zoom: 80%;">
      <div class="col-12">
        <div class="card exp-card mb-3 overflow-visible">
          <div class="card-body p-2">
            <div class="row g-2 align-items-end">
              <div class="col-md-3">
                <label class="form-label">Outlet</label>
                <SearchSelect
                  v-model="outletId"
                  :options="outletOptions"
                  placeholder="All outlets"
                  :nullLabel="'All outlets'"
                  :clearable="true"
                />
              </div>

              <div class="col-md-2">
                <label class="form-label">Status</label>
                <select v-model="status" class="form-select">
                  <option value="all">All</option>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                  <option value="posted">Posted</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div class="col-md-3">
                <label class="form-label">Quick Search</label>
                <div class="input-group">
                  <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
                  <input v-model="q" class="form-control" placeholder="Search expense no or title..." />
                </div>
              </div>

              <div class="col-md-2">
                <label class="form-label">From</label>
                <input v-model="fromDate" type="date" class="form-control" />
              </div>

              <div class="col-md-2">
                <label class="form-label">To</label>
                <input v-model="toDate" type="date" class="form-control" />
              </div>

              <div class="col-12 d-flex gap-2 mt-1">
                <button class="btn btn-primary" :disabled="loading" @click="load">
                  <i class="ri-refresh-line me-1"></i> Load
                </button>
                <button class="btn btn-light" :disabled="loading" @click="clearFilters">Clear</button>

                <div class="ms-auto text-muted small align-self-center">
                  Showing <strong>{{ filtered.length }}</strong> of <strong>{{ expenses.length }}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Table -->
      <div class="col-12">
        <div class="card exp-card">
          <div class="card-body p-0">
            <div class="table-responsive">
              <table class="table table-sm table-centered table-bordered mb-0">
                <thead class="bg-light">
                  <tr>
                    <th>No</th>
                    <th>Outlet</th>
                    <th>Title</th>
                    <th>Category</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th class="text-end">Total</th>
                    <th class="text-end">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  <tr v-for="e in filtered" :key="e.id">
                    <td class="fw-semibold">{{ e.expense_no }}</td>
                    <td class="fw-semibold">{{ outletLabel(e.outlet_id) }}</td>
                    <td class="fw-semibold">{{ e.title }}</td>
                    <td>{{ e.category }}</td>
                    <td>{{ e.expense_date }}</td>
                    <td>
                      <span class="badge"
                        :class="e.status === 'DRAFT' ? 'bg-secondary'
                          : e.status === 'APPROVED' ? 'bg-info'
                          : e.status === 'POSTED' ? 'bg-success'
                          : 'bg-dark'">
                        {{ e.status }}
                      </span>
                    </td>
                    <td class="text-end fw-semibold">{{ fmtMoney(e.total_amount) }}</td>

                    <td class="text-end">
                      <button class="btn btn-sm btn-soft-primary me-1" @click="goView(e)">
                        <i class="ri-eye-line me-1"></i> View
                      </button>
                      <button class="btn btn-sm btn-soft-secondary me-1" @click="openEdit(e)">
                        <i class="ri-edit-line me-1"></i> Edit
                      </button>
                      <button class="btn btn-sm btn-soft-danger" @click="remove(e)">
                        <i class="ri-delete-bin-line me-1"></i> Delete
                      </button>
                    </td>
                  </tr>

                  <tr v-if="filtered.length === 0">
                    <td colspan="8" class="text-center text-muted py-4">No matching expenses.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Create/Edit -->
    <div class="modal fade" tabindex="-1" role="dialog" ref="modalEl" style="zoom: 80%;">
      <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content position-relative exp-modal">
          <div class="modal-header bg-light">
            <h4 class="modal-title">{{ isEditMode ? "Edit Expense" : "Create Expense" }}</h4>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="saving"></button>
          </div>

          <div v-if="saving" class="exp-overlay" aria-hidden="true">
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body">
            <form @submit.prevent="save" novalidate :class="{ 'was-validated': triedSubmit }">
              <div class="row g-2">
                <div class="col-md-4">
                  <label class="form-label">Outlet *</label>
                  <SearchSelect
                    v-model="form.outlet_id"
                    :options="outletOptions"
                    placeholder="Select outlet…"
                    :clearable="true"
                  />
                  <div v-if="triedSubmit && !form.outlet_id" class="invalid-feedback d-block">
                    Outlet is required.
                  </div>
                </div>

                <div class="col-md-8">
                  <label class="form-label">Title *</label>
                  <input v-model="form.title" class="form-control" placeholder="e.g. Generator service" required />
                  <div class="invalid-feedback">Title is required.</div>
                </div>

                <div class="col-md-4">
                  <label class="form-label">Category</label>
                  <select v-model="form.category" class="form-select">
                    <option value="GENERAL">GENERAL</option>
                    <option value="UTILITIES">UTILITIES</option>
                    <option value="RENT">RENT</option>
                    <option value="SUPPLIES">SUPPLIES</option>
                    <option value="MAINTENANCE">MAINTENANCE</option>
                    <option value="TRANSPORT">TRANSPORT</option>
                    <option value="SALARIES">SALARIES</option>
                    <option value="MARKETING">MARKETING</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </div>

                <div class="col-md-4">
                  <label class="form-label">Expense Date</label>
                  <input v-model="form.expense_date" type="date" class="form-control" />
                </div>

                <div class="col-md-4">
                  <label class="form-label">Reference No</label>
                  <input v-model="form.reference_no" class="form-control" placeholder="Invoice / Receipt No" />
                </div>

                <div class="col-md-6">
                  <label class="form-label">Vendor</label>
                  <input v-model="form.vendor_name" class="form-control" placeholder="Supplier name" />
                </div>

                <div class="col-md-2">
                  <label class="form-label">Subtotal</label>
                  <input v-model="form.subtotal" type="number" step="0.01" class="form-control" />
                </div>

                <div class="col-md-2">
                  <label class="form-label">Tax</label>
                  <input v-model="form.tax_total" type="number" step="0.01" class="form-control" />
                </div>

                <div class="col-md-2">
                  <label class="form-label">Total (opt)</label>
                  <input v-model="form.total_amount" type="number" step="0.01" class="form-control" />
                </div>

                <div class="col-12">
                  <label class="form-label">Notes</label>
                  <textarea v-model="form.notes" class="form-control" rows="2" placeholder="Optional notes"></textarea>
                </div>
              </div>

              <div class="alert alert-light border mt-3 mb-0">
                <div class="d-flex align-items-start gap-2">
                  <i class="ri-information-line mt-1"></i>
                  <div class="small">
                    <div class="fw-semibold">Tip</div>
                    <div class="text-muted">
                      You can attach receipts in the expense view page after saving.
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving">Saving...</span>
              <span v-else>{{ isEditMode ? "Update" : "Create" }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
.exp-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
}
.table thead.bg-light th {
  background: var(--ct-tertiary-bg) !important;
  color: var(--ct-emphasis-color) !important;
}
.exp-modal {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
}
.exp-overlay {
  position: absolute;
  inset: 0;
  background: rgba(var(--ct-body-bg-rgb), 0.72);
  backdrop-filter: blur(2px);
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}
.overflow-visible {
  overflow: visible !important;
}
</style>
