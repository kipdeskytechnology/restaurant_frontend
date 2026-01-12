<script setup>
import { ref, onMounted, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import DefaultLayout from "../../layouts/DefaultLayout.vue";

import {
  getOrder,
  addOrderLine,
  updateOrderLine,
  deleteOrderLine,
  holdOrder,
  reopenOrder,
  cancelOrder,
  payOrder,
  listOrderDiscounts,
  applyOrderDiscount,
  removeOrderDiscount,
} from "../../api/orders";

import { listMenuCategories, listMenuItems } from "../../api/menu";
import { listDiscounts } from "../../api/setupDiscounts";
import { listItemModifierGroups, listModifierOptions } from "../../api/modifiers";

const route = useRoute();
const router = useRouter();

const orderId = computed(() => Number(route.params.id));

const loading = ref(false);
const saving = ref(false);

const order = ref(null);

const categories = ref([]);
const menuItems = ref([]);

const menuFilters = ref({
  category_id: "",
  q: "",
  available: "1",
});

// ---------- Generic info/confirm modal ----------
const modalTitle = ref("Message");
const modalBody = ref("");
const modalMode = ref("info"); // info | confirm
const confirmAction = ref(null);
let modalInstance = null;

function showModal(title, body) {
  modalMode.value = "info";
  modalTitle.value = title;
  modalBody.value = body;

  const el = document.getElementById("centermodal");
  if (!el) return;
  if (!modalInstance) modalInstance = window.bootstrap ? new window.bootstrap.Modal(el) : null;
  modalInstance?.show();
}

function showConfirm(title, body, actionFn) {
  modalMode.value = "confirm";
  modalTitle.value = title;
  modalBody.value = body;
  confirmAction.value = actionFn;

  const el = document.getElementById("centermodal");
  if (!el) return;
  if (!modalInstance) modalInstance = window.bootstrap ? new window.bootstrap.Modal(el) : null;
  modalInstance?.show();
}

// ---------- Discounts modal ----------
const discounts = ref([]);
const orderDiscounts = ref([]);
let discountModalInstance = null;

function openDiscountModal() {
  const el = document.getElementById("discountModal");
  if (!el) return;
  if (!discountModalInstance) discountModalInstance = window.bootstrap ? new window.bootstrap.Modal(el) : null;
  discountModalInstance?.show();
}

async function loadDiscountsAndOrderDiscounts() {
  try {
    discounts.value = await listDiscounts();
  } catch (e) {
    showModal("Error", e?.response?.data?.detail || e?.message || "Failed to load discounts");
  }

  try {
    if (order.value?.id) orderDiscounts.value = await listOrderDiscounts(order.value.id);
  } catch (e) {
    // if your backend doesn't have this yet, you'll see it here
    showModal("Error", e?.response?.data?.detail || e?.message || "Failed to load order discounts");
  }
}

function isDiscountApplied(d) {
  return orderDiscounts.value?.some((x) => x.discount_id === d.id);
}

async function toggleDiscount(d) {
  if (!order.value) return;
  saving.value = true;
  try {
    if (isDiscountApplied(d)) {
      order.value = await removeOrderDiscount(order.value.id, d.id);
    } else {
      order.value = await applyOrderDiscount(order.value.id, d.id);
    }
    // refresh applied list (some APIs return updated order, some don't)
    try {
      orderDiscounts.value = await listOrderDiscounts(order.value.id);
    } catch {}
  } catch (e) {
    showModal("Error", e?.response?.data?.detail || e?.message || "Failed to apply/remove discount");
  } finally {
    saving.value = false;
  }
}

// ---------- Modifiers modal ----------
const modifierModalTitle = ref("Modifiers");
const modifierItem = ref(null); // selected menu item
const modifierGroups = ref([]); // [{ group, options }]
const modifierSelections = ref({}); // { [groupId]: Set(optionId) }
let modifierModalInstance = null;

function openModifierModal() {
  const el = document.getElementById("modifierModal");
  if (!el) return;
  if (!modifierModalInstance) modifierModalInstance = window.bootstrap ? new window.bootstrap.Modal(el) : null;
  modifierModalInstance?.show();
}

function closeModifierModal() {
  modifierModalInstance?.hide();
}

function initSelections(groupsWithOptions) {
  const sel = {};
  for (const g of groupsWithOptions) {
    const gid = g.group.id;
    sel[gid] = new Set();

    // preselect defaults (active only)
    for (const opt of g.options) {
      if (opt.is_default && opt.is_active) sel[gid].add(opt.id);
    }
  }
  modifierSelections.value = sel;
}

function selectedCount(gid) {
  return modifierSelections.value?.[gid]?.size || 0;
}

function isSelected(gid, optId) {
  return modifierSelections.value?.[gid]?.has(optId);
}

function toggleOption(group, opt) {
  const gid = group.id;
  if (!modifierSelections.value[gid]) modifierSelections.value[gid] = new Set();

  const set = modifierSelections.value[gid];

  // enforce max_select
  if (!set.has(opt.id) && set.size >= group.max_select) {
    showModal("Selection limit", `You can select up to ${group.max_select} option(s) for "${group.name}".`);
    return;
  }

  if (set.has(opt.id)) set.delete(opt.id);
  else set.add(opt.id);
}

function validateSelections() {
  for (const g of modifierGroups.value) {
    const group = g.group;
    const cnt = selectedCount(group.id);

    if (cnt < group.min_select) {
      showModal("Missing selection", `Please select at least ${group.min_select} option(s) for "${group.name}".`);
      return false;
    }
    if (cnt > group.max_select) {
      showModal("Too many selected", `Please select at most ${group.max_select} option(s) for "${group.name}".`);
      return false;
    }
  }
  return true;
}

function buildSelectedOptionIds() {
  const ids = [];
  for (const g of modifierGroups.value) {
    const gid = g.group.id;
    const set = modifierSelections.value?.[gid] || new Set();
    for (const id of set.values()) ids.push(id);
  }
  return ids;
}

// ---------- Load order/menu ----------
async function loadOrder() {
  loading.value = true;
  try {
    order.value = await getOrder(orderId.value);
  } catch (e) {
    showModal("Error", e?.response?.data?.detail || e?.message || "Failed to load order");
  } finally {
    loading.value = false;
  }
}

async function loadMenu() {
  try {
    categories.value = await listMenuCategories();
    await refreshMenuItems();
  } catch (e) {
    showModal("Error", e?.response?.data?.detail || e?.message || "Failed to load menu");
  }
}

async function refreshMenuItems() {
  const params = {
    limit: 200,
    available: menuFilters.value.available,
  };
  if (menuFilters.value.category_id) params.category_id = Number(menuFilters.value.category_id);
  if (menuFilters.value.q) params.q = menuFilters.value.q;

  menuItems.value = await listMenuItems(params);
}

const cartLines = computed(() => order.value?.lines || []);
const cartTotal = computed(() => order.value?.total ?? 0);

async function addMenuItemToOrder(mi) {
  if (!order.value) return;

  // check if item has modifier groups
  try {
    const itemGroups = await listItemModifierGroups(mi.id); // returns mappings with .group
    const groups = (itemGroups || []).map((x) => x.group).filter(Boolean);

    if (groups.length > 0) {
      // load options for each group
      const groupsWithOptions = [];
      for (const g of groups) {
        const opts = await listModifierOptions(g.id);
        groupsWithOptions.push({
          group: g,
          options: (opts || []).filter((o) => o.is_active),
        });
      }

      modifierItem.value = mi;
      modifierGroups.value = groupsWithOptions;
      initSelections(groupsWithOptions);
      modifierModalTitle.value = `Modifiers: ${mi.name}`;
      openModifierModal();
      return;
    }
  } catch (e) {
    // if endpoint not present, just add normally
  }

  // no modifiers => add directly
  await addLineWithModifiers(mi, []);
}

async function addLineWithModifiers(mi, modifierOptionIds = []) {
  saving.value = true;
  try {
    order.value = await addOrderLine(order.value.id, {
      line_type: "MENU_ITEM",
      menu_item_id: mi.id,
      qty: 1,
      unit_price: null,
      note: null,
      send_to_kitchen: false,
      kds_status: null,

      // IMPORTANT: backend should accept this
      // Suggest: option_ids => backend creates OrderLineModifier rows
      modifier_option_ids: modifierOptionIds,
    });
  } catch (e) {
    showModal("Error", e?.response?.data?.detail || e?.message || "Failed to add item");
  } finally {
    saving.value = false;
  }
}

async function confirmAddWithModifiers() {
  if (!modifierItem.value) return;

  if (!validateSelections()) return;

  const optionIds = buildSelectedOptionIds();
  await addLineWithModifiers(modifierItem.value, optionIds);

  closeModifierModal();
  modifierItem.value = null;
  modifierGroups.value = [];
  modifierSelections.value = {};
}

async function incQty(line) {
  saving.value = true;
  try {
    order.value = await updateOrderLine(line.id, { qty: Number(line.qty) + 1 });
  } catch (e) {
    showModal("Error", e?.response?.data?.detail || e?.message || "Failed to update qty");
  } finally {
    saving.value = false;
  }
}

async function decQty(line) {
  if (Number(line.qty) <= 1) return;
  saving.value = true;
  try {
    order.value = await updateOrderLine(line.id, { qty: Number(line.qty) - 1 });
  } catch (e) {
    showModal("Error", e?.response?.data?.detail || e?.message || "Failed to update qty");
  } finally {
    saving.value = false;
  }
}

async function removeLine(line) {
  showConfirm("Remove item", `Remove "${line.item_name}" from this order?`, async () => {
    saving.value = true;
    try {
      order.value = await deleteOrderLine(line.id);
      modalInstance?.hide();
    } catch (e) {
      showModal("Error", e?.response?.data?.detail || e?.message || "Failed to remove item");
    } finally {
      saving.value = false;
    }
  });
}

async function doHold() {
  showConfirm("Hold order", "Hold this order?", async () => {
    saving.value = true;
    try {
      order.value = await holdOrder(order.value.id);
      modalInstance?.hide();
    } catch (e) {
      showModal("Error", e?.response?.data?.detail || e?.message || "Failed to hold order");
    } finally {
      saving.value = false;
    }
  });
}

async function doReopen() {
  saving.value = true;
  try {
    order.value = await reopenOrder(order.value.id);
  } catch (e) {
    showModal("Error", e?.response?.data?.detail || e?.message || "Failed to reopen order");
  } finally {
    saving.value = false;
  }
}

async function doCancel() {
  showConfirm("Cancel order", "Cancel this order? This cannot be undone.", async () => {
    saving.value = true;
    try {
      order.value = await cancelOrder(order.value.id);
      modalInstance?.hide();
    } catch (e) {
      showModal("Error", e?.response?.data?.detail || e?.message || "Failed to cancel order");
    } finally {
      saving.value = false;
    }
  });
}

async function doPay() {
  showConfirm("Pay order", `Mark this order as PAID? Total: ${cartTotal.value}`, async () => {
    saving.value = true;
    try {
      order.value = await payOrder(order.value.id);
      modalInstance?.hide();
    } catch (e) {
      showModal("Error", e?.response?.data?.detail || e?.message || "Failed to pay order");
    } finally {
      saving.value = false;
    }
  });
}

onMounted(async () => {
  await loadOrder();
  await loadMenu();
});

watch(
  () => [menuFilters.value.category_id, menuFilters.value.available],
  async () => {
    try {
      await refreshMenuItems();
    } catch (e) {
      showModal("Error", e?.response?.data?.detail || e?.message || "Failed to load menu items");
    }
  }
);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between">
      <div>
        <h4 class="page-title mb-0">POS</h4>
        <div v-if="order" class="text-muted">
          <span class="me-2 fw-semibold">{{ order.order_no }}</span>
          <span
            class="badge"
            :class="{
              'bg-primary': order.status === 'OPEN',
              'bg-warning': order.status === 'HELD',
              'bg-success': order.status === 'PAID',
              'bg-danger': order.status === 'CANCELLED'
            }"
          >
            {{ order.status }}
          </span>

          <span class="ms-2">Outlet: <span class="fw-semibold">{{ order.outlet?.name || "-" }}</span></span>
          <span class="ms-2">Shift: <span class="fw-semibold">{{ order.shift_id || "-" }}</span></span>
        </div>
      </div>

      <div class="d-flex gap-2">
        <router-link class="btn btn-light" to="/orders">Orders</router-link>
        <router-link class="btn btn-primary" to="/pos/new-order">New Order</router-link>
      </div>
    </div>

    <div v-if="loading" class="card">
      <div class="card-body">
        <span class="spinner-border spinner-border-sm me-2"></span> Loading...
      </div>
    </div>

    <div v-else class="row">
      <!-- Menu -->
      <div class="col-lg-7">
        <div class="card">
          <div class="card-body">
            <div class="d-flex gap-2 mb-3">
              <select class="form-select" v-model="menuFilters.category_id">
                <option value="">All categories</option>
                <option v-for="c in categories" :key="c.id" :value="String(c.id)">
                  {{ c.name }}
                </option>
              </select>

              <select class="form-select" v-model="menuFilters.available">
                <option value="1">Available</option>
                <option value="0">Unavailable</option>
                <option value="all">All</option>
              </select>

              <input class="form-control" v-model="menuFilters.q" placeholder="Search item..."
                @keyup.enter="refreshMenuItems" />
              <button class="btn btn-soft-primary" @click="refreshMenuItems">Search</button>
            </div>

            <div class="table-responsive">
              <table class="table table-sm table-centered mb-0">
                <thead class="table-light">
                  <tr>
                    <th>Item</th>
                    <th class="text-end">Price</th>
                    <th class="text-end">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="menuItems.length === 0">
                    <td colspan="3" class="text-muted text-center py-4">No items</td>
                  </tr>

                  <tr v-for="mi in menuItems" :key="mi.id">
                    <td>
                      <div class="fw-semibold">{{ mi.name }}</div>
                      <div class="text-muted small">{{ mi.sku || "-" }}</div>
                    </td>
                    <td class="text-end">{{ mi.price }}</td>
                    <td class="text-end">
                      <button
                        class="btn btn-sm btn-primary"
                        :disabled="saving || !order || order.status === 'PAID' || order.status === 'CANCELLED'"
                        @click="addMenuItemToOrder(mi)"
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

          </div>
        </div>
      </div>

      <!-- Cart -->
      <div class="col-lg-5">
        <div class="card">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <h5 class="mb-0">Cart</h5>
              <div class="text-muted">Total: <span class="fw-bold">{{ cartTotal }}</span></div>
            </div>

            <div class="d-flex gap-2 mb-3">
              <button class="btn btn-soft-primary w-100" :disabled="!order || saving" @click="() => { loadDiscountsAndOrderDiscounts(); openDiscountModal(); }">
                Discounts
              </button>
            </div>

            <div class="table-responsive">
              <table class="table table-sm table-centered mb-0">
                <thead class="table-light">
                  <tr>
                    <th>Item</th>
                    <th class="text-center">Qty</th>
                    <th class="text-end">Line</th>
                    <th class="text-end"> </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="cartLines.length === 0">
                    <td colspan="4" class="text-muted text-center py-4">No items in cart</td>
                  </tr>

                  <tr v-for="ln in cartLines" :key="ln.id">
                    <td>
                      <div class="fw-semibold">{{ ln.item_name }}</div>
                      <div class="text-muted small">{{ ln.unit_price }} each</div>

                      <div v-if="ln.modifiers?.length" class="small text-muted mt-1">
                        <div v-for="m in ln.modifiers" :key="m.id">+ {{ m.name }} ({{ m.price_delta }})</div>
                      </div>
                    </td>

                    <td class="text-center">
                      <div class="btn-group btn-group-sm">
                        <button class="btn btn-light" :disabled="saving || ln.qty <= 1 || (order.status !== 'OPEN' && order.status !== 'HELD')"
                          @click="decQty(ln)">-</button>
                        <button class="btn btn-light" disabled>{{ ln.qty }}</button>
                        <button class="btn btn-light" :disabled="saving || (order.status !== 'OPEN' && order.status !== 'HELD')"
                          @click="incQty(ln)">+</button>
                      </div>
                    </td>

                    <td class="text-end">{{ ln.total }}</td>

                    <td class="text-end">
                      <button class="btn btn-sm btn-soft-danger"
                        :disabled="saving || (order.status !== 'OPEN' && order.status !== 'HELD')"
                        @click="removeLine(ln)">
                        Remove
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="d-flex gap-2 mt-3">
              <button class="btn btn-warning w-100" :disabled="saving || !order || order.status !== 'OPEN'" @click="doHold">
                Hold
              </button>

              <button class="btn btn-success w-100" :disabled="saving || !order || (order.status !== 'OPEN' && order.status !== 'HELD')" @click="doPay">
                Pay
              </button>
            </div>

            <div class="d-flex gap-2 mt-2">
              <button class="btn btn-soft-primary w-100" :disabled="saving || !order || order.status !== 'HELD'" @click="doReopen">
                Reopen
              </button>

              <button class="btn btn-soft-danger w-100" :disabled="saving || !order || order.status === 'PAID' || order.status === 'CANCELLED'" @click="doCancel">
                Cancel
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>

    <!-- Generic Center Modal -->
    <div class="modal fade" id="centermodal" tabindex="-1" role="dialog" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title" id="myCenterModalLabel">{{ modalTitle }}</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">{{ modalBody }}</div>

            <div v-if="modalMode === 'confirm'" class="d-flex justify-content-end gap-2">
              <button type="button" class="btn btn-light" data-bs-dismiss="modal">Close</button>
              <button type="button" class="btn btn-primary" :disabled="saving" @click="confirmAction && confirmAction()">
                Confirm
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Discounts Center Modal -->
    <div class="modal fade" id="discountModal" tabindex="-1" role="dialog" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title">Discounts</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true"></button>
          </div>
          <div class="modal-body">
            <div class="table-responsive">
              <table class="table table-sm table-centered mb-0">
                <thead class="table-light">
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Scope</th>
                    <th class="text-end">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="discounts.length === 0">
                    <td colspan="5" class="text-muted text-center py-4">No discounts</td>
                  </tr>

                  <tr v-for="d in discounts" :key="d.id">
                    <td class="fw-semibold">{{ d.code }}</td>
                    <td>{{ d.name }}</td>
                    <td>{{ d.discount_type }}</td>
                    <td>{{ d.scope }}</td>
                    <td class="text-end">
                      <button
                        class="btn btn-sm"
                        :class="isDiscountApplied(d) ? 'btn-soft-danger' : 'btn-soft-primary'"
                        :disabled="saving"
                        @click="toggleDiscount(d)"
                      >
                        {{ isDiscountApplied(d) ? "Remove" : "Apply" }}
                      </button>
                    </td>
                  </tr>

                </tbody>
              </table>
            </div>
            <div class="text-muted small mt-2">
              Note: This expects backend endpoints to apply/remove discounts and recalculate totals.
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modifiers Center Modal -->
    <div class="modal fade" id="modifierModal" tabindex="-1" role="dialog" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title">{{ modifierModalTitle }}</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true"></button>
          </div>
          <div class="modal-body">
            <div v-if="modifierGroups.length === 0" class="text-muted">No modifiers.</div>

            <div v-for="g in modifierGroups" :key="g.group.id" class="mb-3 border rounded p-2">
              <div class="d-flex justify-content-between align-items-center">
                <div class="fw-semibold">{{ g.group.name }}</div>
                <div class="text-muted small">
                  min {{ g.group.min_select }} / max {{ g.group.max_select }}
                  — selected {{ selectedCount(g.group.id) }}
                </div>
              </div>

              <div class="mt-2">
                <div class="form-check" v-for="opt in g.options" :key="opt.id">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    :id="`opt_${g.group.id}_${opt.id}`"
                    :checked="isSelected(g.group.id, opt.id)"
                    @change="toggleOption(g.group, opt)"
                  />
                  <label class="form-check-label" :for="`opt_${g.group.id}_${opt.id}`">
                    {{ opt.name }}
                    <span v-if="opt.price_delta" class="text-muted">(+{{ opt.price_delta }})</span>
                  </label>
                </div>
              </div>
            </div>

            <div class="d-flex justify-content-end gap-2 mt-3">
              <button class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
              <button class="btn btn-primary" :disabled="saving" @click="confirmAddWithModifiers">
                Add to Order
              </button>
            </div>

            <div class="text-muted small mt-2">
              Note: This sends <code>modifier_option_ids</code> to backend when adding the line.
            </div>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
