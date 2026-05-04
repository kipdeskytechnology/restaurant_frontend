<!-- src/views/inventory/Stock.vue -->
<script setup>
import { ref, onMounted, watch, computed } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import { listStockBalances, adjustStock, listInventoryItems } from "../../api/inventory";
import { listOutlets } from "../../api/lookups";

const toast = useToast();

const loading = ref(true);
const refreshing = ref(false);
const savingAll = ref(false);

const rows = ref([]);
const outlets = ref([]);
const items = ref([]);

const filters = ref({
  outlet_id: "",
  item_q: "",
});

// Inline edit state per row
const inline = ref({});

function keyOfRow(r) { return `${r.outlet_id}:${r.inventory_item_id}`; }

const itemById = computed(() => {
  const m = new Map();
  for (const it of items.value) m.set(it.id, it);
  return m;
});

function getItemForRow(r) {
  return r?.item || itemById.value.get(r.inventory_item_id) || null;
}

function toNumberOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtNumber(v, dp = 3) {
  const n = toNumberOrNull(v);
  if (n === null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dp });
}
function fmtCost(v, dp = 4) {
  const n = toNumberOrNull(v);
  if (n === null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function ensureInlineForRow(r) {
  const k = keyOfRow(r);
  if (!inline.value[k]) {
    inline.value[k] = { qty_delta: "", reason: "ADJUSTMENT", note: "", saving: false };
  }
  return inline.value[k];
}

function hasPendingRow(r) {
  const st = ensureInlineForRow(r);
  const qty = Number(st.qty_delta);
  return Number.isFinite(qty) && qty !== 0;
}

const pendingCount = computed(() => rows.value.filter((r) => hasPendingRow(r)).length);

const summary = computed(() => {
  const total = rows.value.length;
  const inStock = rows.value.filter((r) => Number(r.on_hand) > 0).length;
  const empty = total - inStock;
  return { total, inStock, empty };
});

const filteredItems = computed(() => {
  const q = filters.value.item_q?.trim()?.toLowerCase();
  if (!q) return items.value;
  return items.value.filter((it) => {
    const name = (it.name || "").toLowerCase();
    const sku = (it.sku || "").toLowerCase();
    return name.includes(q) || sku.includes(q);
  });
});

const PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f59e0b", "#10b981", "#06b6d4", "#0ea5e9",
  "#14b8a6", "#84cc16",
];
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

async function loadLookups() {
  const [o, it] = await Promise.all([listOutlets(), listInventoryItems({ limit: 500 })]);
  outlets.value = o;
  items.value = it;
  if (!filters.value.outlet_id && outlets.value.length) {
    filters.value.outlet_id = outlets.value[0].id;
  }
}

async function loadBalancesAndBuildRows(showSpinner = false) {
  const outletId = filters.value.outlet_id ? Number(filters.value.outlet_id) : null;
  if (!outletId) { rows.value = []; return; }

  if (showSpinner) refreshing.value = true;
  let balances = [];
  try {
    balances = await listStockBalances({ outlet_id: outletId });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load stock balances");
    balances = [];
  }

  const balByItemId = new Map();
  for (const b of balances) balByItemId.set(b.inventory_item_id, b);

  const outletObj = outlets.value.find((o) => Number(o.id) === outletId) || null;

  const built = filteredItems.value.map((it) => {
    const b = balByItemId.get(it.id);
    return {
      id: `${outletId}:${it.id}`,
      outlet_id: outletId,
      inventory_item_id: it.id,
      on_hand: b?.on_hand ?? 0,
      outlet: b?.outlet || outletObj,
      item: b?.item || it,
    };
  });

  rows.value = built;
  for (const r of rows.value) ensureInlineForRow(r);
  refreshing.value = false;
}

async function loadAll() {
  loading.value = true;
  try {
    await loadLookups();
    await loadBalancesAndBuildRows();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load stock data");
  } finally {
    loading.value = false;
  }
}

async function updateStockFromRow(r) {
  const st = ensureInlineForRow(r);
  const qty = Number(st.qty_delta);
  if (!Number.isFinite(qty) || qty === 0) {
    toast.error("Qty Delta cannot be 0");
    return false;
  }
  if (!r.outlet_id) { toast.error("Outlet is required"); return false; }

  const it = getItemForRow(r);
  const autoCostRaw = it?.avg_cost ?? null;
  const unitCost = autoCostRaw === "" || autoCostRaw === undefined ? null : Number(autoCostRaw);

  if (unitCost !== null && !Number.isFinite(unitCost)) {
    toast.error("Item Avg Cost is invalid; please fix it in Items");
    return false;
  }

  st.saving = true;
  try {
    await adjustStock({
      outlet_id: Number(r.outlet_id),
      inventory_item_id: Number(r.inventory_item_id),
      qty_delta: qty,
      unit_cost: unitCost,
      reason: st.reason?.trim() || "ADJUSTMENT",
      note: st.note?.trim() || null,
    });
    st.qty_delta = "";
    st.reason = "ADJUSTMENT";
    st.note = "";
    return true;
  } catch (e) {
    toast.error(e?.response?.data?.detail || `Failed to update item ${r.inventory_item_id}`);
    return false;
  } finally {
    st.saving = false;
  }
}

async function saveAll() {
  const pendingRows = rows.value.filter((r) => hasPendingRow(r));
  if (pendingRows.length === 0) { toast.info("No pending updates"); return; }

  savingAll.value = true;
  let ok = 0, fail = 0;
  try {
    for (const r of pendingRows) {
      const res = await updateStockFromRow(r);
      if (res) ok += 1; else fail += 1;
    }
    if (ok > 0 && fail === 0) toast.success(`Saved ${ok} update(s)`);
    else if (ok > 0 && fail > 0) toast.warning(`Saved ${ok}, failed ${fail}`);
    else toast.error(`Failed to save ${fail} update(s)`);
    await loadBalancesAndBuildRows();
  } finally {
    savingAll.value = false;
  }
}

let filterTimer = null;
watch(
  () => [filters.value.outlet_id, filters.value.item_q, items.value.length],
  () => {
    if (loading.value) return;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => loadBalancesAndBuildRows(), 200);
  }
);

