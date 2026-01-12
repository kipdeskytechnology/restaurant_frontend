<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import {
  listMenuCategories,
  createMenuCategory,
  updateMenuCategory,
  deleteMenuCategory,
} from "../../api/menu";

const toast = useToast();

const loading = ref(false);
const saving = ref(false);

const rows = ref([]);

// Filters
const q = ref("");

// Modal
const modalEl = ref(null);
let modalInstance = null;

// Edit/Create
const editId = ref(null);
const triedSubmit = ref(false);

const form = ref({
  name: "",
  sort_order: "",
});

const isEditMode = computed(() => !!editId.value);

const counts = computed(() => ({
  total: rows.value.length,
}));

const filtered = computed(() => {
  const qq = q.value.trim().toLowerCase();
  if (!qq) return rows.value || [];
  return (rows.value || []).filter((r) => String(r.name || "").toLowerCase().includes(qq));
});

function resetForm() {
  editId.value = null;
  triedSubmit.value = false;
  form.value = { name: "", sort_order: "" };
}

function setFormFromRow(r) {
  editId.value = r.id;
  triedSubmit.value = false;
  form.value = {
    name: r.name ?? "",
    sort_order: r.sort_order ?? "",
  };
}

function normalizePayload() {
  return {
    name: String(form.value.name || "").trim(),
    sort_order: form.value.sort_order === "" ? null : Number(form.value.sort_order),
  };
}

function validate(payload) {
  triedSubmit.value = true;
  if (!payload.name) {
    toast.error("Category name is required.");
    return false;
  }
  if (payload.sort_order !== null && !Number.isFinite(payload.sort_order)) {
    toast.error("Sort order must be a number.");
    return false;
  }
  return true;
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

async function openEdit(r) {
  setFormFromRow(r);
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
    rows.value = await listMenuCategories();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load categories");
  } finally {
    loading.value = false;
  }
}

async function save() {
  const payload = normalizePayload();
  if (!validate(payload)) return;

  saving.value = true;
  try {
    if (editId.value) {
      await updateMenuCategory(editId.value, payload);
      toast.success("Category updated");
    } else {
      await createMenuCategory(payload);
      toast.success("Category created");
    }

    closeModal();
    resetForm();
    await load(); // keeps ordering correct
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save category");
  } finally {
    saving.value = false;
  }
}

async function removeRow(r) {
  if (!confirm(`Delete category "${r.name}"?`)) return;
  try {
    await deleteMenuCategory(r.id);
    toast.success("Category deleted");
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete category");
  }
}

function clearSearch() {
  q.value = "";
}

function stop(e) {
  e?.stopPropagation?.();
}

