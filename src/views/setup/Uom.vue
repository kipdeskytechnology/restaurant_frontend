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
const refreshing = ref(false);

const uoms = ref([]);
const conversions = ref([]);

const uomSaving = ref(false);
const convSaving = ref(false);

// Modals
const uomModalEl = ref(null);
let uomModalInstance = null;
const convModalEl = ref(null);
let convModalInstance = null;

const editUomId = ref(null);
const uomTriedSubmit = ref(false);
const uomForm = ref({ code: "", name: "" });

const editConvId = ref(null);
const convTriedSubmit = ref(false);
const convForm = ref({ from_uom_id: "", to_uom_id: "", multiplier: "" });

// Search
const uomSearch = ref("");
const convSearch = ref("");

const isEditUom = computed(() => !!editUomId.value);
const isEditConv = computed(() => !!editConvId.value);

const uomMap = computed(() => {
  const m = new Map();
  for (const u of uoms.value || []) m.set(u.id, u);
  return m;
});
const uomOptions = computed(() =>
  (uoms.value || []).map((u) => ({ label: `${u.code} — ${u.name}`, value: u.id }))
);

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
    return `${from} ${to} ${c.multiplier}`.toLowerCase().includes(q);
  });
});

function uomCode(id) {
  return (uomMap.value.get(Number(id))?.code || "").toUpperCase();
}
function codeFor(id) { return uomMap.value.get(id)?.code || String(id); }
function nameFor(id) { return uomMap.value.get(id)?.name || ""; }

function fmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return x.toLocaleString(undefined, { maximumFractionDigits: 10 });
}

// expected conversions for sanity-check warnings
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
  fromId = Number(fromId); toId = Number(toId);
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

  if (mult > 1e6 || mult < 1e-6) {
    out.push(`Multiplier looks extreme: 1 ${fromC} = ${fmt(mult)} ${toC}.`);
  }
  const exp = expectedMultiplier(fromC, toC);
  if (exp != null) {
    const diff = Math.abs(mult - exp) / exp;
    if (diff > 0.05) out.push(`Typical: 1 ${fromC} = ${fmt(exp)} ${toC} (you entered ${fmt(mult)}).`);
  }
  const implied = factorFromExisting(fromId, toId, editConvId.value);
  if (implied != null) {
    const diff = Math.abs(mult - implied) / implied;
    if (diff > 0.02) out.push(`Existing conversions imply ~${fmt(implied)} ${toC} per 1 ${fromC}.`);
  }
  const rev = (conversions.value || []).find(
    (c) => Number(c.from_uom_id) === toId && Number(c.to_uom_id) === fromId
  );
  if (rev) {
    const revMult = Number(rev.multiplier);
    if (Number.isFinite(revMult) && revMult > 0) {
      const prod = mult * revMult;
      if (Math.abs(prod - 1) > 0.05) {
        out.push(`Reverse conversion exists; expected mult × reverse ≈ 1 (currently ${fmt(prod)}).`);
      }
    }
  }
  return out;
});

async function ensureModal(refEl, key) {
  if (key === "uom" && uomModalInstance) return uomModalInstance;
  if (key === "conv" && convModalInstance) return convModalInstance;
  let inst = null;
  try {
    const m = await import("bootstrap/js/dist/modal");
    inst = new m.default(refEl.value, { backdrop: "static", keyboard: false });
  } catch {
    inst = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(refEl.value, { backdrop: "static", keyboard: false })
      : null;
  }
  if (key === "uom") uomModalInstance = inst;
  else convModalInstance = inst;
  return inst;
}

function resetUomForm() {
  editUomId.value = null;
  uomTriedSubmit.value = false;
  uomForm.value = { code: "", name: "" };
}
async function openCreateUom() {
  resetUomForm();
  const inst = await ensureModal(uomModalEl, "uom");
  inst?.show();
  await nextTick();
}
async function openEditUom(u) {
  editUomId.value = u.id;
  uomTriedSubmit.value = false;
  uomForm.value = { code: u.code || "", name: u.name || "" };
  const inst = await ensureModal(uomModalEl, "uom");
  inst?.show();
  await nextTick();
}

