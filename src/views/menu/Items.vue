<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import QrcodeVue from "qrcode.vue";
import { jsPDF } from "jspdf";

import {
  listMenuCategories,
  listMenuItems,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  uploadMenuItemImage,
  listItemOverrides,
  upsertItemOverride,
  deleteItemOverride,
} from "../../api/menu";
import { listOutlets } from "../../api/systemOutlets";
import { getMyStoreProfile } from "../../api/systemStores";
import {
  listModifierGroups,
  listItemModifierGroups,
  attachModifierGroupToItem,
  detachModifierGroupFromItem,
} from "../../api/modifiers";

const modifierGroups = ref([]);
const assignedGroupIds = ref(new Set());
const loadingMods = ref(false);
const savingMods = ref(false);

function ruleLabel(g) {
  const min = Number(g.min_select ?? 0);
  const max = Number(g.max_select ?? 0);
  if (min === 0 && max === 1) return "Optional • single";
  if (min === 1 && max === 1) return "Required • single";
  if (min === 0 && max > 1) return `Optional • up to ${max}`;
  if (min >= 1 && max > 1) return `Pick ${min}–${max}`;
  if (min === 0 && max === 0) return "No selection";
  return `Min ${min} • Max ${max}`;
}

async function loadItemModifiers(menuItemId) {
  loadingMods.value = true;
  try {
    // all groups in store
    modifierGroups.value = await listModifierGroups({ limit: 500 });

    // mappings for this item
    const rows = await listItemModifierGroups(menuItemId);

    // rows could be [{id, menu_item_id, group_id, group:{...}}] or just group_id.
    const set = new Set((rows || []).map((r) => r.group_id));
    assignedGroupIds.value = set;
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load item modifiers");
    modifierGroups.value = [];
    assignedGroupIds.value = new Set();
  } finally {
    loadingMods.value = false;
  }
}

async function toggleGroup(menuItemId, groupId, checked) {
  if (!menuItemId) return;
  savingMods.value = true;
  try {
    if (checked) {
      await attachModifierGroupToItem(menuItemId, groupId);
      assignedGroupIds.value.add(groupId);
    } else {
      await detachModifierGroupFromItem(menuItemId, groupId);
      assignedGroupIds.value.delete(groupId);
    }
    // force Set reactivity
    assignedGroupIds.value = new Set(assignedGroupIds.value);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update item modifiers");
  } finally {
    savingMods.value = false;
  }
}

const toast = useToast();

// -------------------- Public Menu modal state --------------------
const publicMenuModalEl = ref(null);
let publicMenuModalInstance = null;

const storeProfile = ref(null);
const loadingStore = ref(false);

// Build the public URL from env + store code
const publicMenuUrl = computed(() => {
  const code = storeProfile.value?.public_menu_code;
  if (!code) return "";

  // You can keep this hard-coded or move it to env
  const base =
    import.meta.env.VITE_PUBLIC_MENU_BASE_URL ||
    "https://restraurant-public-menu.vercel.app";
  return `${base}/${code}`;
});

async function ensurePublicMenuModal() {
  if (publicMenuModalInstance) return;
  try {
    const m = await import("bootstrap/js/dist/modal");
    publicMenuModalInstance = new m.default(publicMenuModalEl.value, {
      backdrop: true,
      keyboard: true,
    });
  } catch (e) {
    publicMenuModalInstance = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(publicMenuModalEl.value, {
          backdrop: true,
          keyboard: true,
        })
      : null;
  }
}

async function loadStoreProfile() {
  loadingStore.value = true;
  try {
    storeProfile.value = await getMyStoreProfile();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load store profile");
  } finally {
    loadingStore.value = false;
  }
}

async function openPublicMenuModal() {
  // always load store profile if not loaded yet
  if (!storeProfile.value) {
    await loadStoreProfile();
  }

  // if still no storeProfile, stop
  if (!storeProfile.value) return;

  // ✅ check if public menu is enabled
  if (!storeProfile.value?.public_menu_enabled) {
    toast.error("Public menu is disabled for this store.");
    return;
  }

  // ensure store has code
  if (!storeProfile.value?.public_menu_code) {
    toast.error("Public menu code not found on your store profile.");
    return;
  }

  await ensurePublicMenuModal();
  publicMenuModalInstance?.show();
  await nextTick();
}

