<template>
  <div class="min-vh-100 d-flex align-items-center justify-content-center px-3 auth-bg">
    <transition name="slide-fade" appear>
      <div class="auth-card card shadow-xl glass overflow-hidden">
        <div class="row g-0">
          <div class="col-lg-6 d-none d-lg-flex align-items-stretch brand-pane">
            <div class="p-5 d-flex flex-column justify-content-between w-100">
              <div>
                <div class="d-flex align-items-center gap-2 mb-4">
                  <img src="/src/assets/images/logo.png" alt="Logo" class="brand-logo" />
                  <span class="fw-semibold fs-5">KIPDESKY POS</span>
                </div>
                <p class="text-muted mb-0">
                  Set a new password for your account.
                </p>
              </div>
              <p class="text-muted small mb-0">Choose a strong password (min 8 chars).</p>
            </div>
          </div>

          <div class="col-lg-6">
            <div class="card-body p-4 p-lg-5 position-relative">
              <transition name="fade">
                <div v-if="loading" class="loading-overlay d-flex align-items-center justify-content-center">
                  <div class="spinner-border" role="status" aria-label="Resetting"></div>
                </div>
              </transition>

              <div class="mb-3 text-center">
                <h2 class="h4 mb-1">Reset password</h2>
                <p class="text-muted mb-0 small">Enter your new password.</p>
              </div>

              <form style="zoom: 80%" @submit.prevent="onSubmit" novalidate class="needs-validation" :class="{ 'was-validated': triedSubmit }">
                <div class="mb-3">
                  <label class="form-label fw-medium">New password</label>
                  <div class="input-group input-group-lg has-icon">
                    <span class="input-group-text"><i class="ri-lock-2-line"></i></span>
                    <input v-model="newPassword" class="form-control" :type="showPw ? 'text' : 'password'" required minlength="8" />
                    <button type="button" class="btn btn-light" @click="showPw = !showPw">
                      <i :class="showPw ? 'ri-eye-off-line' : 'ri-eye-line'"></i>
                    </button>
                    <div class="invalid-feedback">Minimum 4 characters.</div>
                  </div>
                </div>

                <div class="mb-4">
                  <label class="form-label fw-medium">Confirm password</label>
                  <div class="input-group input-group-lg has-icon">
                    <span class="input-group-text"><i class="ri-lock-password-line"></i></span>
                    <input v-model="confirmPassword" class="form-control" :type="showPw ? 'text' : 'password'" required />
                    <div class="invalid-feedback">Confirmation is required.</div>
                  </div>
                </div>

                <transition name="fade">
                  <div v-if="error" class="alert alert-danger py-2 px-3 small d-flex align-items-center">
                    <i class="ri-error-warning-line me-2"></i> {{ error }}
                  </div>
                </transition>

                <transition name="fade">
                  <div v-if="message" class="alert alert-success py-2 px-3 small d-flex align-items-center">
                    <i class="ri-checkbox-circle-line me-2"></i> {{ message }}
                  </div>
                </transition>

                <button class="btn btn-primary btn-lg w-100 lift" :disabled="loading">
                  <span v-if="!loading"><i class="ri-check-line me-2"></i> Update password</span>
                  <span v-else class="d-inline-flex align-items-center gap-2">
                    <span class="spinner-border spinner-border-sm"></span> Updating…
                  </span>
                </button>

                <router-link class="btn btn-outline-secondary btn-lg w-100 mt-3 lift" :class="{ disabled: loading }" :to="{ name: 'login' }">
                  <i class="ri-arrow-left-line me-2"></i> Back to login
                </router-link>
              </form>
            </div>
          </div>

        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const token = ref(route.query.token ? String(route.query.token) : "");
const newPassword = ref("");
const confirmPassword = ref("");

const showPw = ref(false);
const triedSubmit = ref(false);
const loading = ref(false);
const error = ref("");
const message = ref("");

