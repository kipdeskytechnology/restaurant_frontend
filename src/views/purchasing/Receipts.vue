<script setup>
import { ref, computed, onMounted, watch } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import http from "../../api/http";

import {
  listReceipts,
  createReceipt,
  listPurchaseOrders,
} from "../../api/purchasing";

const toast = useToast();

const loading = ref(true);
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

async function loadOutlets() {
  const data = await http.get("/system/outlets").then((r) => r.data);
  outlets.value = Array.isArray(data) ? data : [];
}

async function loadPOs() {
  // only for dropdown (limit)
  const data = await listPurchaseOrders({ limit: 200, status: "all" });
  purchaseOrders.value = Array.isArray(data) ? data : [];
}

async function loadReceipts() {
  loading.value = true;
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
  }
}

function bsModal(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const b = window.bootstrap;
  if (!b?.Modal) return null;
  return b.Modal.getOrCreateInstance(el);
}

const createForm = ref({
  outlet_id: "",
  purchase_order_id: "",
  note: "",
});

function openCreate() {
  createForm.value = {
    outlet_id: outlets.value?.[0]?.id ? String(outlets.value[0].id) : "",
    purchase_order_id: "",
    note: "",
  };
  bsModal("createReceiptModal")?.show();
}

async function createNewReceipt() {
  saving.value = true;
  try {
    if (!createForm.value.outlet_id) {
      toast.error("Outlet is required");
      return;
    }

    const payload = {
      outlet_id: Number(createForm.value.outlet_id),
      purchase_order_id: createForm.value.purchase_order_id
        ? Number(createForm.value.purchase_order_id)
        : null,
      note: createForm.value.note?.trim() || null,
    };

    await createReceipt(payload);
    toast.success("Receipt created");
    bsModal("createReceiptModal")?.hide();
    await loadReceipts();
  } catch (e) {
    toast.error(e?.response?.data?.detail || e?.message || "Failed to create receipt");
  } finally {
    saving.value = false;
  }
}

let t = null;
watch(
  () => [filters.value.outlet_id, filters.value.po_id],
  () => {
    clearTimeout(t);
    t = setTimeout(() => loadReceipts(), 200);
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
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <h4 class="page-title mb-0">Purchase Receipts</h4>
      <button class="btn btn-primary" @click="openCreate">
        <i class="uil-plus me-1"></i> New Receipt
      </button>
    </div>

    <div class="card mb-3" style="zoom: 80%;">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-4">
            <label class="form-label">Outlet</label>
            <select class="form-select" v-model="filters.outlet_id">
              <option value="">All outlets</option>
              <option v-for="o in outlets" :key="o.id" :value="String(o.id)">{{ o.name }}</option>
            </select>
          </div>

          <div class="col-md-6">
            <label class="form-label">Purchase Order</label>
            <select class="form-select" v-model="filters.po_id">
              <option value="">All POs</option>
              <option v-for="po in purchaseOrders" :key="po.id" :value="String(po.id)">
                {{ po.po_number }} — {{ po.supplier?.name || `Supplier #${po.supplier_id}` }}
              </option>
            </select>
          </div>

          <div class="col-md-2 d-grid">
            <button class="btn btn-secondary" :disabled="loading" @click="loadReceipts">Refresh</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="zoom: 80%;">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-sm table-bordered align-middle mb-0">
            <thead class="table-light">
              <tr>
                <th style="width: 100px;">ID</th>
                <th style="width: 220px;">Outlet</th>
                <th style="width: 220px;">PO</th>
                <th>Note</th>
                <th style="width: 220px;">Received At</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!loading && rows.length === 0">
                <td colspan="5" class="text-center text-muted py-3">No receipts found</td>
              </tr>

              <tr v-for="r in rows" :key="r.id">
                <td>{{ r.id }}</td>
                <td>{{ outletNameById.get(r.outlet_id) || `Outlet #${r.outlet_id}` }}</td>
                <td>{{ r.purchase_order?.po_number || "-" }}</td>
                <td class="text-muted">{{ r.note || "-" }}</td>
                <td>{{ r.received_at ? new Date(r.received_at).toLocaleString() : "-" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Create Receipt Modal -->
    <div class="modal fade" id="createReceiptModal" tabindex="-1" role="dialog" aria-hidden="true" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header bg-light">
            <h4 class="modal-title">New Receipt</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true"></button>
          </div>

          <div class="modal-body">
            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label">Outlet</label>
                <select class="form-select" v-model="createForm.outlet_id">
                  <option value="">Select outlet</option>
                  <option v-for="o in outlets" :key="o.id" :value="String(o.id)">{{ o.name }}</option>
                </select>
              </div>

              <div class="col-md-6">
                <label class="form-label">Purchase Order (optional)</label>
                <select class="form-select" v-model="createForm.purchase_order_id">
                  <option value="">None</option>
                  <option v-for="po in purchaseOrders" :key="po.id" :value="String(po.id)">
                    {{ po.po_number }} — {{ po.supplier?.name || `Supplier #${po.supplier_id}` }}
                  </option>
                </select>
              </div>

              <div class="col-12">
                <label class="form-label">Note</label>
                <textarea class="form-control" rows="2" v-model="createForm.note"></textarea>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button class="btn btn-primary" :disabled="saving" @click="createNewReceipt">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
