<!-- src/views/purchasing/Suppliers.vue -->
<script setup>
import { ref, onMounted, watch, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier } from "../../api/purchasing";

const toast = useToast();

const loading = ref(true);
const refreshing = ref(false);
const saving = ref(false);
const rows = ref([]);

const filters = ref({
  q: "",
  active: "1",
});

const modalEl = ref(null);
let modalInstance = null;

const editing = ref(null);
const triedSubmit = ref(false);

const form = ref({
  name: "", phone: "", email: "", address: "",
  is_active: true,
});

const isEditMode = computed(() => !!editing.value);

const summary = computed(() => {
  const total = rows.value.length;
  const active = rows.value.filter((r) => r.is_active).length;
  const withEmail = rows.value.filter((r) => r.email).length;
  const withPhone = rows.value.filter((r) => r.phone).length;
  return { total, active, withEmail, withPhone };
});

const PALETTE = [
  "#0d9488", "#0891b2", "#2563eb", "#7c3aed",
  "#ec4899", "#f59e0b", "#10b981", "#06b6d4",
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
  editing.value = null;
  triedSubmit.value = false;
  form.value = { name: "", phone: "", email: "", address: "", is_active: true };
}

function setFormFromRow(r) {
  editing.value = r;
  triedSubmit.value = false;
  form.value = {
    name: r.name || "",
    phone: r.phone || "",
    email: r.email || "",
    address: r.address || "",
    is_active: !!r.is_active,
  };
}

