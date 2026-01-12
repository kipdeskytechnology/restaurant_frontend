<!-- src/views/auth/Login.vue -->
<template>
  <div class="min-vh-100 d-flex align-items-center justify-content-center px-3 auth-bg">
    <transition name="slide-fade" appear>
      <div class="auth-card card shadow-xl glass overflow-hidden" key="card">
        <div class="row g-0">
          <!-- Brand / Feature pane -->
          <div class="col-lg-6 d-none d-lg-flex align-items-stretch brand-pane">
            <div class="p-5 d-flex flex-column justify-content-between w-100">
              <div>
                <div class="d-flex align-items-center gap-2 mb-4">
                  <img src="/src/assets/images/logo.png" alt="Logo" class="brand-logo" />
                  <span class="fw-semibold fs-5">KIPDESKY POS</span>
                </div>
                <br /><br />
                <p class="text-muted mb-4">
                  Sign in to access your dashboard and keep operations moving.
                </p>
                <ul class="list-unstyled small mb-0">
                  <li class="d-flex align-items-start mb-2">
                    <i class="ri-sparkling-line fs-5 me-2 text-success"></i>
                    Role-aware access & idle lock
                  </li>
                  <li class="d-flex align-items-start mb-2">
                    <i class="ri-sparkling-line fs-5 me-2 text-success"></i>
                    Secure sessions with “Remember me”
                  </li>
                  <li class="d-flex align-items-start">
                    <i class="ri-sparkling-line fs-5 me-2 text-success"></i>
                    Fast, keyboard-friendly sign in
                  </li>
                </ul>
              </div>
              <p class="text-muted mt-4 small mb-0">
                Tip: you can lock the app any time from the user menu.
              </p>
            </div>
          </div>

          <!-- Form pane -->
          <div class="col-lg-6">
            <div class="card-body p-4 p-lg-5 position-relative">
              <!-- Loading overlay -->
              <transition name="fade">
                <div v-if="loading" class="loading-overlay d-flex align-items-center justify-content-center">
                  <div class="spinner-border" role="status" aria-label="Signing in"></div>
                </div>
              </transition>

              <div class="text-center mb-4 d-lg-none">
                <img src="/src/assets/images/logo.png" alt="logo" style="height: 44px" />
              </div>

              <div class="mb-3 text-center">
                <h2 class="h4 mb-1">Sign in</h2>
                <p class="text-muted mb-0 small">
                  Use your identifier (email / username / phone) to continue
                  <span v-if="redirectText" class="d-block mt-1">
                    <i class="ri-arrow-right-line align-middle"></i>
                    You’ll go to <code class="text-body-secondary">{{ redirectText }}</code>
                  </span>
                </p>
              </div>

              <form
                style="zoom: 80%"
                @submit.prevent="onSubmit"
                novalidate
                class="needs-validation"
                :class="{ 'was-validated': triedSubmit }"
              >
                <!-- Identifier -->
                <div class="mb-4">
                  <label for="identifier" class="form-label fw-medium">Identifier</label>
                  <div class="input-group input-group-lg has-icon">
                    <span class="input-group-text" id="id-addon" aria-hidden="true">
                      <i class="ri-user-3-line"></i>
                    </span>
                    <input
                      ref="identifierRef"
                      id="identifier"
                      v-model.trim="identifier"
                      type="text"
                      class="form-control"
                      required
                      autocomplete="username"
                      aria-describedby="id-addon"
                      placeholder="email / username / phone"
                    />
                    <div class="invalid-feedback">Identifier is required.</div>
                  </div>
                </div>

                <!-- Password -->
                <div class="mb-4">
                  <label for="password" class="form-label fw-medium">Password</label>
                  <div class="input-group input-group-lg has-icon">
                    <span class="input-group-text" id="pw-addon" aria-hidden="true">
                      <i class="ri-lock-2-line"></i>
                    </span>
                    <input
                      id="password"
                      :type="showPw ? 'text' : 'password'"
                      v-model="password"
                      class="form-control"
                      required
                      autocomplete="current-password"
                      aria-describedby="pw-addon pw-toggle"
                      @keyup="checkCaps"
                      @keydown="checkCaps"
                      placeholder="Your password"
                    />
                    <button
                      id="pw-toggle"
                      type="button"
                      class="btn btn-light"
                      :aria-pressed="showPw ? 'true' : 'false'"
                      :aria-label="showPw ? 'Hide password' : 'Show password'"
                      @click="toggleShowPw"
                    >
                      <i :class="showPw ? 'ri-eye-off-line' : 'ri-eye-line'"></i>
                    </button>
                    <div class="invalid-feedback">Password is required.</div>
                  </div>
                </div>

                <!-- Caps Lock notice -->
                <transition name="fade">
                  <div
                    v-if="capsOn"
                    class="alert alert-warning py-2 px-3 mb-2 small d-flex align-items-center"
                    role="alert"
                  >
                    <i class="ri-alert-line me-2"></i> Caps Lock is ON
                  </div>
                </transition>

                <!-- Error -->
                <transition name="fade">
                  <div
                    v-if="error"
                    class="alert alert-danger py-2 px-3 mb-3 small d-flex align-items-center"
                    role="alert"
                  >
                    <i class="ri-error-warning-line me-2"></i> {{ error }}
                  </div>
                </transition>

                <div class="d-flex align-items-center justify-content-between mb-4">
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="remember" v-model="remember" />
                    <label class="form-check-label" for="remember">Remember me</label>
                  </div>

                  <!-- Safe: only render if route exists -->
                  <router-link
                    v-if="hasForgot"
                    class="small text-decoration-none"
                    :to="{ name: 'forgot' }"
                  >
                    Forgot password?
                  </router-link>

                  <a v-else class="small text-decoration-none text-muted" href="javascript:void(0)">
                    Forgot password?
                  </a>
                </div>

                <!-- Primary: Sign in -->
                <button
                  class="btn btn-primary btn-lg w-100 d-inline-flex align-items-center justify-content-center lift"
                  :disabled="loading"
                >
                  <span v-if="!loading" class="d-inline-flex align-items-center gap-2">
                    <i class="ri-login-circle-line"></i> Sign in
                  </span>
                  <span v-else class="d-inline-flex align-items-center gap-2">
                    <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                    Signing you in…
                  </span>
                </button>

                <!-- Secondary: Register (optional) -->
                <router-link
                  v-if="hasRegister"
                  to="/register"
                  class="btn btn-outline-secondary btn-lg w-100 d-inline-flex align-items-center justify-content-center mt-3 lift"
                  :class="{ disabled: loading }"
                >
                  <i class="ri-user-add-line me-2"></i> Create an account
                </router-link>
              </form>

              <p class="text-center text-muted mt-4 mb-0 small">
                By continuing you agree to our terms & policies.
              </p>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "../../stores/auth"; // ✅ your path

