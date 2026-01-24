<!-- src/views/setup/Uom.vue -->
<script setup>
import { ref, onMounted, computed, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import SearchSelect from "../../components/SearchSelect.vue";
import {
  listUoms,
  createUom,
  updateUom,
  listUomConversions,
  createUomConversion,
  updateUomConversion,
  deleteUomConversion,
} from "../../api/setupUom";

const toast = useToast();
const loading = ref(true);

const uoms = ref([]);
const conversions = ref([]);

const uomSaving = ref(false);
const convSaving = ref(false);

const editUomId = ref(null);
const uomForm = ref({ code: "", name: "" });

const editConvId = ref(null);
const convForm = ref({ from_uom_id: "", to_uom_id: "", multiplier: "" });

// search
const uomSearch = ref("");
const convSearch = ref("");

// refs (scroll to top forms)
const uomFormCardEl = ref(null);
const convFormCardEl = ref(null);

function scrollTo(el) {
  try {
    el?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  } catch {}
}

// stats
const uomCount = computed(() => (uoms.value || []).length);
const convCount = computed(() => (conversions.value || []).length);

const uomMap = computed(() => {
  const m = new Map();
  for (const u of uoms.value || []) m.set(u.id, u);
  return m;
});

const uomOptions = computed(() =>
  (uoms.value || []).map((u) => ({
    label: `${u.code} — ${u.name}`,
    value: u.id,
  }))
);

const isEditUom = computed(() => !!editUomId.value);
const isEditConv = computed(() => !!editConvId.value);

const filteredUoms = computed(() => {
  const q = uomSearch.value.trim().toLowerCase();
  const arr = uoms.value || [];
  if (!q) return arr;
  return arr.filter((u) => `${u.code || ""} ${u.name || ""}`.toLowerCase().includes(q));
});

const filteredConvs = computed(() => {
  const q = convSearch.value.trim().toLowerCase();
  const arr = conversions.value || [];
  if (!q) return arr;
  return arr.filter((c) => {
    const from = uomMap.value.get(c.from_uom_id)?.code || String(c.from_uom_id);
    const to = uomMap.value.get(c.to_uom_id)?.code || String(c.to_uom_id);
    const hay = `${from} ${to} ${c.multiplier}`.toLowerCase();
    return hay.includes(q);
  });
});

function uomCode(id) {
  return (uomMap.value.get(Number(id))?.code || "").toUpperCase();
}

function fmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return x.toLocaleString(undefined, { maximumFractionDigits: 10 });
}

// common “expected” conversions (extend as you wish)
const EXPECTED = {
  KG: { G: 1000, MG: 1_000_000 },
  G: { KG: 0.001, MG: 1000 },
  MG: { G: 0.001, KG: 0.000001 },

  L: { ML: 1000 },
  ML: { L: 0.001 },

  M: { CM: 100, MM: 1000 },
  CM: { M: 0.01, MM: 10 },
  MM: { M: 0.001, CM: 0.1 },
};

function expectedMultiplier(fromCode, toCode) {
  return EXPECTED?.[fromCode]?.[toCode] ?? null;
}

// build graph from existing conversions for "consistency" checks
const convGraph = computed(() => {
  const g = new Map();
  for (const c of conversions.value || []) {
    const from = Number(c.from_uom_id);
    const to = Number(c.to_uom_id);
    const mult = Number(c.multiplier);
    if (!from || !to || !Number.isFinite(mult) || mult <= 0) continue;

    if (!g.has(from)) g.set(from, []);
    if (!g.has(to)) g.set(to, []);

    g.get(from).push({ to, factor: mult, id: c.id });
    g.get(to).push({ to: from, factor: 1 / mult, id: c.id });
  }
  return g;
});

function factorFromExisting(fromId, toId, ignoreConvId = null) {
  fromId = Number(fromId);
  toId = Number(toId);
  if (!fromId || !toId) return null;
  if (fromId === toId) return 1;

  const g = convGraph.value;
  const q = [{ id: fromId, f: 1 }];
  const seen = new Set([fromId]);

  while (q.length) {
    const { id, f } = q.shift();
    for (const e of g.get(id) || []) {
      if (ignoreConvId && Number(e.id) === Number(ignoreConvId)) continue;
      if (seen.has(e.to)) continue;

      const f2 = f * e.factor;
      if (e.to === toId) return f2;

      seen.add(e.to);
      q.push({ id: e.to, f: f2 });
    }
  }
  return null;
}

