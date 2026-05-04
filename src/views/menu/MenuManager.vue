<script setup>
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useToast } from "vue-toastification";
import QrcodeVue from "qrcode.vue";
import { jsPDF } from "jspdf";

import DefaultLayout from "../../layouts/DefaultLayout.vue";
import PageTitle from "../../components/PageTitle.vue";
import { StatCard, EmptyState, LoadingState, StatusBadge, SectionCard } from "../../components/ui";

import {
  getMenuOverview,
  listMenuItems,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  uploadMenuItemImage,
  bulkSetAvailability,
  bulkUpdatePrice,
  bulkSetCategory,
  listMenuCategories,
  listItemOverrides,
  upsertItemOverride,
  deleteItemOverride,
} from "../../api/menu";
import { listOutlets } from "../../api/systemOutlets";
import { getMyStoreProfile } from "../../api/systemStores";
import {
  listModifierGroups,
  listItemModifierGroups,
  attachModifierGroupToItem,
  detachModifierGroupFromItem,
} from "../../api/modifiers";
import { getRecipeByMenuItem } from "../../api/recipes";
import { listInventoryItems } from "../../api/inventory";
import { listUoms, listUomConversions } from "../../api/setupUom";

const toast = useToast();

// ---------- core state ----------
const loading = ref(true);
const refreshing = ref(false);
const overview = ref(null);
const categories = ref([]);
const outlets = ref([]);

const filters = ref({
  q: "",
  available: "all",
  view: "grid",
});

const selected = ref(new Set());

// ---------- helpers ----------
const apiBase = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";

