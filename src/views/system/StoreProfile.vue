<!-- src/views/system/StoreProfile.vue -->
<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import {
  getMyStoreProfile,
  updateMyStoreProfile,
  uploadMyStoreLogo,
} from "../../api/systemStores";
import { runLowStockAlert } from "../../api/alerts";

const toast = useToast();

const loading = ref(true);
const saving = ref(false);
const testingAlert = ref(false);

const store = ref(null);
const logoFile = ref(null);
const logoPreview = ref("");
const logoImgLoading = ref(false);

let _objectUrl = "";

function setLogoPreviewFromFile(file) {
  if (_objectUrl) URL.revokeObjectURL(_objectUrl);
  const url = URL.createObjectURL(file);
  _objectUrl = url;
  logoImgLoading.value = true;
  const img = new Image();
  img.onload = () => { logoPreview.value = url; logoImgLoading.value = false; };
  img.onerror = () => { logoPreview.value = url; logoImgLoading.value = false; };
  img.src = url;
}

onBeforeUnmount(() => { if (_objectUrl) URL.revokeObjectURL(_objectUrl); });

const form = ref({
  code: "", name: "", tpin: "", phone: "", email: "",
  address: "", city: "", province: "", country: "",
  time_zone: "", currency_code: "", currency_symbol: "",
  tax_rate: "",
  bank_account_number: "", bank_name: "",
  website_url: "", facebook_url: "",
  store_type: "", motto: "", notes: "",
  require_recipe_for_orders: true,
  low_stock_alerts_enabled: false,
  low_stock_alert_hour: 8,
});

function fillForm(s) {
  form.value = {
    code: s.code || "", name: s.name || "", tpin: s.tpin || "",
    phone: s.phone || "", email: s.email || "",
    address: s.address || "", city: s.city || "", province: s.province || "", country: s.country || "",
    time_zone: s.time_zone || "",
    currency_code: s.currency_code || "", currency_symbol: s.currency_symbol || "",
    tax_rate: s.tax_rate ?? "",
    bank_account_number: s.bank_account_number || "", bank_name: s.bank_name || "",
    website_url: s.website_url || "", facebook_url: s.facebook_url || "",
    store_type: s.store_type || "", motto: s.motto || "", notes: s.notes || "",
    require_recipe_for_orders: s.require_recipe_for_orders ?? true,
    low_stock_alerts_enabled: !!s.low_stock_alerts_enabled,
    low_stock_alert_hour: typeof s.low_stock_alert_hour === "number" ? s.low_stock_alert_hour : 8,
  };
  logoPreview.value = s.logo_url ? resolveLogoUrl(s.logo_url) : "";
}

function resolveLogoUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  const base = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";
  return `${base}${url}`;
}

onMounted(async () => {
  loading.value = true;
  try {
    const data = await getMyStoreProfile();
    store.value = data;
    fillForm(data);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load store profile");
  } finally {
    loading.value = false;
  }
});

function onPickLogo(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  if (!f.type.startsWith("image/")) { toast.error("Please select an image file."); return; }
  logoFile.value = f;
  setLogoPreviewFromFile(f);
}

async function save() {
  saving.value = true;
  try {
    const payload = { ...form.value };
    if (payload.tax_rate === "") payload.tax_rate = null;
    else payload.tax_rate = Number(payload.tax_rate);

    const updated = await updateMyStoreProfile(payload);
    store.value = updated;

    if (logoFile.value) {
      const updated2 = await uploadMyStoreLogo(logoFile.value);
      store.value = updated2;
      logoFile.value = null;
      fillForm(updated2);
      toast.success("Store profile and logo updated");
      return;
    }
    fillForm(updated);
    toast.success("Store profile updated");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save store profile");
  } finally {
    saving.value = false;
  }
}

function displayLogoUrl() {
  if (logoPreview.value) return logoPreview.value;
  if (store.value?.logo_url) return resolveLogoUrl(store.value.logo_url);
  return "";
}

