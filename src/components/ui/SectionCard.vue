<script setup>
defineProps({
  title: { type: String, default: "" },
  subtitle: { type: String, default: "" },
  icon: { type: String, default: "" },
  noBody: { type: Boolean, default: false },
});
</script>

<template>
  <div class="card section-card h-100">
    <div v-if="title || $slots.actions" class="card-header bg-light d-flex align-items-center justify-content-between">
      <div class="d-flex align-items-center gap-2">
        <i v-if="icon" :class="icon" class="text-primary fs-5"></i>
        <div>
          <h5 class="mb-0">{{ title }}</h5>
          <div v-if="subtitle" class="small text-muted">{{ subtitle }}</div>
        </div>
      </div>
      <div class="d-flex align-items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <div v-if="!noBody" class="card-body">
      <slot />
    </div>
    <slot v-else />
  </div>
</template>

<style scoped>
.section-card {
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 0.75rem;
}
.section-card .card-header {
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: 0.75rem 0.75rem 0 0;
}
</style>