function onKeyOpen(e, r) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openEdit(r);
  }
}

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <!-- Header -->
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Menu Categories</h4>
        <div class="text-muted small">
          <strong>{{ counts.total }}</strong> categories •
          <span class="text-muted">Lower sort order appears first</span>
        </div>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-primary" :disabled="loading" @click="load">
          <i class="ri-refresh-line me-1"></i> Refresh
        </button>
        <button class="btn btn-primary" @click="openCreate">
          <i class="ri-add-line me-1"></i> New Category
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="card mb-3 cat-card" style="zoom: 80%;">
      <div class="card-body py-2">
        <div class="row g-2 align-items-end">
          <div class="col-md-8">
            <div class="input-group">
              <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
              <input
                v-model="q"
                class="form-control"
                placeholder="Search categories (e.g. Burgers, Drinks, Desserts)"
              />
              <button class="btn btn-light" :disabled="!q" @click="clearSearch">Clear</button>
            </div>
          </div>

          <div class="col-md-4 text-md-end">
            <div class="text-muted small">
              Showing <strong>{{ filtered.length }}</strong> of <strong>{{ rows.length }}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card cat-card" style="zoom: 80%;">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading categories…</div>
      </div>
    </div>

    <!-- Empty -->
    <div v-else-if="filtered.length === 0" class="card cat-card" style="zoom: 80%;">
      <div class="card-body text-center text-muted py-5">
        <div class="empty-emoji">📋</div>
        <div class="mt-2">No categories found.</div>
        <button class="btn btn-primary mt-3" @click="openCreate">
          <i class="ri-add-line me-1"></i> Create first category
        </button>
      </div>
    </div>

    <!-- Cards grid -->
    <div v-else class="row g-3" style="zoom: 80%;">
      <div v-for="r in filtered" :key="r.id" class="col-12 col-md-6 col-xl-4 d-flex">
        <div
          class="cat-tile w-100"
          role="button"
          tabindex="0"
          @click="openEdit(r)"
          @keydown="onKeyOpen($event, r)"
        >
          <div class="cat-top">
            <div class="cat-icon">
              <i class="ri-restaurant-2-line"></i>
            </div>

            <div class="cat-main">
              <div class="cat-name" :title="r.name">{{ r.name }}</div>
              <div class="cat-sub">
                <span class="chip">
                  <i class="ri-sort-desc me-1"></i>
                  Sort: {{ r.sort_order ?? "Last" }}
                </span>
                <span class="chip subtle">
                  <i class="ri-hashtag me-1"></i>
                  ID: {{ r.id }}
                </span>
              </div>
            </div>

            <div class="cat-badge">
              {{ r.sort_order ?? "—" }}
            </div>
          </div>

          <div class="cat-actions" @click="stop">
            <button class="btn btn-sm btn-soft-primary" @click="openEdit(r)">
              <i class="ri-edit-line me-1"></i> Edit
            </button>
            <button class="btn btn-sm btn-soft-danger" @click="removeRow(r)">
              <i class="ri-delete-bin-6-line me-1"></i> Delete
            </button>

            <div class="ms-auto text-muted small">
              Tap card to edit
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Create/Edit -->
    <div class="modal fade" id="categoryModal" tabindex="-1" role="dialog" aria-hidden="true" ref="modalEl" style="zoom: 80%;">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content position-relative">
          <div class="modal-header bg-transparent">
            <div>
              <h4 class="modal-title mb-0">{{ isEditMode ? "Edit Category" : "Create Category" }}</h4>
              <div class="text-muted small">Keep categories clear and ordered like a real menu</div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true" :disabled="saving"></button>
          </div>

          <!-- Saving overlay -->
          <div
            v-if="saving"
            class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style="background: rgba(250,251,254,0.72); backdrop-filter: blur(2px); z-index: 10;"
          >
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body">
            <form @submit.prevent="save" novalidate :class="{ 'was-validated': triedSubmit }">
              <div class="row g-2">
                <div class="col-12">
                  <label class="form-label">Name *</label>
                  <input
                    v-model="form.name"
                    class="form-control"
                    placeholder="e.g. Burgers, Drinks, Desserts"
                    required
                    autocomplete="off"
                  />
                  <div class="invalid-feedback">Name is required.</div>
                </div>

                <div class="col-12">
                  <label class="form-label">Sort Order (optional)</label>
                  <input
                    v-model="form.sort_order"
                    type="number"
                    class="form-control"
                    placeholder="Lower appears first (e.g. 10)"
                  />
                  <div class="form-text">Leave blank to push it toward the end.</div>
                </div>

                <div class="col-12">
                  <div class="alert alert-light border mb-0">
                    <div class="d-flex align-items-start gap-2">
                      <i class="ri-information-line mt-1"></i>
                      <div class="small">
                        <div class="fw-semibold">Restaurant tip</div>
                        <div class="text-muted">
                          Put high-selling sections first (e.g. Burgers, Pizza), then sides, then drinks and desserts.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving" @click="resetForm">
              Cancel
            </button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving">Saving…</span>
              <span v-else>{{ isEditMode ? "Update" : "Create" }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
.empty-emoji { font-size: 44px; }

.cat-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
}

/* Tile */
.cat-tile {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
  transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
  outline: none;
}

.cat-tile:hover,
.cat-tile:focus {
  transform: translateY(-2px);
  box-shadow: var(--ct-box-shadow-lg);
  border-color: rgba(var(--ct-primary-rgb), 0.30);
}

.cat-top {
  padding: 14px;
  display: grid;
  grid-template-columns: 46px 1fr auto;
  gap: 12px;
  align-items: start;
  background: linear-gradient(
    180deg,
    rgba(var(--ct-primary-rgb), 0.10),
    rgba(var(--ct-primary-rgb), 0)
  );
}

.cat-icon {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 20px;
  color: var(--ct-primary);
  background: rgba(var(--ct-primary-rgb), 0.14);
  border: 1px solid rgba(var(--ct-primary-rgb), 0.28);
}

.cat-main { min-width: 0; }

.cat-name {
  font-weight: 900;
  color: var(--ct-emphasis-color);
  line-height: 1.2;
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cat-sub {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--ct-border-color-translucent);
  background: rgba(var(--ct-body-color-rgb), 0.06);
  color: var(--ct-emphasis-color);
  font-size: 11px;
  font-weight: 800;
}
.chip.subtle {
  color: var(--ct-secondary-color);
  background: rgba(var(--ct-body-color-rgb), 0.04);
}

.cat-badge {
  min-width: 54px;
  text-align: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-weight: 900;
  color: var(--ct-primary);
  background: rgba(var(--ct-primary-rgb), 0.12);
  border: 1px solid rgba(var(--ct-primary-rgb), 0.18);
}

.cat-actions {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--ct-tertiary-bg);
  border-top: 1px solid var(--ct-border-color-translucent);
  flex-wrap: wrap;
}
</style>
