<!-- src/views/menu/Combos.vue -->
<script setup>
import { ref, onMounted, computed, nextTick, reactive } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import SearchSelect from "../../components/SearchSelect.vue";

import {
  listMenuItems,
  listCombos,
  createCombo,
  updateCombo,
  deleteCombo,
  listComboItems,
  addComboItem,
  updateComboItem,
  deleteComboItem,
} from "../../api/menu";

const toast = useToast();

// ===== Combos state =====
const loading = ref(false);
const refreshing = ref(false);
const saving = ref(false);
const combos = ref([]);
const allItems = ref([]);

// filters
const filter = ref({
  available: "all",
  q: "",
});

// ===== Components state — keyed by comboId =====
const componentsByCombo = reactive({});  // { [cid]: [{ id, component_menu_item_id, component_qty, component_menu_item: {} }] }
const componentsLoading = reactive({});  // { [cid]: bool }
const componentBusy = reactive({});      // { [comboItemId]: bool }
const compAddForm = reactive({});        // { [cid]: { component_menu_item_id, component_qty } }

function emptyAddForm() {
  return { component_menu_item_id: null, component_qty: "1" };
}
function ensureAddForm(cid) {
  if (!compAddForm[cid]) compAddForm[cid] = emptyAddForm();
  return compAddForm[cid];
}
function getComps(cid) {
  return componentsByCombo[cid] || [];
}

// ===== Counts / helpers =====
const counts = computed(() => {
  const arr = combos.value || [];
  return {
    total: arr.length,
    available: arr.filter((x) => !!x.is_available).length,
    unavailable: arr.filter((x) => !x.is_available).length,
    componentsTotal: Object.values(componentsByCombo).reduce((a, arr) => a + (arr?.length || 0), 0),
  };
});

const isSearching = computed(() => !!filter.value.q.trim() || filter.value.available !== "all");

function money(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Image resolver
const apiBase = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";
function imageSrc(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${apiBase}${url}`;
}

// Quick lookup of full menu items (so we can fall back to image/price even if the
// /combo-items relation didn't eager-load them).
const itemById = computed(() => {
  const m = new Map();
  for (const it of allItems.value || []) m.set(it.id, it);
  return m;
});

// Resolve a component's display info from either the joined relation or the lookup
function compInfo(row) {
  const fromRow = row.component_menu_item || {};
  const fromAll = itemById.value.get(row.component_menu_item_id) || {};
  return {
    name: fromRow.name || fromAll.name || `Item #${row.component_menu_item_id}`,
    price: Number(fromRow.price ?? fromAll.price ?? 0),
    image_url: fromRow.image_url || fromAll.image_url || null,
  };
}

// Per-combo totals: sold-separately sum, combo price, savings, %, count
function comboTotals(c) {
  const comps = getComps(c.id);
  const priceSum = comps.reduce((acc, row) => {
    const info = compInfo(row);
    const qty = Number(row.component_qty) || 0;
    return acc + info.price * qty;
  }, 0);
  const comboPrice = Number(c.price) || 0;
  const savings = priceSum - comboPrice;
  const savingsPct = priceSum > 0 ? (savings / priceSum) * 100 : 0;
  return {
    priceSum,
    comboPrice,
    savings,
    savingsPct,
    count: comps.length,
  };
}

function normalizeParams() {
  const params = {};
  if (filter.value.available !== "all") params.available = filter.value.available;
  if (filter.value.q?.trim()) params.q = filter.value.q.trim();
  params.limit = 500;
  return params;
}

// ===== Load =====
async function loadAll(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    const [combosRes, itemsRes] = await Promise.all([
      listCombos(normalizeParams()),
      listMenuItems({ limit: 500, available: "all" }),
    ]);
    combos.value = combosRes;
    allItems.value = itemsRes;
    await loadAllComponents();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load combos");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function loadAllComponents() {
  for (const k of Object.keys(componentsByCombo)) delete componentsByCombo[k];
  await Promise.all(
    combos.value.map(async (c) => {
      componentsLoading[c.id] = true;
      try {
        componentsByCombo[c.id] = await listComboItems(c.id);
      } catch {
        componentsByCombo[c.id] = [];
      } finally {
        componentsLoading[c.id] = false;
      }
    })
  );
}

