<!-- src/views/cash/Drawers.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import SearchSelect from "../../components/SearchSelect.vue";

import {
  listCashDrawers,
  createCashDrawer,
  updateCashDrawer,
  toggleCashDrawer,
} from "../../api/cash";

import { listOutlets } from "../../api/systemOutlets";

const toast = useToast();
const loading = ref(true);
const refreshing = ref(false);
const saving = ref(false);

const drawers = ref([]);
const outlets = ref([]);

const outletId = ref(null);
const active = ref("1");
const q = ref("");

const modalEl = ref(null);
let modalInstance = null;

const editId = ref(null);
const triedSubmit = ref(false);

const form = ref({
  outlet_id: null,
  name: "",
  is_active: true,
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

const outletLabel = (id) => {
  const n = outletNameById.value.get(Number(id));
  return n || (id ? `Outlet #${id}` : "");
};

const filteredDrawers = computed(() => {
  const qq = q.value.trim().toLowerCase();
  if (!qq) return drawers.value || [];
  return (drawers.value || []).filter((d) => {
    const outletText = outletLabel(d.outlet_id);
    const hay = `${outletText} ${d.name || ""}`.toLowerCase();
    return hay.includes(qq);
  });
});

const summary = computed(() => {
  const total = drawers.value.length;
  const activeCount = drawers.value.filter((d) => d.is_active).length;
  const inactiveCount = total - activeCount;
  const outletSet = new Set(drawers.value.map((d) => d.outlet_id));
  return { total, active: activeCount, inactive: inactiveCount, outlets: outletSet.size };
});

// Stable accent per drawer name
const PALETTE = [
  "#10b981", "#06b6d4", "#0ea5e9", "#6366f1",
  "#8b5cf6", "#ec4899", "#f59e0b", "#84cc16",
];
function colorFor(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function resetForm() {
  editId.value = null;
  triedSubmit.value = false;
  form.value = {
    outlet_id: outletId.value ?? null,
    name: "",
    is_active: true,
  };
}

function setFormFromDrawer(d) {
  editId.value = d.id;
  triedSubmit.value = false;
  form.value = {
    outlet_id: Number(d.outlet_id) || null,
    name: d.name || "",
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
  setFormFromDrawer(d);
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

function closeModal() { modalInstance?.hide(); }

async function loadOutlets() {
  try {
    outlets.value = await listOutlets();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load outlets");
    outlets.value = [];
  }
}

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    drawers.value = await listCashDrawers({
      outlet_id: outletId.value ?? undefined,
      active: active.value,
    });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load drawers");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function validate() {
  triedSubmit.value = true;
  const out = Number(form.value.outlet_id);
  if (!out) { toast.error("Outlet is required"); return false; }
  if (!String(form.value.name || "").trim()) { toast.error("Drawer name is required"); return false; }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const payload = {
      outlet_id: Number(form.value.outlet_id),
      name: (form.value.name || "").trim(),
      is_active: !!form.value.is_active,
    };
    if (editId.value) {
      await updateCashDrawer(editId.value, { name: payload.name, is_active: payload.is_active });
      toast.success("Drawer updated");
    } else {
      await createCashDrawer(payload);
      toast.success("Drawer created");
    }
    closeModal();
    resetForm();
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save drawer");
  } finally {
    saving.value = false;
  }
}

async function toggle(d) {
  try {
    await toggleCashDrawer(d.id);
    toast.success(d.is_active ? "Drawer disabled" : "Drawer enabled");
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to toggle");
  }
}

function clearFilters() {
  outletId.value = null;
  active.value = "1";
  q.value = "";
}

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
            <i class="ri-inbox-line"></i><span>Cash</span>
          </div>
          <h1 class="hero-title">Cash Drawers</h1>
          <p class="hero-sub">
            Each register or till you operate. Disable a drawer to stop new shifts being opened on it without losing its history.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button class="btn btn-pill btn-cta" @click="openCreate">
            <i class="ri-add-line"></i><span>New Drawer</span>
          </button>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2 overflow-visible">
          <div class="row g-2 align-items-end overflow-visible">
            <div class="col-md-4 overflow-visible">
              <label class="form-label">Outlet</label>
              <SearchSelect
                v-model="outletId"
                :options="outletOptions"
                placeholder="All outlets"
                :nullLabel="'All outlets'"
                :clearable="true"
                @update:modelValue="load(false)"
              />
            </div>

            <div class="col-md-3">
              <label class="form-label">Status</label>
              <select v-model="active" class="form-select" @change="load(false)">
                <option value="1">Active only</option>
                <option value="0">Inactive only</option>
                <option value="all">All</option>
              </select>
            </div>

            <div class="col-md-4">
              <label class="form-label">Search</label>
              <div class="position-relative">
                <i class="ri-search-line search-ico"></i>
                <input v-model="q" class="form-control ps-5" placeholder="Drawer or outlet name…" />
              </div>
            </div>

            <div class="col-md-1 d-grid">
              <button class="btn btn-light" @click="clearFilters" title="Clear filters">
                <i class="ri-filter-off-line"></i>
              </button>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-3 small text-muted mt-2">
            <span><strong>{{ summary.total }}</strong> drawer{{ summary.total === 1 ? '' : 's' }}</span>
            <span class="d-none d-sm-inline">•</span>
            <span><strong class="text-success">{{ summary.active }}</strong> active</span>
            <span v-if="summary.inactive">
              <span class="d-none d-sm-inline">•</span>
              <strong class="text-secondary"> {{ summary.inactive }}</strong> inactive
            </span>
            <span class="d-none d-sm-inline">•</span>
            <span>across <strong>{{ summary.outlets }}</strong> outlet{{ summary.outlets === 1 ? '' : 's' }}</span>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading drawers…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="!drawers.length" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-inbox-line"></i></div>
        <h5 class="mt-2 mb-1">No drawers yet</h5>
        <p class="text-muted mb-3">Add your first cash drawer — Main Till, Bar, Back Office…</p>
        <div>
          <button class="btn btn-primary" @click="openCreate">
            <i class="ri-add-line me-1"></i> New drawer
          </button>
        </div>
      </div>

      <!-- Empty (search) -->
      <div v-else-if="!filteredDrawers.length" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-search-line"></i></div>
        <h5 class="mt-2 mb-1">No matches</h5>
        <p class="text-muted mb-3">Nothing matches "<strong>{{ q }}</strong>".</p>
        <div>
          <button class="btn btn-light" @click="clearFilters">
            <i class="ri-close-line me-1"></i> Clear
          </button>
        </div>
      </div>

      <!-- ============== Drawer cards grid ============== -->
      <div v-else class="drawer-grid-wrap">
        <div class="drawer-grid">
          <div
            v-for="d in filteredDrawers"
            :key="d.id"
            class="drawer-card"
            :class="{ 'is-inactive': !d.is_active }"
            :style="{ '--accent': colorFor(d.name) }"
            role="button"
            tabindex="0"
            @click="openEdit(d)"
            @keydown.enter.prevent="openEdit(d)"
            @keydown.space.prevent="openEdit(d)"
          >
            <div class="drawer-top">
              <div class="drawer-avatar">
                <i class="ri-inbox-line"></i>
              </div>
              <span class="status-pill" :class="d.is_active ? 'pill-on' : 'pill-off'">
                <span class="dot-mini"></span>{{ d.is_active ? 'Active' : 'Inactive' }}
              </span>
            </div>

            <div class="drawer-body">
              <div class="drawer-name" :title="d.name">{{ d.name }}</div>
              <div class="drawer-outlet">
                <i class="ri-store-2-line me-1"></i>{{ outletLabel(d.outlet_id) || '—' }}
              </div>
              <div class="drawer-id">ID #{{ d.id }} · {{ initialsOf(d.name) }}</div>
            </div>

            <div class="drawer-actions" @click.stop>
              <button class="row-icon-btn" title="Edit" @click="openEdit(d)">
                <i class="ri-pencil-line"></i><span>Edit</span>
              </button>
              <button
                class="row-icon-btn"
                :class="d.is_active ? 'warn' : 'success'"
                :title="d.is_active ? 'Disable' : 'Enable'"
                @click="toggle(d)"
              >
                <i :class="d.is_active ? 'ri-pause-line' : 'ri-play-line'"></i>
                <span>{{ d.is_active ? 'Disable' : 'Enable' }}</span>
              </button>
            </div>
          </div>

          <!-- Add tile -->
          <button class="drawer-card drawer-add" @click="openCreate">
            <div class="add-icon"><i class="ri-add-line"></i></div>
            <div class="add-label">Add drawer</div>
            <div class="add-sub">Register / till / back office</div>
          </button>
        </div>
      </div>
    </div>

    <!-- ============== Modal: Create/Edit ============== -->
    <div class="modal fade" id="drawerModal" tabindex="-1" aria-hidden="true" ref="modalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditMode ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isEditMode ? "Edit drawer" : "New drawer" }}</h5>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" :disabled="saving"></button>
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
                <div class="col-md-5">
                  <label class="form-label">Outlet *</label>
                  <SearchSelect
                    v-model="form.outlet_id"
                    :options="outletOptions"
                    placeholder="Select outlet…"
                    :clearable="true"
                    :disabled="isEditMode"
                  />
                  <div v-if="triedSubmit && !form.outlet_id" class="text-danger small mt-1">
                    Outlet is required.
                  </div>
                  <div v-if="isEditMode" class="form-text">Outlet can't be changed after creation.</div>
                </div>

                <div class="col-md-7">
                  <label class="form-label">Name *</label>
                  <input
                    v-model="form.name"
                    class="form-control"
                    placeholder="Main Drawer"
                    required
                    autocomplete="off"
                    autofocus
                  />
                  <div class="form-text">Use clear names: Main, Back Office, Register 2…</div>
                </div>

                <div class="col-12">
                  <div class="toggle-card">
                    <div>
                      <div class="fw-semibold">Active</div>
                      <div class="small text-muted">Inactive drawers can't be used to open new shifts.</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input id="drawerActive" v-model="form.is_active" class="form-check-input" type="checkbox" />
                    </div>
                  </div>
                </div>

                <div class="col-12">
                  <div class="tip-card">
                    <i class="ri-lightbulb-flash-line tip-icon"></i>
                    <div class="small">
                      <div class="fw-semibold mb-1">Pro tip</div>
                      <div class="text-muted">
                        Disabling a drawer is safer than deleting — historical shifts and movements stay intact and reportable.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              {{ isEditMode ? "Update drawer" : "Create drawer" }}
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

/* ============= Hero (cash green→teal→indigo) ============= */
.page-hero {
  position: relative;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem;
  padding: 1.5rem 1.75rem; margin-bottom: 1.25rem;
  border-radius: 22px;
  background: linear-gradient(135deg, #10b981 0%, #06b6d4 55%, #6366f1 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(16, 185, 129, 0.55);
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
.btn-cta { background: #fff !important; color: #047857 !important; font-weight: 700; border: none; box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3); }
.btn-cta:hover { background: #fff !important; color: #065f46 !important; }

/* ============= Toolbar / Empty ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(16,185,129,0.05) 0%, transparent 100%); }
.overflow-visible { overflow: visible !important; }
.search-ico {
  position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8); pointer-events: none;
}
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(16,185,129,0.12); color: #10b981; font-size: 1.6rem;
}

/* ============= Drawer cards ============= */
.drawer-grid-wrap {
  max-height: calc(100vh - 360px);
  min-height: 240px;
  overflow-y: auto;
  padding: 0.25rem 0.5rem 0.5rem 0;
  scrollbar-width: thin;
}
.drawer-grid-wrap::-webkit-scrollbar { width: 8px; }
.drawer-grid-wrap::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.drawer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.9rem;
}

.drawer-card {
  position: relative;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 16px;
  padding: 1rem;
  display: flex; flex-direction: column; gap: 0.65rem;
  min-height: 170px;
  cursor: pointer;
  outline: none;
  overflow: hidden;
  transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
}
.drawer-card::before {
  content: "";
  position: absolute; top: 0; left: 0; right: 0;
  height: 4px;
  background: var(--accent, #10b981);
  opacity: 0.9;
}
.drawer-card::after {
  content: "";
  position: absolute; right: -30px; top: -30px;
  width: 140px; height: 140px;
  border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--accent, #10b981) 14%, transparent), transparent 70%);
  pointer-events: none;
}
.drawer-card:hover, .drawer-card:focus {
  border-color: color-mix(in srgb, var(--accent, #10b981) 50%, transparent);
  transform: translateY(-2px);
  box-shadow: 0 12px 24px -14px rgba(15,23,42,0.22);
}
.drawer-card.is-inactive { opacity: 0.72; }
.drawer-card.is-inactive::before { background: #94a3b8; }

.drawer-top {
  display: flex; align-items: center; justify-content: space-between;
  position: relative;
}
.drawer-avatar {
  width: 44px; height: 44px;
  border-radius: 12px;
  display: grid; place-items: center;
  font-size: 1.3rem;
  color: var(--accent, #10b981);
  background: color-mix(in srgb, var(--accent, #10b981) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #10b981) 28%, transparent);
}
.drawer-body { min-width: 0; position: relative; }
.drawer-name {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 1.05rem;
  color: var(--ct-body-color, #0f172a);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  letter-spacing: -0.01em;
}
.drawer-outlet {
  font-size: 0.78rem;
  color: var(--ct-secondary-color, #475569);
  font-weight: 600;
  margin-top: 0.15rem;
}
.drawer-id {
  font-size: 0.7rem;
  color: var(--ct-secondary-color, #94a3b8);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  margin-top: 0.15rem;
}

.status-pill {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.7rem; font-weight: 700;
}
.dot-mini { width: 6px; height: 6px; border-radius: 50%; }
.pill-on { background: rgba(16,185,129,0.14); color: #047857; }
.pill-on .dot-mini { background: #10b981; }
.pill-off { background: rgba(100,116,139,0.14); color: #64748b; }
.pill-off .dot-mini { background: #94a3b8; }

.drawer-actions {
  display: flex; gap: 0.4rem;
  margin-top: auto;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--ct-border-color, #e6e9ef);
  position: relative;
}
.row-icon-btn {
  flex: 1;
  display: inline-flex; align-items: center; justify-content: center; gap: 0.3rem;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.78rem; font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.row-icon-btn:hover { background: rgba(99,102,241,0.08); color: var(--ct-primary, #6366f1); }
.row-icon-btn.warn:hover { background: rgba(245,158,11,0.12); color: #b45309; }
.row-icon-btn.success:hover { background: rgba(16,185,129,0.12); color: #047857; }

/* Add tile */
.drawer-add {
  background: transparent;
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  align-items: center; justify-content: center;
  text-align: center;
  color: var(--ct-secondary-color, #64748b);
  padding: 1.5rem 1rem;
}
.drawer-add::before, .drawer-add::after { display: none; }
.drawer-add:hover {
  border-color: #10b981;
  color: #047857;
  background: rgba(16,185,129,0.04);
  transform: translateY(-2px);
}
.add-icon {
  width: 44px; height: 44px;
  border-radius: 12px;
  display: grid; place-items: center;
  font-size: 1.4rem;
  background: rgba(16,185,129,0.12);
  color: #10b981;
  margin-bottom: 0.25rem;
}
.add-label {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 700; font-size: 0.95rem;
  color: var(--ct-body-color, #0f172a);
}
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
  font-size: 0.68rem; font-weight: 700; color: #047857;
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
.tip-card {
  display: flex; gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: rgba(16,185,129,0.06);
  border: 1px solid rgba(16,185,129,0.18);
  align-items: flex-start;
}
.tip-icon { font-size: 1.2rem; color: #10b981; flex-shrink: 0; }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