function imageSrc(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${apiBase}${url}`;
}

function fmtMoney(v) {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- cost / food-cost % pipeline (mirrors Recipes.vue) ----------
// Threshold for the HIGH food-cost pill — same as Recipes.
const HIGH_FOOD_COST_PCT = 80;

function foodCostPct(cost, price) {
  const c = Number(cost);
  const p = Number(price);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return null;
  return (c / p) * 100;
}
function costStatus(pct) {
  if (pct == null) return { kind: "na", label: "N/A" };
  if (pct >= HIGH_FOOD_COST_PCT) return { kind: "high", label: "HIGH" };
  return { kind: "ok", label: "OK" };
}

// Lookups — loaded once, used to resolve ingredient avg_cost and unit conversions.
const inventoryItems = ref([]);
const uoms = ref([]);
const uomConversions = ref([]);

const invById = computed(() => {
  const m = new Map();
  for (const x of inventoryItems.value || []) m.set(Number(x.id), x);
  return m;
});

// Build a weighted UOM-conversion graph: 1 FROM = multiplier * TO.
const convGraph = computed(() => {
  const g = new Map();
  for (const c of uomConversions.value || []) {
    const from = Number(c.from_uom_id);
    const to = Number(c.to_uom_id);
    const mult = Number(c.multiplier);
    if (!from || !to || !Number.isFinite(mult) || mult <= 0) continue;
    if (!g.has(from)) g.set(from, []);
    if (!g.has(to)) g.set(to, []);
    g.get(from).push({ to, factor: mult });
    g.get(to).push({ to: from, factor: 1 / mult });
  }
  return g;
});

function conversionFactor(fromId, toId) {
  fromId = Number(fromId);
  toId = Number(toId);
  if (!fromId || !toId) return null;
  if (fromId === toId) return 1;
  const g = convGraph.value;
  const q = [{ id: fromId, f: 1 }];
  const seen = new Set([fromId]);
  while (q.length) {
    const { id, f } = q.shift();
    for (const e of g.get(id) || []) {
      if (seen.has(e.to)) continue;
      const f2 = f * e.factor;
      if (e.to === toId) return f2;
      seen.add(e.to);
      q.push({ id: e.to, f: f2 });
    }
  }
  return null;
}

function computeLineCost(inv, qty, uomId) {
  if (!inv) return null;
  const avg = Number(inv.avg_cost);
  const base = Number(inv.base_uom_id);
  const q = Number(qty);
  if (!Number.isFinite(avg) || !Number.isFinite(q) || !base) return null;
  const f = conversionFactor(Number(uomId), base);
  if (f == null) return null;
  return avg * (q * f);
}

function computeRecipeCost(recipeObj) {
  let cost = 0;
  let counted = 0;
  let skipped = 0;
  for (const ln of recipeObj?.lines || []) {
    const inv = invById.value.get(Number(ln.inventory_item_id));
    const c = computeLineCost(inv, ln.qty, ln.uom_id);
    if (c == null) skipped += 1;
    else { cost += c; counted += 1; }
  }
  return { cost, counted, skipped };
}

// Reactive cost cache, keyed by menu item id.
// shape: { [itemId]: { cost, pct, status, skipped, loaded } }
const costByItemId = ref({});
const costsLoading = ref(false);

function costFor(item) {
  return costByItemId.value[item.id] || null;
}

// Concurrency-capped pool — same helper used in Recipes.
async function runWithConcurrency(items, fn, limit = 10) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try { results[i] = await fn(items[i], i); }
      catch (e) { results[i] = { __err: e }; }
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

async function loadCostLookups() {
  // Run in parallel; failures are non-fatal (costs simply won't compute).
  try {
    const [inv, u, uc] = await Promise.all([
      listInventoryItems({ limit: 1000 }).catch(() => listInventoryItems()).catch(() => []),
      listUoms().catch(() => []),
      listUomConversions().catch(() => []),
    ]);
    inventoryItems.value = Array.isArray(inv) ? inv : [];
    uoms.value = Array.isArray(u) ? u : [];
    uomConversions.value = Array.isArray(uc) ? uc : [];
  } catch {
    inventoryItems.value = [];
    uoms.value = [];
    uomConversions.value = [];
  }
}

async function loadAllCosts() {
  if (!overview.value) return;
  // Flatten items across all categories; only those flagged as having a recipe.
  const targets = [];
  for (const sec of overview.value.categories || []) {
    for (const it of sec.items || []) {
      if (it.has_recipe) targets.push(it);
    }
  }
  if (!targets.length) {
    costsLoading.value = false;
    return;
  }

  costsLoading.value = true;
  try {
    const results = await runWithConcurrency(targets, async (it) => {
      try {
        const r = await getRecipeByMenuItem(Number(it.id));
        const { cost, skipped } = computeRecipeCost(r);
        const pct = foodCostPct(cost, it.price);
        return [it.id, { cost, pct, status: costStatus(pct), skipped, loaded: true }];
      } catch {
        return [it.id, null];
      }
    }, 10);

    const next = { ...costByItemId.value };
    for (const r of results) {
      if (r && Array.isArray(r) && r[1]) next[r[0]] = r[1];
    }
    costByItemId.value = next;
  } finally {
    costsLoading.value = false;
  }
}

// Recompute the FC% in place when an item's price changes (without refetching the recipe).
function recomputeItemPct(itemId, newPrice) {
  const cached = costByItemId.value[itemId];
  if (!cached) return;
  const pct = foodCostPct(cached.cost, newPrice);
  costByItemId.value = {
    ...costByItemId.value,
    [itemId]: { ...cached, pct, status: costStatus(pct) },
  };
}

// ---------- load ----------
async function loadAll(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;

  try {
    const params = {};
    if (filters.value.q) params.q = filters.value.q;
    if (filters.value.available !== "all") params.available = filters.value.available;

    const [ov, cats, outs] = await Promise.all([
      getMenuOverview(params),
      listMenuCategories(),
      listOutlets().catch(() => []),
    ]);
    overview.value = ov;
    categories.value = cats || [];
    outlets.value = outs || [];

    // Kick off recipe-cost computation in the background — non-blocking so the
    // grid renders immediately. Each tile shows a tiny placeholder until its
    // cost lands. Costs only fetched for items that have a recipe.
    loadAllCosts();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load menu");
    overview.value = null;
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

let qDebounce = null;
watch(() => filters.value.q, () => {
  clearTimeout(qDebounce);
  qDebounce = setTimeout(() => loadAll(false), 250);
});
watch(() => filters.value.available, () => loadAll(false));

onMounted(() => {
  // Kick off lookup load (inventory, UOMs, conversions) in parallel with the
  // overview. They're only needed for cost computation, so it's fine if they
  // arrive a bit later than the menu items.
  loadCostLookups();
  loadAll();
});

// ---------- selection ----------
function toggleSelect(id) {
  const s = new Set(selected.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  selected.value = s;
}
function isSelected(id) { return selected.value.has(id); }
function selectInCategory(section) {
  const s = new Set(selected.value);
  for (const it of section.items) s.add(it.id);
  selected.value = s;
}
function deselectInCategory(section) {
  const s = new Set(selected.value);
  for (const it of section.items) s.delete(it.id);
  selected.value = s;
}
function clearSelection() { selected.value = new Set(); }
const selectedIds = computed(() => Array.from(selected.value));
const selectedCount = computed(() => selected.value.size);

// ---------- single-item quick actions ----------
async function toggleAvailable(item) {
  try {
    await updateMenuItem(item.id, { is_available: !item.is_available });
    item.is_available = !item.is_available;
    toast.success(item.is_available ? "Available" : "Marked unavailable (86'd)");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update");
  }
}

// quick price edit modal
const editingPrice = ref(null);
const priceForm = ref({ price: "" });
const savingPrice = ref(false);

function openPriceEdit(item) {
  editingPrice.value = item;
  priceForm.value = { price: String(item.price ?? "") };
  showBootstrapModal("priceModal");
}
function closePriceEdit() {
  editingPrice.value = null;
  hideBootstrapModal("priceModal");
}
async function savePrice() {
  if (!editingPrice.value) return;
  const p = Number(priceForm.value.price);
  if (!Number.isFinite(p) || p <= 0) {
    toast.warning("Price must be greater than 0");
    return;
  }
  savingPrice.value = true;
  try {
    const updated = await updateMenuItem(editingPrice.value.id, { price: p });
    editingPrice.value.price = updated.price;
    // Cost is unchanged but FC% needs to track the new price.
    recomputeItemPct(editingPrice.value.id, updated.price);
    toast.success("Price updated");
    closePriceEdit();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update price");
  } finally {
    savingPrice.value = false;
  }
}

// ---------- image upload ----------
const uploadingFor = ref(null);
const fileInputs = ref({});

function triggerUpload(item) {
  const input = fileInputs.value[item.id];
  if (input) input.click();
}
async function onFileChange(item, event) {
  const file = event.target.files?.[0];
  if (!file) return;
  uploadingFor.value = item.id;
  try {
    const updated = await uploadMenuItemImage(item.id, file);
    item.image_url = updated.image_url;
    toast.success("Image uploaded");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Upload failed");
  } finally {
    uploadingFor.value = null;
    if (event.target) event.target.value = "";
  }
}

// ---------- bulk actions ----------
async function bulkAvailability(makeAvailable) {
  if (!selectedCount.value) return;
  try {
    const r = await bulkSetAvailability(selectedIds.value, makeAvailable);
    toast.success(`${r.updated_count} item${r.updated_count === 1 ? '' : 's'} ${makeAvailable ? 'available' : "86'd"}`);
    clearSelection();
    await loadAll(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Bulk update failed");
  }
}

const bulkPriceForm = ref({ mode: "increase_pct", value: "", round_to: "" });
const savingBulk = ref(false);

function openBulkPrice() {
  if (!selectedCount.value) return;
  bulkPriceForm.value = { mode: "increase_pct", value: "", round_to: "" };
  showBootstrapModal("bulkPriceModal");
}
function closeBulkPrice() { hideBootstrapModal("bulkPriceModal"); }

async function submitBulkPrice() {
  const v = Number(bulkPriceForm.value.value);
  if (!Number.isFinite(v) || v < 0) {
    toast.warning("Enter a valid number");
    return;
  }
  if (bulkPriceForm.value.mode === "set" && v <= 0) {
    toast.warning("Set price must be > 0");
    return;
  }
  const roundTo = bulkPriceForm.value.round_to ? Number(bulkPriceForm.value.round_to) : null;
  savingBulk.value = true;
  try {
    const r = await bulkUpdatePrice(selectedIds.value, bulkPriceForm.value.mode, v, roundTo || null);
    toast.success(`${r.updated_count} price${r.updated_count === 1 ? '' : 's'} updated`);
    clearSelection();
    closeBulkPrice();
    await loadAll(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Bulk price update failed");
  } finally {
    savingBulk.value = false;
  }
}

async function bulkMoveCategory(catId) {
  if (!selectedCount.value) return;
  try {
    const r = await bulkSetCategory(selectedIds.value, catId);
    toast.success(`Moved ${r.updated_count} item${r.updated_count === 1 ? '' : 's'}`);
    clearSelection();
    await loadAll(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Bulk move failed");
  }
}

// ---------- full Item editor (create + edit + modifiers) ----------
const editingItem = ref(null);     // current item id when editing, null when creating
const itemForm = ref(emptyItemForm());
const savingItem = ref(false);
const triedItemSubmit = ref(false);

const modifierGroups = ref([]);
const assignedGroupIds = ref(new Set());      // already-attached on the server (edit mode)
const pendingGroupIds = ref(new Set());       // selected before the item exists (create mode)
const loadingMods = ref(false);
const savingMods = ref(false);

function emptyItemForm() {
  return {
    name: "",
    sku: "",
    price: "",
    category_id: null,
    description: "",
    is_available: true,
    is_combo: false,
    // Most menu items need kitchen prep. Cashier toggles this off for
    // bottled drinks, packaged snacks, etc.
    send_to_kitchen: true,
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

async function openCreateItem(catId = null) {
  editingItem.value = null;
  triedItemSubmit.value = false;
  itemForm.value = { ...emptyItemForm(), category_id: catId };
  assignedGroupIds.value = new Set();
  pendingGroupIds.value = new Set();
  showBootstrapModal("itemModal");
  await loadModifierGroupsList();
}

async function openEditItem(item) {
  editingItem.value = item.id;
  triedItemSubmit.value = false;
  itemForm.value = {
    name: item.name ?? "",
    sku: item.sku ?? "",
    price: item.price ?? "",
    category_id: item.category_id ?? null,
    description: item.description ?? "",
    is_available: !!item.is_available,
    is_combo: !!item.is_combo,
    // Treat missing field on legacy responses as ON (matches the DB default).
    send_to_kitchen: item.send_to_kitchen !== false,
  };
  pendingGroupIds.value = new Set();
  showBootstrapModal("itemModal");
  await nextTick();
  await loadItemModifiers(item.id);
}

function closeItemModal() {
  hideBootstrapModal("itemModal");
  editingItem.value = null;
  triedItemSubmit.value = false;
  pendingGroupIds.value = new Set();
}

// Load just the available groups (used when creating a new item — no attachments yet)
async function loadModifierGroupsList() {
  loadingMods.value = true;
  try {
    modifierGroups.value = await listModifierGroups({ limit: 500 });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load modifier groups");
    modifierGroups.value = [];
  } finally {
    loadingMods.value = false;
  }
}

// Load groups + the attachments for an existing item (edit mode)
async function loadItemModifiers(menuItemId) {
  loadingMods.value = true;
  try {
    modifierGroups.value = await listModifierGroups({ limit: 500 });
    const rows = await listItemModifierGroups(menuItemId);
    assignedGroupIds.value = new Set((rows || []).map((r) => r.group_id));
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load item modifiers");
    modifierGroups.value = [];
    assignedGroupIds.value = new Set();
  } finally {
    loadingMods.value = false;
  }
}

// EDIT mode: attach/detach immediately. CREATE mode: just track in pending set.
async function toggleGroup(menuItemId, groupId, checked) {
  if (!menuItemId) {
    // create mode — defer until the item is created
    if (checked) pendingGroupIds.value.add(groupId);
    else pendingGroupIds.value.delete(groupId);
    pendingGroupIds.value = new Set(pendingGroupIds.value);
    return;
  }
  savingMods.value = true;
  try {
    if (checked) {
      await attachModifierGroupToItem(menuItemId, groupId);
      assignedGroupIds.value.add(groupId);
    } else {
      await detachModifierGroupFromItem(menuItemId, groupId);
      assignedGroupIds.value.delete(groupId);
    }
    assignedGroupIds.value = new Set(assignedGroupIds.value);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update item modifiers");
  } finally {
    savingMods.value = false;
  }
}

// Helper: which group IDs are checked in the current modal context
function isGroupChecked(groupId) {
  return editingItem.value
    ? assignedGroupIds.value.has(groupId)
    : pendingGroupIds.value.has(groupId);
}

function validateItem() {
  triedItemSubmit.value = true;
  const name = String(itemForm.value.name || "").trim();
  if (!name) { toast.warning("Name is required"); return false; }
  const p = Number(itemForm.value.price);
  if (!Number.isFinite(p) || p <= 0) { toast.warning("Price must be > 0"); return false; }
  return true;
}

async function saveItem() {
  if (!validateItem()) return;

  savingItem.value = true;
  try {
    const payload = {
      name: String(itemForm.value.name).trim(),
      sku: itemForm.value.sku?.trim() || null,
      price: Number(itemForm.value.price),
      category_id: itemForm.value.category_id || null,
      description: itemForm.value.description?.trim() || null,
      is_available: !!itemForm.value.is_available,
      is_combo: !!itemForm.value.is_combo,
      send_to_kitchen: !!itemForm.value.send_to_kitchen,
    };

    if (editingItem.value) {
      await updateMenuItem(editingItem.value, payload);
      toast.success("Item updated");
    } else {
      const created = await createMenuItem(payload);

      // Attach any modifier groups the user picked while creating
      const pending = Array.from(pendingGroupIds.value);
      if (created?.id && pending.length) {
        const results = await Promise.allSettled(
          pending.map((gid) => attachModifierGroupToItem(created.id, gid))
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed) {
          toast.warning(`Item created, but ${failed} modifier group${failed === 1 ? '' : 's'} failed to attach.`);
        } else {
          toast.success(`Item created with ${pending.length} modifier group${pending.length === 1 ? '' : 's'}`);
        }
      } else {
        toast.success("Item created");
      }
    }
    closeItemModal();
    await loadAll(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save item");
  } finally {
    savingItem.value = false;
  }
}

async function deleteItem(item) {
  if (!confirm(`Delete "${item.name}"? (soft delete)`)) return;
  try {
    await deleteMenuItem(item.id);
    toast.success("Item deleted");
    await loadAll(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete item");
  }
}

// ---------- outlet overrides ----------
const overridingItem = ref(null);
const overrides = ref([]);
const overrideDraft = ref({});
const loadingOverrides = ref(false);

async function openOverrides(item) {
  overridingItem.value = item;
  overrides.value = [];
  overrideDraft.value = {};
  loadingOverrides.value = true;
  showBootstrapModal("overridesModal");
  try {
    overrides.value = await listItemOverrides(item.id);
    for (const o of overrides.value) {
      overrideDraft.value[o.outlet_id] = {
        price_override: o.price_override ?? "",
        is_available_override:
          o.is_available_override === null || o.is_available_override === undefined
            ? ""
            : o.is_available_override ? "1" : "0",
      };
    }
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load overrides");
  } finally {
    loadingOverrides.value = false;
  }
}

function closeOverrides() {
  overridingItem.value = null;
  overrides.value = [];
  overrideDraft.value = {};
  hideBootstrapModal("overridesModal");
}

async function saveOverride(outletId) {
  const it = overridingItem.value;
  if (!it) return;
  const d = overrideDraft.value[outletId] || { price_override: "", is_available_override: "" };
  const payload = {
    price_override: d.price_override === "" ? null : Number(d.price_override),
    is_available_override:
      d.is_available_override === "" ? null : d.is_available_override === "1" ? true : false,
  };
  try {
    await upsertItemOverride(it.id, outletId, payload);
    toast.success("Override saved");
    overrides.value = await listItemOverrides(it.id);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save override");
  }
}

async function clearOverride(outletId) {
  const it = overridingItem.value;
  if (!it) return;
  try {
    await deleteItemOverride(it.id, outletId);
    toast.success("Override removed");
    delete overrideDraft.value[outletId];
    overrides.value = await listItemOverrides(it.id);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to remove override");
  }
}

// ---------- Public Menu (QR) ----------
const storeProfile = ref(null);
const loadingStore = ref(false);
const qrRef = ref(null);
const downloading = ref(false);

const publicMenuUrl = computed(() => {
  const code = storeProfile.value?.public_menu_code;
  if (!code) return "";
  const base = import.meta.env.VITE_PUBLIC_MENU_BASE_URL || "https://restraurant-public-menu.vercel.app";
  return `${base}/${code}`;
});

async function openPublicMenu() {
  if (!storeProfile.value) {
    loadingStore.value = true;
    try {
      storeProfile.value = await getMyStoreProfile();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load store profile");
    } finally {
      loadingStore.value = false;
    }
  }
  if (!storeProfile.value) return;
  if (!storeProfile.value?.public_menu_enabled) {
    toast.error("Public menu is disabled for this store.");
    return;
  }
  if (!storeProfile.value?.public_menu_code) {
    toast.error("Public menu code not found on your store profile.");
    return;
  }
  showBootstrapModal("publicMenuModal");
}

function closePublicMenu() { hideBootstrapModal("publicMenuModal"); }

async function copyPublicMenuLink() {
  if (!publicMenuUrl.value) return;
  try {
    await navigator.clipboard.writeText(publicMenuUrl.value);
    toast.success("Link copied!");
  } catch {
    toast.error("Could not copy link");
  }
}

function safeFileBase() {
  const name = storeProfile.value?.name || "store";
  return name.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function getQrCanvasNow() {
  const el = qrRef.value?.$el;
  if (el) {
    if (el.tagName?.toLowerCase() === "canvas") return el;
    const c1 = el.querySelector?.("canvas");
    if (c1) return c1;
  }
  return document.querySelector("#publicMenuModal canvas");
}

async function waitForQrCanvas(maxTries = 25) {
  for (let i = 0; i < maxTries; i++) {
    await nextTick();
    await new Promise((r) => requestAnimationFrame(r));
    const canvas = getQrCanvasNow();
    if (canvas) return canvas;
  }
  return null;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadQrPng() {
  try {
    const canvas = await waitForQrCanvas();
    if (!canvas) { toast.error("QR not ready yet."); return; }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) { toast.error("Failed to create PNG."); return; }
    downloadBlob(blob, `${safeFileBase()}_public_menu_qr.png`);
  } catch {
    toast.error("Failed to download QR image.");
  }
}

function printQr() {
  const canvas = getQrCanvasNow();
  if (!canvas) { toast.error("QR not ready yet."); return; }
  const dataUrl = canvas.toDataURL("image/png");
  const w = window.open("", "_blank", "width=600,height=700");
  if (!w) { toast.error("Popup blocked. Allow popups to print."); return; }
  const storeName = storeProfile.value?.name || "Public Menu";
  const link = publicMenuUrl.value || "";
  w.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${storeName} — Public Menu QR</title>
        <style>
          body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 2rem; color: #1e293b; }
          h2 { font-weight: 800; letter-spacing: -0.02em; margin-bottom: 0.25rem; }
          .eyebrow { font-size: 0.7rem; font-weight: 700; color: #6366f1; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.5rem; }
          .frame { display: inline-block; padding: 0.85rem; border-radius: 16px; background: linear-gradient(135deg, #6366f1, #8b5cf6); margin: 1.5rem 0; }
          .frame img { width: 280px; height: 280px; background: #fff; border-radius: 10px; padding: 8px; display: block; }
          .caption { color: #64748b; font-size: 0.85rem; word-break: break-all; max-width: 360px; margin: 0 auto; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="eyebrow">Public Menu</div>
        <h2>${storeName}</h2>
        <div class="frame"><img src="${dataUrl}" alt="QR Code" /></div>
        <p class="caption">Scan with your phone to view this menu.</p>
        <p class="caption">${link}</p>
        <script>window.onload = function () { setTimeout(function () { window.print(); }, 100); };<\/script>
      </body>
    </html>
  `);
  w.document.close();
}

