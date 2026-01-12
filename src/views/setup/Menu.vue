<script setup>
import { ref, computed, onMounted } from "vue";
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

// If you already have an outlets API, you can plug it in later for overrides UI.
// import { listOutlets } from "../../api/systemOutlets";

const toast = useToast();
const loading = ref(true);

const categories = ref([]);
const items = ref([]);

const categoryForm = ref({ id: null, name: "", sort_order: "" });

const itemForm = ref({
  id: null,
  category_id: "",
  sku: "",
  name: "",
  description: "",
  price: "",
  is_available: true,
  is_combo: false,
});

const filter = ref({
  category_id: "",
  q: "",
  available: "all",
});

const pickedImage = ref(null);
const imagePreview = ref("");

const filteredParams = computed(() => ({
  category_id: filter.value.category_id || undefined,
  q: filter.value.q || undefined,
  available: filter.value.available || "all",
  limit: 200,
}));

function resolveUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  const base = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";
  return `${base}${url}`;
}

async function loadAll() {
  loading.value = true;
  try {
    categories.value = await listMenuCategories();
    items.value = await listMenuItems(filteredParams.value);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load menu");
  } finally {
    loading.value = false;
  }
}

async function reloadItems() {
  try {
    items.value = await listMenuItems(filteredParams.value);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load items");
  }
}

onMounted(loadAll);

// ----- Categories -----
function resetCategoryForm() {
  categoryForm.value = { id: null, name: "", sort_order: "" };
}

function editCategory(c) {
  categoryForm.value = { id: c.id, name: c.name, sort_order: c.sort_order ?? "" };
}

async function saveCategory() {
  try {
    const payload = {
      name: categoryForm.value.name,
      sort_order: categoryForm.value.sort_order === "" ? null : Number(categoryForm.value.sort_order),
    };

    if (!payload.name?.trim()) {
      toast.error("Category name is required");
      return;
    }

    if (categoryForm.value.id) {
      await updateMenuCategory(categoryForm.value.id, payload);
      toast.success("Category updated");
    } else {
      await createMenuCategory(payload);
      toast.success("Category created");
    }

    resetCategoryForm();
    await loadAll();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save category");
  }
}

async function removeCategory(id) {
  if (!confirm("Delete this category?")) return;
  try {
    await deleteMenuCategory(id);
    toast.success("Category deleted");
    await loadAll();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete category");
  }
}

