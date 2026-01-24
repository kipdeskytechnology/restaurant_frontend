<!-- src/layouts/parts/Sidebar.vue -->
<script setup>
import { ref, computed } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "../../stores/auth";

const route = useRoute();
const auth = useAuthStore();

/* ---------- helpers ---------- */
const path = computed(() => route.path);
const isActive = (p) => path.value === p || path.value.startsWith(p + "/");
const isGroupOpen = (prefixes) => prefixes.some((p) => isActive(p));

function closeSidebar() {
  document.documentElement.classList.remove("sidebar-enable");
}

/* ---------- roles ---------- */
const rolesLower = computed(() => (auth.me?.roles || []).map((r) => String(r).toLowerCase()));
const isSystemAdmin = computed(() =>
  rolesLower.value.includes("system_admin") ||
  rolesLower.value.includes("super_admin") ||
  rolesLower.value.includes("superadmin") ||
  rolesLower.value.includes("super admin")
);

/**
 * Permission helper:
 * - Allows admin roles
 * - Supports both "module.action" and "module:action" styles
 */
const can = (code) => {
  if (!code) return true;
  const me = auth.me;
  if (!me) return false;

  if (isSystemAdmin.value) return true;

  const perms = me.permissions || [];
  if (perms.includes(code)) return true;

  // Compatibility: if caller uses dots but backend uses colons or vice versa
  const alt = code.includes(".") ? code.replace(/\./g, ":") : code.replace(/:/g, ".");
  return perms.includes(alt);
};

/* ---------- Help box (optional placeholder) ---------- */
const showHelp = ref(true);
try {
  showHelp.value = localStorage.getItem("sidebarHelpHidden") !== "1";
} catch {}
function hideHelpBox() {
  showHelp.value = false;
  try {
    localStorage.setItem("sidebarHelpHidden", "1");
  } catch {}
}

const helpTitle = computed(() => "Quick tip");
const helpMessage = computed(() =>
  isSystemAdmin.value
    ? "Use System → Stores to manage stores/outlets/users."
    : "Ask your admin to grant you access to the modules you need."
);
const helpCta = computed(() => (isSystemAdmin.value ? "Go to System" : "View Profile"));
</script>

