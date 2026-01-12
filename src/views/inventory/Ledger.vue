<script setup>
import { ref, onMounted } from "vue";
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
  item_id: "",
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
    const params = {
      outlet_id: filters.value.outlet_id ? Number(filters.value.outlet_id) : undefined,
      item_id: filters.value.item_id ? Number(filters.value.item_id) : undefined,
      limit: Number(filters.value.limit || 200),
    };
    rows.value = await listStockLedger(params);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load ledger");
  }
}

function fmt(dt) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box">
      <h4 class="page-title">Stock Ledger</h4>
    </div>

    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-4">
            <label class="form-label">Outlet</label>
            <select v-model="filters.outlet_id" class="form-select" @change="loadLedger">
              <option value="">All</option>
              <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
          </div>

          <div class="col-md-5">
            <label class="form-label">Item</label>
            <select v-model="filters.item_id" class="form-select" @change="loadLedger">
              <option value="">All</option>
              <option v-for="it in items" :key="it.id" :value="it.id">{{ it.name }}</option>
            </select>
          </div>

          <div class="col-md-2">
            <label class="form-label">Limit</label>
            <select v-model="filters.limit" class="form-select" @change="loadLedger">
              <option :value="100">100</option>
              <option :value="200">200</option>
              <option :value="500">500</option>
            </select>
          </div>

          <div class="col-md-1 d-grid">
            <button class="btn btn-outline-secondary" @click="loadLedger">Go</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="card"><div class="card-body">Loading...</div></div>

    <div v-else class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table table-sm align-middle">
            <thead>
              <tr>
                <th style="width: 190px">Time</th>
                <th>Outlet</th>
                <th>Item</th>
                <th style="width: 140px" class="text-end">Qty Delta</th>
                <th style="width: 140px" class="text-end">Unit Cost</th>
                <th style="width: 160px">Reason</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id">
                <td>{{ fmt(r.occurred_at) }}</td>
                <td>{{ r.outlet?.name || r.outlet_id }}</td>
                <td>{{ r.item?.name || r.inventory_item_id }}</td>
                <td class="text-end">
                  <span :class="r.qty_delta < 0 ? 'text-danger' : 'text-success'">{{ r.qty_delta }}</span>
                </td>
                <td class="text-end">{{ r.unit_cost ?? "-" }}</td>
                <td>{{ r.reason || "-" }}</td>
              </tr>

              <tr v-if="rows.length === 0">
                <td colspan="6" class="text-center text-muted">No ledger entries yet</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