const convWarnings = computed(() => {
  const fromId = Number(convForm.value.from_uom_id || 0);
  const toId = Number(convForm.value.to_uom_id || 0);
  const mult = Number(convForm.value.multiplier || 0);

  if (!fromId || !toId || !Number.isFinite(mult) || mult <= 0) return [];

  const fromC = uomCode(fromId);
  const toC = uomCode(toId);

  const out = [];

  // 1) extreme magnitude hint
  if (mult > 1e6 || mult < 1e-6) {
    out.push(`Multiplier looks extreme: 1 ${fromC} = ${fmt(mult)} ${toC}. Double-check units/prefixes.`);
  }

  // 2) known expected conversion hint
  const exp = expectedMultiplier(fromC, toC);
  if (exp != null) {
    const diff = Math.abs(mult - exp) / exp;
    if (diff > 0.05) {
      out.push(`Typical: 1 ${fromC} = ${fmt(exp)} ${toC} (you entered ${fmt(mult)}).`);
    }
  }

  // 3) consistency with existing graph (excluding current editing record)
  const implied = factorFromExisting(fromId, toId, editConvId.value);
  if (implied != null) {
    const diff = Math.abs(mult - implied) / implied;
    if (diff > 0.02) {
      out.push(`Existing conversions imply ~${fmt(implied)} ${toC} per 1 ${fromC}. Your value differs.`);
    }
  }

  // 4) reciprocal direct check (if exists)
  const rev = (conversions.value || []).find(
    (c) => Number(c.from_uom_id) === toId && Number(c.to_uom_id) === fromId
  );
  if (rev) {
    const revMult = Number(rev.multiplier);
    if (Number.isFinite(revMult) && revMult > 0) {
      const prod = mult * revMult;
      if (Math.abs(prod - 1) > 0.05) {
        out.push(`Reverse conversion exists; expected multiplier × reverse ≈ 1 (currently ${fmt(prod)}).`);
      }
    }
  }

  return out;
});

function resetUomForm() {
  editUomId.value = null;
  uomForm.value = { code: "", name: "" };
}

function resetConvForm() {
  editConvId.value = null;
  convForm.value = { from_uom_id: "", to_uom_id: "", multiplier: "" };
}

async function load() {
  loading.value = true;
  try {
    uoms.value = await listUoms();
    conversions.value = await listUomConversions();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load UOM setup");
  } finally {
    loading.value = false;
  }
}

function editUom(u) {
  editUomId.value = u.id;
  uomForm.value = { code: u.code || "", name: u.name || "" };
  nextTick(() => scrollTo(uomFormCardEl.value));
}

function editConv(c) {
  editConvId.value = c.id;
  convForm.value = {
    from_uom_id: c.from_uom_id,
    to_uom_id: c.to_uom_id,
    multiplier: Number(c.multiplier),
  };
  nextTick(() => scrollTo(convFormCardEl.value));
}

async function saveUom() {
  uomSaving.value = true;
  try {
    const payload = { ...uomForm.value };
    payload.code = (payload.code || "").trim().toUpperCase();
    payload.name = (payload.name || "").trim();

    if (!payload.code || !payload.name) {
      toast.error("Code and name are required");
      return;
    }

    if (editUomId.value) {
      await updateUom(editUomId.value, payload);
      toast.success("UOM updated");
    } else {
      await createUom(payload);
      toast.success("UOM created");
    }

    resetUomForm();
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save UOM");
  } finally {
    uomSaving.value = false;
  }
}

async function saveConv() {
  convSaving.value = true;
  try {
    const payload = { ...convForm.value };
    payload.from_uom_id = Number(payload.from_uom_id);
    payload.to_uom_id = Number(payload.to_uom_id);
    payload.multiplier = Number(payload.multiplier);

    if (!payload.from_uom_id || !payload.to_uom_id) {
      toast.error("Pick From and To UOM");
      return;
    }
    if (payload.from_uom_id === payload.to_uom_id) {
      toast.error("From and To UOM cannot be the same");
      return;
    }
    if (!payload.multiplier || payload.multiplier <= 0) {
      toast.error("Multiplier must be > 0");
      return;
    }

    if (editConvId.value) {
      await updateUomConversion(editConvId.value, { multiplier: payload.multiplier });
      toast.success("Conversion updated");
    } else {
      await createUomConversion(payload);
      toast.success("Conversion created");
    }

    resetConvForm();
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save conversion");
  } finally {
    convSaving.value = false;
  }
}

