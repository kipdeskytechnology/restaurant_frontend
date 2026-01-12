<!-- src/views/setup/Discounts.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import {
  listDiscounts,
  createDiscount,
  updateDiscount,
  toggleDiscount,
} from "../../api/setupDiscounts";

const toast = useToast();

const loading = ref(true);
const saving = ref(false);

const discounts = ref([]);

// filters
const q = ref("");
const status = ref("all"); // all|1|0
const typeFilter = ref("all"); // all|PERCENT|FIXED
const scopeFilter = ref("all"); // all|ORDER|LINE

// modal
const modalEl = ref(null);
let modalInstance = null;

const editId = ref(null);
const triedSubmit = ref(false);

const form = ref({
  code: "",
  name: "",
  discount_type: "PERCENT",
  scope: "ORDER",
  percent_value: "",
  fixed_value: "",
  min_order_total: "",
  starts_at: "",
  ends_at: "",
  is_active: true,
});

const isEditMode = computed(() => !!editId.value);
const isPercent = computed(() => form.value.discount_type === "PERCENT");
const isFixed = computed(() => form.value.discount_type === "FIXED");

function resetForm() {
  editId.value = null;
  triedSubmit.value = false;
  form.value = {
    code: "",
    name: "",
    discount_type: "PERCENT",
    scope: "ORDER",
    percent_value: "",
    fixed_value: "",
    min_order_total: "",
    starts_at: "",
    ends_at: "",
    is_active: true,
  };
}

function toLocalInput(iso) {
  const dt = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(
    dt.getDate()
  )}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function fromLocalInput(v) {
  if (!v) return null;
  return new Date(v).toISOString();
}

function setFormFromDiscount(d) {
  editId.value = d.id;
  triedSubmit.value = false;

  form.value = {
    code: d.code || "",
    name: d.name || "",
    discount_type: d.discount_type || "PERCENT",
    scope: d.scope || "ORDER",
    percent_value: d.percent_value ?? "",
    fixed_value: d.fixed_value ?? "",
    min_order_total: d.min_order_total ?? "",
    starts_at: d.starts_at ? toLocalInput(d.starts_at) : "",
    ends_at: d.ends_at ? toLocalInput(d.ends_at) : "",
    is_active: !!d.is_active,
  };
}

async function ensureModal() {
  if (modalInstance) return;
  try {
    const m = await import("bootstrap/js/dist/modal");
    modalInstance = new m.default(modalEl.value, {
      backdrop: "static",
      keyboard: false,
    });
  } catch (e) {
    modalInstance = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(modalEl.value, {
          backdrop: "static",
          keyboard: false,
        })
      : null;
  }
}

