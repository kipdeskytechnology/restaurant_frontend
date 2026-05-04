<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import {
  listMenuCategories,
  createMenuCategory,
  updateMenuCategory,
  deleteMenuCategory,
} from "../../api/menu";

const toast = useToast();

const loading = ref(false);
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
  station: "",
});

const STATION_PRESETS = ["BAR", "HOT_KITCHEN", "COLD_KITCHEN", "GRILL", "BAKERY", "DESSERT"];

// Visual style per station — color + icon. Anything else falls back to a neutral palette.
const STATION_STYLES = {
  BAR:           { color: "#06b6d4", icon: "ri-goblet-line",       label: "Bar" },
  HOT_KITCHEN:   { color: "#ef4444", icon: "ri-fire-line",         label: "Hot Kitchen" },
  COLD_KITCHEN:  { color: "#0ea5e9", icon: "ri-snowy-line",        label: "Cold Kitchen" },
  GRILL:         { color: "#dc2626", icon: "ri-restaurant-2-line", label: "Grill" },
  BAKERY:        { color: "#f59e0b", icon: "ri-cake-3-line",       label: "Bakery" },
  DESSERT:       { color: "#ec4899", icon: "ri-cup-line",          label: "Dessert" },
};
const UNASSIGNED_STYLE = { color: "#94a3b8", icon: "ri-question-line", label: "Unassigned" };

function styleFor(stationKey) {
  if (!stationKey) return UNASSIGNED_STYLE;
  return STATION_STYLES[stationKey] || {
    color: "#6366f1",
    icon: "ri-store-2-line",
    label: stationKey,
  };
}

const isEditMode = computed(() => !!editId.value);
const isSearching = computed(() => !!q.value.trim());

const filtered = computed(() => {
  const qq = q.value.trim().toLowerCase();
  if (!qq) return rows.value || [];
  return (rows.value || []).filter((r) =>
    String(r.name || "").toLowerCase().includes(qq) ||
    String(r.station || "").toLowerCase().includes(qq)
  );
});

// Group filtered categories by station — preserves preset order, then appends custom stations,
// then "Unassigned" at the end. Each station's items are sorted by sort_order (nulls last).
const stationColumns = computed(() => {
  const buckets = new Map();
  const seenOrder = []; // tracks insertion order for unknown stations

  for (const r of filtered.value) {
    const key = r.station || "__UNASSIGNED__";
    if (!buckets.has(key)) {
      buckets.set(key, []);
      if (!STATION_PRESETS.includes(key) && key !== "__UNASSIGNED__") {
        seenOrder.push(key);
      }
    }
    buckets.get(key).push(r);
  }

  const sortItems = (a, b) => {
    const sa = a.sort_order ?? Number.POSITIVE_INFINITY;
    const sb = b.sort_order ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return String(a.name || "").localeCompare(String(b.name || ""));
  };
  for (const arr of buckets.values()) arr.sort(sortItems);

  const cols = [];

  // Presets first (only if they have items)
  for (const k of STATION_PRESETS) {
    if (buckets.has(k)) {
      cols.push({ key: k, items: buckets.get(k), ...styleFor(k) });
    }
  }
  // Custom stations the user added
  for (const k of seenOrder) {
    cols.push({ key: k, items: buckets.get(k), ...styleFor(k) });
  }
  // Unassigned last
  if (buckets.has("__UNASSIGNED__")) {
    cols.push({ key: "__UNASSIGNED__", items: buckets.get("__UNASSIGNED__"), ...UNASSIGNED_STYLE });
  }

  return cols;
});

const summary = computed(() => {
  const total = rows.value.length;
  const stationsUsed = new Set(rows.value.map((r) => r.station).filter(Boolean));
  const unassigned = rows.value.filter((r) => !r.station).length;
  return { total, stations: stationsUsed.size, unassigned };
});

function resetForm() {
  editId.value = null;
  triedSubmit.value = false;
  form.value = { name: "", sort_order: "", station: "" };
}

function setFormFromRow(r) {
  editId.value = r.id;
  triedSubmit.value = false;
  form.value = {
    name: r.name ?? "",
    sort_order: r.sort_order ?? "",
    station: r.station ?? "",
  };
}

function normalizePayload() {
  const stationRaw = String(form.value.station || "").trim();
  return {
    name: String(form.value.name || "").trim(),
    sort_order: form.value.sort_order === "" ? null : Number(form.value.sort_order),
    station: stationRaw || null,
  };
}

