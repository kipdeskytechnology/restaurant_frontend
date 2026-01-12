<!-- src/views/menu/Combos.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
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

const loading = ref(false);
const saving = ref(false);

// data
const combos = ref([]);
const allItems = ref([]);

// filters (match Items.vue style)
const filter = ref({
  available: "all", // all|1|0
  q: "",
});

const counts = computed(() => {
  const arr = combos.value || [];
  return {
    total: arr.length,
    available: arr.filter((x) => !!x.is_available).length,
    unavailable: arr.filter((x) => !x.is_available).length,
  };
});

function money(v) {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function moneyNumber(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizeParams() {
  const params = {};
  if (filter.value.available !== "all") params.available = filter.value.available;
  if (filter.value.q?.trim()) params.q = filter.value.q.trim();
  params.limit = 500;
  return params;
}

async function loadAll() {
  loading.value = true;
  try {
    combos.value = await listCombos(normalizeParams());
    allItems.value = await listMenuItems({ limit: 500, available: "all" });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load combos");
  } finally {
    loading.value = false;
  }
}

async function applyFilter() {
  loading.value = true;
  try {
    combos.value = await listCombos(normalizeParams());
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

// ---------- Create/Edit modal ----------
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
  } catch (e) {
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

function closeComboModal() {
  comboModalInstance?.hide();
}

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

    await applyFilter();
    closeComboModal();
    resetForm();
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
    toast.success("Combo deleted");
    await applyFilter();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete combo");
  }
}

// ---------- Components modal ----------
const itemsModalEl = ref(null);
let itemsModalInstance = null;

const currentCombo = ref(null);
const comboItems = ref([]);
const compSaving = ref(false);

const compForm = ref({
  component_menu_item_id: null,
  component_qty: "1",
});

async function ensureItemsModal() {
  if (itemsModalInstance) return;
  try {
    const m = await import("bootstrap/js/dist/modal");
    itemsModalInstance = new m.default(itemsModalEl.value, { backdrop: "static", keyboard: false });
  } catch (e) {
    itemsModalInstance = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(itemsModalEl.value, { backdrop: "static", keyboard: false })
      : null;
  }
}

const componentCandidates = computed(() =>
  (allItems.value || [])
    .filter((x) => !x.is_combo)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
);

const pickItemOptions = computed(() =>
  componentCandidates.value.map((it) => ({
    label: `${it.name} (${money(it.price)})`,
    value: it.id,
  }))
);

async function openComponents(c) {
  currentCombo.value = c;
  comboItems.value = [];
  compForm.value = { component_menu_item_id: null, component_qty: "1" };

  compSaving.value = true;
  try {
    comboItems.value = await listComboItems(c.id);
    await ensureItemsModal();
    itemsModalInstance?.show();
    await nextTick();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load components");
    comboItems.value = [];
  } finally {
    compSaving.value = false;
  }
}

function closeItemsModal() {
  itemsModalInstance?.hide();
}

async function addComponent() {
  if (!currentCombo.value) return;

  const componentId = Number(compForm.value.component_menu_item_id);
  const qty = Number(compForm.value.component_qty);

  if (!componentId) return toast.error("Pick an item");
  if (!Number.isFinite(qty) || qty <= 0) return toast.error("Qty must be > 0");

  compSaving.value = true;
  try {
    await addComboItem(currentCombo.value.id, {
      component_menu_item_id: componentId,
      component_qty: qty,
    });
    comboItems.value = await listComboItems(currentCombo.value.id);
    compForm.value = { component_menu_item_id: null, component_qty: "1" };
    toast.success("Component added");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to add component");
  } finally {
    compSaving.value = false;
  }
}

async function saveComponentQty(row, qtyValue) {
  if (!currentCombo.value) return;

  const qty = Number(qtyValue);
  if (!Number.isFinite(qty) || qty <= 0) return toast.error("Qty must be > 0");

  compSaving.value = true;
  try {
    await updateComboItem(currentCombo.value.id, row.id, { component_qty: qty });
    comboItems.value = await listComboItems(currentCombo.value.id);
    toast.success("Updated");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update component");
  } finally {
    compSaving.value = false;
  }
}

async function removeComponent(row) {
  if (!currentCombo.value) return;
  if (!confirm("Remove this component?")) return;

  compSaving.value = true;
  try {
    await deleteComboItem(currentCombo.value.id, row.id);
    comboItems.value = await listComboItems(currentCombo.value.id);
    toast.success("Removed");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to remove component");
  } finally {
    compSaving.value = false;
  }
}

onMounted(loadAll);
</script>

<template>
  <DefaultLayout>
    <!-- Header (match Items.vue) -->
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Combos</h4>
        <div class="text-muted small">
          <strong>{{ counts.total }}</strong> combos •
          <span class="text-success fw-semibold">{{ counts.available }}</span> available •
          <span class="text-secondary fw-semibold">{{ counts.unavailable }}</span> unavailable
        </div>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-outline-primary" :disabled="loading" @click="applyFilter">
          <i class="ri-refresh-line me-1"></i> Refresh
        </button>
        <button class="btn btn-primary" @click="openCreate">
          <i class="ri-add-line me-1"></i> New Combo
        </button>
      </div>
    </div>

    <!-- Filters (match Items.vue) -->
    <div class="card menu-card mb-3" style="zoom: 80%;">
      <div class="card-body py-2">
        <div class="row g-2 align-items-end">
          <div class="col-md-6">
            <label class="form-label mb-1">Search</label>
            <div class="input-group">
              <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
              <input
                v-model="filter.q"
                class="form-control"
                placeholder="Search combo name, SKU, description…"
                @keyup.enter="applyFilter"
              />
              <button class="btn btn-outline-secondary" :disabled="loading" @click="applyFilter">
                <span v-if="loading">Searching…</span>
                <span v-else>Search</span>
              </button>
            </div>
          </div>

          <div class="col-md-4">
            <label class="form-label mb-1">Availability</label>
            <div class="segmented">
              <button
                class="seg-btn"
                :class="filter.available === 'all' ? 'active' : ''"
                @click="filter.available='all'; applyFilter()"
                type="button"
              >All</button>
              <button
                class="seg-btn"
                :class="filter.available === '1' ? 'active' : ''"
                @click="filter.available='1'; applyFilter()"
                type="button"
              >Available</button>
              <button
                class="seg-btn"
                :class="filter.available === '0' ? 'active' : ''"
                @click="filter.available='0'; applyFilter()"
                type="button"
              >Unavailable</button>
            </div>
          </div>

          <div class="col-md-2 d-flex gap-2">
            <button class="btn btn-light w-100" :disabled="loading" @click="clearFilters">
              Clear
            </button>
          </div>

          <div class="col-12">
            <div class="text-muted small">
              Showing <strong>{{ combos.length }}</strong> combo(s)
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading (match Items.vue) -->
    <div v-if="loading" class="card menu-card" style="zoom: 80%;">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading combos…</div>
      </div>
    </div>

    <!-- Empty (match Items.vue) -->
    <div v-else-if="combos.length === 0" class="card menu-card" style="zoom: 80%;">
      <div class="card-body text-center text-muted py-5">
        <div class="empty-emoji">🥤</div>
        <div class="mt-2">No combos found.</div>
        <button class="btn btn-primary mt-3" @click="openCreate">
          <i class="ri-add-line me-1"></i> Create first combo
        </button>
      </div>
    </div>

    <!-- Grid cards (match Items.vue card language) -->
    <div v-else class="row g-3" style="zoom: 80%;">
      <div v-for="c in combos" :key="c.id" class="col-12 col-md-6 col-xl-4 d-flex">
        <div class="combo-card w-100 h-100" role="button" tabindex="0" @click="openEdit(c)">
          <div class="combo-head">
            <div class="combo-photo">
              <div class="photo-placeholder">
                <i class="ri-restaurant-2-line"></i>
              </div>

              <span class="combo-status" :class="c.is_available ? 'on' : 'off'">
                <span class="dot" :class="c.is_available ? 'on' : 'off'"></span>
                {{ c.is_available ? "Available" : "Unavailable" }}
              </span>
            </div>

            <div class="combo-main">
              <div class="combo-top">
                <div class="combo-name" :title="c.name">{{ c.name }}</div>
                <div class="combo-price">{{ money(c.price) }}</div>
              </div>

              <div class="combo-meta">
                <span class="badge badge-soft-warning">Combo</span>

                <span class="chip" v-if="c.sku">
                  <i class="ri-barcode-line me-1"></i>{{ c.sku }}
                </span>

                <span class="chip">
                  <i class="ri-hashtag me-1"></i>{{ c.id }}
                </span>
              </div>

              <div class="combo-desc text-muted small">
                {{ c.description || "—" }}
              </div>
            </div>
          </div>

          <div class="combo-actions" @click.stop>
            <button class="btn btn-sm btn-outline-info" @click="openComponents(c)">
              <i class="ri-list-check-2 me-1"></i> Components
            </button>

            <div class="ms-auto d-flex gap-2">
              <button class="btn btn-sm btn-soft-primary" @click="openEdit(c)">
                <i class="ri-edit-line me-1"></i> Edit
              </button>
              <button class="btn btn-sm btn-soft-danger" @click="removeCombo(c)">
                <i class="ri-delete-bin-6-line me-1"></i> Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create/Edit Combo Modal (match Items.vue modal look) -->
    <div class="modal fade" id="comboModal" tabindex="-1" aria-hidden="true" ref="comboModalEl" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content position-relative">
          <div class="modal-header bg-light">
            <div>
              <h4 class="modal-title mb-0">{{ isEditMode ? "Edit Combo" : "Create Combo" }}</h4>
              <div class="text-muted small">Build bundle deals & set components later</div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true" :disabled="saving"></button>
          </div>

          <!-- Saving overlay (match Items.vue) -->
          <div
            v-if="saving"
            class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style="background: rgba(var(--ct-body-bg-rgb),0.72); backdrop-filter: blur(2px); z-index: 10;"
          >
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body">
            <form @submit.prevent="save" novalidate :class="{ 'was-validated': triedSubmit }">
              <div class="row g-2">
                <div class="col-md-4">
                  <label class="form-label">SKU</label>
                  <input v-model="form.sku" class="form-control" placeholder="Optional (e.g. COMBO01)" />
                </div>

                <div class="col-md-4">
                  <label class="form-label">Price *</label>
                  <input v-model="form.price" type="number" step="0.01" class="form-control" required />
                  <div class="invalid-feedback">Price is required.</div>
                </div>

                <div class="col-md-4">
                  <div class="form-check form-switch mt-4">
                    <input id="cAvail" v-model="form.is_available" class="form-check-input" type="checkbox" />
                    <label class="form-check-label" for="cAvail">Available</label>
                  </div>
                </div>

                <div class="col-12">
                  <label class="form-label">Name *</label>
                  <input v-model="form.name" class="form-control" placeholder="e.g. Family Combo" required />
                  <div class="invalid-feedback">Name is required.</div>
                </div>

                <div class="col-12">
                  <label class="form-label">Description</label>
                  <textarea v-model="form.description" class="form-control" rows="3" placeholder="Short, appetizing description…"></textarea>
                </div>

                <div class="col-12">
                  <div class="alert alert-light border mb-0">
                    <div class="d-flex align-items-start gap-2">
                      <i class="ri-information-line mt-1"></i>
                      <div class="small">
                        <div class="fw-semibold">Restaurant tip</div>
                        <div class="text-muted">
                          Keep combo names clear (“Burger + Fries + Drink”), and price it as a deal.
                          Add components after saving.
                        </div>
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
              <span v-if="saving">Saving…</span>
              <span v-else>{{ isEditMode ? "Update Combo" : "Create Combo" }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Components Modal -->
    <div class="modal fade" id="comboItemsModal" tabindex="-1" aria-hidden="true" ref="itemsModalEl" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content position-relative">
          <div class="modal-header bg-light">
            <div>
              <h4 class="modal-title mb-0">Components</h4>
              <div class="text-muted small">
                {{ currentCombo?.name || "" }} — add items + quantities
              </div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true" :disabled="compSaving"></button>
          </div>

          <!-- Saving overlay (match Items.vue) -->
          <div
            v-if="compSaving"
            class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style="background: rgba(var(--ct-body-bg-rgb),0.72); backdrop-filter: blur(2px); z-index: 10;"
          >
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Working…</div>
            </div>
          </div>

          <div class="modal-body">
            <div class="card menu-card mb-3 allow-overflow">
              <div class="card-body py-2">
                <div class="row g-2 align-items-end">
                  <div class="col-md-8">
                    <label class="form-label mb-1">Pick item</label>
                    <SearchSelect
                      v-model="compForm.component_menu_item_id"
                      :options="pickItemOptions"
                      placeholder="Search menu items…"
                      :clearable="true"
                      :searchable="true"
                    />
                  </div>

                  <div class="col-md-2">
                    <label class="form-label mb-1">Qty</label>
                    <input v-model="compForm.component_qty" type="number" step="0.001" class="form-control" />
                  </div>

                  <div class="col-md-2 d-grid">
                    <button class="btn btn-primary" :disabled="compSaving || !currentCombo" @click="addComponent">
                      Add
                    </button>
                  </div>

                  <div class="col-12">
                    <div class="text-muted small">
                      Tip: changing qty below auto-saves.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="table-responsive">
              <table class="table table-sm table-centered table-bordered mb-0">
                <thead class="bg-light">
                  <tr>
                    <th>Item</th>
                    <th style="width: 160px">Qty</th>
                    <th style="width: 220px" class="text-end">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  <tr v-for="row in comboItems" :key="row.id">
                    <td class="fw-semibold">
                      {{ row.component_menu_item?.name || ("Item #" + row.component_menu_item_id) }}
                    </td>

                    <td>
                      <input
                        :value="row.component_qty"
                        class="form-control form-control-sm"
                        type="number"
                        step="0.001"
                        @change="(e) => saveComponentQty(row, e.target.value)"
                      />
                    </td>

                    <td class="text-end">
                      <button class="btn btn-sm btn-outline-danger" :disabled="compSaving" @click="removeComponent(row)">
                        Remove
                      </button>
                    </td>
                  </tr>

                  <tr v-if="comboItems.length === 0">
                    <td colspan="3" class="text-center text-muted py-4">No components yet.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="text-muted small mt-2">
              Removing a component does not delete the item — it only removes it from this combo.
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="compSaving" @click="closeItemsModal">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>

  </DefaultLayout>
</template>

<style scoped>
.empty-emoji { font-size: 44px; }

/* Reuse EXACT card shell from Items.vue */
.menu-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
}

/* Reuse segmented from Items.vue */
.segmented {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.seg-btn {
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-tertiary-bg);
  color: var(--ct-emphasis-color);
  border-radius: 12px;
  padding: 8px 10px;
  font-weight: 700;
  font-size: 12px;
  transition: transform .12s ease, border-color .12s ease;
}
.seg-btn:hover { transform: translateY(-1px); }
.seg-btn.active {
  border-color: rgba(var(--ct-primary-rgb), 0.35);
  background: rgba(var(--ct-primary-rgb), 0.12);
}

/* Combo card matches item-card structure + tokens */
.combo-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
  transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
  outline: none;
}
.combo-card:hover,
.combo-card:focus {
  transform: translateY(-2px);
  box-shadow: var(--ct-box-shadow-lg);
  border-color: rgba(var(--ct-primary-rgb), 0.30);
}

.combo-head {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 12px;
  padding: 12px;
  background: linear-gradient(
    180deg,
    rgba(var(--ct-primary-rgb), 0.10),
    rgba(var(--ct-primary-rgb), 0)
  );
}

.combo-photo {
  position: relative;
  width: 110px;
  height: 110px;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-tertiary-bg);
}

