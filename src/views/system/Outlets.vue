<!-- src/views/system/Outlets.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import { listOutlets, createOutlet, updateOutlet, deleteOutlet } from "../../api/systemOutlets";

const toast = useToast();

const loading = ref(true);
const saving = ref(false);

const rows = ref([]);

// Filters
const filterCode = ref("");
const filterName = ref("");
const filterCity = ref("");
const filterCountry = ref("");

// Modal
const modalEl = ref(null);
let modalInstance = null;

// Form
const isEditing = ref(false);
const triedSubmit = ref(false);

const form = ref({
  id: null,
  code: "",
  name: "",
  address: "",
  city: "",
  country: "",
});

const isEditMode = computed(() => isEditing.value && !!form.value.id);

const filteredRows = computed(() => {
  const c = filterCode.value.trim().toLowerCase();
  const n = filterName.value.trim().toLowerCase();
  const ci = filterCity.value.trim().toLowerCase();
  const co = filterCountry.value.trim().toLowerCase();

  return (rows.value || []).filter((o) => {
    const code = (o.code || "").toLowerCase();
    const name = (o.name || "").toLowerCase();
    const city = (o.city || "").toLowerCase();
    const country = (o.country || "").toLowerCase();

    const okCode = !c || code.includes(c);
    const okName = !n || name.includes(n);
    const okCity = !ci || city.includes(ci);
    const okCountry = !co || country.includes(co);

    return okCode && okName && okCity && okCountry;
  });
});

const counts = computed(() => ({
  total: rows.value.length,
  shown: filteredRows.value.length,
}));

function clearFilters() {
  filterCode.value = "";
  filterName.value = "";
  filterCity.value = "";
  filterCountry.value = "";
}

function resetForm() {
  triedSubmit.value = false;
  isEditing.value = false;
  form.value = { id: null, code: "", name: "", address: "", city: "", country: "" };
}

function setFormFromOutlet(o) {
  isEditing.value = true;
  triedSubmit.value = false;
  form.value = {
    id: o.id,
    code: o.code || "",
    name: o.name || "",
    address: o.address || "",
    city: o.city || "",
    country: o.country || "",
  };
}

