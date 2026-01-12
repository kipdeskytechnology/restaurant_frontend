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
// ----------------------------------------------

// -------- Role display (NEW: roles[]) ----------
const roleLabel = computed(() => {
  const roles = auth.me?.roles || [];
  if (!roles.length) return "User";

  const lower = roles.map((r) => String(r).toLowerCase());

  if (lower.includes("system_admin")) return "System Admin";
  if (lower.includes("super_admin") || lower.includes("superadmin") || lower.includes("super admin")) return "Super Admin";
  if (lower.includes("store_admin")) return "Store Admin";
  if (lower.includes("cashier")) return "Cashier";

  // fallback: show first role nicely
  const first = String(roles[0]);
  return first
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
  document.body.setAttribute("data-bs-theme", t); // safety

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

// Simple Vue dropdown (outside-click)
const userOpen = ref(false);
function toggleUser() {
  userOpen.value = !userOpen.value;
}
function onDocClick(e) {
  const btn = document.getElementById("user-menu-btn");
  const menu = document.getElementById("user-menu");
  if (!btn || !menu) return;
  if (!btn.contains(e.target) && !menu.contains(e.target)) userOpen.value = false;
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

// Lock screen action (safe even if route doesn't exist yet)
function lockScreen() {
  sset("locked", "1");
  try {
    localStorage.setItem("locked", "1");
  } catch {}
  try {
    new BroadcastChannel("lock-sync").postMessage({ type: "lock", value: 1 });
  } catch {}

  // If you don't have a lock route, this won't crash your app
  try {
    router.push({ name: "lock" });
  } catch {
    // optionally route somewhere else
    router.push({ name: "dashboard" }).catch(() => {});
  }
}

async function handleLogout() {
  await auth.logout();
  router.replace({ name: "login" });
}
</script>

<template>
  <div class="navbar-custom">
    <div class="topbar container-fluid">
      <div class="d-flex align-items-center gap-lg-2 gap-1">
        <!-- Topbar Brand Logo -->
        <div class="logo-topbar">
          <!-- Logo light -->
          <router-link to="/" class="logo-light">
            <span class="logo-lg">
              <img src="/src/assets/images/logo.png" alt="logo" />
            </span>
            <span class="logo-sm">
              <img src="/src/assets/images/logo-sm.png" alt="small logo" />
            </span>
          </router-link>

          <!-- Logo Dark -->
          <router-link to="/" class="logo-dark">
            <span class="logo-lg">
              <img src="/src/assets/images/logo-dark.png" alt="dark logo" />
            </span>
            <span class="logo-sm">
              <img src="/src/assets/images/logo-dark-sm.png" alt="small logo" />
            </span>
          </router-link>
        </div>

        <button class="button-toggle-menu" type="button" @click="toggleSidebar">
          <i class="ri-menu-5-line"></i>
        </button>
      </div>

      <ul class="topbar-menu d-flex align-items-center gap-3">
        <li class="d-none d-sm-inline-block">
          <div class="nav-link" id="light-dark-mode" @click="toggleTheme">
            <i class="ri-moon-line font-22"></i>
          </div>
        </li>

        <li class="d-none d-md-inline-block">
          <a class="nav-link" @click.prevent="toggleFullscreen" :title="isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'">
            <i :class="isFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'" class="font-22"></i>
          </a>
        </li>

        <li class="dropdown">
          <a
            id="user-menu-btn"
            class="nav-link dropdown-toggle arrow-none nav-user px-2"
            data-bs-toggle="dropdown"
            href="#"
            role="button"
            aria-haspopup="false"
            aria-expanded="false"
            @click.prevent="toggleUser"
          >
            <span class="account-user-avatar"></span>
            <span class="d-lg-flex flex-column gap-1 d-none">
              <h5 class="my-0">{{ auth.me?.first_name || auth.me?.username || "User" }}</h5>
              <h6 class="my-0 fw-normal">{{ roleLabel }}</h6>
            </span>
          </a>

          <div
            id="user-menu"
            class="dropdown-menu dropdown-menu-end dropdown-menu-animated profile-dropdown"
            :class="{ show: userOpen }"
          >
            <div class="dropdown-header noti-title">
              <h6 class="text-overflow m-0">Welcome !</h6>
            </div>

            <a href="javascript:void(0);" class="dropdown-item">
              <i class="ri-user-smile-line font-16 me-1"></i>
              <span>My Account</span>
            </a>

            <a href="javascript:void(0);" class="dropdown-item">
              <i class="ri-user-settings-line font-16 me-1"></i>
              <span>Settings</span>
            </a>

            <a href="javascript:void(0);" class="dropdown-item">
              <i class="ri-lifebuoy-line font-16 me-1"></i>
              <span>Support</span>
            </a>

            <a href="javascript:void(0);" class="dropdown-item" @click.prevent="lockScreen">
              <i class="ri-lock-line font-16 me-1"></i>
              <span>Lock Screen</span>
            </a>

            <a href="javascript:void(0);" class="dropdown-item" @click.prevent="handleLogout">
              <i class="ri-login-circle-line font-16 me-1"></i>
              <span>Logout</span>
            </a>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