function closePublicMenuModal() {
  publicMenuModalInstance?.hide();
}

async function copyPublicMenuLink() {
  if (!publicMenuUrl.value) return;
  try {
    await navigator.clipboard.writeText(publicMenuUrl.value);
    toast.success("Link copied!");
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = publicMenuUrl.value;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    toast.success("Link copied!");
  }
}

const qrRef = ref(null);
const downloading = ref(false);

function safeFileBase() {
  const name = storeProfile.value?.name || "store";
  return name.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

// Get the canvas element created by qrcode.vue
function getQrCanvasNow() {
  // 1) try component ref
  const el = qrRef.value?.$el;
  if (el) {
    if (el.tagName?.toLowerCase() === "canvas") return el;
    const c1 = el.querySelector?.("canvas");
    if (c1) return c1;
  }

  // 2) fallback: search inside the modal (most reliable)
  const modalEl = publicMenuModalEl.value;
  const c2 = modalEl?.querySelector?.("canvas");
  if (c2) return c2;

  return null;
}

// Wait a few frames until QR canvas exists (handles modal transitions)
async function waitForQrCanvas(maxTries = 25) {
  for (let i = 0; i < maxTries; i++) {
    await nextTick();
    await new Promise((r) => requestAnimationFrame(r));

    const canvas = getQrCanvasNow();
    if (canvas) return canvas;
  }
  return null;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadQrPng() {
  try {
    const canvas = await waitForQrCanvas();
    if (!canvas) {
      toast.error("QR not ready yet. Please try again.");
      return;
    }

    const filename = `${safeFileBase()}_public_menu_qr.png`;

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );

    if (!blob) {
      toast.error("Failed to create PNG.");
      return;
    }

    downloadBlob(blob, filename);
  } catch {
    toast.error("Failed to download QR image.");
  }
}

async function downloadQrPdf() {
  downloading.value = true;
  try {
    const canvas = await waitForQrCanvas();
    if (!canvas) {
      toast.error("QR not ready yet. Please try again.");
      return;
    }

    const imgData = canvas.toDataURL("image/png");

    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

    const pageW = doc.internal.pageSize.getWidth();
    const margin = 40;

    const storeName = storeProfile.value?.name || "Store";
    const link = publicMenuUrl.value || "";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(storeName, margin, 60);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text("Public Menu QR Code", margin, 82);

    const qrSize = 260;
    const x = (pageW - qrSize) / 2;
    const y = 120;
    doc.addImage(imgData, "PNG", x, y, qrSize, qrSize);

    doc.setFontSize(11);
    const linkY = y + qrSize + 30;
    doc.text("Link:", margin, linkY);

    const wrapped = doc.splitTextToSize(link, pageW - margin * 2);
    doc.text(wrapped, margin, linkY + 16);

    doc.save(`${safeFileBase()}_public_menu_qr.pdf`);
  } catch {
    toast.error("Failed to download PDF.");
  } finally {
    downloading.value = false;
  }
}

const loading = ref(false);
const saving = ref(false);

const categories = ref([]);
const items = ref([]);
const outlets = ref([]);

// Filters
const filter = ref({
  category_id: "",
  available: "all", // 1|0|all
  q: "",
});

// Modal (create/edit)
const modalEl = ref(null);
let modalInstance = null;

const editId = ref(null);
const triedSubmit = ref(false);

const form = ref({
  category_id: "",
  sku: "",
  name: "",
  description: "",
  price: "",
  is_available: true,
  is_combo: false,
});

const isEditMode = computed(() => !!editId.value);

// Overrides modal
const showOverridesFor = ref(null);
const overrides = ref([]);
const overrideDraft = ref({}); // outletId -> {price_override, is_available_override}

const counts = computed(() => {
  const arr = items.value || [];
  return {
    total: arr.length,
    available: arr.filter((x) => !!x.is_available).length,
    unavailable: arr.filter((x) => !x.is_available).length,
  };
});

const categoryNameById = computed(() => {
  const m = new Map((categories.value || []).map((c) => [c.id, c.name]));
  return (id) => (id ? m.get(id) || "" : "");
});

function resolveImageUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  const base = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";
  return `${base}${url}`;
}

