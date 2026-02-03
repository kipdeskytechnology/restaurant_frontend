<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import { listInventoryItems } from "../../api/inventory";
import { listUoms } from "../../api/lookups";
import {
  listSuppliers,
  getPurchaseOrder,
  updatePurchaseOrder,
  replacePurchaseOrderItems,
  sendPurchaseOrder,
  cancelPurchaseOrder,
} from "../../api/purchasing";
import http from "../../api/http";

const toast = useToast();
const route = useRoute();
const router = useRouter();
const id = computed(() => Number(route.params.id));

const loading = ref(true);
const saving = ref(false);
const actioning = ref(false);

const suppliers = ref([]);
const itemsMaster = ref([]);
const uoms = ref([]);
const outlets = ref([]);

const outletNameById = computed(() => {
  const m = new Map();
  for (const o of outlets.value) m.set(o.id, o.name);
  return m;
});

const uomLabelById = computed(() => {
  const m = new Map();
  for (const u of uoms.value) m.set(u.id, `${u.code} - ${u.name}`);
  return m;
});

const itemLabelById = computed(() => {
  const m = new Map();
  for (const it of itemsMaster.value) m.set(it.id, it.name);
  return m;
});

const form = ref({
  supplier_id: "",
  outlet_id: "",
  status: "",
  po_number: "",
  note: "",
  items: [], // { inventory_item_id, qty, uom_id, unit_cost }
});

