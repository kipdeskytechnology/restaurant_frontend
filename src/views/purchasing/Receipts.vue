<!-- src/views/purchasing/Receipts.vue -->
<script setup>
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useRouter } from "vue-router";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import http from "../../api/http";
import SearchSelect from "../../components/SearchSelect.vue";

import {
  listReceipts,
  createReceipt,
  listPurchaseOrders,
} from "../../api/purchasing";

const toast = useToast();
const router = useRouter();

const loading = ref(true);
const refreshing = ref(false);
const saving = ref(false);

const outlets = ref([]);
const purchaseOrders = ref([]);
const rows = ref([]);

const filters = ref({
  outlet_id: "",
  po_id: "",
});

const outletNameById = computed(() => {
  const m = new Map();
  for (const o of outlets.value) m.set(o.id, o.name);
  return m;
});

const poOptionsAll = computed(() =>
  (purchaseOrders.value || []).map((po) => ({
    label: `${po.po_number} — ${po.supplier?.name || `Supplier #${po.supplier_id}`}`,
    value: Number(po.id),
  }))
);
const outletOptions = computed(() =>
  (outlets.value || []).map((o) => ({ label: o.name, value: Number(o.id) }))
);

const summary = computed(() => {
  const total = rows.value.length;
  const linked = rows.value.filter((r) => r.purchase_order_id).length;
  const direct = total - linked;
  return { total, linked, direct };
});

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

async function loadOutlets() {
  const data = await http.get("/system/outlets").then((r) => r.data);
  outlets.value = Array.isArray(data) ? data : [];
}
async function loadPOs() {
  const data = await listPurchaseOrders({ limit: 200, status: "all" });
  purchaseOrders.value = Array.isArray(data) ? data : [];
}

