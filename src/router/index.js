// src/router/index.js
import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";

import LoginView from "../views/auth/Login.vue";
import DashboardView from "../views/DashboardView.vue";

const routes = [
  { path: "/login", name: "login", component: LoginView, meta: { public: true } },
  { path: "/forgot", name: "forgot", component: () => import("../views/auth/ForgotPassword.vue"), meta: { public: true } },
  { path: "/auth/reset-password", name: "reset-password", component: () => import("../views/auth/ResetPassword.vue"), meta: { public: true } },

  { path: "/", name: "dashboard", component: DashboardView, meta: { requiresAuth: true } },
  { path: "/system/stores", name: "system-stores", component: () => import("../views/system/StoreProfile.vue"),},
  { path: "/system/outlets", name: "system-outlets", component: () => import("../views/system/Outlets.vue"),},
  { path: "/system/roles", name: "system-roles", component: () => import("../views/system/Roles.vue"),},
  { path: "/system/permissions", name: "system-permissions", component: () => import("../views/system/Permissions.vue"),},
  { path: "/system/users", name: "system-users", component: () => import("../views/system/Users.vue"),},
  { path: "/auth/change-password", name: "change-password", component: () => import("../views/auth/ChangePassword.vue"),},
  { path: "/setup/tax", name: "setup-tax", component: () => import("../views/setup/Tax.vue") },
  { path: "/setup/uom", name: "setup-uom", component: () => import("../views/setup/Uom.vue") },
  { path: "/setup/discounts", name: "setup-discounts", component: () => import("../views/setup/Discounts.vue") },
  { path: "/setup/customers", name: "setup-customers", component: () => import("../views/setup/Customers.vue") },
  { path: "/cash/shifts", name: "cash-shifts", component: () => import("../views/cash/Shifts.vue") },
  { path: "/cash/drawers", name: "cash-drawers", component: () => import("../views/cash/Drawers.vue") },
  { path: "/cash/movements", name: "cash-movements", component: () => import("../views/cash/Movements.vue") },

  { path: "/menu/categories", name: "menu-categories", component: () => import("../views/menu/Categories.vue") },
  { path: "/menu/items", name: "menu-items", component: () => import("../views/menu/Items.vue") },
  { path: "/menu/modifiers", name: "menu-modifiers", component: () => import("../views/menu/Modifiers.vue") },
  { path: "/menu/combos", name: "menu-combos", component: () => import("../views/menu/Combos.vue") },
  { path: "/menu/recipes", name: "menu-recipes", component: () => import("../views/menu/Recipes.vue") },

  { path: "/inventory/items", name: "inventory-items", component: () => import("../views/inventory/Items.vue") },
  { path: "/inventory/categories", name: "inventory-categories", component: () => import("../views/inventory/Categories.vue") },
  { path: "/inventory/stock", name: "inventory-stock", component: () => import("../views/inventory/Stock.vue") },
  { path: "/inventory/ledger", name: "inventory-ledger", component: () => import("../views/inventory/Ledger.vue") },
  { path: "/inventory/audits", name: "inventory-audits", component: () => import("../views/inventory/Audits.vue") },

  { path: "/pos/new-order", name: "pos-new-order", component: () => import("../views/pos/NewOrder.vue") },
  { path: "/pos/order/:id", name: "pos-order", component: () => import("../views/pos/Order.vue"), props: true },
  
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
  if (!auth.isAuthed) return { name: "login" };

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

  return true;
});

export default router;
