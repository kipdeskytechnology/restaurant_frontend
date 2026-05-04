<script setup>
import { ref, onMounted, computed, nextTick, reactive } from "vue";
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
  listOptionIngredientDeltas,
  upsertOptionIngredientDelta,
  deleteOptionIngredientDelta,
} from "../../api/modifiers";

import { listInventoryItems } from "../../api/inventory";
import { listUoms } from "../../api/setupUom";

const toast = useToast();

// ===== Groups state =====
const loading = ref(true);
const refreshing = ref(false);
const savingGroup = ref(false);
const q = ref("");
const groups = ref([]);

// ===== Options state — keyed by groupId =====
const optionsByGroup = reactive({});       // { [gid]: [opt, ...] }
const optionsLoading = reactive({});       // { [gid]: bool }
const optionBusy = reactive({});           // { [optionId]: bool }
const quickAdd = reactive({});             // { [gid]: { name, price_delta, is_default, is_active } }

function emptyOpt() {
  return { name: "", price_delta: "", is_default: false, is_active: true };
}
function ensureAddForm(gid) {
  if (!quickAdd[gid]) quickAdd[gid] = emptyOpt();
  return quickAdd[gid];
}
function getOpts(gid) {
  return optionsByGroup[gid] || [];
}

// ===== Group modal =====
const modalElGroup = ref(null);
let modalGroup = null;
const editGroupId = ref(null);
const triedSubmitGroup = ref(false);
const groupForm = ref({ name: "", min_select: 0, max_select: 1 });
const isEditGroup = computed(() => !!editGroupId.value);

// ===== Ingredient deltas modal =====
const modalElDeltas = ref(null);
let modalDeltas = null;
const currentOption = ref(null);
const deltas = ref([]);
const deltaLoading = ref(false);
const deltaSaving = ref(false);
const deltaSearch = ref("");
const deltaForm = ref({ inventory_item_id: null, qty_delta: "", uom_id: null });

const inventoryItems = ref([]);
const uoms = ref([]);
const lookupsLoading = ref(false);

// ===== Helpers =====
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
function ruleTone(g) {
  return Number(g.min_select ?? 0) >= 1 ? "required" : "optional";
}
function moneyLabel(v) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n === 0) return "—";
  return n > 0 ? `+K ${n.toFixed(2)}` : `−K ${Math.abs(n).toFixed(2)}`;
}

// ===== Modal helpers =====
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

// ===== Group CRUD =====
async function loadGroups(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    groups.value = await listModifierGroups({
      q: q.value?.trim() || undefined,
      limit: 500,
    });
    // load all options in parallel
    await loadAllOptions();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load modifier groups");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function loadAllOptions() {
  // wipe stale entries first
  for (const k of Object.keys(optionsByGroup)) delete optionsByGroup[k];
  await Promise.all(
    groups.value.map(async (g) => {
      optionsLoading[g.id] = true;
      try {
        optionsByGroup[g.id] = await listModifierOptions(g.id);
      } catch {
        optionsByGroup[g.id] = [];
      } finally {
        optionsLoading[g.id] = false;
      }
    })
  );
}

async function refreshGroupOptions(gid) {
  optionsLoading[gid] = true;
  try {
    optionsByGroup[gid] = await listModifierOptions(gid);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to refresh options");
  } finally {
    optionsLoading[gid] = false;
  }
}

const counts = computed(() => ({
  total: groups.value.length,
  required: groups.value.filter((g) => Number(g.min_select) >= 1).length,
  optional: groups.value.filter((g) => Number(g.min_select) === 0).length,
  optionsTotal: Object.values(optionsByGroup).reduce((a, arr) => a + (arr?.length || 0), 0),
}));

const isSearching = computed(() => !!q.value.trim());

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
function closeGroupModal() { modalGroup?.hide(); }

function validateGroup(payload) {
  triedSubmitGroup.value = true;
  if (!payload.name) { toast.error("Name is required"); return false; }
  if (payload.min_select < 0 || payload.max_select < 0) { toast.error("Min/Max must be >= 0"); return false; }
  if (payload.max_select < payload.min_select) { toast.error("Max must be >= Min"); return false; }
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
    await loadGroups(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save group");
  } finally {
    savingGroup.value = false;
  }
}

