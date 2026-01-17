<!-- src/views/menu/Recipes.vue -->
<script setup>
import { ref, onMounted, computed, watch } from "vue";
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
const checking = ref(false);

const menuItems = ref([]);
const uoms = ref([]);
const inventoryItems = ref([]);

const selectedMenuItemId = ref(null);
const recipe = ref(null);

// snapshots for dirty-check
const savedSnapshot = ref("");

// LEFT filters (menu list)
const menuSearch = ref("");
const recipeFilter = ref("all"); // all | yes | no

// status map: { [menuId]: { has_recipe: bool, lines_count: number, checked: bool } }
const recipeStatusByMenuId = ref({});

// add line draft (UOM will be preloaded)
const newLine = ref({
  inventory_item_id: null,
  qty: "",
  uom_id: null,
});

// ---------- lookups ----------
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
  return (id) => m.get(Number(id)) || `Item #${id}`;
});

const uomCodeById = computed(() => {
  const m = new Map((uoms.value || []).map((u) => [u.id, u.code]));
  return (id) => m.get(Number(id)) || "";
});

const uomNameById = computed(() => {
  const m = new Map((uoms.value || []).map((u) => [u.id, u.name]));
  return (id) => m.get(Number(id)) || "";
});

// ---------- recipe state ----------
const lines = computed(() => recipe.value?.lines || []);

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
  return (recipe.value.lines || []).every((l) => {
    const invId = Number(l.inventory_item_id || 0);
    const uomId = Number(l.uom_id || 0);
    const qty = Number(l.qty || 0);
    return invId && uomId && qty > 0;
  });
});

const meta = computed(() => {
  const l = lines.value || [];
  const unique = new Set(l.map((x) => Number(x.inventory_item_id))).size;
  return { total: l.length, unique };
});

// ---------- menu list ----------
function statusFor(menuId) {
  return (
    recipeStatusByMenuId.value[menuId] || {
      has_recipe: false,
      lines_count: 0,
      checked: false,
    }
  );
}

const filteredMenuItems = computed(() => {
  const q = menuSearch.value.trim().toLowerCase();
  let arr = menuItems.value || [];

  if (q) arr = arr.filter((m) => (m.name || "").toLowerCase().includes(q));

  if (recipeFilter.value === "yes") {
    arr = arr.filter((m) => statusFor(m.id).checked && statusFor(m.id).has_recipe);
  } else if (recipeFilter.value === "no") {
    arr = arr.filter((m) => statusFor(m.id).checked && !statusFor(m.id).has_recipe);
  }

  return arr;
});

const selectedMenuItemName = computed(() => {
  const id = Number(selectedMenuItemId.value || 0);
  return menuItems.value.find((m) => Number(m.id) === id)?.name || (id ? `#${id}` : "");
});

// ---------- helpers ----------
function defaultUomId() {
  return uoms.value?.[0]?.id || null;
}

function ensureLineUom(line) {
  const id = Number(line?.uom_id || 0);
  if (id) return;
  const def = defaultUomId();
  if (def) line.uom_id = def;
}

function normalizeLoadedRecipeUoms() {
  if (!recipe.value) return;
  recipe.value.lines = recipe.value.lines || [];
  for (const l of recipe.value.lines) ensureLineUom(l);
}

function resetNewLine() {
  newLine.value = { inventory_item_id: null, qty: "", uom_id: defaultUomId() };
}

function setSnapshot() {
  savedSnapshot.value = payloadSnapshot.value || "";
}

// ---------- actions ----------
async function loadLookups() {
  menuItems.value = await listMenuItems({ limit: 500, available: "all" });
  uoms.value = await listUoms();
  inventoryItems.value = await listInventoryItems();

  // preload default UOM like Stock view
  if (!newLine.value.uom_id) newLine.value.uom_id = defaultUomId();
}

async function ensureRecipeForMenuItem(menuId) {
  loading.value = true;
  try {
    const r = await getRecipeByMenuItem(Number(menuId));
    if (r) {
      recipe.value = r;
      selectedMenuItemId.value = Number(menuId);

      // preload UOM on lines if missing (still changeable)
      normalizeLoadedRecipeUoms();

      setSnapshot();

      recipeStatusByMenuId.value[Number(menuId)] = {
        has_recipe: (recipe.value.lines || []).length > 0,
        lines_count: (recipe.value.lines || []).length,
        checked: true,
      };
      return;
    }

    recipe.value = await createRecipe({ menu_item_id: Number(menuId) });
    selectedMenuItemId.value = Number(menuId);

    recipe.value.lines = recipe.value.lines || [];
    normalizeLoadedRecipeUoms();

    toast.success("Recipe created (empty)");
    setSnapshot();

    recipeStatusByMenuId.value[Number(menuId)] = {
      has_recipe: false,
      lines_count: 0,
      checked: true,
    };
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load/create recipe");
  } finally {
    loading.value = false;
  }
}

