<!-- src/views/purchasing/StockIntake.vue -->
<script setup>
import { ref, onMounted, computed, watch } from "vue";
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
const loadingTable = ref(false);
const saving = ref(false);

const outlets = ref([]);
const suppliers = ref([]);
const uoms = ref([]);
const uomConversions = ref([]);
const items = ref([]);

const outletMap = computed(() => {
  const m = new Map();
  for (const o of outlets.value || []) m.set(Number(o.id), o);
  return m;
});
const supplierMap = computed(() => {
  const m = new Map();
  for (const s of suppliers.value || []) m.set(Number(s.id), s);
  return m;
});
const itemMap = computed(() => {
  const m = new Map();
  for (const it of items.value || []) m.set(Number(it.id), it);
  return m;
});
const uomMap = computed(() => {
  const m = new Map();
  for (const u of uoms.value || []) m.set(Number(u.id), u);
  return m;
});

/* -------------------- SearchSelect Options -------------------- */

const outletOptions = computed(() =>
  (outlets.value || []).map((o) => ({
    label: o.name || `Outlet #${o.id}`,
    value: Number(o.id),
  }))
);

const supplierOptions = computed(() =>
  (suppliers.value || []).map((s) => ({
    label: s.name || `Supplier #${s.id}`,
    value: Number(s.id),
  }))
);

const itemOptions = computed(() =>
  (items.value || []).map((it) => ({
    label: it.sku ? `${it.sku} - ${it.name}` : it.name || `Item #${it.id}`,
    value: Number(it.id),
  }))
);

function uomLabel(u) {
  const code = u?.code || "";
  const name = u?.name || "";
  return `${code}${code && name ? " — " : ""}${name}`.trim() || `UOM #${u?.id}`;
}

/* -------------------- UOM Compatibility (base + conversions) -------------------- */

// Build weighted graph:
// 1 FROM = multiplier * TO  => qty_to = qty_from * multiplier
const convGraph = computed(() => {
  const g = new Map(); // uomId -> [{ to, factor }]
  for (const c of uomConversions.value || []) {
    const from = Number(c.from_uom_id);
    const to = Number(c.to_uom_id);
    const mult = Number(c.multiplier);

    if (!from || !to || !Number.isFinite(mult) || mult <= 0) continue;

    if (!g.has(from)) g.set(from, []);
    if (!g.has(to)) g.set(to, []);

    g.get(from).push({ to, factor: mult });
    g.get(to).push({ to: from, factor: 1 / mult }); // reverse
  }
  return g;
});

// factor(from, to): multiply qty_in_from by this to get qty_in_to
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

/**
 * avg_cost is stored per BASE UOM in inventory_items.
 * Convert it to "per selected UOM" so user sees correct unit price.
 *
 * Example:
 * base=gram, selected=kg, avg_cost=0.02 per gram
 * factor(selected -> base)=1000 (1 kg = 1000 g)
 * avg_per_selected = avg_cost * factor(selected->base)
 */
function invAvgCostPerSelectedUom(invId, selectedUomId) {
  const inv = itemMap.value.get(Number(invId));
  if (!inv) return null;

  const avgBase = Number(inv.avg_cost); // per BASE UOM
  const baseUomId = Number(inv.base_uom_id);

  if (!Number.isFinite(avgBase) || !baseUomId || !selectedUomId) return null;

  const fSelectedToBase = conversionFactor(Number(selectedUomId), baseUomId);
  if (fSelectedToBase == null) return null;

  return avgBase * fSelectedToBase;
}