async function refreshCombo(cid) {
  componentsLoading[cid] = true;
  try {
    componentsByCombo[cid] = await listComboItems(cid);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to refresh components");
  } finally {
    componentsLoading[cid] = false;
  }
}

async function applyFilter() {
  loading.value = true;
  try {
    combos.value = await listCombos(normalizeParams());
    await loadAllComponents();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load combos");
  } finally {
    loading.value = false;
  }
}

function clearFilters() {
  filter.value = { available: "all", q: "" };
  applyFilter();
}

// ===== Combo CRUD modal =====
const comboModalEl = ref(null);
let comboModalInstance = null;

const editId = ref(null);
const triedSubmit = ref(false);

const form = ref({
  sku: "",
  name: "",
  description: "",
  price: "",
  is_available: true,
  category_id: null,
});

const isEditMode = computed(() => !!editId.value);

async function ensureComboModal() {
  if (comboModalInstance) return;
  try {
    const m = await import("bootstrap/js/dist/modal");
    comboModalInstance = new m.default(comboModalEl.value, { backdrop: "static", keyboard: false });
  } catch {
    comboModalInstance = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(comboModalEl.value, { backdrop: "static", keyboard: false })
      : null;
  }
}

function resetForm() {
  editId.value = null;
  triedSubmit.value = false;
  form.value = {
    sku: "",
    name: "",
    description: "",
    price: "",
    is_available: true,
    category_id: null,
  };
}

function setFormFromCombo(c) {
  editId.value = c.id;
  triedSubmit.value = false;
  form.value = {
    sku: c.sku ?? "",
    name: c.name ?? "",
    description: c.description ?? "",
    price: c.price ?? "",
    is_available: !!c.is_available,
    category_id: c.category_id ?? null,
  };
}

async function openCreate() {
  resetForm();
  await ensureComboModal();
  comboModalInstance?.show();
  await nextTick();
}

async function openEdit(c) {
  setFormFromCombo(c);
  await ensureComboModal();
  comboModalInstance?.show();
  await nextTick();
}

function closeComboModal() { comboModalInstance?.hide(); }

function validate() {
  triedSubmit.value = true;
  if (!String(form.value.name || "").trim()) {
    toast.error("Combo name is required.");
    return false;
  }
  const p = Number(form.value.price);
  if (!Number.isFinite(p) || p <= 0) {
    toast.error("Price must be a valid number greater than 0.");
    return false;
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const payload = {
      sku: String(form.value.sku || "").trim() || null,
      name: String(form.value.name || "").trim(),
      description: String(form.value.description || "").trim() || null,
      price: Number(form.value.price),
      is_available: !!form.value.is_available,
      category_id: form.value.category_id ?? null,
      is_combo: true,
    };

    if (editId.value) {
      await updateCombo(editId.value, payload);
      toast.success("Combo updated");
    } else {
      await createCombo(payload);
      toast.success("Combo created");
    }

    closeComboModal();
    resetForm();
    await applyFilter();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save combo");
  } finally {
    saving.value = false;
  }
}

async function removeCombo(c) {
  if (!confirm(`Delete combo "${c.name}"?`)) return;
  try {
    await deleteCombo(c.id);
    delete componentsByCombo[c.id];
    delete componentsLoading[c.id];
    delete compAddForm[c.id];
    toast.success("Combo deleted");
    await applyFilter();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete combo");
  }
}

async function toggleAvailable(c) {
  try {
    await updateCombo(c.id, { is_available: !c.is_available, is_combo: true });
    c.is_available = !c.is_available;
    toast.success(c.is_available ? "Marked available" : "Marked unavailable");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update");
  }
}

// ===== Inline component CRUD =====
const componentCandidates = computed(() =>
  (allItems.value || [])
    .filter((x) => !x.is_combo)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
);

const pickItemOptions = computed(() =>
  componentCandidates.value.map((it) => ({
    label: `${it.name} (K ${money(it.price)})`,
    value: it.id,
  }))
);