async function refreshRecipeStatuses() {
  checking.value = true;
  const state = { ...recipeStatusByMenuId.value };
  try {
    for (const m of menuItems.value || []) {
      try {
        const r = await getRecipeByMenuItem(Number(m.id));
        const linesCount = r ? (r.lines || []).length : 0;
        state[m.id] = {
          has_recipe: !!r && linesCount > 0,
          lines_count: linesCount,
          checked: true,
        };
      } catch {
        state[m.id] = { has_recipe: false, lines_count: 0, checked: true };
      }
    }
    recipeStatusByMenuId.value = state;
  } finally {
    checking.value = false;
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

  const exists = (recipe.value.lines || []).some((l) => Number(l.inventory_item_id) === invId);
  if (exists) return toast.error("This ingredient already exists (edit it instead)");

  recipe.value.lines = recipe.value.lines || [];
  recipe.value.lines.unshift({
    id: 0,
    recipe_id: recipe.value.id,
    inventory_item_id: invId,
    qty,
    uom_id: uomId, // preloaded but changeable
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

    // if server returns any missing uoms, fill defaults (still changeable)
    normalizeLoadedRecipeUoms();

    toast.success("Recipe saved");
    setSnapshot();

    const mid = Number(selectedMenuItemId.value);
    recipeStatusByMenuId.value[mid] = {
      has_recipe: (recipe.value.lines || []).length > 0,
      lines_count: (recipe.value.lines || []).length,
      checked: true,
    };
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save recipe");
  } finally {
    saving.value = false;
  }
}

async function discardChanges() {
  if (!recipe.value || !isDirty.value) return;
  if (!confirm("Discard unsaved changes?")) return;
  await ensureRecipeForMenuItem(Number(selectedMenuItemId.value));
}

onMounted(async () => {
  loading.value = true;
  try {
    await loadLookups();
    resetNewLine(); // ensure default UOM set
    await refreshRecipeStatuses();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load recipes screen");
  } finally {
    loading.value = false;
  }
});

// keep default UOM in sync if uoms load later
watch(
  () => uoms.value.length,
  () => {
    if (!newLine.value.uom_id) newLine.value.uom_id = defaultUomId();
    if (recipe.value) normalizeLoadedRecipeUoms();
  }
);
</script>

<template>
  <DefaultLayout>
    <!-- Header -->
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Recipes</h4>
        <div class="text-muted small">
          Left: menu items (with recipe status). Right: recipe editor.
        </div>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-outline-secondary" :disabled="loading || checking" @click="refreshRecipeStatuses">
          <span v-if="checking"><span class="spinner-border spinner-border-sm me-1"></span> Checking…</span>
          <span v-else>Refresh Status</span>
        </button>
      </div>
    </div>

    <div class="row g-3" style="zoom: 80%;">
      <!-- LEFT: MENU LIST (col-md-4) -->
      <div class="col-12 col-md-4">
        <div class="card">
          <div class="card-body">
            <div class="d-flex align-items-center justify-content-between">
              <div class="fw-bold">Menu Items</div>
              <span class="badge bg-light text-dark border">{{ filteredMenuItems.length }} shown</span>
            </div>

            <div class="row g-2 mt-2 align-items-end">
              <div class="col-12">
                <label class="form-label">Search</label>
                <input v-model="menuSearch" class="form-control" placeholder="Type dish name..." />
              </div>

              <div class="col-12">
                <label class="form-label">Show</label>
                <select v-model="recipeFilter" class="form-select">
                  <option value="all">All</option>
                  <option value="yes">With recipe</option>
                  <option value="no">Missing recipe</option>
                </select>
              </div>
            </div>

            <div class="table-responsive mt-3" style="max-height: 62vh; overflow: auto;">
              <table class="table table-sm table-bordered align-middle mb-0">
                <thead class="bg-light">
                  <tr>
                    <th>Dish</th>
                    <th style="width: 110px">Recipe</th>
                    <th style="width: 90px" class="text-end">Lines</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="m in filteredMenuItems"
                    :key="m.id"
                    role="button"
                    :class="Number(selectedMenuItemId) === Number(m.id) ? 'table-primary' : ''"
                    @click="ensureRecipeForMenuItem(m.id)"
                  >
                    <td class="fw-semibold">{{ m.name }}</td>
                    <td>
                      <span v-if="statusFor(m.id).checked && statusFor(m.id).has_recipe" class="badge bg-success">
                        Yes
                      </span>
                      <span v-else class="badge bg-danger">No</span>
                    </td>
                    <td class="text-end">
                      <span class="badge bg-light text-dark border">{{ statusFor(m.id).lines_count || 0 }}</span>
                    </td>
                  </tr>

                  <tr v-if="filteredMenuItems.length === 0">
                    <td colspan="3" class="text-center text-muted">No menu items found</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="text-muted small mt-2">
              Click a dish to load/create its recipe.
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT: RECIPE EDITOR (col-md-8) -->
      <div class="col-12 col-md-8">
        <div class="card">
          <div class="card-header bg-light d-flex align-items-center justify-content-between flex-wrap gap-2">
            <div>
              <div class="fw-bold">Recipe Editor</div>
              <div class="text-muted small">
                <span v-if="selectedMenuItemId">
                  Dish: <b>{{ selectedMenuItemName }}</b>
                  <span v-if="recipe" class="ms-2">• {{ meta.total }} lines • {{ meta.unique }} unique</span>
                </span>
                <span v-else>Select a dish on the left.</span>
              </div>
            </div>

            <div class="d-flex gap-2 align-items-center">
              <span v-if="recipe" class="badge" :class="isDirty ? 'bg-warning text-dark' : 'bg-success'">
                {{ isDirty ? "Unsaved" : "Saved" }}
              </span>

              <button class="btn btn-light" :disabled="saving || !isDirty" @click="discardChanges">
                Discard
              </button>

              <button class="btn btn-primary" :disabled="!canSave" @click="saveAllLines">
                <span v-if="saving"><span class="spinner-border spinner-border-sm me-1"></span> Saving…</span>
                <span v-else>Save</span>
              </button>
            </div>
          </div>

          <div class="card-body">
            <div v-if="loading" class="d-flex align-items-center gap-2">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div>Loading…</div>
            </div>

            <div v-else-if="!recipe" class="text-center text-muted py-5">
              Select a dish on the left to view or create its recipe.
            </div>

            <template v-else>
              <!-- Add ingredient -->
              <div class="row g-2 align-items-end">
                <div class="col-md-6">
                  <label class="form-label">Inventory item</label>
                  <SearchSelect
                    v-model="newLine.inventory_item_id"
                    :options="inventoryOptions"
                    placeholder="Search inventory items…"
                    :clearable="true"
                    :searchable="true"
                  />
                </div>

                <div class="col-md-2">
                  <label class="form-label">Qty</label>
                  <input v-model="newLine.qty" type="number" step="0.000001" class="form-control" />
                </div>

                <div class="col-md-2">
                  <label class="form-label">UOM</label>
                  <!-- Preloaded UOM, changeable -->
                  <SearchSelect
                    v-model="newLine.uom_id"
                    :options="uomOptions"
                    placeholder="Pick UOM…"
                    :clearable="true"
                    :searchable="true"
                  />
                </div>

                <div class="col-md-2 d-grid">
                  <button class="btn btn-primary" :disabled="saving" @click="addLineLocal">Add</button>
                </div>
              </div>

              <!-- Lines -->
              <div class="table-responsive mt-3">
                <table class="table table-sm table-bordered align-middle mb-0">
                  <thead class="bg-light">
                    <tr>
                      <th>Ingredient</th>
                      <th style="width: 140px" class="text-end">Qty</th>
                      <th style="width: 220px">UOM</th>
                      <th style="width: 190px"></th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr v-for="(l, idx) in lines" :key="`${l.id || 0}-${idx}`">
                      <td>
                        <div class="fw-semibold">{{ invNameById(l.inventory_item_id) }}</div>
                        <div class="text-muted small">
                          {{ l.id ? "Saved" : "Local" }}
                          • {{ Number(l.qty || 0) }} {{ uomCodeById(l.uom_id) || "UOM" }}
                        </div>
                      </td>

                      <td class="text-end">
                        <input
                          v-model="l.qty"
                          type="number"
                          step="0.000001"
                          class="form-control form-control-sm text-end"
                        />
                      </td>

                      <td>
                        <!-- Defaulted if missing, but user can still change -->
                        <select v-model="l.uom_id" class="form-select form-select-sm">
                          <option v-for="u in uoms" :key="u.id" :value="u.id">
                            {{ u.code }} — {{ u.name }}
                          </option>
                        </select>
                      </td>

                      <td class="text-end">
                        <button class="btn btn-sm btn-outline-danger me-2" :disabled="saving" @click="removeLineLocal(idx)">
                          Remove
                        </button>
                        <button v-if="l.id" class="btn btn-sm btn-danger" :disabled="saving" @click="removeLineServer(l)">
                          Delete
                        </button>
                      </td>
                    </tr>

                    <tr v-if="lines.length === 0">
                      <td colspan="4" class="text-center text-muted">No ingredients yet</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="text-muted small mt-2">
                Save replaces all lines to keep the recipe consistent.
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
