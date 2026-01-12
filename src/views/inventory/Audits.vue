<script setup>
import { ref, computed, onMounted } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import {
  listInventoryAudits,
  createInventoryAudit,
  replaceInventoryAuditLines,
  listInventoryItems,
} from "../../api/inventory";

import { listOutlets } from "../../api/lookups";

const toast = useToast();

const loading = ref(true);
const audits = ref([]);
const outlets = ref([]);
const items = ref([]);

const filters = ref({
  outlet_id: "",
  status: "all",
});

const saving = ref(false);

const createForm = ref({
  outlet_id: "",
  note: "",
});

const activeAudit = ref(null);

const lineItemId = ref("");
const lineQty = ref("");
const lineNote = ref("");
const linesDraft = ref([]);

const itemById = computed(() => {
  const m = new Map();
  for (const it of items.value) m.set(it.id, it);
  return m;
});

function bsModal(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const b = window.bootstrap;
  if (!b?.Modal) return null;
  return b.Modal.getOrCreateInstance(el);
}

async function loadAudits() {
  try {
    const params = {
      outlet_id: filters.value.outlet_id ? Number(filters.value.outlet_id) : undefined,
      status: filters.value.status,
    };
    audits.value = await listInventoryAudits(params);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load audits");
  }
}

async function load() {
  loading.value = true;
  try {
    const [o, it] = await Promise.all([listOutlets(), listInventoryItems({ limit: 500 })]);
    outlets.value = o;
    items.value = it;
    await loadAudits();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load audits");
  } finally {
    loading.value = false;
  }
}

function prepareCreate() {
  createForm.value = {
    outlet_id: outlets.value?.[0]?.id || "",
    note: "",
  };
}

async function saveCreate() {
  saving.value = true;
  try {
    const a = await createInventoryAudit({
      outlet_id: Number(createForm.value.outlet_id),
      note: createForm.value.note?.trim() || null,
    });

    toast.success("Audit created");
    await loadAudits();

    // close create modal
    bsModal("inventoryAuditCreateModal")?.hide();

    // open edit lines modal with created audit
    prepareEditLines(a);
    bsModal("inventoryAuditLinesModal")?.show();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to create audit");
  } finally {
    saving.value = false;
  }
}

function prepareEditLines(a) {
  activeAudit.value = a;
  linesDraft.value = (a.lines || []).map((ln) => ({
    inventory_item_id: ln.inventory_item_id,
    counted_qty: Number(ln.counted_qty),
    note: ln.note || "",
  }));

  lineItemId.value = items.value?.[0]?.id || "";
  lineQty.value = "";
  lineNote.value = "";
}

function addLine() {
  const inventory_item_id = Number(lineItemId.value);
  const counted_qty = Number(lineQty.value);

  if (!inventory_item_id) return toast.error("Pick an item");
  if (!Number.isFinite(counted_qty)) return toast.error("Enter counted qty");

  const row = { inventory_item_id, counted_qty, note: (lineNote.value || "").trim() };
  const idx = linesDraft.value.findIndex((x) => x.inventory_item_id === inventory_item_id);

  if (idx >= 0) linesDraft.value[idx] = row;
  else linesDraft.value.push(row);

  lineQty.value = "";
  lineNote.value = "";
}

function removeLine(inventory_item_id) {
  linesDraft.value = linesDraft.value.filter((x) => x.inventory_item_id !== inventory_item_id);
}

async function saveLines() {
  if (!activeAudit.value) return;

  saving.value = true;
  try {
    await replaceInventoryAuditLines(activeAudit.value.id, {
      lines: linesDraft.value.map((x) => ({
        inventory_item_id: x.inventory_item_id,
        counted_qty: x.counted_qty,
        note: x.note || null,
      })),
    });

    toast.success("Lines saved");
    await loadAudits();

    bsModal("inventoryAuditLinesModal")?.hide();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save lines");
  } finally {
    saving.value = false;
  }
}

