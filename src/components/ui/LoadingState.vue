<script setup>
defineProps({
  label: { type: String, default: "Loading…" },
  inline: { type: Boolean, default: false },
});
</script>

<template>
  <div v-if="inline" class="d-inline-flex align-items-center gap-2 text-muted">
    <span class="spinner-border spinner-border-sm" role="status"></span>
    <span class="small">{{ label }}</span>
  </div>
  <div v-else class="text-center py-5 text-muted">
    <span class="spinner-border" role="status"></span>
    <div class="small mt-2">{{ label }}</div>
  </div>
</template>