async function addComponent(comboId) {
  const form = ensureAddForm(comboId);
  const componentId = Number(form.component_menu_item_id);
  const qty = Number(form.component_qty);

  if (!componentId) return toast.error("Pick an item");
  if (!Number.isFinite(qty) || qty <= 0) return toast.error("Qty must be > 0");

  try {
    await addComboItem(comboId, {
      component_menu_item_id: componentId,
      component_qty: qty,
    });
    compAddForm[comboId] = emptyAddForm();
    await refreshCombo(comboId);
    toast.success("Component added");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to add component");
  }
}

async function saveComponentQty(comboId, row, qtyValue) {
  const qty = Number(qtyValue);
  if (!Number.isFinite(qty) || qty <= 0) return toast.error("Qty must be > 0");

  componentBusy[row.id] = true;
  try {
    await updateComboItem(comboId, row.id, { component_qty: qty });
    await refreshCombo(comboId);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update component");
  } finally {
    componentBusy[row.id] = false;
  }
}

async function removeComponent(comboId, row) {
  if (!confirm("Remove this component?")) return;
  componentBusy[row.id] = true;
  try {
    await deleteComboItem(comboId, row.id);
    await refreshCombo(comboId);
    toast.success("Removed");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to remove component");
  } finally {
    componentBusy[row.id] = false;
  }
}