function fmt(dt) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between">
      <h4 class="page-title">Inventory Audits</h4>

      <button
        type="button"
        class="btn btn-primary"
        data-bs-toggle="modal"
        data-bs-target="#inventoryAuditCreateModal"
        @click="prepareCreate"
      >
        New Audit
      </button>
    </div>

    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-6">
            <label class="form-label">Outlet</label>
            <select v-model="filters.outlet_id" class="form-select" @change="loadAudits">
              <option value="">All</option>
              <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
          </div>

          <div class="col-md-4">
            <label class="form-label">Status</label>
            <select v-model="filters.status" class="form-select" @change="loadAudits">
              <option value="all">All</option>
              <option value="draft">DRAFT</option>
              <option value="posted">POSTED</option>
              <option value="cancelled">CANCELLED</option>
            </select>
          </div>

          <div class="col-md-2 d-grid">
            <button class="btn btn-outline-secondary" @click="loadAudits">Refresh</button>
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
                <th style="width: 90px">ID</th>
                <th style="width: 220px">Audited At</th>
                <th>Outlet</th>
                <th style="width: 120px">Status</th>
                <th>Note</th>
                <th style="width: 180px"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in audits" :key="a.id">
                <td>{{ a.id }}</td>
                <td>{{ fmt(a.audited_at) }}</td>
                <td>{{ outlets.find(o => o.id === a.outlet_id)?.name || a.outlet_id }}</td>
                <td>
                  <span
                    class="badge"
                    :class="a.status === 'DRAFT' ? 'bg-warning text-dark' : (a.status === 'POSTED' ? 'bg-success' : 'bg-secondary')"
                  >
                    {{ a.status }}
                  </span>
                </td>
                <td class="text-truncate" style="max-width: 320px;">{{ a.note || "-" }}</td>
                <td class="text-end">
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary"
                    data-bs-toggle="modal"
                    data-bs-target="#inventoryAuditLinesModal"
                    @click="prepareEditLines(a)"
                  >
                    Edit Lines
                  </button>
                </td>
              </tr>

              <tr v-if="audits.length === 0">
                <td colspan="6" class="text-center text-muted">No audits yet</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Create Audit Center Modal -->
    <div class="modal fade" id="inventoryAuditCreateModal" tabindex="-1" role="dialog" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title">New Audit</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true"></button>
          </div>

          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Outlet</label>
              <select v-model="createForm.outlet_id" class="form-select">
                <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
            </div>

            <div class="mb-3">
              <label class="form-label">Note</label>
              <textarea v-model="createForm.note" class="form-control" rows="2"></textarea>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="saveCreate">
              <span v-if="saving">Creating...</span>
              <span v-else>Create</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Lines Center Modal (XL) -->
    <div class="modal fade" id="inventoryAuditLinesModal" tabindex="-1" role="dialog" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-xl">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title">Edit Audit Lines — Audit #{{ activeAudit?.id }}</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true"></button>
          </div>

          <div class="modal-body">
            <div class="row g-2 align-items-end mb-3">
              <div class="col-md-6">
                <label class="form-label">Item</label>
                <select v-model="lineItemId" class="form-select">
                  <option v-for="it in items" :key="it.id" :value="it.id">{{ it.name }}</option>
                </select>
              </div>

              <div class="col-md-3">
                <label class="form-label">Counted Qty</label>
                <input v-model="lineQty" type="number" step="0.000001" class="form-control" />
              </div>

              <div class="col-md-3">
                <label class="form-label">Note</label>
                <input v-model="lineNote" class="form-control" placeholder="optional" />
              </div>

              <div class="col-12 d-flex justify-content-end">
                <button type="button" class="btn btn-outline-primary" @click="addLine">Add / Update Line</button>
              </div>
            </div>

            <div class="table-responsive">
              <table class="table table-sm align-middle">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style="width: 180px" class="text-end">Counted Qty</th>
                    <th>Note</th>
                    <th style="width: 120px"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="ln in linesDraft" :key="ln.inventory_item_id">
                    <td>{{ itemById.get(ln.inventory_item_id)?.name || ln.inventory_item_id }}</td>
                    <td class="text-end">{{ ln.counted_qty }}</td>
                    <td>{{ ln.note || "-" }}</td>
                    <td class="text-end">
                      <button type="button" class="btn btn-sm btn-outline-danger" @click="removeLine(ln.inventory_item_id)">
                        Remove
                      </button>
                    </td>
                  </tr>

                  <tr v-if="linesDraft.length === 0">
                    <td colspan="4" class="text-center text-muted">No lines</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Close</button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="saveLines">
              <span v-if="saving">Saving...</span>
              <span v-else>Save Lines</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