async function openCreate() {
  resetForm();
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

async function openEdit(r) {
  setFormFromRow(r);
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

function closeModal() { modalInstance?.hide(); }

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    rows.value = await listSuppliers({
      limit: 500,
      active: filters.value.active,
      q: filters.value.q?.trim() || undefined,
    });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load suppliers");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function save() {
  triedSubmit.value = true;
  if (!form.value.name?.trim()) { toast.error("Name is required"); return; }
  saving.value = true;
  try {
    const payload = {
      name: form.value.name?.trim(),
      phone: form.value.phone?.trim() || null,
      email: form.value.email?.trim() || null,
      address: form.value.address?.trim() || null,
      is_active: !!form.value.is_active,
    };
    if (editing.value) await updateSupplier(editing.value.id, payload);
    else await createSupplier(payload);
    toast.success(editing.value ? "Supplier updated" : "Supplier created");
    closeModal();
    resetForm();
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save supplier");
  } finally {
    saving.value = false;
  }
}

async function removeSupplier(r) {
  if (!confirm(`Delete supplier "${r.name}"? This cannot be undone.`)) return;
  try {
    await deleteSupplier(r.id);
    toast.success("Supplier deleted");
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete supplier");
  }
}

function clearFilters() {
  filters.value = { q: "", active: "1" };
}

let t = null;
watch(
  () => [filters.value.q, filters.value.active],
  () => {
    clearTimeout(t);
    t = setTimeout(() => load(false), 200);
  }
);

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-store-3-line"></i><span>Purchasing</span>
          </div>
          <h1 class="hero-title">Suppliers</h1>
          <p class="hero-sub">
            Vendors you buy from — for raw materials, services, or supplies. Disable a supplier to stop new POs without losing history.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button v-can="'purchases:manage'" class="btn btn-pill btn-cta" @click="openCreate">
            <i class="ri-add-line"></i><span>New Supplier</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon tone-primary"><i class="ri-store-3-line"></i></div>
          <div>
            <div class="stat-label">Suppliers</div>
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
          <div class="stat-icon tone-info"><i class="ri-mail-line"></i></div>
          <div>
            <div class="stat-label">With email</div>
            <div class="stat-value">{{ summary.withEmail }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-warning"><i class="ri-phone-line"></i></div>
          <div>
            <div class="stat-label">With phone</div>
            <div class="stat-value">{{ summary.withPhone }}</div>
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
                <input v-model="filters.q" class="form-control ps-5" placeholder="Search supplier name…" />
              </div>
            </div>
            <div class="col-md-4">
              <label class="form-label">Status</label>
              <select v-model="filters.active" class="form-select">
                <option value="1">Active only</option>
                <option value="0">Inactive only</option>
                <option value="all">All</option>
              </select>
            </div>
            <div class="col-md-2 d-grid">
              <button class="btn btn-light" @click="clearFilters">
                <i class="ri-filter-off-line me-1"></i>Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading suppliers…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="rows.length === 0" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-store-3-line"></i></div>
        <h5 class="mt-2 mb-1">No suppliers found</h5>
        <p class="text-muted mb-3">Add your first vendor to start sending POs and tracking prices.</p>
        <div>
          <button v-can="'purchases:manage'" class="btn btn-primary" @click="openCreate">
            <i class="ri-add-line me-1"></i> New supplier
          </button>
        </div>
      </div>

      <!-- ============== Suppliers table ============== -->
      <div v-else class="card data-card">
        <div class="card-body p-0">
          <div class="table-responsive data-scroll">
            <table class="table align-middle mb-0 sup-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th style="width: 160px">Phone</th>
                  <th style="width: 220px">Email</th>
                  <th>Address</th>
                  <th style="width: 110px" class="text-center">Status</th>
                  <th style="width: 80px" class="text-end"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in rows"
                  :key="r.id"
                  class="sup-row"
                  :class="{ 'is-inactive': !r.is_active }"
                  @click="openEdit(r)"
                >
                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <div class="sup-avatar" :style="{ '--accent': colorFor(r.name) }">
                        {{ initialsOf(r.name) }}
                      </div>
                      <div class="min-w-0">
                        <div class="sup-name">{{ r.name }}</div>
                        <div class="sup-sub">ID #{{ r.id }}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="contact-chip" v-if="r.phone">
                      <i class="ri-phone-line me-1"></i>{{ r.phone }}
                    </span>
                    <span v-else class="text-muted">—</span>
                  </td>
                  <td>
                    <span class="contact-chip" v-if="r.email" :title="r.email">
                      <i class="ri-mail-line me-1"></i>{{ r.email }}
                    </span>
                    <span v-else class="text-muted">—</span>
                  </td>
                  <td>
                    <span v-if="r.address" :title="r.address" class="addr-text">{{ r.address }}</span>
                    <span v-else class="text-muted">—</span>
                  </td>
                  <td class="text-center">
                    <span class="status-pill" :class="r.is_active ? 'pill-on' : 'pill-off'">
                      <span class="dot-mini"></span>{{ r.is_active ? 'Active' : 'Inactive' }}
                    </span>
                  </td>
                  <td class="text-end" @click.stop>
                    <button v-can="'purchases:manage'" class="row-icon-btn" title="Edit" @click="openEdit(r)">
                      <i class="ri-pencil-line"></i>
                    </button>
                    <button v-can="'purchases:manage'" class="row-icon-btn danger" title="Delete" @click="removeSupplier(r)">
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
    <div class="modal fade" id="supplierModal" tabindex="-1" aria-hidden="true" ref="modalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditMode ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isEditMode ? "Edit supplier" : "New supplier" }}</h5>
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
                  <label class="form-label">Name *</label>
                  <input v-model="form.name" class="form-control" placeholder="e.g. ABC Wholesale Ltd" required autocomplete="organization" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Phone</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-phone-line"></i></span>
                    <input v-model="form.phone" class="form-control" placeholder="Optional" autocomplete="tel" />
                  </div>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Email</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-mail-line"></i></span>
                    <input v-model="form.email" type="email" class="form-control" placeholder="Optional" autocomplete="email" />
                  </div>
                </div>
                <div class="col-12">
                  <label class="form-label">Address</label>
                  <input v-model="form.address" class="form-control" placeholder="Street, area, city (optional)" autocomplete="street-address" />
                </div>

                <div class="col-12">
                  <div class="toggle-card">
                    <div>
                      <div class="fw-semibold">Active</div>
                      <div class="small text-muted">Inactive suppliers can't be picked for new POs but their history stays.</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input id="supActive" v-model="form.is_active" class="form-check-input" type="checkbox" />
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
              {{ isEditMode ? "Update supplier" : "Create supplier" }}
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

/* ============= Hero (purchasing teal→cyan→blue) ============= */
.page-hero {
  position: relative;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem;
  padding: 1.5rem 1.75rem; margin-bottom: 1.25rem;
  border-radius: 22px;
  background: linear-gradient(135deg, #134e4a 0%, #0891b2 50%, #2563eb 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(8, 145, 178, 0.55);
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
.btn-cta { background: #fff !important; color: #0d9488 !important; font-weight: 700; border: none; box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3); }
.btn-cta:hover { background: #fff !important; color: #115e59 !important; }

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
.stat-icon.tone-primary { background: rgba(13,148,136,0.14); color: #0d9488; }
.stat-icon.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.stat-icon.tone-info { background: rgba(8,145,178,0.14); color: #0891b2; }
.stat-icon.tone-warning { background: rgba(245,158,11,0.18); color: #b45309; }
.stat-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ct-secondary-color, #64748b); }
.stat-value { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.05rem; color: var(--ct-body-color, #0f172a); }

/* ============= Toolbar / Empty ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(13,148,136,0.05) 0%, transparent 100%); }
.search-ico { position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%); color: var(--ct-secondary-color, #94a3b8); pointer-events: none; }
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(13,148,136,0.12); color: #0d9488; font-size: 1.6rem;
}

/* ============= Suppliers table ============= */
.data-card { overflow: hidden; }
.data-scroll {
  max-height: calc(100vh - 480px);
  min-height: 240px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.sup-table thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.sup-row { cursor: pointer; transition: background 0.15s ease; }
.sup-row:hover { background: rgba(13,148,136,0.04); }
.sup-row.is-inactive { opacity: 0.65; }

.sup-avatar {
  width: 38px; height: 38px;
  border-radius: 10px;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 0.78rem;
  color: var(--accent, #0d9488);
  background: color-mix(in srgb, var(--accent, #0d9488) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #0d9488) 28%, transparent);
  flex-shrink: 0;
  letter-spacing: -0.02em;
}
.sup-name { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 700; color: var(--ct-body-color, #0f172a); line-height: 1.25; }
.sup-sub { font-size: 0.7rem; color: var(--ct-secondary-color, #64748b); font-family: "JetBrains Mono", ui-monospace, monospace; }
.min-w-0 { min-width: 0; }

.contact-chip {
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
.addr-text {
  font-size: 0.82rem;
  color: var(--ct-secondary-color, #475569);
  display: inline-block;
  max-width: 320px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

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

.row-icon-btn {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
}
.row-icon-btn:hover { background: rgba(13,148,136,0.1); color: #0d9488; }
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
:deep(.modal-eyebrow) { font-size: 0.68rem; font-weight: 700; color: #0d9488; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.25rem; }
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

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
