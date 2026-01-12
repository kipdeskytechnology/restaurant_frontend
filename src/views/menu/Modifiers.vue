<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import {
  listModifierGroups,
  createModifierGroup,
  updateModifierGroup,
  deleteModifierGroup,
  listModifierOptions,
  createModifierOption,
  updateModifierOption,
  deleteModifierOption,

  // Ingredient deltas (add these in src/api/modifiers.js)
  listOptionIngredientDeltas,
  upsertOptionIngredientDelta,
  deleteOptionIngredientDelta,
} from "../../api/modifiers";

// Lookups (for dropdowns)
import { listInventoryItems } from "../../api/inventory";
import { listUoms } from "../../api/setupUom";

const toast = useToast();

const loading = ref(true);
const savingGroup = ref(false);

const q = ref("");
const groups = ref([]);

const modalElGroup = ref(null);
const modalElOptions = ref(null);
const modalElDeltas = ref(null);

let modalGroup = null;
let modalOptions = null;
let modalDeltas = null;

const editGroupId = ref(null);
const triedSubmitGroup = ref(false);

const groupForm = ref({
  name: "",
  min_select: 0,
  max_select: 1,
});

const isEditGroup = computed(() => !!editGroupId.value);

// Options modal
const currentGroup = ref(null);
const options = ref([]);
const optionSaving = ref(false);

const optSearch = ref("");
const optionForm = ref({
  name: "",
  price_delta: "",
  is_default: false,
  is_active: true,
});

// Ingredient deltas modal
const currentOption = ref(null);
const deltas = ref([]);
const deltaLoading = ref(false);
const deltaSaving = ref(false);
const deltaSearch = ref("");

const deltaForm = ref({
  inventory_item_id: null, // selected via dropdown
  qty_delta: "",
  uom_id: null, // selected via dropdown
});

// Lookups (dropdown data)
const inventoryItems = ref([]);
const uoms = ref([]);
const lookupsLoading = ref(false);

function numInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function numMoneyOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function numDecOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function numIdOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

async function ensureGroupModal() {
  if (modalGroup) return;
  try {
    const m = await import("bootstrap/js/dist/modal");
    modalGroup = new m.default(modalElGroup.value, { backdrop: "static", keyboard: false });
  } catch {
    modalGroup = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(modalElGroup.value, { backdrop: "static", keyboard: false })
      : null;
  }
}
async function ensureOptionsModal() {
  if (modalOptions) return;
  try {
    const m = await import("bootstrap/js/dist/modal");
    modalOptions = new m.default(modalElOptions.value, { backdrop: "static", keyboard: false });
  } catch {
    modalOptions = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(modalElOptions.value, { backdrop: "static", keyboard: false })
      : null;
  }
}
async function ensureDeltasModal() {
  if (modalDeltas) return;
  try {
    const m = await import("bootstrap/js/dist/modal");
    modalDeltas = new m.default(modalElDeltas.value, { backdrop: "static", keyboard: false });
  } catch {
    modalDeltas = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(modalElDeltas.value, { backdrop: "static", keyboard: false })
      : null;
  }
}

async function loadGroups() {
  loading.value = true;
  try {
    groups.value = await listModifierGroups({
      q: q.value?.trim() || undefined,
      limit: 500,
    });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load modifier groups");
  } finally {
    loading.value = false;
  }
}

const counts = computed(() => ({
  total: groups.value.length,
}));

function resetGroupForm() {
  editGroupId.value = null;
  triedSubmitGroup.value = false;
  groupForm.value = { name: "", min_select: 0, max_select: 1 };
}

function setGroupFormFromRow(g) {
  editGroupId.value = g.id;
  triedSubmitGroup.value = false;
  groupForm.value = {
    name: g.name ?? "",
    min_select: g.min_select ?? 0,
    max_select: g.max_select ?? 1,
  };
}

