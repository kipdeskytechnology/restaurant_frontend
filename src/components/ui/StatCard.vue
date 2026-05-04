<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  hint: { type: String, default: "" },
  icon: { type: String, default: "" },
  tone: {
    type: String,
    default: "default",
    validator: (v) => ["default", "success", "warning", "danger", "info"].includes(v),
  },
  loading: { type: Boolean, default: false },
});

const toneClassMap = {
  default: { bg: "bg-light", icon: "text-secondary" },
  success: { bg: "bg-success-subtle", icon: "text-success" },
  warning: { bg: "bg-warning-subtle", icon: "text-warning" },
  danger:  { bg: "bg-danger-subtle",  icon: "text-danger" },
  info:    { bg: "bg-info-subtle",    icon: "text-info" },
};
</script>

<template>
  <div class="card stat-card h-100">
    <div class="card-body d-flex align-items-center gap-3">
      <div
        v-if="icon"
        class="d-flex align-items-center justify-content-center rounded-circle stat-icon"
        :class="toneClassMap[tone].bg"
      >
        <i :class="[icon, 'fs-3', toneClassMap[tone].icon]"></i>
      </div>
      <div class="flex-grow-1">
        <div class="text-muted small text-uppercase fw-semibold">{{ label }}</div>
        <div class="fs-3 fw-bold mt-1">
          <span v-if="loading" class="placeholder col-6"></span>
          <span v-else>{{ value }}</span>
        </div>
        <div v-if="hint" class="small text-muted mt-1">{{ hint }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stat-card {
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 0.75rem;
  transition: box-shadow 0.15s ease;
}
.stat-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}
.stat-icon {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
}
</style>
