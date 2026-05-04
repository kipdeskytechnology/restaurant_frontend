<!-- src/layouts/parts/Topbar.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";

const auth = useAuthStore();
const router = useRouter();

// -------- Safe sessionStorage helpers ----------
const hasSession = () => typeof window !== "undefined" && !!window.sessionStorage;
const sset = (k, v) => {
  try {
    if (hasSession()) window.sessionStorage.setItem(k, v);
  } catch {}
};

// -------- User display ----------
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

const avatarUrl = computed(() => auth.me?.avatar_url || auth.me?.avatar || null);
const avatarFailed = ref(false);

const roleLabel = computed(() => {
  const roles = auth.me?.roles || [];
  if (!roles.length) return "User";
  const lower = roles.map((r) => String(r).toLowerCase());
  if (lower.includes("system_admin")) return "System Admin";
  if (lower.includes("super_admin") || lower.includes("superadmin") || lower.includes("super admin")) return "Super Admin";
  if (lower.includes("store_admin")) return "Store Admin";
  if (lower.includes("cashier")) return "Cashier";
  return String(roles[0]).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
});

// Fullscreen
const isFullscreen = ref(false);
const fsEl = () =>
  document.fullscreenElement ||
  document.webkitFullscreenElement ||
  document.mozFullScreenElement ||
  document.msFullscreenElement;

const requestFS = (el) =>
  el.requestFullscreen?.() ||
  el.webkitRequestFullscreen?.() ||
  el.mozRequestFullScreen?.() ||
  el.msRequestFullscreen?.();

const exitFS = () =>
  document.exitFullscreen?.() ||
  document.webkitExitFullscreen?.() ||
  document.mozCancelFullScreen?.() ||
  document.msExitFullscreen?.();

function toggleFullscreen() {
  fsEl() ? exitFS() : requestFS(document.documentElement);
}
function onFsChange() {
  isFullscreen.value = !!fsEl();
}

// Theme
const theme = ref(
  (() => {
    try {
      return localStorage.getItem("theme") || document.body.dataset.bsTheme || "light";
    } catch {
      return "light";
    }
  })()
);

function applyTheme(t) {
  document.documentElement.setAttribute("data-bs-theme", t);
  document.body.setAttribute("data-bs-theme", t);

  if (typeof window !== "undefined" && window.config) {
    window.config.theme = t;
    sset("__HYPER_CONFIG__", JSON.stringify(window.config));
  }

  try {
    localStorage.setItem("theme", t);
  } catch {}
  theme.value = t;
}
function toggleTheme() {
  applyTheme(theme.value === "light" ? "dark" : "light");
}

// User menu (Vue-managed dropdown)
const userOpen = ref(false);
function toggleUser() {
  userOpen.value = !userOpen.value;
}

// Notifications dropdown stub
const notifOpen = ref(false);
function toggleNotif() {
  notifOpen.value = !notifOpen.value;
}

function onDocClick(e) {
  const userBtn = document.getElementById("user-menu-btn");
  const userMenu = document.getElementById("user-menu");
  if (userBtn && userMenu && !userBtn.contains(e.target) && !userMenu.contains(e.target)) {
    userOpen.value = false;
  }
  const notifBtn = document.getElementById("notif-menu-btn");
  const notifMenu = document.getElementById("notif-menu");
  if (notifBtn && notifMenu && !notifBtn.contains(e.target) && !notifMenu.contains(e.target)) {
    notifOpen.value = false;
  }
}

onMounted(() => {
  applyTheme(theme.value);
  ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"].forEach((ev) =>
    document.addEventListener(ev, onFsChange)
  );
  onFsChange();
  document.addEventListener("click", onDocClick);
});

onBeforeUnmount(() => {
  ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"].forEach((ev) =>
    document.removeEventListener(ev, onFsChange)
  );
  document.removeEventListener("click", onDocClick);
});

// Sidebar responsiveness
function toggleSidebar() {
  const html = document.documentElement;
  const width = window.innerWidth;

  if (width <= 767.98) {
    html.classList.toggle("sidebar-enable");
  } else {
    const current = html.getAttribute("data-sidenav-size") || "default";
    html.setAttribute("data-sidenav-size", current === "default" ? "condensed" : "default");
  }
}