async function openCreate() {
  resetForm();
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

async function openEdit(d) {
  setFormFromDiscount(d);
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

function closeModal() {
  modalInstance?.hide();
}

async function load() {
  loading.value = true;
  try {
    discounts.value = await listDiscounts();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load discounts");
  } finally {
    loading.value = false;
  }
}

function normalizePayload() {
  const p = { ...form.value };
  p.code = (p.code || "").trim().toUpperCase();
  p.name = (p.name || "").trim();
  p.discount_type = (p.discount_type || "").toUpperCase();
  p.scope = (p.scope || "").toUpperCase();

  p.min_order_total = p.min_order_total === "" ? null : Number(p.min_order_total);

  if (p.discount_type === "PERCENT") {
    p.percent_value = p.percent_value === "" ? null : Number(p.percent_value);
    p.fixed_value = null;
  } else {
    p.fixed_value = p.fixed_value === "" ? null : Number(p.fixed_value);
    p.percent_value = null;
  }

  p.starts_at = fromLocalInput(p.starts_at);
  p.ends_at = fromLocalInput(p.ends_at);

  return p;
}

function validate(payload) {
  triedSubmit.value = true;

  if (!payload.code || !payload.name) {
    toast.error("Code and name are required.");
    return false;
  }

  if (payload.discount_type === "PERCENT") {
    if (payload.percent_value == null) {
      toast.error("Percent value is required.");
      return false;
    }
    if (payload.percent_value <= 0 || payload.percent_value > 100) {
      toast.error("Percent must be > 0 and <= 100.");
      return false;
    }
  } else {
    if (payload.fixed_value == null) {
      toast.error("Fixed value is required.");
      return false;
    }
    if (payload.fixed_value <= 0) {
      toast.error("Fixed value must be > 0.");
      return false;
    }
  }

  if (
    payload.starts_at &&
    payload.ends_at &&
    new Date(payload.ends_at) < new Date(payload.starts_at)
  ) {
    toast.error("End date cannot be before start date.");
    return false;
  }

  return true;
}

async function save() {
  const payload = normalizePayload();
  if (!validate(payload)) return;

  saving.value = true;
  try {
    if (editId.value) {
      await updateDiscount(editId.value, payload);
      toast.success("Discount updated.");
    } else {
      await createDiscount(payload);
      toast.success("Discount created.");
    }

    closeModal();
    resetForm();
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save discount");
  } finally {
    saving.value = false;
  }
}

async function toggle(d) {
  try {
    await toggleDiscount(d.id);
    toast.success("Updated");
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed");
  }
}

// dummy actions
function printPolicy(d) {
  toast.info(`Print discount policy (dummy): ${d.code}`);
}
function shareDiscount(d) {
  toast.info(`Send discount statement (dummy): ${d.code}`);
}

function formatValue(d) {
  if (d.discount_type === "PERCENT") return `${d.percent_value ?? 0}%`;
  return `${d.fixed_value ?? 0}`;
}

function formatWindow(d) {
  const s = d.starts_at ? new Date(d.starts_at).toLocaleString() : null;
  const e = d.ends_at ? new Date(d.ends_at).toLocaleString() : null;
  if (!s && !e) return "No schedule";
  if (s && !e) return `Starts: ${s}`;
  if (!s && e) return `Ends: ${e}`;
  return `${s} → ${e}`;
}

const filteredDiscounts = computed(() => {
  const qq = q.value.trim().toLowerCase();
  const st = status.value;
  const tf = typeFilter.value;
  const sf = scopeFilter.value;

  return (discounts.value || []).filter((d) => {
    const hay = `${d.code || ""} ${d.name || ""} ${d.discount_type || ""} ${
      d.scope || ""
    }`
      .trim()
      .toLowerCase();

    const okQ = !qq || hay.includes(qq);
    const okStatus = st === "all" ? true : st === "1" ? !!d.is_active : !d.is_active;
    const okType = tf === "all" ? true : (d.discount_type || "") === tf;
    const okScope = sf === "all" ? true : (d.scope || "") === sf;

    return okQ && okStatus && okType && okScope;
  });
});

function clearFilters() {
  q.value = "";
  status.value = "all";
  typeFilter.value = "all";
  scopeFilter.value = "all";
}

function stop(e) {
  e?.stopPropagation?.();
}

function onKeyOpen(e, d) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openEdit(d);
  }
}

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Discounts</h4>
        <div class="text-muted small">Manage order and line discounts</div>
      </div>

      <button class="btn btn-primary" @click="openCreate">
        <i class="ri-price-tag-3-line me-1"></i> New Discount
      </button>
    </div>

    <!-- Filters -->
    <div class="card mb-3" style="zoom: 80%;">
      <div class="card-body py-2">
        <div class="row g-2 align-items-end">
          <div class="col-md-5">
            <label class="form-label mb-1">Search</label>
            <div class="input-group">
              <!-- ✅ bg-light (theme-friendly with ct vars) -->
              <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
              <input
                v-model="q"
                class="form-control"
                placeholder="Search by code or name (e.g. DISC10, Happy Hour)"
              />
            </div>
          </div>

          <div class="col-md-2">
            <label class="form-label mb-1">Status</label>
            <select v-model="status" class="form-select">
              <option value="all">All</option>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>

          <div class="col-md-2">
            <label class="form-label mb-1">Type</label>
            <select v-model="typeFilter" class="form-select">
              <option value="all">All</option>
              <option value="PERCENT">Percent</option>
              <option value="FIXED">Fixed</option>
            </select>
          </div>

          <div class="col-md-2">
            <label class="form-label mb-1">Scope</label>
            <select v-model="scopeFilter" class="form-select">
              <option value="all">All</option>
              <option value="ORDER">Order</option>
              <option value="LINE">Line</option>
            </select>
          </div>

          <div class="col-md-1 d-flex">
            <button class="btn btn-light w-100" @click="clearFilters">Clear</button>
          </div>

          <div class="col-12">
            <div class="text-muted small">
              Showing <strong>{{ filteredDiscounts.length }}</strong> of <strong>{{ discounts.length }}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card" style="zoom: 80%;">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading discounts...</div>
      </div>
    </div>

    <!-- Empty -->
    <div v-else-if="filteredDiscounts.length === 0" class="card" style="zoom: 80%;">
      <div class="card-body text-center text-muted py-5">
        <div class="empty-emoji">🏷️</div>
        <div class="mt-2">No discounts match your filters.</div>
        <button class="btn btn-primary mt-3" @click="openCreate">Create a discount</button>
      </div>
    </div>

    <!-- Cards -->
    <div v-else class="row g-3" style="zoom: 80%;">
      <div v-for="d in filteredDiscounts" :key="d.id" class="col-12 col-md-6 col-xl-4 d-flex">
        <div
          class="disc-card h-100 w-100"
          role="button"
          tabindex="0"
          @click="openEdit(d)"
          @keydown="onKeyOpen($event, d)"
        >
          <div class="disc-head">
            <div class="disc-left">
              <div class="disc-code">{{ d.code }}</div>
              <div class="disc-name" :title="d.name">{{ d.name }}</div>
            </div>

            <div class="disc-right text-end">
              <div class="disc-value">{{ formatValue(d) }}</div>
              <div class="disc-meta">
                <span class="pill">{{ d.discount_type === "PERCENT" ? "Percent" : "Fixed" }}</span>
                <span class="pill">{{ d.scope === "ORDER" ? "Order" : "Line" }}</span>
              </div>
            </div>
          </div>

          <div class="disc-body">
            <div class="disc-row">
              <span class="label">Min order</span>
              <span class="value">{{ d.min_order_total != null ? d.min_order_total : "None" }}</span>
            </div>

            <div class="disc-row">
              <span class="label">Schedule</span>
              <span class="value truncate" :title="formatWindow(d)">{{ formatWindow(d) }}</span>
            </div>

            <div class="disc-row">
              <span class="label">Status</span>
              <span class="value">
                <span class="status-dot" :class="d.is_active ? 'on' : 'off'"></span>
                {{ d.is_active ? "Active" : "Inactive" }}
              </span>
            </div>
          </div>

          <div class="disc-actions" @click="stop">
            <div class="ms-auto d-flex gap-2">
              <button class="btn btn-sm btn-soft-primary" @click="openEdit(d)">
                <i class="ri-edit-line me-1"></i> Edit
              </button>
              <button class="btn btn-sm btn-soft-warning" @click="toggle(d)">
                <i class="ri-refresh-line me-1"></i> {{ d.is_active ? "Disable" : "Enable" }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div class="modal fade" id="discountModal" tabindex="-1" role="dialog" aria-hidden="true" ref="modalEl" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content position-relative">
          <div class="modal-header bg-light">
            <h4 class="modal-title">{{ isEditMode ? "Edit Discount" : "Create Discount" }}</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true" :disabled="saving"></button>
          </div>

          <!-- ✅ theme-safe saving overlay -->
          <div v-if="saving" class="disc-saving">
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body">
            <form @submit.prevent="save" novalidate :class="{ 'was-validated': triedSubmit }">
              <div class="row g-2">
                <div class="col-md-4">
                  <label class="form-label">Code *</label>
                  <input v-model="form.code" class="form-control" placeholder="DISC10" required autocomplete="off" />
                  <div class="invalid-feedback">Code is required.</div>
                </div>

                <div class="col-md-8">
                  <label class="form-label">Name *</label>
                  <input v-model="form.name" class="form-control" placeholder="10% Off / Happy Hour Discount" required autocomplete="off" />
                  <div class="invalid-feedback">Name is required.</div>
                </div>
              </div>

              <div class="row g-2 mt-2">
                <div class="col-md-6">
                  <label class="form-label">Type</label>
                  <select v-model="form.discount_type" class="form-select">
                    <option value="PERCENT">Percent</option>
                    <option value="FIXED">Fixed</option>
                  </select>
                </div>

                <div class="col-md-6">
                  <label class="form-label">Scope</label>
                  <select v-model="form.scope" class="form-select">
                    <option value="ORDER">Order</option>
                    <option value="LINE">Line</option>
                  </select>
                </div>
              </div>

              <div class="row g-2 mt-2">
                <div class="col-md-6" v-if="isPercent">
                  <label class="form-label">Percent (%) *</label>
                  <input v-model="form.percent_value" type="number" step="0.0001" class="form-control" placeholder="e.g. 10" required />
                  <div class="form-text">0 &lt; value ≤ 100</div>
                </div>

                <div class="col-md-6" v-if="isFixed">
                  <label class="form-label">Fixed Amount *</label>
                  <input v-model="form.fixed_value" type="number" step="0.01" class="form-control" placeholder="e.g. 25" required />
                  <div class="form-text">Must be greater than 0</div>
                </div>

                <div class="col-md-6">
                  <label class="form-label">Min Order Total (optional)</label>
                  <input v-model="form.min_order_total" type="number" step="0.01" class="form-control" placeholder="Leave blank for none" />
                </div>
              </div>

              <div class="row g-2 mt-2">
                <div class="col-md-6">
                  <label class="form-label">Starts At (optional)</label>
                  <input v-model="form.starts_at" type="datetime-local" class="form-control" />
                </div>

                <div class="col-md-6">
                  <label class="form-label">Ends At (optional)</label>
                  <input v-model="form.ends_at" type="datetime-local" class="form-control" />
                </div>
              </div>

              <div class="form-check form-switch mt-3">
                <input id="discActive" v-model="form.is_active" class="form-check-input" type="checkbox" />
                <label for="discActive" class="form-check-label">Active</label>
              </div>

              <div class="alert alert-light border mt-3 mb-0">
                <div class="d-flex align-items-start gap-2">
                  <i class="ri-information-line mt-1"></i>
                  <div class="small">
                    <div class="fw-semibold">Tips</div>
                    <div class="text-muted">
                      Use <b>Order</b> for bill-wide discounts and <b>Line</b> for per-item discounts.
                      Add a schedule to auto-start/stop the discount.
                    </div>
                  </div>
                </div>
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
/* Match Customers theme tokens */
.empty-emoji { font-size: 44px; }

/* Card */
.disc-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
  transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
  outline: none;
}
.disc-card:hover,
.disc-card:focus {
  transform: translateY(-2px);
  box-shadow: var(--ct-box-shadow-lg);
  border-color: rgba(var(--ct-primary-rgb), 0.35);
}

