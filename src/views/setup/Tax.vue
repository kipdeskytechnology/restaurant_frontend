<!-- src/views/setup/Tax.vue -->
<script setup>
import { ref, onMounted, computed, watch, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import SearchSelect from "../../components/SearchSelect.vue";
import {
  listTaxRates,
  createTaxRate,
  updateTaxRate,
  deleteTaxRate,
  listTaxProfiles,
  createTaxProfile,
  updateTaxProfile,
  deleteTaxProfile,
} from "../../api/setupTax";

const toast = useToast();
const loading = ref(true);
const refreshing = ref(false);

const rates = ref([]);
const profiles = ref([]);

const savingRate = ref(false);
const savingProfile = ref(false);

// Rate modal
const rateModalEl = ref(null);
let rateModalInstance = null;
const editRateId = ref(null);
const rateTriedSubmit = ref(false);
const rateForm = ref({ name: "", rate_percent: 16, is_inclusive: false, is_active: true });

// Profile modal
const profileModalEl = ref(null);
let profileModalInstance = null;
const editProfileId = ref(null);
const profileTriedSubmit = ref(false);
const profileForm = ref({ name: "", is_active: true, tax_rate_ids: [] });

// Search filters
const rateSearch = ref("");
const profileSearch = ref("");

const isEditRate = computed(() => !!editRateId.value);
const isEditProfile = computed(() => !!editProfileId.value);

const activeRatesCount = computed(() => (rates.value || []).filter((r) => r.is_active).length);
const activeProfilesCount = computed(() => (profiles.value || []).filter((p) => p.is_active).length);
const inclusiveRatesCount = computed(() => (rates.value || []).filter((r) => r.is_inclusive).length);

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

function labelForRateId(id) {
  const r = (rates.value || []).find((x) => x.id === id);
  if (!r) return `#${id}`;
  const inc = r.is_inclusive ? " · incl" : "";
  return `${r.name} (${Number(r.rate_percent)}%)${inc}`;
}

const rateOptions = computed(() =>
  (rates.value || []).map((r) => ({ label: labelForRateId(r.id), value: r.id }))
);

async function ensureModal(refEl, key) {
  if (key === "rate" && rateModalInstance) return rateModalInstance;
  if (key === "profile" && profileModalInstance) return profileModalInstance;
  let inst = null;
  try {
    const m = await import("bootstrap/js/dist/modal");
    inst = new m.default(refEl.value, { backdrop: "static", keyboard: false });
  } catch {
    inst = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(refEl.value, { backdrop: "static", keyboard: false })
      : null;
  }
  if (key === "rate") rateModalInstance = inst;
  else profileModalInstance = inst;
  return inst;
}

function resetRateForm() {
  editRateId.value = null;
  rateTriedSubmit.value = false;
  rateForm.value = { name: "", rate_percent: 16, is_inclusive: false, is_active: true };
}

async function openCreateRate() {
  resetRateForm();
  const inst = await ensureModal(rateModalEl, "rate");
  inst?.show();
  await nextTick();
}

async function openEditRate(r) {
  editRateId.value = r.id;
  rateTriedSubmit.value = false;
  rateForm.value = {
    name: r.name,
    rate_percent: Number(r.rate_percent),
    is_inclusive: !!r.is_inclusive,
    is_active: !!r.is_active,
  };
  const inst = await ensureModal(rateModalEl, "rate");
  inst?.show();
  await nextTick();
}

function resetProfileForm() {
  editProfileId.value = null;
  profileTriedSubmit.value = false;
  profileForm.value = { name: "", is_active: true, tax_rate_ids: [] };
  rateToAdd.value = null;
}

async function openCreateProfile() {
  resetProfileForm();
  const inst = await ensureModal(profileModalEl, "profile");
  inst?.show();
  await nextTick();
}

async function openEditProfile(p) {
  editProfileId.value = p.id;
  profileTriedSubmit.value = false;
  profileForm.value = {
    name: p.name,
    is_active: !!p.is_active,
    tax_rate_ids: [...(p.tax_rate_ids || [])],
  };
  rateToAdd.value = null;
  const inst = await ensureModal(profileModalEl, "profile");
  inst?.show();
  await nextTick();
}

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    rates.value = await listTaxRates();
    profiles.value = await listTaxProfiles();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load tax setup");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function saveRate() {
  rateTriedSubmit.value = true;
  const payload = { ...rateForm.value };
  payload.name = (payload.name || "").trim();
  payload.rate_percent = Number(payload.rate_percent);

  if (!payload.name) return toast.error("Rate name is required");
  if (!Number.isFinite(payload.rate_percent)) return toast.error("Rate percent must be a number");
  if (payload.rate_percent < 0 || payload.rate_percent > 100)
    return toast.error("Rate percent must be between 0 and 100");

  savingRate.value = true;
  try {
    if (editRateId.value) {
      await updateTaxRate(editRateId.value, payload);
      toast.success("Tax rate updated");
    } else {
      await createTaxRate(payload);
      toast.success("Tax rate created");
    }
    rateModalInstance?.hide();
    resetRateForm();
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save tax rate");
  } finally {
    savingRate.value = false;
  }
}

