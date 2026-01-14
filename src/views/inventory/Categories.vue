<script setup>
import { ref, onMounted } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import {
  listInventoryCategories,
  createInventoryCategory,
  updateInventoryCategory,
  deleteInventoryCategory,
} from "../../api/inventory";

const toast = useToast();

const loading = ref(true);
const saving = ref(false);

const categories = ref([]);
const editing = ref(null);

const form = ref({
  name: "",
  sort_order: "",
});

function bsModal(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const b = window.bootstrap;
  if (!b?.Modal) return null;
  return b.Modal.getOrCreateInstance(el);
}

async function load() {
  loading.value = true;
  try {
    categories.value = await listInventoryCategories();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load categories");
  } finally {
    loading.value = false;
  }
}

function prepareCreate() {
  editing.value = null;
  form.value = { name: "", sort_order: "" };
}

function prepareEdit(c) {
  editing.value = c;
  form.value = {
    name: c.name ?? "",
    sort_order: c.sort_order ?? "",
  };
}

function normalizeInt(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

async function save() {
  saving.value = true;
  try {
    const payload = {
      name: (form.value.name || "").trim(),
      sort_order: normalizeInt(form.value.sort_order),
    };

    if (!payload.name) {
      toast.error("Name is required");
      return;
    }

    if (editing.value) {
      await updateInventoryCategory(editing.value.id, payload);
    } else {
      await createInventoryCategory(payload);
    }

    toast.success("Saved");
    await load();
    bsModal("inventoryCategoryModal")?.hide();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save category");
  } finally {
    saving.value = false;
  }
}

async function remove(c) {
  if (!confirm(`Delete category "${c.name}"?`)) return;
  try {
    await deleteInventoryCategory(c.id);
    toast.success("Deleted");
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete category");
  }
}

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <h4 class="page-title">Inventory Categories</h4>

      <button
        type="button"
        class="btn btn-primary"
        data-bs-toggle="modal"
        data-bs-target="#inventoryCategoryModal"
        @click="prepareCreate"
      >
        Add Category
      </button>
    </div>

    <div v-if="loading" class="card" style="zoom: 80%;">
      <div class="card-body">Loading...</div>
    </div>

    <div v-else class="card" style="zoom: 80%;">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-sm table-bordered align-middle mb-0">
            <thead class="bg-light">
              <tr>
                <th style="width: 90px">ID</th>
                <th>Name</th>
                <th style="width: 140px">Sort</th>
                <th style="width: 200px"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in categories" :key="c.id">
                <td>{{ c.id }}</td>
                <td>{{ c.name }}</td>
                <td>{{ c.sort_order ?? "-" }}</td>
                <td class="text-end">
                  <button
                    type="button"
                    class="btn btn-sm btn-secondary me-2"
                    data-bs-toggle="modal"
                    data-bs-target="#inventoryCategoryModal"
                    @click="prepareEdit(c)"
                  >
                    Edit
                  </button>

                  <button type="button" class="btn btn-sm btn-danger" @click="remove(c)">
                    Delete
                  </button>
                </td>
              </tr>

              <tr v-if="categories.length === 0">
                <td colspan="4" class="text-center text-muted">No categories yet</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Bootstrap Center Modal -->
    <div class="modal fade" id="inventoryCategoryModal" tabindex="-1" role="dialog" aria-hidden="true" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-light">
            <h4 class="modal-title">
              {{ editing ? "Edit Category" : "Add Category" }}
            </h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true"></button>
          </div>

          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Name</label>
              <input v-model="form.name" class="form-control" />
            </div>

            <div class="mb-3">
              <label class="form-label">Sort Order</label>
              <input v-model="form.sort_order" type="number" step="1" class="form-control" placeholder="Optional" />
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
