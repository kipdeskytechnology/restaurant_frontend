<!-- src/views/expenses/Expenses.vue -->
<script setup>
import { ref, onMounted, computed, nextTick, watch } from "vue";
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
const refreshing = ref(false);
const saving = ref(false);

const expenses = ref([]);
const outlets = ref([]);

const outletId = ref(null);
const status = ref("all");
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
  expense_date: "",
  vendor_name: "",
  reference_no: "",
  subtotal: 0,
  tax_total: 0,
  total_amount: "",
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
const outletLabel = (id) => outletNameById.value.get(Number(id)) || (id ? `Outlet #${id}` : "—");

const filtered = computed(() => {
  const qq = q.value.trim().toLowerCase();
  if (!qq) return expenses.value || [];
  return (expenses.value || []).filter((e) => {
    const hay = `${e.expense_no || ""} ${e.title || ""} ${e.category || ""} ${e.vendor_name || ""}`.toLowerCase();
    return hay.includes(qq);
  });
});

const summary = computed(() => {
  const total = expenses.value.length;
  let draft = 0, approved = 0, posted = 0, cancelled = 0;
  let amount = 0;
  for (const e of expenses.value) {
    const s = String(e.status || "").toUpperCase();
    if (s === "DRAFT") draft++;
    else if (s === "APPROVED") approved++;
    else if (s === "POSTED") posted++;
    else if (s === "CANCELLED") cancelled++;
    amount += Number(e.total_amount) || 0;
  }
  return { total, draft, approved, posted, cancelled, amount };
});