onMounted(loadAll);
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-stack-line"></i><span>Inventory</span>
          </div>
          <h1 class="hero-title">Stock Balances</h1>
          <p class="hero-sub">
            Live on-hand quantities by outlet. Type a quantity in any row to stage an adjustment, then bulk-save changes in one click.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="loadBalancesAndBuildRows(true)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button
            v-can="'inventory:manage'"
            class="btn btn-pill btn-cta"
            :disabled="savingAll || pendingCount === 0"
            @click="saveAll"
          >
            <i class="ri-save-line"></i>
            <span v-if="savingAll">Saving…</span>
            <span v-else>Save {{ pendingCount ? `(${pendingCount})` : 'All' }}</span>
          </button>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-md-4">
              <label class="form-label">Outlet</label>
              <select v-model="filters.outlet_id" class="form-select">
                <option value="" disabled>Select outlet</option>
                <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
            </div>

            <div class="col-md-8">
              <label class="form-label">Search</label>
              <div class="position-relative">
                <i class="ri-search-line search-ico"></i>
                <input
                  v-model="filters.item_q"
                  class="form-control ps-5"
                  placeholder="Search by item name or SKU…"
                />
              </div>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-3 small text-muted mt-2">
            <span><strong>{{ summary.total }}</strong> item{{ summary.total === 1 ? '' : 's' }}</span>
            <span class="d-none d-sm-inline">•</span>
            <span><strong class="text-success">{{ summary.inStock }}</strong> in stock</span>
            <span class="d-none d-sm-inline">•</span>
            <span v-if="summary.empty"><strong class="text-warning">{{ summary.empty }}</strong> at zero</span>
            <span v-if="pendingCount" class="ms-auto pending-pill">
              <i class="ri-edit-2-line me-1"></i>{{ pendingCount }} pending change{{ pendingCount === 1 ? '' : 's' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading stock…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="!rows.length" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-stack-line"></i></div>
        <h5 class="mt-2 mb-1">No items to show</h5>
        <p class="text-muted mb-3">Pick an outlet, or adjust your search.</p>
      </div>

      <!-- ============== Stock table ============== -->
      <div v-else class="card data-card">
        <div class="card-body p-0">
          <div class="table-responsive data-scroll">
            <table class="table align-middle mb-0 stock-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th style="width: 140px" class="text-end">On hand</th>
                  <th style="width: 130px" class="text-end">Avg cost</th>
                  <th style="width: 130px">UOM</th>
                  <th style="width: 160px">Qty Δ</th>
                  <th style="width: 160px">Reason</th>
                  <th style="width: 200px">Note</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in rows"
                  :key="r.id"
                  :class="{ 'row-pending': hasPendingRow(r) }"
                >
                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <div class="item-avatar" :style="{ '--accent': colorFor(getItemForRow(r)?.name) }">
                        {{ initialsOf(getItemForRow(r)?.name) }}
                      </div>
                      <div class="min-w-0">
                        <div class="item-name">{{ getItemForRow(r)?.name || `#${r.inventory_item_id}` }}</div>
                        <div class="item-sub" v-if="getItemForRow(r)?.sku">SKU: {{ getItemForRow(r).sku }}</div>
                      </div>
                    </div>
                  </td>

                  <td class="text-end">
                    <span class="onhand-pill" :class="{ 'onhand-zero': Number(r.on_hand) <= 0 }">
                      {{ fmtNumber(r.on_hand, 6) }}
                    </span>
                  </td>

                  <td class="text-end">
                    <span class="metric-mono">{{ fmtCost(getItemForRow(r)?.avg_cost, 4) }}</span>
                  </td>

                  <td>
                    <span class="uom-mini" v-if="getItemForRow(r)?.base_uom">
                      {{ getItemForRow(r).base_uom.code }}
                    </span>
                    <span v-else class="text-muted">—</span>
                  </td>

                  <td>
                    <input
                      v-model="ensureInlineForRow(r).qty_delta"
                      type="number"
                      step="0.000001"
                      class="form-control form-control-sm qty-input"
                      :class="{ 'qty-input-active': hasPendingRow(r) }"
                      placeholder="+5 or -2"
                      @keyup.enter="updateStockFromRow(r)"
                    />
                  </td>

                  <td>
                    <input
                      v-model="ensureInlineForRow(r).reason"
                      class="form-control form-control-sm"
                      placeholder="ADJUSTMENT"
                      @keyup.enter="updateStockFromRow(r)"
                    />
                  </td>

                  <td>
                    <input
                      v-model="ensureInlineForRow(r).note"
                      class="form-control form-control-sm"
                      placeholder="optional"
                      @keyup.enter="updateStockFromRow(r)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="px-3 py-2 small text-muted footnote">
            <i class="ri-information-line me-1"></i>
            Avg cost shown to 4 decimals · On hand to 6 decimals · Press Enter on any field to save that row immediately.
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
  background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 60%, #8b5cf6 100%);
  color: #fff;
  box-shadow: 0 20px 40px -20px rgba(14, 165, 233, 0.55);
  overflow: hidden;
  flex-wrap: wrap;
}
.page-hero::before {
  content: "";
  position: absolute; inset: 0;
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
.page-hero-actions .btn-light { background: rgba(255,255,255,0.95); color: #1e293b; border: none; }
.btn-cta { background: #fff !important; color: #6366f1 !important; font-weight: 700; border: none; box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3); }
.btn-cta:hover { background: #fff !important; color: #4f46e5 !important; }
.btn-cta:disabled { opacity: 0.55; cursor: not-allowed; }

/* ============= Toolbar ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(99,102,241,0.04) 0%, transparent 100%); }
.search-ico {
  position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8); pointer-events: none;
}
.pending-pill {
  display: inline-flex; align-items: center;
  padding: 0.2rem 0.7rem; border-radius: 999px;
  font-size: 0.72rem; font-weight: 700;
  background: rgba(245,158,11,0.14); color: #b45309;
  border: 1px solid rgba(245,158,11,0.3);
}

/* ============= Empty ============= */
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); font-size: 1.6rem;
}

/* ============= Stock table ============= */
.data-card { overflow: hidden; }
.data-scroll {
  max-height: calc(100vh - 380px);
  min-height: 240px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }
.data-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.5); }

.stock-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.row-pending {
  background: rgba(245,158,11,0.04) !important;
  position: relative;
}
.row-pending td:first-child {
  box-shadow: inset 3px 0 0 #f59e0b;
}

.item-avatar {
  width: 36px; height: 36px; border-radius: 10px;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; font-size: 0.78rem;
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 24%, transparent);
  flex-shrink: 0;
}
.item-name { font-weight: 700; color: var(--ct-body-color, #0f172a); line-height: 1.25; }
.item-sub { font-size: 0.7rem; color: var(--ct-secondary-color, #64748b); font-weight: 600; }
.min-w-0 { min-width: 0; }

.metric-mono {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.82rem; color: var(--ct-secondary-color, #64748b); font-weight: 600;
}

.onhand-pill {
  display: inline-block;
  padding: 0.25rem 0.7rem;
  border-radius: 8px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.85rem; font-weight: 700;
  background: rgba(16,185,129,0.12);
  color: #047857;
  border: 1px solid rgba(16,185,129,0.22);
  min-width: 80px;
}
.onhand-pill.onhand-zero {
  background: rgba(100,116,139,0.1);
  color: #64748b;
  border-color: rgba(100,116,139,0.2);
}

.uom-mini {
  display: inline-block;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700; font-size: 0.75rem;
  padding: 0.2rem 0.5rem; border-radius: 6px;
  background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1);
  border: 1px solid rgba(99,102,241,0.2);
}

.qty-input { font-family: "JetBrains Mono", ui-monospace, monospace; }
.qty-input-active {
  border-color: #f59e0b !important;
  background: rgba(245,158,11,0.05) !important;
  box-shadow: 0 0 0 3px rgba(245,158,11,0.12);
}

.footnote { border-top: 1px dashed var(--ct-border-color, #e6e9ef); }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