// Lock screen action
function lockScreen() {
  sset("locked", "1");
  try {
    localStorage.setItem("locked", "1");
  } catch {}
  try {
    new BroadcastChannel("lock-sync").postMessage({ type: "lock", value: 1 });
  } catch {}
  try {
    router.push({ name: "lock" });
  } catch {
    router.push({ name: "dashboard" }).catch(() => {});
  }
}

async function handleLogout() {
  await auth.logout();
  router.replace({ name: "login" });
}

// Quick search (placeholder — can wire to a global command palette later)
const searchQuery = ref("");
function onSearchSubmit() {
  // hook this up to your search route when ready
}
</script>

<template>
  <div class="navbar-custom">
    <div class="topbar container-fluid">
      <div class="d-flex align-items-center gap-lg-2 gap-1">
        <!-- Brand (mobile only — sidebar hides on small screens) -->
        <div class="logo-topbar">
          <router-link to="/" class="logo-light">
            <span class="logo-lg">
              <img src="/src/assets/images/logo.png" alt="logo" />
            </span>
            <span class="logo-sm">
              <img src="/src/assets/images/logo-sm.png" alt="small logo" />
            </span>
          </router-link>

          <router-link to="/" class="logo-dark">
            <span class="logo-lg">
              <img src="/src/assets/images/logo-dark.png" alt="dark logo" />
            </span>
            <span class="logo-sm">
              <img src="/src/assets/images/logo-dark-sm.png" alt="small logo" />
            </span>
          </router-link>
        </div>

        <button class="button-toggle-menu" type="button" @click="toggleSidebar" aria-label="Toggle sidebar">
          <i class="ri-menu-5-line"></i>
        </button>

        <!-- Quick search -->
        <form class="app-search d-none d-lg-block ms-2" @submit.prevent="onSearchSubmit">
          <div class="position-relative">
            <input
              v-model="searchQuery"
              type="text"
              class="form-control form-control-sm"
              placeholder="Search orders, items, customers…"
            />
            <i class="ri-search-line search-icon"></i>
            <kbd class="search-kbd d-none d-xl-inline-flex">⌘ K</kbd>
          </div>
        </form>
      </div>

      <ul class="topbar-menu d-flex align-items-center gap-2 gap-md-3">
        <!-- Theme toggle -->
        <li class="d-none d-sm-inline-block">
          <button class="topbar-icon-btn" @click="toggleTheme" :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'" :title="theme === 'dark' ? 'Light mode' : 'Dark mode'">
            <i :class="theme === 'dark' ? 'ri-sun-line' : 'ri-moon-line'"></i>
          </button>
        </li>

        <!-- Fullscreen -->
        <li class="d-none d-md-inline-block">
          <button class="topbar-icon-btn" @click="toggleFullscreen" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" aria-label="Fullscreen toggle">
            <i :class="isFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'"></i>
          </button>
        </li>

        <!-- Notifications -->
        <li class="dropdown d-none d-sm-inline-block position-relative">
          <button id="notif-menu-btn" class="topbar-icon-btn position-relative" @click="toggleNotif" aria-label="Notifications">
            <i class="ri-notification-3-line"></i>
            <span class="notif-dot"></span>
          </button>
          <div
            id="notif-menu"
            class="dropdown-menu dropdown-menu-end notif-dropdown"
            :class="{ show: notifOpen }"
          >
            <div class="dropdown-header d-flex align-items-center justify-content-between">
              <h6 class="m-0 fw-bold">Notifications</h6>
              <a href="javascript:void(0);" class="small text-decoration-none">Mark all read</a>
            </div>
            <div class="notif-empty text-center py-4 px-3">
              <i class="ri-mail-check-line notif-empty-icon"></i>
              <p class="text-muted small mb-0 mt-2">You're all caught up.</p>
            </div>
          </div>
        </li>

        <!-- User -->
        <li class="dropdown position-relative">
          <button
            id="user-menu-btn"
            class="user-trigger"
            @click="toggleUser"
            :aria-expanded="userOpen ? 'true' : 'false'"
            aria-haspopup="true"
          >
            <span class="user-trigger-avatar">
              <img v-if="avatarUrl && !avatarFailed" :src="avatarUrl" alt="avatar" @error="avatarFailed = true" />
              <span v-else>{{ initials }}</span>
            </span>
            <span class="d-none d-lg-flex flex-column user-trigger-meta">
              <span class="user-trigger-name">{{ displayName }}</span>
              <span class="user-trigger-role">{{ roleLabel }}</span>
            </span>
            <i class="ri-arrow-down-s-line d-none d-lg-inline user-trigger-caret"></i>
          </button>

          <div
            id="user-menu"
            class="dropdown-menu dropdown-menu-end profile-dropdown"
            :class="{ show: userOpen }"
          >
            <div class="dropdown-header">
              <div class="fw-bold text-truncate">{{ displayName }}</div>
              <div class="small text-muted">{{ roleLabel }}</div>
            </div>

            <div class="dropdown-divider"></div>

            <a href="javascript:void(0);" class="dropdown-item">
              <i class="ri-user-smile-line me-2"></i>
              <span>My Account</span>
            </a>

            <a href="javascript:void(0);" class="dropdown-item">
              <i class="ri-user-settings-line me-2"></i>
              <span>Settings</span>
            </a>

            <a href="javascript:void(0);" class="dropdown-item">
              <i class="ri-lifebuoy-line me-2"></i>
              <span>Support</span>
            </a>

            <a href="javascript:void(0);" class="dropdown-item" @click.prevent="lockScreen">
              <i class="ri-lock-line me-2"></i>
              <span>Lock Screen</span>
            </a>

            <div class="dropdown-divider"></div>

            <a href="javascript:void(0);" class="dropdown-item text-danger" @click.prevent="handleLogout">
              <i class="ri-logout-circle-r-line me-2"></i>
              <span>Sign out</span>
            </a>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* Topbar icon buttons — pill ghost style */