const identifier = ref("");
const password = ref("");
const remember = ref(true);

const showPw = ref(false);
const capsOn = ref(false);
const triedSubmit = ref(false);

const identifierRef = ref(null);

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const loading = ref(false);
const error = ref("");

const redirectText = computed(() => {
  const r = route.query.redirect ? String(route.query.redirect) : "";
  return r && r !== "/" ? r : "";
});

// ✅ avoid broken router-link if you don't have these routes yet
const hasForgot = computed(() => router.hasRoute("forgot"));
const hasRegister = computed(() => router.hasRoute("register"));

function toggleShowPw() {
  showPw.value = !showPw.value;
}

function checkCaps(e) {
  if (e && typeof e.getModifierState === "function") {
    capsOn.value = !!e.getModifierState("CapsLock");
  }
}

onMounted(() => {
  try {
    identifierRef.value?.focus();
  } catch {}
});

async function onSubmit() {
  triedSubmit.value = true;
  error.value = "";

  if (!identifier.value || !password.value) return;

  loading.value = true;
  try {
    // ✅ your store signature: login(identifier, password)
    // We'll pass remember as 3rd param (we'll add it in the store below)
    const r = await auth.login(identifier.value.trim(), password.value, remember.value);

    // if backend sets must_change_password, your router guard already forces change-password
    if (r?.must_change_password) {
      router.replace({ name: "change-password" });
      return;
    }

    const redirect = route.query.redirect ? String(route.query.redirect) : "/";
    router.replace(redirect);
  } catch (e) {
    error.value = e?.response?.data?.detail || e?.message || "Login failed";
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