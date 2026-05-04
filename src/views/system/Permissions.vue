<!-- src/views/system/Permissions.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import {
  listPermissions,
  createPermission,
  updatePermission,
  deletePermission,
} from "../../api/systemPermissions";

const toast = useToast();

const loading = ref(true);
const refreshing = ref(false);
const saving = ref(false);

const permissions = ref([]);

const filterCode = ref("");
const filterDesc = ref("");
const filterNs = ref("all");

const modalEl = ref(null);
let modalInstance = null;

const isEditing = ref(false);
const triedSubmit = ref(false);

const form = ref({ id: null, code: "", description: "" });

function resetForm() {
  isEditing.value = false;
  triedSubmit.value = false;
  form.value = { id: null, code: "", description: "" };
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

async function openEdit(p) {
  isEditing.value = true;
  triedSubmit.value = false;
  form.value = { id: p.id, code: p.code || "", description: p.description || "" };
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

function closeModal() { modalInstance?.hide(); }

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    permissions.value = await listPermissions();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load permissions");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function validate() {
  triedSubmit.value = true;
  if (!form.value.code?.trim()) { toast.error("Permission code is required."); return false; }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const payload = {
      code: (form.value.code || "").trim(),
      description: (form.value.description || "").trim() || null,
    };
    if (isEditing.value) {
      await updatePermission(form.value.id, payload);
      toast.success("Permission updated");
    } else {
      await createPermission(payload);
      toast.success("Permission created");
    }
    closeModal();
    resetForm();
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save permission");
  } finally {
    saving.value = false;
  }
}

async function removePermission(p) {
  if (!confirm(`Delete permission "${p.code}"?`)) return;
  try {
    await deletePermission(p.id);
    toast.success("Permission deleted");
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete permission");
  }
}

function namespaceOf(code) {
  return String(code || "").split(/[.:]/)[0] || "other";
}

const allNamespaces = computed(() => {
  const set = new Set();
  for (const p of permissions.value || []) set.add(namespaceOf(p.code));
  return Array.from(set).sort();
});

const filtered = computed(() => {
  const c = filterCode.value.trim().toLowerCase();
  const d = filterDesc.value.trim().toLowerCase();
  const ns = filterNs.value;
  return (permissions.value || []).filter((p) => {
    const okCode = !c || (p.code || "").toLowerCase().includes(c);
    const okDesc = !d || (p.description || "").toLowerCase().includes(d);
    const okNs = ns === "all" || namespaceOf(p.code) === ns;
    return okCode && okDesc && okNs;
  });
});

const summary = computed(() => {
  const total = permissions.value.length;
  const namespaces = allNamespaces.value.length;
  const documented = permissions.value.filter((p) => p.description?.trim()).length;
  return { total, namespaces, documented, undocumented: total - documented };
});

// Group filtered permissions by namespace for the grid view
const grouped = computed(() => {
  const map = new Map();
  for (const p of filtered.value) {
    const ns = namespaceOf(p.code);
    if (!map.has(ns)) map.set(ns, []);
    map.get(ns).push(p);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ns, perms]) => ({ ns, perms }));
});

const NS_ICON = {
  users: "ri-user-3-line",
  roles: "ri-shield-user-line",
  permissions: "ri-key-2-line",
  outlets: "ri-store-2-line",
  stores: "ri-building-2-line",
  inventory: "ri-archive-line",
  menu: "ri-restaurant-line",
  orders: "ri-bill-line",
  cash: "ri-wallet-3-line",
  expense: "ri-money-dollar-circle-line",
  expenses: "ri-money-dollar-circle-line",
  purchases: "ri-shopping-cart-2-line",
  reports: "ri-bar-chart-line",
  payments: "ri-bank-card-line",
  discounts: "ri-price-tag-3-line",
  tax: "ri-percent-line",
  uom: "ri-ruler-2-line",
  kds: "ri-restaurant-2-line",
  pos: "ri-computer-line",
  settings: "ri-settings-3-line",
};
function nsIcon(ns) { return NS_ICON[ns] || "ri-folder-3-line"; }

