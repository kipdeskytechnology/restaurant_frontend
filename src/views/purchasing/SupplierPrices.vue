<!-- src/views/purchasing/SupplierPrices.vue -->
<script setup>
import { ref, computed, onMounted } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import SearchSelect from "../../components/SearchSelect.vue";

import http from "../../api/http";
import { listSuppliers, lookupSupplierPrice } from "../../api/purchasing";
import { listInventoryItems } from "../../api/inventory";
import { listUoms } from "../../api/lookups";

const toast = useToast();

const outlets = ref([]);
const suppliers = ref([]);
const items = ref([]);
const uoms = ref([]);

const form = ref({
  outlet_id: null,
  supplier_id: null,
  inventory_item_id: null,
  uom_id: null,
});

const result = ref(null);
const loading = ref(false);
const initialLoading = ref(true);

const outletOptions = computed(() =>
  (outlets.value || []).map((o) => ({ label: o.name || `Outlet #${o.id}`, value: Number(o.id) }))
);
const supplierOptions = computed(() =>
  (suppliers.value || []).map((s) => ({ label: s.name || `Supplier #${s.id}`, value: Number(s.id) }))
);
const itemOptions = computed(() =>
  (items.value || []).map((it) => ({
    label: it.sku ? `${it.sku} — ${it.name}` : it.name || `Item #${it.id}`,
    value: Number(it.id),
  }))
);
const uomOptions = computed(() =>
  (uoms.value || []).map((u) => ({ label: `${u.code} — ${u.name}`, value: Number(u.id) }))
);

const canLookup = computed(
  () => !!(form.value.outlet_id && form.value.supplier_id && form.value.inventory_item_id && form.value.uom_id)
);

const selected = computed(() => {
  return {
    outlet: outlets.value.find((o) => Number(o.id) === Number(form.value.outlet_id)) || null,
    supplier: suppliers.value.find((s) => Number(s.id) === Number(form.value.supplier_id)) || null,
    item: items.value.find((it) => Number(it.id) === Number(form.value.inventory_item_id)) || null,
    uom: uoms.value.find((u) => Number(u.id) === Number(form.value.uom_id)) || null,
  };
});

async function loadLookups() {
  initialLoading.value = true;
  try {
    const [out, sup, inv, uomList] = await Promise.all([
      http.get("/system/outlets").then((r) => r.data),
      listSuppliers({ limit: 2000 }),
      listInventoryItems({ limit: 2000 }),
      listUoms(),
    ]);
    outlets.value = Array.isArray(out) ? out : [];
    suppliers.value = Array.isArray(sup) ? sup : [];
    items.value = Array.isArray(inv) ? inv : [];
    uoms.value = Array.isArray(uomList) ? uomList : [];
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load lookups");
  } finally {
    initialLoading.value = false;
  }
}

async function lookup() {
  if (!canLookup.value) return;
  loading.value = true;
  result.value = null;
  try {
    result.value = await lookupSupplierPrice({
      outlet_id: Number(form.value.outlet_id),
      supplier_id: Number(form.value.supplier_id),
      inventory_item_id: Number(form.value.inventory_item_id),
      uom_id: Number(form.value.uom_id),
    });
  } catch (e) {
    result.value = null;
    toast.error(e?.response?.data?.detail || "Lookup failed");
  } finally {
    loading.value = false;
  }
}

function clearForm() {
  form.value = { outlet_id: null, supplier_id: null, inventory_item_id: null, uom_id: null };
  result.value = null;
}

const fmtMoney = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
};

