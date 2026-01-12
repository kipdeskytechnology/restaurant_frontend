<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import {
  getMyStoreProfile,
  updateMyStoreProfile,
  uploadMyStoreLogo,
} from "../../api/systemStores";

const toast = useToast();

const loading = ref(true);
const saving = ref(false);

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
  img.onload = () => {
    logoPreview.value = url;
    logoImgLoading.value = false;
  };
  img.onerror = () => {
    logoPreview.value = url;
    logoImgLoading.value = false;
  };
  img.src = url;
}

onBeforeUnmount(() => {
  if (_objectUrl) URL.revokeObjectURL(_objectUrl);
});

const form = ref({
  code: "",
  name: "",
  tpin: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  province: "",
  country: "",
  time_zone: "",
  currency_code: "",
  currency_symbol: "",
  tax_rate: "",
  bank_account_number: "",
  bank_name: "",
  website_url: "",
  facebook_url: "",
  store_type: "",
  motto: "",
  notes: "",
});

function fillForm(s) {
  form.value = {
    code: s.code || "",
    name: s.name || "",
    tpin: s.tpin || "",
    phone: s.phone || "",
    email: s.email || "",
    address: s.address || "",
    city: s.city || "",
    province: s.province || "",
    country: s.country || "",
    time_zone: s.time_zone || "",
    currency_code: s.currency_code || "",
    currency_symbol: s.currency_symbol || "",
    tax_rate: s.tax_rate ?? "",
    bank_account_number: s.bank_account_number || "",
    bank_name: s.bank_name || "",
    website_url: s.website_url || "",
    facebook_url: s.facebook_url || "",
    store_type: s.store_type || "",
    motto: s.motto || "",
    notes: s.notes || "",
  };

  logoPreview.value = s.logo_url ? resolveLogoUrl(s.logo_url) : "";
}

function resolveLogoUrl(url) {
  // if backend returns "/uploads/..", make it absolute for browser
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

  if (!f.type.startsWith("image/")) {
    toast.error("Please select an image file.");
    return;
  }

  logoFile.value = f;
  setLogoPreviewFromFile(f);
}

