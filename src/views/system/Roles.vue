<!-- src/views/system/Roles.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  listPermissions,
  setRolePermissions,
} from "../../api/systemRoles";

const toast = useToast();

const loading = ref(true);
const saving = ref(false);

const roles = ref([]);
const permissions = ref([]);

// ✅ Filters (top of roles card)
const filterName = ref("");
const filterDesc = ref("");
const filterPerm = ref("");

// ✅ Modal refs
const modalEl = ref(null);
let modalInstance = null;

const editingId = ref(null);
const triedSubmit = ref(false);

const isEditMode = computed(() => !!editingId.value);

const form = ref({
  name: "",
  description: "",
});

const selectedPermIds = ref([]);

// ---- Helpers
function resetForm() {
  editingId.value = null;
  triedSubmit.value = false;
  form.value = { name: "", description: "" };
  selectedPermIds.value = [];
}

function setFormFromRole(r) {
  editingId.value = r.id;
  triedSubmit.value = false;

  form.value = {
    name: r.name || "",
    description: r.description || "",
  };

  // supports either r.permissions=[{id,...}] or r.permission_ids=[...]
  if (Array.isArray(r.permissions) && r.permissions.length && typeof r.permissions[0] === "object") {
    selectedPermIds.value = (r.permissions || []).map((p) => p.id).filter(Boolean);
  } else if (Array.isArray(r.permission_ids)) {
    selectedPermIds.value = [...r.permission_ids];
  } else {
    selectedPermIds.value = [];
  }
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

async function openEdit(r) {
  setFormFromRole(r);
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
    const [rs, ps] = await Promise.all([listRoles(), listPermissions()]);
    roles.value = rs || [];
    permissions.value = ps || [];
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load roles/permissions");
  } finally {
    loading.value = false;
  }
}

function validate() {
  triedSubmit.value = true;

  if (!form.value.name?.trim()) {
    toast.error("Role name is required.");
    return false;
  }

  if (!selectedPermIds.value.length) {
    toast.error("Please select at least one permission.");
    return false;
  }

  return true;
}

async function save() {
  if (!validate()) return;

  saving.value = true;
  try {
    const payload = {
      name: form.value.name.trim(),
      description: (form.value.description || "").trim() || null,
    };

    let role;
    if (editingId.value) role = await updateRole(editingId.value, payload);
    else role = await createRole(payload);

    await setRolePermissions(role.id, selectedPermIds.value);

    toast.success(editingId.value ? "Role updated." : "Role created.");
    closeModal();
    resetForm();
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save role");
  } finally {
    saving.value = false;
  }
}

async function removeRole(r) {
  if (!confirm(`Delete role "${r.name}"?`)) return;
  try {
    await deleteRole(r.id);
    toast.success("Role deleted.");
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete role");
  }
}

// ---- Permissions filtering + bulk actions
const permQuery = ref("");

const filteredPermissions = computed(() => {
  const q = (permQuery.value || "").trim().toLowerCase();
  if (!q) return permissions.value || [];

  return (permissions.value || []).filter((p) => {
    const code = String(p.code || "").toLowerCase();
    const desc = String(p.description || "").toLowerCase();
    return code.includes(q) || desc.includes(q);
  });
});

function selectAllFilteredPerms() {
  const ids = filteredPermissions.value.map((p) => p.id).filter(Boolean);
  const set = new Set(selectedPermIds.value);
  ids.forEach((id) => set.add(id));
  selectedPermIds.value = Array.from(set);
}

function clearAllPerms() {
  selectedPermIds.value = [];
}

function clearFilters() {
  filterName.value = "";
  filterDesc.value = "";
  filterPerm.value = "";
}

