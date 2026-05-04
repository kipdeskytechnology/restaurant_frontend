<!-- src/views/purchasing/ReceiptView.vue -->
<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import SearchSelect from "../../components/SearchSelect.vue";

import http from "../../api/http";
import { listInventoryItems } from "../../api/inventory";
import { listUoms } from "../../api/lookups";
import { getReceipt, getPurchaseOrder, replaceReceiptItems } from "../../api/purchasing";

const toast = useToast();
const route = useRoute();
const router = useRouter();

const receiptId = Number(route.params.id);

const loading = ref(true);
const posting = ref(false);

const outlets = ref([]);
const uoms = ref([]);
const itemsMaster = ref([]);

const receipt = ref(null);
const po = ref(null);

const lines = ref([]);

const isPosted = computed(() => (receipt.value?.items || []).length > 0);

const itemOptions = computed(() =>
  (itemsMaster.value || []).map((it) => ({
    label: it.sku ? `${it.sku} — ${it.name}` : it.name,
    value: Number(it.id),
  }))
);
const uomOptions = computed(() =>
  (uoms.value || []).map((u) => ({ label: `${u.code} — ${u.name}`, value: Number(u.id) }))
);

function uomCodeById(id) {
  const u = uoms.value.find((x) => x.id === Number(id));
  return u?.code || String(id);
}
function itemLabel(id) {
  const it = itemsMaster.value.find((x) => x.id === Number(id));
  return it ? (it.sku ? `${it.sku} — ${it.name}` : it.name) : String(id);
}
function outletName(id) {
  const o = outlets.value.find((x) => x.id === Number(id));
  return o?.name || `Outlet #${id}`;
}

