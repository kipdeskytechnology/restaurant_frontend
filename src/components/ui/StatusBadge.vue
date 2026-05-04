<script setup>
defineProps({
  tone: {
    type: String,
    default: "default",
    validator: (v) => ["default", "success", "warning", "danger", "info", "primary"].includes(v),
  },
  pill: { type: Boolean, default: true },
});

const map = {
  default: "bg-secondary-subtle text-secondary-emphasis",
  primary: "bg-primary-subtle text-primary-emphasis",
  success: "bg-success-subtle text-success-emphasis",
  warning: "bg-warning-subtle text-warning-emphasis",
  danger:  "bg-danger-subtle text-danger-emphasis",
  info:    "bg-info-subtle text-info-emphasis",
};
</script>

<template>
  <span class="badge fw-semibold" :class="[map[tone], pill ? 'rounded-pill' : '']">
    <slot />
  </span>
</template>
