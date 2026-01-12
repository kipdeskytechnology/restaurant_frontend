<script setup>
import Topbar from "./parts/Topbar.vue";
import Sidebar from "./parts/Sidebar.vue";
import Footer from "./parts/Footer.vue";
import { ref } from "vue";

const sidebarOpen = ref(true);
function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value;
}
</script>

<template>
  <div class="wrapper" :class="{ 'sidebar-collapsed': !sidebarOpen }">
    <!-- Topbar -->
    <Topbar @toggle="toggleSidebar" style="zoom: 80%" />

    <!-- Left Sidebar -->
    <Sidebar />

    <!-- Page Content -->
    <div class="content-page">
      <div class="content">
        

        <!-- Main content slot -->
        <div class="container-fluid">
          <slot />
        </div>
      </div>

      <!-- Footer -->
      <Footer style="zoom: 80%" />
    </div>
  </div>
</template>
