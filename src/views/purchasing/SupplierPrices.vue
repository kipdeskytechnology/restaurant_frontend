<!-- src/views/purchasing/SupplierPrices.vue -->
 <script setup>
import { ref, onMounted } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

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
  outlet_id: "",
  supplier_id: "",
  inventory_item_id: "",
  uom_id: "",
});

const result = ref(null);
const loading = ref(false);

async function loadLookups() {
  const [out, sup, inv, uomList] = await Promise.all([
    http.get("/system/outlets").then(r => r.data),
    listSuppliers({ limit: 2000 }),
    listInventoryItems({ limit: 2000 }),
    listUoms(),
  ]);
  outlets.value = Array.isArray(out) ? out : [];
  suppliers.value = Array.isArray(sup) ? sup : [];
  items.value = Array.isArray(inv) ? inv : [];
  uoms.value = Array.isArray(uomList) ? uomList : [];
}

async function lookup() {
  loading.value = true;
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

onMounted(loadLookups);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <h4 class="page-title mb-0">Supplier Prices</h4>
    </div>

    <div class="card" style="zoom: 80%;">
      <div class="card-body">
        <div class="row g-3">
          <div class="col-md-3">
            <label class="form-label">Outlet</label>
            <select class="form-select" v-model="form.outlet_id">
              <option value="">Select outlet</option>
              <option v-for="o in outlets" :key="o.id" :value="String(o.id)">{{ o.name }}</option>
            </select>
          </div>

          <div class="col-md-3">
            <label class="form-label">Supplier</label>
            <select class="form-select" v-model="form.supplier_id">
              <option value="">Select supplier</option>
              <option v-for="s in suppliers" :key="s.id" :value="String(s.id)">{{ s.name }}</option>
            </select>
          </div>

          <div class="col-md-3">
            <label class="form-label">Item</label>
            <select class="form-select" v-model="form.inventory_item_id">
              <option value="">Select item</option>
              <option v-for="it in items" :key="it.id" :value="String(it.id)">{{ it.name }}</option>
            </select>
          </div>

          <div class="col-md-3">
            <label class="form-label">UOM</label>
            <select class="form-select" v-model="form.uom_id">
              <option value="">Select uom</option>
              <option v-for="u in uoms" :key="u.id" :value="String(u.id)">{{ u.code }} - {{ u.name }}</option>
            </select>
          </div>

          <div class="col-12 d-flex gap-2">
            <button
              class="btn btn-primary"
              :disabled="loading || !form.outlet_id || !form.supplier_id || !form.inventory_item_id || !form.uom_id"
              @click="lookup"
            >
              <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>
              Lookup
            </button>
            <div v-if="result" class="d-flex align-items-center">
              <span class="badge bg-info me-2">Last Price</span>
              <span class="fw-semibold">
                {{ result.last_price === null || result.last_price === undefined ? "No price yet" : result.last_price }}
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  </DefaultLayout>
</template>