onMounted(() => loadAll());
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
        <h1 class="hero-title">Combos</h1>
        <p class="hero-sub">
          Bundle deals with their components live on a single card — add items, edit quantities and toggle availability without leaving the page.
        </p>
      </div>

      <div class="page-hero-actions">
        <button class="btn btn-light btn-pill" @click="loadAll(false)" :disabled="refreshing || loading">
          <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
        </button>
        <button v-can="'menu:manage'" class="btn btn-pill btn-cta" @click="openCreate">
          <i class="ri-add-line"></i><span>New Combo</span>
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
              v-model="filter.q"
              type="search"
              class="form-control ps-5"
              placeholder="Search combo name, SKU, description…"
              @keyup.enter="applyFilter"
            />
          </div>

          <div class="seg-toggle" role="group">
            <button
              class="seg-btn"
              :class="{ active: filter.available === 'all' }"
              @click="filter.available = 'all'; applyFilter()"
              type="button"
            >All</button>
            <button
              class="seg-btn"
              :class="{ active: filter.available === '1' }"
              @click="filter.available = '1'; applyFilter()"
              type="button"
            >Available</button>
            <button
              class="seg-btn"
              :class="{ active: filter.available === '0' }"
              @click="filter.available = '0'; applyFilter()"
              type="button"
            >Unavailable</button>
          </div>

          <button class="btn btn-sm btn-light" v-if="filter.q || filter.available !== 'all'" @click="clearFilters">
            <i class="ri-close-line me-1"></i> Clear
          </button>

          <div class="ms-auto small text-muted d-flex gap-3">
            <span><strong>{{ counts.total }}</strong> combos</span>
            <span class="d-none d-sm-inline">•</span>
            <span><strong class="text-success">{{ counts.available }}</strong> available</span>
            <span class="d-none d-sm-inline">•</span>
            <span><strong class="text-warning">{{ counts.unavailable }}</strong> unavailable</span>
            <span class="d-none d-md-inline">•</span>
            <span class="d-none d-md-inline"><strong>{{ counts.componentsTotal }}</strong> components total</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border spinner-border-sm" role="status"></div>
        <div class="text-muted">Loading combos…</div>
      </div>
    </div>

    <!-- Empty — no combos -->
    <div v-else-if="!combos.length && !isSearching" class="card empty-card text-center py-5">
      <div class="empty-icon"><i class="ri-stack-line"></i></div>
      <h5 class="mt-2 mb-1">No combos yet</h5>
      <p class="text-muted mb-3">Create your first combo — Burger + Fries + Drink, Family Bundle…</p>
      <div>
        <button v-can="'menu:manage'" class="btn btn-primary" @click="openCreate">
          <i class="ri-add-line me-1"></i> Create first combo
        </button>
      </div>
    </div>

    <!-- Empty — search miss -->
    <div v-else-if="!combos.length && isSearching" class="card empty-card text-center py-5">
      <div class="empty-icon"><i class="ri-search-line"></i></div>
      <h5 class="mt-2 mb-1">No combos match</h5>
      <p class="text-muted mb-3">No results for the current filter.</p>
      <div>
        <button class="btn btn-light" @click="clearFilters">
          <i class="ri-close-line me-1"></i> Clear filters
        </button>
      </div>
    </div>

    <!-- ============== Combo cards (with inline components) ============== -->
    <div v-else class="row g-3">
      <div v-for="c in combos" :key="c.id" class="col-12 col-xl-4 d-flex">
        <div class="combo-card w-100" :class="{ 'is-unavailable': !c.is_available }">
          <!-- Header -->
          <div class="combo-head">
            <div class="combo-icon">
              <i class="ri-stack-line"></i>
            </div>
            <div class="combo-meta">
              <div class="combo-name" :title="c.name">{{ c.name }}</div>
              <div class="combo-sub-row">
                <span class="combo-price">K {{ money(c.price) }}</span>
                <span
                  class="status-chip"
                  :class="c.is_available ? 'on' : 'off'"
                  role="button"
                  :title="c.is_available ? 'Click to make unavailable' : 'Click to make available'"
                  @click="toggleAvailable(c)"
                >
                  <i :class="c.is_available ? 'ri-eye-line' : 'ri-eye-off-line'"></i>
                  {{ c.is_available ? 'Available' : 'Unavailable' }}
                </span>
                <span v-if="c.sku" class="meta-chip" :title="`SKU: ${c.sku}`">
                  <i class="ri-barcode-line me-1"></i>{{ c.sku }}
                </span>
                <span class="meta-chip subtle">
                  <i class="ri-list-check-2 me-1"></i>{{ getComps(c.id).length }} component{{ getComps(c.id).length === 1 ? '' : 's' }}
                </span>
              </div>
              <div v-if="c.description" class="combo-desc">{{ c.description }}</div>
            </div>
            <div class="combo-actions">
              <button v-can="'menu:manage'" class="row-icon-btn" title="Edit combo" @click="openEdit(c)">
                <i class="ri-pencil-line"></i>
              </button>
              <button v-can="'menu:manage'" class="row-icon-btn danger" title="Delete combo" @click="removeCombo(c)">
                <i class="ri-delete-bin-line"></i>
              </button>
            </div>
          </div>

          <!-- Inline components -->
          <div class="comps-section">
            <div v-if="componentsLoading[c.id]" class="comps-loading text-muted small">
              <span class="spinner-border spinner-border-sm me-1"></span> Loading components…
            </div>

            <div v-else-if="!getComps(c.id).length" class="comps-empty text-muted small">
              <i class="ri-inbox-line me-1"></i> No components yet — add the first one below.
            </div>

            <div v-else class="comps-list">
              <div
                v-for="row in getComps(c.id)"
                :key="row.id"
                class="comp-chip"
                :class="{ busy: componentBusy[row.id] }"
              >
                <div class="comp-thumb">
                  <img
                    v-if="compInfo(row).image_url"
                    :src="imageSrc(compInfo(row).image_url)"
                    :alt="compInfo(row).name"
                  />
                  <i v-else class="ri-restaurant-2-line"></i>
                </div>

                <div class="comp-meta">
                  <div class="comp-name" :title="compInfo(row).name">{{ compInfo(row).name }}</div>
                  <div class="comp-price-line">
                    <span class="comp-unit-price">K {{ money(compInfo(row).price) }}</span>
                    <span class="comp-x">×</span>
                    <span class="comp-q">{{ row.component_qty }}</span>
                    <span class="comp-eq">=</span>
                    <span class="comp-line-total">K {{ money(compInfo(row).price * Number(row.component_qty || 0)) }}</span>
                  </div>
                </div>

                <div class="comp-qty-wrap">
                  <input
                    class="comp-qty"
                    type="number"
                    step="1"
                    min="1"
                    :value="row.component_qty"
                    :disabled="componentBusy[row.id]"
                    @change="(e) => saveComponentQty(c.id, row, e.target.value)"
                  />
                </div>

                <button
                  class="comp-ico danger"
                  title="Remove from combo"
                  :disabled="componentBusy[row.id]"
                  @click="removeComponent(c.id, row)"
                >
                  <i class="ri-delete-bin-line"></i>
                </button>
              </div>
            </div>

            <!-- ============== Savings summary ============== -->
            <div v-if="getComps(c.id).length" class="combo-summary">
              <div class="summary-row">
                <span class="summary-label">
                  <i class="ri-shopping-bag-3-line me-1"></i>
                  Sold separately
                </span>
                <span class="summary-value">K {{ money(comboTotals(c).priceSum) }}</span>
              </div>
              <div class="summary-row">
                <span class="summary-label">
                  <i class="ri-stack-line me-1"></i>
                  Combo price
                </span>
                <span class="summary-value strong">K {{ money(comboTotals(c).comboPrice) }}</span>
              </div>
              <div class="summary-divider"></div>
              <div
                class="summary-savings"
                :class="{
                  positive: comboTotals(c).savings > 0,
                  neutral: comboTotals(c).savings === 0,
                  negative: comboTotals(c).savings < 0,
                }"
              >
                <span v-if="comboTotals(c).savings > 0">
                  <i class="ri-arrow-down-circle-line me-1"></i>
                  Customer saves <strong>K {{ money(comboTotals(c).savings) }}</strong>
                  <span class="pct">({{ comboTotals(c).savingsPct.toFixed(0) }}% off)</span>
                </span>
                <span v-else-if="comboTotals(c).savings === 0">
                  <i class="ri-equal-line me-1"></i>
                  Combo priced at cost — no savings
                </span>
                <span v-else>
                  <i class="ri-arrow-up-circle-line me-1"></i>
                  Combo costs <strong>K {{ money(Math.abs(comboTotals(c).savings)) }}</strong> more than sum of items
                </span>
              </div>
            </div>

            <!-- Inline add-component row -->
            <div class="comp-add-row">
              <div class="comp-add-picker">
                <SearchSelect
                  v-model="ensureAddForm(c.id).component_menu_item_id"
                  :options="pickItemOptions"
                  placeholder="Add an item…"
                  :clearable="true"
                  :searchable="true"
                />
              </div>
              <input
                v-model="ensureAddForm(c.id).component_qty"
                class="comp-add-qty"
                type="number"
                step="0.001"
                min="0.001"
                placeholder="Qty"
                @keydown.enter="addComponent(c.id)"
              />
              <button
                class="comp-add-btn"
                :disabled="!ensureAddForm(c.id).component_menu_item_id"
                @click="addComponent(c.id)"
              >
                <i class="ri-add-line"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
    <!-- /zoom wrapper -->

    <!-- ============== Combo Editor Modal ============== -->
    <div class="modal fade" id="comboModal" tabindex="-1" aria-hidden="true" ref="comboModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditMode ? "Edit" : "New" }}</div>
              <h5 class="modal-title">{{ isEditMode ? "Edit combo" : "New combo" }}</h5>
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
                <div class="col-12 col-md-8">
                  <label class="form-label">Name *</label>
                  <input v-model="form.name" class="form-control" placeholder="e.g. Family Combo" required autofocus />
                </div>

                <div class="col-12 col-md-4">
                  <label class="form-label">Price (K) *</label>
                  <input v-model="form.price" type="number" step="0.01" min="0.01" class="form-control" required />
                </div>

                <div class="col-12 col-md-6">
                  <label class="form-label">SKU</label>
                  <input v-model="form.sku" class="form-control" placeholder="Optional (e.g. COMBO01)" />
                </div>

                <div class="col-12 col-md-6 d-flex align-items-end">
                  <div class="form-check form-switch">
                    <input id="cAvail" v-model="form.is_available" class="form-check-input" type="checkbox" />
                    <label class="form-check-label" for="cAvail">Available immediately</label>
                  </div>
                </div>

                <div class="col-12">
                  <label class="form-label">Description</label>
                  <textarea v-model="form.description" class="form-control" rows="2" placeholder="Short, appetizing description…"></textarea>
                </div>

                <div class="col-12">
                  <div class="tip-card">
                    <i class="ri-lightbulb-flash-line tip-icon"></i>
                    <div class="small">
                      <div class="fw-semibold mb-1">Pro tip</div>
                      <div class="text-muted">
                        Keep names clear (“Burger + Fries + Drink”). Once saved, add components inline on the card — no extra clicks.
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
              {{ isEditMode ? "Update combo" : "Create combo" }}
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
  min-width: 240px;
  flex: 1 1 240px;
  max-width: 380px;
}
.search-ico {
  position: absolute;
  left: 0.85rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8);
  pointer-events: none;
}

