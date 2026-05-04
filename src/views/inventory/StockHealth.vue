<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "vue-toastification";

import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { StatCard, EmptyState, LoadingState, StatusBadge, SectionCard } from "../../components/ui";

import { getStockHealth, adjustStock } from "../../api/inventory";
import { listOutlets } from "../../api/lookups";
import { getPoSuggestions, createPurchaseOrder, replacePurchaseOrderItems, sendPurchaseOrder } from "../../api/purchasing";

const router = useRouter();
const toast = useToast();

const loading = ref(true);
const refreshing = ref(false);
const data = ref(null);
const outlets = ref([]);

const filters = ref({
  outlet_id: "",
  days: 7,
});

// Quick-adjust modal state
const adjusting = ref(null); // { outlet_id, inventory_item_id, item_name, on_hand, uom_code }
const adjustForm = ref({ qty_delta: "", reason: "ADJUSTMENT", note: "" });
const savingAdjust = ref(false);

// Auto-PO suggestions modal state
const poModalOpen = ref(false);
const poLoading = ref(false);
const poSubmitting = ref(false);
const poSuggestions = ref(null); // { groups: [], items_without_supplier: [], total_low_stock_items }
const poBufferPct = ref(0);
const poAutoSend = ref(false);  // when true, chain createPO → replaceItems → send for each group
const poGroupsState = ref([]); // mirror of suggestions.groups with editable {included, qty} per line, and {include} per group

// ---------- helpers ----------
function fmtMoney(v) {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtQty(v, dp = 3) {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dp });
}
function fmtDateTime(s) {
  if (!s) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}
function reasonTone(reason) {
  const r = String(reason || "").toUpperCase();
  if (r.includes("RECEIPT") || r.includes("PURCHASE")) return "success";
  if (r.includes("SALE") || r.includes("ORDER")) return "info";
  if (r.includes("WASTE") || r.includes("TRANSFER_OUT")) return "warning";
  if (r.includes("ADJUSTMENT")) return "default";
  return "default";
}