function clearSelectedLogo() {
  logoImgLoading.value = false;
  logoFile.value = null;
  if (_objectUrl) { URL.revokeObjectURL(_objectUrl); _objectUrl = ""; }
  logoPreview.value = store.value?.logo_url ? resolveLogoUrl(store.value.logo_url) : "";
}

async function uploadLogoOnly() {
  if (!logoFile.value) { toast.info("Please choose a logo first."); return; }
  saving.value = true;
  logoImgLoading.value = true;
  try {
    const updated = await uploadMyStoreLogo(logoFile.value);
    store.value = updated;
    logoFile.value = null;
    fillForm(updated);
    toast.success("Logo uploaded");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to upload logo");
  } finally {
    saving.value = false;
  }
}

async function sendTestAlert() {
  testingAlert.value = true;
  try {
    const r = await runLowStockAlert();
    const oos = r?.out_of_stock_count ?? 0;
    const low = r?.low_stock_count ?? 0;
    const sent = r?.emails_sent ?? 0;
    if (oos + low === 0) toast.success("Stock is healthy — no alert sent.");
    else toast.success(`Alert fired: ${oos} out, ${low} low · ${sent} email${sent === 1 ? '' : 's'} sent`);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to send test alert");
  } finally {
    testingAlert.value = false;
  }
}