/* Segmented availability filter */
.seg-toggle {
  display: inline-flex;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
}
.seg-btn {
  border: none;
  background: transparent;
  color: var(--ct-secondary-color, #64748b);
  padding: 0.35rem 0.85rem;
  border-radius: 7px;
  font-weight: 600;
  font-size: 0.78rem;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.seg-btn:hover { color: var(--ct-body-color, #1e293b); }
.seg-btn.active {
  background: var(--ct-card-bg, #fff);
  color: var(--ct-primary, #6366f1);
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
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

/* ============= Combo card ============= */
/* NOTE: no `overflow: hidden` — would clip the SearchSelect dropdown panel.
   The gradient top rail (::before) gets matching rounded top corners instead. */
.combo-card {
  position: relative;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  color: var(--ct-body-color, #1e293b);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.2s ease;
}
.combo-card:hover {
  border-color: rgba(99, 102, 241, 0.25);
  box-shadow: var(--ct-box-shadow, 0 6px 14px -8px rgba(15, 23, 42, 0.18));
}
.combo-card.is-unavailable { opacity: 0.7; }
.combo-card::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4px;
  background: linear-gradient(90deg, #f59e0b, #ec4899);
  border-radius: 18px 18px 0 0;
}
.combo-card.is-unavailable::before {
  background: linear-gradient(90deg, #94a3b8, #64748b);
}

.combo-head {
  padding: 1rem 1.1rem;
  display: grid;
  grid-template-columns: 56px 1fr auto;
  gap: 0.85rem;
  align-items: start;
  border-bottom: 1px dashed var(--ct-border-color, #e6e9ef);
}

.combo-icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 1.35rem;
  color: #fff;
  background: linear-gradient(135deg, #f59e0b, #ec4899);
  box-shadow: 0 8px 18px -8px rgba(236, 72, 153, 0.55);
  flex-shrink: 0;
}
.combo-card.is-unavailable .combo-icon {
  background: linear-gradient(135deg, #94a3b8, #64748b);
  box-shadow: 0 8px 18px -8px rgba(100, 116, 139, 0.5);
}

.combo-meta { min-width: 0; }
.combo-name {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 1.1rem;
  letter-spacing: -0.015em;
  color: var(--ct-body-color, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}
.combo-sub-row {
  margin-top: 0.45rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}
.combo-price {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 1rem;
  color: var(--ct-body-color, #0f172a);
  letter-spacing: -0.01em;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.18rem 0.6rem;
  border-radius: 999px;
  cursor: pointer;
  transition: filter 0.15s ease;
}
.status-chip:hover { filter: brightness(0.95); }
.status-chip.on {
  background: rgba(16, 185, 129, 0.14);
  color: #047857;
}
.status-chip.off {
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-body-color, #1e293b);
  border: 1px solid var(--ct-border-color, #e6e9ef);
}
.meta-chip.subtle {
  color: var(--ct-secondary-color, #64748b);
  background: transparent;
}

.combo-desc {
  margin-top: 0.5rem;
  font-size: 0.82rem;
  color: var(--ct-secondary-color, #64748b);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.combo-actions {
  display: flex;
  gap: 0.2rem;
  flex-shrink: 0;
}

.row-icon-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
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

/* ============= Inline components section ============= */
.comps-section {
  padding: 0.85rem 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex-grow: 1;
}

.comps-loading,
.comps-empty {
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
  padding: 0.7rem 0.85rem;
  text-align: center;
  background: var(--ct-tertiary-bg, #f8fafc);
}

.comps-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

/* Each component chip-row */
.comp-chip {
  display: grid;
  grid-template-columns: 48px 1fr 80px 32px;
  align-items: center;
  gap: 0.65rem;
  padding: 0.5rem 0.65rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
  transition: border-color 0.15s ease, opacity 0.2s ease;
}
.comp-chip:hover {
  border-color: rgba(99, 102, 241, 0.3);
}
.comp-chip.busy {
  opacity: 0.6;
  pointer-events: none;
}

.comp-thumb {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 1.05rem;
  color: var(--ct-primary, #6366f1);
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  overflow: hidden;
  flex-shrink: 0;
}
.comp-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.comp-meta { min-width: 0; }
.comp-name {
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--ct-body-color, #1e293b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}
.comp-price-line {
  margin-top: 0.18rem;
  font-size: 0.72rem;
  color: var(--ct-secondary-color, #64748b);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.comp-unit-price { color: var(--ct-secondary-color, #64748b); }
.comp-x, .comp-eq { opacity: 0.55; }
.comp-q { font-weight: 700; color: var(--ct-body-color, #1e293b); }
.comp-line-total {
  font-weight: 700;
  color: var(--ct-body-color, #1e293b);
}

.comp-qty-wrap {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.comp-qty {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  font-weight: 600;
  text-align: right;
  padding: 0.25rem 0.45rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 6px;
  background: var(--ct-card-bg, #fff);
  color: var(--ct-body-color, #1e293b);
  width: 100%;
}
.comp-qty:focus {
  outline: none;
  border-color: var(--ct-primary, #6366f1);
}

.comp-ico {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--ct-secondary-color, #94a3b8);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}
.comp-ico.danger:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; }

/* ============= Combo savings summary ============= */
.combo-summary {
  margin-top: 0.5rem;
  padding: 0.7rem 0.85rem;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(139, 92, 246, 0.04));
  border: 1px solid var(--ct-border-color, #e6e9ef);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.82rem;
  color: var(--ct-secondary-color, #64748b);
}
.summary-label {
  display: inline-flex;
  align-items: center;
  font-weight: 600;
}
.summary-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  color: var(--ct-body-color, #1e293b);
}
.summary-value.strong {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-size: 0.95rem;
  letter-spacing: -0.01em;
}

.summary-divider {
  height: 1px;
  background: var(--ct-border-color, #e6e9ef);
  margin: 0.15rem 0;
}

.summary-savings {
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  text-align: left;
}
.summary-savings strong {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.summary-savings .pct {
  margin-left: 0.35rem;
  opacity: 0.85;
  font-weight: 600;
}
.summary-savings.positive {
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
}
.summary-savings.neutral {
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
}
.summary-savings.negative {
  background: rgba(239, 68, 68, 0.1);
  color: #b91c1c;
}

/* ============= Inline add-component row ============= */
.comp-add-row {
  display: grid;
  grid-template-columns: 1fr 100px 36px;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.55rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
  margin-top: 0.25rem;
}
.comp-add-picker {
  position: relative;
  z-index: 5;
}
.comp-add-qty {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  text-align: right;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  color: var(--ct-body-color, #1e293b);
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
}
.comp-add-qty:focus {
  outline: none;
  border-color: var(--ct-primary, #6366f1);
}

.comp-add-btn {
  width: 36px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, #f59e0b, #ec4899);
  color: #fff;
  font-size: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: filter 0.15s ease, opacity 0.15s ease;
  box-shadow: 0 4px 10px -4px rgba(236, 72, 153, 0.5);
}
.comp-add-btn:hover { filter: brightness(1.05); }
.comp-add-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: var(--ct-tertiary-bg, #e2e8f0);
  color: var(--ct-secondary-color, #94a3b8);
  box-shadow: none;
}

/* SearchSelect dropdown — make it float above other cards */
:deep(.searchselect .dropdown-panel) {
  z-index: 2000 !important;
}
:deep(.searchselect) {
  position: relative;
  z-index: 5;
}

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

/* Compact responsive — collapse on narrow widths */
@media (max-width: 575.98px) {
  .comp-chip {
    grid-template-columns: 28px 1fr 80px 28px;
    gap: 0.3rem;
  }
  .comp-add-row {
    grid-template-columns: 1fr 80px 32px;
  }
}
</style>