async function ensureModal() {
  if (modalInstance) return;

  try {
    const m = await import("bootstrap/js/dist/modal");
    modalInstance = new m.default(modalEl.value, {
      backdrop: "static",
      keyboard: false,
    });
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

async function openEdit(o) {
  setFormFromOutlet(o);
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
    rows.value = await listOutlets();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load outlets");
  } finally {
    loading.value = false;
  }
}

function validate() {
  triedSubmit.value = true;

  const code = (form.value.code || "").trim();
  const name = (form.value.name || "").trim();

  if (!code) {
    toast.error("Outlet code is required.");
    return false;
  }
  if (!name) {
    toast.error("Outlet name is required.");
    return false;
  }
  return true;
}

async function save() {
  if (!validate()) return;

  saving.value = true;
  try {
    const payload = {
      code: (form.value.code || "").trim(),
      name: (form.value.name || "").trim(),
      address: (form.value.address || "").trim() || null,
      city: (form.value.city || "").trim() || null,
      country: (form.value.country || "").trim() || null,
    };

    if (isEditMode.value) {
      await updateOutlet(form.value.id, payload);
      toast.success("Outlet updated.");
    } else {
      await createOutlet(payload);
      toast.success("Outlet created.");
    }

    closeModal();
    resetForm();
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save outlet");
  } finally {
    saving.value = false;
  }
}

async function removeRow(o) {
  if (!confirm(`Delete outlet "${o.name}"?`)) return;
  try {
    await deleteOutlet(o.id);
    toast.success("Outlet deleted.");
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete outlet");
  }
}

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Outlets</h4>
        <div class="text-muted small">
          Showing <strong>{{ counts.shown }}</strong> of <strong>{{ counts.total }}</strong>
        </div>
      </div>

      <button class="btn btn-primary" @click="openCreate">
        <i class="ri-add-line me-1"></i> New Outlet
      </button>
    </div>

    <!-- Filters -->
    <div class="card mb-3" style="zoom: 80%;">
      <div class="card-body p-2">
        <div class="row g-2 align-items-end">
          <div class="col-md-2">
            <label class="form-label mb-1">Code</label>
            <input v-model="filterCode" class="form-control" placeholder="e.g. MAIN" />
          </div>

          <div class="col-md-4">
            <label class="form-label mb-1">Name</label>
            <input v-model="filterName" class="form-control" placeholder="e.g. Main Branch" />
          </div>

          <div class="col-md-3">
            <label class="form-label mb-1">City</label>
            <input v-model="filterCity" class="form-control" placeholder="e.g. Lusaka" />
          </div>

          <div class="col-md-3">
            <label class="form-label mb-1">Country</label>
            <div class="d-flex gap-2">
              <input v-model="filterCountry" class="form-control" placeholder="e.g. Zambia" />
              <button class="btn btn-light" @click="clearFilters">Clear</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div class="card" v-if="loading" style="zoom: 80%;">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading outlets...</div>
      </div>
    </div>

    <!-- Table -->
    <div class="card" v-else style="zoom: 80%;">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-sm table-centered table-bordered mb-0">
            <thead class="bg-light">
              <tr>
                <th style="width: 100px">Code</th>
                <th>Name</th>
                <th>City</th>
                <th>Country</th>
                <th class="text-end" style="width: 190px">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in filteredRows" :key="o.id">
                <td class="fw-semibold">{{ o.code }}</td>
                <td>{{ o.name }}</td>
                <td>{{ o.city || "-" }}</td>
                <td>{{ o.country || "-" }}</td>
                <td class="text-end">
                  <button class="btn btn-sm btn-soft-primary me-1" @click="openEdit(o)">Edit</button>
                  <button class="btn btn-sm btn-soft-danger" @click="removeRow(o)">Delete</button>
                </td>
              </tr>

              <tr v-if="filteredRows.length === 0">
                <td colspan="5" class="text-center text-muted py-4">No matching outlets.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Modal: Create/Edit Outlet -->
    <div class="modal fade" id="outletModal" tabindex="-1" role="dialog" aria-hidden="true" ref="modalEl" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content position-relative">
          <div class="modal-header bg-light">
            <h4 class="modal-title">{{ isEditMode ? "Edit Outlet" : "Create Outlet" }}</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true" :disabled="saving"></button>
          </div>

          <!-- Saving overlay -->
          <div
            v-if="saving"
            class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style="background: rgba(255,255,255,0.7); z-index: 10;"
          >
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body">
            <form @submit.prevent="save" novalidate :class="{ 'was-validated': triedSubmit }">
              <div class="row g-2">
                <div class="col-md-4">
                  <label class="form-label">Code *</label>
                  <input
                    v-model="form.code"
                    class="form-control"
                    placeholder="e.g. MAIN, LSK01"
                    required
                    autocomplete="off"
                  />
                  <div class="invalid-feedback">Code is required.</div>
                </div>

                <div class="col-md-8">
                  <label class="form-label">Name *</label>
                  <input
                    v-model="form.name"
                    class="form-control"
                    placeholder="e.g. Main Branch - Cairo Road"
                    required
                    autocomplete="off"
                  />
                  <div class="invalid-feedback">Name is required.</div>
                </div>
              </div>

              <div class="mt-2">
                <label class="form-label">Address</label>
                <input
                  v-model="form.address"
                  class="form-control"
                  placeholder="Street, area, building (optional)"
                  autocomplete="street-address"
                />
              </div>

              <div class="row g-2 mt-1">
                <div class="col-md-6">
                  <label class="form-label">City</label>
                  <input
                    v-model="form.city"
                    class="form-control"
                    placeholder="e.g. Lusaka"
                    autocomplete="address-level2"
                  />
                </div>

                <div class="col-md-6">
                  <label class="form-label">Country</label>
                  <input
                    v-model="form.country"
                    class="form-control"
                    placeholder="e.g. Zambia"
                    autocomplete="country-name"
                  />
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
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
