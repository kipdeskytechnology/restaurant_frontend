<!-- src/views/inventory/Stock.vue -->
<script setup>
import { ref, onMounted, watch, computed } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import { listStockBalances, adjustStock, listInventoryItems } from "../../api/inventory";
import { listOutlets } from "../../api/lookups";

const toast = useToast();

const loading = ref(true);
const savingAll = ref(false);

const rows = ref([]);
const outlets = ref([]);
const items = ref([]);

const filters = ref({
  outlet_id: "",
  item_q: "", // search text for item
});

/**
 * Inline update state per row
 * key = `${outlet_id}:${inventory_item_id}`
 */
const inline = ref({});

function keyOfRow(r) {
  return `${r.outlet_id}:${r.inventory_item_id}`;
}

const itemById = computed(() => {
  const m = new Map();
  for (const it of items.value) m.set(it.id, it);
  return m;
});

function getItemForRow(r) {
  // Prefer embedded row.item if API returns it, otherwise use lookup list
  return r?.item || itemById.value.get(r.inventory_item_id) || null;
}

/**
 * Decimal helpers
 */
function toNumberOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtNumber(v, dp = 3) {
  const n = toNumberOrNull(v);
  if (n === null) return "-";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

function fmtCost(v, dp = 4) {
  const n = toNumberOrNull(v);
  if (n === null) return "-";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function uomText(it) {
  if (!it) return "-";
  if (it.base_uom) return `${it.base_uom.code} - ${it.base_uom.name}`;
  if (it.base_uom_id) return String(it.base_uom_id);
  return "-";
}

function ensureInlineForRow(r) {
  const k = keyOfRow(r);
  if (!inline.value[k]) {
    inline.value[k] = {
      qty_delta: "",
      reason: "ADJUSTMENT",
      note: "",
      saving: false,
    };
  }
  return inline.value[k];
}

function hasPendingRow(r) {
  const st = ensureInlineForRow(r);
  const qty = Number(st.qty_delta);
  return Number.isFinite(qty) && qty !== 0;
}

const pendingCount = computed(() => rows.value.filter((r) => hasPendingRow(r)).length);

async function loadLookups() {
  const [o, it] = await Promise.all([listOutlets(), listInventoryItems({ limit: 500 })]);
  outlets.value = o;
  items.value = it;
}

async function loadBalances() {
  const q = filters.value.item_q?.trim()?.toLowerCase();
  const filteredItemIds =
    q && q.length
      ? new Set(
          items.value
            .filter((it) => {
              const name = (it.name || "").toLowerCase();
              const sku = (it.sku || "").toLowerCase();
              return name.includes(q) || sku.includes(q);
            })
            .map((it) => it.id)
        )
      : null;

  const params = {
    outlet_id: filters.value.outlet_id ? Number(filters.value.outlet_id) : undefined,
    // we fetch balances broadly then filter client-side by item ids (since we now have a search box)
    // If your API supports q, you can replace this client filter with a server param.
    item_id: undefined,
  };

  try {
    const all = await listStockBalances(params);

    rows.value = filteredItemIds
      ? all.filter((r) => filteredItemIds.has(r.inventory_item_id))
      : all;

    // ensure inline state exists for visible rows
    for (const r of rows.value) ensureInlineForRow(r);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load stock balances");
  }
}

async function loadAll() {
  loading.value = true;
  try {
    await loadLookups();
    await loadBalances();
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
    return;
  }

  const it = getItemForRow(r);
  const autoCostRaw = it?.avg_cost ?? null;
  const unitCost = autoCostRaw === "" || autoCostRaw === undefined ? null : Number(autoCostRaw);

  if (unitCost !== null && !Number.isFinite(unitCost)) {
    toast.error("Item Avg Cost is invalid; please fix it in Items");
    return;
  }

  st.saving = true;
  try {
    const payload = {
      outlet_id: Number(r.outlet_id),
      inventory_item_id: Number(r.inventory_item_id),
      qty_delta: qty,
      // auto-populated from Items Avg Cost
      unit_cost: unitCost,
      reason: st.reason?.trim() || "ADJUSTMENT",
      note: st.note?.trim() || null,
    };

    await adjustStock(payload);

    // clear row inputs
    st.qty_delta = "";
    st.reason = "ADJUSTMENT";
    st.note = "";

    return true;
  } catch (e) {
    toast.error(
      e?.response?.data?.detail ||
        `Failed to update stock for item ${r.inventory_item_id} at outlet ${r.outlet_id}`
    );
    return false;
  } finally {
    st.saving = false;
  }
}

async function saveAll() {
  const pendingRows = rows.value.filter((r) => hasPendingRow(r));
  if (pendingRows.length === 0) {
    toast.info("No pending updates");
    return;
  }

  savingAll.value = true;

  let ok = 0;
  let fail = 0;

  try {
    // Sequential save (safer for backend + easier to show errors)
    for (const r of pendingRows) {
      const res = await updateStockFromRow(r);
      if (res) ok += 1;
      else fail += 1;
    }

    if (ok > 0 && fail === 0) toast.success(`Saved ${ok} update(s)`);
    else if (ok > 0 && fail > 0) toast.warning(`Saved ${ok}, failed ${fail}`);
    else toast.error(`Failed to save ${fail} update(s)`);

    await loadBalances();
  } finally {
    savingAll.value = false;
  }
}

/**
 * Live filters (debounced)
 */
let filterTimer = null;
watch(
  () => [filters.value.outlet_id, filters.value.item_q],
  () => {
    if (loading.value) return;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => loadBalances(), 200);
  }
);

onMounted(loadAll);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <h4 class="page-title">Stock Balances</h4>

      <button
        type="button"
        class="btn btn-primary"
        :disabled="savingAll || pendingCount === 0"
        @click="saveAll"
        title="Save all rows with Qty Delta filled"
      >
        <span v-if="savingAll">Saving...</span>
        <span v-else>Save All ({{ pendingCount }})</span>
      </button>
    </div>

    <!-- Filters (match Items.vue style) -->
    <div class="card mb-3" style="zoom: 80%;">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-5">
            <label class="form-label">Outlet</label>
            <select v-model="filters.outlet_id" class="form-select">
              <option value="">All</option>
              <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
          </div>

          <div class="col-md-7">
            <label class="form-label">Item Search</label>
            <input
              v-model="filters.item_q"
              class="form-control"
              placeholder="Type item name or SKU..."
            />
          </div>
        </div>
        <small class="text-muted d-block mt-2">Filters update automatically as you type.</small>
      </div>
    </div>

    <div v-if="loading" class="card"><div class="card-body">Loading...</div></div>

    <!-- Table -->
    <div v-else class="card" style="zoom: 80%;">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-sm table-bordered align-middle mb-0">
            <thead class="bg-light">
              <tr>
                <th>Item</th>
                <th style="width: 140px" class="text-end">Avg Cost</th>
                <th style="width: 140px" class="text-end">On Hand</th>
                <th style="width: 170px">Qty Delta</th>
                <th style="width: 180px">Base UOM</th>
                <th style="width: 180px">Reason</th>
                <th style="width: 240px">Note</th>
              </tr>
            </thead>

            <tbody>
              <tr v-for="r in rows" :key="r.id">
                <td>{{ r.item?.name || getItemForRow(r)?.name || r.inventory_item_id }}</td>

                <td class="text-end">
                  <span class="badge bg-light text-dark border">
                    {{ fmtCost(getItemForRow(r)?.avg_cost, 4) }}
                  </span>
                </td>

                <td class="text-end">
                  <span class="badge bg-light text-dark border">
                    {{ fmtNumber(r.on_hand, 6) }}
                  </span>
                </td>

                <td>
                  <input
                    v-model="ensureInlineForRow(r).qty_delta"
                    type="number"
                    step="0.000001"
                    class="form-control form-control-sm"
                    placeholder="e.g. 5 or -2"
                    @keyup.enter="updateStockFromRow(r)"
                  />
                </td>

                <td>
                  <span class="badge bg-secondary">{{ getItemForRow(r)?.base_uom?.code || "-" }}</span>
                  <span class="text-muted ms-2">{{ getItemForRow(r)?.base_uom?.name || uomText(getItemForRow(r)) }}</span>
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

              <tr v-if="rows.length === 0">
                <td colspan="9" class="text-center text-muted">No balances yet</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="p-2">
          <small class="text-muted">
            Display: Avg Cost fixed to 4 decimals; On Hand up to 6 decimals. Qty Delta input step = 0.000001.
          </small>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
