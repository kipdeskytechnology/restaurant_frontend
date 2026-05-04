<!-- src/views/inventory/Items.vue -->
<script setup>
import { ref, computed, onMounted, watch, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import {
  listInventoryItems,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  listInventoryCategories,
} from "../../api/inventory";

import { listUoms } from "../../api/lookups";
import { listSuppliers } from "../../api/purchasing";

const toast = useToast();

const loading = ref(true);
const refreshing = ref(false);
const saving = ref(false);

const items = ref([]);
const categories = ref([]);
const uoms = ref([]);
const suppliers = ref([]);

const filters = ref({
  q: "",
  category_id: "",
  active: "all",
  track: "all",
});

const editing = ref(null);
const triedSubmit = ref(false);

const modalEl = ref(null);
let modalInstance = null;

const form = ref({
  category_id: "",
  sku: "",
  name: "",
  base_uom_id: "",
  track_stock: true,
  reorder_level: "",
  preferred_supplier_id: "",
  avg_cost: "",
  is_active: true,
});

const isEditMode = computed(() => !!editing.value);

const summary = computed(() => {
  const total = items.value.length;
  const active = items.value.filter((i) => i.is_active).length;
  const tracking = items.value.filter((i) => i.track_stock).length;
  return { total, active, tracking };
});

const uomNameById = computed(() => {
  const m = new Map();
  for (const u of uoms.value) m.set(u.id, `${u.code} - ${u.name}`);
  return m;
});

// Color the category chip stably from its name
const PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f59e0b", "#10b981", "#06b6d4", "#0ea5e9",
  "#14b8a6", "#84cc16",
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

async function loadAll() {
  loading.value = true;
  try {
    const [cats, uomList, supplierList] = await Promise.all([
      listInventoryCategories(),
      listUoms(),
      listSuppliers({ active: "1", limit: 500 }).catch(() => []),
    ]);
    categories.value = cats;
    uoms.value = uomList;
    suppliers.value = Array.isArray(supplierList) ? supplierList : [];

    if (!form.value.base_uom_id && uoms.value.length) {
      form.value.base_uom_id = uoms.value[0].id;
    }
    await loadItems();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load inventory data");
  } finally {
    loading.value = false;
  }
}

async function loadItems(showSpinner = false) {
  if (showSpinner) refreshing.value = true;
  const params = {
    q: filters.value.q || undefined,
    category_id: filters.value.category_id ? Number(filters.value.category_id) : undefined,
    active: filters.value.active,
    track: filters.value.track,
    limit: 500,
  };

  try {
    items.value = await listInventoryItems(params);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load items");
  } finally {
    refreshing.value = false;
  }
}

function normalizeNumber(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function resetForm() {
  editing.value = null;
  triedSubmit.value = false;
  form.value = {
    category_id: "",
    sku: "",
    name: "",
    base_uom_id: uoms.value?.[0]?.id || "",
    track_stock: true,
    reorder_level: "",
    preferred_supplier_id: "",
    avg_cost: "",
    is_active: true,
  };
}

function setFormFromRow(it) {
  editing.value = it;
  triedSubmit.value = false;
  form.value = {
    category_id: it.category_id ?? "",
    sku: it.sku ?? "",
    name: it.name ?? "",
    base_uom_id: it.base_uom_id,
    track_stock: !!it.track_stock,
    reorder_level: it.reorder_level ?? "",
    preferred_supplier_id: it.preferred_supplier_id ?? "",
    avg_cost: it.avg_cost ?? "",
    is_active: !!it.is_active,
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

async function openEdit(it) {
  setFormFromRow(it);
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

function closeModal() { modalInstance?.hide(); }

async function removeItem(it) {
  if (!confirm(`Delete item "${it.name}"? This cannot be undone.`)) return;
  try {
    await deleteInventoryItem(it.id);
    toast.success("Item deleted");
    await loadItems();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete item");
  }
}

async function save() {
  triedSubmit.value = true;
  saving.value = true;
  try {
    const payload = {
      category_id: form.value.category_id === "" ? null : Number(form.value.category_id),
      sku: form.value.sku?.trim() || null,
      name: form.value.name?.trim(),
      base_uom_id: Number(form.value.base_uom_id),
      track_stock: !!form.value.track_stock,
      reorder_level: normalizeNumber(form.value.reorder_level),
      preferred_supplier_id:
        form.value.preferred_supplier_id === "" ? null : Number(form.value.preferred_supplier_id),
      avg_cost: normalizeNumber(form.value.avg_cost),
      is_active: !!form.value.is_active,
    };

    if (!payload.name) { toast.error("Name is required"); return; }
    if (!payload.base_uom_id) { toast.error("Base UOM is required"); return; }

    if (editing.value) await updateInventoryItem(editing.value.id, payload);
    else await createInventoryItem(payload);

    toast.success(editing.value ? "Item updated" : "Item created");
    closeModal();
    resetForm();
    await loadItems();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save item");
  } finally {
    saving.value = false;
  }
}

function clearFilters() {
  filters.value = { q: "", category_id: "", active: "all", track: "all" };
}

let filterTimer = null;
watch(
  () => [
    filters.value.q,
    filters.value.category_id,
    filters.value.active,
    filters.value.track,
  ],
  () => {
    if (loading.value) return;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => loadItems(), 200);
  }
);

onMounted(loadAll);
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-archive-line"></i><span>Inventory</span>
          </div>
          <h1 class="hero-title">Inventory Items</h1>
          <p class="hero-sub">
            Master list of every raw material, ingredient, and supply you stock — with categories, units, suppliers, and reorder levels.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="loadItems(true)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button v-can="'inventory:manage'" class="btn btn-pill btn-cta" @click="openCreate()">
            <i class="ri-add-line"></i><span>New Item</span>
          </button>
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
                <input v-model="filters.q" class="form-control ps-5" placeholder="Search by name or SKU…" />
              </div>
            </div>

            <div class="col-md-3">
              <label class="form-label">Category</label>
              <select v-model="filters.category_id" class="form-select">
                <option value="">All categories</option>
                <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>

            <div class="col-md-2">
              <label class="form-label">Status</label>
              <select v-model="filters.active" class="form-select">
                <option value="all">All</option>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>

            <div class="col-md-2">
              <label class="form-label">Tracking</label>
              <select v-model="filters.track" class="form-select">
                <option value="all">All</option>
                <option value="1">Tracking</option>
                <option value="0">Not tracking</option>
              </select>
            </div>

            <div class="col-md-1 d-grid">
              <button class="btn btn-light" @click="clearFilters" title="Clear filters">
                <i class="ri-filter-off-line"></i>
              </button>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-3 small text-muted mt-2">
            <span><strong>{{ summary.total }}</strong> item{{ summary.total === 1 ? '' : 's' }}</span>
            <span class="d-none d-sm-inline">•</span>
            <span><strong class="text-success">{{ summary.active }}</strong> active</span>
            <span class="d-none d-sm-inline">•</span>
            <span><strong class="text-primary">{{ summary.tracking }}</strong> tracked</span>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading items…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="!items.length" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-archive-2-line"></i></div>
        <h5 class="mt-2 mb-1">No items found</h5>
        <p class="text-muted mb-3">Try adjusting your filters, or create a new inventory item.</p>
        <div>
          <button v-can="'inventory:manage'" class="btn btn-primary" @click="openCreate()">
            <i class="ri-add-line me-1"></i> New item
          </button>
        </div>
      </div>

      <!-- ============== Table ============== -->
      <div v-else class="card data-card">
        <div class="card-body p-0">
          <div class="table-responsive items-table-wrap data-scroll">
            <table class="table align-middle mb-0 items-table">
              <thead>
                <tr>
                  <th style="width: 90px">SKU</th>
                  <th>Item</th>
                  <th style="width: 200px">Category</th>
                  <th style="width: 160px">Base UOM</th>
                  <th style="width: 110px" class="text-center">Tracking</th>
                  <th style="width: 110px" class="text-center">Status</th>
                  <th style="width: 80px" class="text-end"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="it in items"
                  :key="it.id"
                  class="item-row"
                  @click="openEdit(it)"
                >
                  <td>
                    <span class="sku-chip" v-if="it.sku">{{ it.sku }}</span>
                    <span v-else class="text-muted">—</span>
                  </td>

                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <div
                        class="item-avatar"
                        :style="{ '--accent': colorFor(it.name) }"
                      >{{ initialsOf(it.name) }}</div>
                      <div class="min-w-0">
                        <div class="item-name">{{ it.name }}</div>
                        <div class="item-sub">ID #{{ it.id }}</div>
                      </div>
                    </div>
                  </td>

                  <td>
                    <span
                      v-if="it.category?.name"
                      class="cat-chip"
                      :style="{ '--accent': colorFor(it.category.name) }"
                    >
                      <span class="dot"></span>{{ it.category.name }}
                    </span>
                    <span v-else class="text-muted">—</span>
                  </td>

                  <td>
                    <span class="uom-chip" v-if="it.base_uom">
                      <strong>{{ it.base_uom.code }}</strong>
                      <span class="text-muted"> · {{ it.base_uom.name }}</span>
                    </span>
                    <span v-else class="text-muted">{{ uomNameById.get(it.base_uom_id) || it.base_uom_id }}</span>
                  </td>

                  <td class="text-center">
                    <span class="status-pill" :class="it.track_stock ? 'pill-on' : 'pill-off'">
                      <i :class="it.track_stock ? 'ri-check-line' : 'ri-close-line'"></i>
                      {{ it.track_stock ? 'Yes' : 'No' }}
                    </span>
                  </td>

                  <td class="text-center">
                    <span class="status-pill" :class="it.is_active ? 'pill-success' : 'pill-danger'">
                      <span class="dot-mini"></span>
                      {{ it.is_active ? 'Active' : 'Inactive' }}
                    </span>
                  </td>

                  <td class="text-end" @click.stop>
                    <button
                      v-can="'inventory:manage'"
                      class="row-icon-btn"
                      title="Edit"
                      @click="openEdit(it)"
                    >
                      <i class="ri-pencil-line"></i>
                    </button>
                    <button
                      v-can="'inventory:manage'"
                      class="row-icon-btn danger"
                      title="Delete"
                      @click="removeItem(it)"
                    >
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

    <!-- ============== Modal: Create / Edit ============== -->
    <div class="modal fade" id="inventoryItemModal" tabindex="-1" aria-hidden="true" ref="modalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditMode ? "Edit" : "New" }}</div>
              <h5 class="modal-title">{{ isEditMode ? "Edit inventory item" : "New inventory item" }}</h5>
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
                <div class="col-12">
                  <label class="form-label">Name *</label>
                  <input v-model="form.name" class="form-control" placeholder="e.g. Tomato, 2kg bag" required autofocus />
                </div>

                <div class="col-md-4">
                  <label class="form-label">SKU</label>
                  <input v-model="form.sku" class="form-control" placeholder="Optional" />
                </div>

                <div class="col-md-4">
                  <label class="form-label">Category</label>
                  <select v-model="form.category_id" class="form-select">
                    <option value="">— None —</option>
                    <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                  </select>
                </div>

                <div class="col-md-4">
                  <label class="form-label">Base UOM *</label>
                  <select v-model="form.base_uom_id" class="form-select" required>
                    <option v-for="u in uoms" :key="u.id" :value="u.id">{{ u.code }} — {{ u.name }}</option>
                  </select>
                </div>

                <div class="col-md-4">
                  <label class="form-label">Reorder level</label>
                  <input v-model="form.reorder_level" type="number" step="0.001" class="form-control" placeholder="e.g. 10" />
                </div>

                <div class="col-md-4">
                  <label class="form-label">Avg cost</label>
                  <input v-model="form.avg_cost" type="number" step="0.0001" class="form-control" placeholder="e.g. 12.5000" />
                </div>

                <div class="col-md-4">
                  <label class="form-label">Preferred supplier</label>
                  <select v-model="form.preferred_supplier_id" class="form-select">
                    <option value="">— Use cheapest active price —</option>
                    <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
                  </select>
                </div>

                <div class="col-md-6">
                  <div class="toggle-card">
                    <div>
                      <div class="fw-semibold">Track stock</div>
                      <div class="small text-muted">Movements update on-hand for this item.</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input class="form-check-input" type="checkbox" v-model="form.track_stock" id="trackStock" />
                    </div>
                  </div>
                </div>

                <div class="col-md-6">
                  <div class="toggle-card">
                    <div>
                      <div class="fw-semibold">Active</div>
                      <div class="small text-muted">Inactive items are hidden from POs and recipes.</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input class="form-check-input" type="checkbox" v-model="form.is_active" id="isActive" />
                    </div>
                  </div>
                </div>

                <div class="col-12">
                  <div class="tip-card">
                    <i class="ri-lightbulb-flash-line tip-icon"></i>
                    <div class="small">
                      <div class="fw-semibold mb-1">Pro tip</div>
                      <div class="text-muted">
                        Pin a preferred supplier to lock auto-PO suggestions to that vendor — otherwise the cheapest active price wins.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving" @click="resetForm">Cancel</button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              {{ isEditMode ? "Update item" : "Create item" }}
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
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 1.5rem 1.75rem;
  margin-bottom: 1.25rem;
  border-radius: 22px;
  background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 60%, #8b5cf6 100%);
  color: #fff;
  box-shadow: 0 20px 40px -20px rgba(14, 165, 233, 0.55);
  overflow: hidden;
  flex-wrap: wrap;
}
.page-hero::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(220px 140px at 90% 10%, rgba(255, 255, 255, 0.22), transparent 65%),
    radial-gradient(280px 180px at 0% 110%, rgba(255, 255, 255, 0.14), transparent 65%);
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
.page-hero-actions .btn-light { background: rgba(255,255,255,0.95); color: #1e293b; border: none; }
.btn-cta { background: #fff !important; color: #6366f1 !important; font-weight: 700; border: none; box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3); }
.btn-cta:hover { background: #fff !important; color: #4f46e5 !important; }

/* ============= Toolbar ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(99,102,241,0.04) 0%, transparent 100%); }
.search-ico {
  position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8); pointer-events: none;
}

/* ============= Empty ============= */
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); font-size: 1.6rem;
}

/* ============= Items table ============= */
.data-card { overflow: hidden; }
.data-scroll {
  /* Reserve space for hero (~140px) + toolbar (~110px) + page chrome */
  max-height: calc(100vh - 360px);
  min-height: 240px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb {
  background: rgba(100,116,139,0.3); border-radius: 999px;
}
.data-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.5); }

.items-table-wrap { border-radius: 16px; }
.items-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.item-row { cursor: pointer; transition: background 0.15s ease; }
.item-row:hover { background: rgba(99,102,241,0.04); }

.item-avatar {
  width: 36px; height: 36px; border-radius: 10px;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; font-size: 0.78rem;
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 24%, transparent);
  flex-shrink: 0;
}
.item-name { font-weight: 700; color: var(--ct-body-color, #0f172a); line-height: 1.25; }
.item-sub { font-size: 0.7rem; color: var(--ct-secondary-color, #64748b); font-weight: 600; }
.min-w-0 { min-width: 0; }

.sku-chip {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.75rem; font-weight: 600;
  padding: 0.2rem 0.5rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 6px;
  color: var(--ct-secondary-color, #64748b);
}

.cat-chip {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem; font-weight: 600;
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 22%, transparent);
}
.cat-chip .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent, #6366f1);
}

.uom-chip { font-size: 0.8rem; }

.status-pill {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem; font-weight: 700;
}
.status-pill i { font-size: 0.85rem; }
.dot-mini { width: 6px; height: 6px; border-radius: 50%; }

.pill-on { background: rgba(99,102,241,0.1); color: #4f46e5; }
.pill-off { background: rgba(100,116,139,0.12); color: #64748b; }
.pill-success { background: rgba(16,185,129,0.14); color: #047857; }
.pill-success .dot-mini { background: #10b981; }
.pill-danger { background: rgba(239,68,68,0.14); color: #b91c1c; }
.pill-danger .dot-mini { background: #ef4444; }

.row-icon-btn {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
}
.row-icon-btn:hover { background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); }
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
}
</style>