function clearFilters() {
  filterCode.value = "";
  filterDesc.value = "";
  filterNs.value = "all";
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
            <i class="ri-key-2-line"></i><span>System</span>
          </div>
          <h1 class="hero-title">Permissions</h1>
          <p class="hero-sub">
            The atomic capabilities granted to roles. Use dot notation — <code>users.create</code>, <code>orders.refund</code> — and group everything by namespace.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button v-can="'permissions:manage'" class="btn btn-pill btn-cta" @click="openCreate">
            <i class="ri-add-line"></i><span>New Permission</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon tone-primary"><i class="ri-key-2-line"></i></div>
          <div>
            <div class="stat-label">Permissions</div>
            <div class="stat-value">{{ summary.total }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-info"><i class="ri-folder-3-line"></i></div>
          <div>
            <div class="stat-label">Namespaces</div>
            <div class="stat-value">{{ summary.namespaces }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-success"><i class="ri-file-text-line"></i></div>
          <div>
            <div class="stat-label">Documented</div>
            <div class="stat-value text-success">{{ summary.documented }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-warning"><i class="ri-alert-line"></i></div>
          <div>
            <div class="stat-label">No description</div>
            <div class="stat-value">{{ summary.undocumented }}</div>
          </div>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-md-3">
              <label class="form-label">Code</label>
              <div class="position-relative">
                <i class="ri-key-2-line search-ico"></i>
                <input v-model="filterCode" class="form-control ps-5" placeholder="users.create" />
              </div>
            </div>
            <div class="col-md-4">
              <label class="form-label">Description</label>
              <div class="position-relative">
                <i class="ri-file-text-line search-ico"></i>
                <input v-model="filterDesc" class="form-control ps-5" placeholder="Can view roles…" />
              </div>
            </div>
            <div class="col-md-3">
              <label class="form-label">Namespace</label>
              <select v-model="filterNs" class="form-select">
                <option value="all">All namespaces</option>
                <option v-for="ns in allNamespaces" :key="ns" :value="ns">{{ ns }}</option>
              </select>
            </div>
            <div class="col-md-2 d-grid">
              <button class="btn btn-light" @click="clearFilters">
                <i class="ri-filter-off-line me-1"></i>Clear
              </button>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-3 small text-muted mt-2">
            <span>Showing <strong>{{ filtered.length }}</strong> of <strong>{{ permissions.length }}</strong></span>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading permissions…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="filtered.length === 0" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-key-2-line"></i></div>
        <h5 class="mt-2 mb-1">{{ permissions.length === 0 ? 'No permissions yet' : 'No matches' }}</h5>
        <p class="text-muted mb-3">
          {{ permissions.length === 0 ? 'Define your first permission code (e.g. users.create).' : 'Try clearing filters.' }}
        </p>
        <div>
          <button v-can="'permissions:manage'" class="btn btn-primary" @click="openCreate">
            <i class="ri-add-line me-1"></i> New permission
          </button>
        </div>
      </div>

      <!-- ============== Grouped permissions ============== -->
      <div v-else class="perm-page-wrap">
        <div v-for="g in grouped" :key="g.ns" class="card panel-card mb-3">
          <div class="panel-head">
            <div class="d-flex align-items-center gap-2">
              <span class="ns-icon"><i :class="nsIcon(g.ns)"></i></span>
              <div>
                <div class="panel-eyebrow">Namespace</div>
                <div class="panel-title">{{ g.ns }}</div>
              </div>
            </div>
            <span class="status-pill pill-soft">
              <i class="ri-key-2-line"></i> {{ g.perms.length }}
            </span>
          </div>

          <div class="card-body p-3">
            <div class="perm-grid">
              <div
                v-for="p in g.perms"
                :key="p.id"
                class="perm-tile"
                role="button"
                tabindex="0"
                @click="openEdit(p)"
                @keydown.enter.prevent="openEdit(p)"
                @keydown.space.prevent="openEdit(p)"
              >
                <div class="min-w-0 flex-grow-1">
                  <div class="perm-code truncate" :title="p.code">{{ p.code }}</div>
                  <div class="perm-desc truncate" v-if="p.description" :title="p.description">{{ p.description }}</div>
                  <div class="perm-desc text-warning fst-italic" v-else>No description</div>
                </div>
                <div class="perm-actions" @click.stop>
                  <button v-can="'permissions:manage'" class="row-icon-btn" title="Edit" @click="openEdit(p)">
                    <i class="ri-pencil-line"></i>
                  </button>
                  <button v-can="'permissions:manage'" class="row-icon-btn danger" title="Delete" @click="removePermission(p)">
                    <i class="ri-delete-bin-line"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Modal ============== -->
    <div class="modal fade" tabindex="-1" aria-hidden="true" ref="modalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditing ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isEditing ? "Edit permission" : "New permission" }}</h5>
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
                <div class="col-12">
                  <label class="form-label">Code *</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-key-2-line"></i></span>
                    <input
                      v-model="form.code"
                      class="form-control code-input"
                      placeholder="e.g. users.create"
                      required autocomplete="off"
                    />
                  </div>
                  <div class="form-text">
                    Use dot notation: <code>{{ namespaceOf(form.code || 'namespace') }}.action</code>
                  </div>
                </div>

                <div class="col-12">
                  <label class="form-label">Description</label>
                  <input v-model="form.description" class="form-control" placeholder="Short explanation (recommended)" autocomplete="off" />
                  <div class="form-text">Optional, but recommended for clarity.</div>
                </div>

                <div class="col-12">
                  <div class="tip-card">
                    <i class="ri-shield-keyhole-line tip-icon"></i>
                    <div class="small">
                      <div class="fw-semibold mb-1">Naming convention</div>
                      <div class="text-muted">
                        Lowercase, dot-separated. Common patterns:
                        <code>users.create</code>, <code>users.update</code>, <code>users.manage</code>,
                        <code>orders.refund</code>, <code>reports.view</code>.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button v-can="'permissions:manage'" class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              {{ isEditing ? "Update permission" : "Create permission" }}
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
.page-hero-text { position: relative; max-width: 700px; }
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
.hero-sub code { background: rgba(255,255,255,0.18); color: #fff; padding: 0.05em 0.35em; border-radius: 4px; font-size: 0.85em; }
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
.search-ico { position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%); color: var(--ct-secondary-color, #94a3b8); pointer-events: none; }
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(29,78,216,0.12); color: #1d4ed8; font-size: 1.6rem;
}

/* ============= Grouped panels ============= */
.perm-page-wrap {
  max-height: calc(100vh - 480px);
  min-height: 240px;
  overflow-y: auto;
  scrollbar-width: thin;
  padding-right: 4px;
}
.perm-page-wrap::-webkit-scrollbar { width: 8px; }
.perm-page-wrap::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.panel-card {
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.panel-head {
  padding: 0.85rem 1.25rem;
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  background: linear-gradient(180deg, rgba(29,78,216,0.04), transparent);
}
.ns-icon {
  width: 38px; height: 38px;
  border-radius: 10px;
  display: grid; place-items: center;
  background: rgba(29,78,216,0.12); color: #1d4ed8;
  font-size: 1.1rem;
  flex-shrink: 0;
}
.panel-eyebrow { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #1d4ed8; }
.panel-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; letter-spacing: -0.02em;
  font-size: 1rem;
  color: var(--ct-body-color, #0f172a);
  text-transform: uppercase;
}
.status-pill {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  font-size: 0.72rem; font-weight: 700;
}
.status-pill i { font-size: 0.85rem; }
.pill-soft { background: rgba(29,78,216,0.1); color: #1d4ed8; }

/* ============= Permission tile grid ============= */
.perm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.5rem;
}
.perm-tile {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
  outline: none;
  min-width: 0;
}
.perm-tile:hover, .perm-tile:focus {
  border-color: rgba(29,78,216,0.4);
  transform: translateY(-1px);
  box-shadow: 0 6px 14px -8px rgba(15,23,42,0.18);
}
.perm-code {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.82rem; font-weight: 700;
  color: var(--ct-body-color, #0f172a);
  line-height: 1.25;
}
.perm-desc {
  font-size: 0.72rem;
  color: var(--ct-secondary-color, #64748b);
  margin-top: 0.1rem;
}
.perm-actions {
  display: flex; gap: 0.15rem;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.perm-tile:hover .perm-actions, .perm-tile:focus-within .perm-actions { opacity: 1; }
@media (hover: none) { .perm-actions { opacity: 1; } }

.row-icon-btn {
  width: 28px; height: 28px;
  border-radius: 7px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
  font-size: 0.85rem;
}
.row-icon-btn:hover { background: rgba(29,78,216,0.1); color: #1d4ed8; }
.row-icon-btn.danger:hover { background: rgba(239,68,68,0.1); color: #ef4444; }

.truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.min-w-0 { min-width: 0; }

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
.code-input {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 600;
}
.code-input::placeholder { font-family: var(--ct-font-sans-serif, sans-serif); font-weight: 400; }

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