const grandTotal = computed(() => lines.value.reduce(
  (sum, ln) => sum + (Number(ln.qty) || 0) * (Number(ln.unit_cost) || 0), 0
));

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function addLine() {
  if (isPosted.value) return;
  lines.value.push({
    inventory_item_id: null,
    qty: "1",
    uom_id: uoms.value?.[0]?.id ? Number(uoms.value[0].id) : null,
    unit_cost: "0",
  });
}
function removeLine(i) {
  if (isPosted.value) return;
  lines.value.splice(i, 1);
}
function normalizeDec(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function loadLookups() {
  const [out, uomList, invItems] = await Promise.all([
    http.get("/system/outlets").then((r) => r.data),
    listUoms(),
    listInventoryItems({ limit: 1000, active: "1" }),
  ]);
  outlets.value = Array.isArray(out) ? out : [];
  uoms.value = Array.isArray(uomList) ? uomList : [];
  itemsMaster.value = Array.isArray(invItems) ? invItems : [];
}

async function load() {
  loading.value = true;
  try {
    receipt.value = await getReceipt(receiptId);
    if (receipt.value.purchase_order_id) {
      po.value = await getPurchaseOrder(receipt.value.purchase_order_id);
    }
    if (isPosted.value) {
      lines.value = (receipt.value.items || []).map((x) => ({
        inventory_item_id: Number(x.inventory_item_id),
        qty: String(x.qty),
        uom_id: Number(x.uom_id),
        unit_cost: String(x.unit_cost),
      }));
    } else {
      if (po.value?.items?.length) {
        lines.value = po.value.items.map((x) => ({
          inventory_item_id: Number(x.inventory_item_id),
          qty: String(x.qty),
          uom_id: Number(x.uom_id),
          unit_cost: String(x.unit_cost),
        }));
      } else {
        lines.value = [];
      }
    }
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load receipt");
  } finally {
    loading.value = false;
  }
}

async function postReceipt() {
  if (isPosted.value) return;
  if (!confirm("Post this receipt to stock? This action will update on-hand quantities and average costs and cannot be undone here.")) return;

  posting.value = true;
  try {
    if (!lines.value.length) { toast.error("Add at least 1 item"); return; }
    const payload = {
      items: lines.value.map((ln) => {
        const inventory_item_id = Number(ln.inventory_item_id);
        const uom_id = Number(ln.uom_id);
        const qty = normalizeDec(ln.qty);
        const unit_cost = normalizeDec(ln.unit_cost);
        if (!inventory_item_id) throw new Error("Select item for all lines");
        if (!uom_id) throw new Error("Select UOM for all lines");
        if (!qty || qty <= 0) throw new Error("Qty must be > 0");
        if (unit_cost === null || unit_cost < 0) throw new Error("Unit cost must be >= 0");
        return { inventory_item_id, qty, uom_id, unit_cost };
      }),
    };
    receipt.value = await replaceReceiptItems(receiptId, payload);
    toast.success("Receipt posted to stock");
  } catch (e) {
    toast.error(e?.response?.data?.detail || e?.message || "Failed to post receipt");
  } finally {
    posting.value = false;
  }
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

onMounted(async () => {
  await loadLookups();
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
            <i class="ri-inbox-archive-line"></i><span>Purchasing · Receipt #{{ receiptId }}</span>
          </div>
          <h1 class="hero-title">Receipt</h1>
          <p class="hero-sub" v-if="receipt">
            <i class="ri-store-2-line me-1"></i>{{ outletName(receipt.outlet_id) }}
            <span v-if="receipt.purchase_order_id" class="mx-2">·</span>
            <span v-if="receipt.purchase_order_id"><i class="ri-link me-1"></i>PO #{{ receipt.purchase_order_id }}</span>
            <span v-else class="mx-2">·</span>
            <span v-if="!receipt.purchase_order_id">Direct receipt</span>
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="router.back()">
            <i class="ri-arrow-left-line"></i><span>Back</span>
          </button>
          <span class="status-pill-hero" :class="isPosted ? 'tone-success' : 'tone-warning'">
            <i :class="isPosted ? 'ri-check-double-line' : 'ri-edit-line'"></i>
            {{ isPosted ? 'POSTED' : 'DRAFT' }}
          </span>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading receipt…</div>
        </div>
      </div>

      <template v-else>
        <!-- ============== Status banner ============== -->
        <div class="banner mb-3" :class="isPosted ? 'banner-success' : 'banner-warn'">
          <div class="banner-icon">
            <i :class="isPosted ? 'ri-check-double-line' : 'ri-error-warning-line'"></i>
          </div>
          <div>
            <div class="banner-title">
              {{ isPosted ? 'Receipt is posted to stock' : 'Posting will update stock' }}
            </div>
            <div class="banner-sub">
              {{ isPosted ? 'On-hand quantities and average costs were updated. Editing is locked to avoid double-posting.' : 'Once you post, on-hand and average cost update — and editing locks. Double-check qty and unit cost first.' }}
            </div>
          </div>
        </div>

        <!-- ============== Items ============== -->
        <div class="card panel-card mb-3">
          <div class="panel-head">
            <div class="d-flex align-items-center gap-2">
              <span class="ns-icon"><i class="ri-shopping-bag-3-line"></i></span>
              <div>
                <div class="panel-eyebrow">Lines</div>
                <div class="panel-title">Items received</div>
              </div>
            </div>
            <div class="d-flex align-items-center gap-2">
              <span class="status-chip tone-default">
                <i class="ri-list-check-2"></i>{{ lines.length }} line{{ lines.length === 1 ? '' : 's' }}
              </span>
              <button v-if="!isPosted" v-can="'purchases:manage'" class="btn btn-soft-primary btn-sm" @click="addLine">
                <i class="ri-add-line me-1"></i>Add line
              </button>
            </div>
          </div>

          <div v-if="lines.length === 0" class="card-body">
            <div class="empty-inline">
              <div class="empty-inline-icon"><i class="ri-shopping-bag-3-line"></i></div>
              <div>
                <div class="small fw-semibold">No items</div>
                <div class="small text-muted">Add lines below before posting to stock.</div>
              </div>
            </div>
          </div>

          <div v-else class="data-scroll">
            <table class="table align-middle mb-0 line-table">
              <thead>
                <tr>
                  <th style="width: 60px">#</th>
                  <th>Item</th>
                  <th style="width: 120px" class="text-end">Qty</th>
                  <th style="width: 180px">UOM</th>
                  <th style="width: 140px" class="text-end">Unit cost</th>
                  <th style="width: 140px" class="text-end">Line total</th>
                  <th style="width: 60px"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(ln, idx) in lines" :key="idx">
                  <td><span class="line-num">{{ idx + 1 }}</span></td>
                  <td>
                    <div v-if="isPosted" class="d-flex align-items-center gap-2">
                      <div class="item-avatar" :style="{ '--accent': colorFor(itemLabel(ln.inventory_item_id)) }">
                        {{ initialsOf(itemLabel(ln.inventory_item_id)) }}
                      </div>
                      <div class="item-name">{{ itemLabel(ln.inventory_item_id) }}</div>
                    </div>
                    <SearchSelect
                      v-else
                      v-model="ln.inventory_item_id"
                      :options="itemOptions"
                      placeholder="Select item…"
                      :clearable="true"
                      :searchable="true"
                    />
                  </td>
                  <td>
                    <input v-model="ln.qty" class="form-control form-control-sm text-end qty-input" type="number" step="0.001" :disabled="isPosted" />
                  </td>
                  <td>
                    <span v-if="isPosted" class="uom-mini">{{ uomCodeById(ln.uom_id) }}</span>
                    <SearchSelect
                      v-else
                      v-model="ln.uom_id"
                      :options="uomOptions"
                      placeholder="Select UOM…"
                      :clearable="true"
                      :searchable="true"
                    />
                  </td>
                  <td>
                    <div class="input-group input-group-sm">
                      <span class="input-group-text">K</span>
                      <input v-model="ln.unit_cost" class="form-control text-end qty-input" type="number" step="0.0001" :disabled="isPosted" />
                    </div>
                  </td>
                  <td class="text-end">
                    <span class="amount-mono">K {{ money((Number(ln.qty) || 0) * (Number(ln.unit_cost) || 0)) }}</span>
                  </td>
                  <td class="text-end">
                    <button v-if="!isPosted" v-can="'purchases:manage'" class="row-icon-btn danger" title="Remove" @click="removeLine(idx)">
                      <i class="ri-delete-bin-line"></i>
                    </button>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="grand-row">
                  <td colspan="5" class="text-end fw-semibold">Grand total</td>
                  <td class="text-end">
                    <span class="grand-amount">K {{ money(grandTotal) }}</span>
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <!-- Sticky action bar -->
        <div class="save-bar">
          <div class="small text-muted">
            <i class="ri-information-line me-1"></i>
            <span v-if="isPosted">Posted on {{ fmtDate(receipt?.received_at) }}</span>
            <span v-else>Once posted, this receipt updates inventory and average cost.</span>
          </div>
          <div class="d-flex gap-2">
            <button v-can="'purchases:manage'" class="btn btn-success" :disabled="posting || isPosted" @click="postReceipt">
              <span v-if="posting" class="spinner-border spinner-border-sm me-1"></span>
              <i v-else class="ri-check-double-line me-1"></i>
              Post to stock
            </button>
          </div>
        </div>
      </template>
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
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  background: rgba(255,255,255,0.95);
  font-size: 0.78rem; font-weight: 800; letter-spacing: 0.04em;
}
.tone-success { color: #047857; }
.tone-warning { color: #b45309; }

/* ============= Banner ============= */
.banner {
  display: flex; align-items: flex-start; gap: 0.85rem;
  padding: 1rem 1.25rem;
  border-radius: 14px;
  border: 1px solid;
}
.banner-icon {
  width: 40px; height: 40px;
  border-radius: 10px;
  display: grid; place-items: center;
  font-size: 1.2rem;
  flex-shrink: 0;
}
.banner-title { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; }
.banner-sub { font-size: 0.85rem; margin-top: 0.15rem; }
.banner-warn {
  background: rgba(245,158,11,0.06);
  border-color: rgba(245,158,11,0.3);
  color: #b45309;
}
.banner-warn .banner-icon { background: rgba(245,158,11,0.18); color: #b45309; }
.banner-success {
  background: rgba(16,185,129,0.06);
  border-color: rgba(16,185,129,0.3);
  color: #047857;
}
.banner-success .banner-icon { background: rgba(16,185,129,0.18); color: #047857; }

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
  background: linear-gradient(180deg, rgba(13,148,136,0.04), transparent);
}
.ns-icon {
  width: 36px; height: 36px;
  border-radius: 10px;
  display: grid; place-items: center;
  background: rgba(13,148,136,0.12); color: #0d9488;
  font-size: 1.05rem;
}
.panel-eyebrow { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #0d9488; }
.panel-title { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.05rem; color: var(--ct-body-color, #0f172a); }

.status-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em;
  background: rgba(100,116,139,0.14); color: #475569;
}

.empty-inline {
  display: flex; align-items: center; gap: 0.65rem;
  padding: 1rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
}
.empty-inline-icon {
  width: 38px; height: 38px;
  border-radius: 10px;
  display: grid; place-items: center;
  background: rgba(13,148,136,0.1); color: #0d9488;
}

/* SearchSelect z-index */
:deep(.vs__dropdown-menu),
:deep(.search-select__menu),
:deep(.search-select__dropdown) { z-index: 9999 !important; }

/* ============= Lines table ============= */
.data-scroll {
  max-height: calc(100vh - 540px);
  min-height: 240px;
  overflow: visible;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.line-table thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.line-num {
  display: inline-grid; place-items: center;
  width: 28px; height: 28px;
  border-radius: 50%;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700; font-size: 0.78rem;
  color: var(--ct-secondary-color, #64748b);
}
.item-avatar {
  width: 32px; height: 32px;
  border-radius: 9px;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 0.7rem;
  color: var(--accent, #0d9488);
  background: color-mix(in srgb, var(--accent, #0d9488) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #0d9488) 28%, transparent);
}
.item-name { font-weight: 700; color: var(--ct-body-color, #0f172a); }
.qty-input { font-family: "JetBrains Mono", ui-monospace, monospace; font-weight: 600; }
.uom-mini {
  display: inline-block;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700; font-size: 0.72rem;
  padding: 0.2rem 0.5rem; border-radius: 6px;
  background: rgba(13,148,136,0.1); color: #0d9488;
  border: 1px solid rgba(13,148,136,0.22);
}
.amount-mono { font-family: "JetBrains Mono", ui-monospace, monospace; font-weight: 700; font-size: 0.85rem; color: var(--ct-body-color, #0f172a); }

.grand-row td { background: linear-gradient(180deg, rgba(13,148,136,0.05), transparent); border-top: 2px solid rgba(13,148,136,0.22); }
.grand-amount {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 1.1rem;
  letter-spacing: -0.02em;
  color: #0d9488;
}

.row-icon-btn {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
}
.row-icon-btn.danger:hover { background: rgba(239,68,68,0.1); color: #ef4444; }

.save-bar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 0.85rem 1.25rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px;
  box-shadow: 0 -10px 24px -16px rgba(15,23,42,0.18);
  flex-wrap: wrap;
}

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