async function onSubmit() {
  triedSubmit.value = true;
  error.value = "";
  message.value = "";

  if (!token.value) {
    error.value = "Reset token is missing.";
    return;
  }
  if (!newPassword.value || newPassword.value.length < 4) return;
  if (newPassword.value !== confirmPassword.value) {
    error.value = "Passwords do not match.";
    return;
  }

  loading.value = true;
  try {
    await auth.resetPassword(token.value, newPassword.value);
    message.value = "Password updated successfully. Redirecting to login…";
    setTimeout(() => router.replace({ name: "login" }), 900);
  } catch (e) {
    error.value = e?.response?.data?.detail || e?.message || "Reset failed";
  } finally {
    loading.value = false;
  }
}
</script>


<style scoped>
:root {
  --glass-bg: rgba(255, 255, 255, 0.65);
  --glass-border: rgba(255, 255, 255, 0.35);
  --bg-top: #f7f7fb;
  --bg-bot: #eef1f7;
}

@media (prefers-color-scheme: dark) {
  :root {
    --glass-bg: rgba(20, 22, 27, 0.55);
    --glass-border: rgba(255, 255, 255, 0.08);
    --bg-top: #0f1117;
    --bg-bot: #0b0d12;
  }
}

/* ==== Card sizing to fit viewport ==== */
.auth-card {
  max-width: 960px;
  width: 100%;
  max-height: calc(100svh - 2rem); /* keep whole card on screen */
  border-radius: 1.25rem;
}

/* Hide brand pane on short screens to save vertical space */
@media (max-height: 720px) {
  .brand-pane { display: none !important; }
  .auth-card { max-width: 560px; } /* narrower when brand pane hidden */
}

/* Compact paddings for shorter devices */
@media (max-height: 640px) {
  .card-body { padding: 1.25rem !important; }
}

/* ==== Glass effect and subtle micro-interactions ==== */
.glass {
  background: var(--glass-bg);
  backdrop-filter: saturate(140%) blur(14px);
  border: 1px solid var(--glass-border);
}

.input-group-text,
.form-control {
  font-size: 0.875rem; /* 14px */
}
.form-control,
.btn { border-radius: 0.8rem; }

.form-control:focus {
  box-shadow: 0 0 0 0.25rem rgba(99, 102, 241, 0.15);
}

/* Lift effect on buttons */
.lift { transition: transform .08s ease, box-shadow .2s ease; }
.lift:hover { transform: translateY(-2px); }
.lift:active { transform: translateY(0); }

.btn-primary {
  border: 0;
  box-shadow: 0 10px 28px rgba(13, 110, 253, 0.28);
}

/* Input with leading icon */
.input-group.has-icon .input-group-text { border-right: 0; }
.input-group.has-icon .form-control { border-left: 0; }

/* ==== Loading overlay ==== */
.loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(6px);
  border-radius: inherit;
  z-index: 5;
}
@media (prefers-color-scheme: dark) {
  .loading-overlay { background: rgba(0,0,0,0.45); }
}

/* ==== Animations ==== */
@keyframes bgMove {
  0%   { background-position: 0% 0%, 100% 0%, 0% 0%; }
  100% { background-position: 20% 10%, 80% 20%, 0% 100%; }
}

.slide-fade-enter-active { transition: opacity .35s ease, transform .35s ease; }
.slide-fade-enter-from { opacity: 0; transform: translateY(16px) scale(0.98); }

.fade-enter-active, .fade-leave-active { transition: opacity .2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Utility */
.fw-medium { font-weight: 600; }
.shadow-xl { box-shadow: 0 20px 70px rgba(0, 0, 0, 0.18); }

.brand-pane {
  background:
    radial-gradient(600px 300px at 10% 110%, rgba(99, 102, 241, 0.25), transparent 60%),
    radial-gradient(800px 400px at 100% 0%, rgba(16, 185, 129, 0.2), transparent 50%),
    linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(16, 185, 129, 0.12));
  border-right: 1px solid var(--glass-border);
}

.brand-logo { height: 50px; width: auto; }
</style>