function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "S";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-building-2-line"></i><span>System</span>
          </div>
          <h1 class="hero-title">Store Profile</h1>
          <p class="hero-sub">
            Identity, contact, locale, banking, and operational settings for your business. These values appear on receipts, reports, and customer-facing pages.
          </p>
        </div>

        <div class="page-hero-actions">
          <button v-can="'stores:manage'" class="btn btn-pill btn-cta" :disabled="saving" @click="save">
            <i class="ri-save-line"></i>
            <span v-if="saving">Saving…</span>
            <span v-else>Save changes</span>
          </button>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading store profile…</div>
        </div>
      </div>

      <div v-else class="row g-3 position-relative">
        <div v-if="saving" class="form-overlay">
          <div class="text-center">
            <span class="spinner-border"></span>
            <div class="small text-muted mt-2">Saving…</div>
          </div>
        </div>

        <!-- ============== LEFT: Form sections ============== -->
        <div class="col-lg-8">
          <!-- Identity -->
          <div class="card panel-card mb-3">
            <div class="panel-head">
              <div class="d-flex align-items-center gap-2">
                <span class="ns-icon"><i class="ri-id-card-line"></i></span>
                <div>
                  <div class="panel-eyebrow">Identity</div>
                  <div class="panel-title">Basic info</div>
                </div>
              </div>
            </div>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-md-4">
                  <label class="form-label">Store code</label>
                  <input v-model="form.code" class="form-control code-input" readonly />
                  <div class="form-text">Read-only — assigned at registration</div>
                </div>
                <div class="col-md-8">
                  <label class="form-label">Store name *</label>
                  <input v-model="form.name" class="form-control" placeholder="e.g. Kipdesky Restaurant" />
                </div>

                <div class="col-md-6">
                  <label class="form-label">Store type</label>
                  <input v-model="form.store_type" class="form-control" placeholder="Restaurant / Bar / Café" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Motto</label>
                  <input v-model="form.motto" class="form-control" placeholder="A short tagline" />
                </div>
              </div>
            </div>
          </div>

          <!-- Contact -->
          <div class="card panel-card mb-3">
            <div class="panel-head">
              <div class="d-flex align-items-center gap-2">
                <span class="ns-icon"><i class="ri-customer-service-2-line"></i></span>
                <div>
                  <div class="panel-eyebrow">Contact</div>
                  <div class="panel-title">Phone, email, web</div>
                </div>
              </div>
            </div>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label">Phone</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-phone-line"></i></span>
                    <input v-model="form.phone" class="form-control" placeholder="+260 …" />
                  </div>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Email</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-mail-line"></i></span>
                    <input v-model="form.email" type="email" class="form-control" placeholder="hello@kipdesky.com" />
                  </div>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Website</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-global-line"></i></span>
                    <input v-model="form.website_url" class="form-control" placeholder="https://kipdesky.com" />
                  </div>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Facebook</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-facebook-circle-line"></i></span>
                    <input v-model="form.facebook_url" class="form-control" placeholder="https://facebook.com/…" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Location -->
          <div class="card panel-card mb-3">
            <div class="panel-head">
              <div class="d-flex align-items-center gap-2">
                <span class="ns-icon"><i class="ri-map-pin-line"></i></span>
                <div>
                  <div class="panel-eyebrow">Location</div>
                  <div class="panel-title">Address &amp; locale</div>
                </div>
              </div>
            </div>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-12">
                  <label class="form-label">Address</label>
                  <textarea v-model="form.address" class="form-control" rows="2" placeholder="Street, area, building…"></textarea>
                </div>
                <div class="col-md-4">
                  <label class="form-label">City</label>
                  <input v-model="form.city" class="form-control" placeholder="Lusaka" />
                </div>
                <div class="col-md-4">
                  <label class="form-label">Province</label>
                  <input v-model="form.province" class="form-control" placeholder="Lusaka Province" />
                </div>
                <div class="col-md-4">
                  <label class="form-label">Country</label>
                  <input v-model="form.country" class="form-control" placeholder="Zambia" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Time zone</label>
                  <input v-model="form.time_zone" class="form-control code-input" placeholder="Africa/Lusaka" />
                  <div class="form-text">IANA tz name (e.g. <code>Africa/Lusaka</code>)</div>
                </div>
                <div class="col-md-3">
                  <label class="form-label">Currency code</label>
                  <input v-model="form.currency_code" class="form-control code-input" placeholder="ZMW" maxlength="3" />
                </div>
                <div class="col-md-3">
                  <label class="form-label">Currency symbol</label>
                  <input v-model="form.currency_symbol" class="form-control" placeholder="K" maxlength="3" />
                </div>
              </div>
            </div>
          </div>

          <!-- Tax & banking -->
          <div class="card panel-card mb-3">
            <div class="panel-head">
              <div class="d-flex align-items-center gap-2">
                <span class="ns-icon"><i class="ri-bank-line"></i></span>
                <div>
                  <div class="panel-eyebrow">Finance</div>
                  <div class="panel-title">Tax &amp; banking</div>
                </div>
              </div>
            </div>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label">TPIN</label>
                  <input v-model="form.tpin" class="form-control code-input" placeholder="1000123456" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Tax rate (%)</label>
                  <div class="input-group">
                    <input v-model="form.tax_rate" type="number" step="0.0001" class="form-control" placeholder="16" />
                    <span class="input-group-text">%</span>
                  </div>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Bank name</label>
                  <input v-model="form.bank_name" class="form-control" placeholder="Zanaco" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Bank account number</label>
                  <input v-model="form.bank_account_number" class="form-control code-input" placeholder="1234567890" />
                </div>
              </div>
            </div>
          </div>

          <!-- Operations -->
          <div class="card panel-card mb-3">
            <div class="panel-head">
              <div class="d-flex align-items-center gap-2">
                <span class="ns-icon"><i class="ri-settings-3-line"></i></span>
                <div>
                  <div class="panel-eyebrow">Operations</div>
                  <div class="panel-title">Behavior &amp; alerts</div>
                </div>
              </div>
            </div>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-12">
                  <div class="toggle-card">
                    <div>
                      <div class="fw-semibold">Require recipes for orders</div>
                      <div class="small text-muted">If on, items without a recipe can't be ordered. If off, missing recipes are silently ignored.</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input id="reqRecipe" v-model="form.require_recipe_for_orders" class="form-check-input" type="checkbox" />
                    </div>
                  </div>
                </div>

                <div class="col-12">
                  <div class="toggle-card">
                    <div>
                      <div class="d-flex align-items-center gap-2">
                        <i class="ri-notification-3-line text-warning"></i>
                        <div class="fw-semibold">Daily low-stock alerts</div>
                      </div>
                      <div class="small text-muted">Emails active staff and shows a Pusher banner if stock drops below par.</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input id="alertsOn" v-model="form.low_stock_alerts_enabled" class="form-check-input" type="checkbox" />
                    </div>
                  </div>
                </div>

                <div class="col-md-6">
                  <label class="form-label">
                    Alert hour
                    <span class="text-muted small">(0–23, store time)</span>
                  </label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="ri-time-line"></i></span>
                    <input
                      v-model.number="form.low_stock_alert_hour"
                      type="number"
                      min="0" max="23"
                      class="form-control"
                      :disabled="!form.low_stock_alerts_enabled"
                    />
                  </div>
                </div>

                <div class="col-md-6 d-flex align-items-end">
                  <button
                    type="button"
                    class="btn btn-soft-primary w-100"
                    :disabled="testingAlert"
                    @click="sendTestAlert"
                    title="Run the daily alert immediately for this store"
                  >
                    <span v-if="testingAlert" class="spinner-border spinner-border-sm me-1"></span>
                    <i v-else class="ri-send-plane-line me-1"></i>
                    {{ testingAlert ? 'Running…' : 'Send test alert now' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Notes -->
          <div class="card panel-card mb-3">
            <div class="panel-head">
              <div class="d-flex align-items-center gap-2">
                <span class="ns-icon"><i class="ri-sticky-note-line"></i></span>
                <div>
                  <div class="panel-eyebrow">Notes</div>
                  <div class="panel-title">Internal notes</div>
                </div>
              </div>
            </div>
            <div class="card-body">
              <textarea v-model="form.notes" class="form-control" rows="3" placeholder="Anything worth remembering — opening hours, holiday schedule, escalation contacts…"></textarea>
            </div>
          </div>

          <!-- Save row (sticky at bottom of form column) -->
          <div class="save-bar">
            <div class="small text-muted">
              <i class="ri-information-line me-1"></i>
              Changes are visible everywhere — receipts, reports, and customer-facing pages.
            </div>
            <button v-can="'stores:manage'" class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              <i v-else class="ri-save-line me-1"></i>
              Save changes
            </button>
          </div>
        </div>

        <!-- ============== RIGHT: Logo + identity card ============== -->
        <div class="col-lg-4">
          <div class="brand-card mb-3">
            <div class="brand-bg"></div>
            <div class="brand-body">
              <div class="brand-logo-wrap">
                <img v-if="displayLogoUrl()" :src="displayLogoUrl()" alt="Store logo" @load="logoImgLoading = false" />
                <div v-else class="brand-logo-fallback">{{ initialsOf(form.name || form.code) }}</div>
                <div v-if="logoImgLoading" class="brand-logo-loading">
                  <span class="spinner-border spinner-border-sm"></span>
                </div>
              </div>
              <div class="brand-name truncate" :title="form.name">{{ form.name || 'Untitled store' }}</div>
              <div class="brand-code" v-if="form.code">{{ form.code }}</div>
              <div class="brand-motto truncate" v-if="form.motto" :title="form.motto">{{ form.motto }}</div>
              <div class="brand-meta">
                <span class="brand-pill" v-if="form.currency_code">
                  <i class="ri-money-dollar-circle-line me-1"></i>{{ form.currency_code }}
                </span>
                <span class="brand-pill" v-if="form.country">
                  <i class="ri-earth-line me-1"></i>{{ form.country }}
                </span>
                <span class="brand-pill" v-if="form.time_zone" :title="form.time_zone">
                  <i class="ri-time-line me-1"></i>{{ form.time_zone }}
                </span>
              </div>
            </div>
          </div>

          <div class="card panel-card mb-3">
            <div class="panel-head">
              <div class="d-flex align-items-center gap-2">
                <span class="ns-icon"><i class="ri-image-line"></i></span>
                <div>
                  <div class="panel-eyebrow">Branding</div>
                  <div class="panel-title">Store logo</div>
                </div>
              </div>
            </div>
            <div class="card-body" v-can="'stores:manage'">
              <label class="logo-zone" :class="{ has: !!displayLogoUrl(), busy: saving || logoImgLoading }">
                <input type="file" class="d-none" accept="image/*" @change="onPickLogo" />
                <img v-if="displayLogoUrl()" :src="displayLogoUrl()" alt="logo preview" />
                <div v-else class="logo-placeholder">
                  <i class="ri-upload-cloud-2-line"></i>
                  <div class="small">Click to upload</div>
                </div>
                <div v-if="logoImgLoading" class="logo-loading">
                  <span class="spinner-border"></span>
                </div>
              </label>

              <div v-if="logoFile" class="d-flex flex-wrap gap-2 mt-3">
                <button type="button" class="btn btn-soft-primary btn-sm flex-grow-1" :disabled="saving" @click="uploadLogoOnly">
                  <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
                  <i v-else class="ri-upload-line me-1"></i>
                  Upload now
                </button>
                <button type="button" class="btn btn-light btn-sm" :disabled="saving" @click="clearSelectedLogo">
                  <i class="ri-close-line me-1"></i>Cancel
                </button>
              </div>

              <div v-if="logoFile" class="mt-2 small text-muted truncate" :title="logoFile.name">
                <i class="ri-attachment-line me-1"></i><strong>{{ logoFile.name }}</strong>
              </div>

              <div class="upload-hint mt-2">
                <i class="ri-information-line me-1"></i>
                PNG, JPG, or WebP — square works best. Will be uploaded with the next save, or instantly via "Upload now".
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
.rotating { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ============= Hero ============= */
.page-hero {
  position: relative;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem;
  padding: 1.5rem 1.75rem; margin-bottom: 1.25rem;
  border-radius: 22px;
  background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 50%, #06b6d4 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(29,78,216,0.55);
  overflow: hidden; flex-wrap: wrap;
}
.page-hero::before {
  content: ""; position: absolute; inset: 0;
  background:
    radial-gradient(220px 140px at 90% 10%, rgba(255,255,255,0.22), transparent 65%),
    radial-gradient(280px 180px at 0% 110%, rgba(255,255,255,0.14), transparent 65%);
  pointer-events: none;
}
.page-hero-text { position: relative; max-width: 700px; }
.eyebrow {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.25rem 0.65rem;
  background: rgba(255,255,255,0.18);
  border-radius: 999px;
  font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  margin-bottom: 0.6rem;
}
.hero-title { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.025em; font-size: 1.85rem; margin: 0; color: #fff; }
.hero-sub { color: rgba(255,255,255,0.85); margin: 0.35rem 0 0; font-size: 0.9rem; }
.page-hero-actions { position: relative; display: flex; gap: 0.5rem; flex-wrap: wrap; }
.btn-pill { border-radius: 999px !important; display: inline-flex; align-items: center; gap: 0.4rem; }
.btn-cta { background: #fff !important; color: #1d4ed8 !important; font-weight: 700; border: none; box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3); }
.btn-cta:hover { background: #fff !important; color: #1e3a8a !important; }
.btn-cta:disabled { opacity: 0.65; cursor: not-allowed; }

/* ============= Panel cards ============= */
.panel-card {
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.panel-head {
  padding: 0.85rem 1.25rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  background: linear-gradient(180deg, rgba(29,78,216,0.04), transparent);
}
.ns-icon {
  width: 36px; height: 36px;
  border-radius: 10px;
  display: grid; place-items: center;
  background: rgba(29,78,216,0.12); color: #1d4ed8;
  font-size: 1.05rem; flex-shrink: 0;
}
.panel-eyebrow { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #1d4ed8; }
.panel-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; letter-spacing: -0.02em;
  font-size: 0.95rem;
  color: var(--ct-body-color, #0f172a);
}

/* Code inputs (TPIN, currency, IANA tz, etc.) */
.code-input {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 600;
}
.code-input::placeholder { font-family: var(--ct-font-sans-serif, sans-serif); font-weight: 400; }
.form-text code { background: var(--ct-tertiary-bg, #f8fafc); padding: 0.05em 0.35em; border-radius: 4px; font-size: 0.85em; }

.toggle-card {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  background: var(--ct-tertiary-bg, #f8fafc);
}

.save-bar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 0.85rem 1.25rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px;
  box-shadow: 0 -10px 24px -16px rgba(15,23,42,0.18);
  flex-wrap: wrap;
}

/* ============= Brand card (right column) ============= */
.brand-card {
  position: relative;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 22px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.brand-bg {
  position: absolute; inset: 0 0 auto 0;
  height: 110px;
  background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 60%, #06b6d4 100%);
}
.brand-bg::after {
  content: "";
  position: absolute; inset: 0;
  background:
    radial-gradient(160px 100px at 80% 20%, rgba(255,255,255,0.22), transparent 65%),
    radial-gradient(200px 120px at 10% 100%, rgba(255,255,255,0.12), transparent 65%);
}
.brand-body {
  position: relative;
  padding: 1.25rem;
  text-align: center;
  padding-top: 70px;
}
.brand-logo-wrap {
  position: relative;
  width: 88px; height: 88px;
  margin: 0 auto 0.75rem;
  border-radius: 22px;
  overflow: hidden;
  background: var(--ct-card-bg, #fff);
  border: 4px solid var(--ct-card-bg, #fff);
  box-shadow: 0 12px 24px -10px rgba(15,23,42,0.3);
}
.brand-logo-wrap img { width: 100%; height: 100%; object-fit: contain; background: var(--ct-tertiary-bg, #f8fafc); }
.brand-logo-fallback {
  width: 100%; height: 100%;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 1.8rem;
  color: #1d4ed8;
  background: rgba(29,78,216,0.1);
  letter-spacing: -0.02em;
}
.brand-logo-loading {
  position: absolute; inset: 0;
  background: rgba(255,255,255,0.7);
  display: grid; place-items: center;
}
.brand-name {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 1.1rem;
  color: var(--ct-body-color, #0f172a);
  letter-spacing: -0.02em;
}
.brand-code {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.78rem; font-weight: 700;
  padding: 0.15rem 0.55rem;
  border-radius: 6px;
  background: rgba(29,78,216,0.1); color: #1d4ed8;
  display: inline-block;
  margin-top: 0.35rem;
}
.brand-motto {
  margin-top: 0.5rem;
  font-style: italic;
  font-size: 0.82rem;
  color: var(--ct-secondary-color, #64748b);
}
.brand-meta {
  margin-top: 0.85rem;
  display: flex; flex-wrap: wrap; gap: 0.35rem;
  justify-content: center;
}
.brand-pill {
  display: inline-flex; align-items: center;
  font-size: 0.7rem; font-weight: 600;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  color: var(--ct-secondary-color, #475569);
}
.brand-pill i { font-size: 0.85rem; }

/* ============= Logo dropzone ============= */
.logo-zone {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  max-height: 240px;
  border: 2px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 14px;
  background: var(--ct-tertiary-bg, #f8fafc);
  cursor: pointer;
  overflow: hidden;
  transition: all 0.15s ease;
}
.logo-zone:hover {
  border-color: #1d4ed8;
  background: rgba(29,78,216,0.04);
}
.logo-zone.has { border-style: solid; padding: 0.5rem; }
.logo-zone.busy { opacity: 0.7; cursor: wait; }
.logo-zone img { max-width: 100%; max-height: 100%; object-fit: contain; }
.logo-placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 0.4rem;
  color: var(--ct-secondary-color, #64748b);
}
.logo-placeholder i { font-size: 2rem; color: #1d4ed8; }
.logo-loading {
  position: absolute; inset: 0;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(2px);
  display: grid; place-items: center;
}

.upload-hint {
  font-size: 0.72rem;
  color: var(--ct-secondary-color, #94a3b8);
  padding-top: 0.5rem;
  border-top: 1px dashed var(--ct-border-color, #e6e9ef);
}

.truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

/* Form overlay (saving) */
.form-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: rgba(255,255,255,0.55);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  border-radius: 18px;
}

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
