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

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || "https://restaurant.kipdesky.com";
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

const note = ref("");

const payModalEl = ref(null);
let payModalInstance = null;

const pay = ref({
  method: "CASH",
  cash_drawer_id: null,
  shift_id: null,
  note: "",
});
const shiftLoading = ref(false);

const outletNameById = computed(() => {
  const m = new Map();
  for (const o of outlets.value || []) m.set(Number(o.id), o.name ?? `Outlet #${o.id}`);
  return m;
});
const outletLabel = (outletId) => outletNameById.value.get(Number(outletId)) || (outletId ? `Outlet #${outletId}` : "—");

const drawerOptions = computed(() =>
  (drawers.value || []).map((d) => ({
    label: `${d.name} ${d.is_active ? '' : '(Inactive)'}`,
    value: d.id,
  }))
);

const isDraft = computed(() => expense.value?.status === "DRAFT");
const isApproved = computed(() => expense.value?.status === "APPROVED");
const isPosted = computed(() => expense.value?.status === "POSTED");
const isCancelled = computed(() => expense.value?.status === "CANCELLED");
const isPaid = computed(() => !!expense.value?.paid_method);

const fmtMoney = (v) => {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function statusTone(s) {
  const u = String(s || "").toUpperCase();
  if (u === "DRAFT") return "default";
  if (u === "APPROVED") return "info";
  if (u === "POSTED") return "success";
  if (u === "CANCELLED") return "danger";
  return "default";
}

const CATEGORY_STYLE = {
  GENERAL:     { color: "#6366f1", icon: "ri-folder-line" },
  UTILITIES:   { color: "#06b6d4", icon: "ri-flashlight-line" },
  RENT:        { color: "#8b5cf6", icon: "ri-home-2-line" },
  SUPPLIES:    { color: "#10b981", icon: "ri-shopping-bag-3-line" },
  MAINTENANCE: { color: "#f59e0b", icon: "ri-tools-line" },
  TRANSPORT:   { color: "#0ea5e9", icon: "ri-truck-line" },
  SALARIES:    { color: "#ec4899", icon: "ri-user-3-line" },
  MARKETING:   { color: "#f43f5e", icon: "ri-megaphone-line" },
  OTHER:       { color: "#64748b", icon: "ri-more-2-line" },
};
function categoryStyle(cat) {
  return CATEGORY_STYLE[cat] || { color: "#64748b", icon: "ri-folder-line" };
}

// File-type helpers for attachment cards
function fileIcon(ct) {
  const t = String(ct || "").toLowerCase();
  if (t.includes("pdf")) return { icon: "ri-file-pdf-line", color: "#ef4444" };
  if (t.includes("image")) return { icon: "ri-image-line", color: "#10b981" };
  return { icon: "ri-file-line", color: "#64748b" };
}
function fmtSize(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

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
  try { outlets.value = await listOutlets(); } catch { outlets.value = []; }
}

async function loadDrawersForOutlet(outletId) {
  try {
    drawers.value = await listCashDrawers({ outlet_id: outletId, active: "1" });
  } catch { drawers.value = []; }
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
    toast.success("Expense approved");
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
    toast.success("Expense posted");
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

function closePayModal() { payModalInstance?.hide(); }

async function findCurrentShift() {
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
    toast.error("Pick a drawer and load its current open shift first");
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
  ev.target.value = "";
  if (!file) return;

  const max = 10 * 1024 * 1024;
  if (file.size > max) { toast.error("File too large (max 10MB)"); return; }

  const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
  if (!allowed.includes(file.type)) {
    toast.error("Invalid file type (pdf/png/jpg/webp only)");
    return;
  }

  attachBusy.value = true;
  try {
    await uploadExpenseAttachment(id.value, file);
    toast.success("Receipt uploaded");
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
    toast.success("Attachment deleted");
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
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow" v-if="expense">
            <i class="ri-bill-line"></i>
            <span>Expense · {{ expense.expense_no }}</span>
          </div>
          <div class="eyebrow" v-else>
            <i class="ri-bill-line"></i><span>Expense</span>
          </div>
          <h1 class="hero-title" v-if="expense">{{ expense.title }}</h1>
          <h1 class="hero-title" v-else>Loading…</h1>
          <p class="hero-sub" v-if="expense">
            <i class="ri-store-2-line me-1"></i>{{ outletLabel(expense.outlet_id) }}
            <span class="mx-2">·</span>
            <i class="ri-calendar-line me-1"></i>{{ fmtDate(expense.expense_date) }}
            <span class="mx-2" v-if="expense.vendor_name">·</span>
            <i class="ri-store-3-line me-1" v-if="expense.vendor_name"></i>{{ expense.vendor_name }}
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="$router.push({ name: 'expenses' })">
            <i class="ri-arrow-left-line"></i><span>All expenses</span>
          </button>
          <span v-if="expense" class="status-pill-hero" :class="`tone-${statusTone(expense.status)}`">
            <span class="dot-mini"></span>{{ expense.status }}
          </span>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading expense…</div>
        </div>
      </div>

      <div v-else class="row g-3">
        <!-- ============== LEFT: Summary + actions ============== -->
        <div class="col-lg-7">
          <!-- Amounts card -->
          <div class="card panel-card mb-3">
            <div class="panel-head">
              <div>
                <div class="panel-eyebrow">Amounts</div>
                <div class="panel-title">Breakdown</div>
              </div>
              <span class="cat-chip" :style="{ '--accent': categoryStyle(expense.category).color }">
                <i :class="categoryStyle(expense.category).icon"></i>
                {{ expense.category }}
              </span>
            </div>

            <div class="card-body">
              <div class="amount-grid">
                <div class="amount-tile tone-info">
                  <div class="amount-label">Subtotal</div>
                  <div class="amount-val">K {{ fmtMoney(expense.subtotal) }}</div>
                </div>
                <div class="amount-op">+</div>
                <div class="amount-tile tone-amber">
                  <div class="amount-label">Tax</div>
                  <div class="amount-val">K {{ fmtMoney(expense.tax_total) }}</div>
                </div>
                <div class="amount-op">=</div>
                <div class="amount-tile tone-rose total-tile">
                  <div class="amount-label">Total</div>
                  <div class="amount-val">K {{ fmtMoney(expense.total_amount) }}</div>
                </div>
              </div>

              <div class="meta-grid mt-3">
                <div class="meta-row">
                  <div class="meta-label"><i class="ri-hashtag me-1"></i>Reference</div>
                  <div class="meta-val">{{ expense.reference_no || '—' }}</div>
                </div>
                <div class="meta-row">
                  <div class="meta-label"><i class="ri-store-3-line me-1"></i>Vendor</div>
                  <div class="meta-val">{{ expense.vendor_name || '—' }}</div>
                </div>
              </div>

              <div v-if="expense.notes" class="notes-card mt-3">
                <div class="notes-label">Notes</div>
                <div class="notes-body">{{ expense.notes }}</div>
              </div>
            </div>
          </div>

          <!-- Workflow card -->
          <div class="card panel-card position-relative">
            <div class="panel-head">
              <div>
                <div class="panel-eyebrow">Workflow</div>
                <div class="panel-title">Approval &amp; payment</div>
              </div>
            </div>

            <div class="card-body">
              <!-- Status timeline -->
              <div class="timeline mb-3">
                <div class="ti-step" :class="{ done: !isCancelled, current: isDraft }">
                  <div class="ti-icon"><i class="ri-edit-line"></i></div>
                  <div class="ti-label">Draft</div>
                </div>
                <div class="ti-bar" :class="{ done: isApproved || isPosted }"></div>
                <div class="ti-step" :class="{ done: isApproved || isPosted, current: isApproved }">
                  <div class="ti-icon"><i class="ri-check-line"></i></div>
                  <div class="ti-label">Approved</div>
                </div>
                <div class="ti-bar" :class="{ done: isPosted }"></div>
                <div class="ti-step" :class="{ done: isPosted, current: isPosted && !isPaid }">
                  <div class="ti-icon"><i class="ri-send-plane-line"></i></div>
                  <div class="ti-label">Posted</div>
                </div>
                <div class="ti-bar" :class="{ done: isPaid }"></div>
                <div class="ti-step" :class="{ done: isPaid, current: isPaid }">
                  <div class="ti-icon"><i class="ri-wallet-3-line"></i></div>
                  <div class="ti-label">Paid</div>
                </div>
              </div>

              <!-- Action note -->
              <label class="form-label">Action note <span class="text-muted small">(optional)</span></label>
              <input v-model="note" class="form-control mb-3" placeholder="e.g. Verified receipt against quote" />

              <div class="d-flex flex-wrap gap-2">
                <button v-can="'expense:approve'" class="btn btn-soft-info" :disabled="working || !isDraft" @click="approve">
                  <i class="ri-check-line me-1"></i> Approve
                </button>
                <button v-can="'expense:approve'" class="btn btn-soft-success" :disabled="working || !isApproved" @click="postNow">
                  <i class="ri-send-plane-line me-1"></i> Post
                </button>
                <button v-can="'expense:manage'" class="btn btn-soft-warning" :disabled="working || !(isApproved || isPosted) || isPaid" @click="openPay">
                  <i class="ri-wallet-3-line me-1"></i> Pay cash
                </button>
              </div>

              <!-- Paid pill -->
              <div v-if="isPaid" class="paid-banner mt-3">
                <div class="paid-icon"><i class="ri-check-double-line"></i></div>
                <div class="flex-grow-1">
                  <div class="paid-label">Paid via {{ expense.paid_method }}</div>
                  <div class="paid-meta">
                    {{ fmtDateTime(expense.paid_at) }}
                    <span v-if="expense.cash_movement_id"> · CashMovement #{{ expense.cash_movement_id }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="working" class="modal-overlay">
              <div class="text-center">
                <span class="spinner-border"></span>
                <div class="small text-muted mt-2">Working…</div>
              </div>
            </div>
          </div>
        </div>

        <!-- ============== RIGHT: Attachments ============== -->
        <div class="col-lg-5">
          <div class="card panel-card">
            <div class="panel-head">
              <div>
                <div class="panel-eyebrow">Receipts</div>
                <div class="panel-title">Attachments</div>
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="status-pill pill-soft">
                  <i class="ri-attachment-2"></i> {{ attachments.length }}
                </span>
                <button class="row-icon-btn" :disabled="attachBusy" @click="loadAttachments" title="Refresh">
                  <i class="ri-refresh-line"></i>
                </button>
              </div>
            </div>

            <div class="card-body p-3">
              <!-- Upload dropzone -->
              <label v-can="'expense:upload'" class="upload-zone" :class="{ busy: attachBusy }">
                <input
                  type="file"
                  class="d-none"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                  :disabled="attachBusy"
                  @change="onPickFile"
                />
                <div class="upload-icon"><i class="ri-upload-cloud-2-line"></i></div>
                <div class="upload-label">
                  <span v-if="attachBusy">Uploading…</span>
                  <span v-else>Click to upload receipt</span>
                </div>
                <div class="upload-sub">PDF, PNG, JPG, WebP · max 10MB</div>
              </label>

              <!-- Attachments list -->
              <div class="attach-list mt-3">
                <div v-if="attachments.length === 0" class="empty-inline">
                  <div class="empty-inline-icon"><i class="ri-file-line"></i></div>
                  <div class="small text-muted">No receipts attached yet.</div>
                </div>

                <div v-for="a in attachments" :key="a.id" class="attach-row">
                  <div class="attach-thumb" :style="{ '--accent': fileIcon(a.content_type).color }">
                    <i :class="fileIcon(a.content_type).icon"></i>
                  </div>
                  <div class="attach-meta">
                    <div class="attach-name" :title="a.original_filename">{{ a.original_filename }}</div>
                    <div class="attach-sub">
                      <span class="text-muted">{{ a.content_type }}</span>
                      <span class="mx-1">·</span>
                      <span class="amount-mono">{{ fmtSize(a.file_size) }}</span>
                    </div>
                  </div>
                  <div class="attach-actions">
                    <a
                      class="row-icon-btn"
                      :href="fileHref(a.file_url)"
                      target="_blank"
                      rel="noopener"
                      title="Open"
                    >
                      <i class="ri-external-link-line"></i>
                    </a>
                    <button
                      v-can="'expense:upload'"
                      class="row-icon-btn danger"
                      :disabled="attachBusy"
                      @click="removeAttachment(a)"
                      title="Delete"
                    >
                      <i class="ri-delete-bin-line"></i>
                    </button>
                  </div>
                </div>
              </div>

              <div class="footnote-soft mt-3">
                <i class="ri-shield-check-line me-1"></i>
                Allowed: pdf/png/jpg/webp · Max 10MB each (backend enforced)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Pay Cash Modal ============== -->
    <div class="modal fade" tabindex="-1" aria-hidden="true" ref="payModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">Cash payment</div>
              <h5 class="modal-title">Pay from shift</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="working"></button>
          </div>

          <div v-if="working" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Processing…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <div class="info-card mb-3">
              <i class="ri-information-line"></i>
              <div class="small">
                Records a <strong>PAID_OUT</strong> cash movement on the selected shift, linked to this expense.
              </div>
            </div>

            <div class="mb-3">
              <label class="form-label">Cash drawer *</label>
              <SearchSelect
                v-model="pay.cash_drawer_id"
                :options="drawerOptions"
                placeholder="Select drawer…"
                :clearable="true"
              />
            </div>

            <div class="d-flex gap-2 align-items-center mb-3">
              <button
                class="btn btn-soft-primary"
                :disabled="shiftLoading || !pay.cash_drawer_id"
                @click="findCurrentShift"
              >
                <i class="ri-search-line me-1"></i>
                {{ shiftLoading ? "Looking…" : "Load current shift" }}
              </button>

              <span class="ms-auto small">
                Shift: <span class="shift-chip">{{ pay.shift_id ? `#${pay.shift_id}` : '—' }}</span>
              </span>
            </div>

            <label class="form-label">Note <span class="text-muted small">(optional)</span></label>
            <input v-model="pay.note" class="form-control" placeholder="e.g. Paid from main till" />
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="working">Cancel</button>
            <button class="btn btn-warning" :disabled="working || !pay.shift_id" @click="payCash">
              <i class="ri-wallet-3-line me-1"></i>
              {{ working ? "Processing…" : "Pay cash" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
/* ============= Hero ============= */
.page-hero {
  position: relative;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem;
  padding: 1.5rem 1.75rem; margin-bottom: 1.25rem;
  border-radius: 22px;
  background: linear-gradient(135deg, #f59e0b 0%, #f43f5e 55%, #ec4899 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(244, 63, 94, 0.55);
  overflow: hidden; flex-wrap: wrap;
}
.page-hero::before {
  content: ""; position: absolute; inset: 0;
  background:
    radial-gradient(220px 140px at 90% 10%, rgba(255,255,255,0.22), transparent 65%),
    radial-gradient(280px 180px at 0% 110%, rgba(255,255,255,0.14), transparent 65%);
  pointer-events: none;
}
.page-hero-text { position: relative; max-width: 700px; }
.eyebrow {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.25rem 0.65rem;
  background: rgba(255,255,255,0.18);
  border-radius: 999px;
  font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  margin-bottom: 0.6rem;
}
.hero-title { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.025em; font-size: 1.85rem; margin: 0; color: #fff; }
.hero-sub { color: rgba(255,255,255,0.85); margin: 0.45rem 0 0; font-size: 0.9rem; }
.page-hero-actions { position: relative; display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
.btn-pill { border-radius: 999px !important; display: inline-flex; align-items: center; gap: 0.4rem; }
.page-hero-actions .btn-light { background: rgba(255,255,255,0.95); color: #0f172a; border: none; }

.status-pill-hero {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  background: rgba(255,255,255,0.95);
  font-size: 0.78rem; font-weight: 800; letter-spacing: 0.04em;
}
.dot-mini { width: 7px; height: 7px; border-radius: 50%; }

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
  background: linear-gradient(180deg, rgba(244,63,94,0.04), transparent);
}
.panel-eyebrow {
  font-size: 0.68rem; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: #be123c;
}
.panel-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; letter-spacing: -0.02em;
  font-size: 1.05rem;
  color: var(--ct-body-color, #0f172a);
}

/* ============= Amount grid ============= */
.amount-grid {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1.4fr;
  gap: 0.5rem;
  align-items: stretch;
}
.amount-tile {
  padding: 0.85rem 0.95rem;
  border-radius: 12px;
  border: 1px solid;
  display: flex; flex-direction: column; justify-content: center;
}
.amount-tile.tone-info { background: rgba(6,182,212,0.08); border-color: rgba(6,182,212,0.25); }
.amount-tile.tone-amber { background: rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.25); }
.amount-tile.tone-rose { background: rgba(244,63,94,0.1); border-color: rgba(244,63,94,0.28); }
.total-tile .amount-val { font-size: 1.4rem; }
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
  font-size: 1.15rem;
}
.amount-op {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 1.6rem;
  color: var(--ct-secondary-color, #94a3b8);
  display: grid; place-items: center;
}

@media (max-width: 767.98px) {
  .amount-grid { grid-template-columns: 1fr; }
  .amount-op { display: none; }
}

/* ============= Meta + notes ============= */
.meta-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;
}
.meta-row {
  padding: 0.6rem 0.85rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
}
.meta-label { font-size: 0.7rem; font-weight: 700; color: var(--ct-secondary-color, #64748b); text-transform: uppercase; letter-spacing: 0.06em; }
.meta-val { font-weight: 700; color: var(--ct-body-color, #0f172a); margin-top: 0.15rem; }

@media (max-width: 575.98px) {
  .meta-grid { grid-template-columns: 1fr; }
}

.notes-card {
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  padding: 0.85rem 1rem;
  background: var(--ct-tertiary-bg, #f8fafc);
}
.notes-label {
  font-size: 0.7rem; font-weight: 700;
  color: var(--ct-secondary-color, #64748b);
  letter-spacing: 0.06em; text-transform: uppercase;
  margin-bottom: 0.35rem;
}
.notes-body { white-space: pre-wrap; color: var(--ct-body-color, #0f172a); font-size: 0.88rem; }

/* ============= Category chip ============= */
.cat-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  font-size: 0.72rem; font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 22%, transparent);
}
.cat-chip i { font-size: 0.85rem; }

/* ============= Status pills ============= */
.status-pill {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em;
}
.tone-default { background: rgba(100,116,139,0.14); color: #475569; }
.tone-default .dot-mini { background: #94a3b8; }
.tone-info { background: rgba(6,182,212,0.14); color: #0e7490; }
.tone-info .dot-mini { background: #06b6d4; }
.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.tone-success .dot-mini { background: #10b981; }
.tone-danger { background: rgba(239,68,68,0.14); color: #b91c1c; }
.tone-danger .dot-mini { background: #ef4444; }
.pill-soft { background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); }

/* ============= Workflow timeline ============= */
.timeline {
  display: flex; align-items: center;
  padding: 0.5rem 0;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: thin;
}
.ti-step {
  display: flex; flex-direction: column; align-items: center;
  min-width: 78px;
}
.ti-icon {
  width: 36px; height: 36px;
  border-radius: 50%;
  display: grid; place-items: center;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 2px solid var(--ct-border-color, #e6e9ef);
  color: var(--ct-secondary-color, #94a3b8);
  font-size: 1rem;
  transition: all 0.2s ease;
}
.ti-step.done .ti-icon {
  background: rgba(16,185,129,0.14);
  border-color: rgba(16,185,129,0.4);
  color: #047857;
}
.ti-step.current .ti-icon {
  background: #fff;
  border-color: #f43f5e;
  color: #be123c;
  box-shadow: 0 0 0 3px rgba(244,63,94,0.18);
}
.ti-label {
  margin-top: 0.35rem;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--ct-secondary-color, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.ti-step.done .ti-label, .ti-step.current .ti-label { color: var(--ct-body-color, #0f172a); }
.ti-bar {
  flex: 1;
  height: 2px;
  background: var(--ct-border-color, #e6e9ef);
  min-width: 24px;
  margin-bottom: 1.4rem;
}
.ti-bar.done { background: rgba(16,185,129,0.4); }

/* Paid banner */
.paid-banner {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.85rem 1rem;
  background: rgba(16,185,129,0.08);
  border: 1px solid rgba(16,185,129,0.25);
  border-radius: 12px;
}
.paid-icon {
  width: 38px; height: 38px;
  border-radius: 10px;
  display: grid; place-items: center;
  background: rgba(16,185,129,0.18);
  color: #047857;
  font-size: 1.2rem;
}
.paid-label { font-weight: 800; color: #047857; }
.paid-meta { font-size: 0.78rem; color: var(--ct-secondary-color, #475569); }

/* ============= Attachments ============= */
.upload-zone {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 1.5rem 1rem;
  border: 2px dashed rgba(244,63,94,0.3);
  border-radius: 14px;
  background: rgba(244,63,94,0.04);
  cursor: pointer;
  text-align: center;
  transition: all 0.15s ease;
}
.upload-zone:hover {
  border-color: rgba(244,63,94,0.6);
  background: rgba(244,63,94,0.08);
  transform: translateY(-1px);
}
.upload-zone.busy { opacity: 0.7; cursor: wait; }
.upload-icon {
  width: 48px; height: 48px;
  border-radius: 12px;
  display: grid; place-items: center;
  background: rgba(244,63,94,0.12);
  color: #be123c;
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}
.upload-label {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 700; font-size: 0.95rem;
  color: var(--ct-body-color, #0f172a);
}
.upload-sub { font-size: 0.75rem; color: var(--ct-secondary-color, #64748b); margin-top: 0.25rem; }

.attach-list {
  max-height: 360px;
  overflow-y: auto;
  scrollbar-width: thin;
  display: flex; flex-direction: column; gap: 0.5rem;
}
.attach-list::-webkit-scrollbar { width: 8px; }
.attach-list::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.attach-row {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  background: var(--ct-card-bg, #fff);
  transition: border-color 0.15s ease, transform 0.12s ease;
}
.attach-row:hover {
  border-color: color-mix(in srgb, var(--ct-primary, #6366f1) 35%, transparent);
  transform: translateY(-1px);
}
.attach-thumb {
  width: 40px; height: 40px;
  border-radius: 10px;
  display: grid; place-items: center;
  font-size: 1.1rem;
  color: var(--accent, #64748b);
  background: color-mix(in srgb, var(--accent, #64748b) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #64748b) 28%, transparent);
  flex-shrink: 0;
}
.attach-meta { min-width: 0; flex: 1; }
.attach-name {
  font-weight: 700;
  color: var(--ct-body-color, #0f172a);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-size: 0.88rem;
}
.attach-sub { font-size: 0.72rem; }
.attach-actions { display: flex; gap: 0.25rem; flex-shrink: 0; }

.empty-inline {
  display: flex; align-items: center; gap: 0.65rem;
  padding: 0.75rem 1rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
}
.empty-inline-icon {
  width: 32px; height: 32px;
  border-radius: 8px;
  display: grid; place-items: center;
  background: rgba(99,102,241,0.1);
  color: var(--ct-primary, #6366f1);
}

.row-icon-btn {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
  text-decoration: none;
}
.row-icon-btn:hover { background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); }
.row-icon-btn.danger:hover { background: rgba(239,68,68,0.1); color: #ef4444; }

.amount-mono {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 600;
}

.footnote-soft {
  font-size: 0.72rem;
  color: var(--ct-secondary-color, #94a3b8);
  padding-top: 0.5rem;
  border-top: 1px dashed var(--ct-border-color, #e6e9ef);
}

/* ============= Modal ============= */
:deep(.modal-modern) {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 22px !important;
  overflow: hidden;
  box-shadow: 0 30px 60px -20px rgba(15,23,42,0.35);
  background: var(--ct-card-bg, #fff);
}
:deep(.modal-header-modern) {
  padding: 1.25rem 1.5rem 1rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  display: flex; justify-content: space-between; align-items: flex-start;
}
:deep(.modal-eyebrow) {
  font-size: 0.68rem; font-weight: 700; color: #be123c;
  letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.25rem;
}
:deep(.modal-header-modern .modal-title) {
  font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800;
  letter-spacing: -0.02em; font-size: 1.25rem;
}
:deep(.modal-body-modern) {
  padding: 1.5rem;
  max-height: calc(100vh - 240px);
  overflow-y: auto;
  scrollbar-width: thin;
}

.modal-overlay {
  position: absolute; inset: 0; z-index: 5;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
}

.info-card {
  display: flex; align-items: flex-start; gap: 0.65rem;
  padding: 0.85rem 1rem;
  background: rgba(99,102,241,0.06);
  border: 1px solid rgba(99,102,241,0.18);
  border-radius: 12px;
  color: var(--ct-body-color, #0f172a);
}
.info-card i { font-size: 1.25rem; color: var(--ct-primary, #6366f1); flex-shrink: 0; }

.shift-chip {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.78rem; font-weight: 700;
  padding: 0.2rem 0.5rem; border-radius: 6px;
  background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1);
  border: 1px solid rgba(99,102,241,0.2);
}

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
