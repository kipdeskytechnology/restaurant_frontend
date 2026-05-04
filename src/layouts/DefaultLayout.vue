<script setup>
import Topbar from "./parts/Topbar.vue";
import Sidebar from "./parts/Sidebar.vue";
import Footer from "./parts/Footer.vue";
import { ref } from "vue";

const sidebarOpen = ref(true);
function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value;
}
function closeMobileSidebar() {
  document.documentElement.classList.remove("sidebar-enable");
}
</script>

<template>
  <div class="wrapper" :class="{ 'sidebar-collapsed': !sidebarOpen }">
    <Topbar @toggle="toggleSidebar" style="zoom: 80%" />

    <Sidebar />

    <div class="content-page">
      <div class="content">
        <div class="container-fluid">
          <slot />
        </div>
      </div>

      <Footer style="zoom: 80%" />
    </div>

    <div class="app-mobile-backdrop" @click="closeMobileSidebar"></div>
  </div>
</template>

<style scoped>
.app-mobile-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px);
  z-index: 1030;
}
:global(html.sidebar-enable) .app-mobile-backdrop {
  display: block;
}
</style>
