<!-- src/views/purchasing/PurchaseOrders.vue -->
<script setup>
import { ref, onMounted, watch, computed } from "vue";
import { useRouter } from "vue-router";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import { listPurchaseOrders, listSuppliers } from "../../api/purchasing";
import http from "../../api/http";

const toast = useToast();
const router = useRouter();

const loading = ref(true);
const refreshing = ref(false);
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

const summary = computed(() => {
  const total = rows.value.length;
  let draft = 0, sent = 0, partial = 0, received = 0, cancelled = 0;
  for (const r of rows.value) {
    const s = String(r.status || "").toUpperCase();
    if (s === "DRAFT") draft++;
    else if (s === "SENT") sent++;
    else if (s === "PARTIAL") partial++;
    else if (s === "RECEIVED") received++;
    else if (s === "CANCELLED") cancelled++;
  }
  return { total, draft, sent, partial, received, cancelled };
});

async function loadOutlets() {
  const data = await http.get("/system/outlets").then((r) => r.data);
  outlets.value = Array.isArray(data) ? data : [];
}
async function loadSuppliers() {
  const data = await listSuppliers({ active: "1", limit: 500 });
  suppliers.value = Array.isArray(data) ? data : [];
}

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
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
    refreshing.value = false;
  }
}

function openPO(poId) {
  const n = Number(poId);
  if (!Number.isInteger(n) || n <= 0) {
    toast.error("Invalid purchase order id");
    return;
  }
  router.push({ name: "purchase-order-view", params: { id: n } });
}