// ----- Items -----
function resetItemForm() {
  itemForm.value = {
    id: null,
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
}

function editItem(it) {
  itemForm.value = {
    id: it.id,
    category_id: it.category_id ?? "",
    sku: it.sku ?? "",
    name: it.name ?? "",
    description: it.description ?? "",
    price: it.price ?? "",
    is_available: !!it.is_available,
    is_combo: !!it.is_combo,
  };
  pickedImage.value = null;
  imagePreview.value = it.image_url ? resolveUrl(it.image_url) : "";
}

function onPickImage(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  pickedImage.value = f;
  imagePreview.value = URL.createObjectURL(f);
}

async function saveItem() {
  try {
    const payload = {
      category_id: itemForm.value.category_id === "" ? null : Number(itemForm.value.category_id),
      sku: itemForm.value.sku?.trim() || null,
      name: itemForm.value.name?.trim(),
      description: itemForm.value.description?.trim() || null,
      price: Number(itemForm.value.price),
      is_available: !!itemForm.value.is_available,
      is_combo: !!itemForm.value.is_combo,
    };

    if (!payload.name) {
      toast.error("Item name is required");
      return;
    }
    if (!payload.price || payload.price <= 0) {
      toast.error("Price must be > 0");
      return;
    }

    let saved;
    if (itemForm.value.id) {
      saved = await updateMenuItem(itemForm.value.id, payload);
      toast.success("Item updated");
    } else {
      saved = await createMenuItem(payload);
      toast.success("Item created");
      itemForm.value.id = saved.id;
    }

    // upload image after create/update if selected
    if (pickedImage.value && itemForm.value.id) {
      saved = await uploadMenuItemImage(itemForm.value.id, pickedImage.value);
      toast.success("Item image uploaded");
      pickedImage.value = null;
      imagePreview.value = saved.image_url ? resolveUrl(saved.image_url) : "";
    }

    resetItemForm();
    await reloadItems();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save item");
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
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between">
      <h4 class="page-title mb-0">Menu</h4>

      <div class="d-flex gap-2">
        <select v-model="filter.category_id" class="form-select" style="width: 220px" @change="reloadItems">
          <option value="">All Categories</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>

        <select v-model="filter.available" class="form-select" style="width: 160px" @change="reloadItems">
          <option value="all">All</option>
          <option value="1">Available</option>
          <option value="0">Unavailable</option>
        </select>

        <input
          v-model="filter.q"
          class="form-control"
          placeholder="Search item..."
          style="width: 240px"
          @keyup.enter="reloadItems"
        />
        <button class="btn btn-outline-secondary" :disabled="loading" @click="reloadItems">Search</button>
      </div>
    </div>

    <div v-if="loading" class="card">
      <div class="card-body">Loading...</div>
    </div>

    <div v-else class="row g-3">
      <!-- Categories -->
      <div class="col-lg-4">
        <div class="card">
          <div class="card-body">
            <h5 class="mb-3">Categories</h5>

            <div class="row g-2 mb-3">
              <div class="col-8">
                <input v-model="categoryForm.name" class="form-control" placeholder="Category name" />
              </div>
              <div class="col-4">
                <input v-model="categoryForm.sort_order" type="number" class="form-control" placeholder="Sort" />
              </div>
              <div class="col-12 d-flex gap-2">
                <button class="btn btn-primary btn-sm" @click="saveCategory">
                  {{ categoryForm.id ? "Update" : "Add" }}
                </button>
                <button class="btn btn-light btn-sm" @click="resetCategoryForm">Clear</button>
              </div>
            </div>

            <div class="list-group">
              <button
                v-for="c in categories"
                :key="c.id"
                class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                type="button"
                @click="editCategory(c)"
              >
                <div>
                  <div class="fw-semibold">{{ c.name }}</div>
                  <small class="text-muted">Sort: {{ c.sort_order ?? "-" }}</small>
                </div>

                <button class="btn btn-outline-danger btn-sm" @click.stop="removeCategory(c.id)">Del</button>
              </button>

              <div v-if="categories.length === 0" class="text-muted py-2">No categories yet.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Items -->
      <div class="col-lg-8">
        <div class="card">
          <div class="card-body">
            <h5 class="mb-3">Menu Items</h5>

            <!-- Item form -->
            <div class="row g-2 mb-3">
              <div class="col-md-4">
                <select v-model="itemForm.category_id" class="form-select">
                  <option value="">No category</option>
                  <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </div>
              <div class="col-md-3">
                <input v-model="itemForm.sku" class="form-control" placeholder="SKU (optional)" />
              </div>
              <div class="col-md-5">
                <input v-model="itemForm.name" class="form-control" placeholder="Item name" />
              </div>

              <div class="col-md-8">
                <input v-model="itemForm.description" class="form-control" placeholder="Description (optional)" />
              </div>
              <div class="col-md-4">
                <input v-model="itemForm.price" type="number" step="0.01" class="form-control" placeholder="Price" />
              </div>

              <div class="col-md-4 d-flex align-items-center gap-2">
                <input type="checkbox" v-model="itemForm.is_available" />
                <label class="mb-0">Available</label>
              </div>
              <div class="col-md-4 d-flex align-items-center gap-2">
                <input type="checkbox" v-model="itemForm.is_combo" />
                <label class="mb-0">Combo</label>
              </div>

              <!-- Image -->
              <div class="col-md-4">
                <input type="file" class="form-control" accept="image/*" @change="onPickImage" />
              </div>
              <div class="col-12" v-if="imagePreview">
                <img :src="imagePreview" alt="preview" style="height: 60px; width: 60px; object-fit: cover; border-radius: 8px" />
              </div>

              <div class="col-12 d-flex gap-2">
                <button class="btn btn-primary btn-sm" @click="saveItem">
                  {{ itemForm.id ? "Update" : "Add" }}
                </button>
                <button class="btn btn-light btn-sm" @click="resetItemForm">Clear</button>
              </div>
            </div>

            <!-- Items table -->
            <div class="table-responsive">
              <table class="table table-sm table-centered mb-0">
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Name</th>
                    <th>SKU</th>
                    <th>Price</th>
                    <th>Available</th>
                    <th>Combo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="it in items" :key="it.id">
                    <td style="width: 64px">
                      <img
                        v-if="it.image_url"
                        :src="resolveUrl(it.image_url)"
                        alt="img"
                        style="height: 36px; width: 36px; object-fit: cover; border-radius: 8px"
                      />
                      <span v-else class="text-muted">-</span>
                    </td>
                    <td>
                      <div class="fw-semibold">{{ it.name }}</div>
                      <small class="text-muted">{{ it.description || "" }}</small>
                    </td>
                    <td>{{ it.sku || "-" }}</td>
                    <td>{{ it.price }}</td>
                    <td>
                      <span class="badge" :class="it.is_available ? 'bg-success' : 'bg-secondary'">
                        {{ it.is_available ? "YES" : "NO" }}
                      </span>
                    </td>
                    <td>
                      <span class="badge" :class="it.is_combo ? 'bg-info' : 'bg-light text-dark'">
                        {{ it.is_combo ? "YES" : "NO" }}
                      </span>
                    </td>
                    <td class="text-end">
                      <button class="btn btn-outline-primary btn-sm me-2" @click="editItem(it)">Edit</button>
                      <button class="btn btn-outline-danger btn-sm" @click="removeItem(it.id)">Del</button>
                    </td>
                  </tr>
                  <tr v-if="items.length === 0">
                    <td colspan="7" class="text-center text-muted py-3">No items found.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <small class="text-muted d-block mt-2">
              Tip: upload an image after creating/updating an item (handled automatically when you pick a file).
            </small>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
