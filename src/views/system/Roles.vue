<!-- src/views/system/Roles.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  listPermissions,
  setRolePermissions,
} from "../../api/systemRoles";

const toast = useToast();

const loading = ref(true);
const refreshing = ref(false);
const saving = ref(false);

const roles = ref([]);
const permissions = ref([]);

const filterName = ref("");
const filterDesc = ref("");
const filterPerm = ref("");

const modalEl = ref(null);
let modalInstance = null;

const editingId = ref(null);
const triedSubmit = ref(false);
const isEditMode = computed(() => !!editingId.value);

const form = ref({ name: "", description: "" });
const selectedPermIds = ref([]);
const permQuery = ref("");

// Group permissions by namespace prefix (e.g. "users.create" -> "users")
const permGroups = computed(() => {
  const q = (permQuery.value || "").trim().toLowerCase();
  const filtered = (permissions.value || []).filter((p) => {
    if (!q) return true;
    const code = String(p.code || "").toLowerCase();
    const desc = String(p.description || "").toLowerCase();
    return code.includes(q) || desc.includes(q);
  });
  const groups = new Map();
  for (const p of filtered) {
    const code = String(p.code || "");
    const ns = code.split(/[.:]/)[0] || "other";
    if (!groups.has(ns)) groups.set(ns, []);
    groups.get(ns).push(p);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ns, perms]) => ({ ns, perms }));
});

function isAllSelectedInGroup(perms) {
  if (!perms.length) return false;
  return perms.every((p) => selectedPermIds.value.includes(p.id));
}
function isAnySelectedInGroup(perms) {
  return perms.some((p) => selectedPermIds.value.includes(p.id));
}
function toggleGroup(perms) {
  const allOn = isAllSelectedInGroup(perms);
  const set = new Set(selectedPermIds.value);
  if (allOn) {
    perms.forEach((p) => set.delete(p.id));
  } else {
    perms.forEach((p) => set.add(p.id));
  }
  selectedPermIds.value = Array.from(set);
}

function resetForm() {
  editingId.value = null;
  triedSubmit.value = false;
  form.value = { name: "", description: "" };
  selectedPermIds.value = [];
  permQuery.value = "";
}

function setFormFromRole(r) {
  editingId.value = r.id;
  triedSubmit.value = false;
  form.value = { name: r.name || "", description: r.description || "" };
  if (Array.isArray(r.permissions) && r.permissions.length && typeof r.permissions[0] === "object") {
    selectedPermIds.value = (r.permissions || []).map((p) => p.id).filter(Boolean);
  } else if (Array.isArray(r.permission_ids)) {
    selectedPermIds.value = [...r.permission_ids];
  } else {
    selectedPermIds.value = [];
  }
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
async function openEdit(r) {
  setFormFromRole(r);
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}
function closeModal() { modalInstance?.hide(); }

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    const [rs, ps] = await Promise.all([listRoles(), listPermissions()]);
    roles.value = rs || [];
    permissions.value = ps || [];
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load roles/permissions");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function validate() {
  triedSubmit.value = true;
  if (!form.value.name?.trim()) { toast.error("Role name is required."); return false; }
  if (!selectedPermIds.value.length) { toast.error("Please select at least one permission."); return false; }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const payload = {
      name: form.value.name.trim(),
      description: (form.value.description || "").trim() || null,
    };
    let role;
    if (editingId.value) role = await updateRole(editingId.value, payload);
    else role = await createRole(payload);
    await setRolePermissions(role.id, selectedPermIds.value);
    toast.success(editingId.value ? "Role updated" : "Role created");
    closeModal();
    resetForm();
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save role");
  } finally {
    saving.value = false;
  }
}

async function removeRole(r) {
  if (!confirm(`Delete role "${r.name}"?`)) return;
  try {
    await deleteRole(r.id);
    toast.success("Role deleted");
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete role");
  }
}

function selectAllFilteredPerms() {
  const ids = permGroups.value.flatMap((g) => g.perms.map((p) => p.id)).filter(Boolean);
  const set = new Set(selectedPermIds.value);
  ids.forEach((id) => set.add(id));
  selectedPermIds.value = Array.from(set);
}
function clearAllPerms() { selectedPermIds.value = []; }

function clearFilters() {
  filterName.value = "";
  filterDesc.value = "";
  filterPerm.value = "";
}

