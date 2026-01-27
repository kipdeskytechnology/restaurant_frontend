<!-- src/views/expenses/ExpenseView.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useToast } from "vue-toastification";

import DefaultLayout from "../../layouts/DefaultLayout.vue";
import SearchSelect from "../../components/SearchSelect.vue";

import { listOutlets } from "../../api/systemOutlets";
import { listCashDrawers, getCurrentShift } from "../../api/cash";
import {
  getExpense,
  approveExpense,
  postExpense,
  payExpense,
  listExpenseAttachments,
  uploadExpenseAttachment,
  deleteExpenseAttachment,
} from "../../api/expenses";

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || "http://localhost:8001";
const fileHref = (u) => (u?.startsWith("http") ? u : `${API_ORIGIN}${u}`);

const route = useRoute();
const router = useRouter();
const toast = useToast();

const id = computed(() => Number(route.params.id));

const loading = ref(true);
const working = ref(false);

const expense = ref(null);
const outlets = ref([]);
const drawers = ref([]);

const attachments = ref([]);
const attachBusy = ref(false);

// approve/post note
const note = ref("");

// pay (cash) controls
const payModalEl = ref(null);
let payModalInstance = null;

const pay = ref({
  method: "CASH",
  cash_drawer_id: null,
  shift_id: null,
  note: "",
});

const shiftLoading = ref(false);

const outletOptions = computed(() =>
  (outlets.value || []).map((o) => ({ label: o.name ?? `Outlet #${o.id}`, value: o.id }))
);
const drawerOptions = computed(() =>
  (drawers.value || []).map((d) => ({
    label: `${d.name} (${d.is_active ? "Active" : "Inactive"})`,
    value: d.id,
  }))
);

const outletNameById = computed(() => {
  const m = new Map();
  for (const o of outlets.value || []) m.set(Number(o.id), o.name ?? `Outlet #${o.id}`);
  return m;
});
const outletLabel = (outletId) => outletNameById.value.get(Number(outletId)) || (outletId ? `Outlet #${outletId}` : "");

const isDraft = computed(() => expense.value?.status === "DRAFT");
const isApproved = computed(() => expense.value?.status === "APPROVED");
const isPosted = computed(() => expense.value?.status === "POSTED");