async function downloadQrPdf() {
  downloading.value = true;
  try {
    const canvas = await waitForQrCanvas();
    if (!canvas) { toast.error("QR not ready yet."); return; }
    const imgData = canvas.toDataURL("image/png");
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 40;
    const storeName = storeProfile.value?.name || "Store";
    const link = publicMenuUrl.value || "";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(storeName, margin, 60);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text("Public Menu QR Code", margin, 82);

    const qrSize = 260;
    const x = (pageW - qrSize) / 2;
    const y = 120;
    doc.addImage(imgData, "PNG", x, y, qrSize, qrSize);

    doc.setFontSize(11);
    doc.text("Link:", margin, y + qrSize + 30);
    const wrapped = doc.splitTextToSize(link, pageW - margin * 2);
    doc.text(wrapped, margin, y + qrSize + 46);

    doc.save(`${safeFileBase()}_public_menu_qr.pdf`);
  } catch {
    toast.error("Failed to download PDF.");
  } finally {
    downloading.value = false;
  }
}

// ---------- bootstrap modal helpers ----------
function showBootstrapModal(id) {
  const el = document.getElementById(id);
  if (el && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(el).show();
}
function hideBootstrapModal(id) {
  const el = document.getElementById(id);
  if (el && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(el).hide();
}

// ---------- summary ----------
const summary = computed(() => {
  if (!overview.value) return null;
  return {
    total: overview.value.total_items,
    available: overview.value.available_count,
    unavailable: overview.value.unavailable_count,
    categoryCount: overview.value.categories.length,
  };
});

// When a search query is active, hide categories that have no matching items.
// Otherwise show every category (even empty ones, so users can add to them).
const isSearching = computed(
  () => !!filters.value.q?.trim() || filters.value.available !== "all"
);
const visibleSections = computed(() => {
  const sections = overview.value?.categories || [];
  return isSearching.value ? sections.filter((s) => s.items.length > 0) : sections;
});
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
    <!-- ============== HERO HEADER ============== -->
    <div class="page-hero">
      <div class="page-hero-text">
        <div class="eyebrow">
          <i class="ri-restaurant-2-line"></i>
          <span>Catalog</span>
        </div>
        <h1 class="hero-title">Menu Manager</h1>
        <p class="hero-sub">
          One place to manage every dish, modifier, outlet override and the public menu QR.
        </p>
      </div>

      <div class="page-hero-actions">
        <button class="btn btn-light btn-pill" @click="openPublicMenu">
          <i class="ri-qr-code-line"></i><span>Public Menu</span>
        </button>
        <button class="btn btn-light btn-pill" @click="loadAll(false)" :disabled="refreshing || loading">
          <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
        </button>
        <button v-can="'menu:manage'" class="btn btn-pill btn-cta" @click="openCreateItem(null)">
          <i class="ri-add-line"></i><span>New Item</span>
        </button>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="card mb-3 toolbar-card">
      <div class="card-body py-2">
        <div class="d-flex flex-wrap gap-2 align-items-center">
          <div class="position-relative search-wrap">
            <i class="ri-search-line search-ico"></i>
            <input
              v-model="filters.q"
              type="search"
              class="form-control ps-5"
              placeholder="Search items by name…"
            />
          </div>

          <select v-model="filters.available" class="form-select form-select-sm" style="width: auto">
            <option value="all">All items</option>
            <option value="1">Available only</option>
            <option value="0">86'd / unavailable</option>
          </select>

          <div class="btn-group btn-group-sm view-toggle ms-auto" role="group">
            <button
              type="button"
              class="btn"
              :class="filters.view === 'grid' ? 'btn-primary' : 'btn-light'"
              @click="filters.view = 'grid'"
              title="Grid view"
            >
              <i class="ri-grid-line"></i>
            </button>
            <button
              type="button"
              class="btn"
              :class="filters.view === 'list' ? 'btn-primary' : 'btn-light'"
              @click="filters.view = 'list'"
              title="List view"
            >
              <i class="ri-list-check"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Bulk action bar -->
    <transition name="fade">
      <div v-if="selectedCount" class="bulk-bar mb-3">
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <span class="bulk-count">
            <i class="ri-check-double-line me-1"></i>
            <strong>{{ selectedCount }}</strong> selected
          </span>
          <div class="ms-auto d-flex gap-2 flex-wrap">
            <button v-can="'menu:manage'" class="btn btn-sm btn-soft-success" @click="bulkAvailability(true)">
              <i class="ri-eye-line me-1"></i> Make available
            </button>
            <button v-can="'menu:manage'" class="btn btn-sm btn-soft-warning" @click="bulkAvailability(false)">
              <i class="ri-eye-off-line me-1"></i> 86 / Hide
            </button>
            <button v-can="'menu:manage'" class="btn btn-sm btn-soft-info" @click="openBulkPrice">
              <i class="ri-money-dollar-circle-line me-1"></i> Update prices
            </button>
            <div class="dropdown" v-can="'menu:manage'">
              <button class="btn btn-sm btn-light dropdown-toggle" data-bs-toggle="dropdown">
                <i class="ri-folder-transfer-line me-1"></i> Move to…
              </button>
              <ul class="dropdown-menu">
                <li v-for="c in categories" :key="c.id">
                  <a class="dropdown-item" href="#" @click.prevent="bulkMoveCategory(c.id)">{{ c.name }}</a>
                </li>
                <li><hr class="dropdown-divider" /></li>
                <li>
                  <a class="dropdown-item text-muted" href="#" @click.prevent="bulkMoveCategory(null)">Uncategorized</a>
                </li>
              </ul>
            </div>
            <button class="btn btn-sm btn-light" @click="clearSelection">Clear</button>
          </div>
        </div>
      </div>
    </transition>

    <LoadingState v-if="loading" label="Loading menu…" />

    <template v-else-if="overview">
      <!-- Summary tiles -->
      <div class="row g-3 mb-3">
        <div class="col-6 col-md-3">
          <StatCard
            label="Total Items"
            :value="summary.total"
            icon="ri-restaurant-line"
            tone="info"
            :hint="`${summary.categoryCount} categor${summary.categoryCount === 1 ? 'y' : 'ies'}`"
          />
        </div>
        <div class="col-6 col-md-3">
          <StatCard label="Available" :value="summary.available" icon="ri-checkbox-circle-line" tone="success" />
        </div>
        <div class="col-6 col-md-3">
          <StatCard label="Unavailable" :value="summary.unavailable" icon="ri-close-circle-line" tone="warning" hint="86'd or hidden" />
        </div>
        <div class="col-6 col-md-3">
          <StatCard label="Selected" :value="selectedCount" icon="ri-check-double-line" tone="default" hint="Use bulk actions above" />
        </div>
      </div>

      <!-- Empty state — no categories at all -->
      <EmptyState
        v-if="!overview.categories.length"
        icon="ri-restaurant-line"
        title="No menu items yet"
        message="Add your first item to get started."
      >
        <button v-can="'menu:manage'" class="btn btn-primary" @click="openCreateItem(null)">
          <i class="ri-add-line me-1"></i> Create first item
        </button>
      </EmptyState>

      <!-- Empty state — search returned nothing -->
      <EmptyState
        v-else-if="isSearching && !visibleSections.length"
        icon="ri-search-line"
        title="No items match your filters"
        :message="filters.q ? `No matches for &quot;${filters.q}&quot;.` : 'Try a different filter.'"
      >
        <button class="btn btn-light" @click="filters.q = ''; filters.available = 'all'">
          <i class="ri-close-line me-1"></i> Clear filters
        </button>
      </EmptyState>

      <!-- Category sections -->
      <div v-for="section in visibleSections" :key="section.id ?? 'uncat'" class="mb-4">
        <SectionCard :title="section.name" :subtitle="`${section.item_count} item${section.item_count === 1 ? '' : 's'}`" no-body>
          <template #actions>
            <button class="btn btn-sm btn-light" @click="selectInCategory(section)" v-if="section.items.length">
              <i class="ri-checkbox-multiple-line me-1"></i> Select all
            </button>
            <button class="btn btn-sm btn-link text-muted" @click="deselectInCategory(section)" v-if="section.items.length">
              Clear
            </button>
            <button v-can="'menu:manage'" class="btn btn-sm btn-soft-primary" @click="openCreateItem(section.id)">
              <i class="ri-add-line me-1"></i> Add item
            </button>
          </template>

          <EmptyState
            v-if="!section.items.length"
            icon="ri-inbox-line"
            title="No items in this category"
            message=""
          />

          <!-- GRID VIEW -->
          <div v-else-if="filters.view === 'grid'" class="row g-3 p-3">
            <div
              v-for="item in section.items"
              :key="item.id"
              class="col-12 col-sm-6 col-md-4 col-lg-3 col-xxl-2"
            >
              <div
                class="menu-tile h-100"
                :class="{ selected: isSelected(item.id), unavailable: !item.is_available }"
              >
                <!-- selection -->
                <label class="tile-check">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    :checked="isSelected(item.id)"
                    @change="toggleSelect(item.id)"
                  />
                </label>

                <!-- image -->
                <div class="tile-image" @click="triggerUpload(item)">
                  <img v-if="item.image_url" :src="imageSrc(item.image_url)" :alt="item.name" />
                  <div v-else class="tile-image-placeholder">
                    <i class="ri-image-add-line"></i>
                    <small>Tap to upload</small>
                  </div>
                  <div v-if="uploadingFor === item.id" class="tile-uploading">
                    <span class="spinner-border spinner-border-sm"></span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    class="d-none"
                    :ref="(el) => fileInputs[item.id] = el"
                    @change="onFileChange(item, $event)"
                  />

                  <span v-if="!item.is_available" class="tile-status-pill tile-status-off">
                    <i class="ri-eye-off-line"></i> 86
                  </span>
                </div>

                <!-- body (click → edit) -->
                <div class="tile-body" @click="openEditItem(item)" role="button">
                  <div class="tile-name" :title="item.name">{{ item.name }}</div>

                  <div class="tile-tags">
                    <StatusBadge v-if="item.modifier_group_count" tone="info">
                      {{ item.modifier_group_count }} mod{{ item.modifier_group_count === 1 ? '' : 's' }}
                    </StatusBadge>
                    <StatusBadge v-if="item.has_recipe" tone="success">recipe</StatusBadge>
                    <StatusBadge v-if="item.is_combo" tone="primary">combo</StatusBadge>
                  </div>

                  <button
                    class="tile-price"
                    @click.stop="openPriceEdit(item)"
                    title="Click to change price"
                  >
                    K {{ fmtMoney(item.price) }}
                    <i class="ri-edit-line tile-price-edit"></i>
                  </button>

                  <!-- Cost / food cost % -->
                  <div class="tile-cost" v-if="item.has_recipe">
                    <template v-if="costFor(item)">
                      <span class="cost-amount" title="Estimated ingredient cost">
                        <i class="ri-coin-line"></i>
                        K {{ fmtMoney(costFor(item).cost) }}
                      </span>
                      <span
                        class="fc-pill"
                        :class="`fc-${costFor(item).status.kind}`"
                        :title="costFor(item).pct == null ? 'Set a price to see food cost %' : `${costFor(item).pct.toFixed(1)}% food cost`"
                      >
                        <i class="ri-percent-line"></i>
                        {{ costFor(item).pct == null ? '—' : `${costFor(item).pct.toFixed(0)}%` }}
                      </span>
                    </template>
                    <span v-else class="cost-loading">
                      <span class="spinner-border spinner-border-sm"></span> cost…
                    </span>
                  </div>
                  <div class="tile-cost no-recipe" v-else title="Add a recipe to see ingredient cost">
                    <i class="ri-flask-line"></i>
                    <span>No recipe</span>
                  </div>
                </div>

                <!-- footer actions -->
                <div class="tile-actions" @click.stop>
                  <button
                    class="btn btn-sm flex-grow-1"
                    :class="item.is_available ? 'btn-soft-warning' : 'btn-soft-success'"
                    @click="toggleAvailable(item)"
                  >
                    <i :class="item.is_available ? 'ri-eye-off-line' : 'ri-eye-line'"></i>
                    {{ item.is_available ? '86' : 'Avail' }}
                  </button>
                  <button v-can="'menu:manage'" class="btn btn-sm btn-light" @click="openEditItem(item)" title="Edit details">
                    <i class="ri-edit-line"></i>
                  </button>
                  <button v-can="'menu:manage'" class="btn btn-sm btn-light" @click="openOverrides(item)" title="Outlet overrides">
                    <i class="ri-store-2-line"></i>
                  </button>
                  <button v-can="'menu:manage'" class="btn btn-sm btn-soft-danger" @click="deleteItem(item)" title="Delete">
                    <i class="ri-delete-bin-6-line"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- LIST VIEW -->
          <div v-else class="table-responsive">
            <table class="table table-hover mb-0 align-middle">
              <thead>
                <tr>
                  <th style="width: 36px"></th>
                  <th style="width: 60px"></th>
                  <th>Name</th>
                  <th>Tags</th>
                  <th class="text-end">Price</th>
                  <th class="text-end">Cost</th>
                  <th class="text-center">FC %</th>
                  <th class="text-center">Status</th>
                  <th class="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in section.items"
                  :key="item.id"
                  :class="{ 'row-selected': isSelected(item.id), 'row-dim': !item.is_available }"
                >
                  <td>
                    <input
                      class="form-check-input"
                      type="checkbox"
                      :checked="isSelected(item.id)"
                      @change="toggleSelect(item.id)"
                    />
                  </td>
                  <td>
                    <div class="list-thumb" @click="triggerUpload(item)">
                      <img v-if="item.image_url" :src="imageSrc(item.image_url)" :alt="item.name" />
                      <i v-else class="ri-image-add-line"></i>
                      <input
                        type="file"
                        accept="image/*"
                        class="d-none"
                        :ref="(el) => fileInputs[item.id] = el"
                        @change="onFileChange(item, $event)"
                      />
                    </div>
                  </td>
                  <td>
                    <a href="#" class="fw-semibold link-dark" @click.prevent="openEditItem(item)">{{ item.name }}</a>
                    <div v-if="item.sku" class="text-muted small">{{ item.sku }}</div>
                  </td>
                  <td>
                    <div class="d-flex flex-wrap gap-1">
                      <StatusBadge v-if="item.modifier_group_count" tone="info">
                        {{ item.modifier_group_count }} mods
                      </StatusBadge>
                      <StatusBadge v-if="item.has_recipe" tone="success">recipe</StatusBadge>
                      <StatusBadge v-if="item.is_combo" tone="primary">combo</StatusBadge>
                    </div>
                  </td>
                  <td class="text-end">
                    <button class="btn btn-sm btn-link p-0 fw-bold text-decoration-none" @click="openPriceEdit(item)">
                      K {{ fmtMoney(item.price) }}
                      <i class="ri-edit-line small ms-1 text-muted"></i>
                    </button>
                  </td>
                  <td class="text-end">
                    <template v-if="item.has_recipe">
                      <span v-if="costFor(item)" class="cost-amount">K {{ fmtMoney(costFor(item).cost) }}</span>
                      <span v-else class="cost-loading">
                        <span class="spinner-border spinner-border-sm"></span>
                      </span>
                    </template>
                    <span v-else class="text-muted small">—</span>
                  </td>
                  <td class="text-center">
                    <template v-if="item.has_recipe && costFor(item)">
                      <span class="fc-pill" :class="`fc-${costFor(item).status.kind}`">
                        {{ costFor(item).pct == null ? '—' : `${costFor(item).pct.toFixed(0)}%` }}
                      </span>
                    </template>
                    <span v-else class="text-muted small">—</span>
                  </td>
                  <td class="text-center">
                    <StatusBadge v-if="item.is_available" tone="success">Available</StatusBadge>
                    <StatusBadge v-else tone="warning">86'd</StatusBadge>
                  </td>
                  <td class="text-end">
                    <div class="btn-group btn-group-sm">
                      <button
                        class="btn"
                        :class="item.is_available ? 'btn-soft-warning' : 'btn-soft-success'"
                        @click="toggleAvailable(item)"
                      >
                        {{ item.is_available ? '86' : 'Activate' }}
                      </button>
                      <button v-can="'menu:manage'" class="btn btn-light" @click="openEditItem(item)" title="Edit">
                        <i class="ri-edit-line"></i>
                      </button>
                      <button v-can="'menu:manage'" class="btn btn-light" @click="openOverrides(item)" title="Outlet overrides">
                        <i class="ri-store-2-line"></i>
                      </button>
                      <button v-can="'menu:manage'" class="btn btn-soft-danger" @click="deleteItem(item)" title="Delete">
                        <i class="ri-delete-bin-6-line"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </template>
    </div>
    <!-- /zoom wrapper — modals stay at normal scale so Bootstrap positioning works -->

    <!-- ============== Item editor modal (create + edit + modifiers) ============== -->
    <div class="modal fade" id="itemModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content position-relative">
          <div class="modal-header">
            <div>
              <h5 class="modal-title mb-0">
                {{ editingItem ? "Edit menu item" : "New menu item" }}
              </h5>
              <div class="text-muted small">
                {{ editingItem ? "Update details, manage modifiers and overrides." : "Add a new dish to your menu." }}
              </div>
            </div>
            <button type="button" class="btn-close" @click="closeItemModal" :disabled="savingItem"></button>
          </div>

          <div v-if="savingItem" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body">
            <form @submit.prevent="saveItem" novalidate :class="{ 'was-validated': triedItemSubmit }">
              <div class="row g-3">
                <div class="col-md-8">
                  <label class="form-label">Name *</label>
                  <input v-model="itemForm.name" class="form-control" placeholder="e.g. Chicken Burger — Spicy" required autofocus />
                </div>
                <div class="col-md-4">
                  <label class="form-label">Price (K) *</label>
                  <input v-model="itemForm.price" type="number" step="0.01" min="0.01" class="form-control" required />
                </div>

                <div class="col-md-6">
                  <label class="form-label">Category</label>
                  <select v-model="itemForm.category_id" class="form-select">
                    <option :value="null">— Uncategorized —</option>
                    <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                  </select>
                </div>
                <div class="col-md-6">
                  <label class="form-label">SKU</label>
                  <input v-model="itemForm.sku" class="form-control" placeholder="Optional" />
                </div>

                <div class="col-12">
                  <label class="form-label">Description</label>
                  <textarea v-model="itemForm.description" class="form-control" rows="2" placeholder="Short, appetizing description…"></textarea>
                </div>

                <div class="col-md-4">
                  <div class="form-check form-switch">
                    <input id="ifAvail" v-model="itemForm.is_available" class="form-check-input" type="checkbox" />
                    <label class="form-check-label" for="ifAvail">Available</label>
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="form-check form-switch">
                    <input id="ifCombo" v-model="itemForm.is_combo" class="form-check-input" type="checkbox" />
                    <label class="form-check-label" for="ifCombo">Combo item</label>
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="form-check form-switch" title="Off for items that don't need kitchen prep (drinks, packaged stock).">
                    <input id="ifSTK" v-model="itemForm.send_to_kitchen" class="form-check-input" type="checkbox" />
                    <label class="form-check-label" for="ifSTK">Send to kitchen</label>
                  </div>
                </div>
              </div>

              <!-- Modifiers section — works in both create and edit mode -->
              <div class="modifier-block mt-4">
                <div class="d-flex align-items-center justify-content-between mb-2">
                  <div>
                    <div class="fw-semibold">Modifier groups</div>
                    <div class="text-muted small">
                      <template v-if="editingItem">Assign groups (Size, Toppings…) to drive POS prompts. Changes save immediately.</template>
                      <template v-else>Pick groups now — they'll be attached after the item is created.</template>
                    </div>
                  </div>
                  <div v-if="loadingMods || savingMods" class="small text-muted">
                    <span class="spinner-border spinner-border-sm me-1"></span> Working…
                  </div>
                </div>

                <div v-if="loadingMods" class="text-muted small">Loading modifier groups…</div>
                <div v-else-if="modifierGroups.length === 0" class="alert alert-light border small mb-0">
                  <i class="ri-information-line me-1"></i>
                  No modifier groups found. Create some in the Modifiers screen first.
                </div>
                <div v-else class="row g-2">
                  <div v-for="g in modifierGroups" :key="g.id" class="col-12 col-md-6">
                    <label class="modifier-pick" :class="{ active: isGroupChecked(g.id) }">
                      <input
                        type="checkbox"
                        class="form-check-input m-0"
                        :disabled="savingMods"
                        :checked="isGroupChecked(g.id)"
                        @change="(e) => toggleGroup(editingItem, g.id, e.target.checked)"
                      />
                      <div class="flex-grow-1">
                        <div class="fw-semibold">{{ g.name }}</div>
                        <div class="text-muted small">{{ ruleLabel(g) }}</div>
                      </div>
                      <i v-if="isGroupChecked(g.id)" class="ri-check-line text-primary"></i>
                    </label>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" @click="closeItemModal" :disabled="savingItem">Cancel</button>
            <button type="button" class="btn btn-primary" :disabled="savingItem" @click="saveItem">
              <span v-if="savingItem" class="spinner-border spinner-border-sm me-1"></span>
              {{ editingItem ? "Update item" : "Create item" }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Quick price modal ============== -->
    <div class="modal fade" id="priceModal" tabindex="-1">
      <div class="modal-dialog modal-sm modal-dialog-centered">
        <div class="modal-content" v-if="editingPrice">
          <div class="modal-header">
            <h5 class="modal-title">Update price</h5>
            <button type="button" class="btn-close" @click="closePriceEdit"></button>
          </div>
          <div class="modal-body">
            <div class="fw-semibold mb-2">{{ editingPrice.name }}</div>
            <label class="form-label small">New price (K)</label>
            <input
              v-model="priceForm.price"
              type="number"
              step="0.01"
              min="0.01"
              class="form-control form-control-lg"
              @keyup.enter="savePrice"
              autofocus
            />
          </div>
          <div class="modal-footer">
            <button class="btn btn-light" @click="closePriceEdit" :disabled="savingPrice">Cancel</button>
            <button class="btn btn-primary" @click="savePrice" :disabled="savingPrice">
              <span v-if="savingPrice" class="spinner-border spinner-border-sm me-1"></span>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Bulk price modal ============== -->
    <div class="modal fade" id="bulkPriceModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Bulk price update</h5>
            <button type="button" class="btn-close" @click="closeBulkPrice"></button>
          </div>
          <div class="modal-body">
            <p class="small text-muted mb-3">
              Apply to <strong>{{ selectedCount }}</strong> selected item{{ selectedCount === 1 ? '' : 's' }}.
              Items where the new price would be ≤ 0 are skipped.
            </p>
            <div class="row g-2">
              <div class="col-12 col-md-6">
                <label class="form-label small">Action</label>
                <select v-model="bulkPriceForm.mode" class="form-select">
                  <option value="increase_pct">Increase by percent</option>
                  <option value="decrease_pct">Decrease by percent</option>
                  <option value="increase_amount">Increase by amount</option>
                  <option value="decrease_amount">Decrease by amount</option>
                  <option value="set">Set to fixed price</option>
                </select>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label small">
                  Value
                  <span class="text-muted small" v-if="bulkPriceForm.mode.includes('pct')">(%)</span>
                  <span class="text-muted small" v-else>(K)</span>
                </label>
                <input
                  v-model="bulkPriceForm.value"
                  type="number"
                  step="0.01"
                  min="0"
                  class="form-control"
                  :placeholder="bulkPriceForm.mode.includes('pct') ? 'e.g. 10 for 10%' : 'e.g. 5.00'"
                />
              </div>
              <div class="col-12">
                <label class="form-label small">Round to (optional)</label>
                <select v-model="bulkPriceForm.round_to" class="form-select form-select-sm">
                  <option value="">No rounding</option>
                  <option value="0.5">Nearest K0.50</option>
                  <option value="1">Nearest K1</option>
                  <option value="5">Nearest K5</option>
                  <option value="10">Nearest K10</option>
                </select>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-light" @click="closeBulkPrice" :disabled="savingBulk">Cancel</button>
            <button class="btn btn-primary" @click="submitBulkPrice" :disabled="savingBulk">
              <span v-if="savingBulk" class="spinner-border spinner-border-sm me-1"></span>
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Outlet overrides modal ============== -->
    <div class="modal fade" id="overridesModal" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <div>
              <h5 class="modal-title mb-0">Outlet overrides</h5>
              <div class="text-muted small" v-if="overridingItem">
                {{ overridingItem.name }} — set per-outlet price &amp; availability
              </div>
            </div>
            <button type="button" class="btn-close" @click="closeOverrides"></button>
          </div>
          <div class="modal-body">
            <div v-if="loadingOverrides" class="d-flex align-items-center gap-2 text-muted">
              <span class="spinner-border spinner-border-sm"></span> Loading overrides…
            </div>
            <div v-else>
              <div v-if="!outlets.length" class="text-center text-muted py-4">
                No outlets found. Create outlets first.
              </div>
              <div v-else class="table-responsive">
                <table class="table align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Outlet</th>
                      <th style="width: 200px">Price override</th>
                      <th style="width: 220px">Availability</th>
                      <th class="text-end" style="width: 200px">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="o in outlets" :key="o.id">
                      <td class="fw-semibold">{{ o.name }}</td>
                      <td>
                        <input
                          v-model="(overrideDraft[o.id] ||= { price_override: '', is_available_override: '' }).price_override"
                          type="number"
                          step="0.01"
                          class="form-control form-control-sm"
                          placeholder="blank = none"
                        />
                      </td>
                      <td>
                        <select
                          v-model="(overrideDraft[o.id] ||= { price_override: '', is_available_override: '' }).is_available_override"
                          class="form-select form-select-sm"
                        >
                          <option value="">Inherit</option>
                          <option value="1">Available</option>
                          <option value="0">Unavailable</option>
                        </select>
                      </td>
                      <td class="text-end">
                        <button class="btn btn-sm btn-primary me-1" @click="saveOverride(o.id)">Save</button>
                        <button class="btn btn-sm btn-soft-danger" @click="clearOverride(o.id)">Clear</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="text-muted small mt-2">
                <i class="ri-information-line me-1"></i>
                Blank = no override. The item will use its normal price/availability.
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-light" @click="closeOverrides">Close</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Public Menu (QR) modal ============== -->
    <div class="modal fade" id="publicMenuModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered" style="max-width: 420px;">
        <div class="modal-content modal-modern">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">Public Menu</div>
              <h5 class="modal-title">Menu QR Code</h5>
            </div>
            <button type="button" class="btn-close" @click="closePublicMenu"></button>
          </div>
          <div class="modal-body modal-body-modern text-center">
            <div v-if="loadingStore" class="py-4">
              <div class="spinner-border" role="status"></div>
              <div class="mt-2">Loading store…</div>
            </div>
            <div v-else>
              <div class="qr-frame">
                <QrcodeVue
                  v-if="publicMenuUrl"
                  ref="qrRef"
                  :value="publicMenuUrl"
                  :size="220"
                  level="M"
                  render-as="canvas"
                />
              </div>
              <p class="small text-muted mb-1 mt-3">
                Scan with your phone to view your restaurant's public menu.
              </p>
              <p
                v-if="publicMenuUrl"
                class="small text-break text-muted mb-3 qr-link"
                role="button"
                title="Click to copy link"
                @click="copyPublicMenuLink"
              >
                {{ publicMenuUrl }}
              </p>
              <div class="d-flex justify-content-center gap-2 flex-wrap">
                <button class="btn btn-soft-primary btn-sm" @click="downloadQrPng">
                  <i class="ri-download-line me-1"></i> Download
                </button>
                <button class="btn btn-soft-primary btn-sm" @click="printQr">
                  <i class="ri-printer-line me-1"></i> Print
                </button>
                <button
                  class="btn btn-soft-primary btn-sm"
                  :disabled="downloading"
                  @click="downloadQrPdf"
                >
                  <i class="ri-file-pdf-2-line me-1"></i>
                  <span v-if="downloading">…</span>
                  <span v-else>PDF</span>
                </button>
                <a
                  class="btn btn-primary btn-sm"
                  :href="publicMenuUrl"
                  target="_blank"
                  rel="noopener"
                >
                  <i class="ri-external-link-line me-1"></i> Open Menu
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
.rotating { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ================== Hero header ================== */
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
.page-hero-text {
  position: relative;
  max-width: 560px;
}
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
.page-hero-actions .btn-light:hover {
  background: #fff;
  color: #1e293b;
}
.btn-cta {
  background: #fff !important;
  color: #6366f1 !important;
  font-weight: 700;
  border: none;
  box-shadow: 0 8px 16px -8px rgba(0, 0, 0, 0.3);
}
.btn-cta:hover {
  background: #fff !important;
  color: #4f46e5 !important;
}

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}

/* Toolbar */
.toolbar-card {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.04) 0%, transparent 100%);
}
.search-wrap { min-width: 260px; flex: 1 1 260px; max-width: 380px; }
.search-ico {
  position: absolute;
  left: 0.85rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8);
  pointer-events: none;
}
.view-toggle .btn { padding: 0.25rem 0.6rem; }

