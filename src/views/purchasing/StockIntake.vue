<!-- src/views/purchasing/StockIntake.vue -->
<script setup>
import { ref, onMounted, computed, watch, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import SearchSelect from "../../components/SearchSelect.vue";

import { listOutlets } from "../../api/systemOutlets";
import { listUoms, listUomConversions } from "../../api/setupUom";
import { listInventoryItems } from "../../api/inventory";

import http from "../../api/http";
import {
  listSuppliers,
  createDirectReceipt,
  listPurchaseReceipts,
  getPurchaseReceipt,
} from "../../api/purchasing";

const toast = useToast();

const loading = ref(false);
const loadingTable = ref(true);
const refreshing = ref(false);
const saving = ref(false);

const outlets = ref([]);
const suppliers = ref([]);
const uoms = ref([]);
const uomConversions = ref([]);
const items = ref([]);

const outletMap = computed(() => { const m = new Map(); for (const o of outlets.value || []) m.set(Number(o.id), o); return m; });
const supplierMap = computed(() => { const m = new Map(); for (const s of suppliers.value || []) m.set(Number(s.id), s); return m; });
const itemMap = computed(() => { const m = new Map(); for (const it of items.value || []) m.set(Number(it.id), it); return m; });
const uomMap = computed(() => { const m = new Map(); for (const u of uoms.value || []) m.set(Number(u.id), u); return m; });

const outletOptions = computed(() => (outlets.value || []).map((o) => ({ label: o.name || `Outlet #${o.id}`, value: Number(o.id) })));
const supplierOptions = computed(() => (suppliers.value || []).map((s) => ({ label: s.name || `Supplier #${s.id}`, value: Number(s.id) })));
const itemOptions = computed(() => (items.value || []).map((it) => ({
  label: it.sku ? `${it.sku} — ${it.name}` : it.name || `Item #${it.id}`,
  value: Number(it.id),
})));

function uomLabel(u) {
  const code = u?.code || ""; const name = u?.name || "";
  return `${code}${code && name ? " — " : ""}${name}`.trim() || `UOM #${u?.id}`;
}

// ===== UOM compatibility =====
const convGraph = computed(() => {
  const g = new Map();
  for (const c of uomConversions.value || []) {
    const from = Number(c.from_uom_id); const to = Number(c.to_uom_id); const mult = Number(c.multiplier);
    if (!from || !to || !Number.isFinite(mult) || mult <= 0) continue;
    if (!g.has(from)) g.set(from, []);
    if (!g.has(to)) g.set(to, []);
    g.get(from).push({ to, factor: mult });
    g.get(to).push({ to: from, factor: 1 / mult });
  }
  return g;
});

function conversionFactor(fromId, toId) {
  fromId = Number(fromId); toId = Number(toId);
  if (!fromId || !toId) return null;
  if (fromId === toId) return 1;
  const g = convGraph.value;
  const q = [{ id: fromId, f: 1 }]; const seen = new Set([fromId]);
  while (q.length) {
    const { id, f } = q.shift();
    for (const e of g.get(id) || []) {
      if (seen.has(e.to)) continue;
      const f2 = f * e.factor;
      if (e.to === toId) return f2;
      seen.add(e.to); q.push({ id: e.to, f: f2 });
    }
  }
  return null;
}

function invAvgCostPerSelectedUom(invId, selectedUomId) {
  const inv = itemMap.value.get(Number(invId)); if (!inv) return null;
  const avgBase = Number(inv.avg_cost); const baseUomId = Number(inv.base_uom_id);
  if (!Number.isFinite(avgBase) || !baseUomId || !selectedUomId) return null;
  const f = conversionFactor(Number(selectedUomId), baseUomId);
  if (f == null) return null;
  return avgBase * f;
}

function fmtMoney(v, dp = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function compatibleUomIdsForInventory(invId) {
  const inv = itemMap.value.get(Number(invId));
  const baseId = Number(inv?.base_uom_id || 0);
  if (!baseId) return (uoms.value || []).map((u) => Number(u.id));
  const g = convGraph.value;
  const seen = new Set([baseId]); const q = [baseId];
  while (q.length) {
    const cur = q.shift();
    for (const e of g.get(cur) || []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to); q.push(e.to);
    }
  }
  return Array.from(seen);
}

function uomsForInventory(invId) {
  const allowed = new Set(compatibleUomIdsForInventory(invId));
  return (uoms.value || []).filter((u) => allowed.has(Number(u.id)));
}

function uomOptionsForInventory(invId) {
  return uomsForInventory(invId).map((u) => ({ label: uomLabel(u), value: Number(u.id) }));
}

function defaultUomForInventory(invId) {
  const inv = itemMap.value.get(Number(invId));
  const base = Number(inv?.base_uom_id || 0);
  const opts = uomOptionsForInventory(invId);
  const baseOpt = opts.find((o) => Number(o.value) === base);
  return (baseOpt?.value ?? opts[0]?.value ?? null) || null;
}

function ensureLineUom(line) {
  const invId = Number(line?.inventory_item_id || 0);
  if (!invId) return;
  const allowed = compatibleUomIdsForInventory(invId);
  if (!allowed?.length) return;
  const cur = Number(line?.uom_id || 0);
  if (allowed.includes(cur)) return;
  line.uom_id = defaultUomForInventory(invId);
}

// ===== HISTORY TABLE =====
const rows = ref([]);
const filters = ref({
  outlet_id: null,
  supplier_id: null,
  show_voided: false,
  limit: 200,
});

const displayRows = computed(() => {
  let r = (rows.value || []).filter((x) => x.purchase_order_id == null);
  if (!filters.value.show_voided) r = r.filter((x) => !x.voided_at);
  if (filters.value.outlet_id) {
    const oid = Number(filters.value.outlet_id);
    r = r.filter((x) => Number(x.outlet_id) === oid);
  }
  if (filters.value.supplier_id) {
    const sid = Number(filters.value.supplier_id);
    r = r.filter((x) => Number(x.supplier_id) === sid);
  }
  r = [...r].sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
  return r;
});

const summary = computed(() => {
  let total = 0, posted = 0, voided = 0, totalValue = 0;
  for (const r of displayRows.value) {
    total++;
    if (r.voided_at) voided++; else posted++;
    for (const it of r.items || []) {
      const q = Number(it.qty); const c = Number(it.unit_cost);
      if (Number.isFinite(q) && Number.isFinite(c)) totalValue += q * c;
    }
  }
  return { total, posted, voided, totalValue };
});

async function loadAll() {
  loading.value = true;
  try {
    const [o, s, u, conv, it] = await Promise.all([
      listOutlets(),
      listSuppliers({ limit: 500, active: "1" }),
      listUoms(),
      listUomConversions(),
      listInventoryItems({ limit: 500 }),
    ]);
    outlets.value = o || [];
    suppliers.value = s || [];
    uoms.value = u || [];
    uomConversions.value = conv || [];
    items.value = it || [];
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load setup data");
  } finally {
    loading.value = false;
  }
}

async function loadHistory(showSpinner = false) {
  if (showSpinner) loadingTable.value = true;
  else refreshing.value = true;
  try {
    const params = { limit: Number(filters.value.limit || 200) };
    if (filters.value.outlet_id) params.outlet_id = Number(filters.value.outlet_id);
    const data = await listPurchaseReceipts(params);
    rows.value = data || [];
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load stock intakes");
  } finally {
    loadingTable.value = false;
    refreshing.value = false;
  }
}

let filterTimer = null;
watch(
  () => [filters.value.outlet_id, filters.value.supplier_id, filters.value.show_voided, filters.value.limit],
  () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => loadHistory(false), 150);
  }
);

