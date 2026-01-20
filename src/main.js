// src/main.js
import { createApp } from "vue";
import { createPinia } from "pinia";
import Toast from "vue-toastification";
import "vue-toastification/dist/index.css";
import "remixicon/fonts/remixicon.css";
import VueApexCharts from "vue3-apexcharts";

import App from "./App.vue";
import router from "./router";

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(VueApexCharts);

app.use(Toast, {
  position: "top-right",
  timeout: 2500,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
});

app.mount("#app");