/* Bulk action bar */
.bulk-bar {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.06));
  border: 1px solid rgba(99, 102, 241, 0.18);
  border-radius: 14px;
  padding: 0.65rem 1rem;
}
.bulk-count {
  display: inline-flex;
  align-items: center;
  font-weight: 600;
  color: #4f46e5;
}

/* Menu tile */
.menu-tile {
  background: var(--ct-card-bg, #fff);
  border: 1.5px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
  color: var(--ct-body-color, #1e293b);
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.menu-tile:hover {
  transform: translateY(-2px);
  box-shadow: var(--ct-box-shadow, 0 12px 24px rgba(15, 23, 42, 0.08));
  border-color: rgba(99, 102, 241, 0.35);
}
.menu-tile.selected {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
}
.menu-tile.unavailable {
  opacity: 0.7;
}

.tile-check {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 3;
  background: rgba(var(--ct-card-bg-rgb, 255, 255, 255), 0.95);
  border-radius: 6px;
  padding: 2px 5px;
  box-shadow: var(--ct-box-shadow-sm, 0 2px 6px rgba(0, 0, 0, 0.12));
  margin: 0;
  cursor: pointer;
}

.tile-image {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--ct-tertiary-bg, #f8fafc);
  cursor: pointer;
}
.tile-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tile-image-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--ct-secondary-color, #94a3b8);
}
.tile-image-placeholder i { font-size: 1.8rem; }
.tile-image-placeholder small { display: block; margin-top: 0.25rem; }
.tile-uploading {
  position: absolute;
  inset: 0;
  background: rgba(var(--ct-body-bg-rgb, 255, 255, 255), 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
}
.tile-status-pill {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  backdrop-filter: blur(4px);
}
.tile-status-off {
  background: rgba(245, 158, 11, 0.9);
  color: #fff;
}

.tile-body {
  padding: 0.75rem;
  flex-grow: 1;
  cursor: pointer;
}
.tile-name {
  font-weight: 700;
  font-size: 0.92rem;
  color: var(--ct-body-color, #1e293b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 0.4rem;
}
.tile-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  min-height: 22px;
  margin-bottom: 0.5rem;
}
.tile-price {
  display: inline-flex;
  align-items: center;
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--ct-body-color, #1e293b);
  background: none;
  border: none;
  padding: 0;
  letter-spacing: -0.01em;
}
.tile-price-edit {
  font-size: 0.85rem;
  color: var(--ct-secondary-color, #94a3b8);
  margin-left: 0.4rem;
  transition: color 0.15s ease;
}
.tile-price:hover .tile-price-edit { color: var(--ct-primary, #6366f1); }

/* Cost / food-cost % below the price (grid view) */
.tile-cost {
  margin-top: 0.4rem;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-size: 0.72rem;
  color: var(--ct-secondary-color, #64748b);
}
.tile-cost.no-recipe {
  font-style: italic;
}
.tile-cost.no-recipe i { font-size: 0.85rem; }

.cost-amount {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  color: var(--ct-body-color, #1e293b);
}
.cost-amount i {
  color: var(--ct-secondary-color, #94a3b8);
  font-size: 0.85rem;
}

.cost-loading {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.7rem;
  color: var(--ct-secondary-color, #94a3b8);
}
.cost-loading .spinner-border-sm { width: 0.75rem; height: 0.75rem; border-width: 1.5px; }

/* Food-cost % pill — color tracks status (ok / high / na) */
.fc-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.18rem;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  border: 1px solid transparent;
  font-family: "Plus Jakarta Sans", sans-serif;
}
.fc-pill i { font-size: 0.7rem; }
.fc-pill.fc-ok {
  background: rgba(16, 185, 129, 0.14);
  color: #047857;
  border-color: rgba(16, 185, 129, 0.22);
}
.fc-pill.fc-high {
  background: rgba(239, 68, 68, 0.12);
  color: #b91c1c;
  border-color: rgba(239, 68, 68, 0.22);
}
.fc-pill.fc-na {
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  border-color: var(--ct-border-color, #e6e9ef);
}

.tile-actions {
  display: flex;
  gap: 0.3rem;
  padding: 0.55rem 0.75rem;
  border-top: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-tertiary-bg, #fafbfc);
}
.tile-actions .btn { padding: 0.3rem 0.55rem; font-size: 0.78rem; }
.tile-actions .btn:not(.flex-grow-1) { padding: 0.3rem 0.5rem; }

/* List view */
.list-thumb {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: var(--ct-tertiary-bg, #f8fafc);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  color: var(--ct-secondary-color, #94a3b8);
}
.list-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.row-selected td { background: rgba(99, 102, 241, 0.04) !important; }
.row-dim td { opacity: 0.7; }

/* Modal save overlay */
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

/* Modifier picker */
.modifier-block {
  border-top: 1px dashed var(--ct-border-color, #e6e9ef);
  padding-top: 1rem;
}
.modifier-pick {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.6rem 0.75rem;
  border: 1.5px solid var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
  margin: 0;
}
.modifier-pick:hover { border-color: rgba(99, 102, 241, 0.35); }
.modifier-pick.active {
  border-color: var(--ct-primary, #6366f1);
  background: rgba(99, 102, 241, 0.06);
}

/* ================== Modern modal (mirrors POS pattern) ================== */
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

/* QR frame — gradient bezel like POS */
:deep(.qr-frame) {
  display: inline-block;
  padding: 0.85rem;
  border-radius: 16px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  box-shadow: 0 14px 30px -14px rgba(99, 102, 241, 0.55);
}
:deep(.qr-frame canvas),
:deep(.qr-frame img) {
  width: 220px;
  height: 220px;
  background: #fff;
  border-radius: 10px;
  display: block;
  padding: 6px;
}

.qr-link {
  cursor: pointer;
  transition: color 0.15s ease;
}
.qr-link:hover {
  color: var(--ct-primary, #6366f1) !important;
}

/* Fade transition */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
