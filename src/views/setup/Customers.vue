<!-- src/views/setup/Customers.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import {
  listCustomers,
  createCustomer,
  updateCustomer,
  toggleCustomer,
} from "../../api/setupCustomers";

const toast = useToast();

const loading = ref(true);
const saving = ref(false);

const customers = ref([]);
const q = ref("");
const active = ref("1"); // 1|0|all

// Modal
const modalEl = ref(null);
let modalInstance = null;

// Edit
const editId = ref(null);
const triedSubmit = ref(false);

const form = ref({
  code: "",
  name: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  is_active: true,
});

const isEditMode = computed(() => !!editId.value);

function resetForm() {
  editId.value = null;
  triedSubmit.value = false;
  form.value = {
    code: "",
    name: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
    is_active: true,
  };
}

function setFormFromCustomer(c) {
  editId.value = c.id;
  triedSubmit.value = false;
  form.value = {
    code: c.code || "",
    name: c.name || "",
    phone: c.phone || "",
    email: c.email || "",
    address: c.address || "",
    notes: c.notes || "",
    is_active: !!c.is_active,
  };
}

function normalizePayload() {
  return {
    code: form.value.code ? form.value.code.trim().toUpperCase() : null,
    name: (form.value.name || "").trim(),
    phone: form.value.phone ? form.value.phone.trim() : null,
    email: form.value.email ? form.value.email.trim() : null,
    address: (form.value.address || "").trim() || null,
    notes: (form.value.notes || "").trim() || null,
    is_active: !!form.value.is_active,
  };
}

async function load() {
  loading.value = true;
  try {
    customers.value = await listCustomers({
      q: q.value || undefined,
      active: active.value,
    });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load customers");
  } finally {
    loading.value = false;
  }
}

function validate() {
  triedSubmit.value = true;
  const payload = normalizePayload();

  if (!payload.name) {
    toast.error("Customer name is required.");
    return false;
  }
  return true;
}

async function save() {
  if (!validate()) return;

  saving.value = true;
  try {
    const payload = normalizePayload();

    if (editId.value) {
      await updateCustomer(editId.value, payload);
      toast.success("Customer updated");
    } else {
      await createCustomer(payload);
      toast.success("Customer created");
    }

    closeModal();
    resetForm();
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save customer");
  } finally {
    saving.value = false;
  }
}

async function toggle(c) {
  try {
    await toggleCustomer(c.id);
    toast.success("Updated");
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed");
  }
}

// Dummy actions
function printStatement(c) {
  toast.info(`Print statement (dummy) for: ${c.name}`);
}
function sendStatement(c) {
  toast.info(`Send statement (dummy) for: ${c.name}`);
}

async function ensureModal() {
  if (modalInstance) return;

  try {
    const m = await import("bootstrap/js/dist/modal");
    modalInstance = new m.default(modalEl.value, { backdrop: "static", keyboard: false });
  } catch (e) {
    modalInstance = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(modalEl.value, { backdrop: "static", keyboard: false })
      : null;
  }
}