function validate(payload) {
  triedSubmit.value = true;
  if (!payload.name) {
    toast.error("Category name is required.");
    return false;
  }
  if (payload.sort_order !== null && !Number.isFinite(payload.sort_order)) {
    toast.error("Sort order must be a number.");
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

async function openCreate(prefilledStation = "") {
  resetForm();
  if (prefilledStation && prefilledStation !== "__UNASSIGNED__") {
    form.value.station = prefilledStation;
  }
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
    rows.value = await listMenuCategories();
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
      await updateMenuCategory(editId.value, payload);
      toast.success("Category updated");
    } else {
      await createMenuCategory(payload);
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
    await deleteMenuCategory(r.id);
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
          <i class="ri-restaurant-2-line"></i>
          <span>Catalog</span>
        </div>
        <h1 class="hero-title">Menu Categories</h1>
        <p class="hero-sub">
          Organised by <strong>kitchen station</strong> — exactly how tickets route to your KDS. Lower sort order shows first inside each column.
        </p>
      </div>

      <div class="page-hero-actions">
        <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
          <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
        </button>
        <button v-can="'menu:manage'" class="btn btn-pill btn-cta" @click="openCreate()">
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
              placeholder="Search by category name or station…"
            />
          </div>
          <button class="btn btn-sm btn-light" v-if="q" @click="clearSearch">
            <i class="ri-close-line me-1"></i> Clear
          </button>

          <div class="ms-auto d-flex gap-3 small text-muted">
            <span><strong>{{ summary.total }}</strong> categor{{ summary.total === 1 ? 'y' : 'ies' }}</span>
            <span class="d-none d-sm-inline">•</span>
            <span><strong class="text-primary">{{ summary.stations }}</strong> station{{ summary.stations === 1 ? '' : 's' }}</span>
            <span class="d-none d-sm-inline">•</span>
            <span v-if="summary.unassigned"><strong class="text-warning">{{ summary.unassigned }}</strong> unassigned</span>
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

    <!-- Empty — no categories at all -->
    <div v-else-if="!rows.length" class="card empty-card text-center py-5">
      <div class="empty-icon"><i class="ri-folder-3-line"></i></div>
      <h5 class="mt-2 mb-1">No categories yet</h5>
      <p class="text-muted mb-3">Create your first category — Burgers, Drinks, Desserts…</p>
      <div>
        <button v-can="'menu:manage'" class="btn btn-primary" @click="openCreate()">
          <i class="ri-add-line me-1"></i> Create first category
        </button>
      </div>
    </div>

    <!-- Empty — search matches nothing -->
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

    <!-- ============== Kanban board ============== -->
    <div v-else class="kanban">
      <div
        v-for="col in stationColumns"
        :key="col.key"
        class="kanban-col"
        :style="{ '--col-color': col.color }"
      >
        <div class="kanban-col-head">
          <div class="kanban-station">
            <span class="station-icon">
              <i :class="col.icon"></i>
            </span>
            <div>
              <div class="station-name">{{ col.label }}</div>
              <div class="station-meta">
                {{ col.items.length }} categor{{ col.items.length === 1 ? 'y' : 'ies' }}
              </div>
            </div>
          </div>
          <button
            class="kanban-add"
            :title="`Add a category to ${col.label}`"
            @click="openCreate(col.key === '__UNASSIGNED__' ? '' : col.key)"
          >
            <i class="ri-add-line"></i>
          </button>
        </div>

        <div class="kanban-stack">
          <div
            v-for="r in col.items"
            :key="r.id"
            class="cat-row"
            role="button"
            tabindex="0"
            @click="openEdit(r)"
            @keydown="onKeyOpen($event, r)"
          >
            <div class="cat-rank" :title="`Sort order: ${r.sort_order ?? '—'}`">
              {{ r.sort_order ?? "—" }}
            </div>

            <div class="cat-body">
              <div class="cat-name" :title="r.name">{{ r.name }}</div>
              <div class="cat-meta-line">
                <span class="dot" :style="{ background: col.color }"></span>
                <span class="cat-id">ID {{ r.id }}</span>
              </div>
            </div>

            <div class="cat-row-actions" @click="stop">
              <button v-can="'menu:manage'" class="row-icon-btn" title="Edit" @click="openEdit(r)">
                <i class="ri-pencil-line"></i>
              </button>
              <button v-can="'menu:manage'" class="row-icon-btn danger" title="Delete" @click="removeRow(r)">
                <i class="ri-delete-bin-line"></i>
              </button>
            </div>
          </div>

          <button
            class="kanban-ghost"
            @click="openCreate(col.key === '__UNASSIGNED__' ? '' : col.key)"
          >
            <i class="ri-add-line me-1"></i> Add category
          </button>
        </div>
      </div>
    </div>
    </div>
    <!-- /zoom wrapper -->

    <!-- ============== Modal: Create / Edit ============== -->
    <div class="modal fade" id="categoryModal" tabindex="-1" aria-hidden="true" ref="modalEl" data-bs-backdrop="static">
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
                    placeholder="e.g. Burgers, Drinks, Desserts"
                    required
                    autocomplete="off"
                    autofocus
                  />
                </div>

                <div class="col-12 col-md-6">
                  <label class="form-label">Sort order</label>
                  <input
                    v-model="form.sort_order"
                    type="number"
                    class="form-control"
                    placeholder="e.g. 10"
                  />
                  <div class="form-text">Lower numbers show first. Blank pushes to the end.</div>
                </div>

                <div class="col-12 col-md-6">
                  <label class="form-label">Kitchen station</label>
                  <input
                    v-model="form.station"
                    list="stationPresets"
                    class="form-control"
                    placeholder="e.g. HOT_KITCHEN"
                    autocomplete="off"
                  />
                  <datalist id="stationPresets">
                    <option v-for="s in STATION_PRESETS" :key="s" :value="s" />
                  </datalist>
                  <div class="form-text">Routes items in this category to that KDS station.</div>
                </div>

                <div class="col-12">
                  <div class="tip-card">
                    <i class="ri-lightbulb-flash-line tip-icon"></i>
                    <div class="small">
                      <div class="fw-semibold mb-1">Pro tip</div>
                      <div class="text-muted">
                        Categories with the same station appear in the same Kanban column.
                        Use consistent station codes (BAR, HOT_KITCHEN…) so your KDS picker stays clean.
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
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #ec4899 100%);
  color: #fff;
  box-shadow: 0 20px 40px -20px rgba(99, 102, 241, 0.55);
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

/* ============= Kanban board ============= */
.kanban {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(280px, 1fr);
  gap: 1rem;
  overflow-x: auto;
  padding-bottom: 0.75rem;
  scroll-snap-type: x proximity;
  -webkit-overflow-scrolling: touch;
}
.kanban::-webkit-scrollbar { height: 8px; }
.kanban::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, 0.3);
  border-radius: 999px;
}

.kanban-col {
  scroll-snap-align: start;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  min-height: 240px;
  overflow: hidden;
  position: relative;
}
/* Color rail along the top of each column */
.kanban-col::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4px;
  background: var(--col-color);
}

