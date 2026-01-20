<!-- src/views/payments/Payments.vue -->
<script setup>
import { ref, onMounted, computed } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import SearchSelect from "../../components/SearchSelect.vue";

import { listOutlets } from "../../api/systemOutlets";
import { listPayments } from "../../api/payments";

const toast = useToast();

const loading = ref(true);
const outlets = ref([]);
const payments = ref([]);

// filters
const outletId = ref(null);     // null = all
const method = ref("all");      // all|CASH|CARD|MOBILE
const q = ref("");
const paidFrom = ref("");       // yyyy-mm-dd
const paidTo = ref("");         // yyyy-mm-dd

const outletOptions = computed(() =>
  (outlets.value || []).map(o => ({
    label: o.name ?? `Outlet #${o.id}`,
    value: o.id,
  }))
);

const outletNameById = computed(() => {
  const m = new Map();
  for (const o of outlets.value || []) m.set(Number(o.id), o.name ?? `Outlet #${o.id}`);
  return m;
});

const outletLabel = (id) => outletNameById.value.get(Number(id)) || (id ? `Outlet #${id}` : "");

// If backend returns outlet mini, prefer it
const outletNameFromPayment = (p) => p?.outlet?.name || outletLabel(p.outlet_id);

async function loadOutlets() {
  try {
    outlets.value = await listOutlets();
  } catch (e) {
    outlets.value = [];
    toast.error(e?.response?.data?.detail || "Failed to load outlets");
  }
}

function toIsoStart(dateStr) {
  // "2026-01-13" -> "2026-01-13T00:00:00"
  return dateStr ? `${dateStr}T00:00:00` : undefined;
}
function toIsoEnd(dateStr) {
  // "2026-01-13" -> "2026-01-13T23:59:59"
  return dateStr ? `${dateStr}T23:59:59` : undefined;
}

async function load() {
  loading.value = true;
  try {
    const params = {
      outlet_id: outletId.value ?? undefined,
      method: method.value === "all" ? undefined : method.value,
      q: q.value?.trim() ? q.value.trim() : undefined,
      paid_from: toIsoStart(paidFrom.value),
      paid_to: toIsoEnd(paidTo.value),
      limit: 300,
    };
    payments.value = await listPayments(params);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load payments");
    payments.value = [];
  } finally {
    loading.value = false;
  }
}

function clearFilters() {
  outletId.value = null;
  method.value = "all";
  q.value = "";
  paidFrom.value = "";
  paidTo.value = "";
}

const totalAmount = computed(() =>
  (payments.value || []).reduce((sum, p) => sum + Number(p.amount || 0), 0)
);

onMounted(async () => {
  await loadOutlets();
  await load();
});
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Payments</h4>
        <div class="text-muted small">View payments by outlet, method and date</div>
      </div>

      <button class="btn btn-primary" :disabled="loading" @click="load">
        <i class="ri-refresh-line me-1"></i> Refresh
      </button>
    </div>

    <div class="card mb-3 overflow-visible" style="zoom: 80%;">
      <div class="card-body p-2">
        <div class="row g-2 align-items-end">
          <div class="col-md-3">
            <label class="form-label">Outlet</label>
            <SearchSelect
              v-model="outletId"
              :options="outletOptions"
              placeholder="All outlets"
              :nullLabel="'All outlets'"
              :clearable="true"
            />
          </div>

          <div class="col-md-2">
            <label class="form-label">Method</label>
            <select v-model="method" class="form-select">
              <option value="all">All</option>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              <option value="MOBILE">Mobile</option>
            </select>
          </div>

          <div class="col-md-2">
            <label class="form-label">From</label>
            <input v-model="paidFrom" type="date" class="form-control" />
          </div>

          <div class="col-md-2">
            <label class="form-label">To</label>
            <input v-model="paidTo" type="date" class="form-control" />
          </div>

          <div class="col-md-3">
            <label class="form-label">Search</label>
            <div class="input-group">
              <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
              <input v-model="q" class="form-control" placeholder="Order no or reference..." />
            </div>
          </div>

          <div class="col-12 d-flex gap-2">
            <button class="btn btn-primary" :disabled="loading" @click="load">Load</button>
            <button class="btn btn-light" :disabled="loading" @click="clearFilters">Clear</button>
            <div class="ms-auto text-muted small d-flex align-items-center">
              <span class="me-2">Count: <b>{{ payments.length }}</b></span>
              <span>Total: <b>{{ totalAmount.toFixed(2) }}</b></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="card" style="zoom: 80%;">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading payments...</div>
      </div>
    </div>

    <div v-else class="card" style="zoom: 80%;">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-sm table-bordered mb-0">
            <thead class="bg-light">
              <tr>
                <th>Paid At</th>
                <th>Order</th>
                <th>Outlet</th>
                <th>Method</th>
                <th class="text-end">Amount</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in payments" :key="p.id">
                <td>{{ new Date(p.paid_at).toLocaleString() }}</td>
                <td class="fw-semibold">{{ p.order?.order_no || `#${p.order_id}` }}</td>
                <td>{{ outletNameFromPayment(p) }}</td>
                <td><span class="badge bg-secondary">{{ p.method }}</span></td>
                <td class="text-end fw-semibold">{{ Number(p.amount || 0).toFixed(2) }}</td>
                <td class="text-muted">{{ p.reference || "-" }}</td>
              </tr>

              <tr v-if="payments.length === 0">
                <td colspan="6" class="text-center text-muted py-4">No payments found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
/* avoid SearchSelect clipping */
.overflow-visible { overflow: visible !important; }

.table thead.bg-light th {
  background: var(--ct-tertiary-bg) !important;
  color: var(--ct-emphasis-color) !important;
}
</style>
