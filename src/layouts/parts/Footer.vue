<script setup>
import { computed } from 'vue'
const year = computed(() => new Date().getFullYear())
</script>

<template>
  <footer class="footer">
      <div class="container-fluid">
          <div class="row">
              <div class="col-md-6">
                  {{ year }} © POS - Kipdesky Technology (Z), LTD
              </div>
              <div class="col-md-6">
                  <div class="text-md-end footer-links d-none d-md-block">
                      <router-link class="me-3" to="/about">About</router-link>
                      <router-link class="me-3" to="/support">Support</router-link>
                      <router-link to="/contact">Contact Us</router-link>
                  </div>
              </div>
          </div>
      </div>
  </footer>
</template>