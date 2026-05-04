<!-- src/views/inventory/Ledger.vue -->
<script setup>
import { ref, computed, onMounted, watch } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import { listStockLedger, listInventoryItems } from "../../api/inventory";
import { listOutlets } from "../../api/lookups";

const toast = useToast();

const loading = ref(true);
const refreshing = ref(false);
const rows = ref([]);
const outlets = ref([]);
const items = ref([]);

const filters = ref({
  outlet_id: "",
  item_q: "",
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

async function loadLedger(showSpinner = false) {
  if (showSpinner) refreshing.value = true;
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
      item_id: undefined,
      limit: Number(filters.value.limit || 200),
    };

    const all = await listStockLedger(params);
    rows.value = filteredItemIds ? all.filter((r) => filteredItemIds.has(r.inventory_item_id)) : all;
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load ledger");
  } finally {
    refreshing.value = false;
  }
}

function fmtTime(dt) {
  try {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return dt;
    return d.toLocaleString();
  } catch { return dt; }
}
function fmtTimeShort(dt) {
  try {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return dt;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return dt; }
}
function fmtDateOnly(dt) {
  try {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return dt;
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  } catch { return dt; }
}

function toNumberOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtQty(v, dp = 6) {
  const n = toNumberOrNull(v);
  if (n === null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dp });
}
function fmtCost(v, dp = 4) {
  const n = toNumberOrNull(v);
  if (n === null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// Reason styling — drives chip color
function reasonTone(reason) {
  const r = String(reason || "").toUpperCase();
  if (r.includes("RECEIPT") || r.includes("PURCHASE") || r.includes("RESTOCK")) return "success";
  if (r.includes("SALE") || r.includes("ORDER")) return "info";
  if (r.includes("WASTE") || r.includes("TRANSFER_OUT")) return "warning";
  if (r.includes("ADJUSTMENT")) return "default";
  if (r.includes("COUNT")) return "primary";
  return "default";
}

const summary = computed(() => {
  let inflow = 0, outflow = 0, count = rows.value.length;
  for (const r of rows.value) {
    const n = Number(r.qty_delta);
    if (!Number.isFinite(n)) continue;
    if (n > 0) inflow += n; else outflow += -n;
  }
  return { count, inflow, outflow, net: inflow - outflow };
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
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-history-line"></i><span>Inventory</span>
          </div>
          <h1 class="hero-title">Stock Ledger</h1>
          <p class="hero-sub">
            Every movement, every reason, every cost — the audit trail behind every change to your on-hand quantities.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="loadLedger(true)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon stat-info"><i class="ri-list-check-2"></i></div>
          <div>
            <div class="stat-label">Movements</div>
            <div class="stat-value">{{ summary.count }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon stat-success"><i class="ri-arrow-up-line"></i></div>
          <div>
            <div class="stat-label">Total in</div>
            <div class="stat-value text-success">+{{ fmtQty(summary.inflow, 3) }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon stat-danger"><i class="ri-arrow-down-line"></i></div>
          <div>
            <div class="stat-label">Total out</div>
            <div class="stat-value text-danger">−{{ fmtQty(summary.outflow, 3) }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon" :class="summary.net >= 0 ? 'stat-success' : 'stat-danger'">
            <i :class="summary.net >= 0 ? 'ri-line-chart-line' : 'ri-line-chart-line'"></i>
          </div>
          <div>
            <div class="stat-label">Net change</div>
            <div class="stat-value" :class="summary.net >= 0 ? 'text-success' : 'text-danger'">
              {{ summary.net >= 0 ? '+' : '−' }}{{ fmtQty(Math.abs(summary.net), 3) }}
            </div>
          </div>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-md-4">
              <label class="form-label">Outlet</label>
              <select v-model="filters.outlet_id" class="form-select">
                <option value="">All outlets</option>
                <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
            </div>

            <div class="col-md-6">
              <label class="form-label">Search</label>
              <div class="position-relative">
                <i class="ri-search-line search-ico"></i>
                <input
                  v-model="filters.item_q"
                  class="form-control ps-5"
                  placeholder="Filter by item name or SKU…"
                />
              </div>
            </div>

            <div class="col-md-2">
              <label class="form-label">Show last</label>
              <select v-model="filters.limit" class="form-select">
                <option :value="100">100</option>
                <option :value="200">200</option>
                <option :value="500">500</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading ledger…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="!rows.length" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-history-line"></i></div>
        <h5 class="mt-2 mb-1">No movements found</h5>
        <p class="text-muted mb-3">Adjust stock or post a purchase to start populating the ledger.</p>
      </div>

      <!-- ============== Ledger table ============== -->
      <div v-else class="card data-card">
        <div class="card-body p-0">
          <div class="table-responsive data-scroll">
            <table class="table align-middle mb-0 ledger-table">
              <thead>
                <tr>
                  <th style="width: 150px">When</th>
                  <th>Item</th>
                  <th style="width: 200px">Outlet</th>
                  <th style="width: 130px" class="text-end">Δ Qty</th>
                  <th style="width: 110px" class="text-end">Unit cost</th>
                  <th style="width: 160px">Reason</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in rows" :key="r.id">
                  <td>
                    <div class="when-date">{{ fmtDateOnly(r.occurred_at) }}</div>
                    <div class="when-time">{{ fmtTimeShort(r.occurred_at) }}</div>
                  </td>

                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <div class="item-avatar" :style="{ '--accent': colorFor(r.item?.name) }">
                        {{ initialsOf(r.item?.name) }}
                      </div>
                      <div class="min-w-0">
                        <div class="item-name">{{ r.item?.name || `#${r.inventory_item_id}` }}</div>
                        <div class="item-sub" v-if="r.item?.sku">SKU: {{ r.item.sku }}</div>
                      </div>
                    </div>
                  </td>

                  <td>
                    <span class="outlet-chip">
                      <i class="ri-store-2-line me-1"></i>{{ r.outlet?.name || `#${r.outlet_id}` }}
                    </span>
                  </td>

                  <td class="text-end">
                    <span class="delta-pill" :class="Number(r.qty_delta) < 0 ? 'delta-out' : 'delta-in'">
                      <i :class="Number(r.qty_delta) < 0 ? 'ri-arrow-down-line' : 'ri-arrow-up-line'"></i>
                      {{ Number(r.qty_delta) >= 0 ? '+' : '' }}{{ fmtQty(r.qty_delta, 6) }}
                    </span>
                  </td>

                  <td class="text-end">
                    <span class="metric-mono">{{ fmtCost(r.unit_cost, 4) }}</span>
                  </td>

                  <td>
                    <span class="reason-chip" :class="`tone-${reasonTone(r.reason)}`">
                      {{ r.reason || "—" }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="px-3 py-2 small text-muted footnote">
            <i class="ri-information-line me-1"></i>
            Δ Qty up to 6 decimals · Unit cost fixed to 4 decimals · Most recent first.
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
  background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 60%, #8b5cf6 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(14,165,233,0.55);
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
.page-hero-actions .btn-light { background: rgba(255,255,255,0.95); color: #1e293b; border: none; }

/* ============= Stat strip ============= */
.stat-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem;
}
.stat-tile {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.85rem 1rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.stat-icon {
  width: 38px; height: 38px; border-radius: 10px;
  display: grid; place-items: center;
  font-size: 1.05rem;
}
.stat-info { background: rgba(99,102,241,0.12); color: #6366f1; }
.stat-success { background: rgba(16,185,129,0.14); color: #047857; }
.stat-danger { background: rgba(239,68,68,0.14); color: #b91c1c; }
.stat-label {
  font-size: 0.7rem; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ct-secondary-color, #64748b);
}
.stat-value {
  font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800;
  letter-spacing: -0.02em; font-size: 1.05rem;
  color: var(--ct-body-color, #0f172a);
}

/* ============= Toolbar / Empty ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(99,102,241,0.04) 0%, transparent 100%); }
.search-ico {
  position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8); pointer-events: none;
}
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); font-size: 1.6rem;
}

/* ============= Ledger table ============= */
.data-card { overflow: hidden; }
.data-scroll {
  /* Hero (~140) + stat strip (~92) + toolbar (~96) + chrome → ~440 */
  max-height: calc(100vh - 440px);
  min-height: 220px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }
.data-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.5); }

.ledger-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.when-date { font-weight: 700; font-size: 0.82rem; color: var(--ct-body-color, #0f172a); line-height: 1.2; }
.when-time { font-size: 0.72rem; color: var(--ct-secondary-color, #64748b); font-family: "JetBrains Mono", ui-monospace, monospace; }

.item-avatar {
  width: 34px; height: 34px; border-radius: 9px;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; font-size: 0.74rem;
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 24%, transparent);
  flex-shrink: 0;
}
.item-name { font-weight: 700; color: var(--ct-body-color, #0f172a); line-height: 1.2; }
.item-sub { font-size: 0.7rem; color: var(--ct-secondary-color, #64748b); font-weight: 600; }
.min-w-0 { min-width: 0; }

.outlet-chip {
  display: inline-flex; align-items: center;
  font-size: 0.78rem; font-weight: 600;
  padding: 0.2rem 0.55rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 8px;
  color: var(--ct-secondary-color, #475569);
}

.delta-pill {
  display: inline-flex; align-items: center; gap: 0.25rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.78rem; font-weight: 700;
}
.delta-pill i { font-size: 0.85rem; }
.delta-in { background: rgba(16,185,129,0.14); color: #047857; }
.delta-out { background: rgba(239,68,68,0.14); color: #b91c1c; }

.metric-mono {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.82rem; color: var(--ct-secondary-color, #64748b); font-weight: 600;
}

.reason-chip {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 6px;
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em;
  text-transform: uppercase;
}
.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.tone-info { background: rgba(6,182,212,0.14); color: #0e7490; }
.tone-warning { background: rgba(245,158,11,0.18); color: #b45309; }
.tone-primary { background: rgba(99,102,241,0.12); color: #4f46e5; }
.tone-default { background: rgba(100,116,139,0.14); color: #475569; }

.footnote { border-top: 1px dashed var(--ct-border-color, #e6e9ef); }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
