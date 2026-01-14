<script setup>
import { ref, computed, onMounted } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import {
  listInventoryItems,
  createInventoryItem,
  updateInventoryItem,
  listInventoryCategories,
} from "../../api/inventory";

import { listUoms } from "../../api/lookups";

const toast = useToast();

const loading = ref(true);
const saving = ref(false);

const items = ref([]);
const categories = ref([]);
const uoms = ref([]);

const filters = ref({
  q: "",
  category_id: "",
  active: "all", // 1|0|all
  track: "all",  // 1|0|all
});

const editing = ref(null);

const form = ref({
  category_id: "",
  sku: "",
  name: "",
  base_uom_id: "",
  track_stock: true,
  reorder_level: "",
  avg_cost: "",
  is_active: true,
});

const uomNameById = computed(() => {
  const m = new Map();
  for (const u of uoms.value) m.set(u.id, `${u.code} - ${u.name}`);
  return m;
});

function bsModal(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const b = window.bootstrap;
  if (!b?.Modal) return null;
  return b.Modal.getOrCreateInstance(el);
}

async function loadAll() {
  loading.value = true;
  try {
    const [cats, uomList] = await Promise.all([
      listInventoryCategories(),
      listUoms(),
    ]);
    categories.value = cats;
    uoms.value = uomList;

    // default base uom if empty
    if (!form.value.base_uom_id && uoms.value.length) form.value.base_uom_id = uoms.value[0].id;

    await loadItems();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load inventory data");
  } finally {
    loading.value = false;
  }
}

async function loadItems() {
  const params = {
    q: filters.value.q || undefined,
    category_id: filters.value.category_id ? Number(filters.value.category_id) : undefined,
    active: filters.value.active,
    track: filters.value.track,
    limit: 500,
  };

  try {
    items.value = await listInventoryItems(params);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load items");
  }
}

