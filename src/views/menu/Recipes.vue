<!-- src/views/menu/Recipes.vue -->
<script setup>
import { ref, onMounted, computed } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import SearchSelect from "../../components/SearchSelect.vue";

import { listMenuItems } from "../../api/menu";
import {
  getRecipeByMenuItem,
  createRecipe,
  replaceRecipeLines,
  deleteRecipeLine,
} from "../../api/recipes";

import { listUoms } from "../../api/setupUom";
import { listInventoryItems } from "../../api/inventory";

const toast = useToast();

const loading = ref(false);
const saving = ref(false);

const menuItems = ref([]);
const uoms = ref([]);
const inventoryItems = ref([]);

const selectedMenuItemId = ref(null);
const recipe = ref(null);

// snapshots for dirty-check
const savedSnapshot = ref("");

// add line draft
const newLine = ref({
  inventory_item_id: null,
  qty: "",
  uom_id: null,
});

// ---------- lookups ----------
const menuItemOptions = computed(() =>
  (menuItems.value || [])
    .map((it) => ({ label: it.name, value: it.id }))
    .sort((a, b) => a.label.localeCompare(b.label))
);

const inventoryOptions = computed(() =>
  (inventoryItems.value || [])
    .map((inv) => ({
      label: inv.name || inv.code || `Item #${inv.id}`,
      value: inv.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
);

const uomOptions = computed(() =>
  (uoms.value || []).map((u) => ({
    label: `${u.code} — ${u.name}`,
    value: u.id,
  }))
);

const invNameById = computed(() => {
  const m = new Map(
    (inventoryItems.value || []).map((x) => [
      x.id,
      x.name || x.code || `Item #${x.id}`,
    ])
  );
  return (id) => m.get(id) || `Item #${id}`;
});

const uomCodeById = computed(() => {
  const m = new Map((uoms.value || []).map((u) => [u.id, u.code]));
  return (id) => m.get(id) || "";
});

// ---------- recipe state ----------
const lines = computed(() => recipe.value?.lines || []);

const meta = computed(() => {
  const l = lines.value || [];
  const unique = new Set(l.map((x) => Number(x.inventory_item_id))).size;
  return {
    total: l.length,
    unique,
  };
});

const payloadSnapshot = computed(() => {
  if (!recipe.value) return "";
  const l = (recipe.value.lines || []).map((x) => ({
    inventory_item_id: Number(x.inventory_item_id),
    qty: Number(x.qty),
    uom_id: Number(x.uom_id),
  }));
  return JSON.stringify(l);
});

const isDirty = computed(() => {
  if (!recipe.value) return false;
  return payloadSnapshot.value !== savedSnapshot.value;
});

const canSave = computed(() => {
  if (!recipe.value) return false;
  if (saving.value) return false;
  // basic validity: all qty > 0, has inv and uom
  return (recipe.value.lines || []).every((l) => {
    const invId = Number(l.inventory_item_id || 0);
    const uomId = Number(l.uom_id || 0);
    const qty = Number(l.qty || 0);
    return invId && uomId && qty > 0;
  });
});

// ---------- actions ----------
async function loadLookups() {
  menuItems.value = await listMenuItems({ limit: 500, available: "all" });
  uoms.value = await listUoms();
  inventoryItems.value = await listInventoryItems();
}

function resetNewLine() {
  newLine.value = { inventory_item_id: null, qty: "", uom_id: null };
}

function setSnapshot() {
  savedSnapshot.value = payloadSnapshot.value || "";
}

async function loadRecipeForMenuItem() {
  if (!selectedMenuItemId.value) {
    recipe.value = null;
    savedSnapshot.value = "";
    resetNewLine();
    return;
  }

  loading.value = true;
  try {
    const r = await getRecipeByMenuItem(Number(selectedMenuItemId.value));
    if (r) {
      recipe.value = r;
      setSnapshot();
      return;
    }

    recipe.value = await createRecipe({ menu_item_id: Number(selectedMenuItemId.value) });
    toast.success("Recipe created (empty)");
    setSnapshot();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load recipe");
  } finally {
    loading.value = false;
  }
}

function addLineLocal() {
  if (!recipe.value) return;

  const invId = Number(newLine.value.inventory_item_id || 0);
  const qty = Number(newLine.value.qty || 0);
  const uomId = Number(newLine.value.uom_id || 0);

  if (!invId) return toast.error("Pick an inventory item");
  if (!uomId) return toast.error("Pick a UOM");
  if (!qty || qty <= 0) return toast.error("Qty must be > 0");

  const exists = (recipe.value.lines || []).some(
    (l) => Number(l.inventory_item_id) === invId
  );
  if (exists) return toast.error("This ingredient already exists (edit it instead)");

  recipe.value.lines = recipe.value.lines || [];
  recipe.value.lines.unshift({
    id: 0, // local only
    recipe_id: recipe.value.id,
    inventory_item_id: invId,
    qty,
    uom_id: uomId,
  });

  resetNewLine();
}

function removeLineLocal(idx) {
  if (!recipe.value) return;
  recipe.value.lines.splice(idx, 1);
}

async function removeLineServer(line) {
  if (!recipe.value) return;
  if (!line.id) return;

  if (!confirm("Delete this line on the server?")) return;

  loading.value = true;
  try {
    await deleteRecipeLine(recipe.value.id, line.id);
    recipe.value.lines = (recipe.value.lines || []).filter((x) => x.id !== line.id);
    toast.success("Line deleted");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete line");
  } finally {
    loading.value = false;
  }
}

function moveUp(idx) {
  if (!recipe.value) return;
  if (idx <= 0) return;
  const arr = recipe.value.lines;
  const tmp = arr[idx - 1];
  arr[idx - 1] = arr[idx];
  arr[idx] = tmp;
}

function moveDown(idx) {
  if (!recipe.value) return;
  const arr = recipe.value.lines;
  if (idx >= arr.length - 1) return;
  const tmp = arr[idx + 1];
  arr[idx + 1] = arr[idx];
  arr[idx] = tmp;
}

async function saveAllLines() {
  if (!recipe.value) return;
  if (!canSave.value) return toast.error("Fix invalid lines before saving.");

  const payload = {
    lines: (recipe.value.lines || []).map((l) => ({
      inventory_item_id: Number(l.inventory_item_id),
      qty: Number(l.qty),
      uom_id: Number(l.uom_id),
    })),
  };

  saving.value = true;
  try {
    recipe.value = await replaceRecipeLines(recipe.value.id, payload);
    toast.success("Recipe saved");
    setSnapshot();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save recipe");
  } finally {
    saving.value = false;
  }
}

async function discardChanges() {
  if (!recipe.value) return;
  if (!isDirty.value) return;

  if (!confirm("Discard unsaved changes?")) return;
  await loadRecipeForMenuItem();
}

function clearSelection() {
  selectedMenuItemId.value = null;
  recipe.value = null;
  savedSnapshot.value = "";
  resetNewLine();
}

onMounted(async () => {
  loading.value = true;
  try {
    await loadLookups();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load lookups");
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DefaultLayout>
    <!-- Header -->
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Recipes</h4>
        <div class="text-muted small">
          Build ingredient recipes for consistent costing & stock usage.
          <span v-if="recipe" class="ms-2">
            • <strong>{{ meta.total }}</strong> lines • <strong>{{ meta.unique }}</strong> unique ingredients
          </span>
        </div>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-outline-primary" :disabled="loading || !selectedMenuItemId" @click="loadRecipeForMenuItem">
          <i class="ri-refresh-line me-1"></i> Refresh
        </button>
        <button class="btn btn-light" :disabled="loading" @click="clearSelection">
          Clear
        </button>
      </div>
    </div>

    <!-- Main layout -->
    <div class="row g-3" style="zoom: 80%;">
      <!-- LEFT PANE -->
      <div class="col-12 col-lg-4">
        <div class="card menu-card allow-overflow">
          <div class="card-body">
            <div class="d-flex align-items-start justify-content-between gap-2">
              <div>
                <div class="section-title">Dish</div>
                <div class="text-muted small">Select the menu item you want to recipe.</div>
              </div>
              <span v-if="recipe" class="pill" :class="isDirty ? 'pill-warning' : 'pill-green'">
                <i class="ri-checkbox-circle-line me-1" v-if="!isDirty"></i>
                <i class="ri-alert-line me-1" v-else></i>
                {{ isDirty ? "Unsaved" : "Saved" }}
              </span>
            </div>

            <div class="mt-3">
              <label class="form-label mb-1">Menu item</label>
              <SearchSelect
                v-model="selectedMenuItemId"
                :options="menuItemOptions"
                placeholder="Search menu items…"
                :clearable="true"
                :searchable="true"
              />
            </div>

            <div class="mt-3 d-flex gap-2">
              <button class="btn btn-primary w-100" :disabled="loading || !selectedMenuItemId" @click="loadRecipeForMenuItem">
                <i class="ri-book-2-line me-1"></i> Load Recipe
              </button>
            </div>

            <div class="divider my-3"></div>

            <div class="help-card">
              <div class="d-flex align-items-start gap-2">
                <i class="ri-information-line mt-1"></i>
                <div>
                  <div class="fw-bold">Chef workflow tip</div>
                  <div class="text-muted small">
                    Keep one standard unit per ingredient (e.g. grams or ml). It improves stock accuracy and recipe costing.
                  </div>
                </div>
              </div>
            </div>

            <div class="help-card mt-2">
              <div class="d-flex align-items-start gap-2">
                <i class="ri-scales-3-line mt-1"></i>
                <div>
                  <div class="fw-bold">Portioning rule</div>
                  <div class="text-muted small">
                    Record *actual usage per plate* (not purchase units). Example: “Cheddar 20g”, not “Cheddar 1 block”.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT PANE -->
      <div class="col-12 col-lg-8">
        <!-- Sticky action bar -->
        <div v-if="recipe" class="sticky-actions">
          <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <div class="section-title mb-0">Recipe Builder</div>
              <span class="text-muted small">Add ingredients, set qty + unit, reorder if needed.</span>
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-light" :disabled="saving || !isDirty" @click="discardChanges">
                Discard
              </button>
              <button class="btn btn-primary" :disabled="!canSave" @click="saveAllLines">
                <span v-if="saving"><span class="spinner-border spinner-border-sm me-1"></span> Saving…</span>
                <span v-else><i class="ri-save-3-line me-1"></i> Save</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Loading / Empty -->
        <div v-if="loading" class="card menu-card">
          <div class="card-body d-flex align-items-center gap-2">
            <div class="spinner-border" role="status" aria-hidden="true"></div>
            <div>Loading…</div>
          </div>
        </div>

        <div v-else-if="!recipe" class="card menu-card">
          <div class="card-body text-center text-muted py-5">
            <div class="empty-emoji">🧾</div>
            <div class="mt-2">Pick a menu item on the left to view/create its recipe.</div>
          </div>
        </div>

        <template v-else>
          <!-- Add line card (top) -->
          <div class="card menu-card allow-overflow">
            <div class="card-body">
              <div class="add-strip">
                <div class="row g-2 align-items-end">
                  <div class="col-md-6">
                    <label class="form-label mb-1">Inventory item</label>
                    <SearchSelect
                      v-model="newLine.inventory_item_id"
                      :options="inventoryOptions"
                      placeholder="Search inventory items…"
                      :clearable="true"
                      :searchable="true"
                    />
                  </div>

                  <div class="col-md-2">
                    <label class="form-label mb-1">Qty</label>
                    <input
                      v-model="newLine.qty"
                      type="number"
                      step="0.000001"
                      class="form-control"
                      placeholder="e.g. 0.25"
                    />
                  </div>

                  <div class="col-md-2">
                    <label class="form-label mb-1">UOM</label>
                    <SearchSelect
                      v-model="newLine.uom_id"
                      :options="uomOptions"
                      placeholder="Pick UOM…"
                      :clearable="true"
                      :searchable="true"
                    />
                  </div>

                  <div class="col-md-2 d-grid">
                    <button class="btn btn-primary" :disabled="saving" @click="addLineLocal">
                      <i class="ri-add-line me-1"></i> Add
                    </button>
                  </div>

                  <div class="col-12">
                    <div class="text-muted small">
                      Pro tip: add the “main cost drivers” first (protein, cheese, sauces) to keep recipes accurate.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Lines list -->
          <div class="card menu-card mt-3">
            <div class="card-body">
              <div v-if="lines.length === 0" class="comp-empty text-center text-muted">
                No ingredients yet — add your first ingredient above.
              </div>

              <div v-else class="d-grid gap-2">
                <div v-for="(l, idx) in lines" :key="`${l.id || 0}-${idx}`" class="line-row">
                  <div class="min-w-0">
                    <div class="line-title">
                      <span class="pill pill-subtle me-2">#{{ idx + 1 }}</span>
                      <span class="fw-bold" :title="invNameById(l.inventory_item_id)">
                        {{ invNameById(l.inventory_item_id) }}
                      </span>
                      <span v-if="l.id" class="pill pill-green ms-2">Saved</span>
                      <span v-else class="pill pill-gray ms-2">Local</span>
                    </div>

                    <div class="text-muted small mt-1">
                      {{ Number(l.qty || 0) }} {{ uomCodeById(l.uom_id) || "UOM" }} • Inventory ID: {{ l.inventory_item_id }}
                    </div>
                  </div>

                  <div class="controls">
                    <div class="control-block">
                      <span class="mini-label">Qty</span>
                      <input
                        v-model="l.qty"
                        type="number"
                        step="0.000001"
                        class="form-control form-control-sm"
                      />
                    </div>

                    <div class="control-block">
                      <span class="mini-label">UOM</span>
                      <select v-model="l.uom_id" class="form-select form-select-sm">
                        <option v-for="u in uoms" :key="u.id" :value="u.id">
                          {{ u.code }}
                        </option>
                      </select>
                    </div>

                    <div class="btn-group-vertical btn-group-sm reorder" role="group" aria-label="Reorder">
                      <button class="btn btn-outline-secondary" type="button" :disabled="idx===0" @click="moveUp(idx)">
                        <i class="ri-arrow-up-s-line"></i>
                      </button>
                      <button
                        class="btn btn-outline-secondary"
                        type="button"
                        :disabled="idx===lines.length-1"
                        @click="moveDown(idx)"
                      >
                        <i class="ri-arrow-down-s-line"></i>
                      </button>
                    </div>

                    <div class="d-flex gap-2">
                      <button class="btn btn-sm btn-outline-danger" :disabled="saving" @click="removeLineLocal(idx)">
                        Remove
                      </button>
                      <button
                        v-if="l.id"
                        class="btn btn-sm btn-soft-danger"
                        :disabled="saving"
                        @click="removeLineServer(l)"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="mt-3 d-flex justify-content-end">
                <button class="btn btn-primary" :disabled="!canSave" @click="saveAllLines">
                  <span v-if="saving"><span class="spinner-border spinner-border-sm me-1"></span> Saving…</span>
                  <span v-else><i class="ri-save-3-line me-1"></i> Save Recipe</span>
                </button>
              </div>

              <div class="text-muted small mt-2">
                “Save Recipe” replaces all lines server-side for consistency. Reorder affects display + kitchen clarity.
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
.empty-emoji { font-size: 44px; }

/* Core card shell (match Items.vue) */
.menu-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
}

/* Allow dropdowns to escape cards (important for SearchSelect) */
.allow-overflow { overflow: visible !important; }

.section-title {
  font-weight: 900;
  color: var(--ct-emphasis-color);
}

/* Nice divider */
.divider {
  height: 1px;
  background: var(--ct-border-color-translucent);
  opacity: 0.7;
}

/* Small help cards */
.help-card {
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-tertiary-bg);
  border-radius: 14px;
  padding: 12px;
}

/* Sticky top action bar on builder */
.sticky-actions {
  position: sticky;
  top: 14px;
  z-index: 9;
  border: 1px solid var(--ct-border-color-translucent);
  background: rgba(var(--ct-body-bg-rgb), 0.85);
  backdrop-filter: blur(6px);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 12px;
  box-shadow: var(--ct-box-shadow-sm);
}

/* Add strip */
.add-strip {
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-tertiary-bg);
  border-radius: 14px;
  padding: 12px;
}

/* Empty dashed */
.comp-empty {
  border: 1px dashed rgba(127, 127, 127, 0.35);
  border-radius: 12px;
  padding: 14px;
  background: var(--ct-secondary-bg);
  color: var(--ct-body-color);
}

/* Line row */
.line-row {
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-secondary-bg);
  border-radius: 14px;
  padding: 12px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.line-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.controls {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.control-block {
  width: 140px;
}

.reorder .btn {
  padding: 2px 8px;
}

/* Labels */
.mini-label {
  display: block;
  font-size: 11px;
  font-weight: 800;
  color: var(--ct-secondary-color);
  margin-bottom: 4px;
}

/* Pills */
.pill {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 999px;
  font-weight: 900;
  border: 1px solid var(--ct-border-color-translucent);
  background: rgba(var(--ct-body-color-rgb), 0.06);
  color: var(--ct-emphasis-color);
}
.pill-subtle {
  font-weight: 800;
  background: rgba(var(--ct-body-color-rgb), 0.08);
}
.pill-green {
  background: rgba(var(--ct-success-rgb), 0.14);
  border-color: rgba(var(--ct-success-rgb), 0.22);
  color: var(--ct-success);
}
.pill-gray {
  background: rgba(127, 127, 127, 0.10);
  border-color: var(--ct-border-color-translucent);
  color: var(--ct-secondary-color);
}
.pill-warning {
  background: rgba(var(--ct-warning-rgb), 0.16);
  border-color: rgba(var(--ct-warning-rgb), 0.24);
  color: var(--ct-warning);
}

/* Make SearchSelect overlay above everything */
:deep(.searchselect .dropdown-panel) {
  z-index: 2000 !important;
}

/* Theme-safe input-group inside SearchSelect */
:deep(.searchselect .dropdown-panel .input-group-text) {
  background-color: var(--ct-tertiary-bg);
  color: var(--ct-body-color);
  border-color: var(--ct-border-color-translucent);
}
</style>
