<template>
  <DefaultLayout>
    <h2>Dashboard</h2>

    <div v-if="auth.me" style="margin-top:12px;">
      <p><strong>User:</strong> {{ auth.me.email || auth.me.username }}</p>
      <p><strong>Store ID:</strong> {{ auth.me.store_id }}</p>
      <p><strong>Outlet ID:</strong> {{ auth.me.outlet_id ?? "-" }}</p>

      <h3 style="margin-top:18px;">Roles</h3>
      <ul>
        <li v-for="r in auth.me.roles" :key="r">{{ r }}</li>
      </ul>

      <h3 style="margin-top:18px;">Permissions</h3>
      <ul>
        <li v-for="p in auth.me.permissions" :key="p">{{ p }}</li>
      </ul>
    </div>
  </DefaultLayout>
</template>

<script setup>
import { useAuthStore } from "../stores/auth";
import DefaultLayout from "../layouts/DefaultLayout.vue";

const auth = useAuthStore();
</script>