<template>
  <div class="leftside-menu" style="zoom: 80%">
    <!-- Brand Logo Light -->
    <router-link to="/" class="logo logo-light">
      <span class="logo-sm">
        <img src="/src/assets/images/logo-sm.png" alt="small logo" />
      </span>
    </router-link>

    <!-- Brand Logo Dark -->
    <router-link to="/" class="logo logo-dark">
      <span class="logo-lg">
        <img src="/src/assets/images/logo-dark.png" alt="dark logo" />
      </span>
      <span class="logo-sm">
        <img src="/src/assets/images/logo-dark-sm.png" alt="small logo" />
      </span>
    </router-link>

    <div class="button-sm-hover" data-bs-toggle="tooltip" data-bs-placement="right" title="Show Full Sidebar">
      <i class="ri-checkbox-blank-circle-line align-middle"></i>
    </div>
    <div class="button-close-fullsidebar" @click="closeSidebar">
      <i class="ri-close-fill align-middle"></i>
    </div>

    <div class="h-100" id="leftside-menu-container" data-simplebar>
      <div class="leftbar-user">
        <a href="javascript:void(0);">
          <img src="/src/assets/images/users/avatar-1.jpg" alt="user-image" height="42" class="rounded-circle shadow-sm" />
          <span class="leftbar-user-name mt-2">
            {{ auth.me?.first_name || auth.me?.username || "User" }}
          </span>
        </a>
      </div>

      <ul class="side-nav" id="sidebar-accordion">
        <li class="side-nav-title">Navigation</li>

        <!-- Dashboard -->
        <li class="side-nav-item" :class="{ 'menuitem-active': isActive('/dashboard') || isActive('/') }">
          <router-link to="/dashboard" class="side-nav-link">
            <i class="uil-home-alt"></i>
            <span> Dashboard </span>
          </router-link>
        </li>

        <!-- POS -->
        <li
          class="side-nav-item"
          v-if="can('orders.view') || can('orders.create') || can('payments.view')"
          :class="{ 'menuitem-active': isGroupOpen(['/pos','/orders','/payments']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarPos" aria-controls="sidebarPos"
             :aria-expanded="isGroupOpen(['/pos','/orders','/payments']) ? 'true' : 'false'">
            <i class="uil-shopping-cart-alt"></i>
            <span> POS </span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarPos" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/pos','/orders','/payments']) }">
            <ul class="side-nav-second-level">
              <li v-if="can('orders.create')"><router-link to="/pos/new-order">New Order</router-link></li>
              <li v-if="can('orders.view')"><router-link to="/orders">Orders</router-link></li>
              <li v-if="can('payments.view')"><router-link to="/payments">Payments</router-link></li>
            </ul>
          </div>
        </li>

        <!-- Menu -->
        <li
          class="side-nav-item"
          v-if="can('menu.view')"
          :class="{ 'menuitem-active': isGroupOpen(['/menu','/menu-items','/modifiers','/recipes','/combos']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarMenu" aria-controls="sidebarMenu"
             :aria-expanded="isGroupOpen(['/menu','/menu-items','/modifiers','/recipes','/combos']) ? 'true' : 'false'">
            <i class="uil-restaurant"></i>
            <span> Menu </span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarMenu" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/menu','/menu-items','/modifiers','/recipes','/combos']) }">
            <ul class="side-nav-second-level">
              <li><router-link to="/menu/categories">Categories</router-link></li>
              <li><router-link to="/menu/items">Menu Items</router-link></li>
              <li v-if="can('modifiers.view')"><router-link to="/menu/modifiers">Modifiers</router-link></li>
              <li v-if="can('combos.view')"><router-link to="/menu/combos">Combos</router-link></li>
              <li v-if="can('recipes.view')"><router-link to="/menu/recipes">Recipes</router-link></li>
            </ul>
          </div>
        </li>

        <!-- Products -->
        <!-- <li
          class="side-nav-item"
          v-if="can('products.view')"
          :class="{ 'menuitem-active': isGroupOpen(['/products']) }"
        >
          <router-link to="/products" class="side-nav-link">
            <i class="uil-box"></i>
            <span> Products </span>
          </router-link>
        </li> -->

        <!-- Inventory -->
        <li
          class="side-nav-item"
          v-if="can('inventory.view')"
          :class="{ 'menuitem-active': isGroupOpen(['/inventory','/stock','/audits','/stock-ledger']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarInventory" aria-controls="sidebarInventory"
             :aria-expanded="isGroupOpen(['/inventory','/stock','/audits','/stock-ledger']) ? 'true' : 'false'">
            <i class="uil-layers-alt"></i>
            <span> Inventory </span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarInventory" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/inventory','/stock','/audits','/stock-ledger']) }">
            <ul class="side-nav-second-level">
              <li><router-link to="/inventory/categories">Categories</router-link></li>
              <li><router-link to="/inventory/items">Items</router-link></li>
              <li><router-link to="/inventory/stock">Stock Balances</router-link></li>
              <li v-if="can('inventory.ledger')"><router-link to="/inventory/ledger">Stock Ledger</router-link></li>
              <li v-if="can('inventory_audits.view')"><router-link to="/inventory/audits">Inventory Audits</router-link></li>
            </ul>
          </div>
        </li>

        <!-- Purchasing -->
        <li
          class="side-nav-item"
          v-if="can('purchasing.view')"
          :class="{ 'menuitem-active': isGroupOpen(['/purchasing','/suppliers','/purchase-orders','/purchase-receipts']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarPurchasing" aria-controls="sidebarPurchasing"
             :aria-expanded="isGroupOpen(['/purchasing','/suppliers','/purchase-orders','/purchase-receipts']) ? 'true' : 'false'">
            <i class="uil-truck"></i>
            <span> Purchasing </span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarPurchasing" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/purchasing','/suppliers','/purchase-orders','/purchase-receipts']) }">
            <ul class="side-nav-second-level">
              <li><router-link to="/suppliers">Suppliers</router-link></li>
              <li><router-link to="/purchasing/purchase-orders">Purchase Orders</router-link></li>
              <li><router-link to="/purchasing/receipts">Purchase Receipts</router-link></li>
              <li v-if="can('supplier_prices.view')"><router-link to="/purchasing/supplier-prices">Supplier Prices</router-link></li>
            </ul>
          </div>
        </li>

        <!-- Cash Management -->
        <li
          class="side-nav-item"
          v-if="can('cash.view')"
          :class="{ 'menuitem-active': isGroupOpen(['/cash','/shifts','/cash-drawers','/cash-movements']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarCash" aria-controls="sidebarCash"
             :aria-expanded="isGroupOpen(['/cash','/shifts','/cash-drawers','/cash-movements']) ? 'true' : 'false'">
            <i class="uil-money-withdraw"></i>
            <span> Cash </span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarCash" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/cash','/shifts','/cash-drawers','/cash-movements']) }">
            <ul class="side-nav-second-level">
              <li><router-link to="/cash/drawers">Cash Drawers</router-link></li>
              <li><router-link to="/cash/shifts">Shifts</router-link></li>
              <li v-if="can('cash_movements.view')"><router-link to="/cash/movements">Cash Movements</router-link></li>
            </ul>
          </div>
        </li>

        <!-- Setup -->
        <li
          class="side-nav-item"
          v-if="can('setup.view')"
          :class="{ 'menuitem-active': isGroupOpen(['/setup','/tax','/uom']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarSetup" aria-controls="sidebarSetup"
             :aria-expanded="isGroupOpen(['/setup','/customers','/discounts','/tax','/uom']) ? 'true' : 'false'">
            <i class="uil-sliders-v-alt"></i>
            <span> Setup </span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarSetup" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/setup','/customers','/discounts','/tax','/uom']) }">
            <ul class="side-nav-second-level">
              <li v-if="can('customers.view')"><router-link to="/setup/customers">Customers</router-link></li>
              <li v-if="can('discounts.view')"><router-link to="/setup/discounts">Discounts</router-link></li>
              <li v-if="can('tax.view')"><router-link to="/setup/tax">Tax</router-link></li>
              <li v-if="can('uom.view')"><router-link to="/setup/uom">Units of Measure</router-link></li>
            </ul>
          </div>
        </li>

        <!-- Logs -->
        <li
          class="side-nav-item"
          v-if="can('logs.view')"
          :class="{ 'menuitem-active': isGroupOpen(['/logs']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarLogs" aria-controls="sidebarLogs"
             :aria-expanded="isGroupOpen(['/logs']) ? 'true' : 'false'">
            <i class="uil-file-alt"></i>
            <span> Logs </span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarLogs" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/logs']) }">
            <ul class="side-nav-second-level">
              <li><router-link to="/logs/audit">Audit Logs</router-link></li>
              <li><router-link to="/logs/system">System Logs</router-link></li>
            </ul>
          </div>
        </li>

        <!-- System -->
        <li
          class="side-nav-item"
          v-if="isSystemAdmin || can('system.view')"
          :class="{ 'menuitem-active': isGroupOpen(['/system']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarSystem" aria-controls="sidebarSystem"
             :aria-expanded="isGroupOpen(['/system']) ? 'true' : 'false'">
            <i class="uil-setting"></i>
            <span> System </span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarSystem" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/system']) }">
            <ul class="side-nav-second-level">
              <li v-if="isSystemAdmin || can('stores.view')"><router-link to="/system/stores">Stores</router-link></li>
              <li v-if="isSystemAdmin || can('outlets.view')"><router-link to="/system/outlets">Outlets</router-link></li>
              <li v-if="can('users.view')"><router-link to="/system/users">Users</router-link></li>
              <li v-if="can('roles.view')"><router-link to="/system/roles">Roles</router-link></li>
              <li v-if="can('permissions.view')"><router-link to="/system/permissions">Permissions</router-link></li>
            </ul>
          </div>
        </li>

        <!-- Help box -->
        <div v-if="showHelp" class="help-box text-white text-center">
          <a href="javascript: void(0);" class="float-end close-btn text-white" @click.prevent="hideHelpBox">
            <i class="mdi mdi-close"></i>
          </a>
          <img src="/src/assets/images/svg/help-icon.svg" height="90" alt="Helper Icon Image" />
          <h5 class="mt-3">{{ helpTitle }}</h5>
          <p class="mb-3">{{ helpMessage }}</p>
          <router-link :to="isSystemAdmin ? '/system/stores' : '/dashboard'" class="btn btn-secondary btn-sm">
            {{ helpCta }}
          </router-link>
        </div>
      </ul>

      <div class="clearfix"></div>
    </div>
  </div>
</template>