// Pretty formatter (optional but nice)
function fmtMoney(v, dp = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// compatible UOM IDs for an inventory item (base + all reachable via conversions)
function compatibleUomIdsForInventory(invId) {
  const inv = itemMap.value.get(Number(invId));
  const baseId = Number(inv?.base_uom_id || 0);

  // if item has no base, allow all uoms (fallback)
  if (!baseId) return (uoms.value || []).map((u) => Number(u.id));

  const g = convGraph.value;
  const seen = new Set([baseId]);
  const q = [baseId];

  while (q.length) {
    const cur = q.shift();
    for (const e of g.get(cur) || []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      q.push(e.to);
    }
  }

  return Array.from(seen);
}

function uomsForInventory(invId) {
  const allowed = new Set(compatibleUomIdsForInventory(invId));
  return (uoms.value || []).filter((u) => allowed.has(Number(u.id)));
}

function uomOptionsForInventory(invId) {
  return uomsForInventory(invId).map((u) => ({
    label: uomLabel(u),
    value: Number(u.id),
  }));
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

/* -------------------- Bootstrap Modal Helper -------------------- */

function bsModal(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const b = window.bootstrap;
  if (!b?.Modal) return null;
  return b.Modal.getOrCreateInstance(el);
}

/* -------------------- HISTORY TABLE -------------------- */

const rows = ref([]);
const filters = ref({
  outlet_id: null,
  supplier_id: null,
  show_voided: false, // default: hide voided
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

  r = [...r].sort((a, b) => {
    const da = new Date(a.received_at).getTime();
    const db = new Date(b.received_at).getTime();
    return db - da;
  });

  return r;
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

async function loadHistory() {
  loadingTable.value = true;
  try {
    const params = { limit: Number(filters.value.limit || 200) };
    if (filters.value.outlet_id) params.outlet_id = Number(filters.value.outlet_id);

    const data = await listPurchaseReceipts(params);
    rows.value = data || [];
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load stock intakes");
  } finally {
    loadingTable.value = false;
  }
}

let filterTimer = null;
watch(
  () => [filters.value.outlet_id, filters.value.supplier_id, filters.value.show_voided, filters.value.limit],
  () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadHistory, 150);
  }
);

/* -------------------- DISPLAY HELPERS -------------------- */

function formatDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function receiptTotal(receipt) {
  if (!receipt?.items) return "-";
  let sum = 0;
  for (const it of receipt.items || []) {
    const q = Number(it.qty);
    const c = Number(it.unit_cost);
    if (Number.isFinite(q) && Number.isFinite(c)) sum += q * c;
  }
  return Number.isFinite(sum) ? sum.toFixed(2) : "-";
}

function outletName(id) {
  const o = outletMap.value.get(Number(id));
  return o?.name || `Outlet #${id}`;
}

function supplierName(id) {
  const s = supplierMap.value.get(Number(id));
  return s?.name || `Supplier #${id}`;
}

function itemLabelById(id) {
  const it = itemMap.value.get(Number(id));
  if (!it) return `Item #${id}`;
  return it.sku ? `${it.sku} - ${it.name}` : it.name;
}

function uomCodeById(id) {
  const u = uomMap.value.get(Number(id));
  return u?.code || u?.name || "";
}

// ✅ last price from inventory_items.avg_cost (your backend updates avg_cost on posting)
function invLastPrice(invId) {
  const inv = itemMap.value.get(Number(invId));
  const v = Number(inv?.avg_cost);
  return Number.isFinite(v) ? v : null;
}

// ✅ show at least 2 items so user knows which receipt row to edit
function receiptItemsPreview(receipt, minCount = 2) {
  const arr = receipt?.items || [];
  if (!arr.length) return "-";

  const take = Math.max(minCount, 2);
  const parts = arr.slice(0, take).map((x) => {
    const name = itemLabelById(x.inventory_item_id);
    const qty = x.qty ?? "";
    const u = uomCodeById(x.uom_id);
    return `${name} (${qty} ${u})`.trim();
  });

  const more = arr.length > parts.length ? ` +${arr.length - parts.length} more` : "";
  return parts.join(" • ") + more;
}

/* -------------------- CREATE MODAL -------------------- */

const createForm = ref({
  outlet_id: null,
  supplier_id: null,
  received_at: "",
  note: "",
});

const createLines = ref([
  { inventory_item_id: null, uom_id: null, qty: "", unit_cost: "" },
]);

function resetCreate() {
  createForm.value = { outlet_id: null, supplier_id: null, received_at: "", note: "" };
  createLines.value = [{ inventory_item_id: null, uom_id: null, qty: "", unit_cost: "" }];
}

function addCreateLine() {
  createLines.value.push({ inventory_item_id: null, uom_id: null, qty: "", unit_cost: "" });
}

function removeCreateLine(idx) {
  if (createLines.value.length === 1) return;
  createLines.value.splice(idx, 1);
}

function normalizeNumberString(v) {
  if (v == null) return "";
  return String(v).trim();
}

function validateLines(linesArr) {
  const clean = (linesArr || [])
    .map((ln) => ({
      inventory_item_id: ln.inventory_item_id ? Number(ln.inventory_item_id) : null,
      uom_id: ln.uom_id ? Number(ln.uom_id) : null,
      qty: normalizeNumberString(ln.qty),
      unit_cost: normalizeNumberString(ln.unit_cost),
    }))
    .filter((ln) => ln.inventory_item_id && ln.uom_id && ln.qty && ln.unit_cost);

  if (clean.length === 0) {
    return { error: "Add at least 1 valid line (item, uom, qty, unit cost)", items: [] };
  }

  for (const ln of clean) {
    const q = Number(ln.qty);
    const c = Number(ln.unit_cost);
    if (!Number.isFinite(q) || q <= 0) return { error: "Qty must be > 0", items: [] };
    if (!Number.isFinite(c) || c < 0) return { error: "Unit cost must be >= 0", items: [] };

    // ✅ enforce UOM compatibility on client (base + conversions only)
    const allowed = new Set(compatibleUomIdsForInventory(ln.inventory_item_id));
    if (!allowed.has(Number(ln.uom_id))) {
      return { error: "Invalid UOM for selected item (only base UOM or conversions allowed).", items: [] };
    }
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

    bsModal("createIntakeModal")?.hide();
    resetCreate();
    await loadHistory();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to post stock");
  } finally {
    saving.value = false;
  }
}

// Auto-pick base UOM (or first allowed) when item changes (CREATE)
watch(
  () => createLines.value.map((x) => x.inventory_item_id),
  () => {
    for (const ln of createLines.value || []) {
      if (!ln.inventory_item_id) continue;
      ensureLineUom(ln);
    }
  },
  { deep: true }
);

/* -------------------- VIEW MODAL -------------------- */

const viewing = ref(null);
const viewReceipt = ref(null);
const viewLoading = ref(false);

async function openView(receipt) {
  viewing.value = receipt;
  viewReceipt.value = null;

  bsModal("viewIntakeModal")?.show();

  viewLoading.value = true;
  try {
    const full = await getPurchaseReceipt(receipt.id);
    viewReceipt.value = full;
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load receipt details");
  } finally {
    viewLoading.value = false;
  }
}

function closeView() {
  viewing.value = null;
  viewReceipt.value = null;
  bsModal("viewIntakeModal")?.hide();
}

/* -------------------- EDIT MODAL -------------------- */

const editId = ref(null);
const editForm = ref({
  outlet_id: null,
  supplier_id: null,
  received_at: "",
  note: "",
});

const editLines = ref([]);

function resetEdit() {
  editId.value = null;
  editForm.value = { outlet_id: null, supplier_id: null, received_at: "", note: "" };
  editLines.value = [];
}

function addEditLine() {
  editLines.value.push({ inventory_item_id: null, uom_id: null, qty: "", unit_cost: "" });
}

function removeEditLine(idx) {
  if (editLines.value.length === 1) return;
  editLines.value.splice(idx, 1);
}

function isoToLocalDatetime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

async function openEdit(receipt) {
  if (receipt.purchase_order_id != null) return toast.error("Only direct receipts can be edited here");
  if (receipt.voided_at) return toast.error("Cannot edit a voided receipt");

  resetEdit();
  editId.value = receipt.id;

  bsModal("editIntakeModal")?.show();

  saving.value = true;
  try {
    const full = await getPurchaseReceipt(receipt.id);

    editForm.value = {
      outlet_id: full.outlet_id ? Number(full.outlet_id) : null,
      supplier_id: full.supplier_id ? Number(full.supplier_id) : null,
      received_at: isoToLocalDatetime(full.received_at),
      note: full.note || "",
    };

    editLines.value =
      (full.items || []).map((x) => ({
        inventory_item_id: x.inventory_item_id ? Number(x.inventory_item_id) : null,
        uom_id: x.uom_id ? Number(x.uom_id) : null,
        qty: String(x.qty ?? ""),
        unit_cost: String(x.unit_cost ?? ""),
      })) || [];

    if (editLines.value.length === 0) addEditLine();

    // ✅ normalize UOMs after load (only base + conversions)
    for (const ln of editLines.value || []) ensureLineUom(ln);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load receipt for edit");
    bsModal("editIntakeModal")?.hide();
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

    bsModal("editIntakeModal")?.hide();
    resetEdit();
    await loadHistory();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update stock intake");
  } finally {
    saving.value = false;
  }
}

// Auto-pick base UOM (or first allowed) when item changes (EDIT)
watch(
  () => editLines.value.map((x) => x.inventory_item_id),
  () => {
    for (const ln of editLines.value || []) {
      if (!ln.inventory_item_id) continue;
      ensureLineUom(ln);
    }
  },
  { deep: true }
);

/* -------------------- VOID (DELETE) -------------------- */

const voiding = ref(null);
const voidNote = ref("");

function openVoid(receipt) {
  if (receipt.voided_at) return toast.error("This receipt is already voided");
  voiding.value = receipt;
  voidNote.value = "";
  bsModal("voidIntakeModal")?.show();
}

async function confirmVoid() {
  if (!voiding.value) return;
  saving.value = true;
  try {
    await http.post(`/purchases/receipts/${voiding.value.id}/void`, {
      note: voidNote.value?.trim() || null,
    });
    toast.success("Receipt voided (stock reversed)");
    bsModal("voidIntakeModal")?.hide();
    voiding.value = null;
    voidNote.value = "";
    await loadHistory();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to void receipt");
  } finally {
    saving.value = false;
  }
}

/* -------------------- Initial Load -------------------- */

onMounted(async () => {
  await loadAll();
  await loadHistory();
});
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <h4 class="page-title mb-0">Stock Intake (Direct Purchase)</h4>

      <div class="d-flex gap-2">
        <button class="btn btn-secondary" :disabled="loadingTable" @click="loadHistory">
          Refresh
        </button>

        <button
          class="btn btn-primary"
          data-bs-toggle="modal"
          data-bs-target="#createIntakeModal"
          @click="resetCreate"
        >
          <i class="uil-plus me-1"></i> New Stock Intake
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="card mb-3" style="zoom: 80%;">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-3">
            <label class="form-label">Outlet</label>
            <SearchSelect
              v-model="filters.outlet_id"
              :options="outletOptions"
              placeholder="All outlets"
              :clearable="true"
              :searchable="true"
              :disabled="loading || loadingTable"
              nullLabel="All outlets"
            />
          </div>

          <div class="col-md-4">
            <label class="form-label">Supplier</label>
            <SearchSelect
              v-model="filters.supplier_id"
              :options="supplierOptions"
              placeholder="All suppliers"
              :clearable="true"
              :searchable="true"
              :disabled="loading || loadingTable"
              nullLabel="All suppliers"
            />
          </div>

          <div class="col-md-2">
            <label class="form-label">Limit</label>
            <select v-model="filters.limit" class="form-select" :disabled="loading || loadingTable">
              <option :value="50">50</option>
              <option :value="100">100</option>
              <option :value="200">200</option>
              <option :value="500">500</option>
            </select>
          </div>

          <div class="col-md-3">
            <div class="form-check mt-4">
              <input class="form-check-input" type="checkbox" id="showVoided" v-model="filters.show_voided" />
              <label class="form-check-label" for="showVoided">Show voided</label>
            </div>
          </div>
        </div>
        <small class="text-muted d-block mt-2">
          This table shows <b>direct</b> stock intakes (receipts without purchase orders).
        </small>
      </div>
    </div>

    <!-- History Table -->
    <div class="card" style="zoom: 80%;">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-sm table-bordered align-middle mb-0">
            <thead class="table-light">
              <tr>
                <th>ID</th>
                <th>Received At</th>
                <th>Outlet</th>
                <th>Supplier</th>
                <th class="text-center">Status</th>
                <th>Items</th>
                <th class="text-end">Total</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              <tr v-if="!loadingTable && displayRows.length === 0">
                <td colspan="8" class="text-center text-muted py-4">No stock intakes found</td>
              </tr>

              <tr v-for="r in displayRows" :key="r.id">
                <td>{{ r.id }}</td>
                <td>{{ formatDate(r.received_at) }}</td>
                <td class="fw-semibold">{{ outletName(r.outlet_id) }}</td>
                <td>{{ supplierName(r.supplier_id) }}</td>
                <td class="text-center">
                  <span v-if="r.voided_at" class="badge bg-danger">Voided</span>
                  <span v-else class="badge bg-success">Posted</span>
                </td>

                <!-- ✅ show at least 2 items so user identifies the receipt row -->
                <td>
                  <div class="small">
                    <div class="fw-semibold">{{ (r.items || []).length }} item(s)</div>
                    <div class="text-muted">{{ receiptItemsPreview(r, 2) }}</div>
                  </div>
                </td>

                <td class="text-end">{{ receiptTotal(r) }}</td>
                <td class="text-end">
                  <button class="btn btn-sm btn-soft-primary me-1" @click="openView(r)">
                    View
                  </button>

                  <button
                    class="btn btn-sm btn-soft-secondary me-1"
                    :disabled="!!r.voided_at"
                    @click="openEdit(r)"
                  >
                    Edit
                  </button>

                  <button
                    class="btn btn-sm btn-soft-danger"
                    :disabled="!!r.voided_at"
                    @click="openVoid(r)"
                  >
                    Void
                  </button>
                </td>
              </tr>
            </tbody>

          </table>
        </div>
      </div>

      <div class="card-footer d-flex justify-content-between">
        <small class="text-muted">
          Showing {{ displayRows.length }} record(s)
          <span v-if="loadingTable"> • Loading...</span>
        </small>
      </div>
    </div>

    <!-- ===================== CREATE MODAL ===================== -->
    <div class="modal fade" id="createIntakeModal" tabindex="-1" aria-hidden="true" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-xl">
        <div class="modal-content">
          <div class="modal-header bg-light">
            <h4 class="modal-title">New Stock Intake</h4>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="saving"></button>
          </div>

          <div class="modal-body">
            <div class="row g-3 mb-3">
              <div class="col-md-4">
                <label class="form-label">Outlet</label>
                <SearchSelect
                  v-model="createForm.outlet_id"
                  :options="outletOptions"
                  placeholder="Select outlet..."
                  :clearable="true"
                  :searchable="true"
                  :disabled="saving"
                />
              </div>

              <div class="col-md-4">
                <label class="form-label">Supplier</label>
                <SearchSelect
                  v-model="createForm.supplier_id"
                  :options="supplierOptions"
                  placeholder="Select supplier..."
                  :clearable="true"
                  :searchable="true"
                  :disabled="saving"
                />
              </div>

              <div class="col-md-4">
                <label class="form-label">Received At (optional)</label>
                <input v-model="createForm.received_at" type="datetime-local" class="form-control" :disabled="saving" />
              </div>

              <div class="col-12">
                <label class="form-label">Note</label>
                <input v-model="createForm.note" class="form-control" placeholder="Optional note..." :disabled="saving" />
              </div>
            </div>

            <div class="d-flex justify-content-between align-items-center mb-2">
              <div class="fw-semibold">Lines</div>
              <button class="btn btn-sm btn-secondary" :disabled="saving" @click="addCreateLine">
                <i class="uil-plus me-1"></i> Add Line
              </button>
            </div>

            <div class="table-responsive">
              <table class="table table-sm table-bordered align-middle mb-0">
                <thead class="table-light">
                  <tr>
                    <th style="width: 420px;">Item</th>
                    <th style="width: 240px;">UOM</th>
                    <th style="width: 130px;">Qty</th>
                    <th style="width: 160px;">Unit Cost</th>
                    <th style="width: 150px;">Avg Cost</th>
                    <th style="width: 140px;"></th>
                  </tr>
                </thead>

                <tbody>
                  <tr v-for="(ln, idx) in createLines" :key="idx">
                    <td>
                      <SearchSelect
                        v-model="ln.inventory_item_id"
                        :options="itemOptions"
                        placeholder="Select item..."
                        :clearable="true"
                        :searchable="true"
                        :disabled="saving"
                      />
                    </td>

                    <td>
                      <SearchSelect
                        v-model="ln.uom_id"
                        :options="uomOptionsForInventory(ln.inventory_item_id)"
                        placeholder="Select UOM..."
                        :clearable="true"
                        :searchable="true"
                        :disabled="saving || !ln.inventory_item_id"
                      />
                    </td>

                    <td>
                      <input v-model="ln.qty" class="form-control form-control-sm" placeholder="0" :disabled="saving" />
                    </td>

                    <td>
                      <input
                        v-model="ln.unit_cost"
                        class="form-control form-control-sm"
                        placeholder="0.00"
                        :disabled="saving"
                      />
                    </td>

                    <td class="text-center">
                      <span
                        v-if="invAvgCostPerSelectedUom(ln.inventory_item_id, ln.uom_id) != null"
                        class="badge bg-info"
                      >
                        {{ fmtMoney(invAvgCostPerSelectedUom(ln.inventory_item_id, ln.uom_id)) }}
                      </span>
                      <span v-else class="text-muted">-</span>
                    </td>

                    <td class="text-end">
                      <button
                        class="btn btn-sm btn-outline-danger"
                        :disabled="saving || createLines.length === 1"
                        @click="removeCreateLine(idx)"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <small class="text-muted d-block mt-2">
              Posting stock is <b>one-way</b>. If you make a mistake, use <b>Edit</b> (reverses + reposts) or <b>Void</b>.
              <br />
              UOM is restricted to the item’s <b>base UOM</b> or its <b>configured conversions</b>.
            </small>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button class="btn btn-primary" :disabled="saving" @click="submitCreate">
              <span v-if="saving">Posting...</span>
              <span v-else>Post Stock</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== VIEW MODAL ===================== -->
    <div class="modal fade" id="viewIntakeModal" tabindex="-1" aria-hidden="true" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-xl">
        <div class="modal-content">
          <div class="modal-header bg-light">
            <h4 class="modal-title">Stock Intake Details</h4>
            <button class="btn-close" data-bs-dismiss="modal" @click="closeView"></button>
          </div>

          <div class="modal-body">
            <div v-if="viewLoading" class="text-muted">Loading...</div>

            <div v-else-if="viewReceipt">
              <div class="row g-2 mb-3">
                <div class="col-md-3"><b>ID:</b> {{ viewReceipt.id }}</div>
                <div class="col-md-3"><b>Received:</b> {{ formatDate(viewReceipt.received_at) }}</div>
                <div class="col-md-3"><b>Outlet:</b> {{ outletName(viewReceipt.outlet_id) }}</div>
                <div class="col-md-3"><b>Supplier:</b> {{ supplierName(viewReceipt.supplier_id) }}</div>

                <div class="col-md-6"><b>Note:</b> {{ viewReceipt.note || "-" }}</div>
                <div class="col-md-3">
                  <b>Status:</b>
                  <span v-if="viewReceipt.voided_at" class="badge bg-danger ms-1">Voided</span>
                  <span v-else class="badge bg-success ms-1">Posted</span>
                </div>
                <div class="col-md-3 text-end"><b>Total:</b> {{ receiptTotal(viewReceipt) }}</div>

                <div v-if="viewReceipt.voided_at" class="col-12">
                  <div class="alert alert-warning mb-0">
                    <b>Voided at:</b> {{ formatDate(viewReceipt.voided_at) }} •
                    <b>Note:</b> {{ viewReceipt.void_note || "-" }}
                  </div>
                </div>
              </div>

              <div class="table-responsive">
                <table class="table table-sm table-bordered align-middle mb-0">
                  <thead class="table-light">
                    <tr>
                      <th>Item</th>
                      <th style="width: 160px;">UOM</th>
                      <th style="width: 120px;" class="text-end">Qty</th>
                      <th style="width: 160px;" class="text-end">Unit Cost</th>
                      <th style="width: 140px;" class="text-end">Avg Cost</th>
                      <th style="width: 180px;" class="text-end">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="x in viewReceipt.items" :key="x.id">
                      <td class="fw-semibold">{{ itemLabelById(x.inventory_item_id) }}</td>
                      <td>{{ uomCodeById(x.uom_id) || "UOM" }}</td>
                      <td class="text-end">{{ x.qty }}</td>
                      <td class="text-end">{{ x.unit_cost }}</td>
                      <td class="text-end">
                        <span v-if="invLastPrice(x.inventory_item_id) != null">{{ invLastPrice(x.inventory_item_id) }}</span>
                        <span v-else>-</span>
                      </td>
                      <td class="text-end">
                        {{
                          (Number(x.qty) && Number(x.unit_cost))
                            ? (Number(x.qty) * Number(x.unit_cost)).toFixed(2)
                            : "-"
                        }}
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

    <!-- ===================== EDIT MODAL ===================== -->
    <div class="modal fade" id="editIntakeModal" tabindex="-1" aria-hidden="true" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-xl">
        <div class="modal-content">
          <div class="modal-header bg-light">
            <h4 class="modal-title">Edit Stock Intake</h4>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="saving" @click="resetEdit"></button>
          </div>

          <div class="modal-body">
            <div class="row g-3 mb-3">
              <div class="col-md-4">
                <label class="form-label">Outlet</label>
                <SearchSelect
                  v-model="editForm.outlet_id"
                  :options="outletOptions"
                  placeholder="Select outlet..."
                  :clearable="true"
                  :searchable="true"
                  :disabled="saving"
                />
              </div>

              <div class="col-md-4">
                <label class="form-label">Supplier</label>
                <SearchSelect
                  v-model="editForm.supplier_id"
                  :options="supplierOptions"
                  placeholder="Select supplier..."
                  :clearable="true"
                  :searchable="true"
                  :disabled="saving"
                />
              </div>

              <div class="col-md-4">
                <label class="form-label">Received At (optional)</label>
                <input v-model="editForm.received_at" type="datetime-local" class="form-control" :disabled="saving" />
              </div>

              <div class="col-12">
                <label class="form-label">Note</label>
                <input v-model="editForm.note" class="form-control" placeholder="Optional note..." :disabled="saving" />
              </div>
            </div>

            <div class="d-flex justify-content-between align-items-center mb-2">
              <div class="fw-semibold">Lines</div>
              <button class="btn btn-sm btn-secondary" :disabled="saving" @click="addEditLine">
                <i class="uil-plus me-1"></i> Add Line
              </button>
            </div>

            <div class="table-responsive">
              <table class="table table-sm table-bordered align-middle mb-0">
                <thead class="table-light">
                  <tr>
                    <th style="width: 420px;">Item</th>
                    <th style="width: 240px;">UOM</th>
                    <th style="width: 130px;">Qty</th>
                    <th style="width: 160px;">Unit Cost</th>
                    <th style="width: 150px;">Avg Cost</th>
                    <th style="width: 140px;"></th>
                  </tr>
                </thead>

                <tbody>
                  <tr v-for="(ln, idx) in editLines" :key="idx">
                    <td>
                      <SearchSelect
                        v-model="ln.inventory_item_id"
                        :options="itemOptions"
                        placeholder="Select item..."
                        :clearable="true"
                        :searchable="true"
                        :disabled="saving"
                      />
                    </td>

                    <td>
                      <SearchSelect
                        v-model="ln.uom_id"
                        :options="uomOptionsForInventory(ln.inventory_item_id)"
                        placeholder="Select UOM..."
                        :clearable="true"
                        :searchable="true"
                        :disabled="saving || !ln.inventory_item_id"
                      />
                    </td>

                    <td>
                      <input v-model="ln.qty" class="form-control form-control-sm" placeholder="0" :disabled="saving" />
                    </td>

                    <td>
                      <input
                        v-model="ln.unit_cost"
                        class="form-control form-control-sm"
                        placeholder="0.00"
                        :disabled="saving"
                      />
                    </td>

                    <td class="text-center">
                      <span
                        v-if="invAvgCostPerSelectedUom(ln.inventory_item_id, ln.uom_id) != null"
                        class="badge bg-info"
                      >
                        {{ fmtMoney(invAvgCostPerSelectedUom(ln.inventory_item_id, ln.uom_id)) }}
                      </span>
                      <span v-else class="text-muted">-</span>
                    </td>

                    <td class="text-end">
                      <button
                        class="btn btn-sm btn-outline-danger"
                        :disabled="saving || editLines.length === 1"
                        @click="removeEditLine(idx)"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>

                  <tr v-if="editLines.length === 0">
                    <td colspan="6" class="text-center text-muted py-3">No lines</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <small class="text-muted d-block mt-2">
              Editing performs a <b>reversal</b> then posts again (backend /receipts/{id}/direct).
              <br />
              UOM is restricted to the item’s <b>base UOM</b> or its <b>configured conversions</b>.
            </small>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving" @click="resetEdit">Cancel</button>
            <button class="btn btn-primary" :disabled="saving" @click="submitEdit">
              <span v-if="saving">Saving...</span>
              <span v-else>Save Changes</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== VOID MODAL ===================== -->
    <div class="modal fade" id="voidIntakeModal" tabindex="-1" aria-hidden="true" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header bg-light">
            <h4 class="modal-title">Void Stock Intake</h4>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="saving"></button>
          </div>

          <div class="modal-body">
            <div class="alert alert-warning">
              This will <b>reverse stock</b> and mark the receipt as <b>voided</b>. It will remain in history for audit.
            </div>

            <div class="mb-2">
              <div><b>Receipt:</b> #{{ voiding?.id }}</div>
              <div><b>Outlet:</b> {{ voiding ? outletName(voiding.outlet_id) : "-" }}</div>
              <div><b>Supplier:</b> {{ voiding ? supplierName(voiding.supplier_id) : "-" }}</div>
              <div><b>Received:</b> {{ voiding ? formatDate(voiding.received_at) : "-" }}</div>
            </div>

            <label class="form-label">Reason / Note (optional)</label>
            <input v-model="voidNote" class="form-control" placeholder="Why are you voiding this intake?" :disabled="saving" />
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button class="btn btn-danger" :disabled="saving" @click="confirmVoid">
              <span v-if="saving">Voiding...</span>
              <span v-else>Void (Reverse Stock)</span>
            </button>
          </div>
        </div>
      </div>
    </div>

  </DefaultLayout>
</template>

<style scoped>
.table-responsive {
  overflow: visible !important;
}
</style>