async function save() {
  saving.value = true;
  try {
    // 1) update normal fields
    const payload = { ...form.value };

    // normalize numeric tax_rate
    if (payload.tax_rate === "") payload.tax_rate = null;
    else payload.tax_rate = Number(payload.tax_rate);

    const updated = await updateMyStoreProfile(payload);
    store.value = updated;

    // 2) upload logo if selected
    if (logoFile.value) {
      const updated2 = await uploadMyStoreLogo(logoFile.value);
      store.value = updated2;
      logoFile.value = null;
      fillForm(updated2);
      toast.success("Store profile + logo updated.");
      return;
    }

    fillForm(updated);
    toast.success("Store profile updated.");
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

  if (_objectUrl) {
    URL.revokeObjectURL(_objectUrl);
    _objectUrl = "";
  }

  logoPreview.value = store.value?.logo_url ? resolveLogoUrl(store.value.logo_url) : "";
}

async function uploadLogoOnly() {
  if (!logoFile.value) {
    toast.info("Please choose a logo first.");
    return;
  }

  saving.value = true;
  logoImgLoading.value = true;
  try {
    const updated = await uploadMyStoreLogo(logoFile.value);
    store.value = updated;

    logoFile.value = null;
    fillForm(updated);

    toast.success("Logo uploaded successfully.");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to upload logo");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <DefaultLayout>
    <div v-if="loading" class="card">
      <div class="card-body">Loading...</div>
    </div>

    <div v-else class="row" style="zoom: 80%;">
      <div class="col-md-8">
        <div class="card mt-3">
          <div class="card-header bg-light">Store Profile</div>
          <div class="card-body">
            <div class="row g-3">
              <div class="col-md-4">
                <label class="form-label">Store Code</label>
                <input v-model="form.code" class="form-control" readonly />
              </div>
    
              <div class="col-md-8">
                <label class="form-label">Store Name</label>
                <input v-model="form.name" class="form-control" />
              </div>
    
              <div class="col-md-6">
                <label class="form-label">Phone</label>
                <input v-model="form.phone" class="form-control" />
              </div>
    
              <div class="col-md-6">
                <label class="form-label">Email</label>
                <input v-model="form.email" class="form-control" />
              </div>
    
              <div class="col-md-6">
                <label class="form-label">TPIN</label>
                <input v-model="form.tpin" class="form-control" />
              </div>
    
              <div class="col-md-6">
                <label class="form-label">Tax Rate (%)</label>
                <input v-model="form.tax_rate" type="number" step="0.0001" class="form-control" />
              </div>
    
              <div class="col-md-4">
                <label class="form-label">City</label>
                <input v-model="form.city" class="form-control" />
              </div>
    
              <div class="col-md-4">
                <label class="form-label">Province</label>
                <input v-model="form.province" class="form-control" />
              </div>
    
              <div class="col-md-4">
                <label class="form-label">Country</label>
                <input v-model="form.country" class="form-control" />
              </div>
    
              <div class="col-md-6">
                <label class="form-label">Time Zone</label>
                <input v-model="form.time_zone" class="form-control" placeholder="Africa/Lusaka" />
              </div>
    
              <div class="col-md-3">
                <label class="form-label">Currency Code</label>
                <input v-model="form.currency_code" class="form-control" placeholder="ZMW" />
              </div>
    
              <div class="col-md-3">
                <label class="form-label">Currency Symbol</label>
                <input v-model="form.currency_symbol" class="form-control" placeholder="K" />
              </div>
    
              <div class="col-12">
                <label class="form-label">Address</label>
                <textarea v-model="form.address" class="form-control" rows="2"></textarea>
              </div>
    
              <div class="col-md-6">
                <label class="form-label">Bank Name</label>
                <input v-model="form.bank_name" class="form-control" />
              </div>
    
              <div class="col-md-6">
                <label class="form-label">Bank Account Number</label>
                <input v-model="form.bank_account_number" class="form-control" />
              </div>
    
              <div class="col-md-6">
                <label class="form-label">Website</label>
                <input v-model="form.website_url" class="form-control" />
              </div>
    
              <div class="col-md-6">
                <label class="form-label">Facebook</label>
                <input v-model="form.facebook_url" class="form-control" />
              </div>
    
              <div class="col-md-6">
                <label class="form-label">Store Type</label>
                <input v-model="form.store_type" class="form-control" />
              </div>
    
              <div class="col-md-6">
                <label class="form-label">Motto</label>
                <input v-model="form.motto" class="form-control" />
              </div>
    
              <div class="col-12">
                <label class="form-label">Notes</label>
                <textarea v-model="form.notes" class="form-control" rows="3"></textarea>
              </div>
            </div>
    
            <div class="mt-3 d-flex gap-2">
              <button class="btn btn-primary" :disabled="saving" @click="save">
                <span v-if="saving">Saving...</span>
                <span v-else>Save Changes</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card mt-3">
          <div class="card-header bg-light d-flex align-items-center justify-content-between">
            <span>Store Logo</span>
          </div>
      
          <div class="card-body">
            <!-- Preview box -->
            <div
              class="border rounded-3 position-relative d-flex align-items-center justify-content-center bg-white"
              style="height: 220px; overflow: hidden;"
            >
              <img
                v-if="displayLogoUrl()"
                :src="displayLogoUrl()"
                alt="Store Logo"
                style="max-width: 100%; max-height: 100%; object-fit: contain;"
                @load="logoImgLoading = false"
              />
              <div v-else class="text-muted">No logo uploaded.</div>
            
              <!-- Loader overlay -->
              <div
                v-if="logoImgLoading"
                class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
                style="background: rgba(255,255,255,0.75);"
              >
                <div class="text-center">
                  <div class="spinner-border" role="status" aria-hidden="true"></div>
                  <div class="small text-muted mt-2">Loading preview…</div>
                </div>
              </div>
            </div>
      
            <!-- Choose file -->
            <div class="mt-3">
              <label class="form-label mb-1">Choose a new logo</label>
              <input type="file" class="form-control" accept="image/*" @change="onPickLogo" />
      
              <div class="d-flex align-items-center justify-content-between mt-2">
                <small class="text-muted">PNG/JPG/WEBP recommended (square).</small>
              
                <!-- Buttons only when file selected -->
                <div v-if="logoFile" class="d-flex gap-2">
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    :disabled="saving"
                    @click="uploadLogoOnly"
                  >
                    <span v-if="saving">
                      <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      Uploading...
                    </span>
                    <span v-else>Upload</span>
                  </button>
              
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary"
                    :disabled="saving"
                    @click="clearSelectedLogo"
                  >
                    Remove
                  </button>
                </div>
              </div>
      
              <div v-if="logoFile" class="mt-2 small text-muted">
                Selected: <strong>{{ logoFile.name }}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
