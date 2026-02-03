<!-- src/views/purchasing/ReceiptView.vue -->
 <script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

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

function uomLabel(id) {
  const u = uoms.value.find(x => x.id === id);
  return u ? `${u.code} - ${u.name}` : String(id);
}
function itemLabel(id) {
  const it = itemsMaster.value.find(x => x.id === id);
  return it ? it.name : String(id);
}

function addLine() {
  if (isPosted.value) return;
  lines.value.push({
    inventory_item_id: "",
    qty: "1",
    uom_id: uoms.value?.[0]?.id ? String(uoms.value[0].id) : "",
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
    http.get("/system/outlets").then(r => r.data),
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
      // display posted items
      lines.value = (receipt.value.items || []).map((x) => ({
        inventory_item_id: String(x.inventory_item_id),
        qty: String(x.qty),
        uom_id: String(x.uom_id),
        unit_cost: String(x.unit_cost),
      }));
    } else {
      // start from PO items if available
      if (po.value?.items?.length) {
        lines.value = po.value.items.map((x) => ({
          inventory_item_id: String(x.inventory_item_id),
          qty: String(x.qty),
          uom_id: String(x.uom_id),
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

  posting.value = true;
  try {
    if (!lines.value.length) {
      toast.error("Add at least 1 item");
      return;
    }

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

onMounted(async () => {
  await loadLookups();
  await load();
});
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Receipt #{{ receiptId }}</h4>
        <div class="text-muted">
          Outlet: {{ outlets.find(x => x.id === receipt?.outlet_id)?.name || receipt?.outlet_id }}
          <span class="ms-2">PO: {{ receipt?.purchase_order_id || "-" }}</span>
        </div>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-light" @click="router.back()">Back</button>
        <button class="btn btn-success" :disabled="posting || isPosted" @click="postReceipt">
          <span v-if="posting" class="spinner-border spinner-border-sm me-1"></span>
          Post to Stock
        </button>
      </div>
    </div>

    <div v-if="loading" class="card"><div class="card-body">Loading...</div></div>

    <template v-else>
      <div class="alert alert-warning" style="zoom: 80%;" v-if="!isPosted">
        Posting will update stock. After posting, editing is locked to avoid double-posting.
      </div>
      <div class="alert alert-success" style="zoom: 80%;" v-else>
        Receipt already posted. Editing is locked.
      </div>

      <div class="card" style="zoom: 80%;">
        <div class="card-header d-flex align-items-center justify-content-between">
          <h5 class="mb-0">Items</h5>
          <button class="btn btn-sm btn-secondary" :disabled="isPosted" @click="addLine">
            <i class="uil-plus"></i> Add Line
          </button>
        </div>

        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-sm table-bordered align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>Item</th>
                  <th style="width: 140px;">Qty</th>
                  <th style="width: 220px;">UOM</th>
                  <th style="width: 160px;">Unit Cost</th>
                  <th style="width: 80px;"></th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="lines.length === 0">
                  <td colspan="5" class="text-center text-muted py-4">No items</td>
                </tr>

                <tr v-for="(ln, idx) in lines" :key="idx">
                  <td>
                    <select class="form-select form-select-sm" v-model="ln.inventory_item_id" :disabled="isPosted">
                      <option value="">Select item</option>
                      <option v-for="it in itemsMaster" :key="it.id" :value="String(it.id)">{{ it.name }}</option>
                    </select>
                    <small class="text-muted">{{ ln.inventory_item_id ? itemLabel(Number(ln.inventory_item_id)) : "" }}</small>
                  </td>

                  <td><input class="form-control form-control-sm" type="number" step="0.001" v-model="ln.qty" :disabled="isPosted" /></td>

                  <td>
                    <select class="form-select form-select-sm" v-model="ln.uom_id" :disabled="isPosted">
                      <option value="">Select uom</option>
                      <option v-for="u in uoms" :key="u.id" :value="String(u.id)">{{ u.code }} - {{ u.name }}</option>
                    </select>
                    <small class="text-muted">{{ ln.uom_id ? uomLabel(Number(ln.uom_id)) : "" }}</small>
                  </td>

                  <td><input class="form-control form-control-sm" type="number" step="0.0001" v-model="ln.unit_cost" :disabled="isPosted" /></td>

                  <td class="text-end">
                    <button class="btn btn-sm btn-outline-danger" :disabled="isPosted" @click="removeLine(idx)">X</button>
                  </td>
                </tr>
              </tbody>

            </table>
          </div>
        </div>
      </div>
    </template>

  </DefaultLayout>
</template>