async function removeConv(id) {
  if (!confirm("Delete this conversion?")) return;
  try {
    await deleteUomConversion(id);
    toast.success("Conversion deleted");
    await load();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete conversion");
  }
}

function codeFor(id) {
  return uomMap.value.get(id)?.code || String(id);
}

function clearUomSearch() {
  uomSearch.value = "";
}
function clearConvSearch() {
  convSearch.value = "";
}

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <!-- Header -->
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <div>
        <h4 class="page-title mb-0">UOM Setup</h4>
        <div class="text-muted small">
          <strong>{{ uomCount }}</strong> UOMs • <strong>{{ convCount }}</strong> conversions
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
        <div>Loading UOM setup...</div>
      </div>
    </div>

    <div v-else class="row g-3" style="zoom: 80%;">
      <!-- LEFT: UOMs -->
      <div class="col-lg-5">
        <!-- Create/Edit card (TOP) -->
        <div ref="uomFormCardEl" class="card uom-card position-relative">
          <div class="card-header bg-transparent d-flex align-items-center justify-content-between">
            <div>
              <div class="uom-title">{{ isEditUom ? "Edit UOM" : "Create UOM" }}</div>
              <div class="text-muted small">Add units like KG, L, PCS and keep them consistent.</div>
            </div>

            <div class="uom-pill">
              <i class="ri-ruler-2-line"></i>
              <span>{{ uoms.length }}</span>
            </div>
          </div>

          <div class="card-body">
            <div class="row g-2">
              <div class="col-md-4">
                <label class="form-label">Code *</label>
                <input v-model="uomForm.code" class="form-control" placeholder="KG" />
              </div>
              <div class="col-md-8">
                <label class="form-label">Name *</label>
                <input v-model="uomForm.name" class="form-control" placeholder="Kilogram" />
              </div>
            </div>

            <div class="mt-3 d-flex gap-2">
              <button class="btn btn-primary" :disabled="uomSaving" @click="saveUom">
                <span v-if="uomSaving">Saving...</span>
                <span v-else>{{ isEditUom ? "Update UOM" : "Create UOM" }}</span>
              </button>
              <button class="btn btn-secondary" :disabled="uomSaving" @click="resetUomForm">
                Clear
              </button>
            </div>
          </div>

          <div v-if="uomSaving" class="uom-overlay" aria-hidden="true">
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving UOM…</div>
            </div>
          </div>
        </div>

        <!-- List card (BOTTOM) -->
        <div class="card uom-card">
          <div class="card-header bg-transparent d-flex align-items-center justify-content-between">
            <div>
              <div class="uom-title">UOM List</div>
              <div class="text-muted small">
                Click an item to load it into the form above.
              </div>
            </div>

            <button class="btn btn-sm btn-light" :disabled="!uomSearch" @click="clearUomSearch">
              Clear search
            </button>
          </div>

          <div class="card-body">
            <label class="form-label mb-1">Search</label>
            <div class="input-group mb-2">
              <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
              <input v-model="uomSearch" class="form-control" placeholder="Search by code or name..." />
            </div>

            <div class="text-muted small mb-2">
              Showing <strong>{{ filteredUoms.length }}</strong> of <strong>{{ uoms.length }}</strong>
            </div>

            <div class="uom-list">
              <div v-if="filteredUoms.length === 0" class="uom-empty text-muted">
                No matching UOMs.
              </div>

              <button
                v-for="u in filteredUoms"
                :key="u.id"
                type="button"
                class="uom-row"
                :class="editUomId === u.id ? 'is-selected' : ''"
                @click="editUom(u)"
                title="Click to edit"
              >
                <div class="d-flex align-items-center gap-2 min-w-0">
                  <span class="uom-code">{{ u.code }}</span>
                  <div class="min-w-0">
                    <div class="fw-semibold uom-row-title truncate">{{ u.name }}</div>
                    <div class="text-muted small">ID: {{ u.id }}</div>
                  </div>
                </div>

                <span class="uom-edit-hint"><i class="ri-edit-line"></i></span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT: Conversions -->
      <div class="col-lg-7">
        <!-- Create/Edit card (TOP) -->
        <div ref="convFormCardEl" class="card uom-card uom-card--overflow position-relative">
          <div class="card-header bg-transparent d-flex align-items-center justify-content-between">
            <div>
              <div class="uom-title">{{ isEditConv ? "Edit Conversion" : "Create Conversion" }}</div>
              <div class="text-muted small">Example: 1 KG = 1000 G</div>
            </div>

            <div class="uom-pill">
              <i class="ri-repeat-2-line"></i>
              <span>{{ conversions.length }}</span>
            </div>
          </div>

          <div class="card-body">
            <div class="row g-2">
              <div class="col-md-4">
                <label class="form-label">From *</label>
                <SearchSelect
                  v-model="convForm.from_uom_id"
                  :options="uomOptions"
                  placeholder="Select From…"
                  search-placeholder="Type to search…"
                  :disabled="convSaving"
                />
              </div>

              <div class="col-md-4">
                <label class="form-label">To *</label>
                <SearchSelect
                  v-model="convForm.to_uom_id"
                  :options="uomOptions"
                  placeholder="Select To…"
                  search-placeholder="Type to search…"
                  :disabled="convSaving"
                />
              </div>

              <div class="col-md-4">
                <label class="form-label">Multiplier (<small class="text-muted">
                  Meaning: 1 From = multiplier × To
                  <span v-if="convForm.from_uom_id && convForm.to_uom_id && convForm.multiplier">
                    • 1 {{ codeFor(Number(convForm.from_uom_id)) }} =
                    {{ convForm.multiplier }} {{ codeFor(Number(convForm.to_uom_id)) }}
                  </span>
                </small>)*</label>
                <input
                  v-model="convForm.multiplier"
                  type="number"
                  step="0.00000001"
                  class="form-control"
                  placeholder="e.g. 1000"
                />
                <div v-if="convWarnings.length" class="alert alert-warning py-2 mt-2 mb-0">
                  <div class="fw-semibold mb-1">
                    <i class="ri-alert-line me-1"></i> Please double-check this conversion
                  </div>
                  <ul class="mb-0 ps-3">
                    <li v-for="(w, i) in convWarnings" :key="i">{{ w }}</li>
                  </ul>
                </div>
                
                <div v-if="convForm.from_uom_id && convForm.to_uom_id && convForm.multiplier" class="text-muted small mt-1">
                  Inverse: 1 {{ codeFor(Number(convForm.to_uom_id)) }} =
                  {{ (1 / Number(convForm.multiplier)).toLocaleString(undefined, { maximumFractionDigits: 10 }) }}
                  {{ codeFor(Number(convForm.from_uom_id)) }}
                </div>
              </div>
            </div>

            <div class="mt-3 d-flex gap-2">
              <button class="btn btn-primary" :disabled="convSaving" @click="saveConv">
                <span v-if="convSaving">Saving...</span>
                <span v-else>{{ isEditConv ? "Update Conversion" : "Create Conversion" }}</span>
              </button>
              <button class="btn btn-secondary" :disabled="convSaving" @click="resetConvForm">
                Clear
              </button>
            </div>
          </div>

          <div v-if="convSaving" class="uom-overlay" aria-hidden="true">
            <div class="text-center">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div class="small text-muted mt-2">Saving conversion…</div>
            </div>
          </div>
        </div>

        <!-- List card (BOTTOM) -->
        <div class="card uom-card">
          <div class="card-header bg-transparent d-flex align-items-center justify-content-between">
            <div>
              <div class="uom-title">Conversions List</div>
              <div class="text-muted small">Click a conversion to load it into the form above.</div>
            </div>

            <button class="btn btn-sm btn-light" :disabled="!convSearch" @click="clearConvSearch">
              Clear search
            </button>
          </div>

          <div class="card-body">
            <label class="form-label mb-1">Search</label>
            <div class="input-group mb-2">
              <span class="input-group-text bg-light"><i class="ri-search-line"></i></span>
              <input v-model="convSearch" class="form-control" placeholder="Search by KG, G, PCS or multiplier..." />
            </div>

            <div class="text-muted small mb-2">
              Showing <strong>{{ filteredConvs.length }}</strong> of <strong>{{ conversions.length }}</strong>
            </div>

            <div class="uom-list">
              <div v-if="filteredConvs.length === 0" class="uom-empty text-muted">
                No matching conversions.
              </div>

              <button
                v-for="c in filteredConvs"
                :key="c.id"
                type="button"
                class="conv-row"
                :class="editConvId === c.id ? 'is-selected' : ''"
                @click="editConv(c)"
                title="Click to edit"
              >
                <div class="min-w-0">
                  <div class="fw-semibold truncate">
                    <span class="conv-badge">{{ codeFor(c.from_uom_id) }}</span>
                    <span class="mx-2 text-muted">→</span>
                    <span class="conv-badge soft">{{ codeFor(c.to_uom_id) }}</span>
                  </div>
                  <div class="text-muted small truncate">
                    1 {{ codeFor(c.from_uom_id) }} = <b>{{ c.multiplier }}</b> {{ codeFor(c.to_uom_id) }}
                  </div>
                </div>

                <div class="d-flex gap-2" @click.stop>
                  <button class="btn btn-sm btn-soft-primary" @click="editConv(c)">
                    <i class="ri-edit-line me-1"></i> Edit
                  </button>
                  <button class="btn btn-sm btn-soft-danger" @click="removeConv(c.id)">
                    <i class="ri-delete-bin-6-line me-1"></i> Delete
                  </button>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