.topbar-icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: var(--ct-topbar-item-color, #475569);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.15rem;
  transition: background-color 0.2s ease, color 0.2s ease, transform 0.15s ease;
  position: relative;
}
.topbar-icon-btn:hover {
  background: rgba(99, 102, 241, 0.08);
  color: #6366f1;
}
.topbar-icon-btn:active {
  transform: scale(0.96);
}

/* Notification dot */
.notif-dot {
  position: absolute;
  top: 9px;
  right: 9px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ef4444, #f59e0b);
  box-shadow: 0 0 0 2px var(--ct-topbar-bg, #fff);
}

/* Notification dropdown */
.notif-dropdown {
  width: 320px;
  padding: 0;
}
.notif-dropdown .dropdown-header {
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
}
.notif-empty-icon {
  font-size: 2rem;
  color: #cbd5e1;
}

/* Search input — relies on .app-search styles in overrides.css */
.app-search {
  min-width: 280px;
}
.app-search .search-icon {
  position: absolute;
  left: 0.85rem;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
  pointer-events: none;
  font-size: 1rem;
}
.app-search .search-kbd {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.68rem;
  font-weight: 600;
  background: rgba(15, 23, 42, 0.06);
  border: 1px solid rgba(15, 23, 42, 0.08);
  color: #64748b;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  align-items: center;
}

/* User trigger button */
.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.3rem 0.5rem 0.3rem 0.3rem;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}
.user-trigger:hover {
  background: rgba(99, 102, 241, 0.06);
  border-color: rgba(99, 102, 241, 0.18);
}
.user-trigger-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.82rem;
  color: #fff;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  box-shadow: 0 4px 10px rgba(99, 102, 241, 0.3);
  overflow: hidden;
}
.user-trigger-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.user-trigger-meta {
  text-align: left;
  line-height: 1.15;
}
.user-trigger-name {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--ct-body-color, #1e293b);
}
.user-trigger-role {
  font-size: 0.68rem;
  color: var(--ct-secondary-color, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}
.user-trigger-caret {
  color: #94a3b8;
  font-size: 1rem;
}

.profile-dropdown {
  min-width: 240px;
}
.profile-dropdown .dropdown-header {
  padding: 0.85rem 1rem 0.6rem;
}
</style>
