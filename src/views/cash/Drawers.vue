<!-- src/views/cash/Drawers.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import {
  listCashDrawers,
  createCashDrawer,
  updateCashDrawer,
  toggleCashDrawer,
} from "../../api/cash";

const toast = useToast();
const loading = ref(true);
const saving = ref(false);

const drawers = ref([]);

// Filters
const outletId = ref(""); // can auto-fill from auth store later if you want
const active = ref("1"); // 1|0|all

// Optional quick search in table
const q = ref("");

// Modal refs
const modalEl = ref(null);
let modalInstance = null;

const editId = ref(null);
const triedSubmit = ref(false);

const form = ref({
  outlet_id: "",
  name: "",
  is_active: true,
});

const isEditMode = computed(() => !!editId.value);

const filteredDrawers = computed(() => {
  const qq = q.value.trim().toLowerCase();
  if (!qq) return drawers.value || [];
  return (drawers.value || []).filter((d) => {
    const hay = `${d.outlet_id} ${d.name || ""}`.toLowerCase();
    return hay.includes(qq);
  });
});

function resetForm() {
  editId.value = null;
  triedSubmit.value = false;
  form.value = {
    outlet_id: outletId.value || "",
    name: "",
    is_active: true,
  };
}

function setFormFromDrawer(d) {
  editId.value = d.id;
  triedSubmit.value = false;
  form.value = {
    outlet_id: d.outlet_id,
    name: d.name || "",
    is_active: !!d.is_active,
  };
}

async function ensureModal() {
  if (modalInstance) return;

  try {
    const m = await import("bootstrap/js/dist/modal");
    modalInstance = new m.default(modalEl.value, { backdrop: "static", keyboard: false });
  } catch (e) {
    modalInstance = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(modalEl.value, { backdrop: "static", keyboard: false })
      : null;
  }
}

