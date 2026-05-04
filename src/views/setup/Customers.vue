<!-- src/views/setup/Customers.vue -->
<script setup>
import { ref, onMounted, computed, nextTick, watch } from "vue";
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
const refreshing = ref(false);
const saving = ref(false);

const customers = ref([]);
const q = ref("");
const active = ref("1");

const modalEl = ref(null);
let modalInstance = null;

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

const PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f59e0b", "#10b981", "#06b6d4", "#0ea5e9",
];
function colorFor(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "CU";
  const a = parts[0]?.[0] || "C";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (a + b).toUpperCase();
}

function resetForm() {
  editId.value = null;
  triedSubmit.value = false;
  form.value = {
    code: "", name: "", phone: "", email: "",
    address: "", notes: "", is_active: true,
  };
}

function setFormFromCustomer(c) {
  editId.value = c.id;
  triedSubmit.value = false;
  form.value = {
    code: c.code || "", name: c.name || "",
    phone: c.phone || "", email: c.email || "",
    address: c.address || "", notes: c.notes || "",
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

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    customers.value = await listCustomers({
      q: q.value || undefined,
      active: active.value,
    });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load customers");
  } finally {
    loading.value = false;
    refreshing.value = false;
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
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save customer");
  } finally {
    saving.value = false;
  }
}

async function toggle(c) {
  try {
    await toggleCustomer(c.id);
    toast.success(c.is_active ? "Customer disabled" : "Customer enabled");
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed");
  }
}

function printStatement(c) { toast.info(`Print statement (dummy) for: ${c.name}`); }
function sendStatement(c) { toast.info(`Send statement (dummy) for: ${c.name}`); }

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

async function openEdit(c) {
  setFormFromCustomer(c);
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

function closeModal() { modalInstance?.hide(); }

function clearSearch() {
  q.value = "";
  active.value = "1";
  load(false);
}

const counts = computed(() => ({
  total: customers.value.length,
  active: customers.value.filter((c) => c.is_active).length,
  inactive: customers.value.filter((c) => !c.is_active).length,
  withPoints: customers.value.filter((c) => Number(c.loyalty_points) > 0).length,
}));

function safe(v) { return v && String(v).trim() ? v : "—"; }
function stop(e) { e?.stopPropagation?.(); }
function onKeyOpen(e, c) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openEdit(c);
  }
}