function ruleLabel(g) {
  const min = Number(g.min_select ?? 0);
  const max = Number(g.max_select ?? 0);
  if (min === 0 && max === 1) return "Optional • single";
  if (min === 1 && max === 1) return "Required • single";
  if (min === 0 && max > 1) return `Optional • up to ${max}`;
  if (min >= 1 && max > 1) return `Pick ${min}–${max}`;
  if (min === 0 && max === 0) return "No selection";
  return `Min ${min} • Max ${max}`;
}

async function openCreateGroup() {
  resetGroupForm();
  await ensureGroupModal();
  modalGroup?.show();
  await nextTick();
}

async function openEditGroup(g) {
  setGroupFormFromRow(g);
  await ensureGroupModal();
  modalGroup?.show();
  await nextTick();
}

function closeGroupModal() {
  modalGroup?.hide();
}

function validateGroup(payload) {
  triedSubmitGroup.value = true;
  if (!payload.name) {
    toast.error("Name is required");
    return false;
  }
  if (payload.min_select < 0 || payload.max_select < 0) {
    toast.error("Min/Max must be >= 0");
    return false;
  }
  if (payload.max_select < payload.min_select) {
    toast.error("Max must be >= Min");
    return false;
  }
  return true;
}

async function saveGroup() {
  const payload = {
    name: (groupForm.value.name || "").trim(),
    min_select: numInt(groupForm.value.min_select, 0),
    max_select: numInt(groupForm.value.max_select, 1),
  };

  if (!validateGroup(payload)) return;

  savingGroup.value = true;
  try {
    if (editGroupId.value) {
      await updateModifierGroup(editGroupId.value, payload);
      toast.success("Group updated");
    } else {
      await createModifierGroup(payload);
      toast.success("Group created");
    }

    closeGroupModal();
    resetGroupForm();
    await loadGroups();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save group");
  } finally {
    savingGroup.value = false;
  }
}

async function removeGroup(g) {
  if (!confirm(`Delete modifier group "${g.name}"?`)) return;
  try {
    await deleteModifierGroup(g.id);
    toast.success("Deleted");
    await loadGroups();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete group");
  }
}

// ---------- Options ----------
const filteredOptions = computed(() => {
  const qq = optSearch.value.trim().toLowerCase();
  const arr = options.value || [];
  if (!qq) return arr;
  return arr.filter((o) => String(o.name || "").toLowerCase().includes(qq));
});

async function openOptions(g) {
  currentGroup.value = g;
  options.value = [];
  optSearch.value = "";
  optionForm.value = { name: "", price_delta: "", is_default: false, is_active: true };

  await ensureOptionsModal();
  modalOptions?.show();
  await nextTick();

  try {
    options.value = await listModifierOptions(g.id);
  } catch (e) {
    options.value = [];
    toast.error(e?.response?.data?.detail || "Failed to load options");
  }
}

function closeOptions() {
  modalOptions?.hide();
  currentGroup.value = null;
  options.value = [];
  optSearch.value = "";
}

async function addOption() {
  if (!currentGroup.value) return;

  const payload = {
    name: (optionForm.value.name || "").trim(),
    price_delta: numMoneyOrNull(optionForm.value.price_delta),
    is_default: !!optionForm.value.is_default,
    is_active: !!optionForm.value.is_active,
  };

  if (!payload.name) return toast.error("Option name is required");

  optionSaving.value = true;
  try {
    await createModifierOption(currentGroup.value.id, payload);
    options.value = await listModifierOptions(currentGroup.value.id);
    optionForm.value = { name: "", price_delta: "", is_default: false, is_active: true };
    toast.success("Option added");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to add option");
  } finally {
    optionSaving.value = false;
  }
}

async function saveOption(row, patch) {
  if (!currentGroup.value) return;
  optionSaving.value = true;
  try {
    await updateModifierOption(row.id, patch);
    options.value = await listModifierOptions(currentGroup.value.id);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update option");
  } finally {
    optionSaving.value = false;
  }
}

async function removeOption(row) {
  if (!confirm(`Delete option "${row.name}"?`)) return;

  optionSaving.value = true;
  try {
    await deleteModifierOption(row.id);
    options.value = await listModifierOptions(currentGroup.value.id);
    toast.success("Deleted");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete option");
  } finally {
    optionSaving.value = false;
  }
}

