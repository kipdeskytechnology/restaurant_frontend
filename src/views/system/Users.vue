<!-- src/views/system/Users.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import { listUsers, createUser, updateUser, resetUserPassword } from "../../api/systemUsers";
import { listRoles } from "../../api/systemRoles";
import SearchSelect from "../../components/SearchSelect.vue";

const toast = useToast();

const loading = ref(true);
const refreshing = ref(false);
const saving = ref(false);

const users = ref([]);
const roles = ref([]);

const editingId = ref(null);
const triedSubmit = ref(false);

const filterName = ref("");
const filterEmail = ref("");
const filterPhone = ref("");

const modalEl = ref(null);
let modalInstance = null;

const form = ref({
  outlet_id: null,
  username: "",
  email: "",
  phone: "",
  first_name: "",
  last_name: "",
  is_active: true,
  role_id: null,
});

const isEditMode = computed(() => !!editingId.value);

const roleOptions = computed(() =>
  (roles.value || []).map((r) => ({ label: r.name, value: r.id }))
);

const filteredUsers = computed(() => {
  const n = filterName.value.trim().toLowerCase();
  const e = filterEmail.value.trim().toLowerCase();
  const p = filterPhone.value.trim().toLowerCase();
  return (users.value || []).filter((u) => {
    const fullName = `${u.first_name || ""} ${u.last_name || ""}`.trim().toLowerCase();
    const username = (u.username || "").toLowerCase();
    const okName = !n || fullName.includes(n) || username.includes(n);
    const okEmail = !e || (u.email || "").toLowerCase().includes(e);
    const okPhone = !p || (u.phone || "").toLowerCase().includes(p);
    return okName && okEmail && okPhone;
  });
});

const summary = computed(() => {
  const total = users.value.length;
  const active = users.value.filter((u) => u.is_active).length;
  const inactive = total - active;
  const mustChange = users.value.filter((u) => u.must_change_password).length;
  return { total, active, inactive, mustChange };
});

// Color avatar by name
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
function initialsOf(first, last, fallback) {
  const f = String(first || "").trim();
  const l = String(last || "").trim();
  if (f || l) return ((f[0] || "") + (l[0] || "")).toUpperCase() || (f[0] || "?").toUpperCase();
  const fb = String(fallback || "U").trim();
  return fb.slice(0, 2).toUpperCase();
}

// Per-role color
function roleColor(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("admin") || n.includes("super")) return { bg: "rgba(239,68,68,0.14)", fg: "#b91c1c" };
  if (n.includes("manager")) return { bg: "rgba(99,102,241,0.14)", fg: "#4f46e5" };
  if (n.includes("cashier")) return { bg: "rgba(16,185,129,0.14)", fg: "#047857" };
  if (n.includes("kitchen") || n.includes("chef")) return { bg: "rgba(245,158,11,0.18)", fg: "#b45309" };
  if (n.includes("waiter") || n.includes("server")) return { bg: "rgba(6,182,212,0.14)", fg: "#0e7490" };
  return { bg: "rgba(99,102,241,0.1)", fg: "#4f46e5" };
}

function resetForm() {
  editingId.value = null;
  triedSubmit.value = false;
  form.value = {
    outlet_id: null,
    username: "", email: "", phone: "",
    first_name: "", last_name: "",
    is_active: true, role_id: null,
  };
}

