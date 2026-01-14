/// src/views/setup/Tax.vue
<script setup>
import { ref, onMounted, computed, watch } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import SearchSelect from "../../components/SearchSelect.vue";
import {
  listTaxRates,
  createTaxRate,
  updateTaxRate,
  listTaxProfiles,
  createTaxProfile,
  updateTaxProfile,
} from "../../api/setupTax";

const toast = useToast();
const loading = ref(true);

const rates = ref([]);
const profiles = ref([]);

const savingRate = ref(false);
const savingProfile = ref(false);

const editRateId = ref(null);
const rateForm = ref({
  name: "",
  rate_percent: 16,
  is_inclusive: false,
  is_active: true,
});

const editProfileId = ref(null);
const profileForm = ref({
  name: "",
  is_active: true,
  tax_rate_ids: [],
});

// UI helpers
const rateSearch = ref("");
const profileSearch = ref("");

const isEditRate = computed(() => !!editRateId.value);
const isEditProfile = computed(() => !!editProfileId.value);

const activeRatesCount = computed(() => (rates.value || []).filter((r) => r.is_active).length);
const activeProfilesCount = computed(() => (profiles.value || []).filter((p) => p.is_active).length);

const filteredRates = computed(() => {
  const q = rateSearch.value.trim().toLowerCase();
  const arr = rates.value || [];
  if (!q) return arr;
  return arr.filter((r) => String(r.name || "").toLowerCase().includes(q));
});

const filteredProfiles = computed(() => {
  const q = profileSearch.value.trim().toLowerCase();
  const arr = profiles.value || [];
  if (!q) return arr;
  return arr.filter((p) => String(p.name || "").toLowerCase().includes(q));
});

function resetRateForm() {
  editRateId.value = null;
  rateForm.value = { name: "", rate_percent: 16, is_inclusive: false, is_active: true };
}

function resetProfileForm() {
  editProfileId.value = null;
  profileForm.value = { name: "", is_active: true, tax_rate_ids: [] };
  rateToAdd.value = null;
}

function editRate(r) {
  editRateId.value = r.id;
  rateForm.value = {
    name: r.name,
    rate_percent: Number(r.rate_percent),
    is_inclusive: !!r.is_inclusive,
    is_active: !!r.is_active,
  };
}

function editProfile(p) {
  editProfileId.value = p.id;
  profileForm.value = {
    name: p.name,
    is_active: !!p.is_active,
    tax_rate_ids: [...(p.tax_rate_ids || [])],
  };
  rateToAdd.value = null;
}

function labelForRateId(id) {
  const r = (rates.value || []).find((x) => x.id === id);
  if (!r) return `#${id}`;
  const inc = r.is_inclusive ? " • inclusive" : "";
  return `${r.name} (${Number(r.rate_percent)}%)${inc}`;
}

function selectedProfileRatesPreview() {
  const ids = profileForm.value.tax_rate_ids || [];
  if (!ids.length) return "No rates selected";
  return ids.map(labelForRateId).join(", ");
}

async function load() {
  loading.value = true;
  try {
    rates.value = await listTaxRates();
    profiles.value = await listTaxProfiles();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load tax setup");
  } finally {
    loading.value = false;
  }
}

async function saveRate() {
  savingRate.value = true;
  try {
    const payload = { ...rateForm.value };
    payload.name = (payload.name || "").trim();
    payload.rate_percent = Number(payload.rate_percent);

    if (!payload.name) return toast.error("Rate name is required");
    if (!Number.isFinite(payload.rate_percent)) return toast.error("Rate percent must be a number");
    if (payload.rate_percent < 0 || payload.rate_percent > 100)
      return toast.error("Rate percent must be between 0 and 100");

    if (editRateId.value) {
      await updateTaxRate(editRateId.value, payload);
      toast.success("Tax rate updated");
    } else {
      await createTaxRate(payload);
      toast.success("Tax rate created");
    }

    resetRateForm();
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save tax rate");
  } finally {
    savingRate.value = false;
  }
}

async function saveProfile() {
  savingProfile.value = true;
  try {
    const payload = { ...profileForm.value };
    payload.name = (payload.name || "").trim();
    payload.tax_rate_ids = payload.tax_rate_ids || [];

    if (!payload.name) return toast.error("Profile name is required");
    if (!payload.tax_rate_ids.length) return toast.error("Select at least one tax rate for the profile");

    if (editProfileId.value) {
      await updateTaxProfile(editProfileId.value, payload);
      toast.success("Tax profile updated");
    } else {
      await createTaxProfile(payload);
      toast.success("Tax profile created");
    }

    resetProfileForm();
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save tax profile");
  } finally {
    savingProfile.value = false;
  }
}

