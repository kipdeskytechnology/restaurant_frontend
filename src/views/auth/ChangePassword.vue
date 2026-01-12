<!-- src/views/auth/ChangePassword.vue -->
<script setup>
import { ref } from "vue";
import { useToast } from "vue-toastification";
import { changePassword } from "../../stores/auth";
import { useRouter } from "vue-router";

const toast = useToast();
const router = useRouter();

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
    await changePassword(form.value);
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
