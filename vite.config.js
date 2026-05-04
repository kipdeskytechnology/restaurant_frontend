/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx,vue}'],
    css: false,
  },
  build: {
    // Static manualChunks split the bundle into long-lived vendor caches.
    // Browsers reuse them across deploys when the app code changes but
    // the deps don't. Each cluster groups libs that ship together to
    // avoid double-loading shared internals.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-net': ['axios', 'jwt-decode'],
          'vendor-charts': ['apexcharts', 'vue3-apexcharts'],
          // PDF/canvas tooling is huge — only loaded by screens that export PDFs.
          'vendor-pdf': ['jspdf', 'jspdf-autotable'],
          'vendor-toast': ['vue-toastification'],
          'vendor-realtime': ['pusher-js'],
        },
      },
    },
    // Bump the noisy warning threshold above the legitimate jspdf chunk
    // so CI doesn't flag a known-and-accepted bundle size.
    chunkSizeWarningLimit: 600,
  },
})