const fmtMoney = (v) => {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// Category icon + color
const CATEGORY_STYLE = {
  GENERAL:     { color: "#6366f1", icon: "ri-folder-line" },
  UTILITIES:   { color: "#06b6d4", icon: "ri-flashlight-line" },
  RENT:        { color: "#8b5cf6", icon: "ri-home-2-line" },
  SUPPLIES:    { color: "#10b981", icon: "ri-shopping-bag-3-line" },
  MAINTENANCE: { color: "#f59e0b", icon: "ri-tools-line" },
  TRANSPORT:   { color: "#0ea5e9", icon: "ri-truck-line" },
  SALARIES:    { color: "#ec4899", icon: "ri-user-3-line" },
  MARKETING:   { color: "#f43f5e", icon: "ri-megaphone-line" },
  OTHER:       { color: "#64748b", icon: "ri-more-2-line" },
};
const CATEGORY_KEYS = Object.keys(CATEGORY_STYLE);
function categoryStyle(cat) {
  return CATEGORY_STYLE[cat] || { color: "#64748b", icon: "ri-folder-line" };
}

function statusTone(s) {
  const u = String(s || "").toUpperCase();
  if (u === "DRAFT") return "default";
  if (u === "APPROVED") return "info";
  if (u === "POSTED") return "success";
  if (u === "CANCELLED") return "danger";
  return "default";
}

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

function closeModal() { modalInstance?.hide(); }

function validate() {
  triedSubmit.value = true;
  const out = Number(form.value.outlet_id);
  if (!out) { toast.error("Outlet is required"); return false; }
  if (!String(form.value.title || "").trim()) { toast.error("Title is required"); return false; }
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

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
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
    refreshing.value = false;
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
    await load(false);
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
    toast.success("Expense deleted");
    await load(false);
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

// Auto-reload on filter changes (debounced)
let filterTimer = null;
watch(
  () => [outletId.value, status.value, fromDate.value, toDate.value],
  () => {
    if (loading.value) return;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => load(false), 250);
  }
);

// Computed totals for the form (helps user know what they'll create)
const formAutoTotal = computed(() => {
  const sub = Number(form.value.subtotal) || 0;
  const tax = Number(form.value.tax_total) || 0;
  return sub + tax;
});

onMounted(async () => {
  resetForm();
  await loadOutlets();
  await load();
});
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-bill-line"></i><span>Expenses</span>
          </div>
          <h1 class="hero-title">Expenses</h1>
          <p class="hero-sub">
            Track every kwacha that leaves the till — utilities, rent, supplies, payroll. Approve, post, then pay from a shift's cash drawer.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button v-can="['expense:create','expense:manage']" class="btn btn-pill btn-cta" @click="openCreate">
            <i class="ri-add-line"></i><span>New Expense</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon tone-info"><i class="ri-list-check-2"></i></div>
          <div>
            <div class="stat-label">Records</div>
            <div class="stat-value">{{ summary.total }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-default"><i class="ri-edit-line"></i></div>
          <div>
            <div class="stat-label">Draft</div>
            <div class="stat-value">{{ summary.draft }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-cyan"><i class="ri-check-line"></i></div>
          <div>
            <div class="stat-label">Approved</div>
            <div class="stat-value">{{ summary.approved }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-success"><i class="ri-send-plane-line"></i></div>
          <div>
            <div class="stat-label">Posted</div>
            <div class="stat-value">{{ summary.posted }}</div>
          </div>
        </div>
        <div class="stat-tile stat-emphasis">
          <div class="stat-icon tone-rose"><i class="ri-bill-line"></i></div>
          <div>
            <div class="stat-label">Total spend</div>
            <div class="stat-value text-rose">K {{ fmtMoney(summary.amount) }}</div>
          </div>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2 overflow-visible">
          <div class="row g-2 align-items-end overflow-visible">
            <div class="col-md-3 overflow-visible">
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
              <label class="form-label">Search</label>
              <div class="position-relative">
                <i class="ri-search-line search-ico"></i>
                <input v-model="q" class="form-control ps-5" placeholder="No, title, vendor, category…" />
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

            <div class="col-12 d-flex gap-2 flex-wrap mt-1 align-items-center">
              <button class="btn btn-soft-primary btn-sm" :disabled="loading" @click="load(false)">
                <i class="ri-refresh-line me-1"></i> Apply
              </button>
              <button class="btn btn-light btn-sm" :disabled="loading" @click="clearFilters">
                <i class="ri-filter-off-line me-1"></i> Clear
              </button>

              <div class="ms-auto small text-muted">
                Showing <strong>{{ filtered.length }}</strong> of <strong>{{ expenses.length }}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading expenses…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="!expenses.length" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-bill-line"></i></div>
        <h5 class="mt-2 mb-1">No expenses yet</h5>
        <p class="text-muted mb-3">Create your first expense — utilities, rent, supplies…</p>
        <div>
          <button v-can="['expense:create','expense:manage']" class="btn btn-primary" @click="openCreate">
            <i class="ri-add-line me-1"></i> New expense
          </button>
        </div>
      </div>

      <!-- Empty (search) -->
      <div v-else-if="!filtered.length" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-search-line"></i></div>
        <h5 class="mt-2 mb-1">No matches</h5>
        <p class="text-muted mb-3">Try clearing or widening your filters.</p>
        <div>
          <button class="btn btn-light" @click="clearFilters">
            <i class="ri-close-line me-1"></i> Clear filters
          </button>
        </div>
      </div>

      <!-- ============== Expenses table ============== -->
      <div v-else class="card data-card">
        <div class="card-body p-0">
          <div class="table-responsive data-scroll">
            <table class="table align-middle mb-0 exp-table">
              <thead>
                <tr>
                  <th style="width: 130px">Expense No</th>
                  <th>Title</th>
                  <th style="width: 170px">Category</th>
                  <th style="width: 160px">Outlet</th>
                  <th style="width: 110px">Date</th>
                  <th style="width: 120px">Status</th>
                  <th style="width: 130px" class="text-end">Total</th>
                  <th style="width: 130px" class="text-end"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="e in filtered"
                  :key="e.id"
                  class="exp-row"
                  @click="goView(e)"
                >
                  <td>
                    <span class="exp-no-chip">{{ e.expense_no }}</span>
                  </td>

                  <td>
                    <div class="exp-title">{{ e.title }}</div>
                    <div class="exp-vendor" v-if="e.vendor_name">
                      <i class="ri-store-3-line me-1"></i>{{ e.vendor_name }}
                    </div>
                  </td>

                  <td>
                    <span class="cat-chip" :style="{ '--accent': categoryStyle(e.category).color }">
                      <i :class="categoryStyle(e.category).icon"></i>
                      {{ e.category }}
                    </span>
                  </td>

                  <td>
                    <span class="outlet-chip">
                      <i class="ri-store-2-line me-1"></i>{{ outletLabel(e.outlet_id) }}
                    </span>
                  </td>

                  <td>
                    <div class="when-date">{{ fmtDate(e.expense_date) }}</div>
                  </td>

                  <td>
                    <span class="status-chip" :class="`tone-${statusTone(e.status)}`">
                      <span class="dot-mini"></span>{{ e.status }}
                    </span>
                  </td>

                  <td class="text-end">
                    <span class="amount-mono">K {{ fmtMoney(e.total_amount) }}</span>
                  </td>

                  <td class="text-end" @click.stop>
                    <button class="row-icon-btn" title="View" @click="goView(e)">
                      <i class="ri-eye-line"></i>
                    </button>
                    <button v-can="'expense:manage'" class="row-icon-btn" title="Edit" @click="openEdit(e)">
                      <i class="ri-pencil-line"></i>
                    </button>
                    <button v-can="'expense:manage'" class="row-icon-btn danger" title="Delete" @click="remove(e)">
                      <i class="ri-delete-bin-line"></i>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="px-3 py-2 small text-muted footnote">
            <i class="ri-information-line me-1"></i>
            Click a row to open the expense · Up to 200 records per load
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Modal: Create / Edit ============== -->
    <div class="modal fade" tabindex="-1" aria-hidden="true" ref="modalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditMode ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isEditMode ? "Edit expense" : "New expense" }}</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="saving"></button>
          </div>

          <div v-if="saving" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <form @submit.prevent="save" novalidate :class="{ 'was-validated': triedSubmit }">
              <div class="row g-3">
                <div class="col-md-4">
                  <label class="form-label">Outlet *</label>
                  <SearchSelect
                    v-model="form.outlet_id"
                    :options="outletOptions"
                    placeholder="Select outlet…"
                    :clearable="true"
                  />
                  <div v-if="triedSubmit && !form.outlet_id" class="text-danger small mt-1">
                    Outlet is required.
                  </div>
                </div>

                <div class="col-md-8">
                  <label class="form-label">Title *</label>
                  <input v-model="form.title" class="form-control" placeholder="e.g. Generator service" required />
                </div>

                <div class="col-md-4">
                  <label class="form-label">Category</label>
                  <select v-model="form.category" class="form-select">
                    <option v-for="key in CATEGORY_KEYS" :key="key" :value="key">{{ key }}</option>
                  </select>
                </div>

                <div class="col-md-4">
                  <label class="form-label">Expense date</label>
                  <input v-model="form.expense_date" type="date" class="form-control" />
                </div>

                <div class="col-md-4">
                  <label class="form-label">Reference no</label>
                  <input v-model="form.reference_no" class="form-control" placeholder="Invoice / Receipt #" />
                </div>

                <div class="col-md-12">
                  <label class="form-label">Vendor</label>
                  <input v-model="form.vendor_name" class="form-control" placeholder="Supplier or service provider" />
                </div>

                <div class="col-12">
                  <div class="amount-card">
                    <div class="amount-card-row">
                      <div>
                        <label class="form-label">Subtotal</label>
                        <div class="input-group">
                          <span class="input-group-text">K</span>
                          <input v-model="form.subtotal" type="number" step="0.01" class="form-control" placeholder="0.00" />
                        </div>
                      </div>
                      <div class="op">+</div>
                      <div>
                        <label class="form-label">Tax</label>
                        <div class="input-group">
                          <span class="input-group-text">K</span>
                          <input v-model="form.tax_total" type="number" step="0.01" class="form-control" placeholder="0.00" />
                        </div>
                      </div>
                      <div class="op">=</div>
                      <div>
                        <label class="form-label">Total <span class="text-muted">(optional override)</span></label>
                        <div class="input-group">
                          <span class="input-group-text">K</span>
                          <input
                            v-model="form.total_amount"
                            type="number"
                            step="0.01"
                            class="form-control"
                            :placeholder="formAutoTotal.toFixed(2)"
                          />
                        </div>
                      </div>
                    </div>
                    <div class="amount-card-foot">
                      <span class="muted small"><i class="ri-information-line me-1"></i>Leave Total blank to auto-compute (Subtotal + Tax = </span>
                      <strong class="ms-1">K {{ fmtMoney(formAutoTotal) }}</strong><span class="muted small">)</span>
                    </div>
                  </div>
                </div>

                <div class="col-12">
                  <label class="form-label">Notes</label>
                  <textarea v-model="form.notes" class="form-control" rows="2" placeholder="Optional notes…"></textarea>
                </div>

                <div class="col-12">
                  <div class="tip-card">
                    <i class="ri-paperclip-line tip-icon"></i>
                    <div class="small">
                      <div class="fw-semibold mb-1">Receipts go on the next screen</div>
                      <div class="text-muted">
                        Save first, then upload receipts (pdf/png/jpg/webp, up to 10MB each) from the expense detail view.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              {{ isEditMode ? "Update expense" : "Create expense" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
.rotating { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ============= Hero (expense amber → rose → pink) ============= */
.page-hero {
  position: relative;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem;
  padding: 1.5rem 1.75rem; margin-bottom: 1.25rem;
  border-radius: 22px;
  background: linear-gradient(135deg, #f59e0b 0%, #f43f5e 55%, #ec4899 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(244, 63, 94, 0.55);
  overflow: hidden; flex-wrap: wrap;
}
.page-hero::before {
  content: ""; position: absolute; inset: 0;
  background:
    radial-gradient(220px 140px at 90% 10%, rgba(255,255,255,0.22), transparent 65%),
    radial-gradient(280px 180px at 0% 110%, rgba(255,255,255,0.14), transparent 65%);
  pointer-events: none;
}
.page-hero-text { position: relative; max-width: 600px; }
.eyebrow {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.25rem 0.65rem;
  background: rgba(255,255,255,0.18);
  border-radius: 999px;
  font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  margin-bottom: 0.6rem;
}
.hero-title { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.025em; font-size: 1.85rem; margin: 0; color: #fff; }
.hero-sub { color: rgba(255,255,255,0.85); margin: 0.35rem 0 0; font-size: 0.9rem; }
.page-hero-actions { position: relative; display: flex; gap: 0.5rem; flex-wrap: wrap; }
.btn-pill { border-radius: 999px !important; display: inline-flex; align-items: center; gap: 0.4rem; }
.page-hero-actions .btn-light { background: rgba(255,255,255,0.95); color: #0f172a; border: none; }
.btn-cta {
  background: #fff !important; color: #b91c1c !important;
  font-weight: 700; border: none;
  box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3);
}
.btn-cta:hover { background: #fff !important; color: #991b1b !important; }

/* ============= Stat strip ============= */
.stat-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 0.75rem;
}
.stat-tile {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.85rem 1rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.stat-emphasis { background: linear-gradient(135deg, rgba(244,63,94,0.06), transparent); border-color: rgba(244,63,94,0.2); }
.stat-icon {
  width: 38px; height: 38px; border-radius: 10px;
  display: grid; place-items: center;
  font-size: 1.05rem;
}
.stat-icon.tone-info { background: rgba(99,102,241,0.12); color: #4f46e5; }
.stat-icon.tone-default { background: rgba(100,116,139,0.14); color: #64748b; }
.stat-icon.tone-cyan { background: rgba(6,182,212,0.14); color: #0e7490; }
.stat-icon.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.stat-icon.tone-rose { background: rgba(244,63,94,0.14); color: #be123c; }
.stat-label {
  font-size: 0.7rem; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ct-secondary-color, #64748b);
}
.stat-value {
  font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800;
  letter-spacing: -0.02em; font-size: 1.05rem;
  color: var(--ct-body-color, #0f172a);
}
.text-rose { color: #be123c !important; }

/* ============= Toolbar / Empty ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(244,63,94,0.05) 0%, transparent 100%); }
.overflow-visible { overflow: visible !important; }
.search-ico {
  position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8); pointer-events: none;
}
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(244,63,94,0.12); color: #be123c; font-size: 1.6rem;
}

/* ============= Expenses table ============= */
.data-card { overflow: hidden; }
.data-scroll {
  max-height: calc(100vh - 480px);
  min-height: 220px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }
.data-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.5); }

.exp-table thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.exp-row { cursor: pointer; transition: background 0.15s ease; }
.exp-row:hover { background: rgba(244,63,94,0.04); }

.exp-no-chip {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.78rem; font-weight: 700;
  padding: 0.2rem 0.55rem; border-radius: 6px;
  background: rgba(244,63,94,0.1); color: #be123c;
  border: 1px solid rgba(244,63,94,0.22);
}

.exp-title { font-weight: 700; color: var(--ct-body-color, #0f172a); line-height: 1.25; }
.exp-vendor { font-size: 0.72rem; color: var(--ct-secondary-color, #64748b); font-weight: 600; margin-top: 0.15rem; }

.cat-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  font-size: 0.72rem; font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 22%, transparent);
}
.cat-chip i { font-size: 0.85rem; }

.outlet-chip {
  display: inline-flex; align-items: center;
  font-size: 0.78rem; font-weight: 600;
  padding: 0.2rem 0.55rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 8px;
  color: var(--ct-secondary-color, #475569);
}
.when-date { font-weight: 700; font-size: 0.82rem; color: var(--ct-body-color, #0f172a); }

.status-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em;
}
.dot-mini { width: 6px; height: 6px; border-radius: 50%; }
.tone-default { background: rgba(100,116,139,0.14); color: #475569; }
.tone-default .dot-mini { background: #94a3b8; }
.tone-info { background: rgba(6,182,212,0.14); color: #0e7490; }
.tone-info .dot-mini { background: #06b6d4; }
.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.tone-success .dot-mini { background: #10b981; }
.tone-danger { background: rgba(239,68,68,0.14); color: #b91c1c; }
.tone-danger .dot-mini { background: #ef4444; }

.amount-mono {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700; font-size: 0.88rem;
  color: var(--ct-body-color, #0f172a);
}

.row-icon-btn {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
  margin-left: 2px;
}
.row-icon-btn:hover { background: rgba(244,63,94,0.1); color: #be123c; }
.row-icon-btn.danger:hover { background: rgba(239,68,68,0.12); color: #ef4444; }

.footnote { border-top: 1px dashed var(--ct-border-color, #e6e9ef); }

/* ============= Modal ============= */
:deep(.modal-modern) {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 22px !important;
  overflow: hidden;
  box-shadow: 0 30px 60px -20px rgba(15,23,42,0.35);
  background: var(--ct-card-bg, #fff);
}
:deep(.modal-header-modern) {
  padding: 1.25rem 1.5rem 1rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  display: flex; justify-content: space-between; align-items: flex-start;
}
:deep(.modal-eyebrow) {
  font-size: 0.68rem; font-weight: 700; color: #be123c;
  letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.25rem;
}
:deep(.modal-header-modern .modal-title) {
  font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800;
  letter-spacing: -0.02em; font-size: 1.25rem;
}
:deep(.modal-body-modern) {
  padding: 1.5rem;
  max-height: calc(100vh - 240px);
  overflow-y: auto;
  scrollbar-width: thin;
}

.modal-overlay {
  position: absolute; inset: 0; z-index: 5;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
}

.amount-card {
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  padding: 0.85rem 1rem;
}
.amount-card-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1.4fr;
  gap: 0.5rem;
  align-items: end;
}
.amount-card .op {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 1.4rem;
  color: var(--ct-secondary-color, #94a3b8);
  padding-bottom: 0.45rem;
  text-align: center;
}
.amount-card-foot {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--ct-border-color, #e6e9ef);
  display: flex; align-items: center; flex-wrap: wrap;
}
.muted { color: var(--ct-secondary-color, #64748b); }

.tip-card {
  display: flex; gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: rgba(244,63,94,0.05);
  border: 1px solid rgba(244,63,94,0.18);
  align-items: flex-start;
}
.tip-icon { font-size: 1.2rem; color: #be123c; flex-shrink: 0; }

@media (max-width: 767.98px) {
  .amount-card-row { grid-template-columns: 1fr; }
  .amount-card .op { display: none; }
}

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