function normalizeNumber(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

const canEdit = computed(() => String(form.value.status || "").toUpperCase() === "DRAFT");

function statusBadgeClass(st) {
  const s = String(st || "").toUpperCase();
  if (s === "RECEIVED") return "bg-success";
  if (s === "PARTIAL") return "bg-warning";
  if (s === "SENT") return "bg-primary";
  if (s === "CANCELLED") return "bg-danger";
  return "bg-secondary";
}

async function loadLookups() {
  const [sup, inv, uomList, outletsData] = await Promise.all([
    listSuppliers({ active: "1", limit: 500 }),
    // safe filters
    listInventoryItems({ limit: 500, active: "all", track: "all" }),
    listUoms(),
    http.get("/system/outlets").then((r) => r.data),
  ]);

  suppliers.value = Array.isArray(sup) ? sup : [];
  itemsMaster.value = Array.isArray(inv) ? inv : [];
  uoms.value = Array.isArray(uomList) ? uomList : [];
  outlets.value = Array.isArray(outletsData) ? outletsData : [];
}

async function loadPO() {
  const data = await getPurchaseOrder(id.value);

  form.value = {
    supplier_id: data?.supplier_id ?? "",
    outlet_id: data?.outlet_id ?? "",
    status: data?.status ?? "",
    po_number: data?.po_number ?? "",
    note: data?.note ?? "",
    items: (data?.items || []).map((x) => ({
      inventory_item_id: x.inventory_item_id,
      qty: x.qty,
      uom_id: x.uom_id,
      unit_cost: x.unit_cost,
    })),
  };
}

async function init() {
  loading.value = true;
  try {
    await loadLookups();
    await loadPO();
  } catch (e) {
    toast.error(e?.response?.data?.detail || e?.message || "Failed to load purchase order");
  } finally {
    loading.value = false;
  }
}

/* Add Line Modal state */
const newLine = ref({
  inventory_item_id: "",
  qty: 1,
  uom_id: "",
  unit_cost: 0,
});

function bsModal(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const b = window.bootstrap;
  if (!b?.Modal) return null;
  return b.Modal.getOrCreateInstance(el);
}

function prepareAddLine() {
  const first = itemsMaster.value?.[0];
  if (!first) return toast.warning("No inventory items found");

  newLine.value = {
    inventory_item_id: first.id,
    qty: 1,
    uom_id: first.base_uom_id,
    unit_cost: 0,
  };

  bsModal("addLineModal")?.show();
}

function onNewLineItemChange() {
  const it = itemsMaster.value.find((x) => x.id === Number(newLine.value.inventory_item_id));
  if (it) newLine.value.uom_id = it.base_uom_id;
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

  // backend forbids duplicates
  if (form.value.items.some((x) => Number(x.inventory_item_id) === payload.inventory_item_id)) {
    return toast.error("This item already exists in the PO lines");
  }

  form.value.items.push(payload);
  bsModal("addLineModal")?.hide();
}

function removeLine(idx) {
  form.value.items.splice(idx, 1);
}

async function save() {
  saving.value = true;
  try {
    if (!form.value.supplier_id) return toast.error("Supplier is required");
    if (!form.value.items.length) return toast.error("Add at least 1 item");

    await updatePurchaseOrder(id.value, {
      supplier_id: Number(form.value.supplier_id),
      note: form.value.note?.trim() || null,
    });

    const itemsPayload = form.value.items.map((x) => ({
      inventory_item_id: Number(x.inventory_item_id),
      qty: normalizeNumber(x.qty),
      uom_id: Number(x.uom_id),
      unit_cost: normalizeNumber(x.unit_cost),
    }));

    await replacePurchaseOrderItems(id.value, itemsPayload);

    toast.success("Saved");
    await loadPO();
  } catch (e) {
    toast.error(e?.response?.data?.detail || e?.message || "Failed to save purchase order");
  } finally {
    saving.value = false;
  }
}

async function doSend() {
  actioning.value = true;
  try {
    await sendPurchaseOrder(id.value);
    toast.success("Sent");
    await loadPO();
  } catch (e) {
    toast.error(e?.response?.data?.detail || e?.message || "Failed to send");
  } finally {
    actioning.value = false;
  }
}

async function doCancel() {
  actioning.value = true;
  try {
    await cancelPurchaseOrder(id.value);
    toast.success("Cancelled");
    await loadPO();
  } catch (e) {
    toast.error(e?.response?.data?.detail || e?.message || "Failed to cancel");
  } finally {
    actioning.value = false;
  }
}

onMounted(init);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div class="d-flex align-items-center gap-2">
        <h4 class="page-title mb-0">Purchase Order</h4>
        <span class="badge" :class="statusBadgeClass(form.status)">{{ form.status }}</span>
        <span class="text-muted ms-2">{{ form.po_number }}</span>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-light" @click="router.back()">Back</button>

        <button class="btn btn-primary" :disabled="loading || saving || !canEdit" @click="save">
          <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
          Save
        </button>

        <button class="btn btn-soft-primary" :disabled="loading || actioning || !canEdit" @click="doSend">
          Send
        </button>

        <button class="btn btn-soft-danger" :disabled="loading || actioning" @click="doCancel">
          Cancel
        </button>
      </div>
    </div>

    <div v-if="loading" class="card" style="zoom: 80%;">
      <div class="card-body">Loading...</div>
    </div>

    <div v-else class="card" style="zoom: 80%;">
      <div class="card-body">
        <div class="row g-3">
          <div class="col-md-4">
            <label class="form-label">Outlet</label>
            <input class="form-control" :value="outletNameById.get(form.outlet_id) || `Outlet #${form.outlet_id}`" disabled />
          </div>

          <div class="col-md-4">
            <label class="form-label">Supplier</label>
            <select class="form-select" v-model="form.supplier_id" :disabled="!canEdit">
              <option value="">Select supplier</option>
              <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>

          <div class="col-md-4">
            <label class="form-label">Status</label>
            <input class="form-control" :value="form.status" disabled />
          </div>

          <div class="col-12">
            <label class="form-label">Note</label>
            <textarea class="form-control" rows="2" v-model="form.note" :disabled="!canEdit"></textarea>
          </div>
        </div>

        <hr class="my-3" />

        <div class="d-flex justify-content-between align-items-center mb-2">
          <h5 class="mb-0">Items</h5>
          <button class="btn btn-sm btn-secondary" :disabled="!canEdit" @click="prepareAddLine">
            Add Line
          </button>
        </div>

        <div class="table-responsive">
          <table class="table table-sm table-bordered align-middle mb-0">
            <thead class="table-light">
              <tr>
                <th style="width: 60px">#</th>
                <th>Item</th>
                <th style="width: 140px">Qty</th>
                <th style="width: 180px">UOM</th>
                <th style="width: 160px">Unit Cost</th>
                <th style="width: 160px" class="text-end">Line Total</th>
                <th style="width: 110px"></th>
              </tr>
            </thead>

            <tbody>
              <tr v-if="form.items.length === 0">
                <td colspan="7" class="text-muted text-center py-3">No lines</td>
              </tr>

              <tr v-for="(ln, idx) in form.items" :key="idx">
                <td>{{ idx + 1 }}</td>
                <td>{{ itemLabelById.get(ln.inventory_item_id) || `Item #${ln.inventory_item_id}` }}</td>

                <td>
                  <input
                    class="form-control form-control-sm"
                    type="number"
                    step="0.000001"
                    v-model="ln.qty"
                    :disabled="!canEdit"
                  />
                </td>

                <td>
                  <span class="badge bg-light text-dark">
                    {{ uomLabelById.get(ln.uom_id) || `UOM #${ln.uom_id}` }}
                  </span>
                </td>

                <td>
                  <input
                    class="form-control form-control-sm"
                    type="number"
                    step="0.0001"
                    v-model="ln.unit_cost"
                    :disabled="!canEdit"
                  />
                </td>

                <td class="text-end">
                  {{ money((Number(ln.qty) || 0) * (Number(ln.unit_cost) || 0)) }}
                </td>

                <td class="text-end">
                  <button class="btn btn-sm btn-soft-danger" :disabled="!canEdit" @click="removeLine(idx)">
                    Remove
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>

    <!-- Add Line Modal -->
    <div class="modal fade" id="addLineModal" tabindex="-1" role="dialog" aria-hidden="true" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header bg-light">
            <h4 class="modal-title">Add Line</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true"></button>
          </div>

          <div class="modal-body">
            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label">Inventory Item</label>
                <select class="form-select" v-model="newLine.inventory_item_id" @change="onNewLineItemChange">
                  <option v-for="it in itemsMaster" :key="it.id" :value="it.id">
                    {{ it.name }}
                  </option>
                </select>
              </div>

              <div class="col-md-3">
                <label class="form-label">Qty</label>
                <input class="form-control" type="number" step="0.000001" v-model="newLine.qty" />
              </div>

              <div class="col-md-3">
                <label class="form-label">Unit Cost</label>
                <input class="form-control" type="number" step="0.0001" v-model="newLine.unit_cost" />
              </div>

              <div class="col-md-6">
                <label class="form-label">UOM</label>
                <input
                  class="form-control"
                  :value="uomLabelById.get(newLine.uom_id) || newLine.uom_id"
                  disabled
                />
              </div>
            </div>

            <small class="text-muted d-block mt-2">
              UOM is set to the selected item's Base UOM.
            </small>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" @click="addLineToForm">Add</button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