function moneyLabel(v) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n === 0) return "No price change";
  return n > 0 ? `+${n}` : `${n}`;
}

// ---------- Lookups ----------
function inventoryLabelById(id) {
  const x = inventoryItems.value.find((i) => i.id === id);
  if (!x) return "";
  const sku = x.sku ? ` • ${x.sku}` : "";
  return `${x.name || ""}${sku}`;
}
function uomLabelById(id) {
  const x = uoms.value.find((u) => u.id === id);
  return x?.name || x?.code || "";
}

async function loadLookupsIfNeeded() {
  if (lookupsLoading.value) return;
  const invOk = Array.isArray(inventoryItems.value) && inventoryItems.value.length > 0;
  const uomOk = Array.isArray(uoms.value) && uoms.value.length > 0;
  if (invOk && uomOk) return;

  lookupsLoading.value = true;
  try {
    // inventory items may support params; keep it safe
    const [inv, uu] = await Promise.all([
      listInventoryItems({ limit: 1000 }).catch(() => listInventoryItems()),
      listUoms(),
    ]);
    inventoryItems.value = Array.isArray(inv) ? inv : [];
    uoms.value = Array.isArray(uu) ? uu : [];
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load Inventory/UOM lookups");
  } finally {
    lookupsLoading.value = false;
  }
}

// ---------- Ingredient deltas ----------
const filteredDeltas = computed(() => {
  const qq = deltaSearch.value.trim().toLowerCase();
  const arr = deltas.value || [];
  if (!qq) return arr;

  return arr.filter((d) => {
    const inv = inventoryLabelById(d.inventory_item_id)?.toLowerCase() || "";
    const uom = uomLabelById(d.uom_id)?.toLowerCase() || "";
    const qty = String(d.qty_delta ?? "").toLowerCase();
    return `${inv} ${uom} ${qty}`.includes(qq);
  });
});

function resetDeltaForm() {
  deltaForm.value = { inventory_item_id: null, qty_delta: "", uom_id: null };
}

async function openIngredientDeltas(optionRow) {
  currentOption.value = optionRow;
  deltas.value = [];
  deltaSearch.value = "";
  resetDeltaForm();

  await ensureDeltasModal();
  modalDeltas?.show();
  await nextTick();

  // Load dropdowns (values), then deltas
  await loadLookupsIfNeeded();

  deltaLoading.value = true;
  try {
    deltas.value = await listOptionIngredientDeltas(optionRow.id);
  } catch (e) {
    deltas.value = [];
    toast.error(e?.response?.data?.detail || "Failed to load ingredient deltas");
  } finally {
    deltaLoading.value = false;
  }
}

async function refreshDeltas() {
  if (!currentOption.value) return;
  deltaLoading.value = true;
  try {
    deltas.value = await listOptionIngredientDeltas(currentOption.value.id);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to reload ingredient deltas");
  } finally {
    deltaLoading.value = false;
  }
}

function closeDeltas() {
  modalDeltas?.hide();
  currentOption.value = null;
  deltas.value = [];
  deltaSearch.value = "";
  resetDeltaForm();
}

async function saveDelta() {
  if (!currentOption.value) return;

  const inventory_item_id = numIdOrNull(deltaForm.value.inventory_item_id);
  const uom_id = numIdOrNull(deltaForm.value.uom_id);
  const qty_delta = numDecOrNull(deltaForm.value.qty_delta);

  // UI uses values (names) but backend still needs the ids behind the scenes.
  if (!inventory_item_id) return toast.error("Please choose an inventory item");
  if (!uom_id) return toast.error("Please choose a unit of measure");
  if (qty_delta === null) return toast.error("Qty Δ is required (can be negative)");

  deltaSaving.value = true;
  try {
    await upsertOptionIngredientDelta(currentOption.value.id, {
      inventory_item_id,
      uom_id,
      qty_delta,
    });
    toast.success("Saved");
    resetDeltaForm();
    await refreshDeltas();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save ingredient delta");
  } finally {
    deltaSaving.value = false;
  }
}

