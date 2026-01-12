<!-- src/views/cash/CashShifts.vue -->
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
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

async function loadAll() {
  loading.value = true;
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

    if (!payload.cash_drawer_id) {
      toast.error("Select a drawer");
      return;
    }

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

    await loadAll();
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

    if (!payload.amount || payload.amount <= 0) {
      toast.error("Amount must be greater than 0");
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
    <!-- Header -->
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Cash Shifts</h4>
        <div class="text-muted small">Open/close shifts and record paid-in / paid-out movements</div>
      </div>

      <div class="d-flex gap-2 align-items-center">
        <span class="text-muted small">Outlet:</span>
        <input v-model="outletId" class="form-control" style="width: 140px" disabled />
        <button class="btn btn-outline-primary" :disabled="loading" @click="loadAll">
          <i class="ri-refresh-line me-1"></i> Refresh
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card shift-card" style="zoom: 80%;">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading shifts...</div>
      </div>
    </div>

    <div v-else class="row g-3" style="zoom: 80%;">
      <!-- LEFT: Current / Open / Close -->
      <div class="col-lg-4">
        <div class="card shift-card position-relative">
          <div class="card-header bg-transparent d-flex align-items-start justify-content-between">
            <div>
              <div class="shift-title">Current Shift</div>
              <div class="text-muted small">
                {{ hasOpenShift ? "Shift is currently open for this outlet." : "No open shift for this outlet." }}
              </div>
            </div>

            <div class="shift-pill" :class="hasOpenShift ? 'on' : 'off'">
              <i :class="hasOpenShift ? 'ri-lock-unlock-line' : 'ri-lock-line'"></i>
              <span>{{ hasOpenShift ? "OPEN" : "CLOSED" }}</span>
            </div>
          </div>

          <div class="card-body">
            <!-- Shift summary -->
            <div v-if="cur" class="summary-box mb-3">
              <div class="row g-2">
                <div class="col-12">
                  <div class="d-flex justify-content-between align-items-center">
                    <div class="fw-semibold text-muted small">Drawer</div>
                    <div class="fw-semibold">{{ cur.cash_drawer?.name || "-" }}</div>
                  </div>
                </div>

                <div class="col-6">
                  <div class="text-muted small">Opened</div>
                  <div class="fw-semibold">{{ fmtDate(cur.opened_at) }}</div>
                </div>

                <div class="col-6">
                  <div class="text-muted small">Opening Float</div>
                  <div class="fw-semibold">{{ fmtMoney(cur.opening_float) }}</div>
                </div>

                <div class="col-6">
                  <div class="text-muted small">Expected Cash</div>
                  <div class="fw-semibold">{{ fmtMoney(cur.expected_cash) }}</div>
                </div>

                <div class="col-6">
                  <div class="text-muted small">Drawer ID</div>
                  <div class="fw-semibold">{{ cur.cash_drawer_id }}</div>
                </div>
              </div>
            </div>

            <div v-else class="alert alert-info mb-3">
              No open shift for this outlet.
            </div>

            <!-- OPEN SHIFT -->
            <div v-if="!cur" class="section">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <h6 class="mb-0">Open Shift</h6>
              </div>

              <div class="row g-2">
                <div class="col-12">
                  <label class="form-label">Drawer *</label>
                  <select v-model="openShiftState.cash_drawer_id" class="form-select">
                    <option value="">-- select drawer --</option>
                    <option v-for="d in drawers" :key="d.id" :value="d.id">
                      {{ d.name }} (ID {{ d.id }})
                    </option>
                  </select>
                </div>

                <div class="col-6">
                  <label class="form-label">Opening Float</label>
                  <input v-model="openShiftState.opening_float" type="number" step="0.01" class="form-control" />
                </div>

                <div class="col-12">
                  <label class="form-label">Notes</label>
                  <textarea v-model="openShiftState.notes" class="form-control" rows="2" placeholder="Optional..."></textarea>
                </div>
              </div>

              <button class="btn btn-primary mt-3" :disabled="saving || !hasOutlet" @click="doOpenShift">
                <i class="ri-play-line me-1"></i> Open Shift
              </button>
            </div>

            <!-- CLOSE SHIFT -->
            <div v-else class="section">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <h6 class="mb-0">Close Shift</h6>
              </div>

              <div class="row g-2">
                <div class="col-6">
                  <label class="form-label">Closing Cash *</label>
                  <input v-model="closeShiftState.closing_cash" type="number" step="0.01" class="form-control" />
                </div>

                <div class="col-12">
                  <label class="form-label">Notes</label>
                  <textarea v-model="closeShiftState.notes" class="form-control" rows="2" placeholder="Optional..."></textarea>
                </div>
              </div>

              <button class="btn btn-danger mt-3" :disabled="saving" @click="doCloseShift">
                <i class="ri-stop-line me-1"></i> Close Shift
              </button>
            </div>
          </div>

          <!-- Saving overlay -->
          <div v-if="saving" class="shift-overlay" aria-hidden="true">
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Processing…</div>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT: Movements + Recent -->
      <div class="col-lg-8">
        <!-- Movements -->
        <div class="card shift-card position-relative">
          <div class="card-header bg-transparent d-flex align-items-start justify-content-between">
            <div>
              <div class="shift-title">Cash Movements</div>
              <div class="text-muted small">Paid-in, paid-out, drops & corrections</div>
            </div>

            <div class="shift-pill soft">
              <i class="ri-exchange-dollar-line"></i>
              <span>{{ movements.length }}</span>
            </div>
          </div>

          <div class="card-body">
            <div v-if="cur" class="composer mb-3">
              <div class="row g-2 align-items-end">
                <div class="col-md-3">
                  <label class="form-label">Type</label>
                  <select v-model="movementState.movement_type" class="form-select">
                    <option value="PAID_IN">PAID IN</option>
                    <option value="PAID_OUT">PAID OUT</option>
                    <option value="DROP">DROP</option>
                    <option value="CORRECTION">CORRECTION (+/-)</option>
                  </select>
                </div>

                <div class="col-md-3">
                  <label class="form-label">Amount *</label>
                  <input v-model="movementState.amount" type="number" step="0.01" class="form-control" />
                </div>

                <div class="col-md-3">
                  <label class="form-label">Reason</label>
                  <input v-model="movementState.reason" class="form-control" placeholder="e.g. petty cash" />
                </div>

                <div class="col-md-3">
                  <button class="btn btn-primary w-100" :disabled="saving" @click="doMovement">
                    <i class="ri-add-line me-1"></i> Add
                  </button>
                </div>

                <div class="col-12">
                  <label class="form-label">Note</label>
                  <input v-model="movementState.note" class="form-control" placeholder="Optional note..." />
                </div>
              </div>
            </div>

            <div v-else class="alert alert-info">
              Open a shift to record movements.
            </div>

            <div class="table-responsive">
              <table class="table table-sm table-centered table-bordered mb-0">
                <thead class="bg-light">
                  <tr>
                    <th style="width: 170px;">Time</th>
                    <th style="width: 140px;">Type</th>
                    <th style="width: 140px;">Amount</th>
                    <th>Reason</th>
                    <th style="width: 180px;">By</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in movements" :key="m.id">
                    <td>{{ fmtDate(m.occurred_at) }}</td>
                    <td class="fw-semibold">{{ m.movement_type }}</td>
                    <td>{{ fmtMoney(m.amount) }}</td>
                    <td>{{ m.reason || "-" }}</td>
                    <td>{{ m.performed_by?.username || m.performed_by?.email || m.performed_by_user_id }}</td>
                  </tr>

                  <tr v-if="movements.length === 0">
                    <td colspan="5" class="text-center text-muted py-4">No movements.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="saving" class="shift-overlay" aria-hidden="true">
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>
        </div>

        <!-- Recent shifts -->
        <div class="card shift-card mt-3">
          <div class="card-header bg-transparent d-flex align-items-start justify-content-between">
            <div>
              <div class="shift-title">Recent Shifts</div>
              <div class="text-muted small">Last 50 shifts for this outlet</div>
            </div>

            <div class="shift-pill soft">
              <i class="ri-time-line"></i>
              <span>{{ recent.length }}</span>
            </div>
          </div>

          <div class="card-body p-0">
            <div class="table-responsive">
              <table class="table table-sm table-centered table-bordered mb-0">
                <thead class="bg-light">
                  <tr>
                    <th style="width: 170px;">Opened</th>
                    <th>Drawer</th>
                    <th style="width: 120px;">Status</th>
                    <th style="width: 120px;">Opening</th>
                    <th style="width: 120px;">Expected</th>
                    <th style="width: 120px;">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in recent" :key="s.id">
                    <td>{{ fmtDate(s.opened_at) }}</td>
                    <td>{{ s.cash_drawer?.name || "-" }}</td>
                    <td>
                      <span class="badge" :class="s.status === 'OPEN' ? 'bg-success' : 'bg-secondary'">
                        {{ s.status }}
                      </span>
                    </td>
                    <td>{{ fmtMoney(s.opening_float) }}</td>
                    <td>{{ fmtMoney(s.expected_cash) }}</td>
                    <td>{{ fmtMoney(s.closing_cash) }}</td>
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
.shift-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
}

.shift-title {
  font-weight: 900;
  color: var(--ct-emphasis-color);
  font-size: 16px;
}

/* Pills */
.shift-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-tertiary-bg);
  color: var(--ct-emphasis-color);
  box-shadow: var(--ct-box-shadow-sm);
}
.shift-pill.soft {
  background: rgba(var(--ct-primary-rgb), 0.10);
  border-color: rgba(var(--ct-primary-rgb), 0.18);
}
.shift-pill.on {
  background: rgba(var(--ct-success-rgb), 0.14);
  border-color: rgba(var(--ct-success-rgb), 0.22);
}
.shift-pill.off {
  background: rgba(var(--ct-body-color-rgb), 0.08);
  border-color: rgba(var(--ct-body-color-rgb), 0.14);
}

/* Summary box */
.summary-box {
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-light-bg-subtle);
  border-radius: 12px;
  padding: 12px;
}

/* Section divider look */
.section {
  padding-top: 12px;
  border-top: 1px dashed var(--ct-border-color);
}

/* Theme-safe table header (fix bg-light in dark) */
.table thead.bg-light th {
  background: var(--ct-tertiary-bg) !important;
  color: var(--ct-emphasis-color) !important;
}

/* Overlay */
.shift-overlay {
  position: absolute;
  inset: 0;
  background: rgba(var(--ct-body-bg-rgb), 0.72);
  backdrop-filter: blur(2px);
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
