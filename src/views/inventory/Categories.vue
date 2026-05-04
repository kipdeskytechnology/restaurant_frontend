<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import {
  listInventoryCategories,
  createInventoryCategory,
  updateInventoryCategory,
  deleteInventoryCategory,
} from "../../api/inventory";

const toast = useToast();

const loading = ref(true);
const refreshing = ref(false);
const saving = ref(false);

const rows = ref([]);
const q = ref("");

const modalEl = ref(null);
let modalInstance = null;

const editId = ref(null);
const triedSubmit = ref(false);

const form = ref({
  name: "",
  sort_order: "",
});

const isEditMode = computed(() => !!editId.value);
const isSearching = computed(() => !!q.value.trim());

const filtered = computed(() => {
  const qq = q.value.trim().toLowerCase();
  const list = rows.value || [];
  const base = qq
    ? list.filter((r) => String(r.name || "").toLowerCase().includes(qq))
    : list;
  return [...base].sort((a, b) => {
    const sa = a.sort_order ?? Number.POSITIVE_INFINITY;
    const sb = b.sort_order ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
});

const summary = computed(() => {
  const total = rows.value.length;
  const sorted = rows.value.filter((r) => r.sort_order != null).length;
  const unsorted = total - sorted;
  return { total, sorted, unsorted };
});

// Pick a stable accent color per category, derived from name
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

function resetForm() {
  editId.value = null;
  triedSubmit.value = false;
  form.value = { name: "", sort_order: "" };
}

function setFormFromRow(r) {
  editId.value = r.id;
  triedSubmit.value = false;
  form.value = {
    name: r.name ?? "",
    sort_order: r.sort_order ?? "",
  };
}

function normalizeInt(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function normalizePayload() {
  return {
    name: String(form.value.name || "").trim(),
    sort_order: normalizeInt(form.value.sort_order),
  };
}

function validate(payload) {
  triedSubmit.value = true;
  if (!payload.name) {
    toast.error("Category name is required.");
    return false;
  }
  return true;
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
    rows.value = await listInventoryCategories();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load categories");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function save() {
  const payload = normalizePayload();
  if (!validate(payload)) return;

  saving.value = true;
  try {
    if (editId.value) {
      await updateInventoryCategory(editId.value, payload);
      toast.success("Category updated");
    } else {
      await createInventoryCategory(payload);
      toast.success("Category created");
    }
    closeModal();
    resetForm();
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save category");
  } finally {
    saving.value = false;
  }
}

async function removeRow(r) {
  if (!confirm(`Delete category "${r.name}"?`)) return;
  try {
    await deleteInventoryCategory(r.id);
    toast.success("Category deleted");
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete category");
  }
}

function clearSearch() { q.value = ""; }
function stop(e) { e?.stopPropagation?.(); }
function onKeyOpen(e, r) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openEdit(r);
  }
}

onMounted(() => load());
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-archive-line"></i>
            <span>Inventory</span>
          </div>
          <h1 class="hero-title">Inventory Categories</h1>
          <p class="hero-sub">
            Group your raw materials and supplies — flour, beverages, packaging — for cleaner stock counts and faster purchasing. Lower sort order shows first.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button v-can="'inventory:manage'" class="btn btn-pill btn-cta" @click="openCreate()">
            <i class="ri-add-line"></i><span>New Category</span>
          </button>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
          <div class="d-flex flex-wrap gap-2 align-items-center">
            <div class="position-relative search-wrap">
              <i class="ri-search-line search-ico"></i>
              <input
                v-model="q"
                type="search"
                class="form-control ps-5"
                placeholder="Search categories…"
              />
            </div>
            <button class="btn btn-sm btn-light" v-if="q" @click="clearSearch">
              <i class="ri-close-line me-1"></i> Clear
            </button>

            <div class="ms-auto d-flex gap-3 small text-muted">
              <span><strong>{{ summary.total }}</strong> categor{{ summary.total === 1 ? 'y' : 'ies' }}</span>
              <span class="d-none d-sm-inline">•</span>
              <span><strong class="text-primary">{{ summary.sorted }}</strong> ordered</span>
              <span class="d-none d-sm-inline">•</span>
              <span v-if="summary.unsorted"><strong class="text-warning">{{ summary.unsorted }}</strong> unsorted</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading categories…</div>
        </div>
      </div>

      <!-- Empty — none -->
      <div v-else-if="!rows.length" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-archive-2-line"></i></div>
        <h5 class="mt-2 mb-1">No categories yet</h5>
        <p class="text-muted mb-3">Create your first inventory category — Produce, Dairy, Beverages…</p>
        <div>
          <button v-can="'inventory:manage'" class="btn btn-primary" @click="openCreate()">
            <i class="ri-add-line me-1"></i> Create first category
          </button>
        </div>
      </div>

      <!-- Empty — search -->
      <div v-else-if="isSearching && !filtered.length" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-search-line"></i></div>
        <h5 class="mt-2 mb-1">No categories match</h5>
        <p class="text-muted mb-3">No results for "<strong>{{ q }}</strong>".</p>
        <div>
          <button class="btn btn-light" @click="clearSearch">
            <i class="ri-close-line me-1"></i> Clear search
          </button>
        </div>
      </div>

      <!-- ============== Card grid ============== -->
      <div v-else class="cat-grid-wrap">
      <div class="cat-grid">
        <div
          v-for="r in filtered"
          :key="r.id"
          class="cat-card"
          :style="{ '--accent': colorFor(r.name) }"
          role="button"
          tabindex="0"
          @click="openEdit(r)"
          @keydown="onKeyOpen($event, r)"
        >
          <div class="cat-card-top">
            <div class="cat-avatar">{{ initialsOf(r.name) }}</div>
            <div class="cat-rank" :title="`Sort order: ${r.sort_order ?? '—'}`">
              <i class="ri-sort-asc me-1"></i>{{ r.sort_order ?? "—" }}
            </div>
          </div>

          <div class="cat-body">
            <div class="cat-name" :title="r.name">{{ r.name }}</div>
            <div class="cat-meta-line">
              <span class="dot"></span>
              <span>ID {{ r.id }}</span>
            </div>
          </div>

          <div class="cat-actions" @click="stop">
            <button v-can="'inventory:manage'" class="row-icon-btn" title="Edit" @click="openEdit(r)">
              <i class="ri-pencil-line"></i><span>Edit</span>
            </button>
            <button v-can="'inventory:manage'" class="row-icon-btn danger" title="Delete" @click="removeRow(r)">
              <i class="ri-delete-bin-line"></i><span>Delete</span>
            </button>
          </div>
        </div>

        <!-- Add card tile -->
        <button
          v-can="'inventory:manage'"
          class="cat-card cat-card-add"
          @click="openCreate()"
        >
          <div class="add-icon"><i class="ri-add-line"></i></div>
          <div class="add-label">Add category</div>
          <div class="add-sub">Group items by type</div>
        </button>
      </div>
      </div>
      <!-- /cat-grid-wrap -->
    </div>
    <!-- /zoom wrapper -->

    <!-- ============== Modal: Create / Edit ============== -->
    <div class="modal fade" id="inventoryCategoryModal" tabindex="-1" aria-hidden="true" ref="modalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditMode ? "Edit" : "New" }}</div>
              <h5 class="modal-title">{{ isEditMode ? "Edit category" : "New category" }}</h5>
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
                  <input
                    v-model="form.name"
                    class="form-control"
                    placeholder="e.g. Produce, Dairy, Beverages"
                    required
                    autocomplete="off"
                    autofocus
                  />
                </div>

                <div class="col-12">
                  <label class="form-label">Sort order</label>
                  <input
                    v-model="form.sort_order"
                    type="number"
                    step="1"
                    class="form-control"
                    placeholder="e.g. 10"
                  />
                  <div class="form-text">Lower numbers show first. Blank pushes to the end.</div>
                </div>

                <div class="col-12">
                  <div class="tip-card">
                    <i class="ri-lightbulb-flash-line tip-icon"></i>
                    <div class="small">
                      <div class="fw-semibold mb-1">Pro tip</div>
                      <div class="text-muted">
                        Keep categories broad — Produce, Dairy, Dry Goods. Use item attributes for finer detail so counts and reports stay manageable.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving" @click="resetForm">
              Cancel
            </button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              {{ isEditMode ? "Update category" : "Create category" }}
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
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.65rem;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 0.6rem;
}
.hero-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  letter-spacing: -0.025em;
  font-size: 1.85rem;
  margin: 0;
  color: #fff;
}
.hero-sub {
  color: rgba(255, 255, 255, 0.85);
  margin: 0.35rem 0 0;
  font-size: 0.9rem;
}
.page-hero-actions {
  position: relative;
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.btn-pill {
  border-radius: 999px !important;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.btn-pill i { font-size: 1rem; }
.page-hero-actions .btn-light {
  background: rgba(255, 255, 255, 0.95);
  color: #1e293b;
  border: none;
}
.page-hero-actions .btn-light:hover { background: #fff; color: #1e293b; }
.btn-cta {
  background: #fff !important;
  color: #6366f1 !important;
  font-weight: 700;
  border: none;
  box-shadow: 0 8px 16px -8px rgba(0, 0, 0, 0.3);
}
.btn-cta:hover { background: #fff !important; color: #4f46e5 !important; }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}

/* ============= Toolbar ============= */
.toolbar-card {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.04) 0%, transparent 100%);
}
.search-wrap {
  min-width: 260px;
  flex: 1 1 260px;
  max-width: 420px;
}
.search-ico {
  position: absolute;
  left: 0.85rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8);
  pointer-events: none;
}

/* ============= Empty ============= */
.empty-card {
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
}
.empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin: 0 auto;
  border-radius: 16px;
  background: rgba(99, 102, 241, 0.1);
  color: var(--ct-primary, #6366f1);
  font-size: 1.6rem;
}

/* ============= Card grid ============= */
/* Container scrolls — keeps the page header / hero / toolbar always in view */
.cat-grid-wrap {
  max-height: calc(100vh - 360px);
  min-height: 240px;
  overflow-y: auto;
  padding: 0.25rem 0.5rem 0.5rem 0;
  scrollbar-width: thin;
}
.cat-grid-wrap::-webkit-scrollbar { width: 8px; }
.cat-grid-wrap::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }
.cat-grid-wrap::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.5); }

