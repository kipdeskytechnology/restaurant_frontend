<script setup>
defineProps({ title: String, subtitle: { type: String, default: "" } });
</script>

<template>
  <div class="page-title-box" style="zoom: 80%">
    <div class="page-title-right">
      <ol class="breadcrumb m-0">
        <li class="breadcrumb-item"><a href="#">POS</a></li>
        <li class="breadcrumb-item active">{{ title }}</li>
      </ol>
    </div>
    <h4 class="page-title">{{ title }} <small v-if="subtitle" class="text-muted">— {{ subtitle }}</small></h4>
  </div>
</template>