.kanban-col-head {
  padding: 1rem 1rem 0.75rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-bottom: 1px dashed var(--ct-border-color, #e6e9ef);
}

.kanban-station {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}
.station-icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 1.1rem;
  color: var(--col-color);
  background: color-mix(in srgb, var(--col-color) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--col-color) 28%, transparent);
}
.station-name {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 0.95rem;
  letter-spacing: -0.01em;
  color: var(--ct-body-color, #0f172a);
  text-transform: capitalize;
}
.station-meta {
  font-size: 0.72rem;
  color: var(--ct-secondary-color, #64748b);
  font-weight: 600;
}

.kanban-add {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  border: 1px dashed color-mix(in srgb, var(--col-color) 35%, transparent);
  background: color-mix(in srgb, var(--col-color) 8%, transparent);
  color: var(--col-color);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.05rem;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease;
}
.kanban-add:hover {
  background: color-mix(in srgb, var(--col-color) 18%, transparent);
}
.kanban-add:active { transform: scale(0.94); }

.kanban-stack {
  padding: 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex-grow: 1;
}

/* ============= Category row card ============= */
.cat-row {
  position: relative;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  padding: 0.65rem 0.75rem 0.65rem 0.5rem;
  display: grid;
  grid-template-columns: 36px 1fr auto;
  gap: 0.6rem;
  align-items: center;
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
}
.cat-row:hover,
.cat-row:focus {
  border-color: color-mix(in srgb, var(--col-color) 45%, transparent);
  transform: translateY(-1px);
  box-shadow: 0 6px 14px -8px rgba(15, 23, 42, 0.18);
}

/* Color side-rail on each row */
.cat-row::before {
  content: "";
  position: absolute;
  left: 0; top: 12%; bottom: 12%;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--col-color);
  opacity: 0.85;
}

.cat-rank {
  margin-left: 0.25rem;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 0.78rem;
  color: var(--col-color);
  background: color-mix(in srgb, var(--col-color) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--col-color) 22%, transparent);
}

.cat-body { min-width: 0; }
.cat-name {
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--ct-body-color, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.25;
}
.cat-meta-line {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.15rem;
  font-size: 0.7rem;
  color: var(--ct-secondary-color, #64748b);
  font-weight: 600;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.cat-id { letter-spacing: 0.02em; }

/* Quick row actions — appear on hover/focus */
.cat-row-actions {
  display: flex;
  gap: 0.2rem;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.cat-row:hover .cat-row-actions,
.cat-row:focus-within .cat-row-actions {
  opacity: 1;
}

.row-icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.row-icon-btn:hover {
  background: rgba(99, 102, 241, 0.08);
  color: var(--ct-primary, #6366f1);
}
.row-icon-btn.danger:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

/* "Add category" ghost button at the end of each column */
.kanban-ghost {
  margin-top: 0.25rem;
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  background: transparent;
  color: var(--ct-secondary-color, #64748b);
  border-radius: 10px;
  padding: 0.5rem;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.kanban-ghost:hover {
  border-color: color-mix(in srgb, var(--col-color) 45%, transparent);
  color: var(--col-color);
  background: color-mix(in srgb, var(--col-color) 5%, transparent);
}

/* Always show row actions on touch devices */
@media (hover: none) {
  .cat-row-actions { opacity: 1; }
}

/* ============= Modal (POS modal-modern pattern) ============= */
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