function money(v) {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeParams() {
  const params = {};
  if (filter.value.category_id !== "")
    params.category_id = Number(filter.value.category_id);
  if (filter.value.available !== "all")
    params.available = filter.value.available;
  if (filter.value.q?.trim()) params.q = filter.value.q.trim();
  return params;
}

async function loadAll() {
  loading.value = true;
  try {
    categories.value = await listMenuCategories();
    items.value = await listMenuItems(normalizeParams());
    outlets.value = await listOutlets();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load menu items");
  } finally {
    loading.value = false;
  }
}

async function applyFilter() {
  loading.value = true;
  try {
    items.value = await listMenuItems(normalizeParams());
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load items");
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  editId.value = null;
  triedSubmit.value = false;
  form.value = {
    category_id: "",
    sku: "",
    name: "",
    description: "",
    price: "",
    is_available: true,
    is_combo: false,
  };
}

function setFormFromItem(it) {
  editId.value = it.id;
  triedSubmit.value = false;
  form.value = {
    category_id: it.category_id ?? "",
    sku: it.sku ?? "",
    name: it.name ?? "",
    description: it.description ?? "",
    price: it.price ?? "",
    is_available: !!it.is_available,
    is_combo: !!it.is_combo,
  };
}

function validate() {
  triedSubmit.value = true;
  if (!String(form.value.name || "").trim()) {
    toast.error("Item name is required.");
    return false;
  }
  const p = Number(form.value.price);
  if (!Number.isFinite(p) || p <= 0) {
    toast.error("Price must be a valid number greater than 0.");
    return false;
  }
  return true;
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
      ? new window.bootstrap.Modal(modalEl.value, {
          backdrop: "static",
          keyboard: false,
        })
      : null;
  }
}

async function openCreate() {
  resetForm();
  await ensureModal();
  modalInstance?.show();
  await nextTick();
}

async function openEdit(it) {
  setFormFromItem(it);
  await ensureModal();
  modalInstance?.show();
  await nextTick();

  await loadItemModifiers(it.id);
}

function closeModal() {
  modalInstance?.hide();
}

async function save() {
  if (!validate()) return;

  saving.value = true;
  try {
    const payload = {
      category_id:
        form.value.category_id === "" ? null : Number(form.value.category_id),
      sku: String(form.value.sku || "").trim() || null,
      name: String(form.value.name || "").trim(),
      description: String(form.value.description || "").trim() || null,
      price: Number(form.value.price),
      is_available: !!form.value.is_available,
      is_combo: !!form.value.is_combo,
    };

    if (editId.value) {
      const updated = await updateMenuItem(editId.value, payload);
      const idx = (items.value || []).findIndex((x) => x.id === editId.value);
      if (idx !== -1) items.value[idx] = updated;
      toast.success("Item updated");
    } else {
      await createMenuItem(payload);
      toast.success("Item created");
      await applyFilter();
    }

    closeModal();
    resetForm();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save item");
  } finally {
    saving.value = false;
  }
}

async function removeItem(id) {
  if (!confirm("Delete this item? (soft delete)")) return;
  try {
    await deleteMenuItem(id);
    toast.success("Item deleted");
    await applyFilter();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete item");
  }
}

async function onPickImage(it, e) {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const updated = await uploadMenuItemImage(it.id, f);
    const idx = items.value.findIndex((x) => x.id === it.id);
    if (idx !== -1) items.value[idx] = updated;
    toast.success("Image uploaded");
  } catch (err) {
    toast.error(err?.response?.data?.detail || "Failed to upload image");
  } finally {
    e.target.value = "";
  }
}

// -------- overrides --------
async function openOverrides(it) {
  showOverridesFor.value = it;
  overrides.value = [];
  overrideDraft.value = {};

  try {
    overrides.value = await listItemOverrides(it.id);
    for (const o of overrides.value) {
      overrideDraft.value[o.outlet_id] = {
        price_override: o.price_override ?? "",
        is_available_override:
          o.is_available_override === null ||
          o.is_available_override === undefined
            ? ""
            : o.is_available_override
              ? "1"
              : "0",
      };
    }
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load overrides");
  }
}

