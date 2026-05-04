// src/main.js
import { createApp } from "vue";
import { createPinia } from "pinia";
import Toast from "vue-toastification";
import "vue-toastification/dist/index.css";
import "remixicon/fonts/remixicon.css";
import VueApexCharts from "vue3-apexcharts";

import App from "./App.vue";
import router from "./router";
import "./styles/overrides.css";
import { useAuthStore } from "./stores/auth";

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(VueApexCharts);

// v-can="'menu:read'"  → element rendered only if current user has the perm
// v-can="['menu:read','menu:manage']" → any-of
// Hides via display:none rather than unmounting so transitions don't break.
app.directive("can", {
  mounted(el, binding) {
    const auth = useAuthStore();
    if (!auth.can(binding.value)) el.style.display = "none";
  },
  updated(el, binding) {
    const auth = useAuthStore();
    el.style.display = auth.can(binding.value) ? "" : "none";
  },
});

app.use(Toast, {
  position: "top-right",
  timeout: 2500,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
});

app.mount("#app");