const filteredRoles = computed(() => {
  const n = filterName.value.trim().toLowerCase();
  const d = filterDesc.value.trim().toLowerCase();
  const p = filterPerm.value.trim().toLowerCase();
  return (roles.value || []).filter((r) => {
    const name = String(r.name || "").toLowerCase();
    const desc = String(r.description || "").toLowerCase();
    const permCodes = (r.permissions || [])
      .map((x) => (typeof x === "string" ? x : x?.code))
      .filter(Boolean).join(" ").toLowerCase();
    const okName = !n || name.includes(n);
    const okDesc = !d || desc.includes(d);
    const okPerm = !p || permCodes.includes(p);
    return okName && okDesc && okPerm;
  });
});

const summary = computed(() => {
  const total = roles.value.length;
  const totalPerms = permissions.value.length;
  const empty = roles.value.filter((r) => !(r.permissions || []).length).length;
  return { total, totalPerms, empty };
});

function roleColor(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("admin") || n.includes("super")) return { bg: "rgba(239,68,68,0.14)", fg: "#b91c1c" };
  if (n.includes("manager")) return { bg: "rgba(99,102,241,0.14)", fg: "#4f46e5" };
  if (n.includes("cashier")) return { bg: "rgba(16,185,129,0.14)", fg: "#047857" };
  if (n.includes("kitchen") || n.includes("chef")) return { bg: "rgba(245,158,11,0.18)", fg: "#b45309" };
  if (n.includes("waiter") || n.includes("server")) return { bg: "rgba(6,182,212,0.14)", fg: "#0e7490" };
  return { bg: "rgba(29,78,216,0.1)", fg: "#1d4ed8" };
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
            <i class="ri-shield-user-line"></i><span>System</span>
          </div>
          <h1 class="hero-title">Roles</h1>
          <p class="hero-sub">
            Bundle permissions into roles, then assign roles to users. A user inherits everything granted by their assigned role(s).
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button v-can="'roles:manage'" class="btn btn-pill btn-cta" @click="openCreate">
            <i class="ri-add-line"></i><span>New Role</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon tone-primary"><i class="ri-shield-user-line"></i></div>
          <div>
            <div class="stat-label">Roles</div>
            <div class="stat-value">{{ summary.total }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-info"><i class="ri-key-2-line"></i></div>
          <div>
            <div class="stat-label">Total permissions</div>
            <div class="stat-value">{{ summary.totalPerms }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-warning"><i class="ri-error-warning-line"></i></div>
          <div>
            <div class="stat-label">Empty roles</div>
            <div class="stat-value">{{ summary.empty }}</div>
          </div>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-md-4">
              <label class="form-label">Role name</label>
              <div class="position-relative">
                <i class="ri-shield-user-line search-ico"></i>
                <input v-model="filterName" class="form-control ps-5" placeholder="Cashier, Manager…" />
              </div>
            </div>
            <div class="col-md-4">
              <label class="form-label">Description</label>
              <div class="position-relative">
                <i class="ri-file-text-line search-ico"></i>
                <input v-model="filterDesc" class="form-control ps-5" placeholder="can manage users…" />
              </div>
            </div>
            <div class="col-md-3">
              <label class="form-label">Permission code</label>
              <div class="position-relative">
                <i class="ri-key-2-line search-ico"></i>
                <input v-model="filterPerm" class="form-control ps-5" placeholder="users.create" />
              </div>
            </div>
            <div class="col-md-1 d-grid">
              <button class="btn btn-light" @click="clearFilters" title="Clear">
                <i class="ri-filter-off-line"></i>
              </button>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-3 small text-muted mt-2">
            <span>Showing <strong>{{ filteredRoles.length }}</strong> of <strong>{{ roles.length }}</strong></span>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading roles…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="filteredRoles.length === 0" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-shield-user-line"></i></div>
        <h5 class="mt-2 mb-1">{{ roles.length === 0 ? 'No roles yet' : 'No matches' }}</h5>
        <p class="text-muted mb-3">
          {{ roles.length === 0 ? 'Create your first role and grant permissions to it.' : 'Try clearing filters.' }}
        </p>
        <div>
          <button v-can="'roles:manage'" class="btn btn-primary" @click="openCreate">
            <i class="ri-add-line me-1"></i> New role
          </button>
        </div>
      </div>

      <!-- ============== Roles table ============== -->
      <div v-else class="card data-card">
        <div class="card-body p-0">
          <div class="table-responsive data-scroll">
            <table class="table align-middle mb-0 roles-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Description</th>
                  <th style="width: 130px" class="text-center">Permissions</th>
                  <th style="width: 110px" class="text-end"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in filteredRoles"
                  :key="r.id"
                  class="role-row"
                  @click="openEdit(r)"
                >
                  <td>
                    <span class="role-chip" :style="{ background: roleColor(r.name).bg, color: roleColor(r.name).fg }">
                      <i class="ri-shield-user-line"></i>{{ r.name }}
                    </span>
                  </td>
                  <td>
                    <span v-if="r.description">{{ r.description }}</span>
                    <span v-else class="text-muted fst-italic">No description</span>
                  </td>
                  <td class="text-center">
                    <span
                      class="perm-count"
                      :class="(r.permissions || []).length === 0 ? 'count-empty' : 'count-on'"
                      :title="`${(r.permissions || []).length} permission(s) granted`"
                    >
                      <i class="ri-key-2-line me-1"></i>{{ (r.permissions || []).length }}
                    </span>
                  </td>
                  <td class="text-end" @click.stop>
                    <button v-can="'roles:manage'" class="row-icon-btn" title="Edit" @click="openEdit(r)">
                      <i class="ri-pencil-line"></i>
                    </button>
                    <button v-can="'roles:manage'" class="row-icon-btn danger" title="Delete" @click="removeRole(r)">
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

    <!-- ============== Modal: Role + Permissions ============== -->
    <div class="modal fade" id="roleModal" tabindex="-1" aria-hidden="true" ref="modalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-xl">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditMode ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isEditMode ? "Edit role" : "New role" }}</h5>
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
              <div class="row g-3 mb-3">
                <div class="col-md-5">
                  <label class="form-label">Role name *</label>
                  <input v-model="form.name" class="form-control" placeholder="e.g. Cashier" required autocomplete="off" />
                </div>
                <div class="col-md-7">
                  <label class="form-label">Description</label>
                  <input v-model="form.description" class="form-control" placeholder="What can this role do?" autocomplete="off" />
                </div>
              </div>

              <!-- Permission selector -->
              <div class="perm-section">
                <div class="perm-head">
                  <div class="d-flex align-items-center gap-2">
                    <i class="ri-key-2-line text-primary"></i>
                    <h6 class="mb-0">Permissions</h6>
                    <span class="perm-counter" :class="selectedPermIds.length ? 'on' : 'off'">
                      {{ selectedPermIds.length }} / {{ permissions.length }}
                    </span>
                  </div>
                  <div class="d-flex gap-2">
                    <button type="button" class="btn btn-sm btn-soft-primary" @click="selectAllFilteredPerms">
                      <i class="ri-check-double-line me-1"></i>Select filtered
                    </button>
                    <button type="button" class="btn btn-sm btn-light" @click="clearAllPerms">
                      <i class="ri-close-line me-1"></i>Clear all
                    </button>
                  </div>
                </div>

                <div class="position-relative mb-3">
                  <i class="ri-search-line search-ico"></i>
                  <input
                    v-model="permQuery"
                    class="form-control ps-5"
                    placeholder="Filter by code or description (e.g. users., orders.)"
                  />
                </div>

                <div v-if="triedSubmit && !selectedPermIds.length" class="text-danger small mb-2">
                  <i class="ri-error-warning-line me-1"></i>Please select at least one permission.
                </div>

                <div class="perm-groups">
                  <div v-for="g in permGroups" :key="g.ns" class="perm-group">
                    <div class="perm-group-head">
                      <label class="perm-group-toggle">
                        <input
                          type="checkbox"
                          :checked="isAllSelectedInGroup(g.perms)"
                          :indeterminate.prop="!isAllSelectedInGroup(g.perms) && isAnySelectedInGroup(g.perms)"
                          @change="toggleGroup(g.perms)"
                          class="form-check-input m-0"
                        />
                        <span class="ns-name">{{ g.ns }}</span>
                        <span class="ns-count">{{ g.perms.filter((p) => selectedPermIds.includes(p.id)).length }} / {{ g.perms.length }}</span>
                      </label>
                    </div>
                    <div class="perm-grid">
                      <label v-for="p in g.perms" :key="p.id" class="perm-tile" :class="{ active: selectedPermIds.includes(p.id) }">
                        <input type="checkbox" class="form-check-input m-0" :value="p.id" v-model="selectedPermIds" />
                        <div class="min-w-0">
                          <div class="perm-code truncate" :title="p.code">{{ p.code }}</div>
                          <div class="perm-desc truncate" :title="p.description || ''">{{ p.description || '—' }}</div>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div v-if="permGroups.length === 0" class="empty-inline">
                    <div class="empty-inline-icon"><i class="ri-search-line"></i></div>
                    <div class="small text-muted">No permissions match your search.</div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <div class="me-auto small text-muted">
              <i class="ri-information-line me-1"></i>Granting <strong>{{ selectedPermIds.length }}</strong> permission{{ selectedPermIds.length === 1 ? '' : 's' }}
            </div>
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              {{ isEditMode ? "Update role" : "Create role" }}
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
.page-hero-actions { position: relative; display: flex; gap: 0.5rem; flex-wrap: wrap; }
.btn-pill { border-radius: 999px !important; display: inline-flex; align-items: center; gap: 0.4rem; }
.page-hero-actions .btn-light { background: rgba(255,255,255,0.95); color: #0f172a; border: none; }
.btn-cta { background: #fff !important; color: #1d4ed8 !important; font-weight: 700; border: none; box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3); }

/* ============= Stat strip ============= */
.stat-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; }
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

/* ============= Roles table ============= */
.data-card { overflow: hidden; }
.data-scroll {
  max-height: calc(100vh - 480px);
  min-height: 240px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.roles-table thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.role-row { cursor: pointer; transition: background 0.15s ease; }
.role-row:hover { background: rgba(29,78,216,0.04); }

.role-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-size: 0.82rem; font-weight: 700;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  letter-spacing: 0.04em;
}
.role-chip i { font-size: 0.95rem; }

.perm-count {
  display: inline-flex; align-items: center;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.78rem; font-weight: 700;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
}
.count-on { background: rgba(29,78,216,0.1); color: #1d4ed8; border: 1px solid rgba(29,78,216,0.22); }
.count-empty { background: rgba(245,158,11,0.14); color: #b45309; border: 1px solid rgba(245,158,11,0.3); }

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

/* ============= Permission selector ============= */
.perm-section {
  padding: 1rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px;
}
.perm-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 0.85rem;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.perm-counter {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.75rem; font-weight: 700;
  padding: 0.2rem 0.55rem; border-radius: 999px;
}
.perm-counter.on { background: rgba(29,78,216,0.12); color: #1d4ed8; }
.perm-counter.off { background: rgba(100,116,139,0.14); color: #64748b; }

.perm-groups {
  display: flex; flex-direction: column; gap: 0.85rem;
}
.perm-group {
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  overflow: hidden;
}
.perm-group-head {
  padding: 0.5rem 0.85rem;
  background: linear-gradient(180deg, rgba(29,78,216,0.04), transparent);
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
}
.perm-group-toggle {
  display: flex; align-items: center; gap: 0.6rem;
  cursor: pointer;
  margin: 0;
  user-select: none;
}
.ns-name {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 0.92rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ct-body-color, #0f172a);
}
.ns-count {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.7rem; font-weight: 700;
  padding: 0.1rem 0.45rem; border-radius: 4px;
  background: rgba(29,78,216,0.1); color: #1d4ed8;
  margin-left: auto;
}
.perm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.4rem;
  padding: 0.65rem;
}
.perm-tile {
  display: flex; align-items: center; gap: 0.55rem;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 8px;
  cursor: pointer;
  background: var(--ct-card-bg, #fff);
  transition: border-color 0.15s ease, background 0.15s ease;
  min-width: 0;
}
.perm-tile:hover {
  border-color: rgba(29,78,216,0.4);
  background: rgba(29,78,216,0.04);
}
.perm-tile.active {
  border-color: rgba(29,78,216,0.5);
  background: rgba(29,78,216,0.06);
}
.perm-code {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.78rem; font-weight: 700;
  color: var(--ct-body-color, #0f172a);
}
.perm-desc {
  font-size: 0.7rem;
  color: var(--ct-secondary-color, #64748b);
}
.truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.min-w-0 { min-width: 0; }

.empty-inline {
  display: flex; align-items: center; gap: 0.65rem;
  padding: 1rem;
  background: var(--ct-card-bg, #fff);
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
}
.empty-inline-icon {
  width: 38px; height: 38px;
  border-radius: 10px;
  display: grid; place-items: center;
  background: rgba(29,78,216,0.1); color: #1d4ed8;
  flex-shrink: 0;
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
:deep(.modal-eyebrow) { font-size: 0.68rem; font-weight: 700; color: #1d4ed8; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.25rem; }
:deep(.modal-header-modern .modal-title) { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.25rem; }
:deep(.modal-body-modern) {
  padding: 1.5rem;
  scrollbar-width: thin;
}
:deep(.modal-dialog-scrollable .modal-body)::-webkit-scrollbar { width: 8px; }
:deep(.modal-dialog-scrollable .modal-body)::-webkit-scrollbar-thumb {
  background: rgba(100,116,139,0.3); border-radius: 999px;
}

.modal-overlay {
  position: absolute; inset: 0; z-index: 5;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
}

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
