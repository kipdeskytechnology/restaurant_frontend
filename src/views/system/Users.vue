<!-- src/views/system/Users.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import { listUsers, createUser, updateUser, resetUserPassword } from "../../api/systemUsers";
import { listRoles } from "../../api/systemRoles";
import SearchSelect from "../../components/SearchSelect.vue";

const toast = useToast();

const loading = ref(true);
const saving = ref(false);

const users = ref([]);
const roles = ref([]);

const editingId = ref(null);
const triedSubmit = ref(false);

// Filters
const filterName = ref("");
const filterEmail = ref("");
const filterPhone = ref("");

// Modal refs
const modalEl = ref(null);
let modalInstance = null;

// Form (single role dropdown; payload -> role_ids:[id])
const form = ref({
  outlet_id: null,
  username: "",
  email: "",
  phone: "",
  first_name: "",
  last_name: "",
  is_active: true,
  role_id: null,
});

const isEditMode = computed(() => !!editingId.value);

const roleOptions = computed(() =>
  (roles.value || []).map((r) => ({ label: r.name, value: r.id }))
);

const filteredUsers = computed(() => {
  const n = filterName.value.trim().toLowerCase();
  const e = filterEmail.value.trim().toLowerCase();
  const p = filterPhone.value.trim().toLowerCase();

  return (users.value || []).filter((u) => {
    const fullName = `${u.first_name || ""} ${u.last_name || ""}`.trim().toLowerCase();
    const email = (u.email || "").toLowerCase();
    const phone = (u.phone || "").toLowerCase();
    const username = (u.username || "").toLowerCase();

    const okName = !n || fullName.includes(n) || username.includes(n);
    const okEmail = !e || email.includes(e);
    const okPhone = !p || phone.includes(p);

    return okName && okEmail && okPhone;
  });
});

function resetForm() {
  editingId.value = null;
  triedSubmit.value = false;
  form.value = {
    outlet_id: null,
    username: "",
    email: "",
    phone: "",
    first_name: "",
    last_name: "",
    is_active: true,
    role_id: null,
  };
}