let filterTimer = null;
watch(active, () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => load(false), 200);
});

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-user-3-line"></i><span>Setup</span>
          </div>
          <h1 class="hero-title">Customers</h1>
          <p class="hero-sub">
            Your customer directory — name, contact, loyalty points, and notes. Disabled customers stay searchable but won't show up in POS pickers.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button class="btn btn-pill btn-cta" @click="openCreate">
            <i class="ri-user-add-line"></i><span>New Customer</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon tone-primary"><i class="ri-team-line"></i></div>
          <div>
            <div class="stat-label">Total</div>
            <div class="stat-value">{{ counts.total }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-success"><i class="ri-check-line"></i></div>
          <div>
            <div class="stat-label">Active</div>
            <div class="stat-value text-success">{{ counts.active }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-default"><i class="ri-pause-line"></i></div>
          <div>
            <div class="stat-label">Inactive</div>
            <div class="stat-value">{{ counts.inactive }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-warning"><i class="ri-star-line"></i></div>
          <div>
            <div class="stat-label">With points</div>
            <div class="stat-value">{{ counts.withPoints }}</div>
          </div>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-md-6">
              <label class="form-label">Search</label>
              <div class="position-relative">
                <i class="ri-search-line search-ico"></i>
                <input
                  v-model="q"
                  class="form-control ps-5"
                  placeholder="Name, code, phone, email…"
                  @keyup.enter="load(false)"
                />
              </div>
            </div>

            <div class="col-md-3">
              <label class="form-label">Status</label>
              <select v-model="active" class="form-select">
                <option value="1">Active only</option>
                <option value="0">Inactive only</option>
                <option value="all">All</option>
              </select>
            </div>

            <div class="col-md-3 d-flex gap-2">
              <button class="btn btn-soft-primary w-100" :disabled="loading" @click="load(false)">
                <i class="ri-search-line me-1"></i>Search
              </button>
              <button class="btn btn-light" :disabled="loading" @click="clearSearch" title="Clear">
                <i class="ri-filter-off-line"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading customers…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="customers.length === 0" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-user-3-line"></i></div>
        <h5 class="mt-2 mb-1">No customers found</h5>
        <p class="text-muted mb-3">Add your first customer to start tracking loyalty and contact info.</p>
        <div>
          <button class="btn btn-primary" @click="openCreate">
            <i class="ri-user-add-line me-1"></i> New customer
          </button>
        </div>
      </div>

      <!-- ============== Customer cards ============== -->
      <div v-else class="cust-grid-wrap">
        <div class="cust-grid">
          <div
            v-for="c in customers"
            :key="c.id"
            class="cust-card"
            :class="{ 'is-inactive': !c.is_active }"
            :style="{ '--accent': colorFor(c.name) }"
            role="button"
            tabindex="0"
            @click="openEdit(c)"
            @keydown="onKeyOpen($event, c)"
          >
            <div class="cust-head">
              <div class="cust-avatar">{{ initials(c.name) }}</div>
              <div class="cust-title">
                <div class="cust-name-row">
                  <div class="cust-name" :title="c.name">{{ c.name }}</div>
                  <span v-if="c.code" class="code-chip" @click="stop">{{ c.code }}</span>
                </div>
                <div class="cust-sub">
                  <span class="sub-item" v-if="c.phone">
                    <i class="ri-phone-line"></i>{{ c.phone }}
                  </span>
                  <span class="sub-item truncate" v-if="c.email" :title="c.email">
                    <i class="ri-mail-line"></i>{{ c.email }}
                  </span>
                </div>
              </div>
              <span class="status-pill" :class="c.is_active ? 'pill-on' : 'pill-off'">
                <span class="dot-mini"></span>{{ c.is_active ? 'Active' : 'Inactive' }}
              </span>
            </div>

            <div class="cust-body">
              <div class="kpi-grid">
                <div class="kpi-tile">
                  <div class="kpi-label"><i class="ri-star-line me-1"></i>Loyalty pts</div>
                  <div class="kpi-value">{{ c.loyalty_points ?? 0 }}</div>
                </div>
                <div class="kpi-tile">
                  <div class="kpi-label"><i class="ri-map-pin-line me-1"></i>Address</div>
                  <div class="kpi-value-sm truncate" :title="c.address">{{ safe(c.address) }}</div>
                </div>
              </div>

              <div v-if="c.notes" class="note-row">
                <i class="ri-sticky-note-line"></i>
                <span class="truncate" :title="c.notes">{{ c.notes }}</span>
              </div>
            </div>

            <div class="cust-actions" @click="stop">
              <button class="row-icon-btn" title="Print statement" @click="printStatement(c)">
                <i class="ri-printer-line"></i>
              </button>
              <button class="row-icon-btn" title="Send statement" @click="sendStatement(c)">
                <i class="ri-send-plane-line"></i>
              </button>
              <div class="ms-auto d-flex gap-1">
                <button class="row-icon-btn" title="Edit" @click="openEdit(c)">
                  <i class="ri-pencil-line"></i><span>Edit</span>
                </button>
                <button
                  class="row-icon-btn"
                  :class="c.is_active ? 'warn' : 'success'"
                  :title="c.is_active ? 'Disable' : 'Enable'"
                  @click="toggle(c)"
                >
                  <i :class="c.is_active ? 'ri-pause-line' : 'ri-play-line'"></i>
                  <span>{{ c.is_active ? 'Disable' : 'Enable' }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Add tile -->
          <button class="cust-card cust-add" @click="openCreate">
            <div class="add-icon"><i class="ri-user-add-line"></i></div>
            <div class="add-label">Add customer</div>
            <div class="add-sub">Capture contact &amp; loyalty</div>
          </button>
        </div>
      </div>
    </div>

    <!-- ============== Modal ============== -->
    <div class="modal fade" id="customerModal" tabindex="-1" aria-hidden="true" ref="modalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditMode ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isEditMode ? "Edit customer" : "New customer" }}</h5>
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
                  <label class="form-label">Code</label>
                  <input v-model="form.code" class="form-control" placeholder="e.g. CUST001" autocomplete="off" />
                  <div class="form-text">Optional, auto-uppercased</div>
                </div>

                <div class="col-md-8">
                  <label class="form-label">Name *</label>
                  <input v-model="form.name" class="form-control" placeholder="John Banda" required autocomplete="name" />
                </div>

                <div class="col-md-6">
                  <label class="form-label">Phone</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-phone-line"></i></span>
                    <input v-model="form.phone" class="form-control" placeholder="0971234567" autocomplete="tel" />
                  </div>
                </div>

                <div class="col-md-6">
                  <label class="form-label">Email</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-mail-line"></i></span>
                    <input v-model="form.email" type="email" class="form-control" placeholder="john@example.com" autocomplete="email" />
                  </div>
                </div>

                <div class="col-12">
                  <label class="form-label">Address</label>
                  <textarea v-model="form.address" class="form-control" rows="2" placeholder="Street, area, city…" autocomplete="street-address"></textarea>
                </div>

                <div class="col-12">
                  <label class="form-label">Notes</label>
                  <textarea v-model="form.notes" class="form-control" rows="2" placeholder="Preferences, reminders, dietary, etc."></textarea>
                </div>

                <div class="col-12">
                  <div class="toggle-card">
                    <div>
                      <div class="fw-semibold">Active</div>
                      <div class="small text-muted">Inactive customers are hidden from POS pickers but kept on file.</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input id="custActive" v-model="form.is_active" class="form-check-input" type="checkbox" />
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
              {{ isEditMode ? "Update customer" : "Create customer" }}
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

/* ============= Hero (setup slate→indigo→violet) ============= */
.page-hero {
  position: relative;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem;
  padding: 1.5rem 1.75rem; margin-bottom: 1.25rem;
  border-radius: 22px;
  background: linear-gradient(135deg, #0f172a 0%, #6366f1 55%, #8b5cf6 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(99, 102, 241, 0.55);
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
.btn-cta:hover { background: #fff !important; color: #3730a3 !important; }

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
.stat-icon {
  width: 38px; height: 38px; border-radius: 10px;
  display: grid; place-items: center; font-size: 1.05rem;
}
.stat-icon.tone-primary { background: rgba(99,102,241,0.12); color: #4f46e5; }
.stat-icon.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.stat-icon.tone-default { background: rgba(100,116,139,0.14); color: #64748b; }
.stat-icon.tone-warning { background: rgba(245,158,11,0.18); color: #b45309; }
.stat-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ct-secondary-color, #64748b); }
.stat-value { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.05rem; color: var(--ct-body-color, #0f172a); }

/* ============= Toolbar / Empty ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(99,102,241,0.04) 0%, transparent 100%); }
.search-ico {
  position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8); pointer-events: none;
}
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); font-size: 1.6rem;
}

/* ============= Customer grid ============= */
.cust-grid-wrap {
  max-height: calc(100vh - 480px);
  min-height: 240px;
  overflow-y: auto;
  padding: 0.25rem 0.5rem 0.5rem 0;
  scrollbar-width: thin;
}
.cust-grid-wrap::-webkit-scrollbar { width: 8px; }
.cust-grid-wrap::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.cust-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 0.9rem;
}

.cust-card {
  position: relative;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 16px;
  display: flex; flex-direction: column;
  overflow: hidden;
  cursor: pointer; outline: none;
  transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
}
.cust-card::before {
  content: "";
  position: absolute; top: 0; left: 0; right: 0;
  height: 4px;
  background: var(--accent, #6366f1);
  opacity: 0.9;
}
.cust-card:hover, .cust-card:focus {
  border-color: color-mix(in srgb, var(--accent, #6366f1) 50%, transparent);
  transform: translateY(-2px);
  box-shadow: 0 12px 24px -14px rgba(15,23,42,0.22);
}
.cust-card.is-inactive { opacity: 0.78; }
.cust-card.is-inactive::before { background: #94a3b8; }

.cust-head {
  padding: 1rem 1rem 0.75rem;
  display: grid;
  grid-template-columns: 46px 1fr auto;
  gap: 0.75rem;
  align-items: start;
}
.cust-avatar {
  width: 46px; height: 46px;
  border-radius: 12px;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 0.95rem;
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 26%, transparent);
}
.cust-title { min-width: 0; }
.cust-name-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.cust-name {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 0.98rem;
  color: var(--ct-body-color, #0f172a);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 240px;
  letter-spacing: -0.01em;
}
.code-chip {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.68rem; font-weight: 700;
  padding: 0.15rem 0.45rem; border-radius: 6px;
  background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1);
  border: 1px solid rgba(99,102,241,0.2);
}
.cust-sub {
  margin-top: 0.35rem;
  display: flex; gap: 0.5rem; flex-wrap: wrap;
  font-size: 0.72rem; color: var(--ct-secondary-color, #64748b);
}
.sub-item { display: inline-flex; align-items: center; gap: 0.25rem; min-width: 0; }
.sub-item i { font-size: 0.85rem; }
.truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

.status-pill {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.68rem; font-weight: 700;
}
.dot-mini { width: 6px; height: 6px; border-radius: 50%; }
.pill-on { background: rgba(16,185,129,0.14); color: #047857; }
.pill-on .dot-mini { background: #10b981; }
.pill-off { background: rgba(100,116,139,0.14); color: #64748b; }
.pill-off .dot-mini { background: #94a3b8; }

.cust-body { padding: 0.5rem 1rem 0.75rem; }
.kpi-grid {
  display: grid; grid-template-columns: 1fr 1.4fr; gap: 0.5rem;
}
.kpi-tile {
  padding: 0.55rem 0.75rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
}
.kpi-label { font-size: 0.68rem; font-weight: 700; color: var(--ct-secondary-color, #64748b); text-transform: uppercase; letter-spacing: 0.06em; }
.kpi-value {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 1.15rem;
  color: var(--ct-body-color, #0f172a);
  letter-spacing: -0.02em;
  margin-top: 0.15rem;
}
.kpi-value-sm {
  font-weight: 700; font-size: 0.82rem;
  color: var(--ct-body-color, #0f172a);
  margin-top: 0.15rem;
}
.note-row {
  margin-top: 0.5rem;
  display: flex; align-items: center; gap: 0.4rem;
  padding: 0.5rem 0.65rem;
  background: rgba(99,102,241,0.04);
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 8px;
  font-size: 0.78rem; color: var(--ct-secondary-color, #475569);
}
.note-row i { color: var(--ct-primary, #6366f1); flex-shrink: 0; }

.cust-actions {
  margin-top: auto;
  padding: 0.65rem 1rem;
  display: flex; align-items: center; gap: 0.4rem;
  border-top: 1px dashed var(--ct-border-color, #e6e9ef);
  background: linear-gradient(180deg, transparent, rgba(99,102,241,0.02));
}
.row-icon-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.3rem;
  padding: 0.35rem 0.55rem;
  border-radius: 8px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.78rem; font-weight: 600;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
}
.row-icon-btn:hover { background: rgba(99,102,241,0.08); color: var(--ct-primary, #6366f1); }
.row-icon-btn.warn:hover { background: rgba(245,158,11,0.12); color: #b45309; }
.row-icon-btn.success:hover { background: rgba(16,185,129,0.12); color: #047857; }

.cust-add {
  background: transparent;
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  align-items: center; justify-content: center;
  text-align: center;
  color: var(--ct-secondary-color, #64748b);
  padding: 1.5rem 1rem;
  min-height: 200px;
}
.cust-add::before { display: none; }
.cust-add:hover {
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
  font-size: 0.68rem; font-weight: 700; color: var(--ct-primary, #6366f1);
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

.toggle-card {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  background: var(--ct-tertiary-bg, #f8fafc);
}

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
  .cust-name { max-width: 180px; }
}
</style>