/* Header */
.disc-head {
  padding: 14px 14px 10px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  background: linear-gradient(
    180deg,
    rgba(var(--ct-primary-rgb), 0.12),
    rgba(var(--ct-primary-rgb), 0)
  );
}

/* Code */
.disc-code {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: var(--ct-border-radius-pill);
  font-weight: 800;
  letter-spacing: .4px;
  font-size: 12px;
  color: var(--ct-primary);
  background: rgba(var(--ct-primary-rgb), 0.15);
  border: 1px solid rgba(var(--ct-primary-rgb), 0.30);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Name */
.disc-name {
  margin-top: 8px;
  font-weight: 800;
  color: var(--ct-emphasis-color);
  line-height: 1.2;
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Value */
.disc-value {
  font-size: 26px;
  font-weight: 900;
  letter-spacing: .2px;
  color: var(--ct-emphasis-color);
}

.disc-meta {
  margin-top: 6px;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}

/* Pills */
.pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--ct-border-radius-pill);
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-light-bg-subtle);
  color: var(--ct-secondary-color);
}

/* Body */
.disc-body {
  padding: 10px 14px 6px;
}

.disc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px dashed var(--ct-border-color);
}
.disc-row:first-child { border-top: none; }

.label { font-size: 12px; color: var(--ct-secondary-color); }
.value { font-size: 13px; color: var(--ct-emphasis-color); font-weight: 600; min-width: 0; }
.truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 240px; }

/* Status dot */
.status-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50rem;
  margin-right: 8px;
  border: 2px solid var(--ct-border-color);
  vertical-align: middle;
}
.status-dot.on { background: var(--ct-success); border-color: rgba(var(--ct-success-rgb), 0.4); }
.status-dot.off { background: var(--ct-gray-500); border-color: rgba(var(--ct-body-color-rgb), 0.3); }

/* Actions */
.disc-actions {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--ct-tertiary-bg);
  border-top: 1px solid var(--ct-border-color-translucent);
  flex-wrap: wrap;
}

/* Theme-safe modal saving overlay */
.disc-saving {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--ct-body-bg-rgb), 0.72);
  backdrop-filter: blur(2px);
}

@media (max-width: 420px) {
  .disc-name { max-width: 180px; }
  .truncate { max-width: 170px; }
}
</style>
