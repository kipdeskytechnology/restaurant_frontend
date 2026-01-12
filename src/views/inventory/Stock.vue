<script setup>
import { ref, onMounted } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import { listStockBalances, adjustStock, listInventoryItems } from "../../api/inventory";
import { listOutlets } from "../../api/lookups";

const toast = useToast();

const loading = ref(true);
const rows = ref([]);
const outlets = ref([]);
const items = ref([]);

const filters = ref({
  outlet_id: "",
  item_id: "",
});

const saving = ref(false);
const adjustForm = ref({
  outlet_id: "",
  inventory_item_id: "",
  qty_delta: "",
  unit_cost: "",
  reason: "ADJUSTMENT",
  note: "",
});

function bsModal(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const b = window.bootstrap;
  if (!b?.Modal) return null;
  return b.Modal.getOrCreateInstance(el);
}

async function loadLookups() {
  const [o, it] = await Promise.all([listOutlets(), listInventoryItems({ limit: 500 })]);
  outlets.value = o;
  items.value = it;
}

async function loadBalances() {
  const params = {
    outlet_id: filters.value.outlet_id ? Number(filters.value.outlet_id) : undefined,
    item_id: filters.value.item_id ? Number(filters.value.item_id) : undefined,
  };
  rows.value = await listStockBalances(params);
}

async function load() {
  loading.value = true;
  try {
    await loadLookups();
    await loadBalances();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load stock balances");
  } finally {
    loading.value = false;
  }
}

function prepareAdjust() {
  adjustForm.value = {
    outlet_id: outlets.value?.[0]?.id || "",
    inventory_item_id: items.value?.[0]?.id || "",
    qty_delta: "",
    unit_cost: "",
    reason: "ADJUSTMENT",
    note: "",
  };
}

async function saveAdjust() {
  saving.value = true;
  try {
    const payload = {
      outlet_id: Number(adjustForm.value.outlet_id),
      inventory_item_id: Number(adjustForm.value.inventory_item_id),
      qty_delta: Number(adjustForm.value.qty_delta),
      unit_cost: adjustForm.value.unit_cost === "" ? null : Number(adjustForm.value.unit_cost),
      reason: adjustForm.value.reason?.trim() || "ADJUSTMENT",
      note: adjustForm.value.note?.trim() || null,
    };

    if (!payload.qty_delta || payload.qty_delta === 0) {
      toast.error("qty_delta cannot be 0");
      return;
    }

    await adjustStock(payload);
    toast.success("Stock adjusted");
    await loadBalances();

    bsModal("stockAdjustModal")?.hide();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to adjust stock");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between">
      <h4 class="page-title">Stock Balances</h4>
      <button
        type="button"
        class="btn btn-primary"
        data-bs-toggle="modal"
        data-bs-target="#stockAdjustModal"
        @click="prepareAdjust"
      >
        Adjust Stock
      </button>
    </div>

    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-5">
            <label class="form-label">Outlet</label>
            <select v-model="filters.outlet_id" class="form-select" @change="loadBalances">
              <option value="">All</option>
              <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
          </div>
          <div class="col-md-5">
            <label class="form-label">Item</label>
            <select v-model="filters.item_id" class="form-select" @change="loadBalances">
              <option value="">All</option>
              <option v-for="it in items" :key="it.id" :value="it.id">{{ it.name }}</option>
            </select>
          </div>
          <div class="col-md-2 d-grid">
            <button class="btn btn-outline-secondary" @click="loadBalances">Refresh</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="card"><div class="card-body">Loading...</div></div>

    <div v-else class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table table-sm align-middle">
            <thead>
              <tr>
                <th>Outlet</th>
                <th>Item</th>
                <th style="width: 160px" class="text-end">On Hand</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id">
                <td>{{ r.outlet?.name || r.outlet_id }}</td>
                <td>{{ r.item?.name || r.inventory_item_id }}</td>
                <td class="text-end">{{ r.on_hand }}</td>
              </tr>
              <tr v-if="rows.length === 0">
                <td colspan="3" class="text-center text-muted">No balances yet</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Bootstrap Center Modal -->
    <div class="modal fade" id="stockAdjustModal" tabindex="-1" role="dialog" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title">Adjust Stock</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true"></button>
          </div>

          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Outlet</label>
              <select v-model="adjustForm.outlet_id" class="form-select">
                <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
            </div>

            <div class="mb-3">
              <label class="form-label">Item</label>
              <select v-model="adjustForm.inventory_item_id" class="form-select">
                <option v-for="it in items" :key="it.id" :value="it.id">{{ it.name }}</option>
              </select>
            </div>

            <div class="mb-3">
              <label class="form-label">Qty Delta (negative = deduction)</label>
              <input v-model="adjustForm.qty_delta" type="number" step="0.000001" class="form-control" />
            </div>

            <div class="mb-3">
              <label class="form-label">Unit Cost (optional)</label>
              <input v-model="adjustForm.unit_cost" type="number" step="0.0001" class="form-control" />
            </div>

            <div class="mb-3">
              <label class="form-label">Reason</label>
              <input v-model="adjustForm.reason" class="form-control" />
            </div>

            <div class="mb-3">
              <label class="form-label">Note</label>
              <textarea v-model="adjustForm.note" class="form-control" rows="2"></textarea>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="saveAdjust">
              <span v-if="saving">Saving...</span>
              <span v-else>Save</span>
            </button>
          </div>
        </div><!-- /.modal-content -->
      </div><!-- /.modal-dialog -->
    </div><!-- /.modal -->
  </DefaultLayout>
</template>
