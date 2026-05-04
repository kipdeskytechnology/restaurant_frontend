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
  deleteDiscount,
} from "../../api/setupDiscounts";

const toast = useToast();

const loading = ref(true);
const refreshing = ref(false);
const saving = ref(false);

const discounts = ref([]);

const q = ref("");
const status = ref("all");
const typeFilter = ref("all");
const scopeFilter = ref("all");

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
    code: "", name: "",
    discount_type: "PERCENT", scope: "ORDER",
    percent_value: "", fixed_value: "",
    min_order_total: "",
    starts_at: "", ends_at: "",
    is_active: true,
  };
}

function toLocalInput(iso) {
  const dt = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}
function fromLocalInput(v) {
  if (!v) return null;
  return new Date(v).toISOString();
}

function setFormFromDiscount(d) {
  editId.value = d.id;
  triedSubmit.value = false;
  form.value = {
    code: d.code || "", name: d.name || "",
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
    modalInstance = new m.default(modalEl.value, { backdrop: "static", keyboard: false });
  } catch {
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

async function openEdit(d) {
  setFormFromDiscount(d);
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

function closeModal() { modalInstance?.hide(); }

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    discounts.value = await listDiscounts();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load discounts");
  } finally {
    loading.value = false;
    refreshing.value = false;
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
  if (!payload.code || !payload.name) { toast.error("Code and name are required."); return false; }
  if (payload.discount_type === "PERCENT") {
    if (payload.percent_value == null) { toast.error("Percent value is required."); return false; }
    if (payload.percent_value <= 0 || payload.percent_value > 100) {
      toast.error("Percent must be > 0 and <= 100."); return false;
    }
  } else {
    if (payload.fixed_value == null) { toast.error("Fixed value is required."); return false; }
    if (payload.fixed_value <= 0) { toast.error("Fixed value must be > 0."); return false; }
  }
  if (payload.starts_at && payload.ends_at && new Date(payload.ends_at) < new Date(payload.starts_at)) {
    toast.error("End date cannot be before start date."); return false;
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
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save discount");
  } finally {
    saving.value = false;
  }
}

async function toggle(d) {
  try {
    await toggleDiscount(d.id);
    toast.success(d.is_active ? "Discount disabled" : "Discount enabled");
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed");
  }
}

async function removeDiscount(d) {
  if (!confirm(`Delete discount "${d.code}"? This cannot be undone.`)) return;
  try {
    await deleteDiscount(d.id);
    toast.success("Discount deleted");
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete discount");
  }
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

function isCurrent(d) {
  const now = Date.now();
  if (d.starts_at && new Date(d.starts_at).getTime() > now) return false;
  if (d.ends_at && new Date(d.ends_at).getTime() < now) return false;
  return true;
}

function scheduleStatus(d) {
  if (!d.starts_at && !d.ends_at) return "always";
  if (!isCurrent(d)) {
    if (d.ends_at && new Date(d.ends_at).getTime() < Date.now()) return "expired";
    return "upcoming";
  }
  return "live";
}

const filteredDiscounts = computed(() => {
  const qq = q.value.trim().toLowerCase();
  return (discounts.value || []).filter((d) => {
    const hay = `${d.code || ""} ${d.name || ""} ${d.discount_type || ""} ${d.scope || ""}`.trim().toLowerCase();
    const okQ = !qq || hay.includes(qq);
    const okStatus = status.value === "all" ? true : status.value === "1" ? !!d.is_active : !d.is_active;
    const okType = typeFilter.value === "all" ? true : (d.discount_type || "") === typeFilter.value;
    const okScope = scopeFilter.value === "all" ? true : (d.scope || "") === scopeFilter.value;
    return okQ && okStatus && okType && okScope;
  });
});

const summary = computed(() => {
  const total = discounts.value.length;
  const active = discounts.value.filter((d) => d.is_active).length;
  const live = discounts.value.filter((d) => d.is_active && isCurrent(d)).length;
  const percent = discounts.value.filter((d) => d.discount_type === "PERCENT").length;
  return { total, active, live, percent };
});

function clearFilters() {
  q.value = "";
  status.value = "all";
  typeFilter.value = "all";
  scopeFilter.value = "all";
}

function stop(e) { e?.stopPropagation?.(); }
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
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-price-tag-3-line"></i><span>Setup</span>
          </div>
          <h1 class="hero-title">Discounts</h1>
          <p class="hero-sub">
            Bill-wide and per-line promos. Schedule them for happy hour, bind to a minimum spend, or just toggle on for instant savings.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button v-can="'discounts:manage'" class="btn btn-pill btn-cta" @click="openCreate">
            <i class="ri-add-line"></i><span>New Discount</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon tone-primary"><i class="ri-price-tag-3-line"></i></div>
          <div>
            <div class="stat-label">Discounts</div>
            <div class="stat-value">{{ summary.total }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-success"><i class="ri-check-line"></i></div>
          <div>
            <div class="stat-label">Active</div>
            <div class="stat-value text-success">{{ summary.active }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-warning"><i class="ri-flashlight-line"></i></div>
          <div>
            <div class="stat-label">Live now</div>
            <div class="stat-value">{{ summary.live }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-info"><i class="ri-percent-line"></i></div>
          <div>
            <div class="stat-label">Percent type</div>
            <div class="stat-value">{{ summary.percent }}</div>
          </div>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-md-4">
              <label class="form-label">Search</label>
              <div class="position-relative">
                <i class="ri-search-line search-ico"></i>
                <input v-model="q" class="form-control ps-5" placeholder="Code, name, type, scope…" />
              </div>
            </div>

            <div class="col-md-2">
              <label class="form-label">Status</label>
              <select v-model="status" class="form-select">
                <option value="all">All</option>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>

            <div class="col-md-2">
              <label class="form-label">Type</label>
              <select v-model="typeFilter" class="form-select">
                <option value="all">All</option>
                <option value="PERCENT">Percent</option>
                <option value="FIXED">Fixed</option>
              </select>
            </div>

            <div class="col-md-2">
              <label class="form-label">Scope</label>
              <select v-model="scopeFilter" class="form-select">
                <option value="all">All</option>
                <option value="ORDER">Order</option>
                <option value="LINE">Line</option>
              </select>
            </div>

            <div class="col-md-2 d-grid">
              <button class="btn btn-light" @click="clearFilters">
                <i class="ri-filter-off-line me-1"></i>Clear
              </button>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-3 small text-muted mt-2">
            <span>Showing <strong>{{ filteredDiscounts.length }}</strong> of <strong>{{ discounts.length }}</strong></span>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading discounts…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="filteredDiscounts.length === 0" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-price-tag-3-line"></i></div>
        <h5 class="mt-2 mb-1">{{ discounts.length === 0 ? 'No discounts yet' : 'No matches' }}</h5>
        <p class="text-muted mb-3">
          {{ discounts.length === 0 ? 'Create your first promo — happy hour, % off, or a flat amount.' : 'Try clearing filters or widening your search.' }}
        </p>
        <div>
          <button v-can="'discounts:manage'" class="btn btn-primary" @click="openCreate">
            <i class="ri-add-line me-1"></i> New discount
          </button>
        </div>
      </div>

      <!-- ============== Discount cards ============== -->
      <div v-else class="disc-grid-wrap">
        <div class="disc-grid">
          <div
            v-for="d in filteredDiscounts"
            :key="d.id"
            class="disc-card"
            :class="[{ 'is-inactive': !d.is_active }, `tone-${scheduleStatus(d)}`]"
            role="button"
            tabindex="0"
            @click="openEdit(d)"
            @keydown="onKeyOpen($event, d)"
          >
            <div class="disc-head">
              <div>
                <div class="disc-code">{{ d.code }}</div>
                <div class="disc-name" :title="d.name">{{ d.name }}</div>
              </div>
              <div class="disc-value">
                <span v-if="d.discount_type === 'PERCENT'" class="dv-num">{{ d.percent_value ?? 0 }}<span class="dv-unit">%</span></span>
                <span v-else class="dv-num">K {{ d.fixed_value ?? 0 }}</span>
              </div>
            </div>

            <div class="disc-meta-row">
              <span class="meta-pill" :class="d.discount_type === 'PERCENT' ? 'pill-info' : 'pill-warn'">
                <i :class="d.discount_type === 'PERCENT' ? 'ri-percent-line' : 'ri-money-dollar-circle-line'"></i>
                {{ d.discount_type === 'PERCENT' ? 'Percent' : 'Fixed' }}
              </span>
              <span class="meta-pill pill-soft">
                <i :class="d.scope === 'ORDER' ? 'ri-bill-line' : 'ri-list-check-2'"></i>
                {{ d.scope === 'ORDER' ? 'Whole order' : 'Per line' }}
              </span>
              <span
                class="meta-pill"
                :class="{
                  'pill-success': scheduleStatus(d) === 'live',
                  'pill-warn': scheduleStatus(d) === 'upcoming',
                  'pill-default': scheduleStatus(d) === 'expired',
                  'pill-soft': scheduleStatus(d) === 'always',
                }"
                :title="formatWindow(d)"
              >
                <i class="ri-time-line"></i>
                {{ scheduleStatus(d) === 'live' ? 'Live'
                  : scheduleStatus(d) === 'upcoming' ? 'Upcoming'
                  : scheduleStatus(d) === 'expired' ? 'Expired'
                  : 'Always on' }}
              </span>
            </div>

            <div class="disc-rows">
              <div class="kv-row">
                <div class="kv-label"><i class="ri-money-dollar-circle-line me-1"></i>Min order</div>
                <div class="kv-val">{{ d.min_order_total != null ? `K ${d.min_order_total}` : '—' }}</div>
              </div>
              <div class="kv-row">
                <div class="kv-label"><i class="ri-calendar-line me-1"></i>Schedule</div>
                <div class="kv-val truncate" :title="formatWindow(d)">{{ formatWindow(d) }}</div>
              </div>
              <div class="kv-row">
                <div class="kv-label"><i class="ri-toggle-line me-1"></i>Status</div>
                <div class="kv-val">
                  <span class="status-pill" :class="d.is_active ? 'pill-on' : 'pill-off'">
                    <span class="dot-mini"></span>{{ d.is_active ? 'Active' : 'Inactive' }}
                  </span>
                </div>
              </div>
            </div>

            <div class="disc-actions" @click="stop">
              <button v-can="'discounts:manage'" class="row-icon-btn" title="Edit" @click="openEdit(d)">
                <i class="ri-pencil-line"></i><span>Edit</span>
              </button>
              <button
                v-can="'discounts:manage'"
                class="row-icon-btn"
                :class="d.is_active ? 'warn' : 'success'"
                :title="d.is_active ? 'Disable' : 'Enable'"
                @click="toggle(d)"
              >
                <i :class="d.is_active ? 'ri-pause-line' : 'ri-play-line'"></i>
                <span>{{ d.is_active ? 'Disable' : 'Enable' }}</span>
              </button>
              <button
                v-can="'discounts:manage'"
                class="row-icon-btn danger"
                title="Delete"
                @click="removeDiscount(d)"
              >
                <i class="ri-delete-bin-line"></i><span>Delete</span>
              </button>
            </div>
          </div>

          <button v-can="'discounts:manage'" class="disc-card disc-add" @click="openCreate">
            <div class="add-icon"><i class="ri-add-line"></i></div>
            <div class="add-label">New discount</div>
            <div class="add-sub">Percent or fixed amount</div>
          </button>
        </div>
      </div>
    </div>

    <!-- ============== Modal ============== -->
    <div class="modal fade" id="discountModal" tabindex="-1" aria-hidden="true" ref="modalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditMode ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isEditMode ? "Edit discount" : "New discount" }}</h5>
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
                  <label class="form-label">Code *</label>
                  <input v-model="form.code" class="form-control" placeholder="DISC10" required autocomplete="off" />
                </div>
                <div class="col-md-8">
                  <label class="form-label">Name *</label>
                  <input v-model="form.name" class="form-control" placeholder="10% Off / Happy Hour" required autocomplete="off" />
                </div>

                <div class="col-md-6">
                  <label class="form-label">Type</label>
                  <div class="seg-toggle">
                    <button
                      type="button"
                      class="seg-btn"
                      :class="{ active: isPercent }"
                      @click="form.discount_type = 'PERCENT'"
                    >
                      <i class="ri-percent-line me-1"></i>Percent
                    </button>
                    <button
                      type="button"
                      class="seg-btn"
                      :class="{ active: isFixed }"
                      @click="form.discount_type = 'FIXED'"
                    >
                      <i class="ri-money-dollar-circle-line me-1"></i>Fixed
                    </button>
                  </div>
                </div>

                <div class="col-md-6">
                  <label class="form-label">Scope</label>
                  <div class="seg-toggle">
                    <button
                      type="button"
                      class="seg-btn"
                      :class="{ active: form.scope === 'ORDER' }"
                      @click="form.scope = 'ORDER'"
                    >
                      <i class="ri-bill-line me-1"></i>Whole order
                    </button>
                    <button
                      type="button"
                      class="seg-btn"
                      :class="{ active: form.scope === 'LINE' }"
                      @click="form.scope = 'LINE'"
                    >
                      <i class="ri-list-check-2 me-1"></i>Per line
                    </button>
                  </div>
                </div>

                <div class="col-md-6" v-if="isPercent">
                  <label class="form-label">Percent (%) *</label>
                  <div class="input-group">
                    <input v-model="form.percent_value" type="number" step="0.0001" class="form-control" placeholder="e.g. 10" required />
                    <span class="input-group-text">%</span>
                  </div>
                  <div class="form-text">0 &lt; value ≤ 100</div>
                </div>

                <div class="col-md-6" v-if="isFixed">
                  <label class="form-label">Fixed amount *</label>
                  <div class="input-group">
                    <span class="input-group-text">K</span>
                    <input v-model="form.fixed_value" type="number" step="0.01" class="form-control" placeholder="e.g. 25" required />
                  </div>
                  <div class="form-text">Must be greater than 0</div>
                </div>

                <div class="col-md-6">
                  <label class="form-label">Min order total <span class="text-muted small">(optional)</span></label>
                  <div class="input-group">
                    <span class="input-group-text">K</span>
                    <input v-model="form.min_order_total" type="number" step="0.01" class="form-control" placeholder="Leave blank for none" />
                  </div>
                </div>

                <div class="col-md-6">
                  <label class="form-label">Starts at <span class="text-muted small">(optional)</span></label>
                  <input v-model="form.starts_at" type="datetime-local" class="form-control" />
                </div>

                <div class="col-md-6">
                  <label class="form-label">Ends at <span class="text-muted small">(optional)</span></label>
                  <input v-model="form.ends_at" type="datetime-local" class="form-control" />
                </div>

                <div class="col-12">
                  <div class="toggle-card">
                    <div>
                      <div class="fw-semibold">Active</div>
                      <div class="small text-muted">Inactive discounts are hidden from POS even if scheduled.</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input id="discActive" v-model="form.is_active" class="form-check-input" type="checkbox" />
                    </div>
                  </div>
                </div>

                <div class="col-12">
                  <div class="tip-card">
                    <i class="ri-lightbulb-flash-line tip-icon"></i>
                    <div class="small">
                      <div class="fw-semibold mb-1">Pro tip</div>
                      <div class="text-muted">
                        Use <strong>Order</strong> for bill-wide promos and <strong>Line</strong> for per-item discounts. Add a schedule to auto-start/stop.
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
              {{ isEditMode ? "Update discount" : "Create discount" }}
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

/* ============= Hero ============= */
.page-hero {
  position: relative;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem;
  padding: 1.5rem 1.75rem; margin-bottom: 1.25rem;
  border-radius: 22px;
  background: linear-gradient(135deg, #0f172a 0%, #6366f1 55%, #8b5cf6 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(99,102,241,0.55);
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
.btn-cta { background: #fff !important; color: #4f46e5 !important; font-weight: 700; border: none; box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3); }

/* ============= Stat strip ============= */
.stat-strip {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.75rem;
}
.stat-tile {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.85rem 1rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px; box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.stat-icon { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; font-size: 1.05rem; }
.stat-icon.tone-primary { background: rgba(99,102,241,0.12); color: #4f46e5; }
.stat-icon.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.stat-icon.tone-warning { background: rgba(245,158,11,0.18); color: #b45309; }
.stat-icon.tone-info { background: rgba(6,182,212,0.14); color: #0e7490; }
.stat-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ct-secondary-color, #64748b); }
.stat-value { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.05rem; color: var(--ct-body-color, #0f172a); }

/* ============= Toolbar / Empty ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(99,102,241,0.04) 0%, transparent 100%); }
.search-ico { position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%); color: var(--ct-secondary-color, #94a3b8); pointer-events: none; }
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); font-size: 1.6rem;
}

/* ============= Discount cards ============= */
.disc-grid-wrap {
  max-height: calc(100vh - 480px);
  min-height: 240px;
  overflow-y: auto;
  padding: 0.25rem 0.5rem 0.5rem 0;
  scrollbar-width: thin;
}
.disc-grid-wrap::-webkit-scrollbar { width: 8px; }
.disc-grid-wrap::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.disc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 0.9rem;
}

.disc-card {
  position: relative;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 16px;
  display: flex; flex-direction: column;
  overflow: hidden;
  cursor: pointer; outline: none;
  transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
}
.disc-card::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0;
  height: 4px;
  background: var(--ct-primary, #6366f1);
}
.disc-card.tone-live::before { background: linear-gradient(90deg, #10b981, #06b6d4); }
.disc-card.tone-upcoming::before { background: linear-gradient(90deg, #f59e0b, #ec4899); }
.disc-card.tone-expired::before { background: #94a3b8; }
.disc-card:hover, .disc-card:focus {
  border-color: rgba(99,102,241,0.45);
  transform: translateY(-2px);
  box-shadow: 0 12px 24px -14px rgba(15,23,42,0.22);
}
.disc-card.is-inactive { opacity: 0.78; }
.disc-card.is-inactive::before { background: #94a3b8; }

.disc-head {
  padding: 1rem 1rem 0.5rem;
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 0.75rem;
}
.disc-code {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.75rem; font-weight: 700;
  padding: 0.2rem 0.5rem; border-radius: 6px;
  background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1);
  border: 1px solid rgba(99,102,241,0.2);
  display: inline-block;
}
.disc-name {
  margin-top: 0.5rem;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 1.02rem;
  color: var(--ct-body-color, #0f172a);
  line-height: 1.25;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 220px;
  letter-spacing: -0.01em;
}
.disc-value { text-align: right; }
.dv-num {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 1.65rem;
  letter-spacing: -0.02em;
  color: var(--ct-primary, #6366f1);
  line-height: 1;
}
.dv-unit { font-size: 1rem; margin-left: 0.05rem; }

.disc-meta-row {
  display: flex; flex-wrap: wrap; gap: 0.35rem;
  padding: 0 1rem 0.5rem;
}
.meta-pill {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.68rem; font-weight: 700;
  letter-spacing: 0.04em;
}
.meta-pill i { font-size: 0.85rem; }
.pill-info { background: rgba(6,182,212,0.14); color: #0e7490; }
.pill-warn { background: rgba(245,158,11,0.18); color: #b45309; }
.pill-success { background: rgba(16,185,129,0.14); color: #047857; }
.pill-default { background: rgba(100,116,139,0.14); color: #475569; }
.pill-soft { background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); }

.disc-rows { padding: 0 1rem 0.65rem; }
.kv-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.75rem; padding: 0.4rem 0;
  border-top: 1px dashed var(--ct-border-color, #e6e9ef);
}
.kv-row:first-child { border-top: none; }
.kv-label { font-size: 0.72rem; color: var(--ct-secondary-color, #64748b); font-weight: 600; }
.kv-val {
  font-size: 0.78rem;
  color: var(--ct-body-color, #0f172a);
  font-weight: 600;
  min-width: 0;
  text-align: right;
}
.truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 180px; }

.status-pill {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.15rem 0.5rem; border-radius: 999px;
  font-size: 0.68rem; font-weight: 700;
}
.dot-mini { width: 6px; height: 6px; border-radius: 50%; }
.pill-on { background: rgba(16,185,129,0.14); color: #047857; }
.pill-on .dot-mini { background: #10b981; }
.pill-off { background: rgba(100,116,139,0.14); color: #64748b; }
.pill-off .dot-mini { background: #94a3b8; }

.disc-actions {
  margin-top: auto;
  padding: 0.6rem 1rem;
  display: flex; align-items: center; gap: 0.4rem;
  border-top: 1px dashed var(--ct-border-color, #e6e9ef);
  background: linear-gradient(180deg, transparent, rgba(99,102,241,0.02));
}
.row-icon-btn {
  flex: 1;
  display: inline-flex; align-items: center; justify-content: center; gap: 0.3rem;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.78rem; font-weight: 600;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
}
.row-icon-btn:hover { background: rgba(99,102,241,0.08); color: var(--ct-primary, #6366f1); }
.row-icon-btn.warn:hover { background: rgba(245,158,11,0.12); color: #b45309; }
.row-icon-btn.danger:hover { background: rgba(239,68,68,0.1); color: #ef4444; }
.row-icon-btn.success:hover { background: rgba(16,185,129,0.12); color: #047857; }

.disc-add {
  background: transparent;
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  align-items: center; justify-content: center;
  text-align: center;
  color: var(--ct-secondary-color, #64748b);
  padding: 1.5rem 1rem;
  min-height: 240px;
}
.disc-add::before { display: none; }
.disc-add:hover {
  border-color: var(--ct-primary, #6366f1);
  color: var(--ct-primary, #6366f1);
  background: rgba(99,102,241,0.04);
  transform: translateY(-2px);
}
.add-icon {
  width: 44px; height: 44px;
  border-radius: 12px; display: grid; place-items: center;
  font-size: 1.4rem;
  background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1);
  margin: 0 auto 0.25rem;
}
.add-label { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 700; font-size: 0.95rem; color: var(--ct-body-color, #0f172a); }
.add-sub { font-size: 0.75rem; }

/* Segmented toggle */
.seg-toggle {
  display: grid; grid-template-columns: 1fr 1fr;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
  padding: 3px;
  gap: 3px;
}
.seg-btn {
  border: none; background: transparent;
  padding: 0.45rem 0.7rem;
  border-radius: 8px;
  font-size: 0.82rem; font-weight: 600;
  color: var(--ct-secondary-color, #64748b);
  cursor: pointer;
  transition: all 0.15s ease;
}
.seg-btn:hover { color: var(--ct-primary, #6366f1); }
.seg-btn.active {
  background: var(--ct-card-bg, #fff);
  color: var(--ct-primary, #6366f1);
  box-shadow: 0 1px 2px rgba(15,23,42,0.06);
}

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
:deep(.modal-eyebrow) { font-size: 0.68rem; font-weight: 700; color: var(--ct-primary, #6366f1); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.25rem; }
:deep(.modal-header-modern .modal-title) { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.25rem; }
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

.toggle-card {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  background: var(--ct-tertiary-bg, #f8fafc);
}
.tip-card {
  display: flex; gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: rgba(99,102,241,0.06);
  border: 1px solid rgba(99,102,241,0.18);
  align-items: flex-start;
}
.tip-icon { font-size: 1.2rem; color: var(--ct-primary, #6366f1); flex-shrink: 0; }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
  .disc-name { max-width: 160px; }
}
</style>
