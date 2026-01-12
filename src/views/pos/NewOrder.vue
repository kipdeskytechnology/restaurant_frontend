<script setup>
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useRouter } from "vue-router";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import http from "../../api/http";
import { useToast } from "vue-toastification";
import SearchSelect from "../../components/SearchSelect.vue";

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
} from "../../api/orders";

import { listCashDrawers, getCurrentShift } from "../../api/cash";
import { listMenuItems } from "../../api/menu";
import { listDiscounts } from "../../api/setupDiscounts";
import { listItemModifierGroups, listModifierOptions } from "../../api/modifiers";

const router = useRouter();
const toast = useToast();

const step = ref("setup"); // setup | build

// ----- base state -----
const loading = ref(false);
const busy = ref(false);

const outlets = ref([]);
const drawers = ref([]);
const currentShift = ref(null);

const menuItems = ref([]);
const discounts = ref([]);

// order state
const order = ref(null);

// setup form
const form = ref({
  outlet_id: "",
  cash_drawer_id: "",
  shift_id: null,
  order_type: "DINE_IN",
  table_no: "",
  note: "",

  customer_name: "",
  customer_phone: "",
});

// ----- modal (alerts) -----
const modalTitle = ref("Message");
const modalBody = ref("");
let modalInstance = null;

function showModal(title, body) {
  modalTitle.value = title;
  modalBody.value = body;

  const el = document.getElementById("centermodal");
  if (!el) return;

  if (!modalInstance) modalInstance = window.bootstrap ? new window.bootstrap.Modal(el) : null;
  modalInstance?.show();
}