// ---------- load ----------
async function loadOutlets() {
  try {
    outlets.value = (await listOutlets()) || [];
  } catch (e) {
    outlets.value = [];
  }
}

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;

  try {
    const params = { days: filters.value.days };
    if (filters.value.outlet_id) params.outlet_id = filters.value.outlet_id;
    data.value = await getStockHealth(params);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load stock health");
    data.value = null;
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

watch(() => filters.value.outlet_id, () => load(false));
watch(() => filters.value.days, () => load(false));

onMounted(async () => {
  await loadOutlets();
  await load();
});

// ---------- derived ----------
const summary = computed(() => data.value?.summary || null);
const lowStock = computed(() => data.value?.low_stock || []);
const outOfStock = computed(() => data.value?.out_of_stock || []);
const topMovers = computed(() => data.value?.top_movers || []);
const recentMovements = computed(() => data.value?.recent_movements || []);

// ---------- quick adjust ----------
function openAdjust(row) {
  adjusting.value = {
    outlet_id: row.outlet_id,
    inventory_item_id: row.inventory_item_id,
    item_name: row.item_name,
    outlet_name: row.outlet_name,
    on_hand: row.on_hand,
    uom_code: row.uom_code,
    reorder_level: row.reorder_level,
  };
  // pre-fill with the gap so the cashier just hits Save
  const gap = Number(row.gap);
  adjustForm.value = {
    qty_delta: Number.isFinite(gap) && gap > 0 ? String(gap) : "",
    reason: "RESTOCK",
    note: "",
  };

  const el = document.getElementById("quickAdjustModal");
  if (el && window.bootstrap) {
    window.bootstrap.Modal.getOrCreateInstance(el).show();
  }
}

function closeAdjust() {
  adjusting.value = null;
  const el = document.getElementById("quickAdjustModal");
  if (el && window.bootstrap) {
    window.bootstrap.Modal.getOrCreateInstance(el).hide();
  }
}

async function submitAdjust() {
  if (!adjusting.value) return;
  const qty = Number(adjustForm.value.qty_delta);
  if (!Number.isFinite(qty) || qty === 0) {
    toast.warning("Enter a non-zero quantity");
    return;
  }

  savingAdjust.value = true;
  try {
    await adjustStock({
      outlet_id: adjusting.value.outlet_id,
      inventory_item_id: adjusting.value.inventory_item_id,
      qty_delta: qty,
      reason: adjustForm.value.reason || "ADJUSTMENT",
      note: adjustForm.value.note?.trim() || null,
    });
    toast.success("Stock adjusted");
    closeAdjust();
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to adjust stock");
  } finally {
    savingAdjust.value = false;
  }
}

// ---------- Auto-PO suggestions ----------
async function openPoSuggestions() {
  if (!filters.value.outlet_id) {
    toast.warning("Pick a single outlet first — PO suggestions are scoped to one outlet at a time.");
    return;
  }
  poModalOpen.value = true;
  await loadSuggestions();
  const el = document.getElementById("poSuggestionsModal");
  if (el && window.bootstrap) {
    window.bootstrap.Modal.getOrCreateInstance(el).show();
  }
}

function closePoSuggestions() {
  poModalOpen.value = false;
  const el = document.getElementById("poSuggestionsModal");
  if (el && window.bootstrap) {
    window.bootstrap.Modal.getOrCreateInstance(el).hide();
  }
}

async function loadSuggestions() {
  poLoading.value = true;
  try {
    poSuggestions.value = await getPoSuggestions({
      outlet_id: filters.value.outlet_id,
      buffer_pct: poBufferPct.value,
    });
    // Build editable mirror: by default all groups + lines selected with the
    // server's suggested qty pre-filled.
    poGroupsState.value = (poSuggestions.value.groups || []).map((g) => ({
      include: true,
      supplier_id: g.supplier_id,
      supplier_name: g.supplier_name,
      outlet_id: g.outlet_id,
      lines: g.lines.map((l) => ({
        included: true,
        inventory_item_id: l.inventory_item_id,
        item_name: l.item_name,
        item_sku: l.item_sku,
        on_hand: l.on_hand,
        reorder_level: l.reorder_level,
        suggested_qty: String(l.suggested_qty),
        uom_id: l.uom_id,
        uom_code: l.uom_code,
        last_price: l.last_price,
      })),
    }));
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load PO suggestions");
    poSuggestions.value = null;
    poGroupsState.value = [];
  } finally {
    poLoading.value = false;
  }
}

function poGroupTotal(group) {
  let sum = 0;
  for (const l of group.lines) {
    if (!l.included) continue;
    const qty = Number(l.suggested_qty);
    const price = Number(l.last_price ?? 0);
    if (Number.isFinite(qty) && Number.isFinite(price)) sum += qty * price;
  }
  return sum;
}

function poGroupSelectedCount(group) {
  return group.lines.filter((l) => l.included).length;
}

function toggleGroup(group) {
  const next = !group.include;
  group.include = next;
  for (const l of group.lines) l.included = next;
}

const poTotalToCreate = computed(() =>
  poGroupsState.value.filter((g) => g.include && poGroupSelectedCount(g) > 0).length
);

async function submitPoCreate() {
  const groups = poGroupsState.value.filter((g) => g.include && poGroupSelectedCount(g) > 0);
  if (!groups.length) {
    toast.warning("Pick at least one supplier group with at least one item");
    return;
  }

  poSubmitting.value = true;
  let created = 0;
  let sent = 0;
  let failed = 0;
  try {
    for (const g of groups) {
      try {
        const po = await createPurchaseOrder({
          outlet_id: g.outlet_id,
          supplier_id: g.supplier_id,
          note: "Auto-suggested from low-stock report",
        });
        const items = g.lines
          .filter((l) => l.included && Number(l.suggested_qty) > 0)
          .map((l) => ({
            inventory_item_id: l.inventory_item_id,
            qty: Number(l.suggested_qty),
            uom_id: l.uom_id,
            unit_cost: Number(l.last_price ?? 0),
          }));
        await replacePurchaseOrderItems(po.id, items);
        created += 1;

        if (poAutoSend.value) {
          // Auto-send: PO goes from DRAFT to SENT immediately. The PO still
          // exists if send fails — the user can retry or send manually from
          // the PO list.
          try {
            await sendPurchaseOrder(po.id);
            sent += 1;
          } catch (e) {
            // Created OK but couldn't send — surface as a warning, but don't
            // tip the whole batch into "failed".
            // (counted via created - sent below)
          }
        }
      } catch (e) {
        failed += 1;
      }
    }
    if (created > 0) {
      const parts = [`Created ${created} PO${created === 1 ? '' : 's'}`];
      if (poAutoSend.value) parts.push(`${sent} sent`);
      if (failed) parts.push(`${failed} failed`);
      toast.success(parts.join(" · "));
      closePoSuggestions();
    } else {
      toast.error("Failed to create any POs");
    }
  } finally {
    poSubmitting.value = false;
  }
}
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
    <!-- ============== HERO ============== -->
    <div class="page-hero">
      <div class="page-hero-text">
        <div class="eyebrow">
          <i class="ri-pulse-line"></i><span>Inventory</span>
        </div>
        <h1 class="hero-title">Stock Health</h1>
        <p class="hero-sub">
          What needs your attention right now — items running low, items at zero, your busiest movers, and the freshest activity.
        </p>
      </div>

      <div class="page-hero-actions">
        <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
          <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
        </button>
        <button
          v-can="'purchases:manage'"
          class="btn btn-pill btn-cta"
          @click="openPoSuggestions"
          :disabled="!filters.outlet_id"
          :title="!filters.outlet_id ? 'Pick an outlet first' : 'Auto-generate draft Purchase Orders from low-stock items'"
        >
          <i class="ri-magic-line"></i><span>Generate POs</span>
        </button>
        <router-link to="/inventory/stock" class="btn btn-light btn-pill">
          <i class="ri-list-check"></i><span>Full Stock</span>
        </router-link>
      </div>
    </div>

    <!-- ============== Toolbar ============== -->
    <div class="card mb-3 toolbar-card">
      <div class="card-body py-2">
        <div class="row g-2 align-items-end">
          <div class="col-md-6">
            <label class="form-label">Outlet</label>
            <select v-model="filters.outlet_id" class="form-select">
              <option value="">All outlets</option>
              <option v-for="o in outlets" :key="o.id" :value="o.id">
                {{ o.code }} — {{ o.name }}
              </option>
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">Lookback window</label>
            <select v-model.number="filters.days" class="form-select">
              <option :value="1">Last 24 hours</option>
              <option :value="7">Last 7 days</option>
              <option :value="14">Last 14 days</option>
              <option :value="30">Last 30 days</option>
              <option :value="90">Last 90 days</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <LoadingState v-if="loading" label="Loading stock health…" />

    <template v-else-if="data">
      <!-- KPI tiles -->
      <div class="row g-3 mb-3">
        <div class="col-12 col-md-6 col-lg-3">
          <StatCard
            label="Tracked Items"
            :value="summary.total_tracked_items"
            icon="ri-archive-line"
            tone="info"
            hint="Active items with stock tracking on"
          />
        </div>
        <div class="col-12 col-md-6 col-lg-3">
          <StatCard
            label="Low Stock"
            :value="summary.low_stock_count"
            icon="ri-error-warning-line"
            tone="warning"
            hint="Below reorder level"
          />
        </div>
        <div class="col-12 col-md-6 col-lg-3">
          <StatCard
            label="Out of Stock"
            :value="summary.out_of_stock_count"
            icon="ri-close-circle-line"
            tone="danger"
            hint="Reorder immediately"
          />
        </div>
        <div class="col-12 col-md-6 col-lg-3">
          <StatCard
            label="Inventory Value"
            :value="`K ${fmtMoney(summary.value_on_hand)}`"
            icon="ri-money-dollar-circle-line"
            tone="success"
            hint="Avg cost × on hand"
          />
        </div>
      </div>

      <!-- Out of stock -->
      <div class="row g-3 mb-3">
        <div class="col-12 col-xl-6">
          <SectionCard
            title="Out of Stock"
            :subtitle="`${outOfStock.length} item${outOfStock.length === 1 ? '' : 's'} need restocking`"
            icon="ri-close-circle-line"
            no-body
          >
            <template #actions>
              <StatusBadge tone="danger">{{ outOfStock.length }}</StatusBadge>
            </template>

            <EmptyState
              v-if="!outOfStock.length"
              icon="ri-checkbox-circle-line"
              title="All good!"
              message="No items are out of stock."
            />
            <div v-else class="table-responsive section-scroll">
              <table class="table table-sm table-hover mb-0 align-middle section-table">
                <thead class="table-light">
                  <tr>
                    <th>Item</th>
                    <th v-if="!filters.outlet_id">Outlet</th>
                    <th class="text-end">On hand</th>
                    <th class="text-end">Par</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in outOfStock" :key="`${r.outlet_id}-${r.inventory_item_id}`">
                    <td>
                      <div class="fw-semibold">{{ r.item_name }}</div>
                      <small v-if="r.item_sku" class="text-muted">{{ r.item_sku }}</small>
                    </td>
                    <td v-if="!filters.outlet_id">
                      <small class="text-muted">{{ r.outlet_name }}</small>
                    </td>
                    <td class="text-end text-danger fw-bold">
                      {{ fmtQty(r.on_hand) }}
                      <small class="text-muted ms-1">{{ r.uom_code || "" }}</small>
                    </td>
                    <td class="text-end text-muted">
                      {{ r.reorder_level != null ? fmtQty(r.reorder_level) : "—" }}
                    </td>
                    <td class="text-end">
                      <button v-can="'inventory:manage'" class="btn btn-sm btn-primary" @click="openAdjust(r)">
                        <i class="ri-add-line"></i> Restock
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>

        <!-- Low stock -->
        <div class="col-12 col-xl-6">
          <SectionCard
            title="Low Stock"
            :subtitle="`${lowStock.length} item${lowStock.length === 1 ? '' : 's'} below par`"
            icon="ri-error-warning-line"
            no-body
          >
            <template #actions>
              <StatusBadge tone="warning">{{ lowStock.length }}</StatusBadge>
            </template>

            <EmptyState
              v-if="!lowStock.length"
              icon="ri-checkbox-circle-line"
              title="Stock levels healthy"
              message="No tracked item is below its reorder level."
            />
            <div v-else class="table-responsive section-scroll">
              <table class="table table-sm table-hover mb-0 align-middle section-table">
                <thead class="table-light">
                  <tr>
                    <th>Item</th>
                    <th v-if="!filters.outlet_id">Outlet</th>
                    <th class="text-end">On hand</th>
                    <th class="text-end">Par</th>
                    <th class="text-end">Gap</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in lowStock" :key="`${r.outlet_id}-${r.inventory_item_id}`">
                    <td>
                      <div class="fw-semibold">{{ r.item_name }}</div>
                      <small v-if="r.item_sku" class="text-muted">{{ r.item_sku }}</small>
                    </td>
                    <td v-if="!filters.outlet_id">
                      <small class="text-muted">{{ r.outlet_name }}</small>
                    </td>
                    <td class="text-end">
                      {{ fmtQty(r.on_hand) }}
                      <small class="text-muted ms-1">{{ r.uom_code || "" }}</small>
                    </td>
                    <td class="text-end text-muted">{{ fmtQty(r.reorder_level) }}</td>
                    <td class="text-end text-warning fw-semibold">{{ fmtQty(r.gap) }}</td>
                    <td class="text-end">
                      <button v-can="'inventory:manage'" class="btn btn-sm btn-outline-primary" @click="openAdjust(r)">
                        <i class="ri-add-line"></i> Adjust
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>

      <!-- Top movers + Recent movements -->
      <div class="row g-3">
        <div class="col-12 col-xl-6">
          <SectionCard
            title="Top Movers"
            :subtitle="`Most-moved items in the last ${filters.days} day${filters.days === 1 ? '' : 's'}`"
            icon="ri-line-chart-line"
            no-body
          >
            <EmptyState
              v-if="!topMovers.length"
              icon="ri-bar-chart-line"
              title="No movement"
              message="No stock activity in the selected window."
            />
            <div v-else class="table-responsive section-scroll">
              <table class="table table-sm table-hover mb-0 align-middle section-table">
                <thead class="table-light">
                  <tr>
                    <th>Item</th>
                    <th class="text-end">In</th>
                    <th class="text-end">Out</th>
                    <th class="text-end">Net</th>
                    <th class="text-end">Moves</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in topMovers" :key="m.inventory_item_id">
                    <td>
                      <div class="fw-semibold">{{ m.item_name }}</div>
                      <small v-if="m.item_sku" class="text-muted">{{ m.item_sku }}</small>
                    </td>
                    <td class="text-end text-success">+{{ fmtQty(m.total_in) }}</td>
                    <td class="text-end text-danger">-{{ fmtQty(m.total_out) }}</td>
                    <td class="text-end fw-semibold" :class="Number(m.net) < 0 ? 'text-danger' : 'text-success'">
                      {{ Number(m.net) >= 0 ? '+' : '' }}{{ fmtQty(m.net) }}
                    </td>
                    <td class="text-end text-muted">{{ m.movement_count }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>

        <div class="col-12 col-xl-6">
          <SectionCard
            title="Recent Movements"
            subtitle="Latest stock changes"
            icon="ri-history-line"
            no-body
          >
            <template #actions>
              <router-link to="/inventory/ledger" class="btn btn-sm btn-link p-0">
                View all <i class="ri-arrow-right-line"></i>
              </router-link>
            </template>

            <EmptyState
              v-if="!recentMovements.length"
              icon="ri-time-line"
              title="No recent activity"
              message="No stock movements yet."
            />
            <div v-else class="table-responsive section-scroll">
              <table class="table table-sm table-hover mb-0 align-middle section-table">
                <thead class="table-light">
                  <tr>
                    <th>When</th>
                    <th>Item</th>
                    <th>Reason</th>
                    <th class="text-end">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in recentMovements" :key="m.id">
                    <td>
                      <small class="text-muted">{{ fmtDateTime(m.occurred_at) }}</small>
                    </td>
                    <td>
                      <div class="small fw-semibold">{{ m.item_name }}</div>
                      <small v-if="!filters.outlet_id" class="text-muted">{{ m.outlet_name }}</small>
                    </td>
                    <td>
                      <StatusBadge :tone="reasonTone(m.reason)">
                        {{ m.reason || "—" }}
                      </StatusBadge>
                    </td>
                    <td class="text-end fw-semibold" :class="Number(m.qty_delta) < 0 ? 'text-danger' : 'text-success'">
                      {{ Number(m.qty_delta) >= 0 ? '+' : '' }}{{ fmtQty(m.qty_delta) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
    </template>
    </div>
    <!-- /zoom wrapper -->

    <!-- Quick Adjust Modal -->
    <div class="modal fade" id="quickAdjustModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content" v-if="adjusting">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="ri-add-circle-line text-primary me-2"></i>Quick Adjust Stock
            </h5>
            <button type="button" class="btn-close" @click="closeAdjust"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3 p-3 bg-light rounded">
              <div class="fw-bold">{{ adjusting.item_name }}</div>
              <div class="small text-muted">{{ adjusting.outlet_name }}</div>
              <div class="d-flex gap-3 mt-2 small">
                <div>On hand: <strong>{{ fmtQty(adjusting.on_hand) }} {{ adjusting.uom_code || "" }}</strong></div>
                <div v-if="adjusting.reorder_level != null">Par: <strong>{{ fmtQty(adjusting.reorder_level) }}</strong></div>
              </div>
            </div>

            <div class="row g-2">
              <div class="col-12 col-md-7">
                <label class="form-label small">Qty change (+ in / − out)</label>
                <input
                  v-model="adjustForm.qty_delta"
                  type="number"
                  step="any"
                  class="form-control"
                  placeholder="e.g. 10 or -2"
                  autofocus
                />
              </div>
              <div class="col-12 col-md-5">
                <label class="form-label small">Reason</label>
                <select v-model="adjustForm.reason" class="form-select">
                  <option value="RESTOCK">Restock</option>
                  <option value="ADJUSTMENT">Adjustment</option>
                  <option value="WASTE">Waste/Spoilage</option>
                  <option value="TRANSFER_IN">Transfer In</option>
                  <option value="TRANSFER_OUT">Transfer Out</option>
                  <option value="COUNT_CORRECTION">Count Correction</option>
                </select>
              </div>
              <div class="col-12">
                <label class="form-label small">Note (optional)</label>
                <input v-model="adjustForm.note" type="text" class="form-control" placeholder="e.g. supplier delivery #1234" />
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-light" @click="closeAdjust" :disabled="savingAdjust">Cancel</button>
            <button class="btn btn-primary" @click="submitAdjust" :disabled="savingAdjust">
              <span v-if="savingAdjust" class="spinner-border spinner-border-sm me-1"></span>
              Save Adjustment
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== PO Suggestions Modal ============== -->
    <div class="modal fade" id="poSuggestionsModal" tabindex="-1">
      <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content" v-if="poModalOpen">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="ri-magic-line text-success me-2"></i>
              Auto-Suggested Purchase Orders
            </h5>
            <button type="button" class="btn-close" @click="closePoSuggestions"></button>
          </div>

          <div class="modal-body">
            <div class="d-flex flex-wrap gap-2 align-items-end mb-3">
              <div>
                <label class="form-label small mb-1 text-muted">Buffer (over par)</label>
                <select v-model.number="poBufferPct" class="form-select form-select-sm" @change="loadSuggestions" style="min-width:160px">
                  <option :value="0">No buffer (close gap exactly)</option>
                  <option :value="10">+10% safety</option>
                  <option :value="20">+20% safety</option>
                  <option :value="50">+50% safety</option>
                  <option :value="100">2× the gap</option>
                </select>
              </div>
              <div class="ms-auto small text-muted">
                <span v-if="poSuggestions">{{ poSuggestions.total_low_stock_items }} low-stock item{{ poSuggestions.total_low_stock_items === 1 ? '' : 's' }} found</span>
              </div>
            </div>

            <LoadingState v-if="poLoading" label="Building suggestions…" />

            <template v-else-if="poSuggestions">
              <EmptyState
                v-if="!poGroupsState.length && !poSuggestions.items_without_supplier?.length"
                icon="ri-checkbox-circle-line"
                title="Stock is healthy"
                message="No items below par level for this outlet."
              />

              <!-- supplier groups -->
              <div v-for="(g, gi) in poGroupsState" :key="g.supplier_id" class="po-group mb-3">
                <div class="po-group-head">
                  <div class="form-check me-2">
                    <input
                      type="checkbox"
                      class="form-check-input"
                      :checked="g.include"
                      @change="toggleGroup(g)"
                    />
                  </div>
                  <div class="flex-grow-1">
                    <div class="fw-bold">{{ g.supplier_name || `Supplier #${g.supplier_id}` }}</div>
                    <small class="text-muted">{{ poGroupSelectedCount(g) }} of {{ g.lines.length }} item{{ g.lines.length === 1 ? '' : 's' }}</small>
                  </div>
                  <div class="text-end">
                    <div class="small text-muted">Estimated total</div>
                    <div class="fw-bold">K {{ fmtMoney(poGroupTotal(g)) }}</div>
                  </div>
                </div>

                <table class="table table-sm align-middle mb-0">
                  <thead class="table-light">
                    <tr>
                      <th style="width:36px"></th>
                      <th>Item</th>
                      <th class="text-end">On hand</th>
                      <th class="text-end">Par</th>
                      <th class="text-end">Order qty</th>
                      <th>UoM</th>
                      <th class="text-end">Last price</th>
                      <th class="text-end">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="line in g.lines" :key="line.inventory_item_id">
                      <td>
                        <input type="checkbox" class="form-check-input" v-model="line.included" />
                      </td>
                      <td>
                        <div class="fw-semibold">{{ line.item_name }}</div>
                        <small v-if="line.item_sku" class="text-muted">{{ line.item_sku }}</small>
                      </td>
                      <td class="text-end">{{ fmtQty(line.on_hand) }}</td>
                      <td class="text-end text-muted">{{ fmtQty(line.reorder_level) }}</td>
                      <td class="text-end">
                        <input
                          v-model="line.suggested_qty"
                          type="number"
                          step="any"
                          min="0"
                          class="form-control form-control-sm text-end"
                          style="width: 100px; display:inline-block;"
                          :disabled="!line.included"
                        />
                      </td>
                      <td class="small">{{ line.uom_code || '—' }}</td>
                      <td class="text-end">K {{ fmtMoney(line.last_price ?? 0) }}</td>
                      <td class="text-end fw-semibold">
                        K {{ fmtMoney((Number(line.suggested_qty) || 0) * (Number(line.last_price) || 0)) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- orphans (no supplier price on file) -->
              <div v-if="poSuggestions.items_without_supplier?.length" class="po-group po-orphans mb-2">
                <div class="po-group-head">
                  <i class="ri-error-warning-line text-warning me-2 fs-5"></i>
                  <div class="flex-grow-1">
                    <div class="fw-bold">No supplier on file</div>
                    <small class="text-muted">
                      These items are below par but have no active supplier price.
                      Add one in Purchasing → Supplier Prices, then regenerate.
                    </small>
                  </div>
                </div>
                <table class="table table-sm align-middle mb-0">
                  <thead class="table-light">
                    <tr>
                      <th>Item</th>
                      <th class="text-end">On hand</th>
                      <th class="text-end">Par</th>
                      <th class="text-end">Suggested qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="line in poSuggestions.items_without_supplier" :key="line.inventory_item_id">
                      <td>
                        <div class="fw-semibold">{{ line.item_name }}</div>
                        <small v-if="line.item_sku" class="text-muted">{{ line.item_sku }}</small>
                      </td>
                      <td class="text-end">{{ fmtQty(line.on_hand) }}</td>
                      <td class="text-end text-muted">{{ fmtQty(line.reorder_level) }}</td>
                      <td class="text-end">{{ fmtQty(line.suggested_qty) }} {{ line.uom_code || '' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>

          <div class="modal-footer">
            <div class="me-auto d-flex align-items-center gap-3">
              <div class="small text-muted">
                <span v-if="poTotalToCreate > 0">
                  Will create <strong>{{ poTotalToCreate }}</strong> PO{{ poTotalToCreate === 1 ? '' : 's' }}
                </span>
              </div>
              <div class="form-check form-switch mb-0">
                <input
                  v-model="poAutoSend"
                  class="form-check-input"
                  type="checkbox"
                  id="poAutoSendToggle"
                  :disabled="poSubmitting"
                />
                <label class="form-check-label small" for="poAutoSendToggle" :title="'Skip the DRAFT review step — POs are sent to suppliers immediately'">
                  Auto-send to suppliers
                </label>
              </div>
            </div>
            <button class="btn btn-light" @click="closePoSuggestions" :disabled="poSubmitting">Cancel</button>
            <button
              class="btn btn-success"
              @click="submitPoCreate"
              :disabled="poSubmitting || poLoading || poTotalToCreate === 0"
            >
              <span v-if="poSubmitting" class="spinner-border spinner-border-sm me-1"></span>
              <i v-else :class="poAutoSend ? 'ri-send-plane-line me-1' : 'ri-file-add-line me-1'"></i>
              {{ poAutoSend ? 'Create & Send POs' : 'Create Draft POs' }}
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
  background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 60%, #8b5cf6 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(14, 165, 233, 0.55);
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
.hero-title {
  font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800;
  letter-spacing: -0.025em; font-size: 1.85rem; margin: 0; color: #fff;
}
.hero-sub { color: rgba(255,255,255,0.85); margin: 0.35rem 0 0; font-size: 0.9rem; }
.page-hero-actions { position: relative; display: flex; gap: 0.5rem; flex-wrap: wrap; }
.btn-pill { border-radius: 999px !important; display: inline-flex; align-items: center; gap: 0.4rem; }
.page-hero-actions .btn-light { background: rgba(255,255,255,0.95); color: #1e293b; border: none; }
.page-hero-actions .btn-light:hover { background: #fff; color: #1e293b; }
.btn-cta {
  background: #fff !important; color: #6366f1 !important;
  font-weight: 700; border: none;
  box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3);
}
.btn-cta:hover { background: #fff !important; color: #4f46e5 !important; }
.btn-cta:disabled { opacity: 0.55; cursor: not-allowed; }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}

/* ============= Toolbar ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(99,102,241,0.04) 0%, transparent 100%); }

/* ============= Section tables (Out/Low/Movers/Recent) ============= */
/* Each section gets its own internal scroll so cards stay viewport-bound */
.section-scroll {
  max-height: 380px;
  overflow: auto;
  scrollbar-width: thin;
}
.section-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.section-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }
.section-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.5); }

.section-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc) !important;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}

/* ============= PO suggestions panel ============= */
.po-group {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px;
  overflow: hidden;
  background: var(--ct-card-bg, #fff);
}
.po-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--ct-tertiary-bg, #f8fafc);
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
}
.po-orphans { border-color: rgba(245, 158, 11, 0.4); }
.po-orphans .po-group-head {
  background: rgba(245, 158, 11, 0.08);
  border-bottom-color: rgba(245, 158, 11, 0.3);
}

/* Modal polish (legacy modals — keep them clean alongside the new look) */
:deep(#quickAdjustModal .modal-content),
:deep(#poSuggestionsModal .modal-content) {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 22px !important;
  overflow: hidden;
  box-shadow: 0 30px 60px -20px rgba(15,23,42,0.35);
}
:deep(#quickAdjustModal .modal-header),
:deep(#poSuggestionsModal .modal-header) {
  padding: 1.1rem 1.5rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
}
:deep(#quickAdjustModal .modal-title),
:deep(#poSuggestionsModal .modal-title) {
  font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800;
  letter-spacing: -0.02em; font-size: 1.15rem;
}
/* Scroll polish for both modals' bodies */
:deep(#quickAdjustModal .modal-body),
:deep(#poSuggestionsModal .modal-body) { scrollbar-width: thin; }
:deep(#quickAdjustModal .modal-body)::-webkit-scrollbar,
:deep(#poSuggestionsModal .modal-body)::-webkit-scrollbar { width: 8px; }
:deep(#quickAdjustModal .modal-body)::-webkit-scrollbar-thumb,
:deep(#poSuggestionsModal .modal-body)::-webkit-scrollbar-thumb {
  background: rgba(100,116,139,0.3); border-radius: 999px;
}
</style>