.cat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.9rem;
}

.cat-card {
  position: relative;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 16px;
  padding: 1rem 1rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-height: 150px;
  cursor: pointer;
  outline: none;
  overflow: hidden;
  transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
}
.cat-card::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4px;
  background: var(--accent, #6366f1);
  opacity: 0.9;
}
.cat-card::after {
  content: "";
  position: absolute;
  right: -30px; top: -30px;
  width: 140px; height: 140px;
  border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--accent, #6366f1) 14%, transparent), transparent 70%);
  pointer-events: none;
}
.cat-card:hover,
.cat-card:focus {
  border-color: color-mix(in srgb, var(--accent, #6366f1) 50%, transparent);
  transform: translateY(-2px);
  box-shadow: 0 12px 24px -14px rgba(15, 23, 42, 0.22);
}

.cat-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  position: relative;
}

.cat-avatar {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 0.95rem;
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 26%, transparent);
  letter-spacing: -0.02em;
}

.cat-rank {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 700;
  font-size: 0.72rem;
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 22%, transparent);
}

.cat-body { min-width: 0; position: relative; }
.cat-name {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 1rem;
  color: var(--ct-body-color, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.25;
  letter-spacing: -0.01em;
}
.cat-meta-line {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.2rem;
  font-size: 0.72rem;
  color: var(--ct-secondary-color, #64748b);
  font-weight: 600;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent, #6366f1);
  flex-shrink: 0;
}

.cat-actions {
  display: flex;
  gap: 0.4rem;
  margin-top: auto;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--ct-border-color, #e6e9ef);
  position: relative;
}
.row-icon-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.row-icon-btn i { font-size: 0.95rem; }
.row-icon-btn:hover {
  background: rgba(99, 102, 241, 0.08);
  color: var(--ct-primary, #6366f1);
}
.row-icon-btn.danger:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

/* Add tile */
.cat-card-add {
  background: transparent;
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--ct-secondary-color, #64748b);
  padding: 1.5rem 1rem;
}
.cat-card-add::before { display: none; }
.cat-card-add::after { display: none; }
.cat-card-add:hover {
  border-color: var(--ct-primary, #6366f1);
  color: var(--ct-primary, #6366f1);
  background: rgba(99, 102, 241, 0.04);
  transform: translateY(-2px);
}
.add-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 1.4rem;
  background: rgba(99, 102, 241, 0.1);
  color: var(--ct-primary, #6366f1);
  margin-bottom: 0.25rem;
}
.add-label {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--ct-body-color, #0f172a);
}
.add-sub { font-size: 0.75rem; }

/* ============= Modal ============= */
:deep(.modal-modern) {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 22px !important;
  overflow: hidden;
  box-shadow: 0 30px 60px -20px rgba(15, 23, 42, 0.35);
  background: var(--ct-card-bg, #fff);
  color: var(--ct-body-color, #1e293b);
}
:deep(.modal-header-modern) {
  padding: 1.25rem 1.5rem 1rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
:deep(.modal-eyebrow) {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--ct-primary, #6366f1);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 0.25rem;
}
:deep(.modal-header-modern .modal-title) {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  letter-spacing: -0.02em;
  font-size: 1.25rem;
  color: var(--ct-body-color, #0f172a);
}
:deep(.modal-body-modern) {
  padding: 1.5rem;
  background: var(--ct-card-bg, #fff);
  color: var(--ct-body-color, #1e293b);
  max-height: calc(100vh - 240px);
  overflow-y: auto;
  scrollbar-width: thin;
}

.modal-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: rgba(var(--ct-card-bg-rgb, 255, 255, 255), 0.7);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tip-card {
  display: flex;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: rgba(99, 102, 241, 0.06);
  border: 1px solid rgba(99, 102, 241, 0.18);
  align-items: flex-start;
}
.tip-icon {
  font-size: 1.2rem;
  color: var(--ct-primary, #6366f1);
  flex-shrink: 0;
}
</style>