async function removeDelta(row) {
  if (!currentOption.value) return;
  const label = inventoryLabelById(row.inventory_item_id) || "this item";
  if (!confirm(`Delete ingredient delta for "${label}"?`)) return;

  deltaSaving.value = true;
  try {
    await deleteOptionIngredientDelta(currentOption.value.id, row.inventory_item_id);
    toast.success("Deleted");
    await refreshDeltas();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete ingredient delta");
  } finally {
    deltaSaving.value = false;
  }
}

onMounted(loadGroups);
</script>

<template>
  <DefaultLayout>
    <!-- Header -->
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Modifiers</h4>
        <div class="text-muted small">
          <strong>{{ counts.total }}</strong> groups • Build restaurant-style add-ons (sizes, extras, toppings)
        </div>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-primary" :disabled="loading" @click="loadGroups">
          <i class="ri-refresh-line me-1"></i> Refresh
        </button>
        <button class="btn btn-primary" @click="openCreateGroup">
          <i class="ri-add-line me-1"></i> New Group
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="card mb-3 mod-card" style="zoom: 80%;">
      <div class="card-body py-2">
        <div class="row g-2 align-items-end">
          <div class="col-md-8">
            <label class="form-label mb-1">Search groups</label>
            <div class="input-group">
              <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
              <input v-model="q" class="form-control" placeholder="e.g. Toppings, Sizes, Cooking Level" @keyup.enter="loadGroups" />
              <button class="btn btn-secondary" :disabled="loading" @click="loadGroups">
                <span v-if="loading">Searching…</span>
                <span v-else>Search</span>
              </button>
            </div>
          </div>
          <div class="col-md-4 text-md-end">
            <div class="text-muted small">
              Tip: Use “Required single” for sizes (Small/Medium/Large) and “Optional up to N” for toppings.
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card mod-card" style="zoom: 80%;">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading modifier groups…</div>
      </div>
    </div>

    <!-- Empty -->
    <div v-else-if="groups.length === 0" class="card mod-card" style="zoom: 80%;">
      <div class="card-body text-center text-muted py-5">
        <div class="empty-emoji">🧩</div>
        <div class="mt-2">No modifier groups yet.</div>
        <button class="btn btn-primary mt-3" @click="openCreateGroup">
          <i class="ri-add-line me-1"></i> Create first group
        </button>
      </div>
    </div>

    <!-- Cards -->
    <div v-else class="row g-3" style="zoom: 80%;">
      <div v-for="g in groups" :key="g.id" class="col-12 col-md-6 col-xl-4 d-flex">
        <div class="group-card w-100" role="button" tabindex="0" @click="openEditGroup(g)">
          <div class="group-head">
            <div class="group-icon">
              <i class="ri-sliders-line"></i>
            </div>

            <div class="group-title">
              <div class="group-name-row">
                <div class="group-name" :title="g.name">{{ g.name }}</div>
                <span class="rule-chip">{{ ruleLabel(g) }}</span>
              </div>

              <div class="group-sub">
                <span class="pill subtle">
                  <i class="ri-arrow-left-right-line me-1"></i>
                  Min {{ g.min_select }} • Max {{ g.max_select }}
                </span>
              </div>
            </div>

            <div class="group-cta">
              <button class="btn btn-sm btn-primary" @click.stop="openOptions(g)">
                <i class="ri-list-check-2 me-1"></i> Options
              </button>
            </div>
          </div>

          <div class="group-actions" @click.stop>
            <button class="btn btn-sm btn-soft-primary" @click="openEditGroup(g)">
              <i class="ri-edit-line me-1"></i> Edit
            </button>
            <button class="btn btn-sm btn-soft-danger" @click="removeGroup(g)">
              <i class="ri-delete-bin-6-line me-1"></i> Delete
            </button>
            <div class="ms-auto text-muted small">Tap card to edit</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Group Modal -->
    <div class="modal fade" id="groupModal" tabindex="-1" role="dialog" aria-hidden="true" ref="modalElGroup" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content position-relative">
          <div class="modal-header bg-light">
            <h4 class="modal-title">{{ isEditGroup ? "Edit Modifier Group" : "Create Modifier Group" }}</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true" :disabled="savingGroup"></button>
          </div>

          <div
            v-if="savingGroup"
            class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style="background: rgba(250,251,254,0.72); backdrop-filter: blur(2px); z-index: 10;"
          >
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body">
            <form @submit.prevent="saveGroup" novalidate :class="{ 'was-validated': triedSubmitGroup }">
              <div class="mb-2">
                <label class="form-label">Group Name *</label>
                <input v-model="groupForm.name" class="form-control" placeholder="e.g. Pizza Toppings, Burger Extras, Size" required />
                <div class="invalid-feedback">Name is required.</div>
              </div>

              <div class="row g-2 mt-2">
                <div class="col-md-6">
                  <label class="form-label">Min Select</label>
                  <input v-model="groupForm.min_select" type="number" class="form-control" />
                  <div class="form-text">0 means optional.</div>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Max Select</label>
                  <input v-model="groupForm.max_select" type="number" class="form-control" />
                  <div class="form-text">1 for single-choice, >1 for multi-select.</div>
                </div>
              </div>

              <div class="alert alert-light border mt-3 mb-0">
                <div class="d-flex align-items-start gap-2">
                  <i class="ri-information-line mt-1"></i>
                  <div class="small">
                    <div class="fw-semibold">Restaurant best practice</div>
                    <div class="text-muted">
                      • Size should usually be <b>Min 1 / Max 1</b> (required single) <br />
                      • Toppings are often <b>Min 0 / Max 3</b> (optional up to 3)
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="savingGroup" @click="resetGroupForm">
              Cancel
            </button>
            <button type="button" class="btn btn-primary" :disabled="savingGroup" @click="saveGroup">
              <span v-if="savingGroup">Saving…</span>
              <span v-else>{{ isEditGroup ? "Update" : "Create" }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Options Modal -->
    <div class="modal fade" id="optionsModal" tabindex="-1" role="dialog" aria-hidden="true" ref="modalElOptions" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content position-relative">
          <div class="modal-header bg-light">
            <div>
              <h4 class="modal-title mb-0">Options</h4>
              <div class="text-muted small">
                {{ currentGroup?.name || "" }} • {{ currentGroup ? ruleLabel(currentGroup) : "" }}
              </div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true" :disabled="optionSaving"></button>
          </div>

          <div
            v-if="optionSaving"
            class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style="background: rgba(250,251,254,0.72); backdrop-filter: blur(2px); z-index: 10;"
          >
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body">
            <!-- Add option strip -->
            <div class="add-strip mb-3">
              <div class="row g-2 align-items-end">
                <div class="col-md-5">
                  <label class="form-label mb-1">Option name</label>
                  <input v-model="optionForm.name" class="form-control" placeholder="e.g. Extra Cheese" />
                </div>

                <div class="col-md-2">
                  <label class="form-label mb-1">Price Δ</label>
                  <input v-model="optionForm.price_delta" type="number" step="0.01" class="form-control" placeholder="0.00" />
                </div>

                <div class="col-md-2">
                  <div class="form-check mt-4">
                    <input class="form-check-input" type="checkbox" id="optDefault" v-model="optionForm.is_default" />
                    <label class="form-check-label" for="optDefault">Default</label>
                  </div>
                </div>

                <div class="col-md-2">
                  <div class="form-check mt-4">
                    <input class="form-check-input" type="checkbox" id="optActive" v-model="optionForm.is_active" />
                    <label class="form-check-label" for="optActive">Active</label>
                  </div>
                </div>

                <div class="col-md-1 d-grid">
                  <button class="btn btn-primary" :disabled="optionSaving" @click="addOption">
                    <i class="ri-add-line"></i>
                  </button>
                </div>
              </div>
            </div>

            <!-- Search + count -->
            <div class="row g-2 align-items-end mb-2">
              <div class="col-md-8">
                <label class="form-label mb-1">Search options</label>
                <div class="input-group">
                  <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
                  <input v-model="optSearch" class="form-control" placeholder="Filter options…" />
                  <button class="btn btn-light" :disabled="!optSearch" @click="optSearch = ''">Clear</button>
                </div>
              </div>
              <div class="col-md-4 text-md-end">
                <div class="text-muted small">
                  Showing <strong>{{ filteredOptions.length }}</strong> of <strong>{{ options.length }}</strong>
                </div>
              </div>
            </div>

            <!-- Options list -->
            <div class="opt-list">
              <div v-if="filteredOptions.length === 0" class="opt-empty text-muted">
                No options yet.
              </div>

              <div v-for="o in filteredOptions" :key="o.id" class="opt-row">
                <div class="opt-left">
                  <div class="opt-name" :title="o.name">{{ o.name }}</div>
                  <div class="opt-sub">
                    <span class="pill" :class="o.is_default ? 'pill-primary' : 'pill-subtle'">
                      <i class="ri-star-line me-1"></i> {{ o.is_default ? "Default" : "Not default" }}
                    </span>
                    <span class="pill pill-subtle">
                      <i class="ri-money-dollar-circle-line me-1"></i> {{ moneyLabel(o.price_delta) }}
                    </span>
                    <span class="pill" :class="o.is_active ? 'pill-green' : 'pill-gray'">
                      <i class="ri-checkbox-circle-line me-1"></i> {{ o.is_active ? "Active" : "Inactive" }}
                    </span>
                  </div>
                </div>

                <div class="opt-right">
                  <div class="mini">
                    <label class="mini-label">Price Δ</label>
                    <input
                      class="form-control form-control-sm"
                      type="number"
                      step="0.01"
                      :value="o.price_delta ?? ''"
                      @change="(e) => saveOption(o, { price_delta: e.target.value === '' ? null : Number(e.target.value) })"
                    />
                  </div>

                  <div class="mini">
                    <label class="mini-label">Default</label>
                    <div class="form-check form-switch m-0">
                      <input
                        class="form-check-input"
                        type="radio"
                        :checked="o.is_default"
                        :name="'def-' + (currentGroup?.id || 0)"
                        @change="() => saveOption(o, { is_default: true })"
                      />
                    </div>
                  </div>

                  <div class="mini">
                    <label class="mini-label">Active</label>
                    <div class="form-check form-switch m-0">
                      <input
                        class="form-check-input"
                        type="checkbox"
                        :checked="o.is_active"
                        @change="(e) => saveOption(o, { is_active: !!e.target.checked })"
                      />
                    </div>
                  </div>

                  <!-- Ingredient deltas -->
                  <button class="btn btn-sm btn-soft-success" :disabled="optionSaving" @click="openIngredientDeltas(o)">
                    <i class="ri-flask-line me-1"></i> Ingredients
                  </button>

                  <button class="btn btn-sm btn-soft-danger" :disabled="optionSaving" @click="removeOption(o)">
                    <i class="ri-delete-bin-6-line"></i>
                  </button>
                </div>
              </div>
            </div>

            <small class="text-muted d-block mt-2">
              Default is enforced as single-choice (only one default per group).
            </small>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" :disabled="optionSaving" @click="closeOptions">Close</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Ingredient Deltas Modal -->
    <div class="modal fade" id="deltasModal" tabindex="-1" role="dialog" aria-hidden="true" ref="modalElDeltas" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content position-relative">
          <div class="modal-header bg-light">
            <div>
              <h4 class="modal-title mb-0">Ingredient Deltas</h4>
              <div class="text-muted small">
                Option: <strong>{{ currentOption?.name || "" }}</strong>
              </div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true" :disabled="deltaSaving"></button>
          </div>

          <div
            v-if="deltaSaving"
            class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style="background: rgba(250,251,254,0.72); backdrop-filter: blur(2px); z-index: 10;"
          >
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body">
            <div class="alert alert-light border mb-3">
              <div class="small">
                Choose an ingredient and how this option changes its quantity.
                Use a <b>negative qty</b> if the option removes an ingredient.
              </div>
            </div>

            <!-- Add/Update delta (VALUES / NAMES in UI) -->
            <div class="add-strip mb-3">
              <div class="row g-2 align-items-end">
                <div class="col-md-5">
                  <label class="form-label mb-1">Ingredient</label>
                  <select v-model="deltaForm.inventory_item_id" class="form-select">
                    <option :value="null">Select ingredient…</option>
                    <option v-for="it in inventoryItems" :key="it.id" :value="it.id">
                      {{ it.name }}{{ it.sku ? " • " + it.sku : "" }}
                    </option>
                  </select>
                </div>

                <div class="col-md-3">
                  <label class="form-label mb-1">Qty Δ</label>
                  <input
                    v-model="deltaForm.qty_delta"
                    type="number"
                    step="0.000001"
                    class="form-control"
                    placeholder="e.g. 0.250000"
                  />
                </div>

                <div class="col-md-3">
                  <label class="form-label mb-1">Unit</label>
                  <select v-model="deltaForm.uom_id" class="form-select">
                    <option :value="null">Select unit…</option>
                    <option v-for="u in uoms" :key="u.id" :value="u.id">
                      {{ u.name || u.code }}
                    </option>
                  </select>
                </div>

                <div class="col-md-1 d-grid">
                  <button class="btn btn-primary" :disabled="deltaSaving || deltaLoading || lookupsLoading" @click="saveDelta">
                    <i class="ri-save-2-line"></i>
                  </button>
                </div>
              </div>

              <div class="form-text mt-2" v-if="lookupsLoading">
                Loading ingredients & units…
              </div>
            </div>

            <!-- Search + count -->
            <div class="row g-2 align-items-end mb-2">
              <div class="col-md-8">
                <label class="form-label mb-1">Search deltas</label>
                <div class="input-group">
                  <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
                  <input v-model="deltaSearch" class="form-control" placeholder="Filter by ingredient / unit / qty…" />
                  <button class="btn btn-light" :disabled="!deltaSearch" @click="deltaSearch = ''">Clear</button>
                </div>
              </div>
              <div class="col-md-4 text-md-end">
                <div class="text-muted small">
                  Showing <strong>{{ filteredDeltas.length }}</strong> of <strong>{{ deltas.length }}</strong>
                </div>
              </div>
            </div>

            <!-- Loading -->
            <div v-if="deltaLoading" class="card mod-card">
              <div class="card-body d-flex align-items-center gap-2">
                <div class="spinner-border" role="status" aria-hidden="true"></div>
                <div>Loading ingredient deltas…</div>
              </div>
            </div>

            <!-- Deltas list (SHOW VALUES / NAMES) -->
            <div v-else class="delta-list">
              <div v-if="filteredDeltas.length === 0" class="opt-empty text-muted">
                No ingredient deltas yet.
              </div>

              <div v-for="d in filteredDeltas" :key="d.id" class="delta-row">
                <div class="delta-left">
                  <div class="delta-title">
                    <strong>{{ inventoryLabelById(d.inventory_item_id) || "Ingredient" }}</strong>
                  </div>
                  <div class="delta-sub">
                    <span class="pill pill-subtle">
                      <i class="ri-function-line me-1"></i> Qty Δ {{ d.qty_delta }}
                    </span>
                    <span class="pill pill-subtle">
                      <i class="ri-ruler-line me-1"></i> {{ uomLabelById(d.uom_id) || "Unit" }}
                    </span>
                  </div>
                </div>

                <div class="delta-right">
                  <button class="btn btn-sm btn-soft-danger" :disabled="deltaSaving" @click="removeDelta(d)">
                    <i class="ri-delete-bin-6-line"></i>
                  </button>
                </div>
              </div>
            </div>

            <small class="text-muted d-block mt-2">
              Tip: If you want a “Remove ingredient” option, set Qty Δ to a negative value.
            </small>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" :disabled="deltaSaving || deltaLoading" @click="refreshDeltas">
              <i class="ri-refresh-line me-1"></i> Refresh
            </button>
            <button class="btn btn-light" :disabled="deltaSaving" @click="closeDeltas">Close</button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
.empty-emoji { font-size: 44px; }

/* Container cards */
.mod-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
}

