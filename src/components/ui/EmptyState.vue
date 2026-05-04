<script setup>
defineProps({
  icon: { type: String, default: "ri-inbox-line" },
  title: { type: String, default: "Nothing here yet" },
  message: { type: String, default: "" },
});
</script>

<template>
  <div class="text-center py-5 px-3">
    <i :class="icon" class="display-4 text-muted opacity-50"></i>
    <h5 class="mt-3 mb-1 text-body-secondary">{{ title }}</h5>
    <p v-if="message" class="text-muted small mb-3">{{ message }}</p>
    <slot />
  </div>
</template>