// ----- helpers -----
function money(v) {
  if (v === null || v === undefined || v === "") return "0.00";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const orderTypeButtons = [
  { k: "DINE_IN", label: "Dine In", icon: "ri-restaurant-2-line" },
  { k: "TAKEAWAY", label: "Takeaway", icon: "ri-takeaway-line" },
  { k: "DELIVERY", label: "Delivery", icon: "ri-bike-line" },
];

const canCreate = computed(() => {
  return !!form.value.outlet_id && !!form.value.cash_drawer_id && !!form.value.shift_id && !!form.value.order_type;
});

// ----- setup loading -----
async function loadOutlets() {
  const data = await http.get("/system/outlets").then((r) => r.data);
  outlets.value = Array.isArray(data) ? data : [];
}

async function loadDrawersForOutlet(outletId) {
  drawers.value = [];
  form.value.cash_drawer_id = "";
  form.value.shift_id = null;
  currentShift.value = null;

  const data = await listCashDrawers({ outlet_id: outletId, active: "1" });
  drawers.value = Array.isArray(data) ? data : [];

  if (drawers.value.length > 0) {
    form.value.cash_drawer_id = String(drawers.value[0].id);
  }
}

async function loadCurrentShift(outletId, drawerId) {
  form.value.shift_id = null;
  currentShift.value = null;

  try {
    const s = await getCurrentShift(outletId, drawerId);
    if (s?.id) {
      currentShift.value = s;
      form.value.shift_id = s.id;
    } else {
      showModal(
        "No Open Shift",
        "No OPEN shift found for this outlet/drawer. Please open a shift first (Cash → Shifts)."
      );
    }
  } catch (e) {
    const msg = e?.response?.data?.detail || e?.message || "Failed to get current shift";
    showModal("Shift Error", msg);
  }
}

watch(
  () => form.value.outlet_id,
  async (v) => {
    if (!v) return;
    await loadDrawersForOutlet(Number(v));
  }
);

watch(
  () => form.value.cash_drawer_id,
  async (v) => {
    if (!v || !form.value.outlet_id) return;
    await loadCurrentShift(Number(form.value.outlet_id), Number(v));
  }
);

// ----- load lookups -----
const outletOptions = computed(() =>
  (outlets.value || []).map((o) => ({ label: o.name, value: String(o.id) }))
);

const drawerOptions = computed(() =>
  (drawers.value || []).map((d) => ({ label: d.name, value: String(d.id) }))
);

const menuItemOptions = computed(() =>
  (menuItems.value || [])
    .filter((x) => x.is_available) // POS: only available by default
    .map((it) => ({ label: `${it.name} — ${money(it.price)}`, value: it.id }))
    .sort((a, b) => a.label.localeCompare(b.label))
);

const activeOrderDiscounts = computed(() =>
  (discounts.value || []).filter((d) => d.is_active && String(d.scope).toUpperCase() === "ORDER")
);

// ----- create order -----
async function createOrderAndEnterBuilder() {
  if (!canCreate.value) {
    showModal("Missing info", "Select Outlet + Drawer and ensure there is an OPEN shift.");
    return;
  }

  busy.value = true;
  try {
    const payload = {
      outlet_id: Number(form.value.outlet_id),
      shift_id: Number(form.value.shift_id),

      order_type: form.value.order_type,
      table_no: form.value.table_no || null,
      note: form.value.note || null,

      customer_id: null,
      customer_name: form.value.customer_name?.trim() || null,
      customer_phone: form.value.customer_phone?.trim() || null,
    };

    const o = await openOrder(payload);
    order.value = o;
    step.value = "build";
    toast.success(`Order opened: ${o.order_no || ("#" + o.id)}`);
    await nextTick();
  } catch (e) {
    const msg = e?.response?.data?.detail || e?.message || "Failed to create order";
    showModal("Error", msg);
  } finally {
    busy.value = false;
  }
}

async function refreshOrder() {
  if (!order.value?.id) return;
  loading.value = true;
  try {
    order.value = await getOrder(order.value.id);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to refresh order");
  } finally {
    loading.value = false;
  }
}

// ----- cart / lines -----
const pick = ref({
  menu_item_id: null,
  qty: "1",
  note: "",
  send_to_kitchen: true,
});

const lines = computed(() => order.value?.lines || []);
const orderDiscounts = computed(() => order.value?.discounts || []);

const summary = computed(() => ({
  subtotal: order.value?.subtotal ?? 0,
  discount_total: order.value?.discount_total ?? 0,
  tax_total: order.value?.tax_total ?? 0,
  tip_total: order.value?.tip_total ?? 0,
  total: order.value?.total ?? 0,
}));

// ----- modifier modal -----
const modModalEl = ref(null);
let modModalInstance = null;

const modState = ref({
  mode: "add", // add | edit
  lineId: null,
  menuItemId: null,
  title: "",
  unitPrice: 0,

  qty: "1",
  note: "",
  send_to_kitchen: true,

  groups: [], // [{group, options:[]}]
  selectedByGroup: {}, // groupId -> Set(optionId)
  existingLineModifierIds: {}, // optionId -> lineModifierId (edit mode)
});

async function ensureModModal() {
  if (modModalInstance) return;
  const el = modModalEl.value;
  if (!el) return;

  try {
    const m = await import("bootstrap/js/dist/modal");
    modModalInstance = new m.default(el, { backdrop: "static", keyboard: false });
  } catch (e) {
    modModalInstance = window.bootstrap?.Modal ? new window.bootstrap.Modal(el, { backdrop: "static", keyboard: false }) : null;
  }
}

function openModModal() {
  modModalInstance?.show();
}
function closeModModal() {
  modModalInstance?.hide();
}

function resetModState() {
  modState.value = {
    mode: "add",
    lineId: null,
    menuItemId: null,
    title: "",
    unitPrice: 0,
    qty: "1",
    note: "",
    send_to_kitchen: true,
    groups: [],
    selectedByGroup: {},
    existingLineModifierIds: {},
  };
}

function optionDeltaLabel(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? `+${money(n)}` : `-${money(Math.abs(n))}`;
}

async function loadGroupsAndOptions(menuItemId) {
  // mappings -> groups
  const mappings = await listItemModifierGroups(menuItemId);
  const groups = [];

  for (const m of mappings || []) {
    // backend response may be {id, group_id, group:{...}} or flattened; handle both
    const g = m.group || m;
    const groupId = g.group_id || g.id || m.group_id;
    if (!groupId) continue;

    const opts = await listModifierOptions(groupId);
    groups.push({
      group: {
        id: groupId,
        name: g.name || "Modifiers",
        min_select: Number(g.min_select ?? 0),
        max_select: Number(g.max_select ?? 1),
      },
      options: (opts || []).filter((x) => x.is_active),
    });
  }

  return groups;
}

function ensureGroupSet(groupId) {
  if (!modState.value.selectedByGroup[groupId]) {
    modState.value.selectedByGroup[groupId] = new Set();
  }
  return modState.value.selectedByGroup[groupId];
}

function isOptionSelected(groupId, optionId) {
  const s = ensureGroupSet(groupId);
  return s.has(optionId);
}

function toggleOption(group, option) {
  const groupId = group.id;
  const max = Number(group.max_select ?? 1);

  const s = ensureGroupSet(groupId);

  // single select behavior when max_select === 1
  if (max === 1) {
    s.clear();
    s.add(option.id);
    return;
  }

  // multi select with max cap
  if (s.has(option.id)) s.delete(option.id);
  else {
    if (max > 0 && s.size >= max) return toast.error(`Max ${max} selections for "${group.name}"`);
    s.add(option.id);
  }
}

function selectedOptionIdsFlat() {
  const ids = [];
  for (const k of Object.keys(modState.value.selectedByGroup)) {
    for (const id of modState.value.selectedByGroup[k]) ids.push(Number(id));
  }
  // unique
  return [...new Set(ids)];
}

function validateModifierRules() {
  for (const g of modState.value.groups) {
    const group = g.group;
    const min = Number(group.min_select ?? 0);
    const max = Number(group.max_select ?? 1);
    const s = ensureGroupSet(group.id);

    if (min > 0 && s.size < min) {
      toast.error(`Select at least ${min} option(s) for "${group.name}"`);
      return false;
    }
    if (max > 0 && s.size > max) {
      toast.error(`Select at most ${max} option(s) for "${group.name}"`);
      return false;
    }
  }
  return true;
}

async function openCustomizeForAdd(menuItemId) {
  const item = (menuItems.value || []).find((x) => x.id === menuItemId);
  if (!item) return;

  resetModState();
  modState.value.mode = "add";
  modState.value.menuItemId = item.id;
  modState.value.title = item.name;
  modState.value.unitPrice = item.price ?? 0;
  modState.value.qty = pick.value.qty || "1";
  modState.value.note = pick.value.note || "";
  modState.value.send_to_kitchen = !!pick.value.send_to_kitchen;

  busy.value = true;
  try {
    modState.value.groups = await loadGroupsAndOptions(item.id);

    // defaults
    for (const gg of modState.value.groups) {
      const s = ensureGroupSet(gg.group.id);
      for (const opt of gg.options || []) {
        if (opt.is_default) s.add(opt.id);
      }
    }

    await ensureModModal();
    openModModal();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load modifiers");
  } finally {
    busy.value = false;
  }
}

async function openCustomizeForEdit(line) {
  resetModState();
  modState.value.mode = "edit";
  modState.value.lineId = line.id;
  modState.value.menuItemId = line.menu_item_id;
  modState.value.title = line.item_name || "Edit Item";
  modState.value.unitPrice = line.unit_price ?? 0;
  modState.value.qty = String(line.qty ?? "1");
  modState.value.note = line.note || "";
  modState.value.send_to_kitchen = !!line.send_to_kitchen;

  // map existing
  const existing = {};
  for (const m of line.modifiers || []) {
    existing[Number(m.modifier_option_id)] = m.id; // optionId -> lineModifierId
  }
  modState.value.existingLineModifierIds = existing;

  busy.value = true;
  try {
    modState.value.groups = await loadGroupsAndOptions(line.menu_item_id);

    // preselect existing options
    for (const gg of modState.value.groups) {
      const s = ensureGroupSet(gg.group.id);
      for (const opt of gg.options || []) {
        if (existing[Number(opt.id)]) s.add(opt.id);
      }
    }

    await ensureModModal();
    openModModal();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load modifiers");
  } finally {
    busy.value = false;
  }
}

async function confirmAddOrUpdateWithModifiers() {
  const qty = Number(modState.value.qty);
  if (!Number.isFinite(qty) || qty <= 0) return toast.error("Qty must be > 0");

  if (!validateModifierRules()) return;

  const optionIds = selectedOptionIdsFlat();
  const lineNote = modState.value.note?.trim() || null;

  busy.value = true;
  try {
    if (modState.value.mode === "add") {
      if (!order.value?.id) return toast.error("Order not ready");

      const updated = await addOrderLine(order.value.id, {
        line_type: "MENU_ITEM",
        menu_item_id: Number(modState.value.menuItemId),
        qty,
        unit_price: null, // backend will use menu item price
        note: lineNote,
        send_to_kitchen: !!modState.value.send_to_kitchen,
        modifier_option_ids: optionIds,
      });

      order.value = updated;
      toast.success("Item added");
      closeModModal();

      // reset quick add strip
      pick.value = { menu_item_id: null, qty: "1", note: "", send_to_kitchen: true };
    } else {
      // edit mode:
      // 1) update qty + note + send_to_kitchen on the line
      const updated1 = await updateOrderLine(modState.value.lineId, {
        qty,
        note: lineNote,
        send_to_kitchen: !!modState.value.send_to_kitchen,
      });
      order.value = updated1;

      // 2) add/remove modifiers by diff
      const existingMap = modState.value.existingLineModifierIds || {};
      const existingOptionIds = new Set(Object.keys(existingMap).map((x) => Number(x)));
      const newOptionIds = new Set(optionIds);

      // remove missing
      for (const optId of existingOptionIds) {
        if (!newOptionIds.has(optId)) {
          const lineModId = existingMap[optId];
          if (lineModId) {
            const updated = await deleteLineModifier(lineModId);
            order.value = updated;
          }
        }
      }

      // add new
      for (const optId of newOptionIds) {
        if (!existingOptionIds.has(optId)) {
          const updated = await addLineModifier(modState.value.lineId, Number(optId));
          order.value = updated;
        }
      }

      toast.success("Item updated");
      closeModModal();
    }
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save item");
  } finally {
    busy.value = false;
  }
}

// ----- line actions -----
async function changeQty(line, qtyValue) {
  const qty = Number(qtyValue);
  if (!Number.isFinite(qty) || qty <= 0) return toast.error("Qty must be > 0");
  busy.value = true;
  try {
    order.value = await updateOrderLine(line.id, { qty });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update qty");
  } finally {
    busy.value = false;
  }
}

async function removeLine(line) {
  if (!confirm(`Remove "${line.item_name}"?`)) return;
  busy.value = true;
  try {
    order.value = await deleteOrderLine(line.id);
    toast.success("Removed");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to remove line");
  } finally {
    busy.value = false;
  }
}

// ----- discounts -----
function discountLabel(d) {
  const t = String(d.discount_type || "").toUpperCase();
  if (t === "PERCENT") return `${d.code} • ${Number(d.percent_value || 0)}%`;
  if (t === "FIXED") return `${d.code} • ${money(d.fixed_value || 0)}`;
  return d.code || d.name;
}

function isDiscountApplied(discountId) {
  return (orderDiscounts.value || []).some((x) => x.discount_id === discountId);
}

async function toggleOrderDiscount(d) {
  if (!order.value?.id) return;
  busy.value = true;
  try {
    if (isDiscountApplied(d.id)) {
      order.value = await removeOrderDiscount(order.value.id, d.id);
      toast.success("Discount removed");
    } else {
      order.value = await applyOrderDiscount(order.value.id, d.id);
      toast.success("Discount applied");
    }
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update discount");
  } finally {
    busy.value = false;
  }
}

// ----- tip -----
async function setTip(v) {
  if (!order.value?.id) return;
  const tip = v === "" ? 0 : Number(v);
  if (!Number.isFinite(tip) || tip < 0) return toast.error("Tip must be >= 0");
  busy.value = true;
  try {
    order.value = await updateOrder(order.value.id, { tip_total: tip });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update tip");
  } finally {
    busy.value = false;
  }
}

// ----- navigation -----
function goToOrderScreen() {
  if (!order.value?.id) return;
  router.push({ name: "pos-order", params: { id: order.value.id } });
}

function backToSetup() {
  if (!confirm("Go back to setup? (This will keep the order OPEN)")) return;
  step.value = "setup";
}

// ----- mount -----
onMounted(async () => {
  loading.value = true;
  try {
    await loadOutlets();
    menuItems.value = await listMenuItems({ limit: 500, available: "1" });
    discounts.value = await listDiscounts();
  } catch (e) {
    const msg = e?.response?.data?.detail || e?.message || "Failed to load POS data";
    showModal("Error", msg);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DefaultLayout>
    <!-- HEADER -->
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Point of Sale</h4>
        <div class="text-muted small">
          <span v-if="step==='setup'">Open an order, then build the ticket with modifiers & discounts.</span>
          <span v-else>
            Building: <strong>{{ order?.order_no || ("Order #" + order?.id) }}</strong>
            • <span class="pill" :class="order?.status === 'OPEN' ? 'pill-green' : 'pill-gray'">{{ order?.status || "—" }}</span>
          </span>
        </div>
      </div>

      <div class="d-flex gap-2">
        <button v-if="step==='build'" class="btn btn-outline-primary" :disabled="loading || busy" @click="refreshOrder">
          <i class="ri-refresh-line me-1"></i> Refresh
        </button>
        <button v-if="step==='build'" class="btn btn-light" :disabled="busy" @click="goToOrderScreen">
          <i class="ri-external-link-line me-1"></i> Open Order Screen
        </button>
      </div>
    </div>

    <!-- SETUP STEP -->
    <div v-if="step==='setup'" class="row g-3" style="zoom: 80%;">
      <div class="col-12 col-lg-7">
        <div class="card menu-card allow-overflow">
          <div class="card-body">
            <div class="section-title">Order Setup</div>
            <div class="text-muted small">Select outlet context + order type. Shift must be OPEN.</div>

            <div class="row g-2 mt-2">
              <div class="col-md-6">
                <label class="form-label mb-1">Outlet</label>
                <SearchSelect
                  v-model="form.outlet_id"
                  :options="outletOptions"
                  placeholder="Select outlet…"
                  :clearable="true"
                  :searchable="true"
                />
              </div>

              <div class="col-md-6">
                <label class="form-label mb-1">Cash Drawer</label>
                <SearchSelect
                  v-model="form.cash_drawer_id"
                  :options="drawerOptions"
                  placeholder="Select drawer…"
                  :clearable="true"
                  :searchable="true"
                  :disabled="!form.outlet_id"
                />
              </div>

              <div class="col-12">
                <label class="form-label mb-1">Shift</label>
                <div class="shift-box">
                  <div class="d-flex align-items-center gap-2">
                    <span v-if="currentShift" class="pill pill-green">
                      <span class="dot on"></span> OPEN • ID: {{ currentShift.id }}
                    </span>
                    <span v-else class="pill pill-gray">
                      <span class="dot off"></span> Not found
                    </span>
                    <span class="text-muted small">Shift must be open for selected outlet/drawer.</span>
                  </div>

                  <button
                    type="button"
                    class="btn btn-sm btn-outline-primary"
                    :disabled="!form.outlet_id || !form.cash_drawer_id || busy"
                    @click="loadCurrentShift(Number(form.outlet_id), Number(form.cash_drawer_id))"
                  >
                    Refresh
                  </button>
                </div>
              </div>

              <div class="col-12">
                <label class="form-label mb-1">Order Type</label>
                <div class="segmented">
                  <button
                    v-for="b in orderTypeButtons"
                    :key="b.k"
                    class="seg-btn"
                    :class="form.order_type === b.k ? 'active' : ''"
                    type="button"
                    @click="form.order_type = b.k"
                  >
                    <i :class="b.icon" class="me-1"></i>{{ b.label }}
                  </button>
                </div>
              </div>

              <div class="col-md-6">
                <label class="form-label mb-1">Table No (optional)</label>
                <input class="form-control" v-model="form.table_no" placeholder="e.g. T1" />
              </div>

              <div class="col-md-6">
                <label class="form-label mb-1">Customer Phone (optional)</label>
                <input class="form-control" v-model="form.customer_phone" placeholder="e.g. 097xxxxxxx" />
              </div>

              <div class="col-12">
                <label class="form-label mb-1">Customer Name (optional)</label>
                <input class="form-control" v-model="form.customer_name" placeholder="e.g. John" />
              </div>

              <div class="col-12">
                <label class="form-label mb-1">Note (optional)</label>
                <textarea class="form-control" rows="2" v-model="form.note" placeholder="Kitchen / delivery note…"></textarea>
              </div>

              <div class="col-12 d-flex gap-2 mt-1">
                <button class="btn btn-primary" :disabled="busy || !canCreate" @click="createOrderAndEnterBuilder">
                  <span v-if="busy" class="spinner-border spinner-border-sm me-1"></span>
                  <i v-else class="ri-play-circle-line me-1"></i>
                  Open Order & Start Ticket
                </button>
                <router-link class="btn btn-light" to="/orders">Back to Orders</router-link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- right: preview / guidance -->
      <div class="col-12 col-lg-5">
        <div class="card menu-card">
          <div class="card-body">
            <div class="section-title">POS Best Practice</div>
            <div class="text-muted small">How fast operators work in real restaurants:</div>

            <div class="help-card mt-3">
              <div class="d-flex align-items-start gap-2">
                <i class="ri-flashlight-line mt-1"></i>
                <div>
                  <div class="fw-bold">Open → Add items → Modifiers → Discount → Pay</div>
                  <div class="text-muted small">This matches your backend totals logic exactly.</div>
                </div>
              </div>
            </div>

            <div class="help-card mt-2">
              <div class="d-flex align-items-start gap-2">
                <i class="ri-coupon-3-line mt-1"></i>
                <div>
                  <div class="fw-bold">Apply order discounts after items</div>
                  <div class="text-muted small">Your backend clamps discounts to subtotal, so it works best after adding lines.</div>
                </div>
              </div>
            </div>

            <div class="help-card mt-2">
              <div class="d-flex align-items-start gap-2">
                <i class="ri-list-check-2 mt-1"></i>
                <div>
                  <div class="fw-bold">Modifiers always belong to a line</div>
                  <div class="text-muted small">We attach options to each menu item line (your `OrderLineModifier` model).</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- BUILD STEP -->
    <div v-else class="row g-3" style="zoom: 80%;">
      <!-- left: ticket builder -->
      <div class="col-12 col-lg-8">
        <div class="card menu-card allow-overflow">
          <div class="card-body">
            <div class="d-flex align-items-start justify-content-between gap-2">
              <div>
                <div class="section-title">Ticket Builder</div>
                <div class="text-muted small">Add items, customize modifiers, adjust qty. Everything recalculates server-side.</div>
              </div>

              <div class="d-flex gap-2">
                <button class="btn btn-light" :disabled="busy" @click="backToSetup">
                  <i class="ri-arrow-left-line me-1"></i> Setup
                </button>
                <button class="btn btn-outline-primary" :disabled="busy" @click="goToOrderScreen">
                  Continue
                </button>
              </div>
            </div>

            <!-- quick add -->
            <div class="add-strip mt-3">
              <div class="row g-2 align-items-end">
                <div class="col-md-7">
                  <label class="form-label mb-1">Menu item</label>
                  <SearchSelect
                    v-model="pick.menu_item_id"
                    :options="menuItemOptions"
                    placeholder="Search menu items…"
                    :clearable="true"
                    :searchable="true"
                  />
                </div>

                <div class="col-md-2">
                  <label class="form-label mb-1">Qty</label>
                  <input v-model="pick.qty" class="form-control" type="number" step="0.001" />
                </div>

                <div class="col-md-3 d-grid">
                  <button
                    class="btn btn-primary"
                    :disabled="busy || !pick.menu_item_id"
                    @click="openCustomizeForAdd(Number(pick.menu_item_id))"
                  >
                    <i class="ri-magic-line me-1"></i> Customize & Add
                  </button>
                </div>

                <div class="col-12">
                  <div class="form-check form-switch mt-1">
                    <input class="form-check-input" type="checkbox" id="stk" v-model="pick.send_to_kitchen" />
                    <label class="form-check-label small" for="stk">Send to kitchen</label>
                  </div>
                </div>
              </div>
            </div>

            <!-- lines -->
            <div v-if="lines.length === 0" class="comp-empty text-center text-muted mt-3">
              No items yet — add your first menu item above.
            </div>

            <div v-else class="d-grid gap-2 mt-3">
              <div v-for="ln in lines" :key="ln.id" class="line-row">
                <div class="min-w-0">
                  <div class="line-title">
                    <span class="fw-bold">{{ ln.item_name }}</span>
                    <span v-if="ln.item_sku" class="pill pill-subtle ms-2">{{ ln.item_sku }}</span>
                    <span class="pill ms-2" :class="ln.send_to_kitchen ? 'pill-green' : 'pill-gray'">
                      {{ ln.send_to_kitchen ? "Kitchen" : "No Kitchen" }}
                    </span>
                  </div>

                  <div class="text-muted small mt-1">
                    Unit: {{ money(ln.unit_price) }} • Subtotal: {{ money(ln.subtotal) }}
                  </div>

                  <div v-if="(ln.modifiers || []).length" class="mods mt-2">
                    <span class="mods-label">Modifiers:</span>
                    <span v-for="m in ln.modifiers" :key="m.id" class="chip">
                      {{ m.name }}
                      <span v-if="Number(m.price_delta || 0) !== 0" class="delta">
                        ({{ optionDeltaLabel(m.price_delta) }})
                      </span>
                    </span>
                  </div>

                  <div v-if="ln.note" class="text-muted small mt-1">
                    <i class="ri-sticky-note-line me-1"></i>{{ ln.note }}
                  </div>
                </div>

                <div class="controls">
                  <div class="control-block">
                    <span class="mini-label">Qty</span>
                    <input
                      class="form-control form-control-sm"
                      type="number"
                      step="0.001"
                      :value="ln.qty"
                      @change="(e) => changeQty(ln, e.target.value)"
                    />
                  </div>

                  <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-outline-secondary" :disabled="busy" @click="openCustomizeForEdit(ln)">
                      <i class="ri-edit-line me-1"></i> Modifiers
                    </button>
                    <button class="btn btn-sm btn-outline-danger" :disabled="busy" @click="removeLine(ln)">
                      <i class="ri-delete-bin-6-line me-1"></i> Remove
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- tip -->
            <div class="mt-3 tip-strip">
              <div class="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                <div>
                  <div class="fw-bold">Tip</div>
                  <div class="text-muted small">Optional. Updates order totals server-side.</div>
                </div>
                <div style="width: 220px;">
                  <input
                    class="form-control"
                    type="number"
                    step="0.01"
                    :value="order?.tip_total ?? 0"
                    @change="(e) => setTip(e.target.value)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- discounts -->
        <div class="card menu-card mt-3">
          <div class="card-body">
            <div class="d-flex align-items-start justify-content-between gap-2">
              <div>
                <div class="section-title">Order Discounts</div>
                <div class="text-muted small">These apply to the subtotal (your backend clamps to subtotal).</div>
              </div>
              <span class="pill pill-subtle">{{ orderDiscounts.length }} applied</span>
            </div>

            <div v-if="activeOrderDiscounts.length === 0" class="text-muted small mt-2">
              No active ORDER discounts found. Create them in Setup → Discounts.
            </div>

            <div v-else class="discount-grid mt-3">
              <button
                v-for="d in activeOrderDiscounts"
                :key="d.id"
                class="discount-card"
                type="button"
                :class="isDiscountApplied(d.id) ? 'active' : ''"
                :disabled="busy"
                @click="toggleOrderDiscount(d)"
              >
                <div class="d-flex align-items-start justify-content-between gap-2">
                  <div class="min-w-0">
                    <div class="fw-bold text-truncate">{{ d.name }}</div>
                    <div class="text-muted small">{{ discountLabel(d) }}</div>
                  </div>
                  <span class="pill" :class="isDiscountApplied(d.id) ? 'pill-green' : 'pill-gray'">
                    {{ isDiscountApplied(d.id) ? "Applied" : "Off" }}
                  </span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- right: totals -->
      <div class="col-12 col-lg-4">
        <div class="card menu-card sticky">
          <div class="card-body">
            <div class="section-title">Summary</div>
            <div class="text-muted small">Server-calculated totals (matches your `_calc_order_totals`).</div>

            <div class="totals mt-3">
              <div class="rowx">
                <span>Subtotal</span><strong>{{ money(summary.subtotal) }}</strong>
              </div>
              <div class="rowx">
                <span>Discounts</span><strong>-{{ money(summary.discount_total) }}</strong>
              </div>
              <div class="rowx">
                <span>Tax</span><strong>{{ money(summary.tax_total) }}</strong>
              </div>
              <div class="rowx">
                <span>Tip</span><strong>{{ money(summary.tip_total) }}</strong>
              </div>
              <div class="divider my-2"></div>
              <div class="rowx total">
                <span>Total</span><strong>{{ money(summary.total) }}</strong>
              </div>
            </div>

            <div class="help-card mt-3">
              <div class="d-flex align-items-start gap-2">
                <i class="ri-shield-check-line mt-1"></i>
                <div>
                  <div class="fw-bold">Kitchen-safe</div>
                  <div class="text-muted small">
                    Modifiers are saved line-by-line exactly like your backend.
                  </div>
                </div>
              </div>
            </div>

            <div class="d-grid gap-2 mt-3">
              <button class="btn btn-primary" :disabled="busy || lines.length===0" @click="goToOrderScreen">
                <i class="ri-arrow-right-line me-1"></i> Continue to Order Screen
              </button>
              <button class="btn btn-light" :disabled="busy" @click="refreshOrder">
                Refresh totals
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ALERT MODAL -->
    <div class="modal fade" id="centermodal" tabindex="-1" role="dialog" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title">{{ modalTitle }}</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true"></button>
          </div>
          <div class="modal-body">{{ modalBody }}</div>
        </div>
      </div>
    </div>

    <!-- MODIFIER MODAL -->
    <div class="modal fade" tabindex="-1" aria-hidden="true" ref="modModalEl">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content position-relative">
          <div class="modal-header bg-body-tertiary">
            <div class="min-w-0">
              <h4 class="modal-title mb-0 text-truncate">
                {{ modState.mode === "add" ? "Customize & Add" : "Edit Item" }} — {{ modState.title }}
              </h4>
              <div class="text-muted small">
                Choose modifiers, set qty, and optionally add a note.
              </div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true" :disabled="busy"></button>
          </div>

          <div
            v-if="busy"
            class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style="background: rgba(0,0,0,0.08); backdrop-filter: blur(2px); z-index: 10;"
          >
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Working…</div>
            </div>
          </div>

          <div class="modal-body">
            <div class="row g-2">
              <div class="col-md-3">
                <label class="form-label mb-1">Qty</label>
                <input v-model="modState.qty" class="form-control" type="number" step="0.001" />
              </div>

              <div class="col-md-9">
                <label class="form-label mb-1">Note (optional)</label>
                <input v-model="modState.note" class="form-control" placeholder="e.g. No onion, extra spicy…" />
              </div>

              <div class="col-12">
                <div class="form-check form-switch">
                  <input class="form-check-input" type="checkbox" id="kds2" v-model="modState.send_to_kitchen" />
                  <label class="form-check-label" for="kds2">Send to kitchen</label>
                </div>
              </div>

              <div class="col-12">
                <div v-if="modState.groups.length === 0" class="comp-empty text-center text-muted">
                  No modifier groups attached to this menu item.
                </div>

                <div v-else class="d-grid gap-2">
                  <div v-for="g in modState.groups" :key="g.group.id" class="group-card">
                    <div class="d-flex align-items-start justify-content-between gap-2">
                      <div class="min-w-0">
                        <div class="fw-bold text-truncate">{{ g.group.name }}</div>
                        <div class="text-muted small">
                          Select
                          <span v-if="g.group.min_select>0">at least {{ g.group.min_select }}</span>
                          <span v-else>any</span>
                          • max {{ g.group.max_select }}
                        </div>
                      </div>
                      <span class="pill pill-subtle">
                        {{ (modState.selectedByGroup[g.group.id]?.size || 0) }}/{{ g.group.max_select }}
                      </span>
                    </div>

                    <div class="opts mt-2">
                      <button
                        v-for="opt in g.options"
                        :key="opt.id"
                        type="button"
                        class="opt-chip"
                        :class="isOptionSelected(g.group.id, opt.id) ? 'active' : ''"
                        @click="toggleOption(g.group, opt)"
                      >
                        <span class="fw-semibold">{{ opt.name }}</span>
                        <span v-if="optionDeltaLabel(opt.price_delta)" class="delta ms-1">
                          {{ optionDeltaLabel(opt.price_delta) }}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                <div class="text-muted small mt-2">
                  Tip: groups with max=1 behave like radio; max&gt;1 behave like multi-select.
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="busy">Cancel</button>
            <button class="btn btn-primary" :disabled="busy" @click="confirmAddOrUpdateWithModifiers">
              <i class="ri-check-line me-1"></i>{{ modState.mode === "add" ? "Add to Ticket" : "Save Changes" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
/* Base shell (matches your menu pages) */
.menu-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
}

.allow-overflow { overflow: visible !important; }

.section-title {
  font-weight: 900;
  color: var(--ct-emphasis-color);
}

.divider {
  height: 1px;
  background: var(--ct-border-color-translucent);
  opacity: 0.7;
}

/* Shift box */
.shift-box{
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-tertiary-bg);
  border-radius: 14px;
  padding: 10px 12px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
}

/* Segmented buttons */
.segmented {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.seg-btn {
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-tertiary-bg);
  color: var(--ct-emphasis-color);
  border-radius: 12px;
  padding: 10px 10px;
  font-weight: 800;
  font-size: 12px;
  transition: transform .12s ease, border-color .12s ease;
}
.seg-btn:hover { transform: translateY(-1px); }
.seg-btn.active {
  border-color: rgba(var(--ct-primary-rgb), 0.35);
  background: rgba(var(--ct-primary-rgb), 0.12);
}

/* pills */
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
.pill-subtle { background: rgba(var(--ct-body-color-rgb), 0.08); font-weight: 800; }
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

/* status dot */
.dot { width: 8px; height: 8px; border-radius: 999px; border: 2px solid rgba(var(--ct-body-color-rgb), 0.25); }
.dot.on { background: var(--ct-success); border-color: rgba(var(--ct-success-rgb), 0.35); }
.dot.off { background: var(--ct-gray-500); border-color: rgba(var(--ct-body-color-rgb), 0.25); }

/* add strip */
.add-strip {
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-tertiary-bg);
  border-radius: 14px;
  padding: 12px;
}

.tip-strip {
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-tertiary-bg);
  border-radius: 14px;
  padding: 12px;
}

/* empty */
.comp-empty {
  border: 1px dashed rgba(127, 127, 127, 0.35);
  border-radius: 12px;
  padding: 14px;
  background: var(--ct-secondary-bg);
  color: var(--ct-body-color);
}

/* line rows */
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
.line-title { display:flex; align-items:center; gap:6px; min-width:0; }
.controls {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.control-block { width: 120px; }
.mini-label {
  display: block;
  font-size: 11px;
  font-weight: 800;
  color: var(--ct-secondary-color);
  margin-bottom: 4px;
}

/* modifiers display chips */
.mods { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.mods-label { font-size: 11px; font-weight: 800; color: var(--ct-secondary-color); margin-right: 4px; }
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
.delta { opacity: 0.9; }

/* discounts */
.discount-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.discount-card {
  width: 100%;
  text-align: left;
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-tertiary-bg);
  border-radius: 14px;
  padding: 12px;
  transition: transform .12s ease, border-color .12s ease;
}
.discount-card:hover { transform: translateY(-1px); }
.discount-card.active {
  border-color: rgba(var(--ct-primary-rgb), 0.35);
  background: rgba(var(--ct-primary-rgb), 0.10);
}

/* totals */
.totals .rowx {
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding: 6px 0;
}
.totals .rowx.total {
  font-size: 16px;
  font-weight: 900;
}

/* sticky summary */
.sticky { position: sticky; top: 14px; z-index: 5; }

/* modifier modal groups */
.group-card{
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-tertiary-bg);
  border-radius: 14px;
  padding: 12px;
}
.opts { display:flex; flex-wrap:wrap; gap:8px; }
.opt-chip{
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-secondary-bg);
  border-radius: 999px;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 800;
  transition: transform .12s ease, border-color .12s ease;
}
.opt-chip:hover { transform: translateY(-1px); }
.opt-chip.active{
  border-color: rgba(var(--ct-primary-rgb), 0.35);
  background: rgba(var(--ct-primary-rgb), 0.12);
}

/* IMPORTANT: SearchSelect overlay fix */
:deep(.searchselect .dropdown-panel) {
  z-index: 3000 !important;
}
:deep(.searchselect) {
  position: relative;
  z-index: 1;
}
</style>