function clearFilters() {
  filters.value = { outlet_id: null, supplier_id: null, show_voided: false, limit: 200 };
}

// ===== Display helpers =====
function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
function fmtDateOnly(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
function fmtTimeShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function receiptTotal(receipt) {
  if (!receipt?.items) return 0;
  let sum = 0;
  for (const it of receipt.items || []) {
    const q = Number(it.qty); const c = Number(it.unit_cost);
    if (Number.isFinite(q) && Number.isFinite(c)) sum += q * c;
  }
  return sum;
}
function outletName(id) { return outletMap.value.get(Number(id))?.name || `Outlet #${id}`; }
function supplierName(id) { return supplierMap.value.get(Number(id))?.name || `Supplier #${id}`; }
function itemLabelById(id) {
  const it = itemMap.value.get(Number(id));
  if (!it) return `Item #${id}`;
  return it.sku ? `${it.sku} — ${it.name}` : it.name;
}
function uomCodeById(id) { const u = uomMap.value.get(Number(id)); return u?.code || u?.name || ""; }
function invLastPrice(invId) { const v = Number(itemMap.value.get(Number(invId))?.avg_cost); return Number.isFinite(v) ? v : null; }
function receiptItemsPreview(receipt, minCount = 2) {
  const arr = receipt?.items || [];
  if (!arr.length) return "—";
  const take = Math.max(minCount, 2);
  const parts = arr.slice(0, take).map((x) => `${itemLabelById(x.inventory_item_id)} (${x.qty ?? ""} ${uomCodeById(x.uom_id)})`.trim());
  const more = arr.length > parts.length ? ` +${arr.length - parts.length} more` : "";
  return parts.join(" • ") + more;
}

const PALETTE = ["#0d9488", "#0891b2", "#2563eb", "#7c3aed", "#ec4899", "#f59e0b"];
function colorFor(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// ===== Modals =====
const createModalEl = ref(null);
const viewModalEl = ref(null);
const editModalEl = ref(null);
const voidModalEl = ref(null);
let createModalInst = null, viewModalInst = null, editModalInst = null, voidModalInst = null;

async function ensureModal(refEl, key) {
  const existing = key === "create" ? createModalInst : key === "view" ? viewModalInst : key === "edit" ? editModalInst : voidModalInst;
  if (existing) return existing;
  let inst = null;
  try {
    const m = await import("bootstrap/js/dist/modal");
    inst = new m.default(refEl.value, { backdrop: "static", keyboard: false });
  } catch {
    inst = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(refEl.value, { backdrop: "static", keyboard: false })
      : null;
  }
  if (key === "create") createModalInst = inst;
  else if (key === "view") viewModalInst = inst;
  else if (key === "edit") editModalInst = inst;
  else voidModalInst = inst;
  return inst;
}

// ===== CREATE =====
const createForm = ref({ outlet_id: null, supplier_id: null, received_at: "", note: "" });
const createLines = ref([{ inventory_item_id: null, uom_id: null, qty: "", unit_cost: "" }]);

function resetCreate() {
  createForm.value = { outlet_id: null, supplier_id: null, received_at: "", note: "" };
  createLines.value = [{ inventory_item_id: null, uom_id: null, qty: "", unit_cost: "" }];
}
function addCreateLine() { createLines.value.push({ inventory_item_id: null, uom_id: null, qty: "", unit_cost: "" }); }
function removeCreateLine(idx) { if (createLines.value.length === 1) return; createLines.value.splice(idx, 1); }

async function openCreate() {
  resetCreate();
  const inst = await ensureModal(createModalEl, "create");
  inst?.show();
  await nextTick();
}

function normalizeNumberString(v) { if (v == null) return ""; return String(v).trim(); }
function validateLines(linesArr) {
  const clean = (linesArr || [])
    .map((ln) => ({
      inventory_item_id: ln.inventory_item_id ? Number(ln.inventory_item_id) : null,
      uom_id: ln.uom_id ? Number(ln.uom_id) : null,
      qty: normalizeNumberString(ln.qty),
      unit_cost: normalizeNumberString(ln.unit_cost),
    }))
    .filter((ln) => ln.inventory_item_id && ln.uom_id && ln.qty && ln.unit_cost);
  if (clean.length === 0) return { error: "Add at least 1 valid line (item, uom, qty, unit cost)", items: [] };
  for (const ln of clean) {
    const q = Number(ln.qty); const c = Number(ln.unit_cost);
    if (!Number.isFinite(q) || q <= 0) return { error: "Qty must be > 0", items: [] };
    if (!Number.isFinite(c) || c < 0) return { error: "Unit cost must be >= 0", items: [] };
    const allowed = new Set(compatibleUomIdsForInventory(ln.inventory_item_id));
    if (!allowed.has(Number(ln.uom_id))) return { error: "Invalid UOM for selected item (only base UOM or conversions allowed).", items: [] };
  }
  return { error: null, items: clean };
}

async function submitCreate() {
  if (!createForm.value.outlet_id) return toast.error("Outlet is required");
  if (!createForm.value.supplier_id) return toast.error("Supplier is required");
  const { error, items: cleanItems } = validateLines(createLines.value);
  if (error) return toast.error(error);

  saving.value = true;
  try {
    const payload = {
      outlet_id: Number(createForm.value.outlet_id),
      supplier_id: Number(createForm.value.supplier_id),
      received_at: createForm.value.received_at ? new Date(createForm.value.received_at).toISOString() : null,
      note: createForm.value.note?.trim() || null,
      items: cleanItems,
    };
    const receipt = await createDirectReceipt(payload);
    toast.success(`Stock posted. Receipt ID: ${receipt?.id ?? ""}`);
    createModalInst?.hide();
    resetCreate();
    await loadHistory(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to post stock");
  } finally {
    saving.value = false;
  }
}

watch(
  () => createLines.value.map((x) => x.inventory_item_id),
  () => { for (const ln of createLines.value || []) { if (ln.inventory_item_id) ensureLineUom(ln); } },
  { deep: true }
);

// ===== VIEW =====
const viewing = ref(null);
const viewReceipt = ref(null);
const viewLoading = ref(false);

async function openView(receipt) {
  viewing.value = receipt;
  viewReceipt.value = null;
  const inst = await ensureModal(viewModalEl, "view");
  inst?.show();
  await nextTick();

  viewLoading.value = true;
  try {
    viewReceipt.value = await getPurchaseReceipt(receipt.id);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load receipt details");
  } finally {
    viewLoading.value = false;
  }
}
function closeView() {
  viewing.value = null;
  viewReceipt.value = null;
  viewModalInst?.hide();
}

// ===== EDIT =====
const editId = ref(null);
const editForm = ref({ outlet_id: null, supplier_id: null, received_at: "", note: "" });
const editLines = ref([]);

function resetEdit() {
  editId.value = null;
  editForm.value = { outlet_id: null, supplier_id: null, received_at: "", note: "" };
  editLines.value = [];
}
function addEditLine() { editLines.value.push({ inventory_item_id: null, uom_id: null, qty: "", unit_cost: "" }); }
function removeEditLine(idx) { if (editLines.value.length === 1) return; editLines.value.splice(idx, 1); }
function isoToLocalDatetime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function openEdit(receipt) {
  if (receipt.purchase_order_id != null) return toast.error("Only direct receipts can be edited here");
  if (receipt.voided_at) return toast.error("Cannot edit a voided receipt");
  resetEdit();
  editId.value = receipt.id;

  const inst = await ensureModal(editModalEl, "edit");
  inst?.show();
  await nextTick();

  saving.value = true;
  try {
    const full = await getPurchaseReceipt(receipt.id);
    editForm.value = {
      outlet_id: full.outlet_id ? Number(full.outlet_id) : null,
      supplier_id: full.supplier_id ? Number(full.supplier_id) : null,
      received_at: isoToLocalDatetime(full.received_at),
      note: full.note || "",
    };
    editLines.value = (full.items || []).map((x) => ({
      inventory_item_id: x.inventory_item_id ? Number(x.inventory_item_id) : null,
      uom_id: x.uom_id ? Number(x.uom_id) : null,
      qty: String(x.qty ?? ""),
      unit_cost: String(x.unit_cost ?? ""),
    })) || [];
    if (editLines.value.length === 0) addEditLine();
    for (const ln of editLines.value || []) ensureLineUom(ln);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load receipt for edit");
    editModalInst?.hide();
  } finally {
    saving.value = false;
  }
}

async function submitEdit() {
  if (!editId.value) return;
  if (!editForm.value.outlet_id) return toast.error("Outlet is required");
  if (!editForm.value.supplier_id) return toast.error("Supplier is required");
  const { error, items: cleanItems } = validateLines(editLines.value);
  if (error) return toast.error(error);

  saving.value = true;
  try {
    const payload = {
      outlet_id: Number(editForm.value.outlet_id),
      supplier_id: Number(editForm.value.supplier_id),
      received_at: editForm.value.received_at ? new Date(editForm.value.received_at).toISOString() : null,
      note: editForm.value.note?.trim() || null,
      items: cleanItems,
    };
    await http.put(`/purchases/receipts/${editId.value}/direct`, payload);
    toast.success("Stock intake updated");
    editModalInst?.hide();
    resetEdit();
    await loadHistory(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update stock intake");
  } finally {
    saving.value = false;
  }
}

watch(
  () => editLines.value.map((x) => x.inventory_item_id),
  () => { for (const ln of editLines.value || []) { if (ln.inventory_item_id) ensureLineUom(ln); } },
  { deep: true }
);

// ===== VOID =====
const voiding = ref(null);
const voidNote = ref("");

async function openVoid(receipt) {
  if (receipt.voided_at) return toast.error("This receipt is already voided");
  voiding.value = receipt;
  voidNote.value = "";
  const inst = await ensureModal(voidModalEl, "void");
  inst?.show();
  await nextTick();
}

async function confirmVoid() {
  if (!voiding.value) return;
  saving.value = true;
  try {
    await http.post(`/purchases/receipts/${voiding.value.id}/void`, { note: voidNote.value?.trim() || null });
    toast.success("Receipt voided (stock reversed)");
    voidModalInst?.hide();
    voiding.value = null;
    voidNote.value = "";
    await loadHistory(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to void receipt");
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await loadAll();
  await loadHistory(true);
});
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-truck-line"></i><span>Purchasing</span>
          </div>
          <h1 class="hero-title">Stock Intake</h1>
          <p class="hero-sub">
            Direct stock receipts — when inventory arrives without a PO. Edit reverses + reposts; Void reverses stock and keeps the audit trail.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="loadHistory(false)" :disabled="refreshing || loadingTable">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button v-can="'purchases:manage'" class="btn btn-pill btn-cta" @click="openCreate">
            <i class="ri-add-line"></i><span>New Stock Intake</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loadingTable">
        <div class="stat-tile">
          <div class="stat-icon tone-primary"><i class="ri-truck-line"></i></div>
          <div>
            <div class="stat-label">Records</div>
            <div class="stat-value">{{ summary.total }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-success"><i class="ri-check-double-line"></i></div>
          <div>
            <div class="stat-label">Posted</div>
            <div class="stat-value text-success">{{ summary.posted }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-danger"><i class="ri-close-circle-line"></i></div>
          <div>
            <div class="stat-label">Voided</div>
            <div class="stat-value">{{ summary.voided }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-info"><i class="ri-money-dollar-circle-line"></i></div>
          <div>
            <div class="stat-label">Total value</div>
            <div class="stat-value">K {{ fmtMoney(summary.totalValue) }}</div>
          </div>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2 overflow-visible">
          <div class="row g-2 align-items-end overflow-visible">
            <div class="col-md-3 overflow-visible">
              <label class="form-label">Outlet</label>
              <SearchSelect
                v-model="filters.outlet_id"
                :options="outletOptions"
                placeholder="All outlets"
                :clearable="true"
                :searchable="true"
                nullLabel="All outlets"
              />
            </div>
            <div class="col-md-4 overflow-visible">
              <label class="form-label">Supplier</label>
              <SearchSelect
                v-model="filters.supplier_id"
                :options="supplierOptions"
                placeholder="All suppliers"
                :clearable="true"
                :searchable="true"
                nullLabel="All suppliers"
              />
            </div>
            <div class="col-md-2">
              <label class="form-label">Show last</label>
              <select v-model="filters.limit" class="form-select">
                <option :value="50">50</option>
                <option :value="100">100</option>
                <option :value="200">200</option>
                <option :value="500">500</option>
              </select>
            </div>
            <div class="col-md-2">
              <div class="toggle-card mt-md-4">
                <div>
                  <div class="fw-semibold small">Show voided</div>
                </div>
                <div class="form-check form-switch m-0">
                  <input id="showVoided" class="form-check-input" type="checkbox" v-model="filters.show_voided" />
                </div>
              </div>
            </div>
            <div class="col-md-1 d-grid">
              <button class="btn btn-light" @click="clearFilters" title="Clear">
                <i class="ri-filter-off-line"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loadingTable" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading stock intakes…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="displayRows.length === 0" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-truck-line"></i></div>
        <h5 class="mt-2 mb-1">No stock intakes found</h5>
        <p class="text-muted mb-3">Post a direct stock intake when inventory arrives without a PO.</p>
        <div>
          <button v-can="'purchases:manage'" class="btn btn-primary" @click="openCreate">
            <i class="ri-add-line me-1"></i> New stock intake
          </button>
        </div>
      </div>

      <!-- ============== Intakes table ============== -->
      <div v-else class="card data-card">
        <div class="card-body p-0">
          <div class="table-responsive data-scroll">
            <table class="table align-middle mb-0 si-table">
              <thead>
                <tr>
                  <th style="width: 80px">ID</th>
                  <th style="width: 140px">Received</th>
                  <th style="width: 180px">Outlet</th>
                  <th style="width: 180px">Supplier</th>
                  <th>Items</th>
                  <th style="width: 110px" class="text-center">Status</th>
                  <th style="width: 130px" class="text-end">Total</th>
                  <th style="width: 130px" class="text-end"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in displayRows"
                  :key="r.id"
                  class="si-row"
                  :class="{ 'is-voided': !!r.voided_at }"
                >
                  <td>
                    <span class="id-chip">#{{ r.id }}</span>
                  </td>
                  <td>
                    <div class="when-date">{{ fmtDateOnly(r.received_at) }}</div>
                    <div class="when-time">{{ fmtTimeShort(r.received_at) }}</div>
                  </td>
                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <div class="avatar-sm" :style="{ '--accent': colorFor(outletName(r.outlet_id)) }">
                        {{ initialsOf(outletName(r.outlet_id)) }}
                      </div>
                      <div class="truncate fw-semibold">{{ outletName(r.outlet_id) }}</div>
                    </div>
                  </td>
                  <td>
                    <span class="sup-chip">
                      <i class="ri-store-3-line me-1"></i>{{ supplierName(r.supplier_id) }}
                    </span>
                  </td>
                  <td>
                    <div class="items-count">{{ (r.items || []).length }} item(s)</div>
                    <div class="items-preview text-muted truncate" :title="receiptItemsPreview(r, 4)">
                      {{ receiptItemsPreview(r, 2) }}
                    </div>
                  </td>
                  <td class="text-center">
                    <span class="status-pill" :class="r.voided_at ? 'pill-danger' : 'pill-success'">
                      <span class="dot-mini"></span>{{ r.voided_at ? 'Voided' : 'Posted' }}
                    </span>
                  </td>
                  <td class="text-end">
                    <span class="amount-mono">K {{ fmtMoney(receiptTotal(r)) }}</span>
                  </td>
                  <td class="text-end">
                    <button class="row-icon-btn" title="View" @click="openView(r)">
                      <i class="ri-eye-line"></i>
                    </button>
                    <button v-can="'purchases:manage'" class="row-icon-btn" title="Edit" :disabled="!!r.voided_at" @click="openEdit(r)">
                      <i class="ri-pencil-line"></i>
                    </button>
                    <button v-can="'purchases:manage'" class="row-icon-btn danger" title="Void" :disabled="!!r.voided_at" @click="openVoid(r)">
                      <i class="ri-close-circle-line"></i>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== CREATE MODAL ============== -->
    <div class="modal fade" id="createIntakeModal" tabindex="-1" aria-hidden="true" ref="createModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-xl">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">New</div>
              <h5 class="modal-title">New stock intake</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="saving"></button>
          </div>

          <div v-if="saving" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Posting…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <div class="row g-3 mb-3">
              <div class="col-md-4">
                <label class="form-label">Outlet *</label>
                <SearchSelect v-model="createForm.outlet_id" :options="outletOptions" placeholder="Select outlet…" :clearable="true" :searchable="true" :disabled="saving" />
              </div>
              <div class="col-md-4">
                <label class="form-label">Supplier *</label>
                <SearchSelect v-model="createForm.supplier_id" :options="supplierOptions" placeholder="Select supplier…" :clearable="true" :searchable="true" :disabled="saving" />
              </div>
              <div class="col-md-4">
                <label class="form-label">Received at</label>
                <input v-model="createForm.received_at" type="datetime-local" class="form-control" :disabled="saving" />
              </div>
              <div class="col-12">
                <label class="form-label">Note</label>
                <input v-model="createForm.note" class="form-control" placeholder="Delivery note, driver, etc." :disabled="saving" />
              </div>
            </div>

            <div class="d-flex justify-content-between align-items-center mb-2">
              <div class="fw-semibold">
                <i class="ri-shopping-bag-3-line me-1 text-primary"></i>Lines
              </div>
              <button class="btn btn-soft-primary btn-sm" :disabled="saving" @click="addCreateLine">
                <i class="ri-add-line me-1"></i>Add line
              </button>
            </div>

            <div class="table-responsive lines-scroll">
              <table class="table align-middle mb-0 line-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style="width: 200px">UOM</th>
                    <th style="width: 110px" class="text-end">Qty</th>
                    <th style="width: 140px" class="text-end">Unit cost</th>
                    <th style="width: 110px" class="text-end">Avg cost</th>
                    <th style="width: 60px"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(ln, idx) in createLines" :key="idx">
                    <td>
                      <SearchSelect v-model="ln.inventory_item_id" :options="itemOptions" placeholder="Select item…" :clearable="true" :searchable="true" :disabled="saving" />
                    </td>
                    <td>
                      <SearchSelect v-model="ln.uom_id" :options="uomOptionsForInventory(ln.inventory_item_id)" placeholder="Select UOM…" :clearable="true" :searchable="true" :disabled="saving || !ln.inventory_item_id" />
                    </td>
                    <td>
                      <input v-model="ln.qty" class="form-control form-control-sm text-end qty-input" placeholder="0" :disabled="saving" />
                    </td>
                    <td>
                      <div class="input-group input-group-sm">
                        <span class="input-group-text">K</span>
                        <input v-model="ln.unit_cost" class="form-control text-end qty-input" placeholder="0.00" :disabled="saving" />
                      </div>
                    </td>
                    <td class="text-end">
                      <span v-if="invAvgCostPerSelectedUom(ln.inventory_item_id, ln.uom_id) != null" class="avg-cost-chip">
                        {{ fmtMoney(invAvgCostPerSelectedUom(ln.inventory_item_id, ln.uom_id), 4) }}
                      </span>
                      <span v-else class="text-muted">—</span>
                    </td>
                    <td class="text-end">
                      <button class="row-icon-btn danger" :disabled="saving || createLines.length === 1" @click="removeCreateLine(idx)">
                        <i class="ri-delete-bin-line"></i>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="tip-card mt-3">
              <i class="ri-information-line tip-icon"></i>
              <div class="small">
                <div class="fw-semibold mb-1">One-way operation</div>
                <div class="text-muted">
                  Posting stock can't be undone here. If you make a mistake, use <strong>Edit</strong> (reverses + reposts) or <strong>Void</strong>. UOM is restricted to the item's base UOM or its configured conversions.
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button class="btn btn-success" :disabled="saving" @click="submitCreate">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              <i v-else class="ri-check-double-line me-1"></i>
              Post stock
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== VIEW MODAL ============== -->
    <div class="modal fade" id="viewIntakeModal" tabindex="-1" aria-hidden="true" ref="viewModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-xl">
        <div class="modal-content modal-modern">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">View</div>
              <h5 class="modal-title">Stock intake details</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" @click="closeView"></button>
          </div>

          <div class="modal-body modal-body-modern">
            <div v-if="viewLoading" class="d-flex align-items-center gap-2 text-muted">
              <div class="spinner-border spinner-border-sm" role="status"></div>
              <div>Loading…</div>
            </div>

            <div v-else-if="viewReceipt">
              <!-- Header tiles -->
              <div class="row g-2 mb-3">
                <div class="col-md-3">
                  <div class="kv-tile">
                    <div class="kv-label">ID</div>
                    <div class="kv-val mono">#{{ viewReceipt.id }}</div>
                  </div>
                </div>
                <div class="col-md-3">
                  <div class="kv-tile">
                    <div class="kv-label">Received</div>
                    <div class="kv-val">{{ formatDate(viewReceipt.received_at) }}</div>
                  </div>
                </div>
                <div class="col-md-3">
                  <div class="kv-tile">
                    <div class="kv-label">Outlet</div>
                    <div class="kv-val">{{ outletName(viewReceipt.outlet_id) }}</div>
                  </div>
                </div>
                <div class="col-md-3">
                  <div class="kv-tile">
                    <div class="kv-label">Supplier</div>
                    <div class="kv-val">{{ supplierName(viewReceipt.supplier_id) }}</div>
                  </div>
                </div>
              </div>

              <div class="row g-2 mb-3">
                <div class="col-md-7">
                  <div class="kv-tile">
                    <div class="kv-label">Note</div>
                    <div class="kv-val">{{ viewReceipt.note || '—' }}</div>
                  </div>
                </div>
                <div class="col-md-2">
                  <div class="kv-tile">
                    <div class="kv-label">Status</div>
                    <div class="kv-val">
                      <span class="status-pill" :class="viewReceipt.voided_at ? 'pill-danger' : 'pill-success'">
                        <span class="dot-mini"></span>{{ viewReceipt.voided_at ? 'Voided' : 'Posted' }}
                      </span>
                    </div>
                  </div>
                </div>
                <div class="col-md-3">
                  <div class="kv-tile">
                    <div class="kv-label">Total</div>
                    <div class="kv-val mono fw-bold">K {{ fmtMoney(receiptTotal(viewReceipt)) }}</div>
                  </div>
                </div>
              </div>

              <div v-if="viewReceipt.voided_at" class="banner banner-warn mb-3">
                <div class="banner-icon"><i class="ri-close-circle-line"></i></div>
                <div>
                  <div class="banner-title">Voided</div>
                  <div class="banner-sub">
                    {{ formatDate(viewReceipt.voided_at) }} · {{ viewReceipt.void_note || 'No note' }}
                  </div>
                </div>
              </div>

              <div class="table-responsive">
                <table class="table align-middle mb-0 line-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th style="width: 100px">UOM</th>
                      <th style="width: 110px" class="text-end">Qty</th>
                      <th style="width: 130px" class="text-end">Unit cost</th>
                      <th style="width: 130px" class="text-end">Avg cost</th>
                      <th style="width: 140px" class="text-end">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="x in viewReceipt.items" :key="x.id">
                      <td>
                        <div class="d-flex align-items-center gap-2">
                          <div class="item-avatar" :style="{ '--accent': colorFor(itemLabelById(x.inventory_item_id)) }">
                            {{ initialsOf(itemLabelById(x.inventory_item_id)) }}
                          </div>
                          <div class="item-name">{{ itemLabelById(x.inventory_item_id) }}</div>
                        </div>
                      </td>
                      <td><span class="uom-mini">{{ uomCodeById(x.uom_id) || 'UOM' }}</span></td>
                      <td class="text-end mono">{{ x.qty }}</td>
                      <td class="text-end mono">K {{ fmtMoney(x.unit_cost, 4) }}</td>
                      <td class="text-end">
                        <span v-if="invLastPrice(x.inventory_item_id) != null" class="avg-cost-chip">{{ fmtMoney(invLastPrice(x.inventory_item_id), 4) }}</span>
                        <span v-else>—</span>
                      </td>
                      <td class="text-end mono fw-bold">
                        K {{ (Number(x.qty) && Number(x.unit_cost)) ? fmtMoney(Number(x.qty) * Number(x.unit_cost)) : '—' }}
                      </td>
                    </tr>
                    <tr v-if="!viewReceipt.items || viewReceipt.items.length === 0">
                      <td colspan="6" class="text-center text-muted py-3">No items</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div v-else class="text-muted">No data</div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" @click="closeView">Close</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== EDIT MODAL ============== -->
    <div class="modal fade" id="editIntakeModal" tabindex="-1" aria-hidden="true" ref="editModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-xl">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">Edit</div>
              <h5 class="modal-title">Edit stock intake</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="saving" @click="resetEdit"></button>
          </div>

          <div v-if="saving" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <div class="row g-3 mb-3">
              <div class="col-md-4">
                <label class="form-label">Outlet *</label>
                <SearchSelect v-model="editForm.outlet_id" :options="outletOptions" placeholder="Select outlet…" :clearable="true" :searchable="true" :disabled="saving" />
              </div>
              <div class="col-md-4">
                <label class="form-label">Supplier *</label>
                <SearchSelect v-model="editForm.supplier_id" :options="supplierOptions" placeholder="Select supplier…" :clearable="true" :searchable="true" :disabled="saving" />
              </div>
              <div class="col-md-4">
                <label class="form-label">Received at</label>
                <input v-model="editForm.received_at" type="datetime-local" class="form-control" :disabled="saving" />
              </div>
              <div class="col-12">
                <label class="form-label">Note</label>
                <input v-model="editForm.note" class="form-control" placeholder="Optional note…" :disabled="saving" />
              </div>
            </div>

            <div class="d-flex justify-content-between align-items-center mb-2">
              <div class="fw-semibold">
                <i class="ri-shopping-bag-3-line me-1 text-primary"></i>Lines
              </div>
              <button class="btn btn-soft-primary btn-sm" :disabled="saving" @click="addEditLine">
                <i class="ri-add-line me-1"></i>Add line
              </button>
            </div>

            <div class="table-responsive lines-scroll">
              <table class="table align-middle mb-0 line-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style="width: 200px">UOM</th>
                    <th style="width: 110px" class="text-end">Qty</th>
                    <th style="width: 140px" class="text-end">Unit cost</th>
                    <th style="width: 110px" class="text-end">Avg cost</th>
                    <th style="width: 60px"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(ln, idx) in editLines" :key="idx">
                    <td>
                      <SearchSelect v-model="ln.inventory_item_id" :options="itemOptions" placeholder="Select item…" :clearable="true" :searchable="true" :disabled="saving" />
                    </td>
                    <td>
                      <SearchSelect v-model="ln.uom_id" :options="uomOptionsForInventory(ln.inventory_item_id)" placeholder="Select UOM…" :clearable="true" :searchable="true" :disabled="saving || !ln.inventory_item_id" />
                    </td>
                    <td>
                      <input v-model="ln.qty" class="form-control form-control-sm text-end qty-input" placeholder="0" :disabled="saving" />
                    </td>
                    <td>
                      <div class="input-group input-group-sm">
                        <span class="input-group-text">K</span>
                        <input v-model="ln.unit_cost" class="form-control text-end qty-input" placeholder="0.00" :disabled="saving" />
                      </div>
                    </td>
                    <td class="text-end">
                      <span v-if="invAvgCostPerSelectedUom(ln.inventory_item_id, ln.uom_id) != null" class="avg-cost-chip">
                        {{ fmtMoney(invAvgCostPerSelectedUom(ln.inventory_item_id, ln.uom_id), 4) }}
                      </span>
                      <span v-else class="text-muted">—</span>
                    </td>
                    <td class="text-end">
                      <button class="row-icon-btn danger" :disabled="saving || editLines.length === 1" @click="removeEditLine(idx)">
                        <i class="ri-delete-bin-line"></i>
                      </button>
                    </td>
                  </tr>
                  <tr v-if="editLines.length === 0">
                    <td colspan="6" class="text-center text-muted py-3">No lines</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="tip-card mt-3">
              <i class="ri-refresh-line tip-icon"></i>
              <div class="small">
                <div class="fw-semibold mb-1">Reverse + repost</div>
                <div class="text-muted">
                  Editing performs a reversal then re-posts. UOM is restricted to the item's base UOM or its configured conversions.
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving" @click="resetEdit">Cancel</button>
            <button class="btn btn-primary" :disabled="saving" @click="submitEdit">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              <i v-else class="ri-save-line me-1"></i>
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== VOID MODAL ============== -->
    <div class="modal fade" id="voidIntakeModal" tabindex="-1" aria-hidden="true" ref="voidModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">Void</div>
              <h5 class="modal-title">Void stock intake</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="saving"></button>
          </div>

          <div v-if="saving" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Voiding…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <div class="banner banner-warn mb-3">
              <div class="banner-icon"><i class="ri-error-warning-line"></i></div>
              <div>
                <div class="banner-title">This reverses stock</div>
                <div class="banner-sub">On-hand and average cost will be reversed. The receipt stays in history for audit.</div>
              </div>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-md-3">
                <div class="kv-tile">
                  <div class="kv-label">Receipt</div>
                  <div class="kv-val mono">#{{ voiding?.id }}</div>
                </div>
              </div>
              <div class="col-md-4">
                <div class="kv-tile">
                  <div class="kv-label">Outlet</div>
                  <div class="kv-val">{{ voiding ? outletName(voiding.outlet_id) : '—' }}</div>
                </div>
              </div>
              <div class="col-md-5">
                <div class="kv-tile">
                  <div class="kv-label">Supplier</div>
                  <div class="kv-val">{{ voiding ? supplierName(voiding.supplier_id) : '—' }}</div>
                </div>
              </div>
              <div class="col-12">
                <div class="kv-tile">
                  <div class="kv-label">Received at</div>
                  <div class="kv-val">{{ voiding ? formatDate(voiding.received_at) : '—' }}</div>
                </div>
              </div>
            </div>

            <label class="form-label">Reason / note <span class="text-muted small">(optional)</span></label>
            <input v-model="voidNote" class="form-control" placeholder="Why are you voiding this intake?" :disabled="saving" />
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button class="btn btn-danger" :disabled="saving" @click="confirmVoid">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              <i v-else class="ri-close-circle-line me-1"></i>
              Void (reverse stock)
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
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem;
  padding: 1.5rem 1.75rem; margin-bottom: 1.25rem;
  border-radius: 22px;
  background: linear-gradient(135deg, #134e4a 0%, #0891b2 50%, #2563eb 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(8,145,178,0.55);
  overflow: hidden; flex-wrap: wrap;
}
.page-hero::before {
  content: ""; position: absolute; inset: 0;
  background:
    radial-gradient(220px 140px at 90% 10%, rgba(255,255,255,0.22), transparent 65%),
    radial-gradient(280px 180px at 0% 110%, rgba(255,255,255,0.14), transparent 65%);
  pointer-events: none;
}
.page-hero-text { position: relative; max-width: 600px; }
.eyebrow {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.25rem 0.65rem;
  background: rgba(255,255,255,0.18);
  border-radius: 999px;
  font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  margin-bottom: 0.6rem;
}
.hero-title { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.025em; font-size: 1.85rem; margin: 0; color: #fff; }
.hero-sub { color: rgba(255,255,255,0.85); margin: 0.35rem 0 0; font-size: 0.9rem; }
.page-hero-actions { position: relative; display: flex; gap: 0.5rem; flex-wrap: wrap; }
.btn-pill { border-radius: 999px !important; display: inline-flex; align-items: center; gap: 0.4rem; }
.page-hero-actions .btn-light { background: rgba(255,255,255,0.95); color: #0f172a; border: none; }
.btn-cta { background: #fff !important; color: #0d9488 !important; font-weight: 700; border: none; box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3); }

/* ============= Stat strip ============= */
.stat-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; }
.stat-tile {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.85rem 1rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px; box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.stat-icon { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; font-size: 1.05rem; }
.stat-icon.tone-primary { background: rgba(13,148,136,0.14); color: #0d9488; }
.stat-icon.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.stat-icon.tone-danger { background: rgba(239,68,68,0.14); color: #b91c1c; }
.stat-icon.tone-info { background: rgba(8,145,178,0.14); color: #0891b2; }
.stat-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ct-secondary-color, #64748b); }
.stat-value { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.05rem; color: var(--ct-body-color, #0f172a); }

/* ============= Toolbar / Empty ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(13,148,136,0.05) 0%, transparent 100%); }
.overflow-visible { overflow: visible !important; }
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(13,148,136,0.12); color: #0d9488; font-size: 1.6rem;
}
.toggle-card {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
  background: var(--ct-tertiary-bg, #f8fafc);
}

/* ============= Intakes table ============= */
.data-card { overflow: hidden; }
.data-scroll {
  max-height: calc(100vh - 480px);
  min-height: 240px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.si-table thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.si-row { transition: background 0.15s ease; }
.si-row:hover { background: rgba(13,148,136,0.04); }
.si-row.is-voided { opacity: 0.6; }

.id-chip {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.78rem; font-weight: 700;
  padding: 0.2rem 0.5rem; border-radius: 6px;
  background: rgba(13,148,136,0.1); color: #0d9488;
  border: 1px solid rgba(13,148,136,0.22);
}
.when-date { font-weight: 700; font-size: 0.82rem; color: var(--ct-body-color, #0f172a); line-height: 1.2; }
.when-time { font-size: 0.72rem; color: var(--ct-secondary-color, #64748b); font-family: "JetBrains Mono", ui-monospace, monospace; }
.avatar-sm {
  width: 32px; height: 32px;
  border-radius: 9px;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 0.72rem;
  color: var(--accent, #0d9488);
  background: color-mix(in srgb, var(--accent, #0d9488) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #0d9488) 28%, transparent);
  flex-shrink: 0;
}
.sup-chip {
  display: inline-flex; align-items: center;
  font-size: 0.78rem; font-weight: 600;
  padding: 0.2rem 0.55rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 8px;
  color: var(--ct-secondary-color, #475569);
}
.items-count { font-weight: 700; font-size: 0.82rem; color: var(--ct-body-color, #0f172a); }
.items-preview { font-size: 0.72rem; max-width: 320px; }
.truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

.status-pill {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.15rem 0.55rem; border-radius: 999px;
  font-size: 0.68rem; font-weight: 700; letter-spacing: 0.04em;
}
.dot-mini { width: 6px; height: 6px; border-radius: 50%; }
.pill-success { background: rgba(16,185,129,0.14); color: #047857; }
.pill-success .dot-mini { background: #10b981; }
.pill-danger { background: rgba(239,68,68,0.14); color: #b91c1c; }
.pill-danger .dot-mini { background: #ef4444; }

.amount-mono { font-family: "JetBrains Mono", ui-monospace, monospace; font-weight: 700; font-size: 0.85rem; color: var(--ct-body-color, #0f172a); }
.mono { font-family: "JetBrains Mono", ui-monospace, monospace; }

.row-icon-btn {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
  margin-left: 2px;
}
.row-icon-btn:hover { background: rgba(13,148,136,0.1); color: #0d9488; }
.row-icon-btn.danger:hover { background: rgba(239,68,68,0.1); color: #ef4444; }
.row-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ============= Modal ============= */
:deep(.modal-modern) {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 22px !important;
  overflow: hidden;
  box-shadow: 0 30px 60px -20px rgba(15,23,42,0.35);
  background: var(--ct-card-bg, #fff);
}
:deep(.modal-header-modern) {
  padding: 1.25rem 1.5rem 1rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  display: flex; justify-content: space-between; align-items: flex-start;
}
:deep(.modal-eyebrow) { font-size: 0.68rem; font-weight: 700; color: #0d9488; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.25rem; }
:deep(.modal-header-modern .modal-title) { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.25rem; }
:deep(.modal-body-modern) { padding: 1.5rem; scrollbar-width: thin; }
:deep(.modal-dialog-scrollable .modal-body)::-webkit-scrollbar { width: 8px; }
:deep(.modal-dialog-scrollable .modal-body)::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

:deep(.vs__dropdown-menu),
:deep(.search-select__menu),
:deep(.search-select__dropdown) { z-index: 9999 !important; }

.modal-overlay {
  position: absolute; inset: 0; z-index: 5;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
}

/* Lines table inside modal */
.lines-scroll {
  max-height: 45vh;
  overflow: auto;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  scrollbar-width: thin;
}
.lines-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.lines-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.line-table thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.qty-input { font-family: "JetBrains Mono", ui-monospace, monospace; font-weight: 600; }
.uom-mini {
  display: inline-block;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700; font-size: 0.72rem;
  padding: 0.2rem 0.5rem; border-radius: 6px;
  background: rgba(13,148,136,0.1); color: #0d9488;
  border: 1px solid rgba(13,148,136,0.22);
}
.avg-cost-chip {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.74rem; font-weight: 600;
  padding: 0.15rem 0.45rem; border-radius: 6px;
  background: rgba(8,145,178,0.1); color: #0891b2;
  border: 1px solid rgba(8,145,178,0.22);
}
.item-avatar {
  width: 30px; height: 30px;
  border-radius: 8px;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 0.66rem;
  color: var(--accent, #0d9488);
  background: color-mix(in srgb, var(--accent, #0d9488) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #0d9488) 28%, transparent);
  flex-shrink: 0;
}
.item-name { font-weight: 700; color: var(--ct-body-color, #0f172a); }

/* KV tiles in view modal */
.kv-tile {
  padding: 0.65rem 0.85rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
}
.kv-label {
  font-size: 0.66rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--ct-secondary-color, #64748b);
}
.kv-val { font-weight: 700; color: var(--ct-body-color, #0f172a); margin-top: 0.15rem; }

.tip-card {
  display: flex; gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: rgba(13,148,136,0.06);
  border: 1px solid rgba(13,148,136,0.18);
  align-items: flex-start;
}
.tip-icon { font-size: 1.2rem; color: #0d9488; flex-shrink: 0; }

/* Banner */
.banner {
  display: flex; align-items: flex-start; gap: 0.85rem;
  padding: 1rem 1.25rem;
  border-radius: 14px;
  border: 1px solid;
}
.banner-icon {
  width: 40px; height: 40px;
  border-radius: 10px;
  display: grid; place-items: center;
  font-size: 1.2rem; flex-shrink: 0;
}
.banner-title { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; }
.banner-sub { font-size: 0.85rem; margin-top: 0.15rem; }
.banner-warn {
  background: rgba(245,158,11,0.06);
  border-color: rgba(245,158,11,0.3);
  color: #b45309;
}
.banner-warn .banner-icon { background: rgba(245,158,11,0.18); color: #b45309; }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
