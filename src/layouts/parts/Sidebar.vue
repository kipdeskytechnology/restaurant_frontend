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

// Smart permission check — handled in the auth store. Accepts a single code or
// an array (any-of). System admins and `:manage` holders get auto-grants.
const can = (code) => auth.can(code);

/* ---------- User chip ---------- */
const displayName = computed(() => {
  const me = auth.me;
  if (!me) return "User";
  const full = [me.first_name, me.last_name].filter(Boolean).join(" ");
  return full || me.username || me.email || "User";
});

const initials = computed(() =>
  displayName.value
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "U"
);

const roleLabel = computed(() => {
  const roles = auth.me?.roles || [];
  if (!roles.length) return "Member";
  const lower = roles.map((r) => String(r).toLowerCase());
  if (lower.includes("system_admin")) return "System Admin";
  if (lower.includes("super_admin") || lower.includes("superadmin")) return "Super Admin";
  if (lower.includes("store_admin")) return "Store Admin";
  if (lower.includes("cashier")) return "Cashier";
  return String(roles[0]).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
});

const avatarUrl = computed(() => auth.me?.avatar_url || auth.me?.avatar || null);
const avatarFailed = ref(false);

/* ---------- Help box ---------- */
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

const helpTitle = computed(() => (isSystemAdmin.value ? "Manage your stores" : "Need a hand?"));
const helpMessage = computed(() =>
  isSystemAdmin.value
    ? "Open System → Stores to add outlets, users and configure access."
    : "Ask your admin to grant access to the modules you need."
);
const helpCta = computed(() => (isSystemAdmin.value ? "Open System" : "View profile"));
const helpTo = computed(() => (isSystemAdmin.value ? "/system/stores" : "/dashboard"));
</script>