function statusTone(st) {
  const s = String(st || "").toUpperCase();
  if (s === "RECEIVED") return "success";
  if (s === "PARTIAL") return "warning";
  if (s === "SENT") return "primary";
  if (s === "CANCELLED") return "danger";
  return "default";
}
function statusIcon(st) {
  const s = String(st || "").toUpperCase();
  if (s === "RECEIVED") return "ri-check-double-line";
  if (s === "PARTIAL") return "ri-progress-3-line";
  if (s === "SENT") return "ri-send-plane-line";
  if (s === "CANCELLED") return "ri-close-circle-line";
  return "ri-edit-line";
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
function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
function fmtTimeShort(s) {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function clearFilters() {
  filters.value = { outlet_id: "", supplier_id: "", status: "all", q: "" };
}

let t = null;
watch(
  () => [filters.value.outlet_id, filters.value.supplier_id, filters.value.status, filters.value.q],
  () => {
    clearTimeout(t);
    t = setTimeout(() => load(false), 250);
  }
);

onMounted(async () => {
  await Promise.all([loadOutlets(), loadSuppliers()]);
  await load();
});
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-shopping-cart-2-line"></i><span>Purchasing</span>
          </div>
          <h1 class="hero-title">Purchase Orders</h1>
          <p class="hero-sub">
            DRAFT → SENT → RECEIVED. Create POs, send them to suppliers, then post receipts to update stock and average cost.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <router-link v-can="'purchases:manage'" class="btn btn-pill btn-cta" to="/purchasing/purchase-orders/new">
            <i class="ri-add-line"></i><span>New PO</span>
          </router-link>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon tone-default"><i class="ri-edit-line"></i></div>
          <div>
            <div class="stat-label">Draft</div>
            <div class="stat-value">{{ summary.draft }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-info"><i class="ri-send-plane-line"></i></div>
          <div>
            <div class="stat-label">Sent</div>
            <div class="stat-value">{{ summary.sent }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-warning"><i class="ri-progress-3-line"></i></div>
          <div>
            <div class="stat-label">Partial</div>
            <div class="stat-value">{{ summary.partial }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-success"><i class="ri-check-double-line"></i></div>
          <div>
            <div class="stat-label">Received</div>
            <div class="stat-value text-success">{{ summary.received }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-danger"><i class="ri-close-circle-line"></i></div>
          <div>
            <div class="stat-label">Cancelled</div>
            <div class="stat-value">{{ summary.cancelled }}</div>
          </div>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
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
              <label class="form-label">PO number</label>
              <div class="position-relative">
                <i class="ri-search-line search-ico"></i>
                <input class="form-control ps-5" v-model="filters.q" placeholder="PO-20260127-0001" />
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
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading purchase orders…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="rows.length === 0" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-shopping-cart-2-line"></i></div>
        <h5 class="mt-2 mb-1">No purchase orders found</h5>
        <p class="text-muted mb-3">Create your first PO to start tracking orders to suppliers.</p>
        <div>
          <router-link v-can="'purchases:manage'" to="/purchasing/purchase-orders/new" class="btn btn-primary">
            <i class="ri-add-line me-1"></i> New PO
          </router-link>
        </div>
      </div>

      <!-- ============== POs table ============== -->
      <div v-else class="card data-card">
        <div class="card-body p-0">
          <div class="table-responsive data-scroll">
            <table class="table align-middle mb-0 po-table">
              <thead>
                <tr>
                  <th style="width: 170px">PO Number</th>
                  <th>Supplier</th>
                  <th style="width: 200px">Outlet</th>
                  <th style="width: 130px">Status</th>
                  <th style="width: 160px">Ordered</th>
                  <th style="width: 90px" class="text-end"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in rows" :key="r.id" class="po-row" @click="openPO(r.id)">
                  <td>
                    <span class="po-chip">{{ r.po_number }}</span>
                  </td>
                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <div class="sup-avatar" :style="{ '--accent': colorFor(r.supplier?.name || supplierNameById.get(r.supplier_id) || '') }">
                        {{ initialsOf(r.supplier?.name || supplierNameById.get(r.supplier_id) || '?') }}
                      </div>
                      <div class="min-w-0">
                        <div class="sup-name truncate">
                          {{ r.supplier?.name || supplierNameById.get(r.supplier_id) || `Supplier #${r.supplier_id}` }}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="outlet-chip">
                      <i class="ri-store-2-line me-1"></i>
                      {{ outletNameById.get(r.outlet_id) || `Outlet #${r.outlet_id}` }}
                    </span>
                  </td>
                  <td>
                    <span class="status-chip" :class="`tone-${statusTone(r.status)}`">
                      <i :class="statusIcon(r.status)"></i>{{ r.status }}
                    </span>
                  </td>
                  <td>
                    <div class="when-date" v-if="r.ordered_at">{{ fmtDate(r.ordered_at) }}</div>
                    <div class="when-time" v-if="r.ordered_at">{{ fmtTimeShort(r.ordered_at) }}</div>
                    <span v-else class="text-muted">—</span>
                  </td>
                  <td class="text-end" @click.stop>
                    <button class="row-icon-btn" title="Open" @click="openPO(r.id)">
                      <i class="ri-arrow-right-line"></i>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
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
.stat-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.6rem; }
.stat-tile {
  display: flex; align-items: center; gap: 0.65rem;
  padding: 0.75rem 0.9rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px; box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.stat-icon { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-size: 1rem; }
.stat-icon.tone-default { background: rgba(100,116,139,0.14); color: #64748b; }
.stat-icon.tone-info { background: rgba(8,145,178,0.14); color: #0891b2; }
.stat-icon.tone-warning { background: rgba(245,158,11,0.18); color: #b45309; }
.stat-icon.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.stat-icon.tone-danger { background: rgba(239,68,68,0.14); color: #b91c1c; }
.stat-label { font-size: 0.66rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ct-secondary-color, #64748b); }
.stat-value { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1rem; color: var(--ct-body-color, #0f172a); }

/* ============= Toolbar / Empty ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(13,148,136,0.05) 0%, transparent 100%); }
.search-ico { position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%); color: var(--ct-secondary-color, #94a3b8); pointer-events: none; }
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(13,148,136,0.12); color: #0d9488; font-size: 1.6rem;
}

/* ============= POs table ============= */
.data-card { overflow: hidden; }
.data-scroll {
  max-height: calc(100vh - 480px);
  min-height: 240px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.po-table thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.po-row { cursor: pointer; transition: background 0.15s ease; }
.po-row:hover { background: rgba(13,148,136,0.04); }

.po-chip {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.78rem; font-weight: 700;
  padding: 0.25rem 0.6rem; border-radius: 6px;
  background: rgba(13,148,136,0.1); color: #0d9488;
  border: 1px solid rgba(13,148,136,0.22);
}

.sup-avatar {
  width: 34px; height: 34px;
  border-radius: 9px;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 0.74rem;
  color: var(--accent, #0d9488);
  background: color-mix(in srgb, var(--accent, #0d9488) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #0d9488) 28%, transparent);
  flex-shrink: 0;
}
.sup-name { font-weight: 700; color: var(--ct-body-color, #0f172a); }
.min-w-0 { min-width: 0; }
.truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 240px; }

.outlet-chip {
  display: inline-flex; align-items: center;
  font-size: 0.78rem; font-weight: 600;
  padding: 0.2rem 0.55rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 8px;
  color: var(--ct-secondary-color, #475569);
}

.status-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.7rem; font-weight: 700;
  letter-spacing: 0.04em;
}
.status-chip i { font-size: 0.85rem; }
.tone-default { background: rgba(100,116,139,0.14); color: #475569; }
.tone-info { background: rgba(8,145,178,0.14); color: #0e7490; }
.tone-primary { background: rgba(29,78,216,0.12); color: #1d4ed8; }
.tone-warning { background: rgba(245,158,11,0.18); color: #b45309; }
.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.tone-danger { background: rgba(239,68,68,0.14); color: #b91c1c; }

.when-date { font-weight: 700; font-size: 0.82rem; color: var(--ct-body-color, #0f172a); line-height: 1.2; }
.when-time { font-size: 0.72rem; color: var(--ct-secondary-color, #64748b); font-family: "JetBrains Mono", ui-monospace, monospace; }

.row-icon-btn {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
}
.row-icon-btn:hover { background: rgba(13,148,136,0.1); color: #0d9488; }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
