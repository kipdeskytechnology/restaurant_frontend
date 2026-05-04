<!-- src/views/system/Outlets.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import { listOutlets, createOutlet, updateOutlet, deleteOutlet } from "../../api/systemOutlets";

const toast = useToast();

const loading = ref(true);
const refreshing = ref(false);
const saving = ref(false);

const rows = ref([]);

const filterCode = ref("");
const filterName = ref("");
const filterCity = ref("");
const filterCountry = ref("");

const modalEl = ref(null);
let modalInstance = null;

const isEditing = ref(false);
const triedSubmit = ref(false);

const form = ref({
  id: null, code: "", name: "",
  address: "", city: "", country: "",
});

const isEditMode = computed(() => isEditing.value && !!form.value.id);

const filteredRows = computed(() => {
  const c = filterCode.value.trim().toLowerCase();
  const n = filterName.value.trim().toLowerCase();
  const ci = filterCity.value.trim().toLowerCase();
  const co = filterCountry.value.trim().toLowerCase();
  return (rows.value || []).filter((o) => {
    const okCode = !c || (o.code || "").toLowerCase().includes(c);
    const okName = !n || (o.name || "").toLowerCase().includes(n);
    const okCity = !ci || (o.city || "").toLowerCase().includes(ci);
    const okCountry = !co || (o.country || "").toLowerCase().includes(co);
    return okCode && okName && okCity && okCountry;
  });
});

const summary = computed(() => {
  const total = rows.value.length;
  const cities = new Set(rows.value.map((o) => o.city).filter(Boolean));
  const countries = new Set(rows.value.map((o) => o.country).filter(Boolean));
  const withAddress = rows.value.filter((o) => o.address).length;
  return { total, cities: cities.size, countries: countries.size, withAddress };
});

