<!-- src/views/system/Permissions.vue -->
<script setup>
import { ref, onMounted, computed } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import {
  listPermissions,
  createPermission,
  updatePermission,
  deletePermission,
} from "../../api/systemPermissions";

const toast = useToast();

const loading = ref(true);
const saving = ref(false);

const permissions = ref([]);

// Filters
const filterCode = ref("");
const filterDesc = ref("");

// Form
const isEditing = ref(false);
const triedSubmit = ref(false);

const form = ref({
  id: null,
  code: "",
  description: "",
});

function resetForm() {
  isEditing.value = false;
  triedSubmit.value = false;
  form.value = { id: null, code: "", description: "" };
}

function openEdit(p) {
  isEditing.value = true;
  triedSubmit.value = false;
  form.value = {
    id: p.id,
    code: p.code || "",
    description: p.description || "",
  };
  // scroll user to top form area (nice UX)
  window?.scrollTo?.({ top: 0, behavior: "smooth" });
}

async function load() {
  loading.value = true;
  try {
    permissions.value = await listPermissions();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load permissions");
  } finally {
    loading.value = false;
  }
}

function validate() {
  triedSubmit.value = true;
  if (!form.value.code?.trim()) {
    toast.error("Permission code is required.");
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
      description: (form.value.description || "").trim() || null,
    };

    if (isEditing.value) {
      await updatePermission(form.value.id, payload);
      toast.success("Permission updated.");
    } else {
      await createPermission(payload);
      toast.success("Permission created.");
    }

    resetForm();
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save permission");
  } finally {
    saving.value = false;
  }
}

async function removePermission(p) {
  if (!confirm(`Delete permission "${p.code}"?`)) return;
  try {
    await deletePermission(p.id);
    toast.success("Permission deleted.");
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete permission");
  }
}

const filtered = computed(() => {
  const c = filterCode.value.trim().toLowerCase();
  const d = filterDesc.value.trim().toLowerCase();

  return (permissions.value || []).filter((p) => {
    const code = (p.code || "").toLowerCase();
    const desc = (p.description || "").toLowerCase();

    const okCode = !c || code.includes(c);
    const okDesc = !d || desc.includes(d);

    return okCode && okDesc;
  });
});

const counts = computed(() => ({
  total: permissions.value.length,
  shown: filtered.value.length,
}));

function clearFilters() {
  filterCode.value = "";
  filterDesc.value = "";
}

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <!-- Title -->
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Permissions</h4>
        <div class="text-muted small">
          Showing <strong>{{ counts.shown }}</strong> of <strong>{{ counts.total }}</strong>
        </div>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-outline-secondary" :disabled="saving" @click="clearFilters">
          Clear Filters
        </button>
        <button class="btn btn-light" :disabled="saving" @click="resetForm">
          Clear Form
        </button>
      </div>
    </div>

    <!-- ✅ FORM FIRST (Create/Edit at the top) -->
    <div class="card mb-3" style="zoom: 80%;">
      <div class="card-header bg-light d-flex align-items-center justify-content-between">
        <div class="fw-semibold">{{ isEditing ? "Edit Permission" : "Create Permission" }}</div>
        <span v-if="isEditing" class="text-muted small">Editing ID: {{ form.id }}</span>
      </div>

      <div class="card-body position-relative">
        <!-- saving overlay -->
        <div
          v-if="saving"
          class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
          style="background: rgba(255,255,255,0.6); z-index: 10;"
        >
          <div class="text-center">
            <div class="spinner-border" role="status" aria-hidden="true"></div>
            <div class="small text-muted mt-2">Saving…</div>
          </div>
        </div>

        <form @submit.prevent="save" novalidate :class="{ 'was-validated': triedSubmit }">
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label">Code *</label>
              <input
                v-model="form.code"
                class="form-control"
                placeholder="e.g. system.roles.view"
                required
                autocomplete="off"
              />
              <div class="invalid-feedback">Code is required.</div>
              <small class="text-muted">Use dot notation. Example: <code>users.create</code></small>
            </div>

            <div class="col-md-6">
              <label class="form-label">Description</label>
              <input
                v-model="form.description"
                class="form-control"
                placeholder="Short explanation (recommended)"
                autocomplete="off"
              />
              <small class="text-muted">Optional, but recommended for clarity.</small>
            </div>
          </div>

          <div class="mt-3 d-flex gap-2">
            <button class="btn btn-primary" :disabled="saving">
              <span v-if="saving">Saving...</span>
              <span v-else>{{ isEditing ? "Update Permission" : "Create Permission" }}</span>
            </button>

            <button type="button" class="btn btn-light" :disabled="saving" @click="resetForm">
              Clear
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Filters (below form) -->
    <div class="card mb-3" style="zoom: 80%;">
      <div class="card-body p-2">
        <div class="row g-2 align-items-end">
          <div class="col-md-4">
            <label class="form-label mb-1">Filter by Code</label>
            <div class="input-group">
              <span class="input-group-text"><i class="ri-key-2-line"></i></span>
              <input
                v-model="filterCode"
                class="form-control"
                placeholder="e.g. system.roles., users.create"
              />
            </div>
          </div>

          <div class="col-md-6">
            <label class="form-label mb-1">Filter by Description</label>
            <div class="input-group">
              <span class="input-group-text"><i class="ri-file-text-line"></i></span>
              <input
                v-model="filterDesc"
                class="form-control"
                placeholder="e.g. Can view roles, Can edit menu"
              />
            </div>
          </div>

          <div class="col-md-2 d-flex gap-2">
            <button class="btn btn-light w-100" :disabled="saving" @click="clearFilters">
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div class="card" v-if="loading" style="zoom: 80%;">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading permissions...</div>
      </div>
    </div>

    <!-- Table -->
    <div class="card" v-else style="zoom: 80%;">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-sm table-centered table-bordered mb-0">
            <thead class="bg-light">
              <tr>
                <th style="width: 34%">Code</th>
                <th>Description</th>
                <th class="text-end" style="width: 180px">Actions</th>
              </tr>
            </thead>

            <tbody>
              <tr v-for="p in filtered" :key="p.id">
                <td class="fw-semibold">
                  <div class="d-flex align-items-center gap-2">
                    <span class="badge bg-secondary-subtle text-secondary border">
                      <i class="ri-shield-keyhole-line"></i>
                    </span>
                    <span>{{ p.code }}</span>
                  </div>
                </td>

                <td class="text-muted">
                  {{ p.description || "-" }}
                </td>

                <td class="text-end">
                  <button class="btn btn-sm btn-soft-primary me-1" @click="openEdit(p)">
                    Edit
                  </button>
                  <button class="btn btn-sm btn-soft-danger" @click="removePermission(p)">
                    Delete
                  </button>
                </td>
              </tr>

              <tr v-if="filtered.length === 0">
                <td colspan="3" class="text-center text-muted py-4">No matching permissions.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
