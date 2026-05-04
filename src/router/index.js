// src/router/index.js
import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { PERMS } from "../config/permissions";

import LoginView from "../views/auth/Login.vue";
import DashboardView from "../views/DashboardView.vue";

const routes = [
  { path: "/login", name: "login", component: LoginView, meta: { public: true } },
  { path: "/forgot", name: "forgot", component: () => import("../views/auth/ForgotPassword.vue"), meta: { public: true } },
  { path: "/auth/reset-password", name: "reset-password", component: () => import("../views/auth/ResetPassword.vue"), meta: { public: true } },

  { path: "/", redirect: "/dashboard" },
  { path: "/dashboard", name: "dashboard", component: DashboardView, meta: { requiresAuth: true } },

  // System
  { path: "/system/stores", name: "system-stores", component: () => import("../views/system/StoreProfile.vue"), meta: { perm: [PERMS.STORES_READ, PERMS.STORES_MANAGE] } },
  { path: "/system/outlets", name: "system-outlets", component: () => import("../views/system/Outlets.vue"), meta: { perm: [PERMS.OUTLETS_READ, PERMS.OUTLETS_MANAGE] } },
  { path: "/system/roles", name: "system-roles", component: () => import("../views/system/Roles.vue"), meta: { perm: PERMS.ROLES_MANAGE } },
  { path: "/system/permissions", name: "system-permissions", component: () => import("../views/system/Permissions.vue"), meta: { perm: PERMS.PERMISSIONS_MANAGE } },
  { path: "/system/users", name: "system-users", component: () => import("../views/system/Users.vue"), meta: { perm: [PERMS.USERS_READ, PERMS.USERS_MANAGE] } },

  // Auth utility
  { path: "/auth/change-password", name: "change-password", component: () => import("../views/auth/ChangePassword.vue") },

  // Setup
  { path: "/setup/tax", name: "setup-tax", component: () => import("../views/setup/Tax.vue"), meta: { perm: [PERMS.TAX_READ, PERMS.TAX_MANAGE] } },
  { path: "/setup/uom", name: "setup-uom", component: () => import("../views/setup/Uom.vue"), meta: { perm: [PERMS.UOM_READ, PERMS.UOM_MANAGE] } },
  { path: "/setup/discounts", name: "setup-discounts", component: () => import("../views/setup/Discounts.vue"), meta: { perm: [PERMS.DISCOUNTS_READ, PERMS.DISCOUNTS_MANAGE] } },
  { path: "/setup/customers", name: "setup-customers", component: () => import("../views/setup/Customers.vue") },

  // Cash / expenses
  { path: "/cash/shifts", name: "cash-shifts", component: () => import("../views/cash/Shifts.vue") },
  { path: "/cash/drawers", name: "cash-drawers", component: () => import("../views/cash/Drawers.vue") },
  { path: "/cash/movements", name: "cash-movements", component: () => import("../views/cash/Movements.vue") },
  { path: "/cash/expenses", name: "expenses", component: () => import("../views/expenses/Expenses.vue"), meta: { perm: PERMS.EXPENSE_VIEW } },
  { path: "/cash/expenses/:id", name: "expense-view", component: () => import("../views/expenses/ExpenseView.vue"), props: true, meta: { perm: PERMS.EXPENSE_VIEW } },

  // Menu
  { path: "/menu/manager", name: "menu-manager", component: () => import("../views/menu/MenuManager.vue"), meta: { perm: [PERMS.MENU_READ, PERMS.MENU_MANAGE] } },
  { path: "/menu/categories", name: "menu-categories", component: () => import("../views/menu/Categories.vue"), meta: { perm: [PERMS.MENU_READ, PERMS.MENU_MANAGE] } },
  { path: "/menu/items", redirect: "/menu/manager" },
  { path: "/menu/modifiers", name: "menu-modifiers", component: () => import("../views/menu/Modifiers.vue"), meta: { perm: [PERMS.MODIFIERS_READ, PERMS.MODIFIERS_MANAGE] } },
  { path: "/menu/combos", name: "menu-combos", component: () => import("../views/menu/Combos.vue"), meta: { perm: [PERMS.MENU_READ, PERMS.MENU_MANAGE] } },
  { path: "/menu/recipes", name: "menu-recipes", component: () => import("../views/menu/Recipes.vue"), meta: { perm: [PERMS.RECIPES_READ, PERMS.RECIPES_MANAGE] } },

  // Inventory
  { path: "/inventory/stock-health", name: "inventory-stock-health", component: () => import("../views/inventory/StockHealth.vue"), meta: { perm: [PERMS.INVENTORY_READ, PERMS.INVENTORY_MANAGE] } },
  { path: "/inventory/items", name: "inventory-items", component: () => import("../views/inventory/Items.vue"), meta: { perm: [PERMS.INVENTORY_READ, PERMS.INVENTORY_MANAGE] } },
  { path: "/inventory/categories", name: "inventory-categories", component: () => import("../views/inventory/Categories.vue"), meta: { perm: [PERMS.INVENTORY_READ, PERMS.INVENTORY_MANAGE] } },
  { path: "/inventory/stock", name: "inventory-stock", component: () => import("../views/inventory/Stock.vue"), meta: { perm: [PERMS.INVENTORY_READ, PERMS.INVENTORY_MANAGE] } },
  { path: "/inventory/ledger", name: "inventory-ledger", component: () => import("../views/inventory/Ledger.vue"), meta: { perm: [PERMS.INVENTORY_READ, PERMS.INVENTORY_MANAGE] } },
  { path: "/inventory/audits", name: "inventory-audits", component: () => import("../views/inventory/Audits.vue"), meta: { perm: [PERMS.INVENTORY_READ, PERMS.INVENTORY_MANAGE] } },

  // Purchasing
  { path: "/suppliers", name: "suppliers", component: () => import("../views/purchasing/Suppliers.vue"), meta: { perm: [PERMS.PURCHASES_READ, PERMS.PURCHASES_MANAGE] } },
  { path: "/purchasing/purchase-orders", name: "purchase-orders", component: () => import("../views/purchasing/PurchaseOrders.vue"), meta: { perm: [PERMS.PURCHASES_READ, PERMS.PURCHASES_MANAGE] } },
  { path: "/purchasing/purchase-orders/new", name: "purchase-order-create", component: () => import("../views/purchasing/PurchaseOrderCreate.vue"), meta: { perm: PERMS.PURCHASES_MANAGE } },
  { path: "/purchasing/purchase-orders/:id", name: "purchase-order-view", component: () => import("../views/purchasing/PurchaseOrderView.vue"), props: true, meta: { perm: [PERMS.PURCHASES_READ, PERMS.PURCHASES_MANAGE] } },
  { path: "/purchasing/receipts", name: "purchase-receipts", component: () => import("../views/purchasing/Receipts.vue"), meta: { perm: [PERMS.PURCHASES_READ, PERMS.PURCHASES_MANAGE] } },
  { path: "/purchasing/receipts/:id", name: "purchase-receipt-view", component: () => import("../views/purchasing/ReceiptView.vue"), props: true, meta: { perm: [PERMS.PURCHASES_READ, PERMS.PURCHASES_MANAGE] } },
  { path: "/purchasing/supplier-prices", name: "supplier-prices", component: () => import("../views/purchasing/SupplierPrices.vue"), meta: { perm: [PERMS.PURCHASES_READ, PERMS.PURCHASES_MANAGE] } },
  { path: "/purchasing/stock-intake", name: "stock-intake", component: () => import("../views/purchasing/StockIntake.vue"), meta: { perm: PERMS.PURCHASES_MANAGE } },

  // POS
  { path: "/pos/new-order", redirect: "/pos/v2/new-order" },
  { path: "/pos/order/:id", name: "pos-order", component: () => import("../views/pos/Order.vue"), props: true },
  { path: "/pos/v2/new-order", name: "pos-v2-new-order", component: () => import("../views/pos/PosV2.vue") },

  // KDS
  { path: "/kds", name: "kds", component: () => import("../views/kds/KdsView.vue") },

  { path: "/orders", name: "orders", component: () => import("../views/orders/Orders.vue") },
  { path: "/payments", name: "payments", component: () => import("../views/payments/Payments.vue") },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();

  if (to.meta.public) return true;
  if (!auth.isAuthed) return { name: "login", query: { redirect: to.fullPath } };

  if (auth.isAuthed && !auth.me && to.name !== "login") {
    try {
      await auth.fetchMe();
    } catch {
      await auth.logout();
      return { name: "login" };
    }
  }

  if (auth.me?.must_change_password && to.name !== "change-password" && to.name !== "login") {
    return { name: "change-password" };
  }

  // Permission gate — pulled from the route's meta.perm. String or array (any-of).
  if (to.meta?.perm && !auth.can(to.meta.perm)) {
    return { name: "dashboard" };
  }

  return true;
});

export default router;