/* Group card */
.group-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
  transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
  outline: none;
}
.group-card:hover,
.group-card:focus {
  transform: translateY(-2px);
  box-shadow: var(--ct-box-shadow-lg);
  border-color: rgba(var(--ct-primary-rgb), 0.30);
}

.group-head {
  padding: 14px 14px 10px;
  display: grid;
  grid-template-columns: 46px 1fr auto;
  gap: 12px;
  align-items: start;
  background: linear-gradient(180deg, rgba(var(--ct-primary-rgb), 0.12), rgba(var(--ct-primary-rgb), 0));
}

.group-icon {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 20px;
  color: var(--ct-primary);
  background: rgba(var(--ct-primary-rgb), 0.15);
  border: 1px solid rgba(var(--ct-primary-rgb), 0.30);
}

.group-title { min-width: 0; }

.group-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.group-name {
  font-weight: 900;
  color: var(--ct-emphasis-color);
  line-height: 1.2;
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rule-chip {
  font-size: 12px;
  font-weight: 900;
  padding: 3px 10px;
  border-radius: 999px;
  color: var(--ct-success-text-emphasis);
  background: var(--ct-success-bg-subtle);
  border: 1px solid var(--ct-success-border-subtle);
}

.group-sub {
  margin-top: 6px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(var(--ct-body-color-rgb), 0.12);
  background: rgba(var(--ct-body-color-rgb), 0.04);
  color: var(--ct-secondary-color);
  font-weight: 800;
}
.pill.subtle { opacity: 0.95; }

.group-cta { padding-top: 2px; }

.group-actions {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--ct-tertiary-bg);
  border-top: 1px solid var(--ct-border-color-translucent);
  flex-wrap: wrap;
}