async function saveProfile() {
  profileTriedSubmit.value = true;
  const payload = { ...profileForm.value };
  payload.name = (payload.name || "").trim();
  payload.tax_rate_ids = payload.tax_rate_ids || [];

  if (!payload.name) return toast.error("Profile name is required");
  if (!payload.tax_rate_ids.length) return toast.error("Select at least one tax rate for the profile");

  savingProfile.value = true;
  try {
    if (editProfileId.value) {
      await updateTaxProfile(editProfileId.value, payload);
      toast.success("Tax profile updated");
    } else {
      await createTaxProfile(payload);
      toast.success("Tax profile created");
    }
    profileModalInstance?.hide();
    resetProfileForm();
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save tax profile");
  } finally {
    savingProfile.value = false;
  }
}

async function removeRate(r) {
  if (!confirm(`Delete tax rate "${r.name}"? This cannot be undone.`)) return;
  try {
    await deleteTaxRate(r.id);
    toast.success("Tax rate deleted");
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete tax rate");
  }
}

async function removeProfile(p) {
  if (!confirm(`Delete tax profile "${p.name}"? This cannot be undone.`)) return;
  try {
    await deleteTaxProfile(p.id);
    toast.success("Tax profile deleted");
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete tax profile");
  }
}

const rateToAdd = ref(null);

function addRateToProfile(id) {
  if (id === null || id === undefined || id === "") return;
  const ids = profileForm.value.tax_rate_ids || [];
  if (!ids.includes(id)) profileForm.value.tax_rate_ids = [...ids, id];
  rateToAdd.value = null;
}
function removeRateFromProfile(id) {
  profileForm.value.tax_rate_ids = (profileForm.value.tax_rate_ids || []).filter((x) => x !== id);
}
function clearAllRates() { profileForm.value.tax_rate_ids = []; }

watch(rateToAdd, (v) => {
  if (v === null || v === undefined || v === "") return;
  addRateToProfile(v);
});

