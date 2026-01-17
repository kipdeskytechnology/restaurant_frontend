<!-- src/views/inventory/Ledger.vue -->
<script setup>
import { ref, onMounted, watch } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import { listStockLedger, listInventoryItems } from "../../api/inventory";
import { listOutlets } from "../../api/lookups";

const toast = useToast();

const loading = ref(true);
const rows = ref([]);
const outlets = ref([]);
const items = ref([]);

const filters = ref({
  outlet_id: "",
  item_q: "", // search text for item (name / sku)
  limit: 200,
});

async function load() {
  loading.value = true;
  try {
    const [o, it] = await Promise.all([listOutlets(), listInventoryItems({ limit: 500 })]);
    outlets.value = o;
    items.value = it;
    await loadLedger();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load stock ledger");
  } finally {
    loading.value = false;
  }
}

async function loadLedger() {
  try {
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
      // NOTE: ledger API expects item_id, but we're using a search box.
      // So we fetch by outlet+limit then filter client-side by matching item ids.
      item_id: undefined,
      limit: Number(filters.value.limit || 200),
    };

    const all = await listStockLedger(params);
    rows.value = filteredItemIds ? all.filter((r) => filteredItemIds.has(r.inventory_item_id)) : all;
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load ledger");
  }
}

/**
 * Date & number formatting
 */
function fmt(dt) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

function toNumberOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtQty(v, dp = 6) {
  const n = toNumberOrNull(v);
  if (n === null) return "-";
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dp });
}

function fmtCost(v, dp = 4) {
  const n = toNumberOrNull(v);
  if (n === null) return "-";
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/**
 * Live filters (debounced) - no "Go" button
 */
let filterTimer = null;
watch(
  () => [filters.value.outlet_id, filters.value.item_q, filters.value.limit],
  () => {
    if (loading.value) return;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => loadLedger(), 250);
  }
);

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <h4 class="page-title">Stock Ledger</h4>
    </div>

    <!-- Filters (match Items/Stock style) -->
    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-4">
            <label class="form-label">Outlet</label>
            <select v-model="filters.outlet_id" class="form-select">
              <option value="">All</option>
              <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
          </div>

          <div class="col-md-6">
            <label class="form-label">Item Search</label>
            <input
              v-model="filters.item_q"
              class="form-control"
              placeholder="Type item name or SKU..."
            />
          </div>

          <div class="col-md-2">
            <label class="form-label">Limit</label>
            <select v-model="filters.limit" class="form-select">
              <option :value="100">100</option>
              <option :value="200">200</option>
              <option :value="500">500</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="card"><div class="card-body">Loading...</div></div>

    <!-- Table (match Items style) -->
    <div v-else class="card">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-sm table-bordered align-middle mb-0">
            <thead class="bg-light">
              <tr>
                <th style="width: 190px">Time</th>
                <th style="width: 220px">Outlet</th>
                <th>Item</th>
                <th style="width: 140px" class="text-end">Qty Delta</th>
                <th style="width: 140px" class="text-end">Unit Cost</th>
                <th style="width: 180px">Reason</th>
              </tr>
            </thead>

            <tbody>
              <tr v-for="r in rows" :key="r.id">
                <td>{{ fmt(r.occurred_at) }}</td>
                <td>{{ r.outlet?.name || r.outlet_id }}</td>
                <td>{{ r.item?.name || r.inventory_item_id }}</td>

                <td class="text-end">
                  <span class="badge border" :class="r.qty_delta < 0 ? 'bg-danger' : 'bg-success'">
                    {{ fmtQty(r.qty_delta, 6) }}
                  </span>
                </td>

                <td class="text-end">
                  <span class="badge bg-light text-dark border">
                    {{ fmtCost(r.unit_cost, 4) }}
                  </span>
                </td>

                <td>{{ r.reason || "-" }}</td>
              </tr>

              <tr v-if="rows.length === 0">
                <td colspan="6" class="text-center text-muted">No ledger entries yet</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="p-2">
          <small class="text-muted">
            Display: Qty Delta up to 6 decimals; Unit Cost fixed to 4 decimals.
          </small>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