function closeOverrides() {
  showOverridesFor.value = null;
  overrides.value = [];
  overrideDraft.value = {};
}

async function saveOverride(outletId) {
  const it = showOverridesFor.value;
  if (!it) return;

  const d = overrideDraft.value[outletId] || {
    price_override: "",
    is_available_override: "",
  };

  const payload = {
    price_override: d.price_override === "" ? null : Number(d.price_override),
    is_available_override:
      d.is_available_override === ""
        ? null
        : d.is_available_override === "1"
          ? true
          : false,
  };

  try {
    await upsertItemOverride(it.id, outletId, payload);
    toast.success("Override saved");
    overrides.value = await listItemOverrides(it.id);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save override");
  }
}

async function clearOverride(outletId) {
  const it = showOverridesFor.value;
  if (!it) return;
  try {
    await deleteItemOverride(it.id, outletId);
    toast.success("Override removed");
    delete overrideDraft.value[outletId];
    overrides.value = await listItemOverrides(it.id);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to remove override");
  }
}

function clearFilters() {
  filter.value = { category_id: "", available: "all", q: "" };
  applyFilter();
}

onMounted(loadAll);
</script>

<template>
  <DefaultLayout>
    <!-- Header -->
    <div
      class="page-title-box d-flex align-items-center justify-content-between"
      style="zoom: 80%"
    >
      <div>
        <h4 class="page-title mb-0">Menu Items</h4>
        <div class="text-muted small">
          <strong>{{ counts.total }}</strong> items •
          <span class="text-success fw-semibold">{{ counts.available }}</span>
          available •
          <span class="text-secondary fw-semibold">{{
            counts.unavailable
          }}</span>
          unavailable
        </div>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-info" @click="openPublicMenuModal" type="button">
          <i class="ri-qr-code-line me-1"></i> Public Menu
        </button>
        <button
          class="btn btn-primary"
          :disabled="loading"
          @click="applyFilter"
        >
          <i class="ri-refresh-line me-1"></i> Refresh
        </button>
        <button class="btn btn-primary" @click="openCreate">
          <i class="ri-add-line me-1"></i> New Item
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="card menu-card mb-3" style="zoom: 80%">
      <div class="card-body py-2">
        <div class="row g-2 align-items-end">
          <div class="col-md-4">
            <label class="form-label mb-1">Search</label>
            <div class="input-group">
              <span class="input-group-text bg-light"
                ><i class="ri-search-line"></i
              ></span>
              <input
                v-model="filter.q"
                class="form-control"
                placeholder="Search name, SKU, description…"
                @keyup.enter="applyFilter"
              />
              <button
                class="btn btn-secondary"
                :disabled="loading"
                @click="applyFilter"
              >
                <span v-if="loading">Searching…</span>
                <span v-else>Search</span>
              </button>
            </div>
          </div>

          <div class="col-md-3">
            <label class="form-label mb-1">Category</label>
            <select
              v-model="filter.category_id"
              class="form-select"
              @change="applyFilter"
            >
              <option value="">All categories</option>
              <option v-for="c in categories" :key="c.id" :value="c.id">
                {{ c.name }}
              </option>
            </select>
          </div>

          <div class="col-md-3">
            <label class="form-label mb-1">Availability</label>
            <div class="segmented">
              <button
                class="seg-btn"
                :class="filter.available === 'all' ? 'active' : ''"
                @click="
                  filter.available = 'all';
                  applyFilter();
                "
                type="button"
              >
                All
              </button>
              <button
                class="seg-btn"
                :class="filter.available === '1' ? 'active' : ''"
                @click="
                  filter.available = '1';
                  applyFilter();
                "
                type="button"
              >
                Available
              </button>
              <button
                class="seg-btn"
                :class="filter.available === '0' ? 'active' : ''"
                @click="
                  filter.available = '0';
                  applyFilter();
                "
                type="button"
              >
                Unavailable
              </button>
            </div>
          </div>

          <div class="col-md-2 d-flex gap-2">
            <button
              class="btn btn-light w-100"
              :disabled="loading"
              @click="clearFilters"
            >
              Clear
            </button>
          </div>

          <div class="col-12">
            <div class="text-muted small">
              Showing <strong>{{ items.length }}</strong> item(s)
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card menu-card" style="zoom: 80%">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading menu items…</div>
      </div>
    </div>

    <!-- Empty -->
    <div
      v-else-if="items.length === 0"
      class="card menu-card"
      style="zoom: 80%"
    >
      <div class="card-body text-center text-muted py-5">
        <div class="empty-emoji">🍽️</div>
        <div class="mt-2">No items found.</div>
        <button class="btn btn-primary mt-3" @click="openCreate">
          <i class="ri-add-line me-1"></i> Create first item
        </button>
      </div>
    </div>

    <!-- Items grid -->
    <div v-else class="row g-3" style="zoom: 80%">
      <div
        v-for="it in items"
        :key="it.id"
        class="col-12 col-md-6 col-xl-4 d-flex"
      >
        <div
          class="item-card w-100 h-100"
          role="button"
          tabindex="0"
          @click="openEdit(it)"
        >
          <div class="item-head">
            <div class="item-photo">
              <img
                v-if="it.image_url"
                :src="resolveImageUrl(it.image_url)"
                alt=""
              />
              <div v-else class="photo-placeholder">
                <i class="ri-image-line"></i>
              </div>

              <span class="item-status" :class="it.is_available ? 'on' : 'off'">
                <span
                  class="dot"
                  :class="it.is_available ? 'on' : 'off'"
                ></span>
                {{ it.is_available ? "Available" : "Unavailable" }}
              </span>
            </div>

            <div class="item-main">
              <div class="item-top">
                <div class="item-name" :title="it.name">{{ it.name }}</div>
                <div class="item-price">{{ money(it.price) }}</div>
              </div>

              <div class="item-meta">
                <span v-if="it.is_combo" class="badge badge-soft-warning"
                  >Combo</span
                >
                <span class="chip" v-if="it.category_id">
                  <i class="ri-restaurant-2-line me-1"></i
                  >{{ categoryNameById(it.category_id) }}
                </span>
                <span class="chip" v-if="it.sku">
                  <i class="ri-barcode-line me-1"></i>{{ it.sku }}
                </span>
              </div>

              <div class="item-desc text-muted small">
                {{ it.description || "—" }}
              </div>
            </div>
          </div>

          <div class="item-actions" @click.stop>
            <label class="btn btn-sm btn-outline-secondary mb-0">
              <i class="ri-image-add-line me-1"></i> Image
              <input
                type="file"
                accept="image/*"
                hidden
                @change="(e) => onPickImage(it, e)"
              />
            </label>

            <button
              class="btn btn-sm btn-outline-info"
              @click="openOverrides(it)"
            >
              <i class="ri-store-2-line me-1"></i> Overrides
            </button>

            <div class="ms-auto d-flex gap-2">
              <button class="btn btn-sm btn-soft-primary" @click="openEdit(it)">
                <i class="ri-edit-line me-1"></i> Edit
              </button>
              <button
                class="btn btn-sm btn-soft-danger"
                @click="removeItem(it.id)"
              >
                <i class="ri-delete-bin-6-line me-1"></i> Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create/Edit Modal -->
    <div
      class="modal fade"
      id="menuItemModal"
      tabindex="-1"
      role="dialog"
      aria-hidden="true"
      ref="modalEl"
      style="zoom: 80%"
    >
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content position-relative">
          <div class="modal-header bg-light">
            <div>
              <h4 class="modal-title mb-0">
                {{ isEditMode ? "Edit Menu Item" : "Create Menu Item" }}
              </h4>
              <div class="text-muted small">
                Keep items clear, priced, and available per outlet
              </div>
            </div>
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
            style="
              background: rgba(var(--ct-body-bg-rgb), 0.72);
              backdrop-filter: blur(2px);
              z-index: 10;
            "
          >
            <div class="text-center">
              <div
                class="spinner-border"
                role="status"
                aria-hidden="true"
              ></div>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body">
            <form
              @submit.prevent="save"
              novalidate
              :class="{ 'was-validated': triedSubmit }"
            >
              <div class="row g-2">
                <div class="col-md-4">
                  <label class="form-label">Category</label>
                  <select v-model="form.category_id" class="form-select">
                    <option value="">None</option>
                    <option v-for="c in categories" :key="c.id" :value="c.id">
                      {{ c.name }}
                    </option>
                  </select>
                </div>

                <div class="col-md-4">
                  <label class="form-label">SKU</label>
                  <input
                    v-model="form.sku"
                    class="form-control"
                    placeholder="Optional (e.g. BRG001)"
                  />
                </div>

                <div class="col-md-4">
                  <label class="form-label">Price *</label>
                  <input
                    v-model="form.price"
                    type="number"
                    step="0.01"
                    class="form-control"
                    required
                  />
                  <div class="invalid-feedback">Price is required.</div>
                </div>

                <div class="col-12">
                  <label class="form-label">Name *</label>
                  <input
                    v-model="form.name"
                    class="form-control"
                    placeholder="e.g. Chicken Burger"
                    required
                  />
                  <div class="invalid-feedback">Name is required.</div>
                </div>

                <div class="col-12">
                  <label class="form-label">Description</label>
                  <textarea
                    v-model="form.description"
                    class="form-control"
                    rows="3"
                    placeholder="Short, appetizing description…"
                  ></textarea>
                </div>

                <div class="col-md-6">
                  <div class="form-check form-switch mt-2">
                    <input
                      id="mAvail"
                      v-model="form.is_available"
                      class="form-check-input"
                      type="checkbox"
                    />
                    <label class="form-check-label" for="mAvail"
                      >Available</label
                    >
                  </div>
                </div>

                <div class="col-md-6">
                  <div class="form-check form-switch mt-2">
                    <input
                      id="mCombo"
                      v-model="form.is_combo"
                      class="form-check-input"
                      type="checkbox"
                    />
                    <label class="form-check-label" for="mCombo"
                      >Combo item</label
                    >
                  </div>
                </div>

                <!-- Modifiers assignment -->
                <div class="mt-3">
                  <div
                    class="d-flex align-items-center justify-content-between"
                  >
                    <div>
                      <div class="fw-semibold">Modifiers</div>
                      <div class="text-muted small">
                        Assign modifier groups (e.g. Size, Toppings) to this
                        menu item.
                      </div>
                    </div>

                    <div
                      v-if="loadingMods || savingMods"
                      class="small text-muted"
                    >
                      <span
                        class="spinner-border spinner-border-sm me-2"
                      ></span>
                      Working…
                    </div>
                  </div>

                  <div
                    v-if="!isEditMode"
                    class="alert alert-light border small mt-2 mb-0"
                  >
                    Save the item first, then you can assign modifier groups.
                  </div>

                  <div v-else class="card mt-2">
                    <div class="card-body py-2">
                      <div
                        v-if="modifierGroups.length === 0"
                        class="text-muted small"
                      >
                        No modifier groups found. Create groups in the Modifiers
                        screen first.
                      </div>

                      <div v-else class="row g-2">
                        <div
                          v-for="g in modifierGroups"
                          :key="g.id"
                          class="col-12 col-md-6"
                        >
                          <label
                            class="d-flex align-items-center gap-2 border rounded p-2"
                          >
                            <input
                              type="checkbox"
                              class="form-check-input m-0"
                              :disabled="savingMods"
                              :checked="assignedGroupIds.has(g.id)"
                              @change="
                                (e) =>
                                  toggleGroup(editId, g.id, e.target.checked)
                              "
                            />
                            <div class="flex-grow-1">
                              <div class="fw-semibold">{{ g.name }}</div>
                              <div class="text-muted small">
                                {{ ruleLabel(g) }}
                              </div>
                            </div>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="col-12">
                  <div class="alert alert-light border mb-0">
                    <div class="d-flex align-items-start gap-2">
                      <i class="ri-information-line mt-1"></i>
                      <div class="small">
                        <div class="fw-semibold">Restaurant tip</div>
                        <div class="text-muted">
                          Use clear naming (“Chicken Burger — Spicy”), keep
                          descriptions short, and upload images for top sellers.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button
              type="button"
              class="btn btn-light"
              data-bs-dismiss="modal"
              :disabled="saving"
              @click="resetForm"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-primary"
              :disabled="saving"
              @click="save"
            >
              <span v-if="saving">Saving…</span>
              <span v-else>{{
                isEditMode ? "Update Item" : "Create Item"
              }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Overrides Modal -->
    <div
      v-if="showOverridesFor"
      class="modal d-block"
      tabindex="-1"
      role="dialog"
      style="background: rgba(0, 0, 0, 0.35); zoom: 80%"
    >
      <div class="modal-dialog modal-lg" role="document">
        <div class="modal-content">
          <div class="modal-header bg-transparent">
            <div>
              <h5 class="modal-title mb-0">Outlet Overrides</h5>
              <div class="text-muted small">
                {{ showOverridesFor.name }} — set outlet-specific
                price/availability
              </div>
            </div>
            <button
              type="button"
              class="btn-close"
              @click="closeOverrides"
            ></button>
          </div>

          <div class="modal-body">
            <div class="table-responsive">
              <table class="table table-centered table-bordered mb-0">
                <thead class="bg-light">
                  <tr>
                    <th>Outlet</th>
                    <th style="width: 180px">Price Override</th>
                    <th style="width: 210px">Availability Override</th>
                    <th style="width: 240px" class="text-end">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  <tr v-for="o in outlets" :key="o.id">
                    <td class="fw-semibold">{{ o.name }}</td>

                    <td>
                      <input
                        v-model="
                          (overrideDraft[o.id] ||= {
                            price_override: '',
                            is_available_override: '',
                          }).price_override
                        "
                        type="number"
                        step="0.01"
                        class="form-control form-control-sm"
                        placeholder="blank = none"
                      />
                    </td>

                    <td>
                      <select
                        v-model="
                          (overrideDraft[o.id] ||= {
                            price_override: '',
                            is_available_override: '',
                          }).is_available_override
                        "
                        class="form-select form-select-sm"
                      >
                        <option value="">None</option>
                        <option value="1">Available</option>
                        <option value="0">Unavailable</option>
                      </select>
                    </td>

                    <td class="text-end">
                      <button
                        class="btn btn-sm btn-primary me-2"
                        @click="saveOverride(o.id)"
                      >
                        Save
                      </button>
                      <button
                        class="btn btn-sm btn-outline-danger"
                        @click="clearOverride(o.id)"
                      >
                        Clear
                      </button>
                    </td>
                  </tr>

                  <tr v-if="outlets.length === 0">
                    <td colspan="4" class="text-center text-muted py-4">
                      No outlets found. Create outlets first.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="text-muted small mt-2">
              “None” means no override (item uses normal price/availability).
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" @click="closeOverrides">Close</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Public Menu Modal -->
    <div
      class="modal fade"
      tabindex="-1"
      aria-hidden="true"
      ref="publicMenuModalEl"
      style="zoom: 80%"
    >
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-light">
            <div>
              <h5 class="modal-title mb-0">Public Menu</h5>
              <div class="text-muted small">Scan to open your store menu</div>
            </div>
            <button
              type="button"
              class="btn-close"
              @click="closePublicMenuModal"
            ></button>
          </div>

          <div class="modal-body">
            <div v-if="loadingStore" class="d-flex align-items-center gap-2">
              <div
                class="spinner-border"
                role="status"
                aria-hidden="true"
              ></div>
              <div>Loading store…</div>
            </div>

            <div v-else>
              <div class="d-flex justify-content-center">
                <div class="p-3 border rounded bg-white">
                  <QrcodeVue
                    v-if="publicMenuUrl"
                    ref="qrRef"
                    :value="publicMenuUrl"
                    :size="220"
                    level="M"
                    render-as="canvas"
                  />
                </div>
              </div>

              <div class="mt-3">
                <label class="form-label mb-1">Link</label>
                <div class="input-group">
                  <input class="form-control" :value="publicMenuUrl" readonly />
                  <button
                    class="btn btn-outline-secondary"
                    type="button"
                    @click="copyPublicMenuLink"
                  >
                    Copy
                  </button>
                </div>

                <div class="mt-2 d-flex gap-2">
                  <a
                    class="btn btn-primary w-100"
                    :href="publicMenuUrl"
                    target="_blank"
                    rel="noopener"
                  >
                    Open Public Menu
                  </a>
                </div>

                <div class="mt-2 d-flex gap-2">
  <button class="btn btn-outline-primary w-100" type="button" @click="downloadQrPng">
    <i class="ri-download-2-line me-1"></i> Download PNG
  </button>

  <button
    class="btn btn-outline-dark w-100"
    type="button"
    :disabled="downloading"
    @click="downloadQrPdf"
  >
    <i class="ri-file-download-line me-1"></i>
    <span v-if="downloading">Preparing…</span>
    <span v-else>Download PDF</span>
  </button>
</div>

              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button
              class="btn btn-light"
              type="button"
              @click="closePublicMenuModal"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
.empty-emoji {
  font-size: 44px;
}

/* Card shell */
.menu-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
}