function clearRateSearch() {
  rateSearch.value = "";
}
function clearProfileSearch() {
  profileSearch.value = "";
}

/** ===== SearchSelect for profile rates (add/remove chips) ===== */
const rateToAdd = ref(null);

const rateOptions = computed(() =>
  (rates.value || []).map((r) => ({
    label: labelForRateId(r.id),
    value: r.id,
  }))
);

function addRateToProfile(id) {
  if (id === null || id === undefined || id === "") return;

  const ids = profileForm.value.tax_rate_ids || [];
  if (!ids.includes(id)) {
    profileForm.value.tax_rate_ids = [...ids, id];
  }
  // reset picker so user can add another quickly
  rateToAdd.value = null;
}

function removeRateFromProfile(id) {
  profileForm.value.tax_rate_ids = (profileForm.value.tax_rate_ids || []).filter((x) => x !== id);
}

function clearAllRates() {
  profileForm.value.tax_rate_ids = [];
}

watch(rateToAdd, (v) => {
  if (v === null || v === undefined || v === "") return;
  addRateToProfile(v);
});

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">Tax Setup</h4>
        <div class="text-muted small">
          <strong>{{ rates.length }}</strong> rates
          (<span class="text-success fw-semibold">{{ activeRatesCount }}</span> active)
          •
          <strong>{{ profiles.length }}</strong> profiles
          (<span class="text-success fw-semibold">{{ activeProfilesCount }}</span> active)
        </div>
      </div>

      <button class="btn btn-outline-primary" :disabled="loading" @click="load">
        <i class="ri-refresh-line me-1"></i> Refresh
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card" style="zoom: 80%;">
      <div class="card-body d-flex align-items-center gap-2">
        <div class="spinner-border" role="status" aria-hidden="true"></div>
        <div>Loading tax setup...</div>
      </div>
    </div>

    <div v-else class="row g-3" style="zoom: 80%;">
      <!-- Tax Rates -->
      <div class="col-lg-6">
        <div class="card tax-card position-relative">
          <div class="card-header bg-transparent d-flex align-items-center justify-content-between">
            <div>
              <div class="tax-title">Tax Rates</div>
              <div class="text-muted small">Create VAT/LEVY rates and mark inclusive/active.</div>
            </div>

            <div class="tax-pill">
              <i class="ri-percent-line"></i>
              <span>{{ rates.length }}</span>
            </div>
          </div>

          <div class="card-body">
            <div class="row g-2 align-items-end mb-3">
              <div class="col-md-8">
                <label class="form-label mb-1">Search rates</label>
                <div class="input-group">
                  <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
                  <input v-model="rateSearch" class="form-control" placeholder="Search by rate name (e.g. VAT)" />
                  <button class="btn btn-light" @click="clearRateSearch" :disabled="!rateSearch">Clear</button>
                </div>
              </div>
              <div class="col-md-4 text-md-end">
                <div class="text-muted small">
                  Showing <strong>{{ filteredRates.length }}</strong> of <strong>{{ rates.length }}</strong>
                </div>
              </div>
            </div>

            <div class="tax-list mb-3">
              <div v-if="filteredRates.length === 0" class="tax-empty text-muted">
                No matching tax rates.
              </div>

              <button
                v-for="r in filteredRates"
                :key="r.id"
                type="button"
                class="tax-row"
                :class="editRateId === r.id ? 'is-selected' : ''"
                @click="editRate(r)"
              >
                <div class="d-flex align-items-center gap-2">
                  <span class="tax-dot" :class="r.is_active ? 'on' : 'off'"></span>
                  <div class="min-w-0">
                    <div class="fw-semibold tax-row-title">
                      {{ r.name }}
                      <span v-if="r.is_inclusive" class="badge text-bg-info ms-2">Inclusive</span>
                    </div>
                    <div class="text-muted small">{{ r.is_active ? "Active" : "Inactive" }}</div>
                  </div>
                </div>

                <div class="tax-rate-badge">{{ Number(r.rate_percent) }}%</div>
              </button>
            </div>

            <!-- Form -->
            <div class="tax-form">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <h6 class="mb-0">{{ isEditRate ? "Edit Rate" : "Create Rate" }}</h6>
                <button class="btn btn-sm btn-light" :disabled="savingRate" @click="resetRateForm">
                  Reset
                </button>
              </div>

              <div class="row g-2">
                <div class="col-md-6">
                  <label class="form-label">Name *</label>
                  <input v-model="rateForm.name" class="form-control" placeholder="e.g. VAT" autocomplete="off" />
                </div>

                <div class="col-md-6">
                  <label class="form-label">Rate (%) *</label>
                  <div class="input-group">
                    <input v-model="rateForm.rate_percent" type="number" step="0.0001" class="form-control" />
                    <span class="input-group-text bg-light">%</span>
                  </div>
                  <small class="text-muted">0 - 100</small>
                </div>

                <div class="col-md-6">
                  <div class="form-check form-switch mt-2">
                    <input id="inclusive" class="form-check-input" type="checkbox" v-model="rateForm.is_inclusive" />
                    <label for="inclusive" class="form-check-label">Inclusive (included in prices)</label>
                  </div>
                </div>

                <div class="col-md-6">
                  <div class="form-check form-switch mt-2">
                    <input id="activeRate" class="form-check-input" type="checkbox" v-model="rateForm.is_active" />
                    <label for="activeRate" class="form-check-label">Active</label>
                  </div>
                </div>
              </div>

              <div class="mt-3 d-flex gap-2">
                <button class="btn btn-primary" :disabled="savingRate" @click="saveRate">
                  <span v-if="savingRate">Saving...</span>
                  <span v-else>{{ isEditRate ? "Update Rate" : "Create Rate" }}</span>
                </button>
                <button class="btn btn-secondary" :disabled="savingRate" @click="resetRateForm">
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div v-if="savingRate" class="tax-overlay" aria-hidden="true">
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving rate…</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tax Profiles -->
      <div class="col-lg-6">
        <div class="card tax-card position-relative">
          <div class="card-header bg-transparent d-flex align-items-center justify-content-between">
            <div>
              <div class="tax-title">Tax Profiles</div>
              <div class="text-muted small">Combine multiple rates into a reusable profile.</div>
            </div>

            <div class="tax-pill">
              <i class="ri-stack-line"></i>
              <span>{{ profiles.length }}</span>
            </div>
          </div>

          <div class="card-body">
            <div class="row g-2 align-items-end mb-3">
              <div class="col-md-8">
                <label class="form-label mb-1">Search profiles</label>
                <div class="input-group">
                  <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
                  <input v-model="profileSearch" class="form-control" placeholder="Search by profile name (e.g. Default)" />
                  <button class="btn btn-light" @click="clearProfileSearch" :disabled="!profileSearch">Clear</button>
                </div>
              </div>
              <div class="col-md-4 text-md-end">
                <div class="text-muted small">
                  Showing <strong>{{ filteredProfiles.length }}</strong> of <strong>{{ profiles.length }}</strong>
                </div>
              </div>
            </div>

            <div class="tax-list mb-3">
              <div v-if="filteredProfiles.length === 0" class="tax-empty text-muted">
                No matching tax profiles.
              </div>

              <button
                v-for="p in filteredProfiles"
                :key="p.id"
                type="button"
                class="tax-row"
                :class="editProfileId === p.id ? 'is-selected' : ''"
                @click="editProfile(p)"
              >
                <div class="d-flex align-items-center gap-2">
                  <span class="tax-dot" :class="p.is_active ? 'on' : 'off'"></span>
                  <div class="min-w-0">
                    <div class="fw-semibold tax-row-title">{{ p.name }}</div>
                    <div class="text-muted small truncate">
                      {{
                        (p.tax_rate_ids || []).map((id) => labelForRateId(id)).join(", ") || "-"
                      }}
                    </div>
                  </div>
                </div>

                <div class="tax-rate-badge soft">{{ (p.tax_rate_ids || []).length }} rate(s)</div>
              </button>
            </div>

            <!-- Form -->
            <div class="tax-form">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <h6 class="mb-0">{{ isEditProfile ? "Edit Profile" : "Create Profile" }}</h6>
                <button class="btn btn-sm btn-light" :disabled="savingProfile" @click="resetProfileForm">
                  Reset
                </button>
              </div>

              <div class="row g-2">
                <div class="col-md-7">
                  <label class="form-label">Profile Name *</label>
                  <input v-model="profileForm.name" class="form-control" placeholder="e.g. Default VAT" autocomplete="off" />
                </div>

                <div class="col-md-5">
                  <div class="form-check form-switch mt-4">
                    <input id="activeProfile" class="form-check-input" type="checkbox" v-model="profileForm.is_active" />
                    <label for="activeProfile" class="form-check-label">Active</label>
                  </div>
                </div>

                <!-- ✅ SearchSelect replaces multiple select -->
                <div class="col-12">
                  <label class="form-label">Rates in this profile *</label>

                  <SearchSelect
                    v-model="rateToAdd"
                    :options="rateOptions"
                    placeholder="Search and add a tax rate…"
                    search-placeholder="Type to filter rates…"
                    :clearable="true"
                    :searchable="true"
                    :disabled="savingProfile"
                  />

                  <!-- Selected chips -->
                  <div class="mt-2 preview-box">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                      <div class="text-muted small">Selected</div>
                      <button
                        type="button"
                        class="btn btn-sm btn-outline-secondary"
                        :disabled="!(profileForm.tax_rate_ids || []).length"
                        @click="clearAllRates"
                      >
                        Clear all
                      </button>
                    </div>

                    <div v-if="!(profileForm.tax_rate_ids || []).length" class="text-muted small">
                      No rates selected
                    </div>

                    <div v-else class="chip-wrap">
                      <span v-for="id in profileForm.tax_rate_ids" :key="id" class="rate-chip" :title="labelForRateId(id)">
                        <span class="truncate">{{ labelForRateId(id) }}</span>
                        <button type="button" class="chip-x" @click="removeRateFromProfile(id)" aria-label="Remove">
                          <i class="ri-close-line"></i>
                        </button>
                      </span>
                    </div>

                    <!-- keep your readable preview too -->
                    <div class="small text-muted mt-2 truncate" :title="selectedProfileRatesPreview()">
                      {{ selectedProfileRatesPreview() }}
                    </div>
                  </div>

                  <small class="text-muted">
                    Tip: use the search to add multiple rates (one at a time).
                  </small>
                </div>
              </div>

              <div class="mt-3 d-flex gap-2">
                <button class="btn btn-primary" :disabled="savingProfile" @click="saveProfile">
                  <span v-if="savingProfile">Saving...</span>
                  <span v-else>{{ isEditProfile ? "Update Profile" : "Create Profile" }}</span>
                </button>
                <button class="btn btn-secondary" :disabled="savingProfile" @click="resetProfileForm">
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div v-if="savingProfile" class="tax-overlay" aria-hidden="true">
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving profile…</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
/* Theme compatible (ct tokens) */