// Combined effective rate of a profile (sum of percentages — useful at-a-glance)
function profileEffectiveRate(p) {
  const ids = p.tax_rate_ids || [];
  let sum = 0;
  for (const id of ids) {
    const r = rates.value.find((x) => x.id === id);
    if (r && Number.isFinite(Number(r.rate_percent))) sum += Number(r.rate_percent);
  }
  return sum;
}

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-percent-line"></i><span>Setup</span>
          </div>
          <h1 class="hero-title">Tax Setup</h1>
          <p class="hero-sub">
            Define VAT, levies, and surcharges as <strong>rates</strong>, then bundle them into reusable <strong>profiles</strong> you can attach to outlets or items.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="load(false)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
        </div>
      </div>

      <!-- ============== Stat strip ============== -->
      <div class="stat-strip mb-3" v-if="!loading">
        <div class="stat-tile">
          <div class="stat-icon tone-primary"><i class="ri-percent-line"></i></div>
          <div>
            <div class="stat-label">Tax rates</div>
            <div class="stat-value">{{ rates.length }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-success"><i class="ri-check-line"></i></div>
          <div>
            <div class="stat-label">Active rates</div>
            <div class="stat-value text-success">{{ activeRatesCount }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-info"><i class="ri-checkbox-multiple-line"></i></div>
          <div>
            <div class="stat-label">Inclusive</div>
            <div class="stat-value">{{ inclusiveRatesCount }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-warning"><i class="ri-stack-line"></i></div>
          <div>
            <div class="stat-label">Profiles</div>
            <div class="stat-value">{{ profiles.length }}</div>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading tax setup…</div>
        </div>
      </div>

      <div v-else class="row g-3">
        <!-- ============== TAX RATES ============== -->
        <div class="col-lg-6">
          <div class="card panel-card">
            <div class="panel-head">
              <div>
                <div class="panel-eyebrow">Rates</div>
                <div class="panel-title">Tax rates</div>
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="status-pill pill-soft">
                  <i class="ri-percent-line"></i> {{ filteredRates.length }}
                </span>
                <button v-can="'tax:manage'" class="btn btn-soft-primary btn-sm" @click="openCreateRate">
                  <i class="ri-add-line me-1"></i>New
                </button>
              </div>
            </div>

            <div class="card-body p-3">
              <div class="position-relative mb-2">
                <i class="ri-search-line search-ico"></i>
                <input v-model="rateSearch" class="form-control ps-5" placeholder="Search rate by name…" />
              </div>

              <div v-if="filteredRates.length === 0" class="empty-inline">
                <div class="empty-inline-icon"><i class="ri-percent-line"></i></div>
                <div class="small text-muted">{{ rates.length === 0 ? 'No rates yet — create your first VAT/levy.' : 'No matching rates.' }}</div>
              </div>

              <div v-else class="rate-list">
                <div
                  v-for="r in filteredRates"
                  :key="r.id"
                  class="rate-row"
                  :class="{ 'is-inactive': !r.is_active }"
                  role="button"
                  tabindex="0"
                  @click="openEditRate(r)"
                  @keydown.enter.prevent="openEditRate(r)"
                  @keydown.space.prevent="openEditRate(r)"
                >
                  <div class="d-flex align-items-center gap-2 min-w-0">
                    <span class="rate-icon"><i class="ri-percent-line"></i></span>
                    <div class="min-w-0">
                      <div class="rate-title truncate">
                        {{ r.name }}
                        <span v-if="r.is_inclusive" class="incl-chip">incl</span>
                      </div>
                      <div class="small">
                        <span class="status-pill" :class="r.is_active ? 'pill-on' : 'pill-off'">
                          <span class="dot-mini"></span>{{ r.is_active ? 'Active' : 'Inactive' }}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div class="d-flex align-items-center gap-2">
                    <div class="rate-value">{{ Number(r.rate_percent) }}<span class="ru">%</span></div>
                    <button
                      v-can="'tax:manage'"
                      type="button"
                      class="row-icon-btn danger"
                      title="Delete"
                      @click.stop="removeRate(r)"
                    >
                      <i class="ri-delete-bin-line"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ============== TAX PROFILES ============== -->
        <div class="col-lg-6">
          <div class="card panel-card">
            <div class="panel-head">
              <div>
                <div class="panel-eyebrow">Profiles</div>
                <div class="panel-title">Tax profiles</div>
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="status-pill pill-soft">
                  <i class="ri-stack-line"></i> {{ filteredProfiles.length }}
                </span>
                <button v-can="'tax:manage'" class="btn btn-soft-primary btn-sm" @click="openCreateProfile">
                  <i class="ri-add-line me-1"></i>New
                </button>
              </div>
            </div>

            <div class="card-body p-3">
              <div class="position-relative mb-2">
                <i class="ri-search-line search-ico"></i>
                <input v-model="profileSearch" class="form-control ps-5" placeholder="Search profile by name…" />
              </div>

              <div v-if="filteredProfiles.length === 0" class="empty-inline">
                <div class="empty-inline-icon"><i class="ri-stack-line"></i></div>
                <div class="small text-muted">
                  {{ profiles.length === 0 ? 'No profiles yet — bundle some rates above into a profile.' : 'No matching profiles.' }}
                </div>
              </div>

              <div v-else class="rate-list">
                <div
                  v-for="p in filteredProfiles"
                  :key="p.id"
                  class="rate-row"
                  :class="{ 'is-inactive': !p.is_active }"
                  role="button"
                  tabindex="0"
                  @click="openEditProfile(p)"
                  @keydown.enter.prevent="openEditProfile(p)"
                  @keydown.space.prevent="openEditProfile(p)"
                >
                  <div class="d-flex align-items-center gap-2 min-w-0">
                    <span class="rate-icon profile-icon"><i class="ri-stack-line"></i></span>
                    <div class="min-w-0">
                      <div class="rate-title truncate">{{ p.name }}</div>
                      <div class="small text-muted truncate" :title="(p.tax_rate_ids || []).map(labelForRateId).join(', ')">
                        {{ (p.tax_rate_ids || []).length === 0
                          ? 'No rates'
                          : (p.tax_rate_ids || []).map(labelForRateId).join(' · ') }}
                      </div>
                    </div>
                  </div>
                  <div class="d-flex align-items-center gap-2">
                    <div class="text-end">
                      <div class="rate-value">{{ profileEffectiveRate(p) }}<span class="ru">%</span></div>
                      <div class="rate-count">{{ (p.tax_rate_ids || []).length }} rate{{ (p.tax_rate_ids || []).length === 1 ? '' : 's' }}</div>
                    </div>
                    <button
                      v-can="'tax:manage'"
                      type="button"
                      class="row-icon-btn danger"
                      title="Delete"
                      @click.stop="removeProfile(p)"
                    >
                      <i class="ri-delete-bin-line"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Modal: Tax Rate ============== -->
    <div class="modal fade" tabindex="-1" aria-hidden="true" ref="rateModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditRate ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isEditRate ? "Edit tax rate" : "New tax rate" }}</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="savingRate"></button>
          </div>

          <div v-if="savingRate" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <form @submit.prevent="saveRate" novalidate :class="{ 'was-validated': rateTriedSubmit }">
              <div class="row g-3">
                <div class="col-md-7">
                  <label class="form-label">Name *</label>
                  <input v-model="rateForm.name" class="form-control" placeholder="e.g. VAT" autocomplete="off" required />
                </div>
                <div class="col-md-5">
                  <label class="form-label">Rate (%) *</label>
                  <div class="input-group">
                    <input v-model="rateForm.rate_percent" type="number" step="0.0001" class="form-control" placeholder="16" required />
                    <span class="input-group-text">%</span>
                  </div>
                  <div class="form-text">0 – 100</div>
                </div>

                <div class="col-md-6">
                  <div class="toggle-card">
                    <div>
                      <div class="fw-semibold">Inclusive</div>
                      <div class="small text-muted">Tax is already included in the displayed price.</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input id="taxIncl" v-model="rateForm.is_inclusive" class="form-check-input" type="checkbox" />
                    </div>
                  </div>
                </div>

                <div class="col-md-6">
                  <div class="toggle-card">
                    <div>
                      <div class="fw-semibold">Active</div>
                      <div class="small text-muted">Inactive rates are hidden from new profiles.</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input id="taxActive" v-model="rateForm.is_active" class="form-check-input" type="checkbox" />
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="savingRate">Cancel</button>
            <button v-can="'tax:manage'" class="btn btn-primary" :disabled="savingRate" @click="saveRate">
              <span v-if="savingRate" class="spinner-border spinner-border-sm me-1"></span>
              {{ isEditRate ? "Update rate" : "Create rate" }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Modal: Tax Profile ============== -->
    <div class="modal fade" tabindex="-1" aria-hidden="true" ref="profileModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditProfile ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isEditProfile ? "Edit tax profile" : "New tax profile" }}</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="savingProfile"></button>
          </div>

          <div v-if="savingProfile" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <form @submit.prevent="saveProfile" novalidate :class="{ 'was-validated': profileTriedSubmit }">
              <div class="row g-3">
                <div class="col-md-8">
                  <label class="form-label">Profile name *</label>
                  <input v-model="profileForm.name" class="form-control" placeholder="e.g. Default VAT" required autocomplete="off" />
                </div>
                <div class="col-md-4">
                  <div class="toggle-card mt-md-4">
                    <div>
                      <div class="fw-semibold">Active</div>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input id="profActive" v-model="profileForm.is_active" class="form-check-input" type="checkbox" />
                    </div>
                  </div>
                </div>

                <div class="col-12">
                  <label class="form-label">Add rates *</label>
                  <SearchSelect
                    v-model="rateToAdd"
                    :options="rateOptions"
                    placeholder="Search and add a tax rate…"
                    search-placeholder="Type to filter rates…"
                    :clearable="true"
                    :searchable="true"
                    :disabled="savingProfile"
                  />
                </div>

                <div class="col-12">
                  <div class="selected-card">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                      <div class="small fw-semibold">
                        Selected rates
                        <span class="text-muted">({{ (profileForm.tax_rate_ids || []).length }})</span>
                        <span v-if="(profileForm.tax_rate_ids || []).length" class="ms-2 effective-pill">
                          Effective: {{ profileEffectiveRate({ tax_rate_ids: profileForm.tax_rate_ids }) }}%
                        </span>
                      </div>
                      <button
                        type="button"
                        class="btn btn-sm btn-light"
                        :disabled="!(profileForm.tax_rate_ids || []).length"
                        @click="clearAllRates"
                      >
                        <i class="ri-close-line me-1"></i>Clear all
                      </button>
                    </div>

                    <div v-if="!(profileForm.tax_rate_ids || []).length" class="small text-muted py-2 text-center">
                      No rates selected — pick one above
                    </div>

                    <div v-else class="chip-wrap">
                      <span v-for="id in profileForm.tax_rate_ids" :key="id" class="rate-chip" :title="labelForRateId(id)">
                        <i class="ri-percent-line"></i>
                        <span class="truncate">{{ labelForRateId(id) }}</span>
                        <button type="button" class="chip-x" @click="removeRateFromProfile(id)" aria-label="Remove">
                          <i class="ri-close-line"></i>
                        </button>
                      </span>
                    </div>
                  </div>
                </div>

                <div class="col-12">
                  <div class="tip-card">
                    <i class="ri-lightbulb-flash-line tip-icon"></i>
                    <div class="small">
                      <div class="fw-semibold mb-1">Pro tip</div>
                      <div class="text-muted">
                        Profiles can stack multiple rates (e.g. VAT + Tourism Levy). Apply one profile to an outlet or item to compute taxes consistently.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="savingProfile">Cancel</button>
            <button v-can="'tax:manage'" class="btn btn-primary" :disabled="savingProfile" @click="saveProfile">
              <span v-if="savingProfile" class="spinner-border spinner-border-sm me-1"></span>
              {{ isEditProfile ? "Update profile" : "Create profile" }}
            </button>
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
  background: linear-gradient(135deg, #0f172a 0%, #6366f1 55%, #8b5cf6 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(99,102,241,0.55);
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
.page-hero-actions .btn-light { background: rgba(255,255,255,0.95); color: #0f172a; border: none; }

/* ============= Stat strip ============= */
.stat-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.75rem; }
.stat-tile {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.85rem 1rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px; box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.stat-icon { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; font-size: 1.05rem; }
.stat-icon.tone-primary { background: rgba(99,102,241,0.12); color: #4f46e5; }
.stat-icon.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.stat-icon.tone-warning { background: rgba(245,158,11,0.18); color: #b45309; }
.stat-icon.tone-info { background: rgba(6,182,212,0.14); color: #0e7490; }
.stat-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ct-secondary-color, #64748b); }
.stat-value { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.05rem; color: var(--ct-body-color, #0f172a); }

/* ============= Panel cards ============= */
.panel-card {
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
.panel-head {
  padding: 1rem 1.25rem;
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  background: linear-gradient(180deg, rgba(99,102,241,0.04), transparent);
}
.panel-eyebrow {
  font-size: 0.68rem; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--ct-primary, #6366f1);
}
.panel-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; letter-spacing: -0.02em;
  font-size: 1.05rem;
  color: var(--ct-body-color, #0f172a);
}

.search-ico {
  position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8); pointer-events: none;
}

/* ============= Rate / profile rows ============= */
.rate-list {
  display: flex; flex-direction: column; gap: 0.5rem;
  max-height: calc(100vh - 540px);
  min-height: 200px;
  overflow-y: auto;
  scrollbar-width: thin;
  padding-right: 4px;
}
.rate-list::-webkit-scrollbar { width: 8px; }
.rate-list::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.rate-row {
  width: 100%;
  text-align: left;
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 0.95rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
}
.rate-row:hover {
  border-color: rgba(99,102,241,0.4);
  transform: translateY(-1px);
  box-shadow: 0 8px 18px -10px rgba(15,23,42,0.18);
}
.rate-row.is-inactive { opacity: 0.65; }

.rate-icon {
  width: 36px; height: 36px;
  border-radius: 10px;
  display: grid; place-items: center;
  background: rgba(99,102,241,0.12);
  color: var(--ct-primary, #6366f1);
  font-size: 1rem;
  flex-shrink: 0;
}
.profile-icon {
  background: rgba(245,158,11,0.14);
  color: #b45309;
}
.rate-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 700; font-size: 0.92rem;
  color: var(--ct-body-color, #0f172a);
  display: flex; align-items: center; gap: 0.4rem;
}
.incl-chip {
  font-size: 0.62rem; font-weight: 700;
  padding: 0.1rem 0.4rem; border-radius: 4px;
  background: rgba(6,182,212,0.14); color: #0e7490;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.rate-value {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 1.25rem;
  letter-spacing: -0.02em;
  color: var(--ct-primary, #6366f1);
  line-height: 1;
  flex-shrink: 0;
}
.ru { font-size: 0.85rem; margin-left: 0.05rem; }

.row-icon-btn {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}
.row-icon-btn:hover { background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); }
.row-icon-btn.danger:hover { background: rgba(239,68,68,0.1); color: #ef4444; }

.rate-count {
  font-size: 0.68rem; font-weight: 700;
  color: var(--ct-secondary-color, #64748b);
  text-transform: uppercase; letter-spacing: 0.04em;
  margin-top: 0.15rem;
}

.status-pill {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.15rem 0.5rem; border-radius: 999px;
  font-size: 0.68rem; font-weight: 700;
}
.dot-mini { width: 6px; height: 6px; border-radius: 50%; }
.pill-on { background: rgba(16,185,129,0.14); color: #047857; }
.pill-on .dot-mini { background: #10b981; }
.pill-off { background: rgba(100,116,139,0.14); color: #64748b; }
.pill-off .dot-mini { background: #94a3b8; }
.pill-soft { background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); }

.empty-inline {
  display: flex; align-items: center; gap: 0.65rem;
  padding: 1rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
}
.empty-inline-icon {
  width: 38px; height: 38px;
  border-radius: 10px;
  display: grid; place-items: center;
  background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1);
  flex-shrink: 0;
}

.truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.min-w-0 { min-width: 0; }

/* Selected rates panel inside profile modal */
.selected-card {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  background: var(--ct-tertiary-bg, #f8fafc);
  padding: 0.85rem 1rem;
}
.effective-pill {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  font-size: 0.7rem; font-weight: 700;
  background: rgba(99,102,241,0.12); color: var(--ct-primary, #6366f1);
  border-radius: 999px;
}
.chip-wrap { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.rate-chip {
  display: inline-flex; align-items: center; gap: 0.4rem;
  max-width: 100%;
  padding: 0.3rem 0.6rem;
  border-radius: 999px;
  background: rgba(99,102,241,0.1);
  border: 1px solid rgba(99,102,241,0.22);
  color: var(--ct-primary, #6366f1);
  font-size: 0.78rem; font-weight: 600;
}
.rate-chip i { font-size: 0.85rem; }
.chip-x {
  border: 0; background: rgba(99,102,241,0.15);
  color: var(--ct-primary, #6366f1);
  width: 18px; height: 18px;
  border-radius: 50%;
  display: grid; place-items: center;
  cursor: pointer;
  transition: background 0.15s ease;
}
.chip-x:hover { background: rgba(239,68,68,0.2); color: #ef4444; }

/* ============= Modal ============= */
:deep(.modal-modern) {
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 22px !important;
  overflow: hidden;
  box-shadow: 0 30px 60px -20px rgba(15,23,42,0.35);
  background: var(--ct-card-bg, #fff);
}
:deep(.modal-header-modern) {
  padding: 1.25rem 1.5rem 1rem;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  display: flex; justify-content: space-between; align-items: flex-start;
}
:deep(.modal-eyebrow) { font-size: 0.68rem; font-weight: 700; color: var(--ct-primary, #6366f1); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.25rem; }
:deep(.modal-header-modern .modal-title) { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.25rem; }
:deep(.modal-body-modern) {
  padding: 1.5rem;
  max-height: calc(100vh - 240px);
  overflow-y: auto;
  scrollbar-width: thin;
}

.modal-overlay {
  position: absolute; inset: 0; z-index: 5;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
}

.toggle-card {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  background: var(--ct-tertiary-bg, #f8fafc);
}
.tip-card {
  display: flex; gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: rgba(99,102,241,0.06);
  border: 1px solid rgba(99,102,241,0.18);
  align-items: flex-start;
}
.tip-icon { font-size: 1.2rem; color: var(--ct-primary, #6366f1); flex-shrink: 0; }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}
</style>
