<!-- src/views/cash/Shifts.vue -->
<script setup>
import { ref, onMounted, computed } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import {
  listCashDrawers,
  currentShift,
  openShift,
  closeShift,
  listShifts,
  listMovements,
  createMovement,
} from "../../api/cash";
import { useAuthStore } from "../../stores/auth";

const toast = useToast();
const auth = useAuthStore();

const loading = ref(true);
const refreshing = ref(false);
const saving = ref(false);

const outletId = ref(auth.me?.outlet_id || "");
const drawers = ref([]);

const openShiftState = ref({
  cash_drawer_id: "",
  opening_float: 0,
  notes: "",
});

const closeShiftState = ref({
  closing_cash: 0,
  notes: "",
});

const movementState = ref({
  movement_type: "PAID_IN",
  amount: 0,
  reason: "",
  note: "",
});

const cur = ref(null);
const movements = ref([]);
const recent = ref([]);

const hasOutlet = computed(() => !!Number(outletId.value || 0));
const hasOpenShift = computed(() => !!cur.value);

function fmtMoney(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
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

// Difference & expected/over-short
const closingDiff = computed(() => {
  if (!cur.value) return null;
  const exp = Number(cur.value.expected_cash);
  const close = Number(closeShiftState.value.closing_cash);
  if (!Number.isFinite(exp) || !Number.isFinite(close)) return null;
  return close - exp;
});

// Shift duration
const shiftDuration = computed(() => {
  if (!cur.value?.opened_at) return null;
  const start = new Date(cur.value.opened_at).getTime();
  const now = Date.now();
  const diff = Math.max(0, Math.floor((now - start) / 60000));
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
});

const movementTotals = computed(() => {
  let inflow = 0, outflow = 0, drops = 0;
  for (const m of movements.value || []) {
    const a = Number(m.amount) || 0;
    if (m.movement_type === "PAID_IN") inflow += a;
    else if (m.movement_type === "PAID_OUT") outflow += a;
    else if (m.movement_type === "DROP") drops += a;
    else if (m.movement_type === "CORRECTION") {
      if (a >= 0) inflow += a;
      else outflow += -a;
    }
  }
  return { inflow, outflow, drops, count: movements.value.length };
});

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

async function loadAll(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    if (!hasOutlet.value) {
      toast.error("Your user has no outlet_id. Assign outlet to user first.");
      return;
    }
    drawers.value = await listCashDrawers({ outlet_id: outletId.value, active: "1" });
    cur.value = await currentShift({ outlet_id: outletId.value });
    movements.value = cur.value ? await listMovements(cur.value.id) : [];
    recent.value = await listShifts({ outlet_id: outletId.value, status: "all", limit: 50 });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load shifts");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function doOpenShift() {
  saving.value = true;
  try {
    const payload = {
      outlet_id: Number(outletId.value),
      cash_drawer_id: Number(openShiftState.value.cash_drawer_id),
      opening_float: Number(openShiftState.value.opening_float || 0),
      notes: openShiftState.value.notes || null,
    };
    if (!payload.cash_drawer_id) { toast.error("Select a drawer"); return; }
    cur.value = await openShift(payload);
    toast.success("Shift opened");
    openShiftState.value = { cash_drawer_id: "", opening_float: 0, notes: "" };
    movements.value = await listMovements(cur.value.id);
    recent.value = await listShifts({ outlet_id: outletId.value, status: "all", limit: 50 });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to open shift");
  } finally {
    saving.value = false;
  }
}

async function doCloseShift() {
  if (!cur.value) return;
  if (!confirm(`Close this shift with K ${fmtMoney(closeShiftState.value.closing_cash)} counted?`)) return;

  saving.value = true;
  try {
    const payload = {
      closing_cash: Number(closeShiftState.value.closing_cash || 0),
      notes: closeShiftState.value.notes || null,
    };
    cur.value = await closeShift(cur.value.id, payload);
    toast.success("Shift closed");
    closeShiftState.value = { closing_cash: 0, notes: "" };
    movements.value = [];
    cur.value = null;
    await loadAll(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to close shift");
  } finally {
    saving.value = false;
  }
}

async function doMovement() {
  if (!cur.value) return toast.error("Open a shift first");
  saving.value = true;
  try {
    const payload = {
      movement_type: movementState.value.movement_type,
      amount: Number(movementState.value.amount || 0),
      reason: movementState.value.reason || null,
      note: movementState.value.note || null,
    };
    if (!payload.amount || payload.amount === 0) {
      toast.error("Amount must not be zero");
      return;
    }
    if (payload.movement_type !== "CORRECTION" && payload.amount < 0) {
      toast.error("Amount must be positive (use CORRECTION for negative)");
      return;
    }
    await createMovement(cur.value.id, payload);
    toast.success("Movement saved");
    movementState.value = { movement_type: "PAID_IN", amount: 0, reason: "", note: "" };
    cur.value = await currentShift({ outlet_id: outletId.value });
    movements.value = await listMovements(cur.value.id);
    recent.value = await listShifts({ outlet_id: outletId.value, status: "all", limit: 50 });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to add movement");
  } finally {
    saving.value = false;
  }
}

onMounted(loadAll);
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-time-line"></i><span>Cash</span>
          </div>
          <h1 class="hero-title">Cash Shifts</h1>
          <p class="hero-sub">
            Open a shift to start trading, record paid-in / paid-out movements, then close the till by counting actual cash.
          </p>
        </div>

        <div class="page-hero-actions">
          <div class="hero-outlet">
            <i class="ri-store-2-line"></i>
            <span class="lbl">Outlet</span>
            <span class="val">{{ outletId || '—' }}</span>
          </div>
          <button class="btn btn-light btn-pill" @click="loadAll(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading shifts…</div>
        </div>
      </div>

      <div v-else class="row g-3">
        <!-- ============== LEFT: Current shift ============== -->
        <div class="col-lg-5 col-xl-4">
          <div class="card panel-card position-relative">
            <div class="panel-head">
              <div>
                <div class="panel-eyebrow">{{ hasOpenShift ? 'Live shift' : 'Awaiting' }}</div>
                <div class="panel-title">Current Shift</div>
              </div>
              <span class="status-pill" :class="hasOpenShift ? 'pill-on' : 'pill-off'">
                <i :class="hasOpenShift ? 'ri-lock-unlock-line' : 'ri-lock-line'"></i>
                {{ hasOpenShift ? 'OPEN' : 'CLOSED' }}
              </span>
            </div>

            <div class="card-body">
              <!-- Open shift summary -->
              <div v-if="cur" class="kpi-stack mb-3">
                <div class="kpi-row">
                  <div class="kpi-label">
                    <i class="ri-inbox-line me-1"></i>Drawer
                  </div>
                  <div class="kpi-val">{{ cur.cash_drawer?.name || '—' }}</div>
                </div>
                <div class="kpi-row">
                  <div class="kpi-label">
                    <i class="ri-time-line me-1"></i>Open for
                  </div>
                  <div class="kpi-val">{{ shiftDuration || '—' }}</div>
                </div>
                <div class="kpi-row">
                  <div class="kpi-label">Opened at</div>
                  <div class="kpi-val small">{{ fmtDate(cur.opened_at) }}</div>
                </div>

                <div class="amount-grid mt-2">
                  <div class="amount-tile tone-info">
                    <div class="amount-label">Opening float</div>
                    <div class="amount-val">K {{ fmtMoney(cur.opening_float) }}</div>
                  </div>
                  <div class="amount-tile tone-primary">
                    <div class="amount-label">Expected cash</div>
                    <div class="amount-val">K {{ fmtMoney(cur.expected_cash) }}</div>
                  </div>
                </div>
              </div>

              <div v-else class="empty-inline">
                <div class="empty-inline-icon"><i class="ri-lock-line"></i></div>
                <div>
                  <div class="fw-semibold">No open shift</div>
                  <div class="small text-muted">Pick a drawer below and open one to start.</div>
                </div>
              </div>

              <!-- OPEN SHIFT FORM -->
              <div v-if="!cur" class="form-section">
                <div class="form-section-title">
                  <i class="ri-play-circle-line text-success"></i>
                  Open shift
                </div>

                <div class="row g-2">
                  <div class="col-12">
                    <label class="form-label">Drawer *</label>
                    <select v-model="openShiftState.cash_drawer_id" class="form-select">
                      <option value="">— select drawer —</option>
                      <option v-for="d in drawers" :key="d.id" :value="d.id">
                        {{ d.name }} <span>(#{{ d.id }})</span>
                      </option>
                    </select>
                  </div>

                  <div class="col-12">
                    <label class="form-label">Opening float</label>
                    <div class="input-group">
                      <span class="input-group-text">K</span>
                      <input v-model="openShiftState.opening_float" type="number" step="0.01" class="form-control" placeholder="0.00" />
                    </div>
                  </div>

                  <div class="col-12">
                    <label class="form-label">Notes</label>
                    <textarea v-model="openShiftState.notes" class="form-control" rows="2" placeholder="Optional…"></textarea>
                  </div>
                </div>

                <button class="btn btn-success w-100 mt-3" :disabled="saving || !hasOutlet" @click="doOpenShift">
                  <i class="ri-play-line me-1"></i> Open shift
                </button>
              </div>

              <!-- CLOSE SHIFT FORM -->
              <div v-else class="form-section">
                <div class="form-section-title">
                  <i class="ri-stop-circle-line text-danger"></i>
                  Close shift
                </div>

                <div class="row g-2">
                  <div class="col-12">
                    <label class="form-label">Counted closing cash *</label>
                    <div class="input-group">
                      <span class="input-group-text">K</span>
                      <input v-model="closeShiftState.closing_cash" type="number" step="0.01" class="form-control" placeholder="0.00" />
                    </div>
                  </div>

                  <div class="col-12" v-if="closingDiff !== null && closeShiftState.closing_cash !== 0">
                    <div class="diff-banner" :class="closingDiff === 0 ? 'diff-ok' : closingDiff > 0 ? 'diff-over' : 'diff-short'">
                      <i :class="closingDiff === 0 ? 'ri-check-double-line' : closingDiff > 0 ? 'ri-arrow-up-line' : 'ri-arrow-down-line'"></i>
                      <div>
                        <div class="diff-label">
                          {{ closingDiff === 0 ? 'Balanced' : closingDiff > 0 ? 'Over' : 'Short' }}
                        </div>
                        <div class="diff-amount">K {{ fmtMoney(Math.abs(closingDiff)) }}</div>
                      </div>
                    </div>
                  </div>

                  <div class="col-12">
                    <label class="form-label">Notes</label>
                    <textarea v-model="closeShiftState.notes" class="form-control" rows="2" placeholder="Optional…"></textarea>
                  </div>
                </div>

                <button class="btn btn-danger w-100 mt-3" :disabled="saving" @click="doCloseShift">
                  <i class="ri-stop-line me-1"></i> Close shift
                </button>
              </div>
            </div>

            <div v-if="saving" class="modal-overlay">
              <div class="text-center">
                <span class="spinner-border"></span>
                <div class="small text-muted mt-2">Processing…</div>
              </div>
            </div>
          </div>
        </div>

        <!-- ============== RIGHT: Movements + Recent ============== -->
        <div class="col-lg-7 col-xl-8">
          <!-- Movement totals strip -->
          <div class="stat-strip mb-3" v-if="cur">
            <div class="stat-tile">
              <div class="stat-icon tone-success"><i class="ri-arrow-down-line"></i></div>
              <div>
                <div class="stat-label">Paid in</div>
                <div class="stat-value text-success">+K {{ fmtMoney(movementTotals.inflow) }}</div>
              </div>
            </div>
            <div class="stat-tile">
              <div class="stat-icon tone-danger"><i class="ri-arrow-up-line"></i></div>
              <div>
                <div class="stat-label">Paid out</div>
                <div class="stat-value text-danger">−K {{ fmtMoney(movementTotals.outflow) }}</div>
              </div>
            </div>
            <div class="stat-tile">
              <div class="stat-icon tone-info"><i class="ri-bank-line"></i></div>
              <div>
                <div class="stat-label">Drops</div>
                <div class="stat-value">K {{ fmtMoney(movementTotals.drops) }}</div>
              </div>
            </div>
            <div class="stat-tile">
              <div class="stat-icon tone-primary"><i class="ri-list-check-2"></i></div>
              <div>
                <div class="stat-label">Movements</div>
                <div class="stat-value">{{ movementTotals.count }}</div>
              </div>
            </div>
          </div>

          <!-- Movements card -->
          <div class="card panel-card position-relative mb-3">
            <div class="panel-head">
              <div>
                <div class="panel-eyebrow">Activity</div>
                <div class="panel-title">Cash movements</div>
              </div>
              <span class="status-pill pill-soft">
                <i class="ri-exchange-dollar-line"></i> {{ movements.length }}
              </span>
            </div>

            <div class="card-body p-3">
              <div v-if="cur" class="composer">
                <div class="row g-2 align-items-end">
                  <div class="col-md-3">
                    <label class="form-label">Type</label>
                    <select v-model="movementState.movement_type" class="form-select">
                      <option value="PAID_IN">Paid in</option>
                      <option value="PAID_OUT">Paid out</option>
                      <option value="DROP">Drop</option>
                      <option value="CORRECTION">Correction (±)</option>
                    </select>
                  </div>

                  <div class="col-md-3">
                    <label class="form-label">Amount *</label>
                    <div class="input-group">
                      <span class="input-group-text">K</span>
                      <input v-model="movementState.amount" type="number" step="0.01" class="form-control" placeholder="0.00" />
                    </div>
                  </div>

                  <div class="col-md-3">
                    <label class="form-label">Reason</label>
                    <input v-model="movementState.reason" class="form-control" placeholder="Petty cash, tip, …" />
                  </div>

                  <div class="col-md-3 d-grid">
                    <button class="btn btn-primary" :disabled="saving" @click="doMovement">
                      <i class="ri-add-line me-1"></i> Add
                    </button>
                  </div>

                  <div class="col-12">
                    <input v-model="movementState.note" class="form-control" placeholder="Optional note" />
                  </div>
                </div>
              </div>

              <div v-else class="empty-inline mb-0">
                <div class="empty-inline-icon"><i class="ri-information-line"></i></div>
                <div>
                  <div class="fw-semibold">Open a shift to record movements</div>
                  <div class="small text-muted">Paid-ins and paid-outs require an active shift.</div>
                </div>
              </div>
            </div>

            <!-- Movements table -->
            <div class="data-scroll" v-if="cur">
              <table class="table align-middle mb-0 cash-table">
                <thead>
                  <tr>
                    <th style="width: 130px">When</th>
                    <th style="width: 130px">Type</th>
                    <th style="width: 120px" class="text-end">Amount</th>
                    <th>Reason</th>
                    <th style="width: 160px">By</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in movements" :key="m.id">
                    <td>
                      <div class="when-date">{{ fmtDateOnly(m.occurred_at) }}</div>
                      <div class="when-time">{{ fmtTimeShort(m.occurred_at) }}</div>
                    </td>
                    <td>
                      <span class="move-chip" :class="`move-${moveTone(m.movement_type)}`">
                        <i :class="moveIcon(m.movement_type)"></i>
                        {{ m.movement_type.replace('_', ' ') }}
                      </span>
                    </td>
                    <td class="text-end">
                      <span class="amount-mono" :class="moveTone(m.movement_type) === 'in' ? 'text-success' : moveTone(m.movement_type) === 'out' ? 'text-danger' : ''">
                        K {{ fmtMoney(m.amount) }}
                      </span>
                    </td>
                    <td>{{ m.reason || '—' }}</td>
                    <td class="small text-muted">
                      {{ m.performed_by?.username || m.performed_by?.email || `User #${m.performed_by_user_id}` }}
                    </td>
                  </tr>
                  <tr v-if="movements.length === 0">
                    <td colspan="5" class="text-center text-muted py-4">
                      <i class="ri-inbox-line d-block mb-1" style="font-size: 1.6rem;"></i>
                      No movements yet on this shift.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="saving" class="modal-overlay">
              <div class="text-center">
                <span class="spinner-border"></span>
                <div class="small text-muted mt-2">Saving…</div>
              </div>
            </div>
          </div>

          <!-- Recent shifts -->
          <div class="card panel-card">
            <div class="panel-head">
              <div>
                <div class="panel-eyebrow">History</div>
                <div class="panel-title">Recent shifts</div>
              </div>
              <span class="status-pill pill-soft">
                <i class="ri-time-line"></i> {{ recent.length }}
              </span>
            </div>

            <div class="data-scroll data-scroll-sm">
              <table class="table align-middle mb-0 cash-table">
                <thead>
                  <tr>
                    <th style="width: 140px">Opened</th>
                    <th>Drawer</th>
                    <th style="width: 110px">Status</th>
                    <th style="width: 110px" class="text-end">Opening</th>
                    <th style="width: 110px" class="text-end">Expected</th>
                    <th style="width: 110px" class="text-end">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in recent" :key="s.id">
                    <td>
                      <div class="when-date">{{ fmtDateOnly(s.opened_at) }}</div>
                      <div class="when-time">{{ fmtTimeShort(s.opened_at) }}</div>
                    </td>
                    <td>{{ s.cash_drawer?.name || '—' }}</td>
                    <td>
                      <span class="status-pill" :class="s.status === 'OPEN' ? 'pill-on' : 'pill-off'">
                        <span class="dot-mini"></span>{{ s.status }}
                      </span>
                    </td>
                    <td class="text-end amount-mono">K {{ fmtMoney(s.opening_float) }}</td>
                    <td class="text-end amount-mono">K {{ fmtMoney(s.expected_cash) }}</td>
                    <td class="text-end amount-mono">K {{ fmtMoney(s.closing_cash) }}</td>
                  </tr>
                  <tr v-if="recent.length === 0">
                    <td colspan="6" class="text-center text-muted py-4">No shifts yet.</td>
                  </tr>
                </tbody>
              </table>
            </div>
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
  color: #fff; box-shadow: 0 20px 40px -20px rgba(16, 185, 129, 0.55);
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
.page-hero-actions { position: relative; display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }

.hero-outlet {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  background: rgba(255,255,255,0.18);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
}
.hero-outlet .lbl { opacity: 0.8; }
.hero-outlet .val { font-weight: 800; font-family: "JetBrains Mono", ui-monospace, monospace; }

.btn-pill { border-radius: 999px !important; display: inline-flex; align-items: center; gap: 0.4rem; }
.page-hero-actions .btn-light { background: rgba(255,255,255,0.95); color: #0f172a; border: none; }

/* ============= Panel cards ============= */
.panel-card {
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.panel-head {
  padding: 1rem 1.25rem;
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  background: linear-gradient(180deg, rgba(16,185,129,0.04), transparent);
}
.panel-eyebrow {
  font-size: 0.68rem; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: #047857;
}
.panel-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; letter-spacing: -0.02em;
  font-size: 1.05rem;
  color: var(--ct-body-color, #0f172a);
}

/* ============= KPI rows / amounts ============= */
.kpi-stack {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-tertiary-bg, #f8fafc);
  border-radius: 12px;
  padding: 0.75rem;
}
.kpi-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.4rem 0;
}
.kpi-row + .kpi-row { border-top: 1px dashed var(--ct-border-color, #e6e9ef); }
.kpi-label { font-size: 0.78rem; color: var(--ct-secondary-color, #475569); font-weight: 600; }
.kpi-val { font-weight: 700; color: var(--ct-body-color, #0f172a); }

.amount-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;
}
.amount-tile {
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  border: 1px solid;
}
.amount-tile.tone-info { background: rgba(6,182,212,0.08); border-color: rgba(6,182,212,0.2); }
.amount-tile.tone-primary { background: rgba(99,102,241,0.08); border-color: rgba(99,102,241,0.2); }
.amount-label {
  font-size: 0.68rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--ct-secondary-color, #64748b);
}
.amount-val {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--ct-body-color, #0f172a);
  margin-top: 0.15rem;
}

/* Inline empty card */
.empty-inline {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.85rem 1rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  margin-bottom: 1rem;
}
.empty-inline-icon {
  width: 38px; height: 38px;
  border-radius: 10px;
  display: grid; place-items: center;
  background: rgba(99,102,241,0.1);
  color: var(--ct-primary, #6366f1);
  font-size: 1.1rem;
}

/* ============= Form sections ============= */
.form-section { padding-top: 0.5rem; }
.form-section-title {
  display: flex; align-items: center; gap: 0.4rem;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 700; font-size: 0.95rem;
  margin-bottom: 0.6rem;
  color: var(--ct-body-color, #0f172a);
}

/* Diff banner */
.diff-banner {
  display: flex; align-items: center; gap: 0.65rem;
  padding: 0.65rem 0.85rem;
  border-radius: 10px;
  border: 1px solid;
}
.diff-banner i { font-size: 1.4rem; }
.diff-label { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; }
.diff-amount {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 1.05rem;
  letter-spacing: -0.02em;
}
.diff-ok { background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.3); color: #047857; }
.diff-over { background: rgba(6,182,212,0.1); border-color: rgba(6,182,212,0.3); color: #0e7490; }
.diff-short { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.3); color: #b91c1c; }

/* ============= Status pills ============= */
.status-pill {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  font-size: 0.72rem; font-weight: 700;
  letter-spacing: 0.04em;
}
.dot-mini { width: 6px; height: 6px; border-radius: 50%; }
.pill-on { background: rgba(16,185,129,0.14); color: #047857; }
.pill-on .dot-mini { background: #10b981; }
.pill-off { background: rgba(100,116,139,0.14); color: #64748b; }
.pill-off .dot-mini { background: #94a3b8; }
.pill-soft { background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); }

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
.stat-icon.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.stat-icon.tone-danger { background: rgba(239,68,68,0.14); color: #b91c1c; }
.stat-icon.tone-info { background: rgba(6,182,212,0.14); color: #0e7490; }
.stat-icon.tone-primary { background: rgba(99,102,241,0.12); color: #4f46e5; }
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

/* ============= Composer ============= */
.composer {
  padding: 1rem;
  border: 1px dashed rgba(99,102,241,0.3);
  border-radius: 12px;
  background: rgba(99,102,241,0.04);
}

/* ============= Cash table ============= */
.data-scroll {
  max-height: 360px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll-sm { max-height: 320px; }
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.cash-table thead th {
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
}

/* Overlay */
.modal-overlay {
  position: absolute; inset: 0; z-index: 5;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
}

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
  .amount-grid { grid-template-columns: 1fr; }
}
</style>