.tax-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
}

.tax-title {
  font-weight: 900;
  color: var(--ct-emphasis-color);
  font-size: 16px;
}

.tax-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--ct-border-radius-pill);
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  color: var(--ct-body-color);
  box-shadow: var(--ct-box-shadow-sm);
}

.tax-list {
  display: grid;
  gap: 8px;
}

.tax-empty {
  border: 1px dashed var(--ct-border-color);
  border-radius: 12px;
  padding: 14px;
  background: var(--ct-secondary-bg);
}

.tax-row {
  width: 100%;
  text-align: left;
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-secondary-bg);
  border-radius: 12px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
}

.tax-row:hover {
  transform: translateY(-1px);
  border-color: rgba(var(--ct-primary-rgb), 0.22);
  box-shadow: var(--ct-box-shadow-lg);
}

.tax-row.is-selected {
  border-color: rgba(var(--ct-primary-rgb), 0.40);
  box-shadow: 0 12px 26px rgba(var(--ct-primary-rgb), 0.14);
}

.tax-row-title {
  color: var(--ct-emphasis-color);
}

.tax-dot {
  width: 10px;
  height: 10px;
  border-radius: var(--ct-border-radius-pill);
  border: 2px solid var(--ct-border-color);
}
.tax-dot.on {
  background: var(--ct-success);
  border-color: rgba(var(--ct-success-rgb), 0.35);
}
.tax-dot.off {
  background: var(--ct-gray-500);
  border-color: rgba(var(--ct-body-color-rgb), 0.25);
}