/* Segmented availability buttons */
.segmented {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.seg-btn {
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-tertiary-bg);
  color: var(--ct-emphasis-color);
  border-radius: 12px;
  padding: 8px 10px;
  font-weight: 700;
  font-size: 12px;
  transition:
    transform 0.12s ease,
    border-color 0.12s ease;
}
.seg-btn:hover {
  transform: translateY(-1px);
}
.seg-btn.active {
  border-color: rgba(var(--ct-primary-rgb), 0.35);
  background: rgba(var(--ct-primary-rgb), 0.12);
}

/* Item card */
.item-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease,
    border-color 0.12s ease;
  outline: none;
}
.item-card:hover,
.item-card:focus {
  transform: translateY(-2px);
  box-shadow: var(--ct-box-shadow-lg);
  border-color: rgba(var(--ct-primary-rgb), 0.3);
}

.item-head {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 12px;
  padding: 12px;
  background: linear-gradient(
    180deg,
    rgba(var(--ct-primary-rgb), 0.1),
    rgba(var(--ct-primary-rgb), 0)
  );
}

.item-photo {
  position: relative;
  width: 110px;
  height: 110px;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-tertiary-bg);
}
.item-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.photo-placeholder {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--ct-secondary-color);
  font-size: 22px;
}

.item-status {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  border: 1px solid var(--ct-border-color-translucent);
  background: rgba(var(--ct-body-bg-rgb), 0.72);
  backdrop-filter: blur(2px);
  color: var(--ct-emphasis-color);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  border: 2px solid rgba(var(--ct-body-color-rgb), 0.25);
}
.dot.on {
  background: var(--ct-success);
  border-color: rgba(var(--ct-success-rgb), 0.35);
}
.dot.off {
  background: var(--ct-gray-500);
  border-color: rgba(var(--ct-body-color-rgb), 0.25);
}

.item-main {
  min-width: 0;
}

.item-top {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 10px;
}
.item-name {
  font-weight: 900;
  color: var(--ct-emphasis-color);
  line-height: 1.1;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-price {
  font-weight: 900;
  font-size: 18px;
  color: var(--ct-emphasis-color);
  white-space: nowrap;
}

.item-meta {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--ct-border-color-translucent);
  background: rgba(var(--ct-body-color-rgb), 0.06);
  color: var(--ct-emphasis-color);
  font-size: 11px;
  font-weight: 800;
}

.badge-soft-warning {
  background: rgba(var(--ct-warning-rgb), 0.18) !important;
  color: var(--ct-warning-text-emphasis) !important;
  border: 1px solid rgba(var(--ct-warning-rgb), 0.22);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 900;
}

.item-desc {
  margin-top: 10px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 34px;
}

.item-actions {
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--ct-tertiary-bg);
  border-top: 1px solid var(--ct-border-color-translucent);
  flex-wrap: wrap;
}

/* Theme-safe table headers inside override modal */
.table thead.bg-light th {
  background: var(--ct-tertiary-bg) !important;
  color: var(--ct-emphasis-color) !important;
}
</style>