.photo-placeholder {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--ct-secondary-color);
  font-size: 22px;
}

.combo-status {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  border: 1px solid var(--ct-border-color-translucent);
  background: rgba(var(--ct-body-bg-rgb), 0.72);
  backdrop-filter: blur(2px);
  color: var(--ct-emphasis-color);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  border: 2px solid rgba(var(--ct-body-color-rgb), 0.25);
}
.dot.on { background: var(--ct-success); border-color: rgba(var(--ct-success-rgb), 0.35); }
.dot.off { background: var(--ct-gray-500); border-color: rgba(var(--ct-body-color-rgb), 0.25); }

.combo-main { min-width: 0; }

.combo-top {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 10px;
}
.combo-name {
  font-weight: 900;
  color: var(--ct-emphasis-color);
  line-height: 1.1;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.combo-price {
  font-weight: 900;
  font-size: 18px;
  color: var(--ct-emphasis-color);
  white-space: nowrap;
}

.combo-meta {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--ct-border-color-translucent);
  background: rgba(var(--ct-body-color-rgb), 0.06);
  color: var(--ct-emphasis-color);
  font-size: 11px;
  font-weight: 800;
}

.badge-soft-warning {
  background: rgba(var(--ct-warning-rgb), 0.18) !important;
  color: var(--ct-warning-text-emphasis) !important;
  border: 1px solid rgba(var(--ct-warning-rgb), 0.22);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 900;
}

.combo-desc {
  margin-top: 10px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 34px;
}

.combo-actions {
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--ct-tertiary-bg);
  border-top: 1px solid var(--ct-border-color-translucent);
  flex-wrap: wrap;
}

/* Theme-safe table headers inside components modal */
.table thead.bg-light th {
  background: var(--ct-tertiary-bg) !important;
  color: var(--ct-emphasis-color) !important;
}

.allow-overflow {
  overflow: visible !important;
}

/* Make SearchSelect dropdown float above everything (especially inside modals) */
:deep(.searchselect .dropdown-panel) {
  z-index: 2000 !important;
}

/* Optional: if any parent creates stacking contexts, this helps too */
:deep(.searchselect) {
  position: relative;
  z-index: 2000;
}
</style>