const fmtMoney = (v) => {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

async function ensurePayModal() {
  if (payModalInstance) return;
  try {
    const m = await import("bootstrap/js/dist/modal");
    payModalInstance = new m.default(payModalEl.value, { backdrop: "static", keyboard: false });
  } catch {
    payModalInstance = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(payModalEl.value, { backdrop: "static", keyboard: false })
      : null;
  }
}

async function loadOutlets() {
  try {
    outlets.value = await listOutlets();
  } catch (e) {
    outlets.value = [];
  }
}

async function loadDrawersForOutlet(outletId) {
  try {
    drawers.value = await listCashDrawers({ outlet_id: outletId, active: "1" });
  } catch {
    drawers.value = [];
  }
}

async function loadExpense() {
  loading.value = true;
  try {
    expense.value = await getExpense(id.value);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load expense");
    router.push({ name: "expenses" });
  } finally {
    loading.value = false;
  }
}

async function loadAttachments() {
  try {
    attachments.value = await listExpenseAttachments(id.value);
  } catch (e) {
    attachments.value = [];
    toast.error(e?.response?.data?.detail || "Failed to load attachments");
  }
}

async function approve() {
  if (!confirm("Approve this expense?")) return;
  working.value = true;
  try {
    expense.value = await approveExpense(id.value, note.value ? { note: note.value } : {});
    toast.success("Approved");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to approve");
  } finally {
    working.value = false;
  }
}

async function postNow() {
  if (!confirm("Post this expense?")) return;
  working.value = true;
  try {
    expense.value = await postExpense(id.value, note.value ? { note: note.value } : {});
    toast.success("Posted");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to post");
  } finally {
    working.value = false;
  }
}

async function openPay() {
  if (!expense.value?.outlet_id) {
    toast.error("This expense has no outlet_id (required for cash payment)");
    return;
  }

  pay.value.method = "CASH";
  pay.value.cash_drawer_id = null;
  pay.value.shift_id = null;
  pay.value.note = "";

  await loadDrawersForOutlet(expense.value.outlet_id);

  await ensurePayModal();
  payModalInstance?.show();
  await nextTick();
}

function closePayModal() {
  payModalInstance?.hide();
}

async function findCurrentShift() {
  // needs outlet + drawer
  const outletId = expense.value?.outlet_id;
  const drawerId = pay.value.cash_drawer_id;
  if (!outletId || !drawerId) return;

  shiftLoading.value = true;
  try {
    const sh = await getCurrentShift(outletId, drawerId);
    pay.value.shift_id = sh?.id ?? null;

    if (!pay.value.shift_id) {
      toast.warning("No OPEN shift found for that drawer/outlet");
    }
  } catch (e) {
    pay.value.shift_id = null;
    toast.error(e?.response?.data?.detail || "Failed to find current shift");
  } finally {
    shiftLoading.value = false;
  }
}

async function payCash() {
  if (!pay.value.shift_id) {
    toast.error("shift_id is required (select drawer and load current shift)");
    return;
  }

  if (!confirm("Record CASH payment from shift (Paid Out)?")) return;

  working.value = true;
  try {
    expense.value = await payExpense(id.value, {
      method: "CASH",
      shift_id: Number(pay.value.shift_id),
      note: pay.value.note || undefined,
    });
    toast.success("Paid (cash) recorded");
    closePayModal();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to pay");
  } finally {
    working.value = false;
  }
}

async function onPickFile(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = ""; // reset input
  if (!file) return;

  // client-side guard (backend enforces too)
  const max = 10 * 1024 * 1024;
  if (file.size > max) {
    toast.error("File too large (max 10MB)");
    return;
  }

  const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
  if (!allowed.includes(file.type)) {
    toast.error("Invalid file type (pdf/png/jpg/webp only)");
    return;
  }

  attachBusy.value = true;
  try {
    await uploadExpenseAttachment(id.value, file);
    toast.success("Uploaded");
    await loadAttachments();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Upload failed");
  } finally {
    attachBusy.value = false;
  }
}

async function removeAttachment(a) {
  if (!confirm(`Delete attachment "${a.original_filename}"?`)) return;
  attachBusy.value = true;
  try {
    await deleteExpenseAttachment(a.id);
    toast.success("Deleted");
    await loadAttachments();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete attachment");
  } finally {
    attachBusy.value = false;
  }
}

onMounted(async () => {
  await loadOutlets();
  await loadExpense();
  await loadAttachments();
});
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Expense</h4>
        <div class="text-muted small">
          {{ expense?.expense_no }} • {{ outletLabel(expense?.outlet_id) }}
        </div>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-light" @click="$router.push({ name: 'expenses' })">
          <i class="ri-arrow-left-line me-1"></i> Back
        </button>
      </div>
    </div>

    <div v-if="loading" class="card" style="zoom: 80%;">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading...</div>
      </div>
    </div>

    <div v-else style="zoom: 80%;">
      <!-- Header card -->
      <div class="card exp-card mb-3">
        <div class="card-body">
          <div class="d-flex flex-wrap gap-2 align-items-start justify-content-between">
            <div>
              <div class="h5 mb-1">{{ expense.title }}</div>
              <div class="text-muted small">
                Date: <b>{{ expense.expense_date }}</b> • Category: <b>{{ expense.category }}</b>
              </div>
              <div class="text-muted small" v-if="expense.vendor_name || expense.reference_no">
                Vendor: <b>{{ expense.vendor_name || "-" }}</b> • Ref: <b>{{ expense.reference_no || "-" }}</b>
              </div>
            </div>

            <div class="text-end">
              <div>
                <span class="badge"
                  :class="expense.status === 'DRAFT' ? 'bg-secondary'
                    : expense.status === 'APPROVED' ? 'bg-info'
                    : expense.status === 'POSTED' ? 'bg-success'
                    : 'bg-dark'">
                  {{ expense.status }}
                </span>
              </div>
              <div class="mt-2 fw-semibold">
                Total: {{ fmtMoney(expense.total_amount) }}
              </div>
              <div class="text-muted small">
                Sub: {{ fmtMoney(expense.subtotal) }} • Tax: {{ fmtMoney(expense.tax_total) }}
              </div>
            </div>
          </div>

          <div v-if="expense.notes" class="mt-3">
            <div class="text-muted small mb-1">Notes</div>
            <div class="border rounded p-2 bg-light small" style="white-space: pre-wrap;">
              {{ expense.notes }}
            </div>
          </div>

          <div class="row g-2 mt-3 align-items-end">
            <div class="col-md-8">
              <label class="form-label">Action note (optional)</label>
              <input v-model="note" class="form-control" placeholder="e.g. Verified receipt" />
            </div>

            <div class="col-md-4 text-end">
              <div class="d-flex flex-wrap justify-content-end gap-2">
                <button class="btn btn-info" :disabled="working || !isDraft" @click="approve">
                  <i class="ri-check-line me-1"></i> Approve
                </button>
                <button class="btn btn-success" :disabled="working || !isApproved" @click="postNow">
                  <i class="ri-send-plane-line me-1"></i> Post
                </button>
                <button class="btn btn-warning" :disabled="working || !(isApproved || isPosted)" @click="openPay">
                  <i class="ri-wallet-3-line me-1"></i> Pay Cash
                </button>
              </div>

              <div class="text-muted small mt-2" v-if="expense.paid_method">
                Paid: <b>{{ expense.paid_method }}</b> • {{ expense.paid_at }}
                <span v-if="expense.cash_movement_id"> • CashMovement #{{ expense.cash_movement_id }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Attachments -->
      <div class="card exp-card">
        <div class="card-header bg-light d-flex align-items-center justify-content-between">
          <div class="fw-semibold">Attachments</div>
          <div class="d-flex align-items-center gap-2">
            <label class="btn btn-sm btn-primary mb-0">
              <i class="ri-upload-2-line me-1"></i>
              Upload
              <input
                type="file"
                class="d-none"
                accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                :disabled="attachBusy"
                @change="onPickFile"
              />
            </label>
            <button class="btn btn-sm btn-light" :disabled="attachBusy" @click="loadAttachments">
              <i class="ri-refresh-line"></i>
            </button>
          </div>
        </div>

        <div class="card-body">
          <div v-if="attachBusy" class="d-flex align-items-center gap-2 text-muted small mb-2">
            <div class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></div>
            Working...
          </div>

          <div v-if="attachments.length === 0" class="text-muted">No attachments.</div>

          <div v-else class="table-responsive">
            <table class="table table-sm table-bordered mb-0">
              <thead class="bg-light">
                <tr>
                  <th>File</th>
                  <th style="width: 140px;">Type</th>
                  <th class="text-end" style="width: 120px;">Size</th>
                  <th class="text-end" style="width: 240px;">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in attachments" :key="a.id">
                  <td class="fw-semibold">{{ a.original_filename }}</td>
                  <td>{{ a.content_type }}</td>
                  <td class="text-end">{{ (a.file_size / 1024).toFixed(0) }} KB</td>
                  <td class="text-end">
                    <a class="btn btn-sm btn-soft-primary me-1" :href="fileHref(a.file_url)" target="_blank" rel="noopener">
                      <i class="ri-external-link-line me-1"></i> Open
                    </a>
                    <button class="btn btn-sm btn-soft-danger" :disabled="attachBusy" @click="removeAttachment(a)">
                      <i class="ri-delete-bin-line me-1"></i> Delete
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div class="text-muted small mt-2">
              Allowed: pdf/png/jpg/webp • Max: 10MB (backend enforced too)
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Pay Cash Modal -->
    <div class="modal fade" tabindex="-1" role="dialog" ref="payModalEl" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content exp-modal">
          <div class="modal-header bg-light">
            <h4 class="modal-title">Pay Cash (Shift)</h4>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="working"></button>
          </div>

          <div class="modal-body">
            <div class="alert alert-light border">
              <div class="small">
                This will create a <b>CashMovement</b> as <b>PAID_OUT</b> with
                <b>reference_type=EXPENSE</b> linked to this expense.
              </div>
            </div>

            <div class="mb-2">
              <label class="form-label">Cash Drawer *</label>
              <SearchSelect
                v-model="pay.cash_drawer_id"
                :options="drawerOptions"
                placeholder="Select drawer…"
                :clearable="true"
              />
            </div>

            <div class="d-flex gap-2">
              <button
                class="btn btn-sm btn-primary"
                :disabled="shiftLoading || !pay.cash_drawer_id"
                @click="findCurrentShift"
              >
                <i class="ri-search-line me-1"></i>
                {{ shiftLoading ? "Loading..." : "Load Current Shift" }}
              </button>

              <div class="ms-auto text-muted small align-self-center">
                Shift ID: <b>{{ pay.shift_id || "-" }}</b>
              </div>
            </div>

            <div class="mt-3">
              <label class="form-label">Note (optional)</label>
              <input v-model="pay.note" class="form-control" placeholder="e.g. Paid during shift" />
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="working">Cancel</button>
            <button class="btn btn-warning" :disabled="working || !pay.shift_id" @click="payCash">
              <i class="ri-wallet-3-line me-1"></i>
              {{ working ? "Processing..." : "Pay Cash" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
.exp-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
}
.exp-modal {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
}
</style>