/* Theme-compatible using ct tokens */

.uom-card {
  background: var(--ct-secondary-bg);
  border: 1px solid var(--ct-border-color-translucent);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--ct-box-shadow-sm);
}

.uom-title {
  font-weight: 900;
  color: var(--ct-emphasis-color);
  font-size: 16px;
}

.uom-pill {
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

.uom-list {
  display: grid;
  gap: 8px;
}

.uom-empty {
  border: 1px dashed var(--ct-border-color);
  border-radius: 12px;
  padding: 14px;
  background: var(--ct-secondary-bg);
}

.uom-row {
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

.uom-row:hover {
  transform: translateY(-1px);
  border-color: rgba(var(--ct-primary-rgb), 0.22);
  box-shadow: var(--ct-box-shadow-lg);
}

.uom-row.is-selected {
  border-color: rgba(var(--ct-primary-rgb), 0.40);
  box-shadow: 0 12px 26px rgba(var(--ct-primary-rgb), 0.14);
}

.uom-code {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: var(--ct-border-radius-pill);
  font-weight: 900;
  letter-spacing: .4px;
  font-size: 12px;
  color: var(--ct-primary);
  background: rgba(var(--ct-primary-rgb), 0.12);
  border: 1px solid rgba(var(--ct-primary-rgb), 0.18);
}

.uom-row-title {
  color: var(--ct-emphasis-color);
}

.uom-edit-hint {
  color: var(--ct-secondary-color);
}

/* Conversions row */
.conv-row {
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

.conv-row:hover {
  transform: translateY(-1px);
  border-color: rgba(var(--ct-primary-rgb), 0.22);
  box-shadow: var(--ct-box-shadow-lg);
}

.conv-row.is-selected {
  border-color: rgba(var(--ct-primary-rgb), 0.40);
  box-shadow: 0 12px 26px rgba(var(--ct-primary-rgb), 0.14);
}

.conv-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: var(--ct-border-radius-pill);
  font-weight: 900;
  font-size: 12px;
  color: var(--ct-primary);
  background: rgba(var(--ct-primary-rgb), 0.10);
  border: 1px solid rgba(var(--ct-primary-rgb), 0.16);
}

.conv-badge.soft {
  color: var(--ct-body-color);
  background: var(--ct-light-bg-subtle);
  border-color: var(--ct-border-color-translucent);
}

/* Utility */
.truncate {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Overlay */
.uom-overlay {
  position: absolute;
  inset: 0;
  background: rgba(var(--ct-body-bg-rgb), 0.72);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.uom-card--overflow {
  overflow: visible !important;
}

/* If your SearchSelect is based on vue-select (common), boost menu z-index */
.uom-card--overflow :deep(.vs__dropdown-menu) {
  z-index: 9999;
}

/* If your SearchSelect uses a different menu class, add it too */
.uom-card--overflow :deep(.dropdown-menu),
.uom-card--overflow :deep(.search-select__menu),
.uom-card--overflow :deep(.search-select__dropdown) {
  z-index: 9999;
}
</style>
