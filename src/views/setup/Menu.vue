<!-- src/views/setup/Menu.vue -->
<script setup>
import { ref, computed, onMounted, watch, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import {
  listMenuCategories,
  createMenuCategory,
  updateMenuCategory,
  deleteMenuCategory,
  listMenuItems,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  uploadMenuItemImage,
} from "../../api/menu";

const toast = useToast();
const loading = ref(true);
const refreshing = ref(false);

const categories = ref([]);
const items = ref([]);

// Category modal
const catModalEl = ref(null);
let catModalInstance = null;
const catEditId = ref(null);
const catTriedSubmit = ref(false);
const catSaving = ref(false);
const catForm = ref({ name: "", sort_order: "" });

// Item modal
const itemModalEl = ref(null);
let itemModalInstance = null;
const itemEditId = ref(null);
const itemTriedSubmit = ref(false);
const itemSaving = ref(false);
const itemForm = ref({
  category_id: "",
  sku: "",
  name: "",
  description: "",
  price: "",
  is_available: true,
  is_combo: false,
});
const pickedImage = ref(null);
const imagePreview = ref("");
const currentImageUrl = ref("");

// Filters
const filter = ref({
  category_id: "",
  q: "",
  available: "all",
});

const filteredParams = computed(() => ({
  category_id: filter.value.category_id || undefined,
  q: filter.value.q || undefined,
  available: filter.value.available || "all",
  limit: 200,
}));

const isCatEdit = computed(() => !!catEditId.value);
const isItemEdit = computed(() => !!itemEditId.value);

const categoryById = computed(() => {
  const m = new Map();
  for (const c of categories.value || []) m.set(c.id, c);
  return m;
});

const summary = computed(() => {
  const total = items.value.length;
  const available = items.value.filter((i) => i.is_available).length;
  const combos = items.value.filter((i) => i.is_combo).length;
  return { total, available, combos, categories: categories.value.length };
});

const PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f59e0b", "#10b981", "#06b6d4", "#0ea5e9",
];
function colorFor(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function resolveUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  const base = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";
  return `${base}${url}`;
}

const fmtMoney = (v) => {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

async function loadAll(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    categories.value = await listMenuCategories();
    items.value = await listMenuItems(filteredParams.value);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load menu");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function reloadItems() {
  try {
    items.value = await listMenuItems(filteredParams.value);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load items");
  }
}

let filterTimer = null;
watch(
  () => [filter.value.category_id, filter.value.q, filter.value.available],
  () => {
    if (loading.value) return;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => reloadItems(), 200);
  }
);

onMounted(loadAll);

// ===== Modals =====
async function ensureModal(refEl, key) {
  if (key === "cat" && catModalInstance) return catModalInstance;
  if (key === "item" && itemModalInstance) return itemModalInstance;
  let inst = null;
  try {
    const m = await import("bootstrap/js/dist/modal");
    inst = new m.default(refEl.value, { backdrop: "static", keyboard: false });
  } catch {
    inst = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(refEl.value, { backdrop: "static", keyboard: false })
      : null;
  }
  if (key === "cat") catModalInstance = inst;
  else itemModalInstance = inst;
  return inst;
}

// ===== Categories =====
function resetCategoryForm() {
  catEditId.value = null;
  catTriedSubmit.value = false;
  catForm.value = { name: "", sort_order: "" };
}
async function openCreateCategory() {
  resetCategoryForm();
  const inst = await ensureModal(catModalEl, "cat");
  inst?.show();
  await nextTick();
}
async function openEditCategory(c) {
  catEditId.value = c.id;
  catTriedSubmit.value = false;
  catForm.value = { name: c.name, sort_order: c.sort_order ?? "" };
  const inst = await ensureModal(catModalEl, "cat");
  inst?.show();
  await nextTick();
}