async function loadReceipts(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    const params = {
      limit: 200,
      outlet_id: filters.value.outlet_id ? Number(filters.value.outlet_id) : undefined,
      po_id: filters.value.po_id ? Number(filters.value.po_id) : undefined,
    };
    rows.value = await listReceipts(params);
  } catch (e) {
    toast.error(e?.response?.data?.detail || e?.message || "Failed to load receipts");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

// Create modal
const modalEl = ref(null);
let modalInstance = null;
const triedSubmit = ref(false);

const createForm = ref({
  outlet_id: null,
  purchase_order_id: null,
  note: "",
});

async function ensureModal() {
  if (modalInstance) return;
  try {
    const m = await import("bootstrap/js/dist/modal");
    modalInstance = new m.default(modalEl.value, { backdrop: "static", keyboard: false });
  } catch {
    modalInstance = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(modalEl.value, { backdrop: "static", keyboard: false })
      : null;
  }
}

async function openCreate() {
  triedSubmit.value = false;
  createForm.value = {
    outlet_id: outlets.value?.[0]?.id ? Number(outlets.value[0].id) : null,
    purchase_order_id: null,
    note: "",
  };
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

async function createNewReceipt() {
  triedSubmit.value = true;
  if (!createForm.value.outlet_id) { toast.error("Outlet is required"); return; }
  saving.value = true;
  try {
    const payload = {
      outlet_id: Number(createForm.value.outlet_id),
      purchase_order_id: createForm.value.purchase_order_id ? Number(createForm.value.purchase_order_id) : null,
      note: createForm.value.note?.trim() || null,
    };
    const created = await createReceipt(payload);
    toast.success("Receipt created");
    modalInstance?.hide();
    await loadReceipts(false);

    // Optionally jump straight to receipt view to add items
    const id = Number(created?.id);
    if (Number.isInteger(id) && id > 0) {
      router.push({ name: "receipt-view", params: { id } });
    }
  } catch (e) {
    toast.error(e?.response?.data?.detail || e?.message || "Failed to create receipt");
  } finally {
    saving.value = false;
  }
}

function openReceipt(r) {
  router.push({ name: "receipt-view", params: { id: Number(r.id) } });
}

function clearFilters() {
  filters.value = { outlet_id: "", po_id: "" };
}

let t = null;
watch(
  () => [filters.value.outlet_id, filters.value.po_id],
  () => {
    clearTimeout(t);
    t = setTimeout(() => loadReceipts(false), 200);
  }
);

onMounted(async () => {
  try {
    await Promise.all([loadOutlets(), loadPOs()]);
    await loadReceipts();
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-inbox-archive-line"></i><span>Purchasing</span>
          </div>
          <h1 class="hero-title">Purchase Receipts</h1>
          <p class="hero-sub">
            Receive goods against a PO — or post a direct receipt without one. Each receipt updates stock and average cost when posted.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="loadReceipts(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button v-can="'purchases:manage'" class="btn btn-pill btn-cta" @click="openCreate">
            <i class="ri-add-line"></i><span>New Receipt</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon tone-primary"><i class="ri-inbox-archive-line"></i></div>
          <div>
            <div class="stat-label">Receipts</div>
            <div class="stat-value">{{ summary.total }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-info"><i class="ri-link"></i></div>
          <div>
            <div class="stat-label">Linked to PO</div>
            <div class="stat-value">{{ summary.linked }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-warning"><i class="ri-shopping-bag-3-line"></i></div>
          <div>
            <div class="stat-label">Direct</div>
            <div class="stat-value">{{ summary.direct }}</div>
          </div>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-md-4">
              <label class="form-label">Outlet</label>
              <select class="form-select" v-model="filters.outlet_id">
                <option value="">All outlets</option>
                <option v-for="o in outlets" :key="o.id" :value="String(o.id)">{{ o.name }}</option>
              </select>
            </div>
            <div class="col-md-6">
              <label class="form-label">Purchase order</label>
              <select class="form-select" v-model="filters.po_id">
                <option value="">All POs</option>
                <option v-for="po in purchaseOrders" :key="po.id" :value="String(po.id)">
                  {{ po.po_number }} — {{ po.supplier?.name || `Supplier #${po.supplier_id}` }}
                </option>
              </select>
            </div>
            <div class="col-md-2 d-grid">
              <button class="btn btn-light" @click="clearFilters">
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
          <div class="text-muted">Loading receipts…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="rows.length === 0" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-inbox-archive-line"></i></div>
        <h5 class="mt-2 mb-1">No receipts found</h5>
        <p class="text-muted mb-3">Create a receipt to record stock arriving — with or without a PO.</p>
        <div>
          <button v-can="'purchases:manage'" class="btn btn-primary" @click="openCreate">
            <i class="ri-add-line me-1"></i> New receipt
          </button>
        </div>
      </div>

      <!-- ============== Receipts table ============== -->
      <div v-else class="card data-card">
        <div class="card-body p-0">
          <div class="table-responsive data-scroll">
            <table class="table align-middle mb-0 rec-table">
              <thead>
                <tr>
                  <th style="width: 100px">ID</th>
                  <th style="width: 200px">Outlet</th>
                  <th style="width: 200px">Purchase order</th>
                  <th>Note</th>
                  <th style="width: 160px">Received</th>
                  <th style="width: 80px" class="text-end"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in rows"
                  :key="r.id"
                  class="rec-row"
                  @click="openReceipt(r)"
                >
                  <td>
                    <span class="id-chip">#{{ r.id }}</span>
                  </td>
                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <div class="avatar-sm" :style="{ '--accent': colorFor(outletNameById.get(r.outlet_id)) }">
                        {{ initialsOf(outletNameById.get(r.outlet_id)) }}
                      </div>
                      <div>{{ outletNameById.get(r.outlet_id) || `Outlet #${r.outlet_id}` }}</div>
                    </div>
                  </td>
                  <td>
                    <span v-if="r.purchase_order?.po_number" class="po-chip">
                      <i class="ri-link me-1"></i>{{ r.purchase_order.po_number }}
                    </span>
                    <span v-else class="direct-chip">
                      <i class="ri-shopping-bag-3-line me-1"></i>Direct
                    </span>
                  </td>
                  <td class="text-muted truncate" :title="r.note">{{ r.note || "—" }}</td>
                  <td>
                    <div class="when-date" v-if="r.received_at">{{ fmtDate(r.received_at) }}</div>
                    <div class="when-time" v-if="r.received_at">{{ fmtTimeShort(r.received_at) }}</div>
                    <span v-else class="text-muted">—</span>
                  </td>
                  <td class="text-end" @click.stop>
                    <button class="row-icon-btn" title="Open" @click="openReceipt(r)">
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

    <!-- ============== Modal: Create Receipt ============== -->
    <div class="modal fade" id="createReceiptModal" tabindex="-1" aria-hidden="true" ref="modalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">New</div>
              <h5 class="modal-title">New receipt</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="saving"></button>
          </div>

          <div v-if="saving" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Creating…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label">Outlet *</label>
                <SearchSelect
                  v-model="createForm.outlet_id"
                  :options="outletOptions"
                  placeholder="Select outlet…"
                  :clearable="true"
                  :searchable="true"
                />
                <div v-if="triedSubmit && !createForm.outlet_id" class="text-danger small mt-1">
                  Outlet is required.
                </div>
              </div>
              <div class="col-md-6">
                <label class="form-label">Purchase order <span class="text-muted small">(optional)</span></label>
                <SearchSelect
                  v-model="createForm.purchase_order_id"
                  :options="poOptionsAll"
                  placeholder="No PO (direct receipt)…"
                  :clearable="true"
                  :searchable="true"
                  nullLabel="No PO (direct receipt)"
                />
                <div class="form-text">Linking to a PO pre-populates the line items on the next screen.</div>
              </div>
              <div class="col-12">
                <label class="form-label">Note</label>
                <textarea v-model="createForm.note" class="form-control" rows="2" placeholder="Delivery note number, driver, anything worth recording…"></textarea>
              </div>

              <div class="col-12">
                <div class="tip-card">
                  <i class="ri-information-line tip-icon"></i>
                  <div class="small">
                    <div class="fw-semibold mb-1">What happens next</div>
                    <div class="text-muted">
                      We'll create the receipt header, then take you to the receipt detail view to enter quantities and unit costs before posting to stock.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button class="btn btn-primary" :disabled="saving" @click="createNewReceipt">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              Create &amp; open
            </button>
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
.stat-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; }
.stat-tile {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.85rem 1rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px; box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.stat-icon { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; font-size: 1.05rem; }
.stat-icon.tone-primary { background: rgba(13,148,136,0.14); color: #0d9488; }
.stat-icon.tone-info { background: rgba(8,145,178,0.14); color: #0891b2; }
.stat-icon.tone-warning { background: rgba(245,158,11,0.18); color: #b45309; }
.stat-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ct-secondary-color, #64748b); }
.stat-value { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.05rem; color: var(--ct-body-color, #0f172a); }

/* ============= Toolbar / Empty ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(13,148,136,0.05) 0%, transparent 100%); }
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(13,148,136,0.12); color: #0d9488; font-size: 1.6rem;
}

/* ============= Receipts table ============= */
.data-card { overflow: hidden; }
.data-scroll {
  max-height: calc(100vh - 480px);
  min-height: 240px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.rec-table thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.rec-row { cursor: pointer; transition: background 0.15s ease; }
.rec-row:hover { background: rgba(13,148,136,0.04); }

.id-chip {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.78rem; font-weight: 700;
  padding: 0.2rem 0.5rem; border-radius: 6px;
  background: rgba(13,148,136,0.1); color: #0d9488;
  border: 1px solid rgba(13,148,136,0.22);
}
.avatar-sm {
  width: 30px; height: 30px;
  border-radius: 8px;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 0.7rem;
  color: var(--accent, #0d9488);
  background: color-mix(in srgb, var(--accent, #0d9488) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #0d9488) 28%, transparent);
  flex-shrink: 0;
}
.po-chip {
  display: inline-flex; align-items: center;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.74rem; font-weight: 700;
  padding: 0.2rem 0.55rem; border-radius: 6px;
  background: rgba(8,145,178,0.1); color: #0891b2;
  border: 1px solid rgba(8,145,178,0.22);
}
.direct-chip {
  display: inline-flex; align-items: center;
  font-size: 0.74rem; font-weight: 700;
  padding: 0.2rem 0.55rem; border-radius: 6px;
  background: rgba(245,158,11,0.14); color: #b45309;
  border: 1px solid rgba(245,158,11,0.28);
  letter-spacing: 0.04em; text-transform: uppercase;
}
.when-date { font-weight: 700; font-size: 0.82rem; color: var(--ct-body-color, #0f172a); line-height: 1.2; }
.when-time { font-size: 0.72rem; color: var(--ct-secondary-color, #64748b); font-family: "JetBrains Mono", ui-monospace, monospace; }
.truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 280px; }

.row-icon-btn {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
}
.row-icon-btn:hover { background: rgba(13,148,136,0.1); color: #0d9488; }

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
:deep(.modal-eyebrow) { font-size: 0.68rem; font-weight: 700; color: #0d9488; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.25rem; }
:deep(.modal-header-modern .modal-title) { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.25rem; }
:deep(.modal-body-modern) {
  padding: 1.5rem;
  max-height: calc(100vh - 240px);
  overflow-y: visible;
}
:deep(.vs__dropdown-menu),
:deep(.search-select__menu),
:deep(.search-select__dropdown) { z-index: 9999 !important; }

.modal-overlay {
  position: absolute; inset: 0; z-index: 5;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
}
.tip-card {
  display: flex; gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: rgba(13,148,136,0.06);
  border: 1px solid rgba(13,148,136,0.18);
  align-items: flex-start;
}
.tip-icon { font-size: 1.2rem; color: #0d9488; flex-shrink: 0; }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