const filteredRoles = computed(() => {
  const n = filterName.value.trim().toLowerCase();
  const d = filterDesc.value.trim().toLowerCase();
  const p = filterPerm.value.trim().toLowerCase();

  return (roles.value || []).filter((r) => {
    const name = String(r.name || "").toLowerCase();
    const desc = String(r.description || "").toLowerCase();

    const permCodes = (r.permissions || [])
      .map((x) => (typeof x === "string" ? x : x?.code))
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const okName = !n || name.includes(n);
    const okDesc = !d || desc.includes(d);
    const okPerm = !p || permCodes.includes(p);

    return okName && okDesc && okPerm;
  });
});

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <h4 class="page-title mb-0">Roles</h4>

      <button class="btn btn-primary" @click="openCreate">
        <i class="ri-add-line me-1"></i> Add Role
      </button>
    </div>

    <div v-if="loading" class="card" style="zoom: 80%;">
      <div class="card-body">Loading...</div>
    </div>

    <div v-else class="row" style="zoom: 80%;">
      <!-- Filters card -->
      <div class="col-md-12">
        <div class="card">
          <div class="card-body p-2">
            <div class="row g-2 align-items-end">
              <div class="col-md-4">
                <label class="form-label">Role Name</label>
                <input
                  v-model="filterName"
                  class="form-control"
                  placeholder="Search role name (e.g. Cashier, Manager)"
                />
              </div>

              <div class="col-md-4">
                <label class="form-label">Description</label>
                <input
                  v-model="filterDesc"
                  class="form-control"
                  placeholder="Search description (e.g. can manage users)"
                />
              </div>

              <div class="col-md-3">
                <label class="form-label">Permission Code</label>
                <input
                  v-model="filterPerm"
                  class="form-control"
                  placeholder="Search permission code (e.g. users.create)"
                />
              </div>

              <div class="col-md-1">
                <button class="btn btn-light w-100" @click="clearFilters">Clear</button>
              </div>

              <div class="col-12">
                <div class="text-muted small">
                  Showing <strong>{{ filteredRoles.length }}</strong> of <strong>{{ roles.length }}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Table card -->
      <div class="col-md-12">
        <div class="card">
          <div class="card-body p-0">
            <div class="table-responsive">
              <table class="table table-sm table-centered table-bordered mb-0">
                <thead class="bg-light">
                  <tr>
                    <th>Name</th>
                    <th>Description</th>
                    <th style="width: 120px">Perms</th>
                    <th class="text-end" style="width: 220px">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  <tr v-for="r in filteredRoles" :key="r.id">
                    <td class="fw-semibold">{{ r.name }}</td>
                    <td class="text-muted">{{ r.description || "-" }}</td>
                    <td>{{ (r.permissions || []).length }}</td>
                    <td class="text-end">
                      <button class="btn btn-sm btn-soft-primary me-1" @click="openEdit(r)">Edit</button>
                      <button class="btn btn-sm btn-soft-danger" @click="removeRole(r)">Delete</button>
                    </td>
                  </tr>

                  <tr v-if="filteredRoles.length === 0">
                    <td colspan="4" class="text-center text-muted py-4">No matching roles.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ✅ Modal: Create/Edit Role -->
    <div
      class="modal fade"
      id="roleModal"
      tabindex="-1"
      role="dialog"
      aria-hidden="true"
      ref="modalEl"
      style="zoom: 80%;"
    >
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content position-relative">
          <div class="modal-header bg-light">
            <h4 class="modal-title">{{ isEditMode ? "Edit Role" : "Create Role" }}</h4>
            <button
              type="button"
              class="btn-close"
              data-bs-dismiss="modal"
              aria-hidden="true"
              :disabled="saving"
            ></button>
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
                <div class="col-md-6">
                  <label class="form-label">Role Name *</label>
                  <input
                    v-model="form.name"
                    class="form-control"
                    placeholder="e.g. Cashier"
                    required
                    autocomplete="off"
                  />
                  <div class="invalid-feedback">Role name is required.</div>
                </div>

                <div class="col-md-6">
                  <label class="form-label">Description</label>
                  <input
                    v-model="form.description"
                    class="form-control"
                    placeholder="Optional (e.g. Can create orders, manage payments)"
                    autocomplete="off"
                  />
                </div>
              </div>

              <div class="mt-3 d-flex align-items-end justify-content-between gap-2 flex-wrap">
                <div class="flex-grow-1" style="min-width: 240px;">
                  <label class="form-label">Permissions *</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-search-line"></i></span>
                    <input
                      v-model="permQuery"
                      class="form-control"
                      placeholder="Filter permissions by code/description (e.g. users., orders.)"
                    />
                  </div>
                  <div v-if="triedSubmit && !selectedPermIds.length" class="text-danger small mt-1">
                    Please select at least one permission.
                  </div>
                </div>

                <div class="d-flex gap-2">
                  <button type="button" class="btn btn-light" @click="selectAllFilteredPerms">
                    Select filtered
                  </button>
                  <button type="button" class="btn btn-outline-secondary" @click="clearAllPerms">
                    Clear all
                  </button>
                </div>
              </div>

              <div class="mt-2">
                <div class="text-muted small">
                  Selected: <strong>{{ selectedPermIds.length }}</strong> /
                  <strong>{{ permissions.length }}</strong>
                </div>
              </div>

              <div class="row g-2 mt-2">
                <div
                  v-for="p in filteredPermissions"
                  :key="p.id"
                  class="col-12 col-md-6 col-lg-4"
                >
                  <label class="d-flex align-items-center gap-2 border rounded p-2 bg-white">
                    <input
                      type="checkbox"
                      class="form-check-input m-0"
                      :value="p.id"
                      v-model="selectedPermIds"
                    />
                    <div class="flex-grow-1">
                      <div class="fw-semibold">{{ p.code }}</div>
                      <small class="text-muted">{{ p.description || "" }}</small>
                    </div>
                  </label>
                </div>

                <div v-if="filteredPermissions.length === 0" class="col-12">
                  <div class="text-center text-muted py-3 border rounded bg-light">
                    No permissions match your search.
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving">Saving...</span>
              <span v-else>Save</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