async function saveCategory() {
  catTriedSubmit.value = true;
  const payload = {
    name: (catForm.value.name || "").trim(),
    sort_order: catForm.value.sort_order === "" ? null : Number(catForm.value.sort_order),
  };
  if (!payload.name) {
    toast.error("Category name is required");
    return;
  }

  catSaving.value = true;
  try {
    if (catEditId.value) {
      await updateMenuCategory(catEditId.value, payload);
      toast.success("Category updated");
    } else {
      await createMenuCategory(payload);
      toast.success("Category created");
    }
    catModalInstance?.hide();
    resetCategoryForm();
    await loadAll(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save category");
  } finally {
    catSaving.value = false;
  }
}

async function removeCategory(id) {
  if (!confirm("Delete this category? Items in it will become uncategorised.")) return;
  try {
    await deleteMenuCategory(id);
    toast.success("Category deleted");
    await loadAll(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete category");
  }
}

// ===== Items =====
function resetItemForm() {
  itemEditId.value = null;
  itemTriedSubmit.value = false;
  itemForm.value = {
    category_id: "",
    sku: "",
    name: "",
    description: "",
    price: "",
    is_available: true,
    is_combo: false,
  };
  pickedImage.value = null;
  imagePreview.value = "";
  currentImageUrl.value = "";
}

async function openCreateItem() {
  resetItemForm();
  // pre-fill category from current filter if set
  if (filter.value.category_id) {
    itemForm.value.category_id = Number(filter.value.category_id);
  }
  const inst = await ensureModal(itemModalEl, "item");
  inst?.show();
  await nextTick();
}

async function openEditItem(it) {
  itemEditId.value = it.id;
  itemTriedSubmit.value = false;
  itemForm.value = {
    category_id: it.category_id ?? "",
    sku: it.sku ?? "",
    name: it.name ?? "",
    description: it.description ?? "",
    price: it.price ?? "",
    is_available: !!it.is_available,
    is_combo: !!it.is_combo,
  };
  pickedImage.value = null;
  currentImageUrl.value = it.image_url ? resolveUrl(it.image_url) : "";
  imagePreview.value = currentImageUrl.value;
  const inst = await ensureModal(itemModalEl, "item");
  inst?.show();
  await nextTick();
}

function onPickImage(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  pickedImage.value = f;
  imagePreview.value = URL.createObjectURL(f);
}
function clearPickedImage() {
  pickedImage.value = null;
  imagePreview.value = currentImageUrl.value;
}

async function saveItem() {
  itemTriedSubmit.value = true;
  const payload = {
    category_id: itemForm.value.category_id === "" ? null : Number(itemForm.value.category_id),
    sku: itemForm.value.sku?.trim() || null,
    name: itemForm.value.name?.trim(),
    description: itemForm.value.description?.trim() || null,
    price: Number(itemForm.value.price),
    is_available: !!itemForm.value.is_available,
    is_combo: !!itemForm.value.is_combo,
  };

  if (!payload.name) { toast.error("Item name is required"); return; }
  if (!payload.price || payload.price <= 0) { toast.error("Price must be > 0"); return; }

  itemSaving.value = true;
  try {
    let saved;
    if (itemEditId.value) {
      saved = await updateMenuItem(itemEditId.value, payload);
      toast.success("Item updated");
    } else {
      saved = await createMenuItem(payload);
      toast.success("Item created");
      itemEditId.value = saved.id;
    }

    if (pickedImage.value && itemEditId.value) {
      saved = await uploadMenuItemImage(itemEditId.value, pickedImage.value);
      toast.success("Image uploaded");
    }

    itemModalInstance?.hide();
    resetItemForm();
    await reloadItems();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save item");
  } finally {
    itemSaving.value = false;
  }
}

async function removeItem(id) {
  if (!confirm("Delete this item? (soft delete)")) return;
  try {
    await deleteMenuItem(id);
    toast.success("Item deleted");
    await reloadItems();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete item");
  }
}

function clearFilters() {
  filter.value = { category_id: "", q: "", available: "all" };
}

function stop(e) { e?.stopPropagation?.(); }
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-restaurant-line"></i><span>Setup</span>
          </div>
          <h1 class="hero-title">Menu</h1>
          <p class="hero-sub">
            Your sellable catalog — categories on the left, items with prices and images on the right. Toggle availability to hide items from POS without deleting them.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="loadAll(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button class="btn btn-pill btn-cta" @click="openCreateItem">
            <i class="ri-add-line"></i><span>New Item</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon tone-primary"><i class="ri-folder-3-line"></i></div>
          <div>
            <div class="stat-label">Categories</div>
            <div class="stat-value">{{ summary.categories }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-info"><i class="ri-restaurant-2-line"></i></div>
          <div>
            <div class="stat-label">Items</div>
            <div class="stat-value">{{ summary.total }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-success"><i class="ri-check-line"></i></div>
          <div>
            <div class="stat-label">Available</div>
            <div class="stat-value text-success">{{ summary.available }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-warning"><i class="ri-stack-line"></i></div>
          <div>
            <div class="stat-label">Combos</div>
            <div class="stat-value">{{ summary.combos }}</div>
          </div>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-md-4">
              <label class="form-label">Search</label>
              <div class="position-relative">
                <i class="ri-search-line search-ico"></i>
                <input v-model="filter.q" class="form-control ps-5" placeholder="Search items by name…" />
              </div>
            </div>

            <div class="col-md-3">
              <label class="form-label">Category</label>
              <select v-model="filter.category_id" class="form-select">
                <option value="">All categories</option>
                <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>

            <div class="col-md-3">
              <label class="form-label">Availability</label>
              <select v-model="filter.available" class="form-select">
                <option value="all">All</option>
                <option value="1">Available</option>
                <option value="0">Hidden</option>
              </select>
            </div>

            <div class="col-md-2 d-grid">
              <button class="btn btn-light" @click="clearFilters">
                <i class="ri-filter-off-line me-1"></i>Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading menu…</div>
        </div>
      </div>

      <div v-else class="row g-3">
        <!-- ============== CATEGORIES ============== -->
        <div class="col-lg-4">
          <div class="card panel-card">
            <div class="panel-head">
              <div>
                <div class="panel-eyebrow">Catalog</div>
                <div class="panel-title">Categories</div>
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="status-pill pill-soft">
                  <i class="ri-folder-3-line"></i> {{ categories.length }}
                </span>
                <button class="btn btn-soft-primary btn-sm" @click="openCreateCategory">
                  <i class="ri-add-line me-1"></i>New
                </button>
              </div>
            </div>

            <div class="card-body p-3">
              <div v-if="categories.length === 0" class="empty-inline">
                <div class="empty-inline-icon"><i class="ri-folder-3-line"></i></div>
                <div class="small text-muted">No categories yet — add Burgers, Drinks, Desserts…</div>
              </div>

              <div v-else class="cat-list">
                <button
                  v-for="c in categories"
                  :key="c.id"
                  type="button"
                  class="cat-row"
                  :class="{ 'is-active': Number(filter.category_id) === c.id }"
                  :style="{ '--accent': colorFor(c.name) }"
                  @click="filter.category_id = filter.category_id === c.id ? '' : c.id"
                >
                  <span class="cat-avatar">{{ initialsOf(c.name) }}</span>
                  <div class="min-w-0">
                    <div class="cat-name truncate">{{ c.name }}</div>
                    <div class="cat-sub">Sort: {{ c.sort_order ?? '—' }}</div>
                  </div>
                  <div class="cat-actions" @click="stop">
                    <button class="row-icon-btn" title="Edit" @click="openEditCategory(c)">
                      <i class="ri-pencil-line"></i>
                    </button>
                    <button class="row-icon-btn danger" title="Delete" @click="removeCategory(c.id)">
                      <i class="ri-delete-bin-line"></i>
                    </button>
                  </div>
                </button>
              </div>

              <div v-if="filter.category_id" class="filter-hint mt-2">
                <i class="ri-filter-line me-1"></i>
                Filtering items by selected category
                <button class="btn btn-link btn-sm p-0 ms-1" @click="filter.category_id = ''">clear</button>
              </div>
            </div>
          </div>
        </div>

        <!-- ============== ITEMS ============== -->
        <div class="col-lg-8">
          <div class="card panel-card">
            <div class="panel-head">
              <div>
                <div class="panel-eyebrow">Catalog</div>
                <div class="panel-title">Menu items</div>
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="status-pill pill-soft">
                  <i class="ri-restaurant-2-line"></i> {{ items.length }}
                </span>
                <button class="btn btn-soft-primary btn-sm" @click="openCreateItem">
                  <i class="ri-add-line me-1"></i>New item
                </button>
              </div>
            </div>

            <div v-if="items.length === 0" class="card-body">
              <div class="empty-inline">
                <div class="empty-inline-icon"><i class="ri-restaurant-2-line"></i></div>
                <div>
                  <div class="small fw-semibold">No items found</div>
                  <div class="small text-muted">Try clearing filters or add a new item.</div>
                </div>
              </div>
            </div>

            <div v-else class="data-scroll">
              <table class="table align-middle mb-0 menu-table">
                <thead>
                  <tr>
                    <th style="width: 60px"></th>
                    <th>Item</th>
                    <th style="width: 160px">Category</th>
                    <th style="width: 100px">SKU</th>
                    <th style="width: 110px" class="text-end">Price</th>
                    <th style="width: 120px" class="text-center">Status</th>
                    <th style="width: 90px" class="text-end"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="it in items"
                    :key="it.id"
                    class="item-row"
                    @click="openEditItem(it)"
                  >
                    <td>
                      <div class="item-img-wrap">
                        <img v-if="it.image_url" :src="resolveUrl(it.image_url)" :alt="it.name" />
                        <div v-else class="item-img-fallback" :style="{ '--accent': colorFor(it.name) }">
                          <i class="ri-image-line"></i>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div class="item-name">{{ it.name }}</div>
                      <div class="item-desc truncate" v-if="it.description" :title="it.description">{{ it.description }}</div>
                    </td>
                    <td>
                      <span v-if="it.category_id && categoryById.get(it.category_id)" class="cat-chip" :style="{ '--accent': colorFor(categoryById.get(it.category_id).name) }">
                        <span class="dot"></span>{{ categoryById.get(it.category_id).name }}
                      </span>
                      <span v-else class="text-muted">—</span>
                    </td>
                    <td>
                      <span v-if="it.sku" class="sku-chip">{{ it.sku }}</span>
                      <span v-else class="text-muted">—</span>
                    </td>
                    <td class="text-end">
                      <span class="amount-mono">K {{ fmtMoney(it.price) }}</span>
                    </td>
                    <td class="text-center">
                      <div class="d-flex flex-column align-items-center gap-1">
                        <span class="status-pill" :class="it.is_available ? 'pill-on' : 'pill-off'">
                          <span class="dot-mini"></span>{{ it.is_available ? 'Available' : 'Hidden' }}
                        </span>
                        <span v-if="it.is_combo" class="combo-chip"><i class="ri-stack-line"></i>Combo</span>
                      </div>
                    </td>
                    <td class="text-end" @click.stop>
                      <button class="row-icon-btn" title="Edit" @click="openEditItem(it)">
                        <i class="ri-pencil-line"></i>
                      </button>
                      <button class="row-icon-btn danger" title="Delete" @click="removeItem(it.id)">
                        <i class="ri-delete-bin-line"></i>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Modal: Category ============== -->
    <div class="modal fade" tabindex="-1" aria-hidden="true" ref="catModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isCatEdit ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isCatEdit ? "Edit category" : "New category" }}</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="catSaving"></button>
          </div>

          <div v-if="catSaving" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <form @submit.prevent="saveCategory" novalidate :class="{ 'was-validated': catTriedSubmit }">
              <div class="row g-3">
                <div class="col-md-8">
                  <label class="form-label">Name *</label>
                  <input v-model="catForm.name" class="form-control" placeholder="e.g. Burgers" autocomplete="off" required />
                </div>
                <div class="col-md-4">
                  <label class="form-label">Sort order</label>
                  <input v-model="catForm.sort_order" type="number" class="form-control" placeholder="10" />
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="catSaving">Cancel</button>
            <button class="btn btn-primary" :disabled="catSaving" @click="saveCategory">
              <span v-if="catSaving" class="spinner-border spinner-border-sm me-1"></span>
              {{ isCatEdit ? "Update category" : "Create category" }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Modal: Item ============== -->
    <div class="modal fade" tabindex="-1" aria-hidden="true" ref="itemModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isItemEdit ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isItemEdit ? "Edit menu item" : "New menu item" }}</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="itemSaving"></button>
          </div>

          <div v-if="itemSaving" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <form @submit.prevent="saveItem" novalidate :class="{ 'was-validated': itemTriedSubmit }">
              <div class="row g-3">
                <!-- Image dropzone -->
                <div class="col-md-4">
                  <label class="form-label">Image</label>
                  <label class="img-zone" :class="{ has: imagePreview }">
                    <input type="file" class="d-none" accept="image/*" @change="onPickImage" />
                    <img v-if="imagePreview" :src="imagePreview" alt="preview" />
                    <div v-else class="img-placeholder">
                      <i class="ri-image-add-line"></i>
                      <div class="small">Click to upload</div>
                    </div>
                  </label>
                  <button v-if="pickedImage" type="button" class="btn btn-sm btn-light mt-2 w-100" @click="clearPickedImage">
                    <i class="ri-close-line me-1"></i>Cancel new image
                  </button>
                </div>

                <div class="col-md-8">
                  <div class="row g-2">
                    <div class="col-12">
                      <label class="form-label">Name *</label>
                      <input v-model="itemForm.name" class="form-control" placeholder="e.g. Cheeseburger" required autocomplete="off" />
                    </div>

                    <div class="col-md-6">
                      <label class="form-label">Category</label>
                      <select v-model="itemForm.category_id" class="form-select">
                        <option value="">— No category —</option>
                        <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                      </select>
                    </div>

                    <div class="col-md-6">
                      <label class="form-label">SKU</label>
                      <input v-model="itemForm.sku" class="form-control" placeholder="Optional" autocomplete="off" />
                    </div>

                    <div class="col-12">
                      <label class="form-label">Price *</label>
                      <div class="input-group">
                        <span class="input-group-text">K</span>
                        <input v-model="itemForm.price" type="number" step="0.01" class="form-control" placeholder="0.00" required />
                      </div>
                    </div>
                  </div>
                </div>

                <div class="col-12">
                  <label class="form-label">Description</label>
                  <textarea v-model="itemForm.description" class="form-control" rows="2" placeholder="What's in it? Allergens, sizing, etc."></textarea>
                </div>

                <div class="col-md-6">
                  <div class="toggle-card">
                    <div>
                      <div class="fw-semibold">Available</div>
                      <div class="small text-muted">Hidden items don't appear in POS pickers.</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input id="itemAvail" v-model="itemForm.is_available" class="form-check-input" type="checkbox" />
                    </div>
                  </div>
                </div>

                <div class="col-md-6">
                  <div class="toggle-card">
                    <div>
                      <div class="fw-semibold">Combo</div>
                      <div class="small text-muted">Marks this as a combo / meal deal.</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input id="itemCombo" v-model="itemForm.is_combo" class="form-check-input" type="checkbox" />
                    </div>
                  </div>
                </div>

                <div class="col-12">
                  <div class="tip-card">
                    <i class="ri-lightbulb-flash-line tip-icon"></i>
                    <div class="small">
                      <div class="fw-semibold mb-1">Pro tip</div>
                      <div class="text-muted">
                        Image upload happens after save — pick a file here and it'll attach to the item once created.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="itemSaving">Cancel</button>
            <button class="btn btn-primary" :disabled="itemSaving" @click="saveItem">
              <span v-if="itemSaving" class="spinner-border spinner-border-sm me-1"></span>
              {{ isItemEdit ? "Update item" : "Create item" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
.rotating { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ============= Hero ============= */
.page-hero {
  position: relative;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem;
  padding: 1.5rem 1.75rem; margin-bottom: 1.25rem;
  border-radius: 22px;
  background: linear-gradient(135deg, #0f172a 0%, #6366f1 55%, #8b5cf6 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(99,102,241,0.55);
  overflow: hidden; flex-wrap: wrap;
}
.page-hero::before {
  content: ""; position: absolute; inset: 0;
  background:
    radial-gradient(220px 140px at 90% 10%, rgba(255,255,255,0.22), transparent 65%),
    radial-gradient(280px 180px at 0% 110%, rgba(255,255,255,0.14), transparent 65%);
  pointer-events: none;
}
.page-hero-text { position: relative; max-width: 700px; }
.eyebrow {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.25rem 0.65rem;
  background: rgba(255,255,255,0.18);
  border-radius: 999px;
  font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  margin-bottom: 0.6rem;
}
.hero-title { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.025em; font-size: 1.85rem; margin: 0; color: #fff; }
.hero-sub { color: rgba(255,255,255,0.85); margin: 0.35rem 0 0; font-size: 0.9rem; }
.page-hero-actions { position: relative; display: flex; gap: 0.5rem; flex-wrap: wrap; }
.btn-pill { border-radius: 999px !important; display: inline-flex; align-items: center; gap: 0.4rem; }
.page-hero-actions .btn-light { background: rgba(255,255,255,0.95); color: #0f172a; border: none; }
.btn-cta { background: #fff !important; color: #4f46e5 !important; font-weight: 700; border: none; box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3); }

/* ============= Stat strip ============= */
.stat-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.75rem; }
.stat-tile {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.85rem 1rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px; box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.stat-icon { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; font-size: 1.05rem; }
.stat-icon.tone-primary { background: rgba(99,102,241,0.12); color: #4f46e5; }
.stat-icon.tone-info { background: rgba(6,182,212,0.14); color: #0e7490; }
.stat-icon.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.stat-icon.tone-warning { background: rgba(245,158,11,0.18); color: #b45309; }
.stat-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ct-secondary-color, #64748b); }
.stat-value { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.05rem; color: var(--ct-body-color, #0f172a); }

/* ============= Toolbar ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(99,102,241,0.04) 0%, transparent 100%); }
.search-ico {
  position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8); pointer-events: none;
}

/* ============= Panel cards ============= */
.panel-card {
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.panel-head {
  padding: 1rem 1.25rem;
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  background: linear-gradient(180deg, rgba(99,102,241,0.04), transparent);
}
.panel-eyebrow { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ct-primary, #6366f1); }
.panel-title { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.05rem; color: var(--ct-body-color, #0f172a); }

.status-pill {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.15rem 0.5rem; border-radius: 999px;
  font-size: 0.68rem; font-weight: 700;
}
.dot-mini { width: 6px; height: 6px; border-radius: 50%; }
.pill-on { background: rgba(16,185,129,0.14); color: #047857; }
.pill-on .dot-mini { background: #10b981; }
.pill-off { background: rgba(100,116,139,0.14); color: #64748b; }
.pill-off .dot-mini { background: #94a3b8; }
.pill-soft { background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); }

.empty-inline {
  display: flex; align-items: center; gap: 0.65rem;
  padding: 1rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
}
.empty-inline-icon {
  width: 38px; height: 38px;
  border-radius: 10px;
  display: grid; place-items: center;
  background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1);
  flex-shrink: 0;
}

/* ============= Categories list ============= */
.cat-list {
  display: flex; flex-direction: column; gap: 0.4rem;
  max-height: calc(100vh - 580px);
  min-height: 200px;
  overflow-y: auto;
  scrollbar-width: thin;
  padding-right: 4px;
}
.cat-list::-webkit-scrollbar { width: 8px; }
.cat-list::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.cat-row {
  display: flex; align-items: center; gap: 0.65rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
  position: relative;
}
.cat-row::before {
  content: "";
  position: absolute; left: 0; top: 18%; bottom: 18%;
  width: 3px;
  background: var(--accent, #6366f1);
  border-radius: 0 3px 3px 0;
  opacity: 0.85;
}
.cat-row:hover {
  border-color: color-mix(in srgb, var(--accent, #6366f1) 50%, transparent);
  transform: translateY(-1px);
  box-shadow: 0 8px 18px -10px rgba(15,23,42,0.18);
}
.cat-row.is-active {
  border-color: color-mix(in srgb, var(--accent, #6366f1) 60%, transparent);
  background: color-mix(in srgb, var(--accent, #6366f1) 6%, transparent);
}
.cat-avatar {
  width: 32px; height: 32px;
  border-radius: 9px;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 0.72rem;
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 26%, transparent);
  flex-shrink: 0;
}
.cat-name {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 700; font-size: 0.88rem;
  color: var(--ct-body-color, #0f172a);
}
.cat-sub {
  font-size: 0.7rem;
  color: var(--ct-secondary-color, #64748b);
  font-family: "JetBrains Mono", ui-monospace, monospace;
}
.cat-actions {
  margin-left: auto;
  display: flex; gap: 0.2rem;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.cat-row:hover .cat-actions, .cat-row:focus-within .cat-actions { opacity: 1; }
@media (hover: none) { .cat-actions { opacity: 1; } }

.row-icon-btn {
  width: 28px; height: 28px;
  border-radius: 7px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
  font-size: 0.85rem;
  margin-left: 2px;
}
.row-icon-btn:hover { background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); }
.row-icon-btn.danger:hover { background: rgba(239,68,68,0.1); color: #ef4444; }

.filter-hint {
  font-size: 0.78rem;
  color: var(--ct-secondary-color, #64748b);
  padding: 0.4rem 0.6rem;
  background: rgba(99,102,241,0.06);
  border: 1px dashed rgba(99,102,241,0.25);
  border-radius: 8px;
}

.truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.min-w-0 { min-width: 0; }

/* ============= Items table ============= */
.data-scroll {
  max-height: calc(100vh - 460px);
  min-height: 240px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.menu-table thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}
.item-row { cursor: pointer; transition: background 0.15s ease; }
.item-row:hover { background: rgba(99,102,241,0.04); }

.item-img-wrap {
  width: 44px; height: 44px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
}
.item-img-wrap img { width: 100%; height: 100%; object-fit: cover; }
.item-img-fallback {
  width: 100%; height: 100%;
  display: grid; place-items: center;
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 10%, transparent);
}
.item-img-fallback i { font-size: 1.2rem; }

.item-name { font-weight: 700; color: var(--ct-body-color, #0f172a); line-height: 1.25; }
.item-desc {
  font-size: 0.72rem;
  color: var(--ct-secondary-color, #64748b);
  margin-top: 0.1rem;
  max-width: 320px;
}

.cat-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem; font-weight: 600;
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 22%, transparent);
}
.cat-chip .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent, #6366f1);
}

.sku-chip {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.72rem; font-weight: 600;
  padding: 0.15rem 0.45rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 6px;
  color: var(--ct-secondary-color, #64748b);
}

.amount-mono {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700; font-size: 0.88rem;
  color: var(--ct-body-color, #0f172a);
}

.combo-chip {
  display: inline-flex; align-items: center; gap: 0.25rem;
  font-size: 0.65rem; font-weight: 700;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: rgba(245,158,11,0.18); color: #b45309;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.combo-chip i { font-size: 0.85rem; }

/* ============= Modal ============= */
:deep(.modal-modern) {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 22px !important;
  overflow: hidden;
  box-shadow: 0 30px 60px -20px rgba(15,23,42,0.35);
  background: var(--ct-card-bg, #fff);
}
:deep(.modal-header-modern) {
  padding: 1.25rem 1.5rem 1rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  display: flex; justify-content: space-between; align-items: flex-start;
}
:deep(.modal-eyebrow) { font-size: 0.68rem; font-weight: 700; color: var(--ct-primary, #6366f1); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.25rem; }
:deep(.modal-header-modern .modal-title) { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.25rem; }
:deep(.modal-body-modern) {
  padding: 1.5rem;
  max-height: calc(100vh - 240px);
  overflow-y: auto;
  scrollbar-width: thin;
}

.modal-overlay {
  position: absolute; inset: 0; z-index: 5;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
}

.toggle-card {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  background: var(--ct-tertiary-bg, #f8fafc);
}
.tip-card {
  display: flex; gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: rgba(99,102,241,0.06);
  border: 1px solid rgba(99,102,241,0.18);
  align-items: flex-start;
}
.tip-icon { font-size: 1.2rem; color: var(--ct-primary, #6366f1); flex-shrink: 0; }

/* Image dropzone */
.img-zone {
  display: flex; align-items: center; justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  border: 2px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 14px;
  background: var(--ct-tertiary-bg, #f8fafc);
  cursor: pointer;
  overflow: hidden;
  transition: all 0.15s ease;
}
.img-zone:hover {
  border-color: var(--ct-primary, #6366f1);
  background: rgba(99,102,241,0.04);
}
.img-zone.has { padding: 0; border-style: solid; }
.img-zone img { width: 100%; height: 100%; object-fit: cover; }
.img-placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
  color: var(--ct-secondary-color, #64748b);
}
.img-placeholder i { font-size: 1.8rem; color: var(--ct-primary, #6366f1); }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
