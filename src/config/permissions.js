// src/config/permissions.js
// Canonical permission codes — keep aligned with the backend seed
// (app/scripts/seed_initial_data.py) and require_any_permission usage.

export const PERMS = {
  // System / org
  STORES_READ: "stores:read",
  STORES_MANAGE: "stores:manage",
  OUTLETS_READ: "outlets:read",
  OUTLETS_MANAGE: "outlets:manage",
  USERS_READ: "users:read",
  USERS_MANAGE: "users:manage",
  USERS_CREATE: "users:create",
  USERS_UPDATE: "users:update",
  USERS_DELETE: "users:delete",
  ROLES_MANAGE: "roles:manage",
  PERMISSIONS_MANAGE: "permissions:manage",

  // Setup / catalog
  MENU_READ: "menu:read",
  MENU_MANAGE: "menu:manage",
  TAX_READ: "tax:read",
  TAX_MANAGE: "tax:manage",
  UOM_READ: "uom:read",
  UOM_MANAGE: "uom:manage",
  MODIFIERS_READ: "modifiers:read",
  MODIFIERS_MANAGE: "modifiers:manage",
  RECIPES_READ: "recipes:read",
  RECIPES_MANAGE: "recipes:manage",
  DISCOUNTS_READ: "discounts:read",
  DISCOUNTS_MANAGE: "discounts:manage",

  // Operations
  INVENTORY_READ: "inventory:read",
  INVENTORY_MANAGE: "inventory:manage",
  PURCHASES_READ: "purchases:read",
  PURCHASES_MANAGE: "purchases:manage",

  EXPENSE_VIEW: "expense:view",
  EXPENSE_CREATE: "expense:create",
  EXPENSE_MANAGE: "expense:manage",
  EXPENSE_APPROVE: "expense:approve",
  EXPENSE_UPLOAD: "expense:upload",
};

// Roles considered "system admin" by the backend require_any_permission helper.
// Keep in sync with app/api/permissions.py.
const ADMIN_ROLES = new Set([
  "system_admin",
  "super_admin",
  "superadmin",
  "super admin",
  "admin",
]);

const norm = (s) => String(s || "").trim().toLowerCase();

// Build a set of acceptable codes that includes :/. interchangeability and
// implicit upgrades — having `*:manage` implies `*:read` (and the explicit
// expense aliases).
function expand(code) {
  if (!code) return new Set();
  const out = new Set();
  const add = (v) => v && out.add(v);

  add(code);
  add(code.replace(/\./g, ":"));
  add(code.replace(/:/g, "."));

  // ALL_CAPS underscore variant (e.g., expense:view -> EXPENSE_VIEW)
  if (code.includes(":")) {
    add(code.replace(/:/g, "_").toUpperCase());
    add(code.replace(/:/g, "_").toLowerCase());
  }
  return out;
}

// What other codes implicitly grant `code`?
function implicitGrants(code) {
  const out = new Set();
  const c = String(code || "");
  // resource:read is implied by resource:manage
  if (c.endsWith(":read") || c.endsWith(".read") || c.endsWith(":view") || c.endsWith(".view")) {
    const resource = c.split(/[:.]/)[0];
    out.add(`${resource}:manage`);
    out.add(`${resource}.manage`);
  }
  return out;
}

export function buildCan(me) {
  const roles = (me?.roles || []).map(norm);
  const isAdmin = roles.some((r) => ADMIN_ROLES.has(r));
  const owned = new Set((me?.permissions || []).map((p) => String(p)));

  return function can(code) {
    if (!me) return false;
    if (!code) return true;
    if (isAdmin) return true;

    // Allow array form: can(["a", "b"]) -> any-of
    if (Array.isArray(code)) return code.some((c) => can(c));

    const direct = expand(code);
    for (const c of direct) if (owned.has(c)) return true;

    for (const grant of implicitGrants(code)) {
      for (const c of expand(grant)) if (owned.has(c)) return true;
    }
    return false;
  };
}