onMounted(loadLookups);
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-price-tag-line"></i><span>Purchasing</span>
          </div>
          <h1 class="hero-title">Supplier Prices</h1>
          <p class="hero-sub">
            Look up the last-known price a supplier charged you for an item at a given outlet — useful before generating a PO or negotiating.
          </p>
        </div>
      </div>

      <!-- ============== Lookup form ============== -->
      <div class="row g-3">
        <div class="col-lg-7">
          <div class="card panel-card position-relative">
            <div class="panel-head">
              <div class="d-flex align-items-center gap-2">
                <span class="ns-icon"><i class="ri-search-line"></i></span>
                <div>
                  <div class="panel-eyebrow">Query</div>
                  <div class="panel-title">Lookup parameters</div>
                </div>
              </div>
            </div>

            <div v-if="initialLoading" class="card-body d-flex align-items-center gap-2">
              <div class="spinner-border spinner-border-sm" role="status"></div>
              <div class="text-muted">Loading lookups…</div>
            </div>

            <div v-else class="card-body">
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label">Outlet</label>
                  <SearchSelect
                    v-model="form.outlet_id"
                    :options="outletOptions"
                    placeholder="Select outlet…"
                    :clearable="true"
                    :searchable="true"
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Supplier</label>
                  <SearchSelect
                    v-model="form.supplier_id"
                    :options="supplierOptions"
                    placeholder="Select supplier…"
                    :clearable="true"
                    :searchable="true"
                  />
                </div>
                <div class="col-md-7">
                  <label class="form-label">Item</label>
                  <SearchSelect
                    v-model="form.inventory_item_id"
                    :options="itemOptions"
                    placeholder="Select item…"
                    :clearable="true"
                    :searchable="true"
                  />
                </div>
                <div class="col-md-5">
                  <label class="form-label">UOM</label>
                  <SearchSelect
                    v-model="form.uom_id"
                    :options="uomOptions"
                    placeholder="Select UOM…"
                    :clearable="true"
                    :searchable="true"
                  />
                </div>

                <div class="col-12 d-flex gap-2">
                  <button class="btn btn-primary" :disabled="loading || !canLookup" @click="lookup">
                    <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>
                    <i v-else class="ri-search-line me-1"></i>
                    Lookup price
                  </button>
                  <button class="btn btn-light" :disabled="loading" @click="clearForm">
                    <i class="ri-filter-off-line me-1"></i>Clear
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Result card -->
        <div class="col-lg-5">
          <div class="result-card" :class="result ? 'has-result' : 'no-result'">
            <div class="result-eyebrow">
              <i :class="result ? 'ri-check-double-line' : 'ri-information-line'"></i>
              <span>{{ result ? 'Last price found' : 'Awaiting lookup' }}</span>
            </div>

            <div v-if="result && result.last_price !== null && result.last_price !== undefined" class="result-amount">
              <span class="result-currency">K</span>
              <span class="result-value">{{ fmtMoney(result.last_price) }}</span>
            </div>
            <div v-else-if="result" class="result-empty">
              <i class="ri-question-line"></i>
              <div>
                <div class="fw-semibold">No price recorded</div>
                <div class="small text-muted">No prior receipts for this combination — you'll be quoting fresh.</div>
              </div>
            </div>
            <div v-else class="result-hint">
              <div class="hint-icon"><i class="ri-arrow-left-line"></i></div>
              <div>Pick all four parameters and click <strong>Lookup price</strong>.</div>
            </div>

            <div v-if="result" class="result-meta mt-3">
              <div v-if="selected.item" class="meta-row">
                <i class="ri-archive-line"></i>
                <span class="meta-key">Item</span>
                <span class="meta-val">{{ selected.item.name }}</span>
              </div>
              <div v-if="selected.uom" class="meta-row">
                <i class="ri-ruler-2-line"></i>
                <span class="meta-key">UOM</span>
                <span class="meta-val">{{ selected.uom.code }} — {{ selected.uom.name }}</span>
              </div>
              <div v-if="selected.supplier" class="meta-row">
                <i class="ri-store-3-line"></i>
                <span class="meta-key">Supplier</span>
                <span class="meta-val">{{ selected.supplier.name }}</span>
              </div>
              <div v-if="selected.outlet" class="meta-row">
                <i class="ri-store-2-line"></i>
                <span class="meta-key">Outlet</span>
                <span class="meta-val">{{ selected.outlet.name }}</span>
              </div>
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

/* ============= Panel cards ============= */
.panel-card {
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 18px;
  overflow: visible;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.panel-head {
  padding: 1rem 1.25rem;
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
.panel-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; letter-spacing: -0.02em;
  font-size: 1.05rem;
  color: var(--ct-body-color, #0f172a);
}

/* SearchSelect dropdowns escape the card */
:deep(.vs__dropdown-menu),
:deep(.search-select__menu),
:deep(.search-select__dropdown) { z-index: 9999 !important; }

/* ============= Result card ============= */
.result-card {
  position: relative;
  padding: 1.5rem;
  border-radius: 18px;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  min-height: 340px;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.result-card.has-result {
  background: linear-gradient(135deg, rgba(13,148,136,0.05) 0%, transparent 60%);
  border-color: rgba(13,148,136,0.3);
}
.result-card.no-result {
  background: var(--ct-tertiary-bg, #f8fafc);
  border-style: dashed;
}
.result-eyebrow {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  background: rgba(13,148,136,0.12);
  color: #0d9488;
  border-radius: 999px;
  font-size: 0.68rem; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase;
  align-self: flex-start;
  margin-bottom: 1rem;
}
.result-card.no-result .result-eyebrow {
  background: rgba(100,116,139,0.12); color: #64748b;
}
.result-amount {
  display: flex; align-items: baseline; gap: 0.4rem;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #0d9488;
}
.result-currency { font-size: 1.4rem; }
.result-value { font-size: 2.4rem; line-height: 1; }
.result-empty {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 1rem;
  background: rgba(245,158,11,0.08);
  border: 1px solid rgba(245,158,11,0.25);
  border-radius: 12px;
  color: #b45309;
}
.result-empty i { font-size: 1.5rem; flex-shrink: 0; }
.result-hint {
  display: flex; align-items: center; gap: 0.65rem;
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.88rem;
  margin-top: auto;
  padding: 1rem;
  background: var(--ct-card-bg, #fff);
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
}
.hint-icon {
  width: 32px; height: 32px;
  border-radius: 8px;
  display: grid; place-items: center;
  background: rgba(13,148,136,0.1); color: #0d9488;
  flex-shrink: 0;
}

.result-meta {
  display: flex; flex-direction: column; gap: 0.4rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--ct-border-color, #e6e9ef);
}
.meta-row {
  display: grid;
  grid-template-columns: 20px auto 1fr;
  gap: 0.5rem;
  align-items: center;
  font-size: 0.82rem;
}
.meta-row i { color: #0d9488; }
.meta-key {
  font-size: 0.7rem; font-weight: 700;
  color: var(--ct-secondary-color, #64748b);
  text-transform: uppercase; letter-spacing: 0.06em;
}
.meta-val {
  font-weight: 600;
  color: var(--ct-body-color, #0f172a);
  text-align: right;
}

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
  .result-value { font-size: 2rem; }
}
</style>
