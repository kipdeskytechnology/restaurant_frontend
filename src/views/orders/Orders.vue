<script setup>
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import http from "../../api/http";
import { listOrders } from "../../api/orders";

const router = useRouter();

const loading = ref(false);
const refreshing = ref(false);
const outlets = ref([]);

const filters = ref({
  outlet_id: "",
  status: "all",
  order_type: "",
  q: "",
});

const rows = ref([]);

// ---- modal ----
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

async function loadOutlets() {
  const data = await http.get("/system/outlets").then((r) => r.data);
  outlets.value = Array.isArray(data) ? data : [];
}

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    const params = {
      limit: 200,
      status: filters.value.status,
    };
    if (filters.value.outlet_id) params.outlet_id = Number(filters.value.outlet_id);
    if (filters.value.order_type) params.order_type = filters.value.order_type;
    if (filters.value.q) params.q = filters.value.q;
    rows.value = await listOrders(params);
  } catch (e) {
    const msg = e?.response?.data?.detail || e?.message || "Failed to load orders";
    showModal("Error", msg);
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function openPos(orderId) {
  router.push({ name: "pos-order", params: { id: orderId } });
}

// ---- helpers ----
const STATUS_FILTERS = [
  { key: "all",       label: "All",       icon: "ri-list-check-2",       tone: "primary" },
  { key: "open",      label: "Open",      icon: "ri-time-line",          tone: "info" },
  { key: "held",      label: "Held",      icon: "ri-pause-circle-line",  tone: "warning" },
  { key: "paid",      label: "Paid",      icon: "ri-checkbox-circle-line", tone: "success" },
  { key: "cancelled", label: "Cancelled", icon: "ri-close-circle-line",  tone: "danger" },
];

const TYPE_ICONS = {
  DINE_IN:  "ri-restaurant-2-line",
  TAKEAWAY: "ri-takeaway-line",
  DELIVERY: "ri-bike-line",
};

function statusToneClass(s) {
  const u = String(s || "").toUpperCase();
  if (u === "PAID") return "status-paid";
  if (u === "HELD") return "status-held";
  if (u === "OPEN") return "status-open";
  if (u === "CANCELLED") return "status-cancelled";
  return "status-default";
}

function fmtMoney(v) {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function relativeTime(d) {
  if (!d) return "—";
  const date = new Date(d);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}

function absoluteTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString();
}

const counts = computed(() => {
  const c = { total: rows.value.length, open: 0, held: 0, paid: 0, cancelled: 0 };
  for (const r of rows.value) {
    const s = String(r.status || "").toUpperCase();
    if (s === "OPEN") c.open++;
    else if (s === "HELD") c.held++;
    else if (s === "PAID") c.paid++;
    else if (s === "CANCELLED") c.cancelled++;
  }
  return c;
});

const totalSum = computed(() =>
  rows.value.reduce((acc, r) => acc + Number(r.total || 0), 0)
);

function setStatusFilter(k) {
  filters.value.status = k;
  load(false);
}

function clearAll() {
  filters.value = { outlet_id: "", status: "all", order_type: "", q: "" };
  load(false);
}

const isFiltered = computed(
  () =>
    filters.value.outlet_id ||
    filters.value.status !== "all" ||
    filters.value.order_type ||
    !!filters.value.q
);

onMounted(async () => {
  try {
    await loadOutlets();
    await load();
  } catch (e) {
    const msg = e?.response?.data?.detail || e?.message || "Failed to initialize";
    showModal("Error", msg);
  }
});
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
    <!-- ============== Compact header (no hero) ============== -->
    <div class="page-head">
      <div>
        <h2 class="page-title">Orders</h2>
        <div class="page-sub">
          <strong>{{ counts.total }}</strong> order{{ counts.total === 1 ? '' : 's' }}
          <span class="dot">•</span>
          Total <strong>K {{ fmtMoney(totalSum) }}</strong>
        </div>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-light" @click="load(false)" :disabled="refreshing || loading">
          <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i>
        </button>
        <router-link class="btn btn-primary" to="/pos/v2/new-order">
          <i class="ri-add-line me-1"></i> New Order
        </router-link>
      </div>
    </div>

    <!-- ============== Status quick filters ============== -->
    <div class="status-row mb-3">
      <button
        v-for="s in STATUS_FILTERS"
        :key="s.key"
        class="status-chip"
        :class="[`tone-${s.tone}`, { active: filters.status === s.key }]"
        @click="setStatusFilter(s.key)"
      >
        <i :class="s.icon"></i>
        <span>{{ s.label }}</span>
        <span class="status-count">
          {{ s.key === 'all' ? counts.total
            : s.key === 'open' ? counts.open
            : s.key === 'held' ? counts.held
            : s.key === 'paid' ? counts.paid
            : counts.cancelled }}
        </span>
      </button>
    </div>

    <!-- ============== Toolbar card ============== -->
    <div class="card toolbar-card mb-3">
      <div class="card-body py-2">
        <div class="d-flex flex-wrap gap-2 align-items-center">
          <div class="position-relative search-wrap">
            <i class="ri-search-line search-ico"></i>
            <input
              v-model="filters.q"
              type="search"
              class="form-control ps-5"
              placeholder="Search by order no / phone / name…"
              @keyup.enter="load(false)"
            />
          </div>

          <select v-model="filters.outlet_id" class="form-select form-select-sm" style="width: auto" @change="load(false)">
            <option value="">All outlets</option>
            <option v-for="o in outlets" :key="o.id" :value="String(o.id)">{{ o.name }}</option>
          </select>

          <select v-model="filters.order_type" class="form-select form-select-sm" style="width: auto" @change="load(false)">
            <option value="">All types</option>
            <option value="DINE_IN">Dine In</option>
            <option value="TAKEAWAY">Takeaway</option>
            <option value="DELIVERY">Delivery</option>
          </select>

          <button class="btn btn-sm btn-light" v-if="isFiltered" @click="clearAll">
            <i class="ri-close-line me-1"></i> Clear
          </button>
        </div>
      </div>
    </div>

    <!-- ============== Table ============== -->
    <div class="card">
      <div v-if="loading" class="loading-row">
        <span class="spinner-border spinner-border-sm me-2"></span> Loading orders…
      </div>

      <div v-else-if="!rows.length" class="empty-row">
        <i class="ri-receipt-line empty-icon"></i>
        <div>
          <div class="empty-title">{{ isFiltered ? 'No orders match your filters.' : 'No orders yet.' }}</div>
          <div class="empty-sub">
            <span v-if="isFiltered">Try clearing filters, or </span>
            start a new ticket to get going.
          </div>
        </div>
        <div class="ms-auto d-flex gap-2">
          <button v-if="isFiltered" class="btn btn-sm btn-light" @click="clearAll">Clear filters</button>
          <router-link class="btn btn-sm btn-primary" to="/pos/v2/new-order">
            <i class="ri-add-line me-1"></i> New Order
          </router-link>
        </div>
      </div>

      <div v-else class="table-responsive table-scroll">
        <table class="table orders-table align-middle mb-0">
          <thead>
            <tr>
              <th>Order</th>
              <th>Type</th>
              <th>Status</th>
              <th>Table / Customer</th>
              <th class="text-end">Total</th>
              <th>Opened</th>
              <th class="text-end" style="width: 100px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id" @click="openPos(r.id)" class="row-clickable">
              <td>
                <div class="order-no">{{ r.order_no }}</div>
                <div class="order-id">#{{ r.id }}</div>
              </td>
              <td>
                <span class="type-pill">
                  <i :class="TYPE_ICONS[r.order_type] || 'ri-shopping-bag-3-line'"></i>
                  {{ r.order_type === 'DINE_IN' ? 'Dine In' : r.order_type === 'TAKEAWAY' ? 'Takeaway' : r.order_type === 'DELIVERY' ? 'Delivery' : r.order_type }}
                </span>
              </td>
              <td>
                <span class="status-pill" :class="statusToneClass(r.status)">
                  {{ r.status }}
                </span>
              </td>
              <td>
                <div v-if="r.table_no" class="fw-semibold table-no">
                  <i class="ri-bookmark-line text-primary"></i> {{ r.table_no }}
                </div>
                <div v-if="r.customer_name" class="cust-name">{{ r.customer_name }}</div>
                <div v-if="r.customer_phone" class="cust-phone">{{ r.customer_phone }}</div>
                <div v-if="!r.table_no && !r.customer_name && !r.customer_phone" class="text-muted small">—</div>
              </td>
              <td class="text-end">
                <span class="amount">K {{ fmtMoney(r.total) }}</span>
              </td>
              <td>
                <div class="rel-time" :title="absoluteTime(r.opened_at)">{{ relativeTime(r.opened_at) }}</div>
              </td>
              <td class="text-end" @click.stop>
                <button class="btn btn-sm btn-soft-primary" @click="openPos(r.id)">
                  <i class="ri-arrow-right-line"></i> Open
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    </div>
    <!-- /zoom wrapper -->

    <!-- ============== Modal ============== -->
    <div class="modal fade" id="centermodal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content modal-modern">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">Notice</div>
              <h5 class="modal-title">{{ modalTitle }}</h5>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body modal-body-modern">
            {{ modalBody }}
          </div>
        </div>
      </div>
    </div>
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

/* ============= Status quick-filter chips ============= */
.status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  border-radius: 999px;
  border: 1.5px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.status-chip:hover { border-color: rgba(99, 102, 241, 0.35); color: var(--ct-body-color, #1e293b); }

.status-chip .status-count {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 0.75rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  margin-left: 0.15rem;
}

.status-chip.active.tone-primary {
  background: rgba(99, 102, 241, 0.1);
  border-color: var(--ct-primary, #6366f1);
  color: var(--ct-primary, #6366f1);
}
.status-chip.active.tone-info {
  background: rgba(6, 182, 212, 0.1);
  border-color: #06b6d4;
  color: #0e7490;
}
.status-chip.active.tone-warning {
  background: rgba(245, 158, 11, 0.1);
  border-color: #f59e0b;
  color: #b45309;
}
.status-chip.active.tone-success {
  background: rgba(16, 185, 129, 0.1);
  border-color: #10b981;
  color: #047857;
}
.status-chip.active.tone-danger {
  background: rgba(239, 68, 68, 0.1);
  border-color: #ef4444;
  color: #b91c1c;
}
.status-chip.active .status-count {
  background: rgba(255, 255, 255, 0.85);
  border-color: transparent;
  color: inherit;
}

/* ============= Toolbar ============= */
.toolbar-card {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.04) 0%, transparent 100%);
}
.search-wrap {
  position: relative;
  min-width: 260px;
  flex: 1 1 260px;
  max-width: 380px;
}
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

/* ============= Orders table ============= */
/* The table scrolls inside the card so the page doesn't grow unbounded;
   the header stays pinned so column meaning is always visible. */
.table-scroll {
  max-height: calc(100vh - 360px);
  min-height: 260px;
  overflow-y: auto;
  position: relative;
}
.table-scroll::-webkit-scrollbar { width: 8px; }
.table-scroll::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, 0.3);
  border-radius: 999px;
}

/* Sticky `<th>` only works reliably when the table uses border-collapse: separate
   — with collapse, sibling row borders bleed through the sticky cell on scroll.
   We replace the bottom border with an inset box-shadow so the divider rides
   along with the sticky header. */
.table-scroll .orders-table {
  border-collapse: separate;
  border-spacing: 0;
}
.table-scroll .orders-table thead th {
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
.orders-table tbody td {
  vertical-align: middle;
  border-color: var(--ct-border-color, #e6e9ef);
}
.row-clickable { cursor: pointer; transition: background 0.12s ease; }
.row-clickable:hover { background: rgba(99, 102, 241, 0.04); }

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

.type-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-body-color, #1e293b);
  font-size: 0.78rem;
  font-weight: 600;
  border: 1px solid var(--ct-border-color, #e6e9ef);
}
.type-pill i { color: var(--ct-secondary-color, #64748b); }

.status-pill {
  display: inline-flex;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  border: 1px solid transparent;
}
.status-open      { background: rgba(6, 182, 212, 0.14);  color: #0e7490; border-color: rgba(6, 182, 212, 0.28); }
.status-held      { background: rgba(245, 158, 11, 0.16); color: #b45309; border-color: rgba(245, 158, 11, 0.32); }
.status-paid      { background: rgba(16, 185, 129, 0.14); color: #047857; border-color: rgba(16, 185, 129, 0.28); }
.status-cancelled { background: rgba(239, 68, 68, 0.12);  color: #b91c1c; border-color: rgba(239, 68, 68, 0.24); }
.status-default   { background: var(--ct-tertiary-bg, #f8fafc); color: var(--ct-secondary-color, #64748b); border-color: var(--ct-border-color, #e6e9ef); }

.table-no {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 700;
}
.cust-name {
  font-size: 0.85rem;
  color: var(--ct-body-color, #1e293b);
}
.cust-phone {
  font-size: 0.75rem;
  color: var(--ct-secondary-color, #64748b);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.amount {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  color: var(--ct-body-color, #0f172a);
}
.rel-time {
  font-size: 0.82rem;
  color: var(--ct-secondary-color, #64748b);
}

/* ============= Modal-modern ============= */
:deep(.modal-modern) {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 22px !important;
  overflow: hidden;
  box-shadow: 0 30px 60px -20px rgba(15, 23, 42, 0.35);
  background: var(--ct-card-bg, #fff);
  color: var(--ct-body-color, #1e293b);
}
:deep(.modal-header-modern) {
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
:deep(.modal-eyebrow) {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--ct-primary, #6366f1);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 0.2rem;
}
:deep(.modal-header-modern .modal-title) {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  letter-spacing: -0.02em;
  font-size: 1.2rem;
  color: var(--ct-body-color, #0f172a);
}
:deep(.modal-body-modern) {
  padding: 1.25rem;
  background: var(--ct-card-bg, #fff);
  color: var(--ct-body-color, #1e293b);
}
</style>