.tax-rate-badge {
  font-weight: 900;
  color: var(--ct-primary);
  background: rgba(var(--ct-primary-rgb), 0.12);
  border: 1px solid rgba(var(--ct-primary-rgb), 0.18);
  border-radius: var(--ct-border-radius-pill);
  padding: 6px 10px;
  min-width: 74px;
  text-align: center;
}

.tax-rate-badge.soft {
  color: var(--ct-body-color);
  background: var(--ct-light-bg-subtle);
  border-color: var(--ct-border-color-translucent);
}

.tax-form {
  margin-top: 10px;
  padding-top: 12px;
  border-top: 1px dashed var(--ct-border-color);
}

.preview-box {
  border: 1px solid var(--ct-border-color-translucent);
  background: var(--ct-light-bg-subtle);
  border-radius: 12px;
  padding: 10px;
}

.truncate {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* chips */
.chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.rate-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 6px 10px;
  border-radius: var(--ct-border-radius-pill);
  background: rgba(var(--ct-primary-rgb), 0.10);
  border: 1px solid rgba(var(--ct-primary-rgb), 0.16);
  color: var(--ct-emphasis-color);
}

.chip-x {
  border: 0;
  background: transparent;
  color: var(--ct-secondary-color);
  padding: 0;
  line-height: 1;
}
.chip-x:hover {
  color: var(--ct-emphasis-color);
}

/* Theme-safe overlay */
.tax-overlay {
  position: absolute;
  inset: 0;
  background: rgba(var(--ct-body-bg-rgb), 0.72);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
</style>
