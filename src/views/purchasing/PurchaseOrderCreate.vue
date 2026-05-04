<!-- src/views/purchasing/PurchaseOrderCreate.vue -->
<script setup>
import { ref, computed, onMounted, nextTick } from "vue";
import { useRouter } from "vue-router";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import SearchSelect from "../../components/SearchSelect.vue";

import { listInventoryItems } from "../../api/inventory";
import { listUoms } from "../../api/lookups";
import {
  listSuppliers,
  createPurchaseOrder,
  replacePurchaseOrderItems,
} from "../../api/purchasing";
import http from "../../api/http";

const toast = useToast();
const router = useRouter();

const loading = ref(true);
const saving = ref(false);

const suppliers = ref([]);
const itemsMaster = ref([]);
const uoms = ref([]);
const outlets = ref([]);

const outletOptions = computed(() =>
  (outlets.value || []).map((o) => ({ label: o.name, value: Number(o.id) }))
);
const supplierOptions = computed(() =>
  (suppliers.value || []).map((s) => ({ label: s.name, value: Number(s.id) }))
);
const itemOptions = computed(() =>
  (itemsMaster.value || []).map((it) => ({
    label: it.sku ? `${it.sku} — ${it.name}` : it.name,
    value: Number(it.id),
  }))
);

const uomLabelById = computed(() => {
  const m = new Map();
  for (const u of uoms.value) m.set(u.id, `${u.code} — ${u.name}`);
  return m;
});
const uomCodeById = computed(() => {
  const m = new Map();
  for (const u of uoms.value) m.set(u.id, u.code);
  return m;
});
const itemLabelById = computed(() => {
  const m = new Map();
  for (const it of itemsMaster.value) m.set(it.id, it.name);
  return m;
});
const itemSkuById = computed(() => {
  const m = new Map();
  for (const it of itemsMaster.value) m.set(it.id, it.sku);
  return m;
});

const form = ref({
  supplier_id: null,
  outlet_id: null,
  note: "",
  items: [],
});