function setFormFromUser(u) {
  editingId.value = u.id;
  const roleId = roles.value.find((r) => (u.roles || []).includes(r.name))?.id ?? null;
  form.value = {
    outlet_id: u.outlet_id ?? null,
    username: u.username || "",
    email: u.email || "",
    phone: u.phone || "",
    first_name: u.first_name || "",
    last_name: u.last_name || "",
    is_active: !!u.is_active,
    role_id: roleId,
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

async function openEdit(u) {
  setFormFromUser(u);
  triedSubmit.value = false;
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

function closeModal() { modalInstance?.hide(); }

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    roles.value = await listRoles();
    users.value = await listUsers();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load users");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function validate() {
  triedSubmit.value = true;
  if (!form.value.email?.trim()) { toast.error("Email is required."); return false; }
  if (!form.value.first_name?.trim()) { toast.error("First name is required."); return false; }
  if (!form.value.last_name?.trim()) { toast.error("Last name is required."); return false; }
  if (!form.value.role_id) { toast.error("Role is required."); return false; }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const payload = { ...form.value, role_ids: form.value.role_id ? [form.value.role_id] : [] };
    delete payload.role_id;
    if (editingId.value) {
      await updateUser(editingId.value, payload);
      toast.success("User updated");
    } else {
      await createUser(payload);
      toast.success("User created — OTP email sent");
    }
    closeModal();
    resetForm();
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save user");
  } finally {
    saving.value = false;
  }
}

async function resetPassword(u) {
  if (!confirm(`Reset password for ${u.email || u.username || "user"}?`)) return;
  try {
    await resetUserPassword(u.id);
    toast.success("Password reset — OTP email sent");
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to reset password");
  }
}

function clearFilters() {
  filterName.value = "";
  filterEmail.value = "";
  filterPhone.value = "";
}

function fullName(u) {
  return `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username || "—";
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
            <i class="ri-team-line"></i><span>System</span>
          </div>
          <h1 class="hero-title">Users</h1>
          <p class="hero-sub">
            Staff accounts and access. New users receive a one-time password by email — they'll be forced to change it on first sign-in.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button v-can="['users:create','users:manage']" class="btn btn-pill btn-cta" @click="openCreate">
            <i class="ri-user-add-line"></i><span>New User</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon tone-primary"><i class="ri-team-line"></i></div>
          <div>
            <div class="stat-label">Total users</div>
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
          <div class="stat-icon tone-default"><i class="ri-pause-line"></i></div>
          <div>
            <div class="stat-label">Inactive</div>
            <div class="stat-value">{{ summary.inactive }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-warning"><i class="ri-key-2-line"></i></div>
          <div>
            <div class="stat-label">Pending PW change</div>
            <div class="stat-value">{{ summary.mustChange }}</div>
          </div>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-md-3">
              <label class="form-label">Name / Username</label>
              <div class="position-relative">
                <i class="ri-user-line search-ico"></i>
                <input v-model="filterName" class="form-control ps-5" placeholder="John, jdoe…" />
              </div>
            </div>
            <div class="col-md-4">
              <label class="form-label">Email</label>
              <div class="position-relative">
                <i class="ri-mail-line search-ico"></i>
                <input v-model="filterEmail" class="form-control ps-5" placeholder="user@company.com" />
              </div>
            </div>
            <div class="col-md-3">
              <label class="form-label">Phone</label>
              <div class="position-relative">
                <i class="ri-phone-line search-ico"></i>
                <input v-model="filterPhone" class="form-control ps-5" placeholder="0971234567" />
              </div>
            </div>
            <div class="col-md-2 d-grid">
              <button class="btn btn-light" @click="clearFilters">
                <i class="ri-filter-off-line me-1"></i>Clear
              </button>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-3 small text-muted mt-2">
            <span>Showing <strong>{{ filteredUsers.length }}</strong> of <strong>{{ users.length }}</strong></span>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading users…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="filteredUsers.length === 0" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-team-line"></i></div>
        <h5 class="mt-2 mb-1">{{ users.length === 0 ? 'No users yet' : 'No matches' }}</h5>
        <p class="text-muted mb-3">
          {{ users.length === 0 ? 'Create your first user — they\'ll receive an OTP email.' : 'Try clearing filters or widening your search.' }}
        </p>
        <div>
          <button v-can="['users:create','users:manage']" class="btn btn-primary" @click="openCreate">
            <i class="ri-user-add-line me-1"></i> New user
          </button>
        </div>
      </div>

      <!-- ============== Users table ============== -->
      <div v-else class="card data-card">
        <div class="card-body p-0">
          <div class="table-responsive data-scroll">
            <table class="table align-middle mb-0 users-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th style="width: 220px">Email</th>
                  <th style="width: 140px">Phone</th>
                  <th style="width: 200px">Role(s)</th>
                  <th style="width: 160px">Status</th>
                  <th style="width: 110px" class="text-end"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="u in filteredUsers"
                  :key="u.id"
                  class="user-row"
                  @click="openEdit(u)"
                >
                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <div
                        class="user-avatar"
                        :style="{ '--accent': colorFor(fullName(u)) }"
                      >{{ initialsOf(u.first_name, u.last_name, u.username) }}</div>
                      <div class="min-w-0">
                        <div class="user-name truncate" :title="fullName(u)">{{ fullName(u) }}</div>
                        <div class="user-sub" v-if="u.username">@{{ u.username }}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="email-chip" v-if="u.email" :title="u.email">
                      <i class="ri-mail-line me-1"></i>{{ u.email }}
                    </span>
                    <span v-else class="text-muted">—</span>
                  </td>
                  <td>
                    <span class="phone-chip" v-if="u.phone">
                      <i class="ri-phone-line me-1"></i>{{ u.phone }}
                    </span>
                    <span v-else class="text-muted">—</span>
                  </td>
                  <td>
                    <div class="d-flex flex-wrap gap-1">
                      <span
                        v-for="r in (u.roles || [])"
                        :key="r"
                        class="role-chip"
                        :style="{ background: roleColor(r).bg, color: roleColor(r).fg }"
                      >
                        <i class="ri-shield-user-line me-1"></i>{{ r }}
                      </span>
                      <span v-if="!(u.roles || []).length" class="text-muted">—</span>
                    </div>
                  </td>
                  <td>
                    <div class="d-flex flex-wrap gap-1">
                      <span class="status-pill" :class="u.is_active ? 'pill-on' : 'pill-off'">
                        <span class="dot-mini"></span>{{ u.is_active ? 'Active' : 'Inactive' }}
                      </span>
                      <span v-if="u.must_change_password" class="status-pill pill-warn" title="Must change password on next sign-in">
                        <i class="ri-key-2-line"></i>PW
                      </span>
                    </div>
                  </td>
                  <td class="text-end" @click.stop>
                    <button v-can="['users:update','users:manage']" class="row-icon-btn" title="Edit" @click="openEdit(u)">
                      <i class="ri-pencil-line"></i>
                    </button>
                    <button v-can="['users:manage']" class="row-icon-btn warn" title="Reset password" @click="resetPassword(u)">
                      <i class="ri-key-2-line"></i>
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
    <div class="modal fade" id="userModal" tabindex="-1" aria-hidden="true" ref="modalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditMode ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isEditMode ? "Edit user" : "New user" }}</h5>
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
                  <label class="form-label">Email *</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-mail-line"></i></span>
                    <input
                      v-model="form.email"
                      type="email"
                      class="form-control"
                      placeholder="staff@kipdesky.com"
                      required
                      autocomplete="email"
                    />
                  </div>
                  <div v-if="!isEditMode" class="form-text"><i class="ri-information-line me-1"></i>OTP will be sent to this email.</div>
                </div>

                <div class="col-md-6">
                  <label class="form-label">First name *</label>
                  <input v-model="form.first_name" class="form-control" placeholder="John" required autocomplete="given-name" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Last name *</label>
                  <input v-model="form.last_name" class="form-control" placeholder="Banda" required autocomplete="family-name" />
                </div>

                <div class="col-md-6">
                  <label class="form-label">Username</label>
                  <div class="input-group">
                    <span class="input-group-text">@</span>
                    <input v-model="form.username" class="form-control" placeholder="jdoe (optional)" autocomplete="username" />
                  </div>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Phone</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-phone-line"></i></span>
                    <input v-model="form.phone" class="form-control" placeholder="0971234567 (optional)" autocomplete="tel" />
                  </div>
                </div>

                <div class="col-12">
                  <label class="form-label">Role *</label>
                  <SearchSelect
                    v-model="form.role_id"
                    :options="roleOptions"
                    placeholder="Select role (e.g. Cashier, Manager)"
                    :clearable="true"
                    :searchable="true"
                  />
                  <div v-if="triedSubmit && !form.role_id" class="text-danger small mt-1">Role is required.</div>
                </div>

                <div class="col-12">
                  <div class="toggle-card">
                    <div>
                      <div class="fw-semibold">Active</div>
                      <div class="small text-muted">Inactive users cannot sign in but their history is preserved.</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input id="userActive" v-model="form.is_active" class="form-check-input" type="checkbox" />
                    </div>
                  </div>
                </div>

                <div class="col-12" v-if="!isEditMode">
                  <div class="tip-card">
                    <i class="ri-shield-keyhole-line tip-icon"></i>
                    <div class="small">
                      <div class="fw-semibold mb-1">First-sign-in flow</div>
                      <div class="text-muted">
                        We'll email a one-time password to <strong>{{ form.email || 'this address' }}</strong>. They'll be forced to set a new password on first sign-in.
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
              {{ isEditMode ? "Update user" : "Create user & email OTP" }}
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

/* ============= Hero (system slate→blue→cyan) ============= */
.page-hero {
  position: relative;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem;
  padding: 1.5rem 1.75rem; margin-bottom: 1.25rem;
  border-radius: 22px;
  background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 50%, #06b6d4 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(29, 78, 216, 0.55);
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
.btn-cta:hover { background: #fff !important; color: #1e3a8a !important; }

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
.stat-icon.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.stat-icon.tone-default { background: rgba(100,116,139,0.14); color: #64748b; }
.stat-icon.tone-warning { background: rgba(245,158,11,0.18); color: #b45309; }
.stat-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ct-secondary-color, #64748b); }
.stat-value { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.05rem; color: var(--ct-body-color, #0f172a); }

/* ============= Toolbar / Empty ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(29,78,216,0.04) 0%, transparent 100%); }
.search-ico {
  position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8); pointer-events: none;
}
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(29,78,216,0.12); color: #1d4ed8; font-size: 1.6rem;
}

/* ============= Users table ============= */
.data-card { overflow: hidden; }
.data-scroll {
  max-height: calc(100vh - 480px);
  min-height: 240px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.users-table thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.user-row { cursor: pointer; transition: background 0.15s ease; }
.user-row:hover { background: rgba(29,78,216,0.04); }

.user-avatar {
  width: 38px; height: 38px;
  border-radius: 50%;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 0.82rem;
  color: var(--accent, #1d4ed8);
  background: color-mix(in srgb, var(--accent, #1d4ed8) 14%, transparent);
  border: 2px solid color-mix(in srgb, var(--accent, #1d4ed8) 28%, transparent);
  flex-shrink: 0;
  letter-spacing: -0.02em;
}
.user-name { font-weight: 700; color: var(--ct-body-color, #0f172a); line-height: 1.2; }
.user-sub { font-size: 0.7rem; color: var(--ct-secondary-color, #64748b); font-family: "JetBrains Mono", ui-monospace, monospace; }
.min-w-0 { min-width: 0; }
.truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 220px; }

.email-chip, .phone-chip {
  display: inline-flex; align-items: center;
  font-size: 0.78rem;
  padding: 0.2rem 0.55rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 8px;
  color: var(--ct-secondary-color, #475569);
  max-width: 200px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.role-chip {
  display: inline-flex; align-items: center;
  font-size: 0.7rem; font-weight: 700;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  letter-spacing: 0.04em;
}
.role-chip i { font-size: 0.85rem; }

.status-pill {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.15rem 0.5rem; border-radius: 999px;
  font-size: 0.68rem; font-weight: 700;
  letter-spacing: 0.04em;
}
.status-pill i { font-size: 0.85rem; }
.dot-mini { width: 6px; height: 6px; border-radius: 50%; }
.pill-on { background: rgba(16,185,129,0.14); color: #047857; }
.pill-on .dot-mini { background: #10b981; }
.pill-off { background: rgba(100,116,139,0.14); color: #64748b; }
.pill-off .dot-mini { background: #94a3b8; }
.pill-warn { background: rgba(245,158,11,0.18); color: #b45309; }

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
.row-icon-btn.warn:hover { background: rgba(245,158,11,0.12); color: #b45309; }

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