async function openCreate() {
  resetForm();
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

async function openEdit(d) {
  setFormFromDrawer(d);
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

function closeModal() {
  modalInstance?.hide();
}

async function load() {
  loading.value = true;
  try {
    drawers.value = await listCashDrawers({
      outlet_id: outletId.value || undefined,
      active: active.value,
    });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load drawers");
  } finally {
    loading.value = false;
  }
}

function validate() {
  triedSubmit.value = true;

  const out = Number(form.value.outlet_id);
  if (!out) {
    toast.error("Outlet ID is required");
    return false;
  }
  if (!String(form.value.name || "").trim()) {
    toast.error("Drawer name is required");
    return false;
  }
  return true;
}

async function save() {
  if (!validate()) return;

  saving.value = true;
  try {
    const payload = {
      outlet_id: Number(form.value.outlet_id),
      name: (form.value.name || "").trim(),
      is_active: !!form.value.is_active,
    };

    if (editId.value) {
      await updateCashDrawer(editId.value, { name: payload.name, is_active: payload.is_active });
      toast.success("Drawer updated");
    } else {
      await createCashDrawer(payload);
      toast.success("Drawer created");
    }

    closeModal();
    resetForm();
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save drawer");
  } finally {
    saving.value = false;
  }
}

async function toggle(d) {
  try {
    await toggleCashDrawer(d.id);
    toast.success("Updated");
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed");
  }
}

function clearFilters() {
  outletId.value = "";
  active.value = "1";
  q.value = "";
}

onMounted(async () => {
  resetForm();
  await load();
});
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Cash Drawers</h4>
        <div class="text-muted small">Create, enable/disable and manage drawer names per outlet</div>
      </div>

      <button class="btn btn-primary" @click="openCreate">
        <i class="ri-add-line me-1"></i> Add Drawer
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card" style="zoom: 80%;">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading drawers...</div>
      </div>
    </div>

    <div v-else class="row" style="zoom: 80%;">
      <!-- Filters card -->
      <div class="col-12">
        <div class="card drawer-card mb-3">
          <div class="card-body p-2">
            <div class="row g-2 align-items-end">
              <div class="col-md-3">
                <label class="form-label">Outlet ID</label>
                <input v-model="outletId" class="form-control" placeholder="e.g. 1" />
              </div>

              <div class="col-md-2">
                <label class="form-label">Status</label>
                <select v-model="active" class="form-select">
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                  <option value="all">All</option>
                </select>
              </div>

              <div class="col-md-4">
                <label class="form-label">Quick Search</label>
                <div class="input-group">
                  <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
                  <input v-model="q" class="form-control" placeholder="Search by name or outlet..." />
                </div>
              </div>

              <div class="col-md-3 d-flex gap-2">
                <button class="btn btn-outline-primary w-100" :disabled="loading" @click="load">
                  <i class="ri-refresh-line me-1"></i> Load
                </button>
                <button class="btn btn-light w-100" :disabled="loading" @click="clearFilters">
                  Clear
                </button>
              </div>

              <div class="col-12">
                <div class="text-muted small">
                  Showing <strong>{{ filteredDrawers.length }}</strong> of <strong>{{ drawers.length }}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Table card -->
      <div class="col-12">
        <div class="card drawer-card">
          <div class="card-body p-0">
            <div class="table-responsive">
              <table class="table table-sm table-centered table-bordered mb-0">
                <thead class="bg-light">
                  <tr>
                    <th style="width: 120px;">Outlet</th>
                    <th>Name</th>
                    <th style="width: 140px;">Status</th>
                    <th class="text-end" style="width: 240px;">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  <tr v-for="d in filteredDrawers" :key="d.id">
                    <td>{{ d.outlet_id }}</td>
                    <td class="fw-semibold">{{ d.name }}</td>
                    <td>
                      <span class="badge" :class="d.is_active ? 'bg-success' : 'bg-secondary'">
                        {{ d.is_active ? "Active" : "Inactive" }}
                      </span>
                    </td>
                    <td class="text-end">
                      <button class="btn btn-sm btn-soft-primary me-1" @click="openEdit(d)">
                        <i class="ri-edit-line me-1"></i> Edit
                      </button>
                      <button class="btn btn-sm btn-soft-warning" @click="toggle(d)">
                        <i class="ri-refresh-line me-1"></i> {{ d.is_active ? "Disable" : "Enable" }}
                      </button>
                    </td>
                  </tr>

                  <tr v-if="filteredDrawers.length === 0">
                    <td colspan="4" class="text-center text-muted py-4">No matching drawers.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Create/Edit Drawer -->
    <div
      class="modal fade"
      id="drawerModal"
      tabindex="-1"
      role="dialog"
      aria-hidden="true"
      ref="modalEl"
      style="zoom: 80%;"
    >
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content position-relative drawer-modal">
          <div class="modal-header bg-light">
            <h4 class="modal-title">{{ isEditMode ? "Edit Drawer" : "Create Drawer" }}</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true" :disabled="saving"></button>
          </div>

          <!-- Saving overlay -->
          <div v-if="saving" class="drawer-overlay" aria-hidden="true">
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body">
            <form @submit.prevent="save" novalidate :class="{ 'was-validated': triedSubmit }">
              <div class="row g-2">
                <div class="col-md-4">
                  <label class="form-label">Outlet ID *</label>
                  <input
                    v-model="form.outlet_id"
                    class="form-control"
                    placeholder="e.g. 1"
                    :disabled="isEditMode"
                    required
                  />
                  <div class="invalid-feedback">Outlet ID is required.</div>
                </div>

                <div class="col-md-8">
                  <label class="form-label">Name *</label>
                  <input
                    v-model="form.name"
                    class="form-control"
                    placeholder="Main Drawer"
                    required
                    autocomplete="off"
                  />
                  <div class="invalid-feedback">Drawer name is required.</div>
                </div>
              </div>

              <div class="form-check form-switch mt-3">
                <input id="drawerActive" v-model="form.is_active" class="form-check-input" type="checkbox" />
                <label for="drawerActive" class="form-check-label">Active</label>
              </div>

              <div class="alert alert-light border mt-3 mb-0">
                <div class="d-flex align-items-start gap-2">
                  <i class="ri-information-line mt-1"></i>
                  <div class="small">
                    <div class="fw-semibold">Tip</div>
                    <div class="text-muted">
                      Use clear names like <b>Main</b>, <b>Back Office</b>, <b>Register 2</b> to avoid confusion.
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">
              Cancel
            </button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving">Saving...</span>
              <span v-else>{{ isEditMode ? "Update" : "Create" }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
/* Theme-safe card + modal polish (matches your Users.vue approach) */
.drawer-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
}

/* Make table header follow theme (bootstrap puts bg-light = light always) */
.table thead.bg-light th {
  background: var(--ct-tertiary-bg) !important;
  color: var(--ct-emphasis-color) !important;
}

/* Modal surface */
.drawer-modal {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
}

/* Overlay theme-safe */
.drawer-overlay {
  position: absolute;
  inset: 0;
  background: rgba(var(--ct-body-bg-rgb), 0.72);
  backdrop-filter: blur(2px);
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