function setFormFromUser(u) {
  editingId.value = u.id;

  const roleId =
    roles.value.find((r) => (u.roles || []).includes(r.name))?.id ?? null;

  form.value = {
    outlet_id: u.outlet_id ?? null,
    username: u.username || "",
    email: u.email || "",
    phone: u.phone || "",
    first_name: u.first_name || "",
    last_name: u.last_name || "",
    is_active: !!u.is_active,
    role_id: roleId,
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

async function openEdit(u) {
  setFormFromUser(u);
  triedSubmit.value = false;
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
    roles.value = await listRoles();
    users.value = await listUsers();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load users");
  } finally {
    loading.value = false;
  }
}

function validate() {
  triedSubmit.value = true;

  if (!form.value.email?.trim()) {
    toast.error("Email is required.");
    return false;
  }
  if (!form.value.first_name?.trim()) {
    toast.error("First Name is required.");
    return false;
  }
  if (!form.value.last_name?.trim()) {
    toast.error("Last Name is required.");
    return false;
  }
  if (!form.value.role_id) {
    toast.error("Role is required.");
    return false;
  }

  return true;
}

async function save() {
  if (!validate()) return;

  saving.value = true;
  try {
    const payload = {
      ...form.value,
      role_ids: form.value.role_id ? [form.value.role_id] : [],
    };
    delete payload.role_id;

    if (editingId.value) {
      await updateUser(editingId.value, payload);
      toast.success("User updated.");
    } else {
      await createUser(payload);
      toast.success("User created. OTP email sent.");
    }

    closeModal();
    resetForm();
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save user");
  } finally {
    saving.value = false;
  }
}

async function resetPassword(u) {
  if (!confirm(`Reset password for ${u.email || u.username || "user"}?`)) return;
  try {
    await resetUserPassword(u.id);
    toast.success("OTP reset. Email sent.");
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to reset password");
  }
}

function clearFilters() {
  filterName.value = "";
  filterEmail.value = "";
  filterPhone.value = "";
}

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <h4 class="page-title mb-0">Users</h4>

      <button class="btn btn-primary" @click="openCreate">
        <i class="ri-user-add-line me-1"></i> Add User
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
              <div class="col-md-3">
                <label class="form-label">Name / Username</label>
                <input
                  v-model="filterName"
                  class="form-control"
                  placeholder="Search by name or username (e.g. John, jdoe)"
                />
              </div>

              <div class="col-md-4">
                <label class="form-label">Email</label>
                <input
                  v-model="filterEmail"
                  class="form-control"
                  placeholder="Search by email (e.g. user@company.com)"
                />
              </div>

              <div class="col-md-3">
                <label class="form-label">Phone</label>
                <input
                  v-model="filterPhone"
                  class="form-control"
                  placeholder="Search by phone (e.g. 0971234567)"
                />
              </div>

              <div class="col-md-2 d-flex gap-2">
                <button class="btn btn-light w-100" @click="clearFilters">Clear</button>
              </div>

              <div class="col-12">
                <div class="text-muted small">
                  Showing <strong>{{ filteredUsers.length }}</strong> of <strong>{{ users.length }}</strong>
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
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Roles</th>
                    <th>Status</th>
                    <th class="text-end" style="width: 240px">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="u in filteredUsers" :key="u.id">
                    <td>{{ ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || (u.username || '-') }}</td>
                    <td>{{ u.email || "-" }}</td>
                    <td>{{ u.phone || "-" }}</td>
                    <td>{{ (u.roles || []).join(", ") || "-" }}</td>
                    <td>
                      <span class="badge" :class="u.is_active ? 'bg-success' : 'bg-secondary'">
                        {{ u.is_active ? "Active" : "Inactive" }}
                      </span>
                      <span v-if="u.must_change_password" class="badge bg-warning ms-2">Must Change PW</span>
                    </td>
                    <td class="text-end">
                      <button class="btn btn-sm btn-soft-primary me-1" @click="openEdit(u)">Edit</button>
                      <button class="btn btn-sm btn-soft-warning" @click="resetPassword(u)">Reset PW</button>
                    </td>
                  </tr>

                  <tr v-if="filteredUsers.length === 0">
                    <td colspan="6" class="text-center text-muted py-4">No matching users.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Create/Edit User -->
    <div class="modal fade" id="userModal" tabindex="-1" role="dialog" aria-hidden="true" ref="modalEl" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content position-relative">
          <div class="modal-header bg-light">
            <h4 class="modal-title">{{ isEditMode ? "Edit User" : "Create User" }}</h4>
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
              <div class="mb-3">
                <label class="form-label">Email *</label>
                <input
                  v-model="form.email"
                  type="email"
                  class="form-control"
                  placeholder="e.g. staff@kipdesky.com"
                  required
                  autocomplete="email"
                />
                <div class="invalid-feedback">Email is required.</div>

                <!-- ✅ Only show OTP hint on CREATE -->
                <small v-if="!isEditMode" class="text-muted">OTP will be sent to this email.</small>
              </div>

              <div class="row g-2">
                <div class="col-md-6">
                  <label class="form-label">Username</label>
                  <input
                    v-model="form.username"
                    class="form-control"
                    placeholder="Optional (e.g. jdoe)"
                    autocomplete="username"
                  />
                </div>

                <div class="col-md-6">
                  <label class="form-label">Phone</label>
                  <input
                    v-model="form.phone"
                    class="form-control"
                    placeholder="Optional (e.g. 0971234567)"
                    autocomplete="tel"
                  />
                </div>
              </div>

              <div class="row g-2 mt-2">
                <div class="col-md-6">
                  <label class="form-label">First Name *</label>
                  <input
                    v-model="form.first_name"
                    class="form-control"
                    placeholder="e.g. John"
                    required
                    autocomplete="given-name"
                  />
                  <div class="invalid-feedback">First Name is required.</div>
                </div>

                <div class="col-md-6">
                  <label class="form-label">Last Name *</label>
                  <input
                    v-model="form.last_name"
                    class="form-control"
                    placeholder="e.g. Banda"
                    required
                    autocomplete="family-name"
                  />
                  <div class="invalid-feedback">Last Name is required.</div>
                </div>
              </div>

              <!-- Role dropdown (required) -->
              <div class="mt-3">
                <label class="form-label">Role *</label>
                <SearchSelect
                  v-model="form.role_id"
                  :options="roleOptions"
                  placeholder="Select role (e.g. Cashier, Manager)"
                  :clearable="true"
                  :searchable="true"
                />
                <div v-if="triedSubmit && !form.role_id" class="text-danger small mt-1">
                  Role is required.
                </div>
              </div>

              <div class="form-check form-switch mt-3">
                <input class="form-check-input" type="checkbox" id="userActive" v-model="form.is_active" />
                <label class="form-check-label" for="userActive">Active</label>
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