async function removeGroup(g) {
  if (!confirm(`Delete modifier group "${g.name}" and all its options?`)) return;
  try {
    await deleteModifierGroup(g.id);
    toast.success("Deleted");
    await loadGroups(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete group");
  }
}

// ===== Inline option CRUD =====
async function addOption(groupId) {
  const form = ensureAddForm(groupId);
  const payload = {
    name: (form.name || "").trim(),
    price_delta: numMoneyOrNull(form.price_delta),
    is_default: !!form.is_default,
    is_active: form.is_active !== false,
  };
  if (!payload.name) return toast.error("Option name is required");

  try {
    await createModifierOption(groupId, payload);
    quickAdd[groupId] = emptyOpt();
    await refreshGroupOptions(groupId);
    toast.success("Option added");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to add option");
  }
}

async function patchOption(groupId, option, patch) {
  optionBusy[option.id] = true;
  try {
    await updateModifierOption(option.id, patch);
    await refreshGroupOptions(groupId);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update option");
  } finally {
    optionBusy[option.id] = false;
  }
}

async function removeOption(groupId, option) {
  if (!confirm(`Delete option "${option.name}"?`)) return;
  optionBusy[option.id] = true;
  try {
    await deleteModifierOption(option.id);
    await refreshGroupOptions(groupId);
    toast.success("Deleted");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete option");
  } finally {
    optionBusy[option.id] = false;
  }
}

// ===== Lookups =====
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
  if (inventoryItems.value.length && uoms.value.length) return;
  lookupsLoading.value = true;
  try {
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

// ===== Ingredient deltas =====
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
  if (!inventory_item_id) return toast.error("Please choose an inventory item");
  if (!uom_id) return toast.error("Please choose a unit of measure");
  if (qty_delta === null) return toast.error("Qty Δ is required (can be negative)");

  deltaSaving.value = true;
  try {
    await upsertOptionIngredientDelta(currentOption.value.id, {
      inventory_item_id, uom_id, qty_delta,
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

function clearGroupSearch() {
  q.value = "";
  loadGroups(false);
}

onMounted(() => loadGroups());
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
        <h1 class="hero-title">Modifiers</h1>
        <p class="hero-sub">
          Each group lives on its own card with all its options inline — edit prices, toggle defaults, manage active state without ever opening a modal.
        </p>
      </div>

      <div class="page-hero-actions">
        <button class="btn btn-light btn-pill" @click="loadGroups(false)" :disabled="refreshing || loading">
          <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
        </button>
        <button v-can="'modifiers:manage'" class="btn btn-pill btn-cta" @click="openCreateGroup">
          <i class="ri-add-line"></i><span>New Group</span>
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
              placeholder="Search groups (Toppings, Sizes, Cooking Level…)"
              @keyup.enter="loadGroups(false)"
            />
          </div>
          <button class="btn btn-sm btn-primary" @click="loadGroups(false)" :disabled="loading">
            <i class="ri-search-line me-1"></i> Search
          </button>
          <button class="btn btn-sm btn-light" v-if="q" @click="clearGroupSearch">
            <i class="ri-close-line me-1"></i> Clear
          </button>
          <div class="ms-auto small text-muted d-flex gap-3">
            <span><strong>{{ counts.total }}</strong> groups</span>
            <span class="d-none d-sm-inline">•</span>
            <span><strong class="text-primary">{{ counts.required }}</strong> required</span>
            <span class="d-none d-sm-inline">•</span>
            <span><strong class="text-secondary">{{ counts.optional }}</strong> optional</span>
            <span class="d-none d-md-inline">•</span>
            <span class="d-none d-md-inline"><strong>{{ counts.optionsTotal }}</strong> options total</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border spinner-border-sm" role="status"></div>
        <div class="text-muted">Loading modifier groups…</div>
      </div>
    </div>

    <!-- Empty — no groups -->
    <div v-else-if="!groups.length && !isSearching" class="card empty-card text-center py-5">
      <div class="empty-icon"><i class="ri-sliders-line"></i></div>
      <h5 class="mt-2 mb-1">No modifier groups yet</h5>
      <p class="text-muted mb-3">Create your first group — Size, Toppings, Cooking Level…</p>
      <div>
        <button v-can="'modifiers:manage'" class="btn btn-primary" @click="openCreateGroup">
          <i class="ri-add-line me-1"></i> Create first group
        </button>
      </div>
    </div>

    <!-- Empty — search miss -->
    <div v-else-if="!groups.length && isSearching" class="card empty-card text-center py-5">
      <div class="empty-icon"><i class="ri-search-line"></i></div>
      <h5 class="mt-2 mb-1">No groups match</h5>
      <p class="text-muted mb-3">No results for "<strong>{{ q }}</strong>".</p>
      <div>
        <button class="btn btn-light" @click="clearGroupSearch">
          <i class="ri-close-line me-1"></i> Clear search
        </button>
      </div>
    </div>

    <!-- ============== Group cards (with inline options) ============== -->
    <div v-else class="row g-3">
      <div v-for="g in groups" :key="g.id" class="col-12 col-xl-6 d-flex">
        <div class="group-card w-100" :class="`tone-${ruleTone(g)}`">
          <!-- Header -->
          <div class="group-head">
            <div class="group-head-left">
              <div class="group-icon">
                <i class="ri-sliders-line"></i>
              </div>
              <div class="group-meta">
                <div class="group-name" :title="g.name">{{ g.name }}</div>
                <div class="group-rule-row">
                  <span class="rule-chip" :class="`rule-${ruleTone(g)}`">
                    <i class="ri-checkbox-circle-line me-1"></i>{{ ruleLabel(g) }}
                  </span>
                  <span class="opt-count">
                    <i class="ri-list-check-2 me-1"></i>{{ getOpts(g.id).length }} option{{ getOpts(g.id).length === 1 ? '' : 's' }}
                  </span>
                </div>
              </div>
            </div>
            <div class="group-actions">
              <button v-can="'modifiers:manage'" class="row-icon-btn" title="Edit group" @click="openEditGroup(g)">
                <i class="ri-pencil-line"></i>
              </button>
              <button v-can="'modifiers:manage'" class="row-icon-btn danger" title="Delete group" @click="removeGroup(g)">
                <i class="ri-delete-bin-line"></i>
              </button>
            </div>
          </div>

          <!-- Inline options list -->
          <div class="opts-section">
            <div v-if="optionsLoading[g.id]" class="opts-loading text-muted small">
              <span class="spinner-border spinner-border-sm me-1"></span> Loading options…
            </div>

            <div v-else-if="!getOpts(g.id).length" class="opts-empty text-muted small">
              <i class="ri-inbox-line me-1"></i> No options yet — add the first one below.
            </div>

            <div v-else class="opts-list">
              <div
                v-for="o in getOpts(g.id)"
                :key="o.id"
                class="opt-chip"
                :class="{ 'is-default': o.is_default, 'is-inactive': !o.is_active, 'busy': optionBusy[o.id] }"
              >
                <!-- Default star (radio per group) -->
                <button
                  class="opt-default"
                  :class="{ on: o.is_default }"
                  :title="o.is_default ? 'Default option' : 'Make default'"
                  :disabled="o.is_default || optionBusy[o.id]"
                  @click="patchOption(g.id, o, { is_default: true })"
                >
                  <i :class="o.is_default ? 'ri-star-fill' : 'ri-star-line'"></i>
                </button>

                <div class="opt-name" :title="o.name">{{ o.name }}</div>

                <input
                  class="opt-price"
                  type="number"
                  step="0.01"
                  :value="o.price_delta ?? ''"
                  :disabled="optionBusy[o.id]"
                  placeholder="Δ K"
                  @change="(e) => patchOption(g.id, o, { price_delta: e.target.value === '' ? null : Number(e.target.value) })"
                />

                <button
                  class="opt-active"
                  :class="{ on: o.is_active }"
                  :title="o.is_active ? 'Active — click to disable' : 'Inactive — click to enable'"
                  :disabled="optionBusy[o.id]"
                  @click="patchOption(g.id, o, { is_active: !o.is_active })"
                >
                  <i :class="o.is_active ? 'ri-eye-line' : 'ri-eye-off-line'"></i>
                </button>

                <button
                  class="opt-ico"
                  title="Ingredient impact"
                  :disabled="optionBusy[o.id]"
                  @click="openIngredientDeltas(o)"
                >
                  <i class="ri-flask-line"></i>
                </button>

                <button
                  class="opt-ico danger"
                  title="Delete option"
                  :disabled="optionBusy[o.id]"
                  @click="removeOption(g.id, o)"
                >
                  <i class="ri-delete-bin-line"></i>
                </button>
              </div>
            </div>

            <!-- Inline add form per card -->
            <div class="opt-add-row">
              <input
                v-model="ensureAddForm(g.id).name"
                class="opt-add-name"
                placeholder="Add option (e.g. Extra Cheese)…"
                @keydown.enter="addOption(g.id)"
              />
              <input
                v-model="ensureAddForm(g.id).price_delta"
                class="opt-add-price border text-start"
                type="number"
                step="0.01"
                placeholder="Δ K"
                @keydown.enter="addOption(g.id)"
              />
              <label class="opt-add-toggle" title="Default">
                <input type="checkbox" v-model="ensureAddForm(g.id).is_default" />
                <i :class="ensureAddForm(g.id).is_default ? 'ri-star-fill' : 'ri-star-line'"></i>
              </label>
              <button class="opt-add-btn" @click="addOption(g.id)" :disabled="!ensureAddForm(g.id).name?.trim()">
                <i class="ri-add-line"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
    <!-- /zoom wrapper -->

    <!-- ============== Group Modal ============== -->
    <div class="modal fade" id="groupModal" tabindex="-1" aria-hidden="true" ref="modalElGroup" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditGroup ? "Edit" : "New" }}</div>
              <h5 class="modal-title">{{ isEditGroup ? "Edit modifier group" : "New modifier group" }}</h5>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" :disabled="savingGroup"></button>
          </div>

          <div v-if="savingGroup" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <form @submit.prevent="saveGroup" novalidate :class="{ 'was-validated': triedSubmitGroup }">
              <div class="mb-3">
                <label class="form-label">Group name *</label>
                <input
                  v-model="groupForm.name"
                  class="form-control"
                  placeholder="e.g. Pizza Toppings, Burger Extras, Size"
                  required
                  autofocus
                />
              </div>

              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label">Min select</label>
                  <input v-model="groupForm.min_select" type="number" min="0" class="form-control" />
                  <div class="form-text">0 means optional.</div>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Max select</label>
                  <input v-model="groupForm.max_select" type="number" min="0" class="form-control" />
                  <div class="form-text">1 = single-choice; >1 = multi-select.</div>
                </div>
              </div>

              <div class="tip-card mt-3">
                <i class="ri-lightbulb-flash-line tip-icon"></i>
                <div class="small">
                  <div class="fw-semibold mb-1">Best practice</div>
                  <div class="text-muted">
                    • <strong>Size</strong> is usually <strong>Min 1 / Max 1</strong> (required single)<br />
                    • <strong>Toppings</strong> are often <strong>Min 0 / Max 3</strong> (optional, up to 3)
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
              <span v-if="savingGroup" class="spinner-border spinner-border-sm me-1"></span>
              {{ isEditGroup ? "Update group" : "Create group" }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Ingredient Deltas Modal ============== -->
    <div class="modal fade" id="deltasModal" tabindex="-1" aria-hidden="true" ref="modalElDeltas" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">Recipe Impact</div>
              <h5 class="modal-title">Ingredient deltas</h5>
              <div class="text-muted small">
                Option: <strong>{{ currentOption?.name || "" }}</strong>
              </div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" :disabled="deltaSaving"></button>
          </div>

          <div v-if="deltaSaving" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <div class="tip-card mb-3">
              <i class="ri-information-line tip-icon"></i>
              <div class="small">
                <div class="fw-semibold mb-1">How deltas work</div>
                <div class="text-muted">
                  Pick an ingredient and how this option <em>changes</em> its quantity. Use a <strong>negative qty</strong> if the option <em>removes</em> the ingredient.
                </div>
              </div>
            </div>

            <div class="add-strip mb-3">
              <div class="row g-2 align-items-end">
                <div class="col-md-5">
                  <label class="form-label small mb-1">Ingredient</label>
                  <select v-model="deltaForm.inventory_item_id" class="form-select">
                    <option :value="null">Select ingredient…</option>
                    <option v-for="it in inventoryItems" :key="it.id" :value="it.id">
                      {{ it.name }}{{ it.sku ? " • " + it.sku : "" }}
                    </option>
                  </select>
                </div>
                <div class="col-md-3">
                  <label class="form-label small mb-1">Qty Δ</label>
                  <input
                    v-model="deltaForm.qty_delta"
                    type="number"
                    step="0.000001"
                    class="form-control"
                    placeholder="e.g. 0.250000"
                  />
                </div>
                <div class="col-md-3">
                  <label class="form-label small mb-1">Unit</label>
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
                <span class="spinner-border spinner-border-sm me-1"></span> Loading ingredients & units…
              </div>
            </div>

            <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
              <div class="position-relative search-wrap">
                <i class="ri-search-line search-ico"></i>
                <input v-model="deltaSearch" class="form-control ps-5" placeholder="Filter by ingredient / unit / qty…" />
              </div>
              <button class="btn btn-sm btn-light" v-if="deltaSearch" @click="deltaSearch = ''">Clear</button>
              <div class="ms-auto small text-muted">
                <strong>{{ filteredDeltas.length }}</strong> of <strong>{{ deltas.length }}</strong>
              </div>
            </div>

            <div v-if="deltaLoading" class="d-flex align-items-center gap-2 text-muted small py-2">
              <span class="spinner-border spinner-border-sm"></span> Loading ingredient deltas…
            </div>

            <div v-else class="delta-list">
              <div v-if="filteredDeltas.length === 0" class="opts-empty text-muted small">
                <i class="ri-inbox-line me-1"></i> No ingredient deltas yet.
              </div>

              <div v-for="d in filteredDeltas" :key="d.id" class="delta-row">
                <div class="delta-left">
                  <div class="delta-title">
                    <i class="ri-leaf-line me-1 text-success"></i>
                    {{ inventoryLabelById(d.inventory_item_id) || "Ingredient" }}
                  </div>
                  <div class="delta-sub">
                    <span
                      class="opt-pill"
                      :class="Number(d.qty_delta) < 0 ? 'opt-pill-danger' : 'opt-pill-success'"
                    >
                      <i class="ri-function-line me-1"></i>
                      {{ Number(d.qty_delta) > 0 ? `+${d.qty_delta}` : d.qty_delta }}
                    </span>
                    <span class="opt-pill opt-pill-subtle">
                      <i class="ri-ruler-line me-1"></i>{{ uomLabelById(d.uom_id) || "Unit" }}
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
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" :disabled="deltaSaving || deltaLoading" @click="refreshDeltas">
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

/* ============= Group card ============= */
.group-card {
  position: relative;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 18px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: var(--ct-body-color, #1e293b);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.group-card:hover {
  border-color: rgba(99, 102, 241, 0.25);
  box-shadow: var(--ct-box-shadow, 0 6px 14px -8px rgba(15, 23, 42, 0.18));
}
.group-card::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4px;
  background: linear-gradient(90deg, #6366f1, #8b5cf6);
}
.group-card.tone-optional::before {
  background: linear-gradient(90deg, #94a3b8, #64748b);
}

.group-head {
  padding: 1rem 1.1rem;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px dashed var(--ct-border-color, #e6e9ef);
}

.group-head-left {
  display: flex;
  gap: 0.85rem;
  align-items: center;
  min-width: 0;
}

.group-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 1.15rem;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  box-shadow: 0 6px 14px -6px rgba(99, 102, 241, 0.55);
  flex-shrink: 0;
}
.tone-optional .group-icon {
  background: linear-gradient(135deg, #94a3b8, #64748b);
  box-shadow: 0 6px 14px -6px rgba(100, 116, 139, 0.5);
}

.group-meta { min-width: 0; }
.group-name {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 1.05rem;
  letter-spacing: -0.015em;
  color: var(--ct-body-color, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 0.3rem;
}
.group-rule-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.rule-chip {
  display: inline-flex;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
}
.rule-required {
  background: rgba(99, 102, 241, 0.12);
  color: var(--ct-primary, #6366f1);
}
.rule-optional {
  background: rgba(100, 116, 139, 0.12);
  color: var(--ct-secondary-color, #64748b);
}
.opt-count {
  display: inline-flex;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  border: 1px solid var(--ct-border-color, #e6e9ef);
}

.group-actions {
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

/* ============= Inline options section ============= */
.opts-section {
  padding: 0.85rem 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex-grow: 1;
}

.opts-loading,
.opts-empty {
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
  padding: 0.7rem 0.85rem;
  text-align: center;
  background: var(--ct-tertiary-bg, #f8fafc);
}

.opts-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

/* Each option chip-row */
.opt-chip {
  display: grid;
  grid-template-columns: 32px 1fr 88px 32px 32px 32px;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.55rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
  transition: border-color 0.15s ease, opacity 0.2s ease;
}
.opt-chip:hover {
  border-color: rgba(99, 102, 241, 0.3);
}
.opt-chip.is-default {
  border-color: rgba(99, 102, 241, 0.45);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.05), transparent);
}
.opt-chip.is-inactive {
  opacity: 0.55;
}
.opt-chip.busy {
  opacity: 0.6;
  pointer-events: none;
}

.opt-default {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--ct-secondary-color, #94a3b8);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}
.opt-default.on {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
}
.opt-default:not(.on):hover {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.08);
}
.opt-default[disabled] { cursor: default; }

.opt-name {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--ct-body-color, #1e293b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.opt-price {
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
.opt-price:focus {
  outline: none;
  border-color: var(--ct-primary, #6366f1);
}

.opt-active,
.opt-ico {
  width: 28px;
  height: 28px;
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
.opt-active.on {
  color: #10b981;
  background: rgba(16, 185, 129, 0.12);
}
.opt-active:hover { background: rgba(16, 185, 129, 0.08); color: #10b981; }
.opt-ico:hover { background: rgba(99, 102, 241, 0.08); color: var(--ct-primary, #6366f1); }
.opt-ico.danger:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; }

/* ============= Inline add-option row ============= */
.opt-add-row {
  display: grid;
  grid-template-columns: 1fr 88px 36px 36px;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.55rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
  margin-top: 0.25rem;
}
.opt-add-name,
.opt-add-price {
  border: 1px solid transparent;
  background: transparent;
  font-size: 0.85rem;
  padding: 0.3rem 0.4rem;
  color: var(--ct-body-color, #1e293b);
  border-radius: 6px;
}
.opt-add-name { font-weight: 600; }
.opt-add-name::placeholder,
.opt-add-price::placeholder {
  color: var(--ct-secondary-color, #94a3b8);
  font-weight: 500;
}
.opt-add-price {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: right;
}
.opt-add-name:focus,
.opt-add-price:focus {
  outline: none;
  background: var(--ct-card-bg, #fff);
  border-color: var(--ct-primary, #6366f1);
}

.opt-add-toggle {
  width: 36px;
  height: 30px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  color: var(--ct-secondary-color, #94a3b8);
  background: transparent;
  cursor: pointer;
  margin: 0;
  transition: color 0.15s ease, background 0.15s ease;
}
.opt-add-toggle input { display: none; }
.opt-add-toggle:has(input:checked) {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
}

.opt-add-btn {
  width: 36px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: filter 0.15s ease, opacity 0.15s ease;
  box-shadow: 0 4px 10px -4px rgba(99, 102, 241, 0.5);
}
.opt-add-btn:hover { filter: brightness(1.05); }
.opt-add-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: var(--ct-tertiary-bg, #e2e8f0);
  color: var(--ct-secondary-color, #94a3b8);
  box-shadow: none;
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

/* ============= Add-strip + delta list (deltas modal) ============= */
.add-strip {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-tertiary-bg, #f8fafc);
  border-radius: 14px;
  padding: 0.85rem;
}

.delta-list {
  display: grid;
  gap: 0.6rem;
}

.delta-row {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  border-radius: 12px;
  padding: 0.75rem 0.85rem;
  display: flex;
  gap: 0.85rem;
  justify-content: space-between;
  align-items: center;
}
.delta-row:hover { border-color: rgba(99, 102, 241, 0.25); }
.delta-left { min-width: 0; flex: 1; }
.delta-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 700;
  color: var(--ct-body-color, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.delta-sub {
  margin-top: 0.35rem;
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.opt-pill {
  display: inline-flex;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  border: 1px solid transparent;
}
.opt-pill-success {
  color: #047857;
  background: rgba(16, 185, 129, 0.14);
  border-color: rgba(16, 185, 129, 0.22);
}
.opt-pill-danger {
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.22);
}
.opt-pill-subtle {
  color: var(--ct-secondary-color, #64748b);
  background: var(--ct-tertiary-bg, #f8fafc);
  border-color: var(--ct-border-color, #e6e9ef);
}
.delta-right { display: flex; gap: 0.5rem; }

/* Compact responsive — collapse the chip grid on narrow widths */
@media (max-width: 575.98px) {
  .opt-chip {
    grid-template-columns: 28px 1fr 70px 28px 28px 28px;
    gap: 0.3rem;
    padding: 0.35rem 0.45rem;
  }
}
</style>