function resetConvForm() {
  editConvId.value = null;
  convTriedSubmit.value = false;
  convForm.value = { from_uom_id: "", to_uom_id: "", multiplier: "" };
}
async function openCreateConv() {
  resetConvForm();
  const inst = await ensureModal(convModalEl, "conv");
  inst?.show();
  await nextTick();
}
async function openEditConv(c) {
  editConvId.value = c.id;
  convTriedSubmit.value = false;
  convForm.value = {
    from_uom_id: c.from_uom_id,
    to_uom_id: c.to_uom_id,
    multiplier: Number(c.multiplier),
  };
  const inst = await ensureModal(convModalEl, "conv");
  inst?.show();
  await nextTick();
}

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    uoms.value = await listUoms();
    conversions.value = await listUomConversions();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load UOM setup");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function saveUom() {
  uomTriedSubmit.value = true;
  const payload = { ...uomForm.value };
  payload.code = (payload.code || "").trim().toUpperCase();
  payload.name = (payload.name || "").trim();
  if (!payload.code || !payload.name) {
    toast.error("Code and name are required");
    return;
  }

  uomSaving.value = true;
  try {
    if (editUomId.value) {
      await updateUom(editUomId.value, payload);
      toast.success("UOM updated");
    } else {
      await createUom(payload);
      toast.success("UOM created");
    }
    uomModalInstance?.hide();
    resetUomForm();
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save UOM");
  } finally {
    uomSaving.value = false;
  }
}

async function saveConv() {
  convTriedSubmit.value = true;
  const payload = { ...convForm.value };
  payload.from_uom_id = Number(payload.from_uom_id);
  payload.to_uom_id = Number(payload.to_uom_id);
  payload.multiplier = Number(payload.multiplier);

  if (!payload.from_uom_id || !payload.to_uom_id) { toast.error("Pick From and To UOM"); return; }
  if (payload.from_uom_id === payload.to_uom_id) { toast.error("From and To UOM cannot be the same"); return; }
  if (!payload.multiplier || payload.multiplier <= 0) { toast.error("Multiplier must be > 0"); return; }

  convSaving.value = true;
  try {
    if (editConvId.value) {
      await updateUomConversion(editConvId.value, { multiplier: payload.multiplier });
      toast.success("Conversion updated");
    } else {
      await createUomConversion(payload);
      toast.success("Conversion created");
    }
    convModalInstance?.hide();
    resetConvForm();
    await load(false);
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
    await load(false);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete conversion");
  }
}