function normalizeNumber(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function prepareCreate() {
  editing.value = null;
  form.value = {
    category_id: "",
    sku: "",
    name: "",
    base_uom_id: uoms.value?.[0]?.id || "",
    track_stock: true,
    reorder_level: "",
    avg_cost: "",
    is_active: true,
  };
}

function prepareEdit(it) {
  editing.value = it;
  form.value = {
    category_id: it.category_id ?? "",
    sku: it.sku ?? "",
    name: it.name ?? "",
    base_uom_id: it.base_uom_id,
    track_stock: !!it.track_stock,
    reorder_level: it.reorder_level ?? "",
    avg_cost: it.avg_cost ?? "",
    is_active: !!it.is_active,
  };
}

async function save() {
  saving.value = true;
  try {
    const payload = {
      category_id: form.value.category_id === "" ? null : Number(form.value.category_id),
      sku: form.value.sku?.trim() || null,
      name: form.value.name?.trim(),
      base_uom_id: Number(form.value.base_uom_id),
      track_stock: !!form.value.track_stock,
      reorder_level: normalizeNumber(form.value.reorder_level),
      avg_cost: normalizeNumber(form.value.avg_cost),
      is_active: !!form.value.is_active,
    };

    if (!payload.name) {
      toast.error("Name is required");
      return;
    }
    if (!payload.base_uom_id) {
      toast.error("Base UOM is required");
      return;
    }

    if (editing.value) await updateInventoryItem(editing.value.id, payload);
    else await createInventoryItem(payload);

    toast.success("Saved");
    await loadItems();

    // close bootstrap modal
    bsModal("inventoryItemModal")?.hide();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save item");
  } finally {
    saving.value = false;
  }
}

onMounted(loadAll);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <h4 class="page-title">Inventory Items</h4>
      <button
        type="button"
        class="btn btn-primary"
        data-bs-toggle="modal"
        data-bs-target="#inventoryItemModal"
        @click="prepareCreate"
      >
        Add Item
      </button>
    </div>

    <div class="card mb-3" style="zoom: 80%;">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-4">
            <label class="form-label">Search</label>
            <input v-model="filters.q" class="form-control" placeholder="Search by name..." @keyup.enter="loadItems" />
          </div>

          <div class="col-md-3">
            <label class="form-label">Category</label>
            <select v-model="filters.category_id" class="form-select" @change="loadItems">
              <option value="">All</option>
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <div class="col-md-2">
            <label class="form-label">Active</label>
            <select v-model="filters.active" class="form-select" @change="loadItems">
              <option value="all">All</option>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>

          <div class="col-md-2">
            <label class="form-label">Track Stock</label>
            <select v-model="filters.track" class="form-select" @change="loadItems">
              <option value="all">All</option>
              <option value="1">Tracking</option>
              <option value="0">Not tracking</option>
            </select>
          </div>

          <div class="col-md-1 d-grid">
            <button class="btn btn-secondary" @click="loadItems">Go</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="card"><div class="card-body">Loading...</div></div>

    <div v-else class="card" style="zoom: 80%;">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-sm table-bordered align-middle mb-0">
            <thead class="bg-light">
              <tr>
                <th style="width: 90px">ID</th>
                <th style="width: 140px">SKU</th>
                <th>Name</th>
                <th style="width: 220px">Category</th>
                <th style="width: 180px">Base UOM</th>
                <th style="width: 120px">Track</th>
                <th style="width: 120px">Active</th>
                <th style="width: 140px"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in items" :key="it.id">
                <td>{{ it.id }}</td>
                <td>{{ it.sku || "-" }}</td>
                <td>{{ it.name }}</td>
                <td>{{ it.category?.name || "-" }}</td>
                <td>{{ it.base_uom ? `${it.base_uom.code} - ${it.base_uom.name}` : (uomNameById.get(it.base_uom_id) || it.base_uom_id) }}</td>
                <td>
                  <span class="badge" :class="it.track_stock ? 'bg-success' : 'bg-secondary'">
                    {{ it.track_stock ? "Yes" : "No" }}
                  </span>
                </td>
                <td>
                  <span class="badge" :class="it.is_active ? 'bg-success' : 'bg-danger'">
                    {{ it.is_active ? "Active" : "Inactive" }}
                  </span>
                </td>
                <td class="text-end">
                  <button
                    type="button"
                    class="btn btn-sm btn-secondary"
                    data-bs-toggle="modal"
                    data-bs-target="#inventoryItemModal"
                    @click="prepareEdit(it)"
                  >
                    Edit
                  </button>
                </td>
              </tr>
              <tr v-if="items.length === 0">
                <td colspan="8" class="text-center text-muted">No items found</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Bootstrap Center Modal -->
    <div class="modal fade" id="inventoryItemModal" tabindex="-1" role="dialog" aria-hidden="true" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header bg-light">
            <h4 class="modal-title">
              {{ editing ? "Edit Inventory Item" : "Add Inventory Item" }}
            </h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true"></button>
          </div>

          <div class="modal-body">
            <div class="row g-3">
              <div class="col-md-4">
                <label class="form-label">Category</label>
                <select v-model="form.category_id" class="form-select">
                  <option value="">None</option>
                  <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </div>

              <div class="col-md-4">
                <label class="form-label">SKU</label>
                <input v-model="form.sku" class="form-control" placeholder="Optional" />
              </div>

              <div class="col-md-4">
                <label class="form-label">Base UOM</label>
                <select v-model="form.base_uom_id" class="form-select">
                  <option v-for="u in uoms" :key="u.id" :value="u.id">{{ u.code }} - {{ u.name }}</option>
                </select>
              </div>

              <div class="col-12">
                <label class="form-label">Name</label>
                <input v-model="form.name" class="form-control" />
              </div>

              <div class="col-md-4">
                <label class="form-label">Reorder Level</label>
                <input v-model="form.reorder_level" type="number" step="0.001" class="form-control" />
              </div>

              <div class="col-md-4">
                <label class="form-label">Avg Cost</label>
                <input v-model="form.avg_cost" type="number" step="0.0001" class="form-control" />
              </div>

              <div class="col-md-4">
                <label class="form-label">Track Stock</label>
                <div class="form-check mt-2">
                  <input class="form-check-input" type="checkbox" v-model="form.track_stock" id="trackStock" />
                  <label class="form-check-label" for="trackStock">Enabled</label>
                </div>
              </div>

              <div class="col-md-4">
                <label class="form-label">Active</label>
                <div class="form-check mt-2">
                  <input class="form-check-input" type="checkbox" v-model="form.is_active" id="isActive" />
                  <label class="form-check-label" for="isActive">Active</label>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving">Saving...</span>
              <span v-else>Save</span>
            </button>
          </div>
        </div><!-- /.modal-content -->
      </div><!-- /.modal-dialog -->
    </div><!-- /.modal -->
  </DefaultLayout>
</template>