<template>
  <div class="leftside-menu" style="zoom: 80%">
    <div class="button-sm-hover" data-bs-toggle="tooltip" data-bs-placement="right" title="Show full sidebar">
      <i class="ri-checkbox-blank-circle-line align-middle"></i>
    </div>
    <div class="button-close-fullsidebar" @click="closeSidebar">
      <i class="ri-close-fill align-middle"></i>
    </div>

    <div class="h-100" id="leftside-menu-container" data-simplebar>
      <!-- User chip -->
      <div class="leftbar-user app-user-chip">
        <div class="user-avatar">
          <img
            v-if="avatarUrl && !avatarFailed"
            :src="avatarUrl"
            alt="avatar"
            @error="avatarFailed = true"
          />
          <span v-else class="user-avatar-fallback">{{ initials }}</span>
        </div>
        <div class="leftbar-user-name">{{ displayName }}</div>
        <div class="user-role-pill">
          <i class="ri-shield-user-line me-1"></i>{{ roleLabel }}
        </div>
      </div>

      <ul class="side-nav" id="sidebar-accordion">
        <li class="side-nav-title">Main</li>

        <!-- Dashboard -->
        <li class="side-nav-item" :class="{ 'menuitem-active': isActive('/dashboard') || isActive('/') }">
          <router-link to="/dashboard" class="side-nav-link">
            <i class="ri-dashboard-2-line"></i>
            <span>Dashboard</span>
          </router-link>
        </li>

        <!-- POS / Orders / Payments / KDS — any authenticated user -->
        <li
          class="side-nav-item"
          :class="{ 'menuitem-active': isGroupOpen(['/pos','/orders','/payments','/kds']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarPos" aria-controls="sidebarPos"
             :aria-expanded="isGroupOpen(['/pos','/orders','/payments','/kds']) ? 'true' : 'false'">
            <i class="ri-shopping-cart-2-line"></i>
            <span>POS</span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarPos" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/pos','/orders','/payments','/kds']) }">
            <ul class="side-nav-second-level">
              <li><router-link to="/pos/v2/new-order">New Order</router-link></li>
              <li><router-link to="/orders">Orders</router-link></li>
              <li><router-link to="/kds">Kitchen Display</router-link></li>
              <li><router-link to="/payments">Payments</router-link></li>
            </ul>
          </div>
        </li>

        <li class="side-nav-title">Catalog</li>

        <!-- Menu -->
        <li
          class="side-nav-item"
          v-if="can(['menu:read','menu:manage','modifiers:read','recipes:read'])"
          :class="{ 'menuitem-active': isGroupOpen(['/menu','/menu-items','/modifiers','/recipes','/combos']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarMenu" aria-controls="sidebarMenu"
             :aria-expanded="isGroupOpen(['/menu','/menu-items','/modifiers','/recipes','/combos']) ? 'true' : 'false'">
            <i class="ri-restaurant-2-line"></i>
            <span>Menu</span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarMenu" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/menu','/menu-items','/modifiers','/recipes','/combos']) }">
            <ul class="side-nav-second-level">
              <li v-if="can('menu:read')"><router-link to="/menu/manager">Menu Manager</router-link></li>
              <li v-if="can('menu:read')"><router-link to="/menu/categories">Categories</router-link></li>
              <li v-if="can('modifiers:read')"><router-link to="/menu/modifiers">Modifiers</router-link></li>
              <li v-if="can('menu:read')"><router-link to="/menu/combos">Combos</router-link></li>
              <li v-if="can('recipes:read')"><router-link to="/menu/recipes">Recipes</router-link></li>
            </ul>
          </div>
        </li>

        <!-- Inventory -->
        <li
          class="side-nav-item"
          v-if="can('inventory:read')"
          :class="{ 'menuitem-active': isGroupOpen(['/inventory','/stock','/audits','/stock-ledger']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarInventory" aria-controls="sidebarInventory"
             :aria-expanded="isGroupOpen(['/inventory','/stock','/audits','/stock-ledger']) ? 'true' : 'false'">
            <i class="ri-archive-line"></i>
            <span>Inventory</span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarInventory" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/inventory','/stock','/audits','/stock-ledger']) }">
            <ul class="side-nav-second-level">
              <li><router-link to="/inventory/stock-health">Stock Health</router-link></li>
              <li><router-link to="/inventory/categories">Categories</router-link></li>
              <li><router-link to="/inventory/items">Items</router-link></li>
              <li><router-link to="/inventory/stock">Stock Balances</router-link></li>
              <li><router-link to="/inventory/ledger">Stock Ledger</router-link></li>
              <li><router-link to="/inventory/audits">Inventory Audits</router-link></li>
            </ul>
          </div>
        </li>

        <!-- Purchasing -->
        <li
          class="side-nav-item"
          v-if="can('purchases:read')"
          :class="{ 'menuitem-active': isGroupOpen(['/purchasing','/suppliers','/purchase-orders','/purchase-receipts']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarPurchasing" aria-controls="sidebarPurchasing"
             :aria-expanded="isGroupOpen(['/purchasing','/suppliers','/purchase-orders','/purchase-receipts']) ? 'true' : 'false'">
            <i class="ri-truck-line"></i>
            <span>Purchasing</span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarPurchasing" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/purchasing','/suppliers','/purchase-orders','/purchase-receipts']) }">
            <ul class="side-nav-second-level">
              <li><router-link to="/suppliers">Suppliers</router-link></li>
              <li><router-link to="/purchasing/purchase-orders">Purchase Orders</router-link></li>
              <li><router-link to="/purchasing/receipts">Purchase Receipts</router-link></li>
              <li v-if="can('purchases:manage')"><router-link to="/purchasing/stock-intake">Stock Intake</router-link></li>
            </ul>
          </div>
        </li>

        <li class="side-nav-title">Operations</li>

        <!-- Cash -->
        <li
          class="side-nav-item"
          :class="{ 'menuitem-active': isGroupOpen(['/cash','/shifts','/cash-drawers','/cash-movements']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarCash" aria-controls="sidebarCash"
             :aria-expanded="isGroupOpen(['/cash','/shifts','/cash-drawers','/cash-movements']) ? 'true' : 'false'">
            <i class="ri-money-dollar-circle-line"></i>
            <span>Cash</span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarCash" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/cash','/shifts','/cash-drawers','/cash-movements']) }">
            <ul class="side-nav-second-level">
              <li><router-link to="/cash/drawers">Cash Drawers</router-link></li>
              <li><router-link to="/cash/shifts">Shifts</router-link></li>
              <li><router-link to="/cash/movements">Cash Movements</router-link></li>
              <li v-if="can('expense:view')"><router-link to="/cash/expenses">Expenses</router-link></li>
            </ul>
          </div>
        </li>

        <!-- Setup -->
        <li
          class="side-nav-item"
          v-if="can(['tax:read','uom:read','discounts:read','menu:read'])"
          :class="{ 'menuitem-active': isGroupOpen(['/setup','/tax','/uom']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarSetup" aria-controls="sidebarSetup"
             :aria-expanded="isGroupOpen(['/setup','/customers','/discounts','/tax','/uom']) ? 'true' : 'false'">
            <i class="ri-equalizer-line"></i>
            <span>Setup</span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarSetup" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/setup','/customers','/discounts','/tax','/uom']) }">
            <ul class="side-nav-second-level">
              <li><router-link to="/setup/customers">Customers</router-link></li>
              <li v-if="can('discounts:read')"><router-link to="/setup/discounts">Discounts</router-link></li>
              <li v-if="can('tax:read')"><router-link to="/setup/tax">Tax</router-link></li>
              <li v-if="can('uom:read')"><router-link to="/setup/uom">Units of Measure</router-link></li>
            </ul>
          </div>
        </li>

        <li class="side-nav-title">Admin</li>

        <!-- System -->
        <li
          class="side-nav-item"
          v-if="isSystemAdmin || can(['stores:read','outlets:read','users:read','roles:manage','permissions:manage'])"
          :class="{ 'menuitem-active': isGroupOpen(['/system']) }"
        >
          <a class="side-nav-link" data-bs-toggle="collapse" href="#sidebarSystem" aria-controls="sidebarSystem"
             :aria-expanded="isGroupOpen(['/system']) ? 'true' : 'false'">
            <i class="ri-settings-3-line"></i>
            <span>System</span>
            <span class="menu-arrow"></span>
          </a>
          <div class="collapse" id="sidebarSystem" data-bs-parent="#sidebar-accordion"
               :class="{ show: isGroupOpen(['/system']) }">
            <ul class="side-nav-second-level">
              <li v-if="can('stores:read')"><router-link to="/system/stores">Stores</router-link></li>
              <li v-if="can('outlets:read')"><router-link to="/system/outlets">Outlets</router-link></li>
              <li v-if="can('users:read')"><router-link to="/system/users">Users</router-link></li>
              <li v-if="can('roles:manage')"><router-link to="/system/roles">Roles</router-link></li>
              <li v-if="can('permissions:manage')"><router-link to="/system/permissions">Permissions</router-link></li>
            </ul>
          </div>
        </li>

        <!-- Help box -->
        <div v-if="showHelp" class="help-box text-white">
          <a href="javascript:void(0);" class="float-end close-btn text-white" @click.prevent="hideHelpBox" aria-label="Hide help">
            <i class="ri-close-line"></i>
          </a>
          <i class="ri-sparkling-2-line help-icon"></i>
          <h5 class="mt-2 mb-1">{{ helpTitle }}</h5>
          <p class="mb-3">{{ helpMessage }}</p>
          <router-link :to="helpTo" class="btn btn-sm">
            {{ helpCta }}
            <i class="ri-arrow-right-line ms-1"></i>
          </router-link>
        </div>
      </ul>

      <div class="clearfix"></div>
    </div>
  </div>
</template>

<style scoped>
/* User chip — modernized */
.app-user-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.user-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  box-shadow: 0 0 0 3px #fff, 0 6px 14px rgba(99, 102, 241, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}
.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.user-avatar-fallback {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 700;
  font-size: 1.05rem;
  color: #fff;
  letter-spacing: 0.01em;
}

.user-role-pill {
  display: inline-flex;
  align-items: center;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.22rem 0.6rem;
  margin-top: 0.4rem;
  border-radius: 999px;
  color: #6366f1;
  background: rgba(99, 102, 241, 0.1);
}

/* Help box icon */
.help-box .help-icon {
  font-size: 2rem;
  color: #fff;
  opacity: 0.95;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.25));
}
</style>