function stop(e) { e?.stopPropagation?.(); }

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
      <!-- ============== HERO ============== -->
      <div class="page-hero">
        <div class="page-hero-text">
          <div class="eyebrow">
            <i class="ri-ruler-2-line"></i><span>Setup</span>
          </div>
          <h1 class="hero-title">UOM Setup</h1>
          <p class="hero-sub">
            Define your units of measure (KG, L, PCS…) and how they convert into each other (1 KG = 1000 G). Recipes and stock movements rely on this.
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
          <div class="stat-icon tone-primary"><i class="ri-ruler-2-line"></i></div>
          <div>
            <div class="stat-label">UOMs</div>
            <div class="stat-value">{{ uoms.length }}</div>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-icon tone-info"><i class="ri-repeat-2-line"></i></div>
          <div>
            <div class="stat-label">Conversions</div>
            <div class="stat-value">{{ conversions.length }}</div>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading UOM setup…</div>
        </div>
      </div>

      <div v-else class="row g-3">
        <!-- ============== UOMs ============== -->
        <div class="col-lg-5">
          <div class="card panel-card">
            <div class="panel-head">
              <div>
                <div class="panel-eyebrow">Units</div>
                <div class="panel-title">UOM list</div>
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="status-pill pill-soft">
                  <i class="ri-ruler-2-line"></i> {{ filteredUoms.length }}
                </span>
                <button v-can="'uom:manage'" class="btn btn-soft-primary btn-sm" @click="openCreateUom">
                  <i class="ri-add-line me-1"></i>New
                </button>
              </div>
            </div>

            <div class="card-body p-3">
              <div class="position-relative mb-2">
                <i class="ri-search-line search-ico"></i>
                <input v-model="uomSearch" class="form-control ps-5" placeholder="Search by code or name…" />
              </div>

              <div v-if="filteredUoms.length === 0" class="empty-inline">
                <div class="empty-inline-icon"><i class="ri-ruler-2-line"></i></div>
                <div class="small text-muted">{{ uoms.length === 0 ? 'No UOMs yet — add KG, L, PCS, BOX…' : 'No matching UOMs.' }}</div>
              </div>

              <div v-else class="row-list">
                <button
                  v-for="u in filteredUoms"
                  :key="u.id"
                  type="button"
                  class="row-tile"
                  @click="openEditUom(u)"
                >
                  <div class="d-flex align-items-center gap-2 min-w-0">
                    <span class="uom-code-chip">{{ u.code }}</span>
                    <div class="min-w-0">
                      <div class="row-title truncate">{{ u.name }}</div>
                      <div class="row-sub">ID #{{ u.id }}</div>
                    </div>
                  </div>
                  <i class="ri-pencil-line edit-hint"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- ============== Conversions ============== -->
        <div class="col-lg-7">
          <div class="card panel-card">
            <div class="panel-head">
              <div>
                <div class="panel-eyebrow">Conversions</div>
                <div class="panel-title">UOM conversions</div>
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="status-pill pill-soft">
                  <i class="ri-repeat-2-line"></i> {{ filteredConvs.length }}
                </span>
                <button v-can="'uom:manage'" class="btn btn-soft-primary btn-sm" @click="openCreateConv" :disabled="uoms.length < 2">
                  <i class="ri-add-line me-1"></i>New
                </button>
              </div>
            </div>

            <div class="card-body p-3">
              <div class="position-relative mb-2">
                <i class="ri-search-line search-ico"></i>
                <input v-model="convSearch" class="form-control ps-5" placeholder="Search by KG, G, multiplier…" />
              </div>

              <div v-if="uoms.length < 2" class="empty-inline">
                <div class="empty-inline-icon"><i class="ri-information-line"></i></div>
                <div class="small text-muted">Add at least 2 UOMs to define conversions.</div>
              </div>

              <div v-else-if="filteredConvs.length === 0" class="empty-inline">
                <div class="empty-inline-icon"><i class="ri-repeat-2-line"></i></div>
                <div class="small text-muted">{{ conversions.length === 0 ? 'No conversions yet — try 1 KG = 1000 G.' : 'No matching conversions.' }}</div>
              </div>

              <div v-else class="row-list">
                <div
                  v-for="c in filteredConvs"
                  :key="c.id"
                  class="conv-tile"
                  role="button"
                  tabindex="0"
                  @click="openEditConv(c)"
                  @keydown.enter.prevent="openEditConv(c)"
                  @keydown.space.prevent="openEditConv(c)"
                >
                  <div class="conv-eq">
                    <div class="conv-side">
                      <div class="side-num">1</div>
                      <span class="uom-code-chip">{{ codeFor(c.from_uom_id) }}</span>
                    </div>
                    <div class="conv-arrow">
                      <i class="ri-arrow-right-line"></i>
                    </div>
                    <div class="conv-side conv-side-to">
                      <div class="side-num">{{ fmt(c.multiplier) }}</div>
                      <span class="uom-code-chip soft">{{ codeFor(c.to_uom_id) }}</span>
                    </div>
                  </div>
                  <div class="conv-actions" @click="stop">
                    <button v-can="'uom:manage'" class="row-icon-btn" title="Edit" @click="openEditConv(c)">
                      <i class="ri-pencil-line"></i>
                    </button>
                    <button v-can="'uom:manage'" class="row-icon-btn danger" title="Delete" @click="removeConv(c.id)">
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

    <!-- ============== Modal: UOM ============== -->
    <div class="modal fade" tabindex="-1" aria-hidden="true" ref="uomModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditUom ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isEditUom ? "Edit UOM" : "New UOM" }}</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="uomSaving"></button>
          </div>

          <div v-if="uomSaving" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <form @submit.prevent="saveUom" novalidate :class="{ 'was-validated': uomTriedSubmit }">
              <div class="row g-3">
                <div class="col-md-4">
                  <label class="form-label">Code *</label>
                  <input v-model="uomForm.code" class="form-control text-uppercase" placeholder="KG" required autocomplete="off" />
                  <div class="form-text">Auto-uppercased</div>
                </div>
                <div class="col-md-8">
                  <label class="form-label">Name *</label>
                  <input v-model="uomForm.name" class="form-control" placeholder="Kilogram" required autocomplete="off" />
                </div>
                <div class="col-12">
                  <div class="tip-card">
                    <i class="ri-lightbulb-flash-line tip-icon"></i>
                    <div class="small">
                      <div class="fw-semibold mb-1">Pro tip</div>
                      <div class="text-muted">
                        Use short, conventional codes — KG, G, L, ML, PCS, BOX, CTN. Define conversions afterwards so recipes can scale.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="uomSaving">Cancel</button>
            <button v-can="'uom:manage'" class="btn btn-primary" :disabled="uomSaving" @click="saveUom">
              <span v-if="uomSaving" class="spinner-border spinner-border-sm me-1"></span>
              {{ isEditUom ? "Update UOM" : "Create UOM" }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Modal: Conversion ============== -->
    <div class="modal fade" tabindex="-1" aria-hidden="true" ref="convModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">{{ isEditConv ? 'Edit' : 'New' }}</div>
              <h5 class="modal-title">{{ isEditConv ? "Edit conversion" : "New conversion" }}</h5>
            </div>
            <button class="btn-close" data-bs-dismiss="modal" :disabled="convSaving"></button>
          </div>

          <div v-if="convSaving" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <div class="conv-builder mb-3">
              <div class="cb-side">
                <div class="cb-num">1</div>
                <SearchSelect
                  v-model="convForm.from_uom_id"
                  :options="uomOptions"
                  placeholder="From UOM…"
                  search-placeholder="Type to search…"
                  :disabled="convSaving || isEditConv"
                />
                <div class="cb-name">{{ nameFor(convForm.from_uom_id) }}</div>
              </div>

              <div class="cb-arrow">
                <i class="ri-arrow-right-line"></i>
                <div class="cb-eq">=</div>
              </div>

              <div class="cb-side">
                <input
                  v-model="convForm.multiplier"
                  type="number"
                  step="0.00000001"
                  class="form-control cb-mult"
                  placeholder="multiplier"
                />
                <SearchSelect
                  v-model="convForm.to_uom_id"
                  :options="uomOptions"
                  placeholder="To UOM…"
                  search-placeholder="Type to search…"
                  :disabled="convSaving || isEditConv"
                />
                <div class="cb-name">{{ nameFor(convForm.to_uom_id) }}</div>
              </div>
            </div>

            <div v-if="convForm.from_uom_id && convForm.to_uom_id && convForm.multiplier" class="inverse-card mb-3">
              <i class="ri-refresh-line me-1"></i>
              <strong>Inverse:</strong> 1 {{ codeFor(Number(convForm.to_uom_id)) }} =
              <span class="inverse-val">{{ (1 / Number(convForm.multiplier)).toLocaleString(undefined, { maximumFractionDigits: 10 }) }}</span>
              {{ codeFor(Number(convForm.from_uom_id)) }}
            </div>

            <div v-if="convWarnings.length" class="warn-card mb-3">
              <i class="ri-alert-line"></i>
              <div>
                <div class="fw-semibold mb-1">Please double-check this conversion</div>
                <ul class="mb-0 ps-3 small">
                  <li v-for="(w, i) in convWarnings" :key="i">{{ w }}</li>
                </ul>
              </div>
            </div>

            <div v-if="isEditConv" class="tip-card">
              <i class="ri-information-line tip-icon"></i>
              <div class="small">
                <div class="fw-semibold mb-1">Editing conversion</div>
                <div class="text-muted">
                  Only the multiplier can change. To switch units, delete this conversion and create a new one.
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-light" data-bs-dismiss="modal" :disabled="convSaving">Cancel</button>
            <button v-can="'uom:manage'" class="btn btn-primary" :disabled="convSaving" @click="saveConv">
              <span v-if="convSaving" class="spinner-border spinner-border-sm me-1"></span>
              {{ isEditConv ? "Update conversion" : "Create conversion" }}
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
.panel-eyebrow { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ct-primary, #6366f1); }
.panel-title { font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 1.05rem; color: var(--ct-body-color, #0f172a); }

.search-ico { position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%); color: var(--ct-secondary-color, #94a3b8); pointer-events: none; }

/* ============= Row lists ============= */
.row-list {
  display: flex; flex-direction: column; gap: 0.5rem;
  max-height: calc(100vh - 500px);
  min-height: 200px;
  overflow-y: auto;
  scrollbar-width: thin;
  padding-right: 4px;
}
.row-list::-webkit-scrollbar { width: 8px; }
.row-list::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }

.row-tile {
  width: 100%;
  text-align: left;
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.75rem;
  padding: 0.7rem 0.95rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
}
.row-tile:hover {
  border-color: rgba(99,102,241,0.4);
  transform: translateY(-1px);
  box-shadow: 0 8px 18px -10px rgba(15,23,42,0.18);
}
.uom-code-chip {
  display: inline-flex; align-items: center;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 800; font-size: 0.78rem; letter-spacing: 0.04em;
  padding: 0.3rem 0.6rem;
  border-radius: 8px;
  background: rgba(99,102,241,0.12);
  color: var(--ct-primary, #6366f1);
  border: 1px solid rgba(99,102,241,0.2);
  flex-shrink: 0;
}
.uom-code-chip.soft {
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-body-color, #0f172a);
  border-color: var(--ct-border-color, #e6e9ef);
}
.row-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 700; font-size: 0.92rem;
  color: var(--ct-body-color, #0f172a);
}
.row-sub {
  font-size: 0.7rem;
  color: var(--ct-secondary-color, #64748b);
  font-family: "JetBrains Mono", ui-monospace, monospace;
}
.edit-hint { color: var(--ct-secondary-color, #94a3b8); font-size: 1rem; }
.truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.min-w-0 { min-width: 0; }

/* Conversion tile */
.conv-tile {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.75rem;
  padding: 0.7rem 0.95rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  border-radius: 12px;
  cursor: pointer; outline: none;
  transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
}
.conv-tile:hover, .conv-tile:focus {
  border-color: rgba(99,102,241,0.4);
  transform: translateY(-1px);
  box-shadow: 0 8px 18px -10px rgba(15,23,42,0.18);
}
.conv-eq {
  display: flex; align-items: center; gap: 0.5rem;
  flex-wrap: wrap;
}
.conv-side { display: flex; align-items: center; gap: 0.4rem; }
.side-num {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  color: var(--ct-body-color, #0f172a);
  font-size: 1rem;
  letter-spacing: -0.01em;
}
.conv-arrow {
  color: var(--ct-secondary-color, #94a3b8);
  font-size: 1rem;
}
.conv-actions { display: flex; gap: 0.25rem; flex-shrink: 0; }
.row-icon-btn {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: none; background: transparent;
  color: var(--ct-secondary-color, #64748b);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
}
.row-icon-btn:hover { background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); }
.row-icon-btn.danger:hover { background: rgba(239,68,68,0.1); color: #ef4444; }

.status-pill {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.15rem 0.5rem; border-radius: 999px;
  font-size: 0.68rem; font-weight: 700;
}
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

/* ============= Conversion builder (in modal) ============= */
.conv-builder {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0.75rem;
  align-items: start;
  padding: 1rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 14px;
}
.cb-side { display: flex; flex-direction: column; gap: 0.4rem; }
.cb-num {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 1.4rem;
  color: var(--ct-primary, #6366f1);
  text-align: center;
  padding: 0.4rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
}
.cb-mult {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700;
  text-align: center;
}
.cb-name {
  font-size: 0.78rem;
  color: var(--ct-secondary-color, #64748b);
  text-align: center;
  font-style: italic;
  min-height: 1em;
}
.cb-arrow {
  display: flex; flex-direction: column; align-items: center;
  padding-top: 0.5rem;
}
.cb-arrow i {
  font-size: 1.5rem;
  color: var(--ct-secondary-color, #94a3b8);
}
.cb-eq {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800; font-size: 1.5rem;
  color: var(--ct-primary, #6366f1);
}

@media (max-width: 575.98px) {
  .conv-builder { grid-template-columns: 1fr; }
  .cb-arrow { flex-direction: row; gap: 0.5rem; padding-top: 0; justify-content: center; }
}

.inverse-card {
  display: flex; align-items: center;
  padding: 0.65rem 0.95rem;
  background: rgba(6,182,212,0.06);
  border: 1px solid rgba(6,182,212,0.2);
  border-radius: 10px;
  font-size: 0.85rem;
  color: var(--ct-body-color, #0f172a);
}
.inverse-val {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700;
  color: #0e7490;
  margin: 0 0.25rem;
}

.warn-card {
  display: flex; gap: 0.65rem; align-items: flex-start;
  padding: 0.85rem 1rem;
  background: rgba(245,158,11,0.08);
  border: 1px solid rgba(245,158,11,0.3);
  border-radius: 12px;
  color: #b45309;
}
.warn-card i { font-size: 1.4rem; flex-shrink: 0; }

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
  overflow-x: visible; /* let SearchSelect dropdowns escape */
}
/* SearchSelect menus need to float over neighboring panels */
:deep(.vs__dropdown-menu),
:deep(.search-select__menu),
:deep(.search-select__dropdown) { z-index: 9999 !important; }

.modal-overlay {
  position: absolute; inset: 0; z-index: 5;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
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