function normalizeNumber(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const grandTotal = computed(() => {
  return form.value.items.reduce((sum, ln) => {
    const q = Number(ln.qty) || 0;
    const c = Number(ln.unit_cost) || 0;
    return sum + q * c;
  }, 0);
});

async function loadLookups() {
  const [sup, inv, uomList, outletsData] = await Promise.all([
    listSuppliers({ active: "1", limit: 500 }),
    listInventoryItems({ limit: 500, active: "all", track: "all" }),
    listUoms(),
    http.get("/system/outlets").then((r) => r.data),
  ]);
  suppliers.value = Array.isArray(sup) ? sup : [];
  itemsMaster.value = Array.isArray(inv) ? inv : [];
  uoms.value = Array.isArray(uomList) ? uomList : [];
  outlets.value = Array.isArray(outletsData) ? outletsData : [];
}

async function init() {
  loading.value = true;
  try {
    await loadLookups();
  } catch (e) {
    toast.error(e?.response?.data?.detail || e?.message || "Failed to load form");
  } finally {
    loading.value = false;
  }
}

// ===== Add line modal =====
const addModalEl = ref(null);
let addModalInstance = null;

const newLine = ref({
  inventory_item_id: null,
  qty: 1,
  uom_id: null,
  unit_cost: 0,
});

async function ensureAddModal() {
  if (addModalInstance) return;
  try {
    const m = await import("bootstrap/js/dist/modal");
    addModalInstance = new m.default(addModalEl.value, { backdrop: "static", keyboard: false });
  } catch {
    addModalInstance = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(addModalEl.value, { backdrop: "static", keyboard: false })
      : null;
  }
}

async function prepareAddLine() {
  const first = itemsMaster.value?.[0];
  if (!first) { toast.warning("No inventory items found"); return; }
  newLine.value = {
    inventory_item_id: Number(first.id),
    qty: 1,
    uom_id: Number(first.base_uom_id),
    unit_cost: 0,
  };
  await ensureAddModal();
  addModalInstance?.show();
  await nextTick();
}

function onNewLineItemChange(invId) {
  const it = itemsMaster.value.find((x) => x.id === Number(invId));
  if (it) newLine.value.uom_id = Number(it.base_uom_id);
}

function addLineToForm() {
  const payload = {
    inventory_item_id: Number(newLine.value.inventory_item_id),
    qty: normalizeNumber(newLine.value.qty),
    uom_id: Number(newLine.value.uom_id),
    unit_cost: normalizeNumber(newLine.value.unit_cost),
  };
  if (!payload.inventory_item_id) return toast.error("Select an item");
  if (!payload.qty || payload.qty <= 0) return toast.error("Qty must be > 0");
  if (!payload.uom_id) return toast.error("UOM is required");
  if (payload.unit_cost == null || payload.unit_cost < 0) return toast.error("Unit cost must be >= 0");
  if (form.value.items.some((x) => Number(x.inventory_item_id) === payload.inventory_item_id)) {
    return toast.error("This item already exists in the PO lines");
  }
  form.value.items.push(payload);
  addModalInstance?.hide();
}

function removeLine(idx) {
  form.value.items.splice(idx, 1);
}

async function save() {
  if (!form.value.outlet_id) return toast.error("Outlet is required");
  if (!form.value.supplier_id) return toast.error("Supplier is required");
  if (!form.value.items.length) return toast.error("Add at least 1 item");

  saving.value = true;
  try {
    const created = await createPurchaseOrder({
      outlet_id: Number(form.value.outlet_id),
      supplier_id: Number(form.value.supplier_id),
      note: form.value.note?.trim() || null,
    });
    const poId = Number(created?.id);
    if (!Number.isInteger(poId) || poId <= 0) throw new Error("Created purchase order id is invalid");

    const itemsPayload = form.value.items.map((x) => ({
      inventory_item_id: Number(x.inventory_item_id),
      qty: normalizeNumber(x.qty),
      uom_id: Number(x.uom_id),
      unit_cost: normalizeNumber(x.unit_cost),
    }));
    await replacePurchaseOrderItems(poId, itemsPayload);

    toast.success("Purchase order created");
    router.replace({ name: "purchase-order-view", params: { id: poId } });
  } catch (e) {
    toast.error(e?.response?.data?.detail || e?.message || "Failed to create purchase order");
  } finally {
    saving.value = false;
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

onMounted(init);
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-shopping-cart-2-line"></i><span>Purchasing · New PO</span>
          </div>
          <h1 class="hero-title">New Purchase Order</h1>
          <p class="hero-sub">
            Pick a supplier and outlet, add line items, then save. The PO starts in <strong>DRAFT</strong> — send it to the supplier when ready.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="router.back()">
            <i class="ri-arrow-left-line"></i><span>Back</span>
          </button>
          <button class="btn btn-pill btn-cta" :disabled="loading || saving" @click="save">
            <i class="ri-save-line"></i>
            <span v-if="saving">Saving…</span>
            <span v-else>Save draft PO</span>
          </button>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading form…</div>
        </div>
      </div>

      <div v-else>
        <!-- ============== Header form ============== -->
        <div class="card panel-card mb-3">
          <div class="panel-head">
            <div class="d-flex align-items-center gap-2">
              <span class="ns-icon"><i class="ri-file-list-3-line"></i></span>
              <div>
                <div class="panel-eyebrow">Header</div>
                <div class="panel-title">PO details</div>
              </div>
            </div>
            <span class="status-chip tone-default">
              <i class="ri-edit-line"></i>DRAFT
            </span>
          </div>

          <div class="card-body">
            <div class="row g-3">
              <div class="col-md-5">
                <label class="form-label">Outlet *</label>
                <SearchSelect
                  v-model="form.outlet_id"
                  :options="outletOptions"
                  placeholder="Select outlet…"
                  :clearable="true"
                  :searchable="true"
                />
              </div>
              <div class="col-md-7">
                <label class="form-label">Supplier *</label>
                <SearchSelect
                  v-model="form.supplier_id"
                  :options="supplierOptions"
                  placeholder="Select supplier…"
                  :clearable="true"
                  :searchable="true"
                />
              </div>
              <div class="col-12">
                <label class="form-label">Note</label>
                <textarea v-model="form.note" class="form-control" rows="2" placeholder="Internal note for this PO (optional)"></textarea>
              </div>
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
                <div class="panel-title">Items to order</div>
              </div>
            </div>
            <div class="d-flex align-items-center gap-2">
              <span class="status-chip tone-default">
                <i class="ri-list-check-2"></i>{{ form.items.length }} line{{ form.items.length === 1 ? '' : 's' }}
              </span>
              <button class="btn btn-soft-primary btn-sm" @click="prepareAddLine">
                <i class="ri-add-line me-1"></i>Add line
              </button>
            </div>
          </div>

          <div v-if="form.items.length === 0" class="card-body">
            <div class="empty-inline">
              <div class="empty-inline-icon"><i class="ri-shopping-bag-3-line"></i></div>
              <div>
                <div class="small fw-semibold">No lines yet</div>
                <div class="small text-muted">Add at least one item before saving the PO.</div>
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
                  <th style="width: 90px">UOM</th>
                  <th style="width: 140px" class="text-end">Unit cost</th>
                  <th style="width: 140px" class="text-end">Line total</th>
                  <th style="width: 60px"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(ln, idx) in form.items" :key="idx">
                  <td>
                    <span class="line-num">{{ idx + 1 }}</span>
                  </td>
                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <div class="item-avatar" :style="{ '--accent': colorFor(itemLabelById.get(ln.inventory_item_id)) }">
                        {{ initialsOf(itemLabelById.get(ln.inventory_item_id)) }}
                      </div>
                      <div class="min-w-0">
                        <div class="item-name">{{ itemLabelById.get(ln.inventory_item_id) || `Item #${ln.inventory_item_id}` }}</div>
                        <div class="item-sku" v-if="itemSkuById.get(ln.inventory_item_id)">SKU: {{ itemSkuById.get(ln.inventory_item_id) }}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <input v-model="ln.qty" class="form-control form-control-sm text-end qty-input" type="number" step="0.000001" />
                  </td>
                  <td>
                    <span class="uom-mini">{{ uomCodeById.get(ln.uom_id) || `#${ln.uom_id}` }}</span>
                  </td>
                  <td>
                    <div class="input-group input-group-sm">
                      <span class="input-group-text">K</span>
                      <input v-model="ln.unit_cost" class="form-control text-end qty-input" type="number" step="0.0001" />
                    </div>
                  </td>
                  <td class="text-end">
                    <span class="amount-mono">K {{ money((Number(ln.qty) || 0) * (Number(ln.unit_cost) || 0)) }}</span>
                  </td>
                  <td class="text-end">
                    <button class="row-icon-btn danger" title="Remove" @click="removeLine(idx)">
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

        <!-- Sticky save bar -->
        <div class="save-bar">
          <div class="small text-muted">
            <i class="ri-information-line me-1"></i>
            Once created, this PO will be a <strong>DRAFT</strong>. You can edit lines and send it to the supplier from the next screen.
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-light" @click="router.back()">
              <i class="ri-close-line me-1"></i>Cancel
            </button>
            <button class="btn btn-primary" :disabled="loading || saving" @click="save">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              <i v-else class="ri-save-line me-1"></i>
              Save PO
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Add Line Modal ============== -->
    <div class="modal fade" tabindex="-1" aria-hidden="true" ref="addModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content modal-modern">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">Add</div>
              <h5 class="modal-title">Add line item</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal"></button>
          </div>

          <div class="modal-body modal-body-modern">
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label">Inventory item *</label>
                <SearchSelect
                  v-model="newLine.inventory_item_id"
                  :options="itemOptions"
                  placeholder="Select item…"
                  :clearable="true"
                  :searchable="true"
                  @update:modelValue="onNewLineItemChange"
                />
              </div>
              <div class="col-md-4">
                <label class="form-label">Qty *</label>
                <input v-model="newLine.qty" type="number" step="0.000001" class="form-control" placeholder="1" />
              </div>
              <div class="col-md-4">
                <label class="form-label">Unit cost *</label>
                <div class="input-group">
                  <span class="input-group-text">K</span>
                  <input v-model="newLine.unit_cost" type="number" step="0.0001" class="form-control" placeholder="0.00" />
                </div>
              </div>
              <div class="col-md-4">
                <label class="form-label">UOM</label>
                <input class="form-control code-input" :value="uomLabelById.get(newLine.uom_id) || newLine.uom_id" disabled />
                <div class="form-text">Auto-set to the item's base UOM</div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
            <button class="btn btn-primary" @click="addLineToForm">
              <i class="ri-add-line me-1"></i>Add line
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
.hero-sub { color: rgba(255,255,255,0.85); margin: 0.35rem 0 0; font-size: 0.9rem; }
.page-hero-actions { position: relative; display: flex; gap: 0.5rem; flex-wrap: wrap; }
.btn-pill { border-radius: 999px !important; display: inline-flex; align-items: center; gap: 0.4rem; }
.page-hero-actions .btn-light { background: rgba(255,255,255,0.95); color: #0f172a; border: none; }
.btn-cta { background: #fff !important; color: #0d9488 !important; font-weight: 700; border: none; box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3); }

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
  font-size: 1.05rem; flex-shrink: 0;
}
.panel-eyebrow { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #0d9488; }
.panel-title { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.05rem; color: var(--ct-body-color, #0f172a); }

/* SearchSelect z-index */
:deep(.vs__dropdown-menu),
:deep(.search-select__menu),
:deep(.search-select__dropdown) { z-index: 9999 !important; }

/* ============= Status chips ============= */
.status-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.7rem; font-weight: 700;
  letter-spacing: 0.04em;
}
.status-chip i { font-size: 0.85rem; }
.tone-default { background: rgba(100,116,139,0.14); color: #475569; }

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
  flex-shrink: 0;
}

/* ============= Lines table ============= */
.data-scroll {
  max-height: calc(100vh - 540px);
  min-height: 200px;
  overflow: auto;
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
  flex-shrink: 0;
}
.item-name { font-weight: 700; color: var(--ct-body-color, #0f172a); line-height: 1.25; }
.item-sku { font-size: 0.7rem; color: var(--ct-secondary-color, #64748b); font-family: "JetBrains Mono", ui-monospace, monospace; }
.min-w-0 { min-width: 0; }

.uom-mini {
  display: inline-block;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700; font-size: 0.72rem;
  padding: 0.2rem 0.5rem; border-radius: 6px;
  background: rgba(13,148,136,0.1); color: #0d9488;
  border: 1px solid rgba(13,148,136,0.22);
}

.qty-input { font-family: "JetBrains Mono", ui-monospace, monospace; font-weight: 600; }
.amount-mono {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700; font-size: 0.85rem;
  color: var(--ct-body-color, #0f172a);
}

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

/* Sticky save bar */
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
  scrollbar-width: thin;
}
.code-input { font-family: "JetBrains Mono", ui-monospace, monospace; font-weight: 600; }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
