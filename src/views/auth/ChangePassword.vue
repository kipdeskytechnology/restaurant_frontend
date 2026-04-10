<!-- src/views/auth/ChangePassword.vue -->
<script setup>
import { ref } from "vue";
import { useToast } from "vue-toastification";
import { useAuthStore } from "../../stores/auth";
import { useRouter } from "vue-router";

const toast = useToast();
const router = useRouter();
const auth = useAuthStore();

const saving = ref(false);
const showPw = ref(false);

const form = ref({
  current_password: "",
  new_password: ""
});

async function submit() {
  if (!form.value.current_password || !form.value.new_password) return;

  saving.value = true;
  try {
    await auth.changePassword(form.value);
    toast.success("Password changed successfully. Welcome!");
    router.replace({ name: "dashboard" });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to change password");
  } finally {
    saving.value = false;
  }
}
</script>


<template>
  <div class="min-vh-100 d-flex align-items-center justify-content-center px-3 auth-bg">
    <transition name="slide-fade" appear>
      <div class="auth-card card shadow-xl glass overflow-hidden">
        <div class="row g-0">
          <!-- Brand pane -->
          <div class="col-lg-6 d-none d-lg-flex align-items-stretch brand-pane">
            <div class="p-5 d-flex flex-column justify-content-between w-100">
              <div>
                <div class="d-flex align-items-center gap-2 mb-4">
                  <img src="/src/assets/images/logo.png" class="brand-logo" />
                  <span class="fw-semibold fs-5">KIPDESKY POS</span>
                </div>

                <p class="text-muted mb-4">
                  For security reasons, you must change your one-time password before continuing.
                </p>

                <ul class="list-unstyled small">
                  <li class="d-flex align-items-start mb-2">
                    <i class="ri-shield-check-line fs-5 me-2 text-success"></i>
                    Protect your account with a new password
                  </li>
                  <li class="d-flex align-items-start mb-2">
                    <i class="ri-lock-password-line fs-5 me-2 text-success"></i>
                    Passwords are securely encrypted
                  </li>
                  <li class="d-flex align-items-start">
                    <i class="ri-time-line fs-5 me-2 text-success"></i>
                    Takes less than a minute
                  </li>
                </ul>
              </div>

              <p class="text-muted small mb-0">
                Tip: choose a password you don’t use elsewhere.
              </p>
            </div>
          </div>

          <!-- Form pane -->
          <div class="col-lg-6">
            <div class="card-body p-4 p-lg-5 position-relative">
              <!-- Loading overlay -->
              <transition name="fade">
                <div
                  v-if="saving"
                  class="loading-overlay d-flex align-items-center justify-content-center"
                >
                  <div class="spinner-border" role="status"></div>
                </div>
              </transition>

              <div class="text-center mb-4 d-lg-none">
                <img src="/src/assets/images/logo.png" style="height: 44px" />
              </div>

              <div class="mb-4 text-center">
                <h2 class="h4 mb-1">Change Password</h2>
                <p class="text-muted small mb-0">
                  Please set a new password to continue to your dashboard
                </p>
              </div>

              <form @submit.prevent="submit" style="zoom: 85%">
                <!-- Current password -->
                <div class="mb-4">
                  <label class="form-label fw-medium">Current password</label>
                  <div class="input-group input-group-lg has-icon">
                    <span class="input-group-text">
                      <i class="ri-key-2-line"></i>
                    </span>
                    <input
                      v-model="form.current_password"
                      type="password"
                      class="form-control"
                      placeholder="One-time password"
                      required
                    />
                  </div>
                </div>

                <!-- New password -->
                <div class="mb-4">
                  <label class="form-label fw-medium">New password</label>
                  <div class="input-group input-group-lg has-icon">
                    <span class="input-group-text">
                      <i class="ri-lock-2-line"></i>
                    </span>
                    <input
                      :type="showPw ? 'text' : 'password'"
                      v-model="form.new_password"
                      class="form-control"
                      placeholder="Choose a new password"
                      minlength="4"
                      required
                    />
                    <button
                      type="button"
                      class="btn btn-light"
                      @click="showPw = !showPw"
                    >
                      <i :class="showPw ? 'ri-eye-off-line' : 'ri-eye-line'"></i>
                    </button>
                  </div>
                  <small class="text-muted">Minimum 4 characters.</small>
                </div>

                <!-- Submit -->
                <button
                  class="btn btn-primary btn-lg w-100 d-inline-flex align-items-center justify-content-center lift"
                  :disabled="saving"
                >
                  <span v-if="!saving" class="d-inline-flex align-items-center gap-2">
                    <i class="ri-check-line"></i> Change password
                  </span>
                  <span v-else class="d-inline-flex align-items-center gap-2">
                    <span class="spinner-border spinner-border-sm"></span>
                    Saving…
                  </span>
                </button>
              </form>

              <p class="text-center text-muted mt-4 small mb-0">
                Your password will be updated securely.
              </p>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

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