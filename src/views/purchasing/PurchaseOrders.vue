<script setup>
import { ref, onMounted, watch, computed } from "vue";
import { useRouter } from "vue-router";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import { listPurchaseOrders, listSuppliers } from "../../api/purchasing";
import http from "../../api/http";

const toast = useToast();
const router = useRouter();

const loading = ref(false);
const rows = ref([]);

const outlets = ref([]);
const suppliers = ref([]);

const outletNameById = computed(() => {
  const m = new Map();
  for (const o of outlets.value) m.set(o.id, o.name);
  return m;
});

const supplierNameById = computed(() => {
  const m = new Map();
  for (const s of suppliers.value) m.set(s.id, s.name);
  return m;
});

const filters = ref({
  outlet_id: "",
  supplier_id: "",
  status: "all",
  q: "",
});

async function loadOutlets() {
  const data = await http.get("/system/outlets").then((r) => r.data);
  outlets.value = Array.isArray(data) ? data : [];
}

async function loadSuppliers() {
  const data = await listSuppliers({ active: "1", limit: 500 });
  suppliers.value = Array.isArray(data) ? data : [];
}

async function load() {
  loading.value = true;
  try {
    rows.value = await listPurchaseOrders({
      limit: 200,
      outlet_id: filters.value.outlet_id || undefined,
      supplier_id: filters.value.supplier_id || undefined,
      status: filters.value.status,
      q: filters.value.q || undefined,
    });
  } catch (e) {
    toast.error(e?.response?.data?.detail || e?.message || "Failed to load purchase orders");
  } finally {
    loading.value = false;
  }
}

function openPO(poId) {
  router.push({ name: "purchase-order-view", params: { id: poId } });
}

function statusBadge(st) {
  const s = String(st || "").toUpperCase();
  if (s === "RECEIVED") return "bg-success";
  if (s === "PARTIAL") return "bg-warning";
  if (s === "SENT") return "bg-primary";
  if (s === "CANCELLED") return "bg-danger";
  return "bg-secondary";
}

// debounce filters
let t = null;
watch(
  () => [filters.value.outlet_id, filters.value.supplier_id, filters.value.status, filters.value.q],
  () => {
    clearTimeout(t);
    t = setTimeout(() => load(), 250);
  }
);

onMounted(async () => {
  await Promise.all([loadOutlets(), loadSuppliers()]);
  await load();
});
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <h4 class="page-title mb-0">Purchase Orders</h4>
      <router-link class="btn btn-primary" to="/purchasing/purchase-orders/new">
        <i class="uil-plus me-1"></i> New PO
      </router-link>
    </div>

    <div class="card mb-3" style="zoom: 80%;">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-3">
            <label class="form-label">Outlet</label>
            <select class="form-select" v-model="filters.outlet_id">
              <option value="">All outlets</option>
              <option v-for="o in outlets" :key="o.id" :value="String(o.id)">{{ o.name }}</option>
            </select>
          </div>

          <div class="col-md-3">
            <label class="form-label">Supplier</label>
            <select class="form-select" v-model="filters.supplier_id">
              <option value="">All suppliers</option>
              <option v-for="s in suppliers" :key="s.id" :value="String(s.id)">{{ s.name }}</option>
            </select>
          </div>

          <div class="col-md-2">
            <label class="form-label">Status</label>
            <select class="form-select" v-model="filters.status">
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="partial">Partial</option>
              <option value="received">Received</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div class="col-md-3">
            <label class="form-label">Search (PO No)</label>
            <input class="form-control" v-model="filters.q" placeholder="PO-20260127-0001" />
          </div>

          <div class="col-md-1 d-grid">
            <button class="btn btn-secondary" :disabled="loading" @click="load">Refresh</button>
          </div>

          <small class="text-muted d-block mt-2">Filters update automatically.</small>
        </div>
      </div>
    </div>

    <div class="card" style="zoom: 80%;">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-sm table-bordered align-middle mb-0">
            <thead class="table-light">
              <tr>
                <th style="width: 160px;">PO Number</th>
                <th style="width: 200px;">Outlet</th>
                <th>Supplier</th>
                <th style="width: 120px;">Status</th>
                <th style="width: 180px;">Ordered At</th>
                <th style="width: 110px;"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!loading && rows.length === 0">
                <td colspan="6" class="text-center text-muted py-3">No purchase orders found</td>
              </tr>

              <tr v-for="r in rows" :key="r.id">
                <td class="fw-semibold">{{ r.po_number }}</td>
                <td>{{ outletNameById.get(r.outlet_id) || `Outlet #${r.outlet_id}` }}</td>
                <td>{{ r.supplier?.name || supplierNameById.get(r.supplier_id) || `Supplier #${r.supplier_id}` }}</td>
                <td>
                  <span class="badge" :class="statusBadge(r.status)">
                    {{ r.status }}
                  </span>
                </td>
                <td>{{ r.ordered_at ? new Date(r.ordered_at).toLocaleString() : "-" }}</td>
                <td class="text-end">
                  <button class="btn btn-sm btn-soft-primary" @click="openPO(r.id)">Open</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
