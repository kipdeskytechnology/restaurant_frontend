<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useToast } from "vue-toastification";

import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { StatusBadge, EmptyState, LoadingState } from "../../components/ui";

import {
  openOrder,
  getOrder,
  addOrderLine,
  updateOrderLine,
  deleteOrderLine,
  applyOrderDiscount,
  removeOrderDiscount,
  updateOrder,
  addLineModifier,
  deleteLineModifier,
  payOrder,
  splitPayOrder,
  holdOrder,
  sendOrderToKitchen,
} from "../../api/orders";
import { listCashDrawers, getCurrentShift } from "../../api/cash";
import { listMenuItems, listMenuCategories } from "../../api/menu";
import { listDiscounts } from "../../api/setupDiscounts";
import { listItemModifierGroups, listModifierOptions } from "../../api/modifiers";
import { listOutlets } from "../../api/lookups";

const router = useRouter();
const route = useRoute();
const toast = useToast();

const apiBase = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";
function imageSrc(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${apiBase}${url}`;
}

// ===== state =====
const step = ref("setup"); // setup | build
const loading = ref(false);
const busy = ref(false);

const outlets = ref([]);
const drawers = ref([]);
const currentShift = ref(null);
const menuItems = ref([]);
const menuCategories = ref([]);
const discounts = ref([]);
const order = ref(null);

const setup = ref({
  outlet_id: "",
  cash_drawer_id: "",
  shift_id: null,
  order_type: "DINE_IN",
  table_no: "",
  customer_name: "",
  customer_phone: "",
  note: "",
});

const filters = ref({
  q: "",
  category_id: null, // null = All
});

const searchInput = ref(null);

const orderTypes = [
  { k: "DINE_IN",  label: "Dine In",  icon: "ri-restaurant-2-line" },
  { k: "TAKEAWAY", label: "Takeaway", icon: "ri-takeaway-line" },
  { k: "DELIVERY", label: "Delivery", icon: "ri-bike-line" },
];

// ===== formatters =====
function money(v) {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function shortQty(v) {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// ===== setup loaders =====
async function loadOutlets() {
  try {
    outlets.value = (await listOutlets()) || [];
  } catch (e) {
    outlets.value = [];
  }
}

async function loadDrawersForOutlet(outletId) {
  drawers.value = [];
  setup.value.cash_drawer_id = "";
  setup.value.shift_id = null;
  currentShift.value = null;

  try {
    const data = await listCashDrawers({ outlet_id: outletId, active: "1" });
    drawers.value = Array.isArray(data) ? data : [];
    if (drawers.value.length > 0) {
      setup.value.cash_drawer_id = String(drawers.value[0].id);
    }
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load drawers");
  }
}

async function loadCurrentShift(outletId, drawerId) {
  setup.value.shift_id = null;
  currentShift.value = null;
  try {
    const s = await getCurrentShift(outletId, drawerId);
    if (s?.id) {
      currentShift.value = s;
      setup.value.shift_id = s.id;
    }
  } catch (e) {
    // silent — UI shows "no open shift" state
  }
}

watch(() => setup.value.outlet_id, async (v) => {
  if (v) await loadDrawersForOutlet(Number(v));
});
watch(() => setup.value.cash_drawer_id, async (v) => {
  if (v && setup.value.outlet_id) {
    await loadCurrentShift(Number(setup.value.outlet_id), Number(v));
  }
});

const canStart = computed(() =>
  !!setup.value.outlet_id && !!setup.value.cash_drawer_id && !!setup.value.shift_id
);

// ===== open order =====
async function startOrder() {
  if (!canStart.value) {
    toast.warning("Pick outlet + drawer with an OPEN shift first");
    return;
  }
  busy.value = true;
  try {
    const o = await openOrder({
      outlet_id: Number(setup.value.outlet_id),
      shift_id: Number(setup.value.shift_id),
      order_type: setup.value.order_type,
      table_no: setup.value.table_no || null,
      note: setup.value.note || null,
      customer_id: null,
      customer_name: setup.value.customer_name?.trim() || null,
      customer_phone: setup.value.customer_phone?.trim() || null,
    });
    order.value = o;
    step.value = "build";
    await loadCatalog();
    await nextTick();
    searchInput.value?.focus();
    toast.success(`Order ${o.order_no || ('#' + o.id)} opened`);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to open order");
  } finally {
    busy.value = false;
  }
}

async function loadCatalog() {
  try {
    const [items, cats, discs] = await Promise.all([
      listMenuItems({ limit: 500, available: "1" }),
      listMenuCategories(),
      listDiscounts(),
    ]);
    menuItems.value = items || [];
    menuCategories.value = cats || [];
    discounts.value = discs || [];
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load menu");
  }
}

async function refreshOrder() {
  if (!order.value?.id) return;
  try {
    order.value = await getOrder(order.value.id);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to refresh order");
  }
}

// ===== filtered items =====
const filteredItems = computed(() => {
  let items = menuItems.value || [];
  if (filters.value.category_id != null) {
    items = items.filter((it) => it.category_id === filters.value.category_id);
  }
  const q = filters.value.q.trim().toLowerCase();
  if (q) {
    items = items.filter((it) =>
      String(it.name || "").toLowerCase().includes(q) ||
      String(it.sku || "").toLowerCase().includes(q)
    );
  }
  return items;
});

// ===== modifier picker =====
const modModalEl = ref(null);
let modInstance = null;
const modState = ref(null);
// modState shape: { mode, lineId, menuItemId, title, unitPrice, image, qty, note,
//                   send_to_kitchen, groups: [{group, options}], selectedByGroup: {gid: Set}, existingMap }

async function ensureModInstance() {
  if (modInstance) return;
  const el = modModalEl.value;
  if (!el) return;
  try {
    const m = await import("bootstrap/js/dist/modal");
    modInstance = new m.default(el, { backdrop: "static", keyboard: true });
  } catch {
    modInstance = window.bootstrap?.Modal ? new window.bootstrap.Modal(el, { backdrop: "static", keyboard: true }) : null;
  }
}

function ensureGroupSet(gid) {
  if (!modState.value.selectedByGroup[gid]) modState.value.selectedByGroup[gid] = new Set();
  return modState.value.selectedByGroup[gid];
}

function isOptSelected(gid, oid) {
  return ensureGroupSet(gid).has(oid);
}

function toggleOpt(group, opt) {
  const max = Number(group.max_select ?? 1);
  const s = ensureGroupSet(group.id);
  if (max === 1) { s.clear(); s.add(opt.id); }
  else if (s.has(opt.id)) s.delete(opt.id);
  else {
    if (max > 0 && s.size >= max) {
      toast.warning(`Max ${max} for "${group.name}"`);
      return;
    }
    s.add(opt.id);
  }
  // force reactivity
  modState.value = { ...modState.value, selectedByGroup: { ...modState.value.selectedByGroup, [group.id]: new Set(s) } };
}

function modifierLineRule(g) {
  const min = Number(g.min_select ?? 0);
  const max = Number(g.max_select ?? 1);
  if (min === 0 && max === 1) return "Optional · pick 1";
  if (min === 1 && max === 1) return "Required · pick 1";
  if (min === 0 && max > 1) return `Optional · up to ${max}`;
  if (min >= 1 && max > 1) return `Required · pick ${min}–${max}`;
  return `Min ${min} · Max ${max}`;
}

function selectedFlatIds() {
  const ids = new Set();
  for (const g of Object.values(modState.value?.selectedByGroup || {})) {
    for (const id of g) ids.add(Number(id));
  }
  return [...ids];
}

function validateMods() {
  for (const gg of modState.value.groups) {
    const min = Number(gg.group.min_select ?? 0);
    const max = Number(gg.group.max_select ?? 1);
    const s = ensureGroupSet(gg.group.id);
    if (min > 0 && s.size < min) {
      toast.error(`Pick at least ${min} for "${gg.group.name}"`);
      return false;
    }
    if (max > 0 && s.size > max) {
      toast.error(`Too many in "${gg.group.name}" (max ${max})`);
      return false;
    }
  }
  return true;
}

async function loadGroups(menuItemId) {
  const mappings = await listItemModifierGroups(menuItemId);
  const groups = [];
  for (const m of mappings || []) {
    const g = m.group || m;
    const gid = g.group_id || g.id || m.group_id;
    if (!gid) continue;
    const opts = await listModifierOptions(gid);
    groups.push({
      group: {
        id: gid,
        name: g.name || "Modifiers",
        min_select: Number(g.min_select ?? 0),
        max_select: Number(g.max_select ?? 1),
      },
      options: (opts || []).filter((o) => o.is_active),
    });
  }
  return groups;
}

async function tapItem(item) {
  // open the picker (unconditionally — gives the cashier a chance to set qty/note even if no mods)
  busy.value = true;
  try {
    const groups = await loadGroups(item.id);
    modState.value = {
      mode: "add",
      lineId: null,
      menuItemId: item.id,
      title: item.name,
      sku: item.sku,
      unitPrice: item.price ?? 0,
      image: item.image_url || null,
      qty: "1",
      note: "",
      groups,
      selectedByGroup: {},
      existingMap: {},
    };
    // pre-select defaults
    for (const gg of groups) {
      const s = ensureGroupSet(gg.group.id);
      for (const opt of gg.options || []) {
        if (opt.is_default) s.add(opt.id);
      }
    }

    // Fast path: no modifier groups + qty=1 → add directly without opening modal
    if (!groups.length) {
      await confirmModifierAdd();
      return;
    }

    await ensureModInstance();
    modInstance?.show();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load item options");
  } finally {
    busy.value = false;
  }
}

async function editLine(line) {
  busy.value = true;
  try {
    const groups = await loadGroups(line.menu_item_id);
    const existing = {};
    for (const m of line.modifiers || []) existing[Number(m.modifier_option_id)] = m.id;

    modState.value = {
      mode: "edit",
      lineId: line.id,
      menuItemId: line.menu_item_id,
      title: line.item_name,
      sku: null,
      unitPrice: line.unit_price ?? 0,
      image: line.item_image_url || null,
      qty: String(line.qty ?? "1"),
      note: line.note || "",
      groups,
      selectedByGroup: {},
      existingMap: existing,
    };
    for (const gg of groups) {
      const s = ensureGroupSet(gg.group.id);
      for (const opt of gg.options || []) {
        if (existing[Number(opt.id)]) s.add(opt.id);
      }
    }
    await ensureModInstance();
    modInstance?.show();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load item");
  } finally {
    busy.value = false;
  }
}

function closeMod() {
  modInstance?.hide();
}

async function confirmModifierAdd() {
  if (!modState.value) return;
  const qty = Number(modState.value.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    toast.error("Qty must be > 0");
    return;
  }
  if (!validateMods()) return;
  const optionIds = selectedFlatIds();
  const note = modState.value.note?.trim() || null;

  busy.value = true;
  try {
    if (modState.value.mode === "add") {
      const updated = await addOrderLine(order.value.id, {
        line_type: "MENU_ITEM",
        menu_item_id: Number(modState.value.menuItemId),
        qty,
        unit_price: null,
        note,
        // send_to_kitchen is intentionally NOT set here. The kitchen pipeline
        // is owned by Pay After / Pay Now (which call /send-to-kitchen). That
        // call also respects each MenuItem.send_to_kitchen flag — drinks
        // skip the KDS automatically. Pre-setting True here would put the
        // line into a zombie state that the idempotent re-send check skips.
        modifier_option_ids: optionIds,
      });
      order.value = updated;
      toast.success("Added");
      closeMod();
    } else {
      // edit: line first, then diff modifiers.
      // (send_to_kitchen is owned by Pay After / Pay Now; not toggleable per-line.)
      let upd = await updateOrderLine(modState.value.lineId, {
        qty,
        note,
      });
      order.value = upd;

      const existing = modState.value.existingMap || {};
      const existingIds = new Set(Object.keys(existing).map((x) => Number(x)));
      const newIds = new Set(optionIds);

      for (const oid of existingIds) {
        if (!newIds.has(oid)) {
          const lineModId = existing[oid];
          if (lineModId) order.value = await deleteLineModifier(lineModId);
        }
      }
      for (const oid of newIds) {
        if (!existingIds.has(oid)) {
          order.value = await addLineModifier(modState.value.lineId, Number(oid));
        }
      }
      toast.success("Updated");
      closeMod();
    }
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Save failed");
  } finally {
    busy.value = false;
  }
}

// ===== cart line actions =====
async function bumpQty(line, delta) {
  const newQty = Number(line.qty) + delta;
  if (newQty <= 0) return removeLine(line);
  try {
    order.value = await updateOrderLine(line.id, { qty: newQty });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update qty");
  }
}

async function removeLine(line) {
  if (!confirm(`Remove "${line.item_name}"?`)) return;
  try {
    order.value = await deleteOrderLine(line.id);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to remove");
  }
}

// ===== discounts =====
const orderDiscountsAvail = computed(() =>
  (discounts.value || []).filter((d) => d.is_active && String(d.scope).toUpperCase() === "ORDER")
);
function isDiscountApplied(id) {
  return (order.value?.discounts || []).some((x) => x.discount_id === id);
}
async function toggleDiscount(d) {
  if (!order.value?.id) return;
  busy.value = true;
  try {
    if (isDiscountApplied(d.id)) {
      order.value = await removeOrderDiscount(order.value.id, d.id);
    } else {
      order.value = await applyOrderDiscount(order.value.id, d.id);
    }
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update discount");
  } finally {
    busy.value = false;
  }
}

// ===== send to kitchen / hold =====
// Internal helper. Returns true on success, false on failure.
// `silent` suppresses the toast so callers (Pay Now) can show their own.
async function _sendToKitchen({ silent = false } = {}) {
  if (!order.value?.id) return false;
  try {
    order.value = await sendOrderToKitchen(order.value.id, null);
    if (!silent) toast.success("Sent to kitchen");
    return true;
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Send to kitchen failed");
    return false;
  }
}

// "Pay After" — fire to the kitchen now, customer pays at the end of the meal
// (classic dine-in / table-service). Order stays OPEN. We reset the POS to a
// fresh setup so the cashier can take the next customer immediately.
async function payAfter() {
  if (!order.value?.id) return;
  busy.value = true;
  try {
    const ok = await _sendToKitchen({ silent: true });
    if (!ok) return;
    toast.success(`Order ${order.value.order_no} sent — pay after`);
    resetForNewOrder();
  } finally {
    busy.value = false;
  }
}

// "Pay Now" — open the payment modal directly. The kitchen ticket fires only
// AFTER payment is confirmed (see submitPay / submitSplit). This avoids the
// "we already started cooking" problem if the customer's card is declined or
// they change their mind at the till.
async function payNow() {
  if (!order.value?.id) return;
  await openPay();
}

async function holdCurrent() {
  if (!order.value?.id) return;
  if (!confirm("Hold this order? You can resume it from Orders.")) return;
  busy.value = true;
  try {
    order.value = await holdOrder(order.value.id);
    toast.success("Order held");
    // exit to a fresh setup
    resetForNewOrder();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Hold failed");
  } finally {
    busy.value = false;
  }
}

function resetForNewOrder() {
  order.value = null;
  step.value = "setup";
  filters.value = { q: "", category_id: null };
}

// ===== pay =====
const payTab = ref("single"); // single | split
const payForm = ref({ method: "CASH", reference: "", discount_amount: "" });
const payInstance = ref(null);
const payModalEl = ref(null);

// split pay state
const splitMode = ref("even"); // even | custom | by_items
const splitWays = ref(2);
const splitTenders = ref([]); // [{method, amount, reference}]

// by-items split state
//
// `lineAllocations[lineId]` is an array of length === bills.length holding the qty
// of that line going to each bill. Sum across the array MUST equal line.qty for
// the bill to be valid. The default for a line is qty on bill 0, zero elsewhere
// (the "whole-line" case). Fractional splits set non-zero qty on multiple bills.
const byItems = ref({
  bills: [
    { method: "CASH", reference: "Person 1" },
    { method: "CASH", reference: "Person 2" },
  ],
  lineAllocations: {}, // lineId -> [q_for_bill0, q_for_bill1, ...]
});

// per-line "currently editing split" UI state — set of line ids
const lineSplitOpen = ref(new Set());

async function ensurePayModal() {
  if (payInstance.value) return;
  const el = payModalEl.value;
  if (!el) return;
  try {
    const m = await import("bootstrap/js/dist/modal");
    payInstance.value = new m.default(el, { backdrop: "static" });
  } catch {
    payInstance.value = window.bootstrap?.Modal ? new window.bootstrap.Modal(el) : null;
  }
}

async function openPay() {
  if (!order.value?.lines?.length) {
    toast.warning("Cart is empty");
    return;
  }
  payTab.value = "single";
  payForm.value = { method: "CASH", reference: "", discount_amount: "" };
  splitMode.value = "even";
  splitWays.value = 2;
  // reset by-items: each line wholly on bill 0
  const allocs = {};
  for (const ln of (order.value?.lines || [])) {
    allocs[ln.id] = [Number(ln.qty || 0), 0]; // 2 bills initially
  }
  byItems.value = {
    bills: [
      { method: "CASH", reference: "Person 1" },
      { method: "CASH", reference: "Person 2" },
    ],
    lineAllocations: allocs,
  };
  lineSplitOpen.value = new Set();
  rebuildEvenSplit();
  await ensurePayModal();
  payInstance.value?.show();
}
function closePay() { payInstance.value?.hide(); }

async function submitPay() {
  if (!order.value?.id) return;
  const payload = {
    method: payForm.value.method || "CASH",
    reference: payForm.value.reference?.trim() || null,
  };
  if (payForm.value.discount_amount !== "" && Number(payForm.value.discount_amount) > 0) {
    payload.discount_amount = Number(payForm.value.discount_amount);
  }
  busy.value = true;
  try {
    const o = await payOrder(order.value.id, payload);
    order.value = o;
    // Payment confirmed — NOW send the ticket to the kitchen. Idempotent on
    // the backend, so a Pay-After order being settled at end-of-meal is a
    // safe no-op (kitchen already has it). We tolerate failure here: the
    // customer's payment is already captured; the cashier can resend the
    // kitchen ticket from Orders if needed.
    try { await _sendToKitchen({ silent: true }); } catch (_) {}
    toast.success("Paid");
    closePay();
    setTimeout(() => resetForNewOrder(), 600);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Payment failed");
  } finally {
    busy.value = false;
  }
}

// ----- split helpers -----
function roundCents(n) {
  return Math.round(Number(n) * 100) / 100;
}

function rebuildEvenSplit() {
  const ways = Math.max(2, Math.min(20, Number(splitWays.value) || 2));
  splitWays.value = ways;
  const total = roundCents(totals.value.total);
  if (total <= 0) {
    splitTenders.value = [];
    return;
  }
  const base = roundCents(total / ways);
  const arr = Array.from({ length: ways }, (_, i) => ({
    method: "CASH",
    amount: base.toFixed(2),
    reference: `Person ${i + 1}`,
  }));
  // adjust last to absorb rounding
  const summed = roundCents(base * ways);
  const drift = roundCents(total - summed);
  if (Math.abs(drift) > 0) {
    arr[arr.length - 1].amount = roundCents(Number(arr[arr.length - 1].amount) + drift).toFixed(2);
  }
  splitTenders.value = arr;
}

function startCustomSplit() {
  // start with two tenders, first holding the full total, second blank
  const total = roundCents(totals.value.total);
  splitTenders.value = [
    { method: "CASH", amount: total.toFixed(2), reference: "Person 1" },
    { method: "CASH", amount: "0.00", reference: "Person 2" },
  ];
}

function addTender() {
  splitTenders.value.push({
    method: "CASH",
    amount: "0.00",
    reference: `Person ${splitTenders.value.length + 1}`,
  });
}

function removeTender(idx) {
  if (splitTenders.value.length <= 2) {
    toast.warning("At least 2 tenders required for a split");
    return;
  }
  splitTenders.value.splice(idx, 1);
}

function distributeRemainderTo(idx) {
  const total = roundCents(totals.value.total);
  let othersSum = 0;
  splitTenders.value.forEach((t, i) => {
    if (i !== idx) othersSum += Number(t.amount) || 0;
  });
  const remaining = roundCents(total - othersSum);
  splitTenders.value[idx].amount = (remaining > 0 ? remaining : 0).toFixed(2);
}

const splitTotal = computed(() =>
  splitTenders.value.reduce((a, t) => a + (Number(t.amount) || 0), 0)
);
const splitDelta = computed(() =>
  roundCents(totals.value.total - splitTotal.value)
);

watch(splitMode, (m) => {
  if (m === "even") rebuildEvenSplit();
  else if (m === "custom" && splitTenders.value.length === 0) startCustomSplit();
  else if (m === "by_items") rebuildByItemsSplit();
});

watch(splitWays, () => { if (splitMode.value === "even") rebuildEvenSplit(); });

// ----- by-items split -----
function ensureLineAlloc(lineId, lineQty) {
  const arr = byItems.value.lineAllocations[lineId];
  const need = byItems.value.bills.length;
  if (!arr) {
    const fresh = Array(need).fill(0);
    fresh[0] = Number(lineQty || 0);
    byItems.value.lineAllocations = { ...byItems.value.lineAllocations, [lineId]: fresh };
    return fresh;
  }
  if (arr.length !== need) {
    const next = arr.slice();
    while (next.length < need) next.push(0);
    while (next.length > need) next.pop();
    byItems.value.lineAllocations = { ...byItems.value.lineAllocations, [lineId]: next };
    return next;
  }
  return arr;
}

function lineAssignedTotal(line) {
  const arr = byItems.value.lineAllocations[line.id] || [];
  return arr.reduce((a, n) => a + (Number(n) || 0), 0);
}

function lineIsBalanced(line) {
  return Math.abs(lineAssignedTotal(line) - Number(line.qty || 0)) < 0.0001;
}

function lineQtyOnBill(line, billIdx) {
  const arr = ensureLineAlloc(line.id, line.qty);
  return Number(arr[billIdx] || 0);
}

function lineIsWhollyOn(line, billIdx) {
  const arr = byItems.value.lineAllocations[line.id] || [];
  if (Math.abs(Number(arr[billIdx] || 0) - Number(line.qty || 0)) > 0.0001) return false;
  for (let i = 0; i < arr.length; i++) {
    if (i !== billIdx && Math.abs(Number(arr[i] || 0)) > 0.0001) return false;
  }
  return true;
}

function nonZeroBillsForLine(line) {
  const arr = byItems.value.lineAllocations[line.id] || [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const q = Number(arr[i] || 0);
    if (q > 0) out.push({ billIdx: i, qty: q });
  }
  return out;
}

function setLineWholly(line, billIdx) {
  const arr = ensureLineAlloc(line.id, line.qty).slice();
  for (let i = 0; i < arr.length; i++) arr[i] = (i === billIdx ? Number(line.qty || 0) : 0);
  byItems.value.lineAllocations = { ...byItems.value.lineAllocations, [line.id]: arr };
  rebuildByItemsSplit();
}

function setLineQtyOnBill(line, billIdx, value) {
  const arr = ensureLineAlloc(line.id, line.qty).slice();
  let q = Number(value);
  if (!Number.isFinite(q) || q < 0) q = 0;
  if (q > Number(line.qty || 0)) q = Number(line.qty || 0);
  arr[billIdx] = q;
  byItems.value.lineAllocations = { ...byItems.value.lineAllocations, [line.id]: arr };
  rebuildByItemsSplit();
}

function distributeRemainderToBill(line, billIdx) {
  const arr = ensureLineAlloc(line.id, line.qty).slice();
  let othersSum = 0;
  for (let i = 0; i < arr.length; i++) if (i !== billIdx) othersSum += Number(arr[i] || 0);
  let remainder = Number(line.qty || 0) - othersSum;
  if (remainder < 0) remainder = 0;
  arr[billIdx] = remainder;
  byItems.value.lineAllocations = { ...byItems.value.lineAllocations, [line.id]: arr };
  rebuildByItemsSplit();
}

function splitLineEvenly(line) {
  const n = byItems.value.bills.length;
  if (n === 0) return;
  const total = Number(line.qty || 0);
  const each = total / n;
  // round each except last to 2 decimals; last absorbs drift to keep sum exact
  const arr = Array(n).fill(0);
  let used = 0;
  for (let i = 0; i < n - 1; i++) {
    const v = Math.round(each * 1000) / 1000; // 3-dp internally to match line qty precision
    arr[i] = v;
    used += v;
  }
  arr[n - 1] = Math.round((total - used) * 1000) / 1000;
  byItems.value.lineAllocations = { ...byItems.value.lineAllocations, [line.id]: arr };
  rebuildByItemsSplit();
}

function isLineSplitOpen(lineId) {
  return lineSplitOpen.value.has(lineId);
}
function toggleLineSplitOpen(lineId) {
  const s = new Set(lineSplitOpen.value);
  if (s.has(lineId)) s.delete(lineId); else s.add(lineId);
  lineSplitOpen.value = s;
}

function addItemsBill() {
  if (byItems.value.bills.length >= 12) return;
  byItems.value.bills.push({
    method: "CASH",
    reference: `Person ${byItems.value.bills.length + 1}`,
  });
  // grow every allocation array with a 0 for the new bill
  const next = {};
  for (const k of Object.keys(byItems.value.lineAllocations)) {
    next[k] = [...byItems.value.lineAllocations[k], 0];
  }
  byItems.value.lineAllocations = next;
  rebuildByItemsSplit();
}

function removeItemsBill(idx) {
  if (byItems.value.bills.length <= 2) {
    toast.warning("Need at least 2 bills");
    return;
  }
  // roll the removed bill's qty back into bill 0
  const next = {};
  for (const k of Object.keys(byItems.value.lineAllocations)) {
    const arr = byItems.value.lineAllocations[k].slice();
    const rolled = Number(arr[idx] || 0);
    arr.splice(idx, 1);
    if (rolled > 0) {
      const fallbackIdx = idx === 0 ? 0 : 0; // dump back to bill 0
      arr[fallbackIdx] = Number(arr[fallbackIdx] || 0) + rolled;
    }
    next[k] = arr;
  }
  byItems.value.bills.splice(idx, 1);
  byItems.value.lineAllocations = next;
  rebuildByItemsSplit();
}

function billLineCount(idx) {
  let n = 0;
  for (const arr of Object.values(byItems.value.lineAllocations || {})) {
    if (Number(arr[idx] || 0) > 0) n++;
  }
  return n;
}

function rebuildByItemsSplit() {
  const lines = order.value?.lines || [];
  const orderTotal = roundCents(totals.value.total);
  const tip = Number(order.value?.tip_total || 0);

  // For each bill, sum (alloc_qty / line.qty) * line.total over all lines.
  // line.total already includes per-line tax + allocated order discount.
  const subs = byItems.value.bills.map((_, idx) => {
    let s = 0;
    for (const l of lines) {
      const arr = byItems.value.lineAllocations[l.id];
      if (!arr) continue;
      const allocQty = Number(arr[idx] || 0);
      const lineQty = Number(l.qty || 0);
      if (lineQty <= 0 || allocQty <= 0) continue;
      const lineTotal = Number(l.total ?? l.subtotal ?? 0);
      s += (allocQty / lineQty) * lineTotal;
    }
    return s;
  });

  const totalSub = subs.reduce((a, n) => a + n, 0);
  const amounts = subs.map((sub) => {
    const tipShare = totalSub > 0 ? (sub / totalSub) * tip : 0;
    return roundCents(sub + tipShare);
  });

  const sumComputed = roundCents(amounts.reduce((a, n) => a + n, 0));
  const drift = roundCents(orderTotal - sumComputed);
  if (Math.abs(drift) > 0.005) {
    for (let i = amounts.length - 1; i >= 0; i--) {
      if (amounts[i] > 0) {
        amounts[i] = roundCents(amounts[i] + drift);
        break;
      }
    }
  }

  splitTenders.value = byItems.value.bills.map((b, i) => ({
    method: b.method,
    reference: b.reference,
    amount: amounts[i].toFixed(2),
  }));
}

// keep splitTenders in sync when inputs change
watch(
  () => [
    splitMode.value,
    JSON.stringify(byItems.value.bills),
    JSON.stringify(byItems.value.lineAllocations),
    (order.value?.lines || []).map((l) => `${l.id}:${l.total}:${l.qty}`).join("|"),
    Number(order.value?.tip_total || 0),
  ],
  () => {
    if (splitMode.value === "by_items") rebuildByItemsSplit();
  }
);

// True when at least one line's allocation doesn't sum to its qty
const byItemsHasUnassigned = computed(() => {
  for (const l of (order.value?.lines || [])) {
    if (!lineIsBalanced(l)) return true;
  }
  return false;
});

function lineSubtotalDisplay(line) {
  return Number(line.total ?? line.subtotal ?? 0);
}

async function submitSplit() {
  if (!order.value?.id) return;
  if (splitTenders.value.length < 2) {
    toast.warning("Add at least 2 tenders");
    return;
  }
  // client-side guard — must match exact total
  if (Math.abs(splitDelta.value) > 0.005) {
    toast.error(`Split is off by K ${Math.abs(splitDelta.value).toFixed(2)}. Adjust before submitting.`);
    return;
  }
  for (const t of splitTenders.value) {
    if (!Number.isFinite(Number(t.amount)) || Number(t.amount) <= 0) {
      toast.error("Each tender must have an amount > 0");
      return;
    }
  }
  const payload = splitTenders.value.map((t) => ({
    method: t.method || "CASH",
    amount: Number(Number(t.amount).toFixed(2)),
    reference: (t.reference || "").trim() || null,
  }));

  busy.value = true;
  try {
    const o = await splitPayOrder(order.value.id, payload);
    order.value = o;
    // Payment confirmed — fire the kitchen ticket now. See submitPay() for
    // why this comes after payment, not before.
    try { await _sendToKitchen({ silent: true }); } catch (_) {}
    toast.success(`Paid (split into ${payload.length})`);
    closePay();
    setTimeout(() => resetForNewOrder(), 600);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Split payment failed");
  } finally {
    busy.value = false;
  }
}

// ===== totals =====
const totals = computed(() => ({
  subtotal: Number(order.value?.subtotal ?? 0),
  discount: Number(order.value?.discount_total ?? 0),
  tax: Number(order.value?.tax_total ?? 0),
  tip: Number(order.value?.tip_total ?? 0),
  total: Number(order.value?.total ?? 0),
  itemCount: (order.value?.lines || []).reduce((a, l) => a + Number(l.qty || 0), 0),
}));

// ===== keyboard =====
function handleGlobalKey(e) {
  if (step.value !== "build") return;
  // Ignore if focus is in an input/textarea (let user type freely)
  const tag = (e.target?.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  if (e.key === "/") {
    e.preventDefault();
    searchInput.value?.focus();
  } else if (e.key === "Escape") {
    filters.value.q = "";
  }
}

// ===== mount =====
onMounted(async () => {
  loading.value = true;
  await loadOutlets();
  loading.value = false;
  window.addEventListener("keydown", handleGlobalKey);

  // Allow ?orderId=N to deep-link into build mode
  const oid = route.query.orderId;
  if (oid) {
    try {
      busy.value = true;
      const o = await getOrder(Number(oid));
      if (o && o.status === "OPEN") {
        order.value = o;
        // best-effort outlet/drawer/shift fill (so Pay works without re-setup)
        setup.value.outlet_id = String(o.outlet_id || "");
        if (o.shift_id) setup.value.shift_id = o.shift_id;
        step.value = "build";
        await loadCatalog();
      }
    } catch {}
    finally { busy.value = false; }
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalKey);
});
</script>

<template>
  <DefaultLayout>
    <!-- ============== SETUP STEP ============== -->
    <div v-if="step === 'setup'" class="container-fluid py-2">
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-shopping-cart-2-line"></i>
            <span>POS</span>
          </div>
          <h1 class="hero-title">New Order</h1>
          <p class="hero-sub">Pick an outlet and a cash drawer, choose the order type, then start the ticket.</p>
        </div>
        <div class="page-hero-actions">
          <router-link to="/orders" class="btn btn-light btn-pill">
            <i class="ri-arrow-left-line"></i><span>Back to Orders</span>
          </router-link>
        </div>
      </div>

      <div class="row g-3">
        <div class="col-12 col-lg-7">
          <div class="card h-100">
            <div class="card-body">
              <div class="row g-3">
                <div class="col-12">
                  <label class="form-label small mb-1 text-muted">Order Type</label>
                  <div class="d-flex gap-2 flex-wrap">
                    <button
                      v-for="t in orderTypes"
                      :key="t.k"
                      class="order-type-btn"
                      :class="setup.order_type === t.k ? 'active' : ''"
                      @click="setup.order_type = t.k"
                    >
                      <i :class="t.icon" class="fs-3"></i>
                      <span>{{ t.label }}</span>
                    </button>
                  </div>
                </div>

                <div class="col-12 col-md-6">
                  <label class="form-label small mb-1 text-muted">Outlet *</label>
                  <select v-model="setup.outlet_id" class="form-select form-select-lg">
                    <option value="">— Select outlet —</option>
                    <option v-for="o in outlets" :key="o.id" :value="String(o.id)">{{ o.code }} — {{ o.name }}</option>
                  </select>
                </div>

                <div class="col-12 col-md-6">
                  <label class="form-label small mb-1 text-muted">Cash Drawer *</label>
                  <select v-model="setup.cash_drawer_id" class="form-select form-select-lg" :disabled="!setup.outlet_id">
                    <option value="">— Select drawer —</option>
                    <option v-for="d in drawers" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
                  </select>
                </div>

                <div class="col-12">
                  <div class="d-flex align-items-center gap-2 p-2 rounded" :class="currentShift ? 'bg-success-subtle' : 'bg-warning-subtle'">
                    <i :class="currentShift ? 'ri-checkbox-circle-line text-success' : 'ri-error-warning-line text-warning'" class="fs-4"></i>
                    <div class="flex-grow-1 small">
                      <div v-if="currentShift" class="fw-semibold text-success">
                        Shift OPEN — ID #{{ currentShift.id }}
                      </div>
                      <div v-else class="fw-semibold text-warning-emphasis">
                        No open shift. Open one in <router-link to="/cash/shifts">Cash → Shifts</router-link> first.
                      </div>
                    </div>
                    <button v-if="setup.cash_drawer_id"
                      class="btn btn-sm btn-outline-secondary"
                      @click="loadCurrentShift(Number(setup.outlet_id), Number(setup.cash_drawer_id))"
                    >
                      <i class="ri-refresh-line"></i>
                    </button>
                  </div>
                </div>

                <div class="col-12 col-md-4">
                  <label class="form-label small mb-1 text-muted">Table (optional)</label>
                  <input v-model="setup.table_no" type="text" class="form-control" placeholder="T1" />
                </div>
                <div class="col-12 col-md-4">
                  <label class="form-label small mb-1 text-muted">Customer phone</label>
                  <input v-model="setup.customer_phone" type="text" class="form-control" placeholder="097…" />
                </div>
                <div class="col-12 col-md-4">
                  <label class="form-label small mb-1 text-muted">Customer name</label>
                  <input v-model="setup.customer_name" type="text" class="form-control" placeholder="John" />
                </div>

                <div class="col-12">
                  <label class="form-label small mb-1 text-muted">Note</label>
                  <textarea v-model="setup.note" class="form-control" rows="2" placeholder="Kitchen / delivery note…"></textarea>
                </div>

                <div class="col-12 d-flex gap-2 mt-2">
                  <button class="btn btn-primary btn-lg flex-grow-1" :disabled="busy || !canStart" @click="startOrder">
                    <span v-if="busy" class="spinner-border spinner-border-sm me-1"></span>
                    <i v-else class="ri-play-circle-line me-1"></i>
                    Start Ticket
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-5">
          <div class="card h-100 bg-light">
            <div class="card-body">
              <h5 class="mb-3"><i class="ri-keyboard-line me-1"></i>Tips</h5>
              <ul class="small text-muted mb-0">
                <li>Press <kbd>/</kbd> on the order screen to focus the search bar.</li>
                <li>Tap any item — if it has modifiers, a chooser opens. Otherwise it's added straight to the cart.</li>
                <li>Use the cart's <strong>+ / −</strong> buttons to change quantity quickly.</li>
                <li><strong>Hold</strong> parks the order so you can recall it from Orders.</li>
                <li><strong>Pay After</strong> sends the ticket to the kitchen and leaves the order open — the customer pays at the end of the meal.</li>
                <li><strong>Pay Now</strong> sends to the kitchen and immediately opens the payment screen — pick a method (cash / card / mobile money) and close the ticket.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== BUILD STEP ============== -->
    <div v-else class="pos-shell">
      <!-- top bar -->
      <div class="pos-top">
        <div class="d-flex align-items-center gap-2 flex-grow-1">
          <button class="btn btn-light" @click="resetForNewOrder">
            <i class="ri-arrow-left-line"></i>
          </button>
          <div>
            <div class="fw-bold">{{ order?.order_no || `Order #${order?.id}` }}</div>
            <div class="small text-muted">
              <StatusBadge tone="success">{{ order?.status }}</StatusBadge>
              <span class="ms-2">{{ order?.order_type }}</span>
              <span v-if="order?.table_no" class="ms-2">• Table {{ order.table_no }}</span>
              <span v-if="order?.customer_name" class="ms-2">• {{ order.customer_name }}</span>
            </div>
          </div>
        </div>
        <button class="btn btn-light" @click="refreshOrder" :disabled="busy" title="Refresh">
          <i class="ri-refresh-line"></i>
        </button>
      </div>

      <!-- two-column main area -->
      <div class="pos-main">
        <!-- LEFT: catalog -->
        <div class="pos-catalog">
          <!-- search + categories -->
          <div class="pos-search-row">
            <div class="position-relative flex-grow-1">
              <i class="ri-search-line position-absolute top-50 translate-middle-y ms-3 text-muted"></i>
              <input
                ref="searchInput"
                v-model="filters.q"
                type="search"
                class="form-control form-control-lg ps-5"
                placeholder="Search items…  ( / to focus )"
              />
            </div>
          </div>

          <div class="pos-cats">
            <button
              class="cat-pill"
              :class="filters.category_id == null ? 'active' : ''"
              @click="filters.category_id = null"
            >
              All
              <small class="ms-1 opacity-75">{{ menuItems.length }}</small>
            </button>
            <button
              v-for="c in menuCategories"
              :key="c.id"
              class="cat-pill"
              :class="filters.category_id === c.id ? 'active' : ''"
              @click="filters.category_id = c.id"
            >
              {{ c.name }}
            </button>
          </div>

          <!-- item grid -->
          <div class="pos-items-scroll">
            <EmptyState
              v-if="!filteredItems.length"
              icon="ri-search-line"
              title="No items match"
              :message="filters.q ? `Nothing matches '${filters.q}'.` : 'No items in this category.'"
            />
            <div v-else class="pos-grid">
              <button
                v-for="item in filteredItems"
                :key="item.id"
                class="pos-item-tile"
                @click="tapItem(item)"
                :disabled="busy"
              >
                <div class="pos-tile-image">
                  <img v-if="item.image_url" :src="imageSrc(item.image_url)" :alt="item.name" />
                  <div v-else class="pos-tile-fallback">
                    <i class="ri-restaurant-line"></i>
                  </div>
                </div>
                <div class="pos-tile-name">{{ item.name }}</div>
                <div class="pos-tile-price">K {{ money(item.price) }}</div>
              </button>
            </div>
          </div>
        </div>

        <!-- RIGHT: cart -->
        <div class="pos-cart">
          <div class="pos-cart-header">
            <div class="fw-bold">
              <i class="ri-shopping-cart-2-line me-1"></i>
              Cart
              <span class="text-muted small fw-normal ms-1">({{ totals.itemCount }} item{{ totals.itemCount === 1 ? '' : 's' }})</span>
            </div>
          </div>

          <div class="pos-cart-lines">
            <EmptyState
              v-if="!order?.lines?.length"
              icon="ri-shopping-cart-line"
              title="Cart is empty"
              message="Tap items on the left to add them."
            />
            <div v-else>
              <div v-for="line in order.lines" :key="line.id" class="cart-line">
                <div class="cart-line-main">
                  <div class="cart-line-name" @click="editLine(line)" title="Edit modifiers / qty">
                    {{ line.item_name }}
                    <i class="ri-edit-2-line small text-muted ms-1"></i>
                  </div>
                  <div v-if="line.modifiers?.length" class="cart-line-mods">
                    <span v-for="m in line.modifiers" :key="m.id" class="mod-chip">
                      {{ m.name }}<span v-if="Number(m.price_delta) !== 0"> ({{ Number(m.price_delta) > 0 ? '+' : '' }}{{ money(m.price_delta) }})</span>
                    </span>
                  </div>
                  <div v-if="line.note" class="cart-line-note">
                    <i class="ri-sticky-note-line"></i> {{ line.note }}
                  </div>
                </div>

                <div class="cart-line-qty">
                  <button class="qty-btn" @click="bumpQty(line, -1)" :disabled="busy">−</button>
                  <span class="qty-val">{{ shortQty(line.qty) }}</span>
                  <button class="qty-btn" @click="bumpQty(line, 1)" :disabled="busy">+</button>
                </div>

                <div class="cart-line-totals">
                  <div class="cart-line-total">K {{ money(line.total ?? line.subtotal ?? 0) }}</div>
                  <button class="remove-btn" @click="removeLine(line)" title="Remove">
                    <i class="ri-close-line"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- discount chips -->
          <div v-if="orderDiscountsAvail.length" class="pos-discounts">
            <div class="small text-muted mb-1">Order discounts</div>
            <div class="d-flex flex-wrap gap-1">
              <button
                v-for="d in orderDiscountsAvail"
                :key="d.id"
                class="disc-chip"
                :class="isDiscountApplied(d.id) ? 'active' : ''"
                @click="toggleDiscount(d)"
                :disabled="busy"
              >
                {{ d.code || d.name }}
                <span v-if="String(d.discount_type).toUpperCase() === 'PERCENT'" class="ms-1 small">{{ Number(d.percent_value || 0) }}%</span>
                <span v-else-if="String(d.discount_type).toUpperCase() === 'FIXED'" class="ms-1 small">K{{ money(d.fixed_value || 0) }}</span>
              </button>
            </div>
          </div>

          <!-- totals -->
          <div class="pos-totals">
            <div class="t-row"><span>Subtotal</span><span>K {{ money(totals.subtotal) }}</span></div>
            <div class="t-row" v-if="totals.discount > 0"><span>Discount</span><span class="text-success">−K {{ money(totals.discount) }}</span></div>
            <div class="t-row" v-if="totals.tax > 0"><span>Tax</span><span>K {{ money(totals.tax) }}</span></div>
            <div class="t-row" v-if="totals.tip > 0"><span>Tip</span><span>K {{ money(totals.tip) }}</span></div>
            <div class="t-row t-total"><span>Total</span><span>K {{ money(totals.total) }}</span></div>
          </div>

          <!-- actions -->
          <div class="pos-actions">
            <button class="btn btn-light flex-grow-1" @click="holdCurrent" :disabled="busy || !order?.lines?.length">
              <i class="ri-pause-circle-line"></i> Hold
            </button>
            <!-- Pay After: send-to-kitchen now, customer pays at the end of
                 the meal (classic dine-in). Order stays OPEN; the POS resets
                 so the cashier can serve the next customer. -->
            <button class="btn btn-info text-white flex-grow-1" @click="payAfter" :disabled="busy || !order?.lines?.length">
              <i class="ri-send-plane-line"></i> Pay After
            </button>
            <!-- Pay Now: send-to-kitchen (idempotent on the backend) THEN
                 open the payment modal. Used for QSR / pay-up-front flow. -->
            <button class="btn btn-success flex-grow-1 btn-pay" @click="payNow" :disabled="busy || !order?.lines?.length">
              <i class="ri-bank-card-line"></i> Pay Now · K {{ money(totals.total) }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== MODIFIER MODAL ============== -->
    <div ref="modModalEl" class="modal fade" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered">
        <div class="modal-content modal-modern" v-if="modState">
          <div class="modal-header modal-header-modern">
            <div class="d-flex align-items-center gap-3 flex-grow-1">
              <div class="mod-thumb">
                <img v-if="modState.image" :src="imageSrc(modState.image)" />
                <i v-else class="ri-restaurant-line"></i>
              </div>
              <div class="flex-grow-1">
                <div class="modal-eyebrow">{{ modState.mode === 'add' ? 'Add Item' : 'Edit Line' }}</div>
                <h5 class="modal-title mb-0">{{ modState.title }}</h5>
                <div class="small text-muted">K {{ money(modState.unitPrice) }}</div>
              </div>
            </div>
            <button type="button" class="btn-close" @click="closeMod"></button>
          </div>

          <div class="modal-body">
            <div v-if="!modState.groups.length" class="text-muted small mb-2">
              No modifiers — set quantity and notes below.
            </div>

            <div v-for="gg in modState.groups" :key="gg.group.id" class="mb-3">
              <div class="d-flex align-items-center justify-content-between">
                <div class="fw-semibold">{{ gg.group.name }}</div>
                <small class="text-muted">{{ modifierLineRule(gg.group) }}</small>
              </div>
              <div class="d-flex flex-wrap gap-2 mt-1">
                <button
                  v-for="opt in gg.options"
                  :key="opt.id"
                  type="button"
                  class="opt-chip"
                  :class="isOptSelected(gg.group.id, opt.id) ? 'active' : ''"
                  @click="toggleOpt(gg.group, opt)"
                >
                  {{ opt.name }}
                  <span v-if="Number(opt.price_delta) !== 0" class="ms-1 small">
                    ({{ Number(opt.price_delta) > 0 ? '+' : '−' }}K{{ money(Math.abs(Number(opt.price_delta))) }})
                  </span>
                </button>
              </div>
            </div>

            <div class="row g-2 mt-3">
              <div class="col-12 col-md-4">
                <label class="form-label small mb-1">Quantity</label>
                <input v-model="modState.qty" type="number" step="any" min="0.01" class="form-control form-control-lg text-center" />
              </div>
              <div class="col-12 col-md-8">
                <label class="form-label small mb-1">Note</label>
                <input v-model="modState.note" type="text" class="form-control form-control-lg" placeholder="e.g. no onions" />
              </div>
              <!-- The per-line "Send to kitchen" toggle was removed: the
                   kitchen pipeline is now driven by Pay After / Pay Now,
                   and the per-item MenuItem.send_to_kitchen flag set in
                   the Menu Manager (drinks/packaged stock skip the KDS). -->
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" @click="closeMod" :disabled="busy">Cancel</button>
            <button class="btn btn-primary btn-lg" @click="confirmModifierAdd" :disabled="busy">
              <span v-if="busy" class="spinner-border spinner-border-sm me-1"></span>
              {{ modState.mode === 'add' ? 'Add to Cart' : 'Update Item' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== PAY MODAL ============== -->
    <div ref="payModalEl" class="modal fade" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content modal-modern">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">Payment</div>
              <h5 class="modal-title">Take payment</h5>
            </div>
            <button type="button" class="btn-close" @click="closePay"></button>
          </div>

          <!-- tabs -->
          <ul class="nav nav-tabs px-3 pt-2">
            <li class="nav-item">
              <button class="nav-link" :class="payTab === 'single' ? 'active' : ''" @click="payTab = 'single'">
                <i class="ri-bank-card-line me-1"></i> Single
              </button>
            </li>
            <li class="nav-item">
              <button class="nav-link" :class="payTab === 'split' ? 'active' : ''" @click="payTab = 'split'">
                <i class="ri-group-line me-1"></i> Split Bill
              </button>
            </li>
          </ul>

          <div class="modal-body">
            <div class="text-center mb-3">
              <div class="text-muted small">Amount due</div>
              <div class="display-5 fw-bold text-success">K {{ money(totals.total) }}</div>
            </div>

            <!-- ===== SINGLE PAY ===== -->
            <div v-if="payTab === 'single'">
              <label class="form-label small mb-1">Payment method</label>
              <div class="d-flex gap-2 mb-3">
                <button
                  v-for="m in ['CASH','CARD','MOBILE_MONEY']"
                  :key="m"
                  class="pay-method"
                  :class="payForm.method === m ? 'active' : ''"
                  @click="payForm.method = m"
                >
                  <i :class="m === 'CASH' ? 'ri-cash-line' : (m === 'CARD' ? 'ri-bank-card-line' : 'ri-smartphone-line')" class="fs-4 d-block"></i>
                  <small>{{ m === 'MOBILE_MONEY' ? 'Mobile Money' : m }}</small>
                </button>
              </div>

              <div class="row g-2">
                <div class="col-12">
                  <label class="form-label small mb-1">Reference (optional)</label>
                  <input v-model="payForm.reference" type="text" class="form-control" placeholder="e.g. mobile money txn ID" />
                </div>
                <div class="col-12">
                  <label class="form-label small mb-1">Manual discount (optional)</label>
                  <input v-model="payForm.discount_amount" type="number" step="0.01" min="0" class="form-control" placeholder="0.00" />
                  <small class="text-muted">Applied as a one-off discount on this order before payment.</small>
                </div>
              </div>
            </div>

            <!-- ===== SPLIT PAY ===== -->
            <div v-else>
              <div class="d-flex gap-2 mb-3 align-items-center flex-wrap">
                <div class="btn-group" role="group">
                  <button
                    class="btn"
                    :class="splitMode === 'even' ? 'btn-primary' : 'btn-outline-primary'"
                    @click="splitMode = 'even'"
                  >Split Evenly</button>
                  <button
                    class="btn"
                    :class="splitMode === 'custom' ? 'btn-primary' : 'btn-outline-primary'"
                    @click="splitMode = 'custom'"
                  >Custom Amounts</button>
                  <button
                    class="btn"
                    :class="splitMode === 'by_items' ? 'btn-primary' : 'btn-outline-primary'"
                    @click="splitMode = 'by_items'"
                  >By Items</button>
                </div>

                <div v-if="splitMode === 'even'" class="d-flex align-items-center gap-2 ms-3">
                  <label class="small mb-0">Ways</label>
                  <input
                    v-model.number="splitWays"
                    type="number"
                    min="2"
                    max="20"
                    class="form-control form-control-sm"
                    style="width: 80px"
                  />
                </div>

                <button v-if="splitMode === 'custom'" class="btn btn-sm btn-outline-secondary ms-auto" @click="addTender">
                  <i class="ri-add-line"></i> Add tender
                </button>
                <button v-if="splitMode === 'by_items'" class="btn btn-sm btn-outline-secondary ms-auto" @click="addItemsBill">
                  <i class="ri-add-line"></i> Add bill
                </button>
              </div>

              <!-- summary strip -->
              <div class="split-summary mb-3">
                <div>
                  <div class="text-muted small">Tenders sum</div>
                  <div class="fw-bold fs-5">K {{ money(splitTotal) }}</div>
                </div>
                <div>
                  <div class="text-muted small">Order total</div>
                  <div class="fw-bold fs-5">K {{ money(totals.total) }}</div>
                </div>
                <div>
                  <div class="text-muted small">Difference</div>
                  <div class="fw-bold fs-5" :class="Math.abs(splitDelta) < 0.005 ? 'text-success' : 'text-danger'">
                    {{ splitDelta === 0 ? '✓ Balanced' : `${splitDelta > 0 ? 'short' : 'over'} K ${money(Math.abs(splitDelta))}` }}
                  </div>
                </div>
              </div>

              <!-- BY-ITEMS: line-to-bill assignment grid -->
              <div v-if="splitMode === 'by_items'" class="by-items-section mb-3">
                <div class="small text-muted mb-2">
                  <i class="ri-information-line"></i>
                  Tap a bill number to assign a whole line. Use <strong>Split…</strong> to share a line across bills.
                  Tax + order discount + tip are split proportionally.
                </div>
                <div class="by-items-lines">
                  <div
                    v-for="line in (order?.lines || [])"
                    :key="line.id"
                    class="bi-line-block"
                    :class="{ unbalanced: !lineIsBalanced(line) }"
                  >
                    <div class="bi-line">
                      <div class="bi-line-info">
                        <div class="bi-line-name">
                          <span class="bi-qty">{{ shortQty(line.qty) }}×</span>
                          {{ line.item_name }}
                        </div>
                        <div v-if="line.modifiers?.length" class="bi-mods">
                          <span v-for="m in line.modifiers" :key="m.id" class="bi-mod">+ {{ m.name }}</span>
                        </div>
                        <!-- summary chips when split across bills -->
                        <div v-if="nonZeroBillsForLine(line).length > 1" class="bi-split-summary">
                          <span
                            v-for="seg in nonZeroBillsForLine(line)"
                            :key="seg.billIdx"
                            class="bi-split-chip"
                            :class="`b${seg.billIdx}`"
                          >
                            {{ shortQty(seg.qty) }}× → {{ seg.billIdx + 1 }}
                          </span>
                        </div>
                        <div v-if="!lineIsBalanced(line)" class="bi-warn">
                          <i class="ri-error-warning-line"></i>
                          {{ shortQty(lineAssignedTotal(line)) }} of {{ shortQty(line.qty) }} assigned
                        </div>
                      </div>
                      <div class="bi-line-amt">K {{ money(lineSubtotalDisplay(line)) }}</div>

                      <!-- whole-line picker: only show as chips when not currently editing-split -->
                      <div v-if="!isLineSplitOpen(line.id)" class="bi-bill-pickers">
                        <button
                          v-for="(_, idx) in byItems.bills"
                          :key="idx"
                          class="bi-bill-btn"
                          :class="lineIsWhollyOn(line, idx) ? `active b${idx}` : ''"
                          @click="setLineWholly(line, idx)"
                          :title="`Assign full line to Bill ${idx + 1}`"
                        >
                          {{ idx + 1 }}
                        </button>
                      </div>

                      <button
                        v-if="Number(line.qty) > 1 || isLineSplitOpen(line.id)"
                        class="btn btn-sm btn-link bi-split-toggle"
                        @click="toggleLineSplitOpen(line.id)"
                      >
                        <i :class="isLineSplitOpen(line.id) ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'"></i>
                        {{ isLineSplitOpen(line.id) ? 'Done' : 'Split…' }}
                      </button>
                    </div>

                    <!-- inline split editor (one row per bill with qty inputs) -->
                    <div v-if="isLineSplitOpen(line.id)" class="bi-split-editor">
                      <div class="d-flex align-items-center gap-2 mb-2">
                        <small class="text-muted">Distribute <strong>{{ shortQty(line.qty) }}</strong> across bills:</small>
                        <button class="btn btn-sm btn-outline-secondary ms-auto" @click="splitLineEvenly(line)">
                          <i class="ri-equal-line"></i> Split Evenly
                        </button>
                      </div>
                      <div class="bi-split-rows">
                        <div v-for="(b, idx) in byItems.bills" :key="idx" class="bi-split-row">
                          <span class="bi-bill-mini" :class="`b${idx}`">{{ idx + 1 }}</span>
                          <span class="text-muted small flex-grow-1">{{ b.reference || `Bill ${idx + 1}` }}</span>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            :max="line.qty"
                            class="form-control form-control-sm bi-split-qty"
                            :value="lineQtyOnBill(line, idx)"
                            @input="(e) => setLineQtyOnBill(line, idx, e.target.value)"
                          />
                          <button
                            class="btn btn-sm btn-outline-secondary"
                            @click="distributeRemainderToBill(line, idx)"
                            title="Fill with remainder"
                          >
                            <i class="ri-equal-line"></i>
                          </button>
                        </div>
                      </div>
                      <div class="d-flex justify-content-end mt-2">
                        <small :class="lineIsBalanced(line) ? 'text-success' : 'text-danger'">
                          {{ shortQty(lineAssignedTotal(line)) }} / {{ shortQty(line.qty) }} assigned
                          {{ lineIsBalanced(line) ? '✓' : '' }}
                        </small>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- BILL HEADERS for by-items: method/ref + line count -->
              <div v-if="splitMode === 'by_items'" class="bills-config mb-3">
                <div v-for="(b, idx) in byItems.bills" :key="idx" class="bill-config-row">
                  <div class="tender-num" :class="`b${idx}`">{{ idx + 1 }}</div>
                  <select v-model="b.method" class="form-select form-select-sm tender-method">
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                    <option value="MOBILE_MONEY">Mobile Money</option>
                  </select>
                  <input
                    v-model="b.reference"
                    type="text"
                    class="form-control form-control-sm tender-ref"
                    placeholder="Name / ref"
                  />
                  <div class="tender-amount text-end fw-bold">
                    K {{ money(splitTenders[idx]?.amount || 0) }}
                  </div>
                  <small class="text-muted">{{ billLineCount(idx) }} line{{ billLineCount(idx) === 1 ? '' : 's' }}</small>
                  <button
                    v-if="byItems.bills.length > 2"
                    class="btn btn-sm btn-outline-danger"
                    @click="removeItemsBill(idx)"
                    title="Remove bill"
                  >
                    <i class="ri-close-line"></i>
                  </button>
                </div>
              </div>

              <!-- TENDER LIST (even / custom modes) -->
              <div v-if="splitMode !== 'by_items'" class="tender-list">
                <div v-for="(t, idx) in splitTenders" :key="idx" class="tender-row">
                  <div class="tender-num">{{ idx + 1 }}</div>
                  <select v-model="t.method" class="form-select form-select-sm tender-method">
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                    <option value="MOBILE_MONEY">Mobile Money</option>
                  </select>
                  <input
                    v-model="t.reference"
                    type="text"
                    class="form-control form-control-sm tender-ref"
                    placeholder="Name / ref"
                  />
                  <input
                    v-model="t.amount"
                    type="number"
                    step="0.01"
                    min="0"
                    class="form-control form-control-sm tender-amount"
                  />
                  <button
                    v-if="splitMode === 'custom'"
                    class="btn btn-sm btn-outline-secondary"
                    @click="distributeRemainderTo(idx)"
                    title="Fill with remaining"
                  >
                    <i class="ri-equal-line"></i>
                  </button>
                  <button
                    v-if="splitMode === 'custom' && splitTenders.length > 2"
                    class="btn btn-sm btn-outline-danger"
                    @click="removeTender(idx)"
                    title="Remove"
                  >
                    <i class="ri-close-line"></i>
                  </button>
                </div>
              </div>

              <div v-if="splitMode === 'even'" class="alert alert-info small mt-3 mb-0">
                <i class="ri-information-line"></i>
                Equal-split rounding lands the cents on the last tender so the total matches exactly.
              </div>
              <div v-if="splitMode === 'by_items' && byItemsHasUnassigned" class="alert alert-warning small mt-3 mb-0">
                <i class="ri-error-warning-line"></i>
                One or more lines are not fully assigned. Each line's qty must be split among bills (use <strong>Split…</strong>).
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" @click="closePay" :disabled="busy">Cancel</button>
            <button v-if="payTab === 'single'" class="btn btn-success btn-lg" @click="submitPay" :disabled="busy">
              <span v-if="busy" class="spinner-border spinner-border-sm me-1"></span>
              Mark Paid
            </button>
            <button
              v-else
              class="btn btn-success btn-lg"
              @click="submitSplit"
              :disabled="busy || Math.abs(splitDelta) > 0.005 || (splitMode === 'by_items' && byItemsHasUnassigned)"
            >
              <span v-if="busy" class="spinner-border spinner-border-sm me-1"></span>
              Pay Split ({{ splitTenders.length }} ways)
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
/* ===================== Page hero (setup step) ===================== */
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
  position: absolute; inset: 0;
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
.page-hero-actions .btn-light {
  background: rgba(255, 255, 255, 0.95);
  color: #1e293b;
  border: none;
}
.page-hero-actions .btn-light:hover { background: #fff; color: #1e293b; }

/* ===================== Setup screen — order-type cards ===================== */
.order-type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 1rem 1.5rem;
  border: 2px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  border-radius: 14px;
  min-width: 130px;
  font-weight: 700;
  color: var(--ct-secondary-color, #64748b);
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease, transform 0.1s ease;
  cursor: pointer;
}
.order-type-btn:hover {
  border-color: rgba(99, 102, 241, 0.4);
  color: var(--ct-primary, #6366f1);
}
.order-type-btn.active {
  border-color: var(--ct-primary, #6366f1);
  background: rgba(99, 102, 241, 0.08);
  color: var(--ct-primary, #6366f1);
  box-shadow: 0 4px 12px -4px rgba(99, 102, 241, 0.35);
}
.order-type-btn:active { transform: scale(0.97); }

kbd {
  display: inline-block;
  padding: 1px 6px;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-body-color, #1e293b);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-bottom-width: 2px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em;
}

/* ===================== Build screen shell ===================== */
.pos-shell {
  height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  background: var(--ct-body-bg, #f6f7fb);
  margin: -1rem -12px 0;
  padding: 0;
}
.pos-top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.85rem;
  background: var(--ct-card-bg, #fff);
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.02);
}
.pos-main {
  display: grid;
  grid-template-columns: 1fr 420px;
  gap: 0;
  flex: 1;
  min-height: 0;
}

/* ===================== Catalog (left) ===================== */
.pos-catalog {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-body-bg, #f6f7fb);
}
.pos-search-row {
  padding: 0.85rem 0.85rem 0.5rem;
  background: var(--ct-card-bg, #fff);
}
.pos-cats {
  display: flex;
  gap: 0.4rem;
  padding: 0.5rem 0.85rem 0.65rem;
  background: var(--ct-card-bg, #fff);
  overflow-x: auto;
  scrollbar-width: thin;
  white-space: nowrap;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
}
.cat-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 1rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  color: var(--ct-body-color, #1e293b);
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  flex-shrink: 0;
}
.cat-pill:hover {
  border-color: rgba(99, 102, 241, 0.4);
  background: rgba(99, 102, 241, 0.06);
}
.cat-pill.active {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 4px 10px -4px rgba(99, 102, 241, 0.55);
}

.pos-items-scroll {
  overflow-y: auto;
  padding: 0.85rem;
  flex: 1;
}
.pos-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.6rem;
}
.pos-item-tile {
  display: flex;
  flex-direction: column;
  text-align: left;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  border-radius: 14px;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
}
.pos-item-tile:hover {
  transform: translateY(-2px);
  box-shadow: var(--ct-box-shadow, 0 6px 14px rgba(15, 23, 42, 0.08));
  border-color: rgba(99, 102, 241, 0.35);
}
.pos-item-tile:active { transform: scale(0.97); }
.pos-item-tile:disabled { opacity: 0.5; cursor: not-allowed; }
.pos-tile-image {
  aspect-ratio: 4 / 3;
  background: var(--ct-tertiary-bg, #f8fafc);
  overflow: hidden;
}
.pos-tile-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.pos-tile-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  color: var(--ct-secondary-color, #94a3b8);
  background: linear-gradient(135deg, var(--ct-tertiary-bg, #f1f5f9), transparent);
}
.pos-tile-name {
  padding: 0.55rem 0.65rem 0;
  font-weight: 700;
  font-size: 0.9rem;
  line-height: 1.2;
  color: var(--ct-body-color, #0f172a);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pos-tile-price {
  padding: 0.25rem 0.65rem 0.65rem;
  font-weight: 700;
  color: var(--ct-primary, #6366f1);
  font-size: 0.95rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* ===================== Cart (right) ===================== */
.pos-cart {
  background: var(--ct-card-bg, #fff);
  display: flex;
  flex-direction: column;
  min-height: 0;
  box-shadow: -4px 0 20px -10px rgba(15, 23, 42, 0.08);
}
.pos-cart-header {
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  font-family: "Plus Jakarta Sans", sans-serif;
}
.pos-cart-lines {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}
.cart-line {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  border-radius: 10px;
  margin-bottom: 0.25rem;
  transition: background 0.12s ease;
}
.cart-line:hover { background: var(--ct-tertiary-bg, #f8fafc); }
.cart-line-name {
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--ct-body-color, #1e293b);
  cursor: pointer;
}
.cart-line-name:hover { color: var(--ct-primary, #6366f1); }
.cart-line-mods {
  margin-top: 0.2rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}
.mod-chip {
  font-size: 0.7rem;
  background: rgba(99, 102, 241, 0.12);
  color: var(--ct-primary, #4338ca);
  padding: 0.05rem 0.4rem;
  border-radius: 4px;
  font-weight: 600;
}
.cart-line-note {
  font-size: 0.75rem;
  color: var(--ct-secondary-color, #64748b);
  margin-top: 0.2rem;
  font-style: italic;
}
.cart-line-qty {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.qty-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  color: var(--ct-body-color, #1e293b);
  border-radius: 8px;
  font-weight: 700;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.qty-btn:hover {
  background: rgba(99, 102, 241, 0.08);
  border-color: var(--ct-primary, #6366f1);
  color: var(--ct-primary, #6366f1);
}
.qty-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.qty-val {
  min-width: 30px;
  text-align: center;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--ct-body-color, #1e293b);
}
.cart-line-totals {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.15rem;
}
.cart-line-total {
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--ct-body-color, #1e293b);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.remove-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--ct-secondary-color, #94a3b8);
  cursor: pointer;
  font-size: 1.05rem;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s ease, color 0.12s ease;
}
.remove-btn:hover { color: #ef4444; background: rgba(239, 68, 68, 0.1); }

.pos-discounts {
  padding: 0.65rem 0.85rem;
  border-top: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-tertiary-bg, #f8fafc);
}
.disc-chip {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  color: var(--ct-body-color, #1e293b);
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.disc-chip:hover { border-color: var(--ct-primary, #6366f1); }
.disc-chip.active {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 4px 10px -4px rgba(99, 102, 241, 0.5);
}

.pos-totals {
  padding: 0.85rem 1rem;
  border-top: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-tertiary-bg, #f8fafc);
}
.t-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  margin-bottom: 0.25rem;
  color: var(--ct-secondary-color, #64748b);
}
.t-row span:last-child {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--ct-body-color, #1e293b);
  font-weight: 600;
}
.t-total {
  font-size: 1.3rem;
  font-weight: 800;
  margin-top: 0.4rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--ct-border-color, #cbd5e1);
  color: var(--ct-body-color, #0f172a);
  font-family: "Plus Jakarta Sans", sans-serif;
  letter-spacing: -0.015em;
}
.t-total span:last-child {
  font-family: "Plus Jakarta Sans", sans-serif;
  color: var(--ct-body-color, #0f172a);
  font-weight: 800;
}

.pos-actions {
  display: flex;
  gap: 0.4rem;
  padding: 0.65rem 0.85rem;
  background: var(--ct-card-bg, #fff);
  border-top: 1px solid var(--ct-border-color, #e6e9ef);
}
.pos-actions .btn { font-weight: 700; padding: 0.7rem 0.85rem; }
.btn-pay {
  font-size: 1rem;
  background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%) !important;
  border: none !important;
  box-shadow: 0 6px 16px -6px rgba(16, 185, 129, 0.55);
}
.btn-pay:hover { filter: brightness(1.05); }

/* ===================== Modal-modern (matches the rest of the app) ===================== */
:deep(.modal-modern) {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 22px !important;
  overflow: hidden;
  box-shadow: 0 30px 60px -20px rgba(15, 23, 42, 0.35);
  background: var(--ct-card-bg, #fff);
  color: var(--ct-body-color, #1e293b);
}
:deep(.modal-header-modern) {
  padding: 1rem 1.25rem;
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
  margin-bottom: 0.2rem;
}
:deep(.modal-header-modern .modal-title) {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  letter-spacing: -0.02em;
  font-size: 1.2rem;
  color: var(--ct-body-color, #0f172a);
}

/* ===================== Modifier modal ===================== */
.mod-thumb {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: 1.4rem;
  color: var(--ct-secondary-color, #94a3b8);
  flex-shrink: 0;
}
.mod-thumb img { width: 100%; height: 100%; object-fit: cover; }

.opt-chip {
  padding: 0.55rem 1rem;
  border: 1.5px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  color: var(--ct-body-color, #1e293b);
  border-radius: 10px;
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.opt-chip:hover { border-color: rgba(99, 102, 241, 0.4); }
.opt-chip.active {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 6px 14px -6px rgba(99, 102, 241, 0.55);
}

/* ===================== Pay method buttons ===================== */
.pay-method {
  flex: 1;
  padding: 1rem 0.75rem;
  border: 2px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  color: var(--ct-secondary-color, #64748b);
  border-radius: 12px;
  cursor: pointer;
  text-align: center;
  font-weight: 700;
  transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.pay-method:hover {
  border-color: rgba(16, 185, 129, 0.4);
  color: var(--ct-body-color, #1e293b);
}
.pay-method.active {
  background: rgba(16, 185, 129, 0.1);
  border-color: #10b981;
  color: #047857;
}

/* ===================== Split pay summary ===================== */
.split-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border-radius: 10px;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  padding: 0.75rem 1rem;
}

/* ===================== By-items split ===================== */
.by-items-section {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  padding: 0.75rem 0.85rem;
  background: var(--ct-tertiary-bg, #f8fafc);
}
.by-items-lines {
  max-height: 340px;
  overflow-y: auto;
}
.bi-line-block {
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  padding: 0.25rem 0;
}
.bi-line-block:last-child { border-bottom: none; }
.bi-line-block.unbalanced {
  background: rgba(239, 68, 68, 0.06);
  border-radius: 8px;
}
.bi-line {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.25rem;
}
.bi-line-info { min-width: 0; }
.bi-line-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--ct-body-color, #1e293b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bi-split-summary {
  margin-top: 0.2rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}
.bi-split-chip {
  font-size: 0.7rem;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  font-weight: 700;
  color: #fff;
}
.bi-split-chip.b0  { background: #6366f1; }
.bi-split-chip.b1  { background: #10b981; }
.bi-split-chip.b2  { background: #f59e0b; }
.bi-split-chip.b3  { background: #ef4444; }
.bi-split-chip.b4  { background: #ec4899; }
.bi-split-chip.b5  { background: #06b6d4; }
.bi-split-chip.b6  { background: #84cc16; }
.bi-split-chip.b7  { background: #d946ef; }
.bi-split-chip.b8  { background: #14b8a6; }
.bi-split-chip.b9  { background: #f97316; }
.bi-split-chip.b10 { background: #6366f1; }
.bi-split-chip.b11 { background: #10b981; }
.bi-warn {
  margin-top: 0.2rem;
  font-size: 0.78rem;
  color: #b91c1c;
}
.bi-split-toggle { padding: 0.15rem 0.5rem !important; font-size: 0.78rem !important; white-space: nowrap; }

.bi-split-editor {
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
  padding: 0.55rem 0.7rem 0.7rem;
  margin: 0 0.25rem 0.25rem;
}
.bi-split-rows { display: flex; flex-direction: column; gap: 0.3rem; }
.bi-split-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.bi-bill-mini {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.78rem;
  flex-shrink: 0;
}
.bi-bill-mini.b0  { background: #6366f1; }
.bi-bill-mini.b1  { background: #10b981; }
.bi-bill-mini.b2  { background: #f59e0b; }
.bi-bill-mini.b3  { background: #ef4444; }
.bi-bill-mini.b4  { background: #ec4899; }
.bi-bill-mini.b5  { background: #06b6d4; }
.bi-bill-mini.b6  { background: #84cc16; }
.bi-bill-mini.b7  { background: #d946ef; }
.bi-bill-mini.b8  { background: #14b8a6; }
.bi-bill-mini.b9  { background: #f97316; }
.bi-bill-mini.b10 { background: #6366f1; }
.bi-bill-mini.b11 { background: #10b981; }
.bi-split-qty {
  width: 90px;
  font-size: 0.9rem;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.bi-qty { color: var(--ct-primary, #6366f1); font-weight: 700; }
.bi-mods { display: flex; flex-wrap: wrap; gap: 0.2rem; margin-top: 0.15rem; }
.bi-mod {
  font-size: 0.7rem;
  background: rgba(99, 102, 241, 0.12);
  color: var(--ct-primary, #4338ca);
  padding: 0.05rem 0.4rem;
  border-radius: 4px;
  font-weight: 600;
}
.bi-line-amt {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--ct-body-color, #1e293b);
  min-width: 80px;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.bi-bill-pickers {
  display: flex;
  gap: 0.25rem;
}
.bi-bill-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  font-weight: 700;
  font-size: 0.85rem;
  cursor: pointer;
  color: var(--ct-secondary-color, #64748b);
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
}
.bi-bill-btn:hover {
  border-color: var(--ct-primary, #6366f1);
  color: var(--ct-primary, #4338ca);
  background: rgba(99, 102, 241, 0.06);
}
/* color-coded active states for up to 12 bills */
.bi-bill-btn.active.b0  { background: #6366f1; color: white; border-color: #6366f1; }
.bi-bill-btn.active.b1  { background: #10b981; color: white; border-color: #10b981; }
.bi-bill-btn.active.b2  { background: #f59e0b; color: white; border-color: #f59e0b; }
.bi-bill-btn.active.b3  { background: #ef4444; color: white; border-color: #ef4444; }
.bi-bill-btn.active.b4  { background: #ec4899; color: white; border-color: #ec4899; }
.bi-bill-btn.active.b5  { background: #06b6d4; color: white; border-color: #06b6d4; }
.bi-bill-btn.active.b6  { background: #84cc16; color: white; border-color: #84cc16; }
.bi-bill-btn.active.b7  { background: #d946ef; color: white; border-color: #d946ef; }
.bi-bill-btn.active.b8  { background: #14b8a6; color: white; border-color: #14b8a6; }
.bi-bill-btn.active.b9  { background: #f97316; color: white; border-color: #f97316; }
.bi-bill-btn.active.b10 { background: #6366f1; color: white; border-color: #6366f1; }
.bi-bill-btn.active.b11 { background: #10b981; color: white; border-color: #10b981; }

.bills-config { display: flex; flex-direction: column; gap: 6px; }
.bill-config-row {
  display: grid;
  grid-template-columns: 32px 130px 1fr 110px auto auto;
  gap: 8px;
  align-items: center;
}
.tender-num.b0  { background: #6366f1; }
.tender-num.b1  { background: #10b981; }
.tender-num.b2  { background: #f59e0b; }
.tender-num.b3  { background: #ef4444; }
.tender-num.b4  { background: #ec4899; }
.tender-num.b5  { background: #06b6d4; }
.tender-num.b6  { background: #84cc16; }
.tender-num.b7  { background: #d946ef; }
.tender-num.b8  { background: #14b8a6; }
.tender-num.b9  { background: #f97316; }
.tender-num.b10 { background: #6366f1; }
.tender-num.b11 { background: #10b981; }

.tender-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.tender-row {
  display: grid;
  grid-template-columns: 32px 130px 1fr 130px auto auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.25rem 0;
}
.tender-num {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.9rem;
}
.tender-method { font-size: 0.85rem; }
.tender-ref { font-size: 0.9rem; }
.tender-amount {
  font-size: 1rem;
  font-weight: 700;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

@media (max-width: 575px) {
  .tender-row {
    grid-template-columns: 32px 1fr 1fr;
    grid-template-areas:
      "num method method"
      "num ref amount"
      ".   actions actions";
  }
  .tender-num { grid-area: num; }
  .tender-method { grid-area: method; }
  .tender-ref { grid-area: ref; }
  .tender-amount { grid-area: amount; }
}

/* Stack the two-column build screen on small screens */
@media (max-width: 991px) {
  .pos-main {
    grid-template-columns: 1fr;
  }
  .pos-cart {
    border-top: 1px solid var(--ct-border-color, #e6e9ef);
    max-height: 55vh;
    box-shadow: 0 -4px 20px -10px rgba(15, 23, 42, 0.1);
  }
}

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
