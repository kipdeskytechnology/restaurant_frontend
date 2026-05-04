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
const refreshing = ref(false);
const outlets = ref([]);
const payments = ref([]);

// filters
const outletId = ref(null);
const method = ref("all");
const q = ref("");
const paidFrom = ref("");
const paidTo = ref("");

const outletOptions = computed(() =>
  (outlets.value || []).map((o) => ({
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
const outletNameFromPayment = (p) => p?.outlet?.name || outletLabel(p.outlet_id);

async function loadOutlets() {
  try {
    outlets.value = await listOutlets();
  } catch (e) {
    outlets.value = [];
    toast.error(e?.response?.data?.detail || "Failed to load outlets");
  }
}

function toIsoStart(d) { return d ? `${d}T00:00:00` : undefined; }
function toIsoEnd(d) { return d ? `${d}T23:59:59` : undefined; }

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
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
    refreshing.value = false;
  }
}

function clearFilters() {
  outletId.value = null;
  method.value = "all";
  q.value = "";
  paidFrom.value = "";
  paidTo.value = "";
  load(false);
}

const isFiltered = computed(
  () =>
    outletId.value !== null ||
    method.value !== "all" ||
    !!q.value?.trim() ||
    !!paidFrom.value ||
    !!paidTo.value
);

// ---------- summary ----------
const totalAmount = computed(() =>
  (payments.value || []).reduce((sum, p) => sum + Number(p.amount || 0), 0)
);

const byMethod = computed(() => {
  const m = { CASH: 0, CARD: 0, MOBILE: 0, OTHER: 0 };
  const counts = { CASH: 0, CARD: 0, MOBILE: 0, OTHER: 0 };
  for (const p of payments.value || []) {
    const k = (p.method || "").toUpperCase();
    if (k === "CASH" || k === "CARD" || k === "MOBILE") {
      m[k] += Number(p.amount || 0);
      counts[k]++;
    } else {
      m.OTHER += Number(p.amount || 0);
      counts.OTHER++;
    }
  }
  return { totals: m, counts };
});

function fmtMoney(v) {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function methodTone(m) {
  const u = String(m || "").toUpperCase();
  if (u === "CASH") return "method-cash";
  if (u === "CARD") return "method-card";
  if (u === "MOBILE" || u === "MOBILE_MONEY") return "method-mobile";
  return "method-other";
}

function methodIcon(m) {
  const u = String(m || "").toUpperCase();
  if (u === "CASH") return "ri-cash-line";
  if (u === "CARD") return "ri-bank-card-line";
  if (u === "MOBILE" || u === "MOBILE_MONEY") return "ri-smartphone-line";
  return "ri-money-dollar-circle-line";
}

function methodLabel(m) {
  const u = String(m || "").toUpperCase();
  if (u === "MOBILE_MONEY") return "Mobile";
  return u;
}

function fmtDateTime(d) {
  if (!d) return "—";
  const date = new Date(d);
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

onMounted(async () => {
  await loadOutlets();
  await load();
});
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
    <!-- ============== Compact header ============== -->
    <div class="page-head">
      <div>
        <h2 class="page-title">Payments</h2>
        <div class="page-sub">
          <strong>{{ payments.length }}</strong> payment{{ payments.length === 1 ? '' : 's' }}
          <span class="dot">•</span>
          Total <strong>K {{ fmtMoney(totalAmount) }}</strong>
        </div>
      </div>
      <button class="btn btn-primary" :disabled="loading || refreshing" @click="load(false)">
        <i class="ri-refresh-line me-1" :class="{ rotating: refreshing }"></i> Refresh
      </button>
    </div>

    <!-- ============== Method summary tiles ============== -->
    <div class="method-strip mb-3">
      <div class="method-tile method-cash">
        <div class="m-tile-icon"><i class="ri-cash-line"></i></div>
        <div class="m-tile-meta">
          <div class="m-tile-label">Cash</div>
          <div class="m-tile-value">K {{ fmtMoney(byMethod.totals.CASH) }}</div>
          <div class="m-tile-count">{{ byMethod.counts.CASH }} payment{{ byMethod.counts.CASH === 1 ? '' : 's' }}</div>
        </div>
      </div>
      <div class="method-tile method-card">
        <div class="m-tile-icon"><i class="ri-bank-card-line"></i></div>
        <div class="m-tile-meta">
          <div class="m-tile-label">Card</div>
          <div class="m-tile-value">K {{ fmtMoney(byMethod.totals.CARD) }}</div>
          <div class="m-tile-count">{{ byMethod.counts.CARD }} payment{{ byMethod.counts.CARD === 1 ? '' : 's' }}</div>
        </div>
      </div>
      <div class="method-tile method-mobile">
        <div class="m-tile-icon"><i class="ri-smartphone-line"></i></div>
        <div class="m-tile-meta">
          <div class="m-tile-label">Mobile</div>
          <div class="m-tile-value">K {{ fmtMoney(byMethod.totals.MOBILE) }}</div>
          <div class="m-tile-count">{{ byMethod.counts.MOBILE }} payment{{ byMethod.counts.MOBILE === 1 ? '' : 's' }}</div>
        </div>
      </div>
      <div v-if="byMethod.counts.OTHER" class="method-tile method-other">
        <div class="m-tile-icon"><i class="ri-money-dollar-circle-line"></i></div>
        <div class="m-tile-meta">
          <div class="m-tile-label">Other</div>
          <div class="m-tile-value">K {{ fmtMoney(byMethod.totals.OTHER) }}</div>
          <div class="m-tile-count">{{ byMethod.counts.OTHER }} payment{{ byMethod.counts.OTHER === 1 ? '' : 's' }}</div>
        </div>
      </div>
    </div>

    <!-- ============== Filters ============== -->
    <div class="card toolbar-card mb-3">
      <div class="card-body py-2">
        <div class="row g-2 align-items-end">
          <div class="col-12 col-md-3">
            <label class="form-label small mb-1 text-muted">Outlet</label>
            <SearchSelect
              v-model="outletId"
              :options="outletOptions"
              placeholder="All outlets"
              :nullLabel="'All outlets'"
              :clearable="true"
            />
          </div>

          <div class="col-6 col-md-2">
            <label class="form-label small mb-1 text-muted">Method</label>
            <select v-model="method" class="form-select">
              <option value="all">All methods</option>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              <option value="MOBILE">Mobile</option>
            </select>
          </div>

          <div class="col-6 col-md-2">
            <label class="form-label small mb-1 text-muted">From</label>
            <input v-model="paidFrom" type="date" class="form-control" />
          </div>

          <div class="col-6 col-md-2">
            <label class="form-label small mb-1 text-muted">To</label>
            <input v-model="paidTo" type="date" class="form-control" />
          </div>

          <div class="col-6 col-md-3">
            <label class="form-label small mb-1 text-muted">Search</label>
            <div class="position-relative search-wrap">
              <i class="ri-search-line search-ico"></i>
              <input
                v-model="q"
                type="search"
                class="form-control ps-5"
                placeholder="Order no or reference…"
                @keyup.enter="load(false)"
              />
            </div>
          </div>

          <div class="col-12 d-flex gap-2 align-items-center mt-2">
            <button class="btn btn-sm btn-primary" :disabled="loading || refreshing" @click="load(false)">
              <i class="ri-search-line me-1"></i> Apply
            </button>
            <button v-if="isFiltered" class="btn btn-sm btn-light" @click="clearFilters">
              <i class="ri-close-line me-1"></i> Clear
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Table ============== -->
    <div class="card">
      <div v-if="loading" class="loading-row">
        <span class="spinner-border spinner-border-sm me-2"></span> Loading payments…
      </div>

      <div v-else-if="!payments.length" class="empty-row">
        <i class="ri-bank-card-line empty-icon"></i>
        <div>
          <div class="empty-title">No payments found</div>
          <div class="empty-sub">
            {{ isFiltered ? 'Try clearing filters or widening the date range.' : 'Payments will appear here once orders get paid.' }}
          </div>
        </div>
        <div class="ms-auto">
          <button v-if="isFiltered" class="btn btn-sm btn-light" @click="clearFilters">
            <i class="ri-close-line me-1"></i> Clear filters
          </button>
        </div>
      </div>

      <div v-else class="table-responsive table-scroll">
        <table class="table payments-table align-middle mb-0">
          <thead>
            <tr>
              <th>Paid</th>
              <th>Order</th>
              <th>Outlet</th>
              <th>Method</th>
              <th>Reference</th>
              <th class="text-end">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in payments" :key="p.id">
              <td>
                <div class="paid-date">{{ fmtDateTime(p.paid_at).date }}</div>
                <div class="paid-time">{{ fmtDateTime(p.paid_at).time }}</div>
              </td>
              <td>
                <div class="order-no">{{ p.order?.order_no || `#${p.order_id}` }}</div>
                <div class="order-id">#{{ p.order_id }}</div>
              </td>
              <td>
                <span class="outlet-cell">
                  <i class="ri-store-2-line"></i>
                  {{ outletNameFromPayment(p) }}
                </span>
              </td>
              <td>
                <span class="method-pill" :class="methodTone(p.method)">
                  <i :class="methodIcon(p.method)"></i>
                  {{ methodLabel(p.method) }}
                </span>
              </td>
              <td>
                <span v-if="p.reference" class="ref-cell">{{ p.reference }}</span>
                <span v-else class="text-muted small">—</span>
              </td>
              <td class="text-end">
                <span class="amount">K {{ fmtMoney(p.amount) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    </div>
    <!-- /zoom wrapper -->
  </DefaultLayout>
</template>

<style scoped>
.rotating { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ============= Compact header ============= */
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.page-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  letter-spacing: -0.025em;
  font-size: 1.55rem;
  margin: 0;
  color: var(--ct-body-color, #0f172a);
}
.page-sub {
  font-size: 0.85rem;
  color: var(--ct-secondary-color, #64748b);
  margin-top: 0.15rem;
}
.page-sub strong { color: var(--ct-body-color, #1e293b); font-weight: 700; }
.page-sub .dot { margin: 0 0.4rem; opacity: 0.4; }

/* ============= Method summary tiles ============= */
.method-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.85rem;
}
.method-tile {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px;
  position: relative;
  overflow: hidden;
}
.method-tile::before {
  content: "";
  position: absolute;
  top: 0; left: 0; bottom: 0;
  width: 4px;
}
.method-cash::before   { background: linear-gradient(180deg, #10b981, #06b6d4); }
.method-card::before   { background: linear-gradient(180deg, #6366f1, #8b5cf6); }
.method-mobile::before { background: linear-gradient(180deg, #f59e0b, #ec4899); }
.method-other::before  { background: linear-gradient(180deg, #94a3b8, #64748b); }

.m-tile-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 1.2rem;
  color: #fff;
  flex-shrink: 0;
}
.method-cash   .m-tile-icon { background: linear-gradient(135deg, #10b981, #06b6d4); }
.method-card   .m-tile-icon { background: linear-gradient(135deg, #6366f1, #8b5cf6); }
.method-mobile .m-tile-icon { background: linear-gradient(135deg, #f59e0b, #ec4899); }
.method-other  .m-tile-icon { background: linear-gradient(135deg, #94a3b8, #64748b); }

.m-tile-meta { min-width: 0; }
.m-tile-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ct-secondary-color, #64748b);
}
.m-tile-value {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 1.15rem;
  color: var(--ct-body-color, #0f172a);
  letter-spacing: -0.02em;
  margin-top: 0.1rem;
}
.m-tile-count {
  font-size: 0.72rem;
  color: var(--ct-secondary-color, #64748b);
  margin-top: 0.1rem;
}

/* ============= Toolbar ============= */
.toolbar-card {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.04) 0%, transparent 100%);
  overflow: visible !important;
}
.search-wrap { position: relative; }
.search-ico {
  position: absolute;
  left: 0.85rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8);
  pointer-events: none;
}

/* ============= Loading / empty ============= */
.loading-row {
  padding: 2rem 1.25rem;
  color: var(--ct-secondary-color, #64748b);
  text-align: center;
}
.empty-row {
  padding: 2rem 1.25rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  color: var(--ct-secondary-color, #64748b);
  flex-wrap: wrap;
}
.empty-icon {
  font-size: 2rem;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: rgba(99, 102, 241, 0.08);
  color: var(--ct-primary, #6366f1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.empty-title {
  font-weight: 700;
  color: var(--ct-body-color, #1e293b);
  font-family: "Plus Jakarta Sans", sans-serif;
}
.empty-sub { font-size: 0.85rem; }

/* ============= Payments table ============= */
/* Table scrolls inside the card; the page doesn't grow when there are
   hundreds of payments. The header stays pinned. */
.table-scroll {
  max-height: calc(100vh - 480px);
  min-height: 260px;
  overflow-y: auto;
  position: relative;
}
.table-scroll::-webkit-scrollbar { width: 8px; }
.table-scroll::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, 0.3);
  border-radius: 999px;
}

/* Sticky `<th>` requires border-collapse: separate (collapse causes the cell
   border to bleed through). Use inset box-shadow for the divider so it rides
   with the sticky header on scroll. */
.table-scroll .payments-table {
  border-collapse: separate;
  border-spacing: 0;
}
.table-scroll .payments-table thead th {
  position: sticky !important;
  top: 0;
  z-index: 5;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-bottom: 0;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.payments-table tbody td {
  vertical-align: middle;
  border-color: var(--ct-border-color, #e6e9ef);
}

.paid-date {
  font-weight: 600;
  color: var(--ct-body-color, #1e293b);
  font-size: 0.88rem;
}
.paid-time {
  font-size: 0.75rem;
  color: var(--ct-secondary-color, #64748b);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.order-no {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  color: var(--ct-body-color, #0f172a);
  letter-spacing: -0.01em;
}
.order-id {
  font-size: 0.72rem;
  color: var(--ct-secondary-color, #94a3b8);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.outlet-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.88rem;
  color: var(--ct-body-color, #1e293b);
}
.outlet-cell i { color: var(--ct-secondary-color, #94a3b8); }

.method-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  border: 1px solid transparent;
}
.method-pill.method-cash   { background: rgba(16, 185, 129, 0.14); color: #047857; border-color: rgba(16, 185, 129, 0.28); }
.method-pill.method-card   { background: rgba(99, 102, 241, 0.14); color: #4338ca; border-color: rgba(99, 102, 241, 0.28); }
.method-pill.method-mobile { background: rgba(245, 158, 11, 0.16); color: #b45309; border-color: rgba(245, 158, 11, 0.32); }
.method-pill.method-other  { background: var(--ct-tertiary-bg, #f8fafc); color: var(--ct-secondary-color, #64748b); border-color: var(--ct-border-color, #e6e9ef); }

.ref-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  color: var(--ct-body-color, #1e293b);
}

.amount {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  color: var(--ct-body-color, #0f172a);
}

/* SearchSelect dropdown — float above other elements */
:deep(.searchselect .dropdown-panel) { z-index: 2000 !important; }
:deep(.searchselect) { position: relative; z-index: 5; }
</style>
