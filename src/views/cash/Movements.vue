<!-- src/views/cash/Movements.vue -->
<script setup>
import { ref, computed, onMounted, watch } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import { listAllMovements } from "../../api/cash";
import { listOutlets } from "../../api/systemOutlets";

const toast = useToast();
const loading = ref(true);
const refreshing = ref(false);

const items = ref([]);
const outlets = ref([]);

const filters = ref({
  outlet_id: "",
  shift_id: "",
  movement_type: "",
  limit: 200,
});

async function loadOutlets() {
  try {
    outlets.value = await listOutlets();
  } catch {
    outlets.value = [];
  }
}

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    items.value = await listAllMovements({
      outlet_id: filters.value.outlet_id || undefined,
      shift_id: filters.value.shift_id || undefined,
      movement_type: filters.value.movement_type || undefined,
      limit: Number(filters.value.limit || 200),
    });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load movements");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function fmtMoney(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDateOnly(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
function fmtTimeShort(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function moveTone(t) {
  if (t === "PAID_IN") return "in";
  if (t === "PAID_OUT") return "out";
  if (t === "DROP") return "drop";
  if (t === "CORRECTION") return "warn";
  return "default";
}
function moveIcon(t) {
  if (t === "PAID_IN") return "ri-arrow-down-line";
  if (t === "PAID_OUT") return "ri-arrow-up-line";
  if (t === "DROP") return "ri-bank-line";
  if (t === "CORRECTION") return "ri-equalizer-line";
  return "ri-exchange-dollar-line";
}

const summary = computed(() => {
  let inflow = 0, outflow = 0, drops = 0, count = items.value.length;
  for (const m of items.value || []) {
    const a = Number(m.amount) || 0;
    if (m.movement_type === "PAID_IN") inflow += a;
    else if (m.movement_type === "PAID_OUT") outflow += a;
    else if (m.movement_type === "DROP") drops += a;
    else if (m.movement_type === "CORRECTION") {
      if (a >= 0) inflow += a;
      else outflow += -a;
    }
  }
  return { inflow, outflow, drops, count, net: inflow - outflow };
});

const outletNameById = computed(() => {
  const m = new Map();
  for (const o of outlets.value || []) m.set(Number(o.id), o.name ?? `Outlet #${o.id}`);
  return m;
});
function outletLabel(id) {
  return outletNameById.value.get(Number(id)) || (id ? `Outlet #${id}` : "—");
}

function clearFilters() {
  filters.value = { outlet_id: "", shift_id: "", movement_type: "", limit: 200 };
}

let filterTimer = null;
watch(
  () => [filters.value.outlet_id, filters.value.shift_id, filters.value.movement_type, filters.value.limit],
  () => {
    if (loading.value) return;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => load(false), 250);
  }
);