const PALETTE = [
  "#3b82f6", "#06b6d4", "#10b981", "#8b5cf6",
  "#ec4899", "#f59e0b", "#0ea5e9", "#6366f1",
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

function clearFilters() {
  filterCode.value = "";
  filterName.value = "";
  filterCity.value = "";
  filterCountry.value = "";
}

function resetForm() {
  triedSubmit.value = false;
  isEditing.value = false;
  form.value = { id: null, code: "", name: "", address: "", city: "", country: "" };
}

function setFormFromOutlet(o) {
  isEditing.value = true;
  triedSubmit.value = false;
  form.value = {
    id: o.id, code: o.code || "", name: o.name || "",
    address: o.address || "", city: o.city || "", country: o.country || "",
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
async function openEdit(o) {
  setFormFromOutlet(o);
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}
function closeModal() { modalInstance?.hide(); }

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    rows.value = await listOutlets();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load outlets");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function validate() {
  triedSubmit.value = true;
  const code = (form.value.code || "").trim();
  const name = (form.value.name || "").trim();
  if (!code) { toast.error("Outlet code is required."); return false; }
  if (!name) { toast.error("Outlet name is required."); return false; }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const payload = {
      code: (form.value.code || "").trim().toUpperCase(),
      name: (form.value.name || "").trim(),
      address: (form.value.address || "").trim() || null,
      city: (form.value.city || "").trim() || null,
      country: (form.value.country || "").trim() || null,
    };
    if (isEditMode.value) {
      await updateOutlet(form.value.id, payload);
      toast.success("Outlet updated");
    } else {
      await createOutlet(payload);
      toast.success("Outlet created");
    }
    closeModal();
    resetForm();
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save outlet");
  } finally {
    saving.value = false;
  }
}

async function removeRow(o) {
  if (!confirm(`Delete outlet "${o.name}"?`)) return;
  try {
    await deleteOutlet(o.id);
    toast.success("Outlet deleted");
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete outlet");
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
            <i class="ri-store-2-line"></i><span>System</span>
          </div>
          <h1 class="hero-title">Outlets</h1>
          <p class="hero-sub">
            Branches, locations, or food trucks — wherever you trade. Each outlet is a separate context for inventory, cash, and reporting.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button v-can="'outlets:manage'" class="btn btn-pill btn-cta" @click="openCreate">
            <i class="ri-add-line"></i><span>New Outlet</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon tone-primary"><i class="ri-store-2-line"></i></div>
          <div>
            <div class="stat-label">Outlets</div>
            <div class="stat-value">{{ summary.total }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-info"><i class="ri-building-line"></i></div>
          <div>
            <div class="stat-label">Cities</div>
            <div class="stat-value">{{ summary.cities }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-success"><i class="ri-earth-line"></i></div>
          <div>
            <div class="stat-label">Countries</div>
            <div class="stat-value">{{ summary.countries }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-warning"><i class="ri-map-pin-line"></i></div>
          <div>
            <div class="stat-label">With address</div>
            <div class="stat-value">{{ summary.withAddress }}</div>
          </div>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-md-2">
              <label class="form-label">Code</label>
              <input v-model="filterCode" class="form-control" placeholder="MAIN" />
            </div>
            <div class="col-md-3">
              <label class="form-label">Name</label>
              <input v-model="filterName" class="form-control" placeholder="Main Branch" />
            </div>
            <div class="col-md-3">
              <label class="form-label">City</label>
              <input v-model="filterCity" class="form-control" placeholder="Lusaka" />
            </div>
            <div class="col-md-2">
              <label class="form-label">Country</label>
              <input v-model="filterCountry" class="form-control" placeholder="Zambia" />
            </div>
            <div class="col-md-2 d-grid">
              <button class="btn btn-light" @click="clearFilters">
                <i class="ri-filter-off-line me-1"></i>Clear
              </button>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-3 small text-muted mt-2">
            <span>Showing <strong>{{ filteredRows.length }}</strong> of <strong>{{ rows.length }}</strong></span>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div class="card" v-if="loading">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading outlets…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="filteredRows.length === 0" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-store-2-line"></i></div>
        <h5 class="mt-2 mb-1">{{ rows.length === 0 ? 'No outlets yet' : 'No matches' }}</h5>
        <p class="text-muted mb-3">
          {{ rows.length === 0 ? 'Add your first branch — Main, Cairo Road, etc.' : 'Try clearing filters or widening your search.' }}
        </p>
        <div>
          <button v-can="'outlets:manage'" class="btn btn-primary" @click="openCreate">
            <i class="ri-add-line me-1"></i> New outlet
          </button>
        </div>
      </div>

      <!-- ============== Outlets table ============== -->
      <div class="card data-card" v-else>
        <div class="card-body p-0">
          <div class="table-responsive data-scroll">
            <table class="table align-middle mb-0 outlets-table">
              <thead>
                <tr>
                  <th style="width: 110px">Code</th>
                  <th>Outlet</th>
                  <th style="width: 200px">City</th>
                  <th style="width: 200px">Country</th>
                  <th style="width: 110px" class="text-end"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="o in filteredRows"
                  :key="o.id"
                  class="outlet-row"
                  @click="openEdit(o)"
                >
                  <td>
                    <span class="code-chip">{{ o.code }}</span>
                  </td>
                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <div class="outlet-avatar" :style="{ '--accent': colorFor(o.name) }">
                        {{ initialsOf(o.name) }}
                      </div>
                      <div class="min-w-0">
                        <div class="outlet-name">{{ o.name }}</div>
                        <div class="outlet-sub" v-if="o.address" :title="o.address">
                          <i class="ri-map-pin-line me-1"></i>{{ o.address }}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="loc-chip" v-if="o.city">
                      <i class="ri-building-line me-1"></i>{{ o.city }}
                    </span>
                    <span v-else class="text-muted">—</span>
                  </td>
                  <td>
                    <span class="loc-chip" v-if="o.country">
                      <i class="ri-earth-line me-1"></i>{{ o.country }}
                    </span>
                    <span v-else class="text-muted">—</span>
                  </td>
                  <td class="text-end" @click.stop>
                    <button v-can="'outlets:manage'" class="row-icon-btn" title="Edit" @click="openEdit(o)">
                      <i class="ri-pencil-line"></i>
                    </button>
                    <button v-can="'outlets:manage'" class="row-icon-btn danger" title="Delete" @click="removeRow(o)">
                      <i class="ri-delete-bin-line"></i>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Modal ============== -->
    <div class="modal fade" id="outletModal" tabindex="-1" aria-hidden="true" ref="modalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditMode ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isEditMode ? "Edit outlet" : "New outlet" }}</h5>
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
                  <input
                    v-model="form.code"
                    class="form-control text-uppercase"
                    placeholder="MAIN"
                    required autocomplete="off"
                  />
                  <div class="form-text">Auto-uppercased</div>
                </div>
                <div class="col-md-8">
                  <label class="form-label">Name *</label>
                  <input v-model="form.name" class="form-control" placeholder="Main Branch — Cairo Road" required autocomplete="off" />
                </div>

                <div class="col-12">
                  <label class="form-label">Address</label>
                  <input v-model="form.address" class="form-control" placeholder="Street, area, building (optional)" autocomplete="street-address" />
                </div>

                <div class="col-md-6">
                  <label class="form-label">City</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-building-line"></i></span>
                    <input v-model="form.city" class="form-control" placeholder="Lusaka" autocomplete="address-level2" />
                  </div>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Country</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-earth-line"></i></span>
                    <input v-model="form.country" class="form-control" placeholder="Zambia" autocomplete="country-name" />
                  </div>
                </div>

                <div class="col-12">
                  <div class="tip-card">
                    <i class="ri-information-line tip-icon"></i>
                    <div class="small">
                      <div class="fw-semibold mb-1">Outlet code matters</div>
                      <div class="text-muted">
                        Codes appear in receipts, reports, and order numbers — pick something short and stable. Renaming the outlet name later is fine; renaming the code can affect history.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button v-can="'outlets:manage'" class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              {{ isEditMode ? "Update outlet" : "Create outlet" }}
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

/* ============= Hero (system) ============= */
.page-hero {
  position: relative;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem;
  padding: 1.5rem 1.75rem; margin-bottom: 1.25rem;
  border-radius: 22px;
  background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 50%, #06b6d4 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(29,78,216,0.55);
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
.btn-cta { background: #fff !important; color: #1d4ed8 !important; font-weight: 700; border: none; box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3); }

/* ============= Stat strip ============= */
.stat-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.75rem; }
.stat-tile {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.85rem 1rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px; box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.stat-icon { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; font-size: 1.05rem; }
.stat-icon.tone-primary { background: rgba(29,78,216,0.12); color: #1d4ed8; }
.stat-icon.tone-info { background: rgba(6,182,212,0.14); color: #0e7490; }
.stat-icon.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.stat-icon.tone-warning { background: rgba(245,158,11,0.18); color: #b45309; }
.stat-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ct-secondary-color, #64748b); }
.stat-value { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.05rem; color: var(--ct-body-color, #0f172a); }

/* ============= Toolbar / Empty ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(29,78,216,0.04) 0%, transparent 100%); }
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(29,78,216,0.12); color: #1d4ed8; font-size: 1.6rem;
}

/* ============= Outlets table ============= */
.data-card { overflow: hidden; }
.data-scroll {
  max-height: calc(100vh - 480px);
  min-height: 240px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.outlets-table thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.outlet-row { cursor: pointer; transition: background 0.15s ease; }
.outlet-row:hover { background: rgba(29,78,216,0.04); }

.code-chip {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.78rem; font-weight: 700;
  padding: 0.25rem 0.6rem; border-radius: 6px;
  background: rgba(29,78,216,0.1); color: #1d4ed8;
  border: 1px solid rgba(29,78,216,0.22);
}

.outlet-avatar {
  width: 38px; height: 38px;
  border-radius: 10px;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 0.78rem;
  color: var(--accent, #1d4ed8);
  background: color-mix(in srgb, var(--accent, #1d4ed8) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #1d4ed8) 28%, transparent);
  flex-shrink: 0;
  letter-spacing: -0.02em;
}
.outlet-name {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 700; color: var(--ct-body-color, #0f172a); line-height: 1.25;
}
.outlet-sub {
  font-size: 0.72rem;
  color: var(--ct-secondary-color, #64748b);
  margin-top: 0.1rem;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 360px;
}
.min-w-0 { min-width: 0; }

.loc-chip {
  display: inline-flex; align-items: center;
  font-size: 0.78rem; font-weight: 600;
  padding: 0.2rem 0.55rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 8px;
  color: var(--ct-secondary-color, #475569);
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
.row-icon-btn:hover { background: rgba(29,78,216,0.1); color: #1d4ed8; }
.row-icon-btn.danger:hover { background: rgba(239,68,68,0.1); color: #ef4444; }

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
:deep(.modal-eyebrow) { font-size: 0.68rem; font-weight: 700; color: #1d4ed8; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.25rem; }
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

.tip-card {
  display: flex; gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: rgba(29,78,216,0.06);
  border: 1px solid rgba(29,78,216,0.18);
  align-items: flex-start;
}
.tip-icon { font-size: 1.2rem; color: #1d4ed8; flex-shrink: 0; }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