async function openCreate() {
  resetForm();
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

async function openEdit(c) {
  setFormFromCustomer(c);
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

function closeModal() {
  modalInstance?.hide();
}

function onCardClick(c) {
  openEdit(c);
}

function clearSearch() {
  q.value = "";
  active.value = "1";
  load();
}

const counts = computed(() => ({
  total: customers.value.length,
  active: customers.value.filter((c) => c.is_active).length,
  inactive: customers.value.filter((c) => !c.is_active).length,
}));

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "CU";
  const a = parts[0]?.[0] || "C";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (a + b).toUpperCase();
}

function safe(v) {
  return v && String(v).trim() ? v : "-";
}

function stop(e) {
  e?.stopPropagation?.();
}

function onKeyOpen(e, c) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openEdit(c);
  }
}

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Customers</h4>
        <div class="text-muted small">
          <strong>{{ counts.total }}</strong> total •
          <span class="text-success"><strong>{{ counts.active }}</strong> active</span> •
          <span class="text-secondary"><strong>{{ counts.inactive }}</strong> inactive</span>
        </div>
      </div>

      <button class="btn btn-primary" @click="openCreate">
        <i class="ri-user-add-line me-1"></i> New Customer
      </button>
    </div>

    <!-- Filters -->
    <div class="card mb-3" style="zoom: 80%;">
      <div class="card-body py-2">
        <div class="row g-2 align-items-end">
          <div class="col-md-6">
            <label class="form-label mb-1">Search</label>
            <div class="input-group">
              <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
              <input
                v-model="q"
                class="form-control"
                placeholder="Search by name, code, phone, or email (press Enter)"
                @keyup.enter="load"
              />
              <button class="btn btn-secondary" :disabled="loading" @click="load">
                <span v-if="loading">Searching...</span>
                <span v-else>Search</span>
              </button>
            </div>
          </div>

          <div class="col-md-3">
            <label class="form-label mb-1">Status</label>
            <select v-model="active" class="form-select" @change="load">
              <option value="1">Active only</option>
              <option value="0">Inactive only</option>
              <option value="all">All</option>
            </select>
          </div>

          <div class="col-md-3 d-flex gap-2">
            <button class="btn btn-light w-100" :disabled="loading" @click="clearSearch">Clear</button>
            <button class="btn btn-primary w-100" :disabled="loading" @click="load">Refresh</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card" style="zoom: 80%;">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading customers...</div>
      </div>
    </div>

    <!-- Empty -->
    <div v-else-if="customers.length === 0" class="card" style="zoom: 80%;">
      <div class="card-body text-center text-muted py-5">
        <div class="empty-emoji">👤</div>
        <div class="mt-2">No customers found.</div>
        <button class="btn btn-primary mt-3" @click="openCreate">Create first customer</button>
      </div>
    </div>

    <!-- Cards -->
    <div v-else class="row g-3" style="zoom: 80%;">
      <div v-for="c in customers" :key="c.id" class="col-12 col-md-6 col-xl-4 d-flex">
        <div
          class="cust-card h-100 w-100"
          role="button"
          tabindex="0"
          @click="onCardClick(c)"
          @keydown="onKeyOpen($event, c)"
          :class="c.is_active ? 'is-active' : 'is-inactive'"
        >
          <div class="cust-head">
            <div class="cust-avatar" :title="c.name">
              {{ initials(c.name) }}
            </div>

            <div class="cust-title">
              <div class="cust-name-row">
                <div class="cust-name" :title="c.name">{{ c.name }}</div>

                <span v-if="c.code" class="cust-chip" @click="stop" :title="c.code">
                  {{ c.code }}
                </span>
              </div>

              <div class="cust-sub">
                <span class="cust-sub-item">
                  <i class="ri-phone-line me-1"></i> {{ safe(c.phone) }}
                </span>
                <span class="dot">•</span>
                <span class="cust-sub-item truncate" :title="c.email || ''">
                  <i class="ri-mail-line me-1"></i> {{ safe(c.email) }}
                </span>
              </div>
            </div>

            <div class="cust-status">
              <span class="status-dot" :class="c.is_active ? 'on' : 'off'"></span>
              <span class="small fw-semibold">{{ c.is_active ? "Active" : "Inactive" }}</span>
            </div>
          </div>

          <div class="cust-body">
            <div class="cust-kpi">
              <div class="kpi-box">
                <div class="kpi-label">Points</div>
                <div class="kpi-value">{{ c.loyalty_points ?? 0 }}</div>
              </div>

              <div class="kpi-box">
                <div class="kpi-label">Contact</div>
                <div class="kpi-value small truncate" :title="(c.phone || c.email || '-')">
                  {{ (c.phone || c.email) ? (c.phone || c.email) : "-" }}
                </div>
              </div>
            </div>

            <div class="cust-row">
              <span class="label">Address</span>
              <span class="value truncate" :title="c.address || ''">{{ safe(c.address) }}</span>
            </div>

            <div class="cust-row">
              <span class="label">Notes</span>
              <span class="value truncate" :title="c.notes || ''">{{ safe(c.notes) }}</span>
            </div>
          </div>

          <div class="cust-actions" @click="stop">
            <button class="btn btn-sm btn-outline-secondary" @click="printStatement(c)">
              <i class="ri-printer-line me-1"></i> Print
            </button>
            <button class="btn btn-sm btn-outline-secondary" @click="sendStatement(c)">
              <i class="ri-send-plane-line me-1"></i> Send
            </button>

            <div class="ms-auto d-flex gap-2">
              <button class="btn btn-sm btn-soft-primary" @click="openEdit(c)">
                <i class="ri-edit-line me-1"></i> Edit
              </button>
              <button class="btn btn-sm btn-soft-warning" @click="toggle(c)">
                <i class="ri-refresh-line me-1"></i> {{ c.is_active ? "Disable" : "Enable" }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div class="modal fade" id="customerModal" tabindex="-1" role="dialog" aria-hidden="true" ref="modalEl" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content position-relative">
          <div class="modal-header bg-light">
            <h4 class="modal-title">{{ isEditMode ? "Edit Customer" : "Create Customer" }}</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true" :disabled="saving"></button>
          </div>

          <!-- Saving overlay -->
          <div
            v-if="saving"
            class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style="background: rgba(250,251,254,0.72); backdrop-filter: blur(2px); z-index: 10;"
          >
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body">
            <form @submit.prevent="save" novalidate :class="{ 'was-validated': triedSubmit }">
              <div class="row g-2">
                <div class="col-md-4">
                  <label class="form-label">Code</label>
                  <input
                    v-model="form.code"
                    class="form-control"
                    placeholder="Optional (e.g. CUST001)"
                    autocomplete="off"
                  />
                </div>

                <div class="col-md-8">
                  <label class="form-label">Name *</label>
                  <input
                    v-model="form.name"
                    class="form-control"
                    placeholder="Customer name (e.g. John Banda)"
                    required
                    autocomplete="name"
                  />
                  <div class="invalid-feedback">Name is required.</div>
                </div>
              </div>

              <div class="row g-2 mt-2">
                <div class="col-md-6">
                  <label class="form-label">Phone</label>
                  <input
                    v-model="form.phone"
                    class="form-control"
                    placeholder="Optional (e.g. 0971234567)"
                    autocomplete="tel"
                  />
                </div>

                <div class="col-md-6">
                  <label class="form-label">Email</label>
                  <input
                    v-model="form.email"
                    type="email"
                    class="form-control"
                    placeholder="Optional (e.g. john@company.com)"
                    autocomplete="email"
                  />
                </div>
              </div>

              <div class="mt-2">
                <label class="form-label">Address</label>
                <textarea
                  v-model="form.address"
                  class="form-control"
                  rows="2"
                  placeholder="Optional (street, area, city...)"
                  autocomplete="street-address"
                ></textarea>
              </div>

              <div class="mt-2">
                <label class="form-label">Notes</label>
                <textarea
                  v-model="form.notes"
                  class="form-control"
                  rows="2"
                  placeholder="Optional notes (preferences, reminders, etc.)"
                ></textarea>
              </div>

              <div class="form-check form-switch mt-3">
                <input id="custActive" v-model="form.is_active" class="form-check-input" type="checkbox" />
                <label for="custActive" class="form-check-label">Active</label>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
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
.empty-emoji {
  font-size: 44px;
}

/* Card */
.cust-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
  transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
  outline: none;
}

