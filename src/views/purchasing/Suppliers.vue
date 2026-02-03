<!-- src/views/purchasing/Suppliers.vue -->
 <script setup>
import { ref, onMounted, watch } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import { listSuppliers, createSupplier, updateSupplier } from "../../api/purchasing";

const toast = useToast();

const loading = ref(false);
const saving = ref(false);
const rows = ref([]);

const filters = ref({
  q: "",
  active: "1", // 1|0|all
});

const editing = ref(null);
const form = ref({
  name: "",
  phone: "",
  email: "",
  address: "",
  is_active: true,
});

function bsModal(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const b = window.bootstrap;
  if (!b?.Modal) return null;
  return b.Modal.getOrCreateInstance(el);
}

function prepareCreate() {
  editing.value = null;
  form.value = { name: "", phone: "", email: "", address: "", is_active: true };
}

function prepareEdit(r) {
  editing.value = r;
  form.value = {
    name: r.name || "",
    phone: r.phone || "",
    email: r.email || "",
    address: r.address || "",
    is_active: !!r.is_active,
  };
}

async function load() {
  loading.value = true;
  try {
    const params = {
      limit: 500,
      active: filters.value.active,
      q: filters.value.q?.trim() || undefined,
    };
    rows.value = await listSuppliers(params);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load suppliers");
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    const payload = {
      name: form.value.name?.trim(),
      phone: form.value.phone?.trim() || null,
      email: form.value.email?.trim() || null,
      address: form.value.address?.trim() || null,
      is_active: !!form.value.is_active,
    };

    if (!payload.name) {
      toast.error("Name is required");
      return;
    }

    if (editing.value) await updateSupplier(editing.value.id, payload);
    else await createSupplier(payload);

    toast.success("Saved");
    await load();
    bsModal("supplierModal")?.hide();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save supplier");
  } finally {
    saving.value = false;
  }
}

let t = null;
watch(
  () => [filters.value.q, filters.value.active],
  () => {
    clearTimeout(t);
    t = setTimeout(load, 200);
  }
);

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <h4 class="page-title mb-0">Suppliers</h4>

      <button
        class="btn btn-primary"
        data-bs-toggle="modal"
        data-bs-target="#supplierModal"
        @click="prepareCreate"
      >
        <i class="uil-plus me-1"></i> Add Supplier
      </button>
    </div>

    <div class="card mb-3" style="zoom: 80%;">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-4">
            <label class="form-label">Search</label>
            <input v-model="filters.q" class="form-control" placeholder="Search supplier name..." />
          </div>

          <div class="col-md-3">
            <label class="form-label">Active</label>
            <select v-model="filters.active" class="form-select">
              <option value="1">Active</option>
              <option value="0">Inactive</option>
              <option value="all">All</option>
            </select>
          </div>

          <div class="col-md-2 d-grid">
            <button class="btn btn-secondary" :disabled="loading" @click="load">
              Refresh
            </button>
          </div>
        </div>
        <small class="text-muted d-block mt-2">Filters update as you type.</small>
      </div>
    </div>

    <div class="card" style="zoom: 80%;">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-sm table-bordered align-middle mb-0">
            <thead class="table-light">
              <tr>
                <th style="width: 90px;">ID</th>
                <th>Name</th>
                <th style="width: 160px;">Phone</th>
                <th style="width: 220px;">Email</th>
                <th>Address</th>
                <th style="width: 110px;">Active</th>
                <th style="width: 140px;"></th>
              </tr>
            </thead>

            <tbody>
              <tr v-if="!loading && rows.length === 0">
                <td colspan="7" class="text-center text-muted py-4">No suppliers found</td>
              </tr>

              <tr v-for="r in rows" :key="r.id">
                <td>{{ r.id }}</td>
                <td class="fw-semibold">{{ r.name }}</td>
                <td>{{ r.phone || "-" }}</td>
                <td>{{ r.email || "-" }}</td>
                <td>{{ r.address || "-" }}</td>
                <td>
                  <span class="badge" :class="r.is_active ? 'bg-success' : 'bg-danger'">
                    {{ r.is_active ? "Yes" : "No" }}
                  </span>
                </td>
                <td class="text-end">
                  <button
                    class="btn btn-sm btn-secondary"
                    data-bs-toggle="modal"
                    data-bs-target="#supplierModal"
                    @click="prepareEdit(r)"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            </tbody>

          </table>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div class="modal fade" id="supplierModal" tabindex="-1" aria-hidden="true" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header bg-light">
            <h4 class="modal-title">{{ editing ? "Edit Supplier" : "Add Supplier" }}</h4>
            <button class="btn-close" data-bs-dismiss="modal"></button>
          </div>

          <div class="modal-body">
            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label">Name</label>
                <input v-model="form.name" class="form-control" />
              </div>

              <div class="col-md-6">
                <label class="form-label">Phone</label>
                <input v-model="form.phone" class="form-control" />
              </div>

              <div class="col-md-6">
                <label class="form-label">Email</label>
                <input v-model="form.email" class="form-control" />
              </div>

              <div class="col-md-6">
                <label class="form-label">Address</label>
                <input v-model="form.address" class="form-control" />
              </div>

              <div class="col-md-4">
                <label class="form-label">Active</label>
                <div class="form-check mt-2">
                  <input class="form-check-input" type="checkbox" v-model="form.is_active" id="supplierActive" />
                  <label class="form-check-label" for="supplierActive">Enabled</label>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving">Saving...</span>
              <span v-else>Save</span>
            </button>
          </div>
        </div>
      </div>
    </div>

  </DefaultLayout>
</template>