/* Options modal UI */
.add-strip {
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-light-bg-subtle);
  border-radius: 14px;
  padding: 12px;
}

.opt-list {
  display: grid;
  gap: 10px;
}

.opt-empty {
  border: 1px dashed rgba(var(--ct-body-color-rgb), 0.18);
  border-radius: 12px;
  padding: 14px;
  background: var(--ct-secondary-bg);
}

.opt-row {
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-secondary-bg);
  border-radius: 14px;
  padding: 12px;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: center;
}

.opt-left { min-width: 0; }
.opt-name {
  font-weight: 900;
  color: var(--ct-emphasis-color);
  max-width: 520px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.opt-sub {
  margin-top: 6px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.pill-primary {
  color: var(--ct-primary);
  background: rgba(var(--ct-primary-rgb), 0.12);
  border-color: rgba(var(--ct-primary-rgb), 0.18);
}
.pill-green {
  color: var(--ct-success-text-emphasis);
  background: var(--ct-success-bg-subtle);
  border-color: var(--ct-success-border-subtle);
}
.pill-gray {
  color: var(--ct-secondary-color);
  background: rgba(var(--ct-body-color-rgb), 0.05);
  border-color: rgba(var(--ct-body-color-rgb), 0.10);
}
.pill-subtle {
  color: var(--ct-secondary-color);
  background: rgba(var(--ct-body-color-rgb), 0.035);
  border-color: rgba(var(--ct-body-color-rgb), 0.10);
}

.opt-right {
  display: flex;
  gap: 10px;
  align-items: end;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.mini {
  min-width: 120px;
}
.mini-label {
  display: block;
  font-size: 11px;
  font-weight: 800;
  color: var(--ct-secondary-color);
  margin-bottom: 4px;
}

/* Ingredient deltas modal UI */
.delta-list {
  display: grid;
  gap: 10px;
}

.delta-row {
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-secondary-bg);
  border-radius: 14px;
  padding: 12px;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: center;
}

.delta-title {
  font-weight: 900;
  color: var(--ct-emphasis-color);
}

.delta-sub {
  margin-top: 6px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.delta-right {
  display: flex;
  gap: 10px;
  align-items: center;
}
</style>