onMounted(async () => {
  await loadOutlets();
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
            <i class="ri-exchange-dollar-line"></i><span>Cash</span>
          </div>
          <h1 class="hero-title">Cash Movements</h1>
          <p class="hero-sub">
            Every paid-in, paid-out, drop and correction across all shifts and outlets — the full audit trail of cash hitting your tills.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon tone-info"><i class="ri-list-check-2"></i></div>
          <div>
            <div class="stat-label">Records</div>
            <div class="stat-value">{{ summary.count }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-success"><i class="ri-arrow-down-line"></i></div>
          <div>
            <div class="stat-label">Total in</div>
            <div class="stat-value text-success">+K {{ fmtMoney(summary.inflow) }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-danger"><i class="ri-arrow-up-line"></i></div>
          <div>
            <div class="stat-label">Total out</div>
            <div class="stat-value text-danger">−K {{ fmtMoney(summary.outflow) }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-cash"><i class="ri-bank-line"></i></div>
          <div>
            <div class="stat-label">Drops</div>
            <div class="stat-value">K {{ fmtMoney(summary.drops) }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon" :class="summary.net >= 0 ? 'tone-success' : 'tone-danger'">
            <i class="ri-line-chart-line"></i>
          </div>
          <div>
            <div class="stat-label">Net</div>
            <div class="stat-value" :class="summary.net >= 0 ? 'text-success' : 'text-danger'">
              {{ summary.net >= 0 ? '+' : '−' }}K {{ fmtMoney(Math.abs(summary.net)) }}
            </div>
          </div>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-md-3">
              <label class="form-label">Outlet</label>
              <select v-model="filters.outlet_id" class="form-select">
                <option value="">All outlets</option>
                <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
            </div>

            <div class="col-md-2">
              <label class="form-label">Shift ID</label>
              <input v-model="filters.shift_id" class="form-control" placeholder="e.g. 42" />
            </div>

            <div class="col-md-3">
              <label class="form-label">Type</label>
              <select v-model="filters.movement_type" class="form-select">
                <option value="">All types</option>
                <option value="PAID_IN">Paid in</option>
                <option value="PAID_OUT">Paid out</option>
                <option value="DROP">Drop</option>
                <option value="CORRECTION">Correction</option>
              </select>
            </div>

            <div class="col-md-2">
              <label class="form-label">Show last</label>
              <select v-model="filters.limit" class="form-select">
                <option :value="100">100</option>
                <option :value="200">200</option>
                <option :value="500">500</option>
              </select>
            </div>

            <div class="col-md-2 d-grid">
              <button class="btn btn-light" @click="clearFilters" title="Clear filters">
                <i class="ri-filter-off-line me-1"></i>Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading movements…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="!items.length" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-exchange-dollar-line"></i></div>
        <h5 class="mt-2 mb-1">No movements found</h5>
        <p class="text-muted mb-3">Adjust filters or open a shift to start recording cash movements.</p>
      </div>

      <!-- ============== Movements table ============== -->
      <div v-else class="card data-card">
        <div class="card-body p-0">
          <div class="table-responsive data-scroll">
            <table class="table align-middle mb-0 mov-table">
              <thead>
                <tr>
                  <th style="width: 140px">When</th>
                  <th style="width: 120px">Type</th>
                  <th style="width: 130px" class="text-end">Amount</th>
                  <th style="width: 200px">Outlet</th>
                  <th style="width: 90px">Shift</th>
                  <th>Reason</th>
                  <th style="width: 160px">By</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in items" :key="m.id">
                  <td>
                    <div class="when-date">{{ fmtDateOnly(m.occurred_at) }}</div>
                    <div class="when-time">{{ fmtTimeShort(m.occurred_at) }}</div>
                  </td>
                  <td>
                    <span class="move-chip" :class="`move-${moveTone(m.movement_type)}`">
                      <i :class="moveIcon(m.movement_type)"></i>
                      {{ String(m.movement_type || '').replace('_', ' ') }}
                    </span>
                  </td>
                  <td class="text-end">
                    <span
                      class="amount-mono"
                      :class="moveTone(m.movement_type) === 'in' ? 'text-success' : moveTone(m.movement_type) === 'out' ? 'text-danger' : ''"
                    >
                      K {{ fmtMoney(m.amount) }}
                    </span>
                  </td>
                  <td>
                    <span class="outlet-chip">
                      <i class="ri-store-2-line me-1"></i>{{ outletLabel(m.outlet_id) }}
                    </span>
                  </td>
                  <td>
                    <span class="shift-chip">#{{ m.shift_id }}</span>
                  </td>
                  <td>{{ m.reason || '—' }}</td>
                  <td class="small text-muted">
                    {{ m.performed_by?.username || m.performed_by?.email || `User #${m.performed_by_user_id}` }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="px-3 py-2 small text-muted footnote">
            <i class="ri-information-line me-1"></i>
            Most recent first · Showing up to {{ filters.limit }} records
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
  background: linear-gradient(135deg, #10b981 0%, #06b6d4 55%, #6366f1 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(16,185,129,0.55);
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

/* ============= Stat strip ============= */
.stat-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
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
.stat-icon.tone-info { background: rgba(99,102,241,0.12); color: #6366f1; }
.stat-icon.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.stat-icon.tone-danger { background: rgba(239,68,68,0.14); color: #b91c1c; }
.stat-icon.tone-cash { background: rgba(6,182,212,0.14); color: #0e7490; }
.stat-label {
  font-size: 0.7rem; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ct-secondary-color, #64748b);
}
.stat-value {
  font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800;
  letter-spacing: -0.02em; font-size: 1rem;
  color: var(--ct-body-color, #0f172a);
}

/* ============= Toolbar / Empty ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(16,185,129,0.04) 0%, transparent 100%); }
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(16,185,129,0.12); color: #10b981; font-size: 1.6rem;
}

/* ============= Movements table ============= */
.data-card { overflow: hidden; }
.data-scroll {
  /* Hero (~140) + stat strip (~92) + toolbar (~96) + chrome */
  max-height: calc(100vh - 440px);
  min-height: 220px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }
.data-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.5); }

.mov-table thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}

.when-date { font-weight: 700; font-size: 0.82rem; color: var(--ct-body-color, #0f172a); line-height: 1.2; }
.when-time { font-size: 0.72rem; color: var(--ct-secondary-color, #64748b); font-family: "JetBrains Mono", ui-monospace, monospace; }

.move-chip {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.2rem 0.55rem;
  border-radius: 6px;
  font-size: 0.7rem; font-weight: 700;
  letter-spacing: 0.04em; text-transform: uppercase;
}
.move-chip i { font-size: 0.85rem; }
.move-in { background: rgba(16,185,129,0.14); color: #047857; }
.move-out { background: rgba(239,68,68,0.14); color: #b91c1c; }
.move-drop { background: rgba(6,182,212,0.14); color: #0e7490; }
.move-warn { background: rgba(245,158,11,0.18); color: #b45309; }
.move-default { background: rgba(100,116,139,0.14); color: #475569; }

.amount-mono {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700; font-size: 0.85rem;
  color: var(--ct-body-color, #0f172a);
}

.outlet-chip {
  display: inline-flex; align-items: center;
  font-size: 0.78rem; font-weight: 600;
  padding: 0.2rem 0.55rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 8px;
  color: var(--ct-secondary-color, #475569);
}
.shift-chip {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.78rem; font-weight: 700;
  padding: 0.2rem 0.5rem; border-radius: 6px;
  background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1);
  border: 1px solid rgba(99,102,241,0.2);
}

.footnote { border-top: 1px dashed var(--ct-border-color, #e6e9ef); }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
