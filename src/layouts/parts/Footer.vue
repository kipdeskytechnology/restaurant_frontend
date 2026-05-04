<script setup>
import { computed } from "vue";
const year = computed(() => new Date().getFullYear());
</script>

<template>
  <footer class="footer app-footer">
    <div class="container-fluid">
      <div class="row align-items-center g-2">
        <div class="col-md-6 d-flex align-items-center gap-2">
          <span class="footer-brand-dot"></span>
          <span class="footer-text">
            {{ year }} &copy; <strong>Kipdesky POS</strong> &mdash; Restaurant
          </span>
        </div>
        <div class="col-md-6">
          <div class="text-md-end footer-links d-none d-md-block">
            <router-link class="me-3" to="/about">About</router-link>
            <router-link class="me-3" to="/support">Support</router-link>
            <router-link to="/contact">Contact</router-link>
          </div>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.app-footer {
  border-top: 1px solid var(--ct-border-color, #e6e9ef);
  background: transparent;
  padding: 1rem 1.5rem;
  font-size: 0.8125rem;
  color: var(--ct-secondary-color, #64748b);
}

.footer-brand-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  display: inline-block;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}

.footer-text strong {
  color: var(--ct-body-color, #1e293b);
  font-weight: 700;
}

.footer-links a {
  color: var(--ct-secondary-color, #64748b);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s ease;
}
.footer-links a:hover {
  color: var(--ct-primary, #6366f1);
}
</style>