.cust-card:hover,
.cust-card:focus {
  transform: translateY(-2px);
  box-shadow: var(--ct-box-shadow-lg);
  border-color: rgba(var(--ct-primary-rgb), 0.35);
}

.cust-card.is-inactive {
  opacity: 0.93;
}

/* Header */
.cust-head {
  padding: 14px 14px 10px;
  display: grid;
  grid-template-columns: 46px 1fr auto;
  gap: 12px;
  align-items: start;
  background: linear-gradient(
    180deg,
    rgba(var(--ct-primary-rgb), 0.12),
    rgba(var(--ct-primary-rgb), 0)
  );
}

/* Avatar */
.cust-avatar {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  letter-spacing: .6px;
  color: var(--ct-primary);
  background: rgba(var(--ct-primary-rgb), 0.15);
  border: 1px solid rgba(var(--ct-primary-rgb), 0.3);
  user-select: none;
}

/* Title */
.cust-title {
  min-width: 0;
}

.cust-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.cust-name {
  font-weight: 900;
  color: var(--ct-emphasis-color);
  line-height: 1.2;
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Chip */
.cust-chip {
  font-size: 12px;
  font-weight: 800;
  padding: 3px 10px;
  border-radius: var(--ct-border-radius-pill);
  color: var(--ct-success-text-emphasis);
  background: var(--ct-success-bg-subtle);
  border: 1px solid var(--ct-success-border-subtle);
}

/* Subtitle */
.cust-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ct-secondary-color);
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.cust-sub-item {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.dot {
  opacity: 0.6;
}

/* Status */
.cust-status {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 2px;
  color: var(--ct-body-color);
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50rem;
  border: 2px solid var(--ct-border-color);
}

.status-dot.on {
  background: var(--ct-success);
  border-color: rgba(var(--ct-success-rgb), 0.4);
}

.status-dot.off {
  background: var(--ct-gray-500);
  border-color: rgba(var(--ct-body-color-rgb), 0.3);
}

/* Body */
.cust-body {
  padding: 10px 14px 8px;
}

/* KPI */
.cust-kpi {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}

.kpi-box {
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 12px;
  padding: 10px;
  background: var(--ct-light-bg-subtle);
}

.kpi-label {
  font-size: 12px;
  color: var(--ct-secondary-color);
}

.kpi-value {
  font-size: 18px;
  font-weight: 900;
  color: var(--ct-emphasis-color);
}

/* Rows */
.cust-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px dashed var(--ct-border-color);
}

.label {
  font-size: 12px;
  color: var(--ct-secondary-color);
}

.value {
  font-size: 13px;
  color: var(--ct-emphasis-color);
  font-weight: 600;
  min-width: 0;
}

/* Utilities */
.truncate {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Actions */
.cust-actions {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--ct-tertiary-bg);
  border-top: 1px solid var(--ct-border-color-translucent);
  flex-wrap: wrap;
}

/* Responsive */
@media (max-width: 420px) {
  .cust-name {
    max-width: 180px;
  }
}
</style>