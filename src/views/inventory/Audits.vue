<script setup>
import { ref, computed, onMounted, nextTick } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";

import {
  listInventoryAudits,
  createInventoryAudit,
  replaceInventoryAuditLines,
  listInventoryItems,
} from "../../api/inventory";

import { listOutlets } from "../../api/lookups";

const toast = useToast();

const loading = ref(true);
const refreshing = ref(false);
const audits = ref([]);
const outlets = ref([]);
const items = ref([]);

const filters = ref({
  outlet_id: "",
  status: "all",
});

const saving = ref(false);

const createForm = ref({
  outlet_id: "",
  note: "",
});

const activeAudit = ref(null);

const lineItemId = ref("");
const lineQty = ref("");
const lineNote = ref("");
const linesDraft = ref([]);

const createModalEl = ref(null);
const linesModalEl = ref(null);
let createModalInstance = null;
let linesModalInstance = null;

const itemById = computed(() => {
  const m = new Map();
  for (const it of items.value) m.set(it.id, it);
  return m;
});

const outletById = computed(() => {
  const m = new Map();
  for (const o of outlets.value) m.set(o.id, o);
  return m;
});

const summary = computed(() => {
  const total = audits.value.length;
  const draft = audits.value.filter((a) => a.status === "DRAFT").length;
  const posted = audits.value.filter((a) => a.status === "POSTED").length;
  return { total, draft, posted };
});

const PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f59e0b", "#10b981", "#06b6d4", "#0ea5e9",
];
function colorFor(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

async function ensureModal(refEl, instanceKey) {
  if (instanceKey === "create" && createModalInstance) return createModalInstance;
  if (instanceKey === "lines" && linesModalInstance) return linesModalInstance;

  let inst = null;
  try {
    const m = await import("bootstrap/js/dist/modal");
    inst = new m.default(refEl.value, { backdrop: "static", keyboard: false });
  } catch {
    inst = window.bootstrap?.Modal
      ? new window.bootstrap.Modal(refEl.value, { backdrop: "static", keyboard: false })
      : null;
  }
  if (instanceKey === "create") createModalInstance = inst;
  else linesModalInstance = inst;
  return inst;
}

async function loadAudits(showSpinner = false) {
  if (showSpinner) refreshing.value = true;
  try {
    const params = {
      outlet_id: filters.value.outlet_id ? Number(filters.value.outlet_id) : undefined,
      status: filters.value.status,
    };
    audits.value = await listInventoryAudits(params);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load audits");
  } finally {
    refreshing.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    const [o, it] = await Promise.all([listOutlets(), listInventoryItems({ limit: 500 })]);
    outlets.value = o;
    items.value = it;
    await loadAudits();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load audits");
  } finally {
    loading.value = false;
  }
}

async function openCreate() {
  createForm.value = {
    outlet_id: outlets.value?.[0]?.id || "",
    note: "",
  };
  const inst = await ensureModal(createModalEl, "create");
  inst?.show();
  await nextTick();
}

async function saveCreate() {
  if (!createForm.value.outlet_id) {
    toast.error("Outlet is required");
    return;
  }
  saving.value = true;
  try {
    const a = await createInventoryAudit({
      outlet_id: Number(createForm.value.outlet_id),
      note: createForm.value.note?.trim() || null,
    });

    toast.success("Audit created");
    await loadAudits();

    createModalInstance?.hide();
    await openEditLines(a);
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to create audit");
  } finally {
    saving.value = false;
  }
}

async function openEditLines(a) {
  activeAudit.value = a;
  linesDraft.value = (a.lines || []).map((ln) => ({
    inventory_item_id: ln.inventory_item_id,
    counted_qty: Number(ln.counted_qty),
    note: ln.note || "",
  }));

  lineItemId.value = items.value?.[0]?.id || "";
  lineQty.value = "";
  lineNote.value = "";

  const inst = await ensureModal(linesModalEl, "lines");
  inst?.show();
  await nextTick();
}

function addLine() {
  const inventory_item_id = Number(lineItemId.value);
  const counted_qty = Number(lineQty.value);

  if (!inventory_item_id) return toast.error("Pick an item");
  if (!Number.isFinite(counted_qty)) return toast.error("Enter counted qty");

  const row = { inventory_item_id, counted_qty, note: (lineNote.value || "").trim() };
  const idx = linesDraft.value.findIndex((x) => x.inventory_item_id === inventory_item_id);

  if (idx >= 0) linesDraft.value[idx] = row;
  else linesDraft.value.push(row);

  lineQty.value = "";
  lineNote.value = "";
}

function removeLine(inventory_item_id) {
  linesDraft.value = linesDraft.value.filter((x) => x.inventory_item_id !== inventory_item_id);
}

async function saveLines() {
  if (!activeAudit.value) return;

  saving.value = true;
  try {
    await replaceInventoryAuditLines(activeAudit.value.id, {
      lines: linesDraft.value.map((x) => ({
        inventory_item_id: x.inventory_item_id,
        counted_qty: x.counted_qty,
        note: x.note || null,
      })),
    });

    toast.success("Lines saved");
    await loadAudits();
    linesModalInstance?.hide();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save lines");
  } finally {
    saving.value = false;
  }
}

function fmt(dt) {
  try {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return dt;
    return d.toLocaleString();
  } catch { return dt; }
}
function fmtDateOnly(dt) {
  try {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return dt;
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  } catch { return dt; }
}
function fmtTimeShort(dt) {
  try {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return dt;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return dt; }
}

function statusTone(s) {
  if (s === "DRAFT") return "warning";
  if (s === "POSTED") return "success";
  return "default";
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
            <i class="ri-clipboard-line"></i><span>Inventory</span>
          </div>
          <h1 class="hero-title">Inventory Audits</h1>
          <p class="hero-sub">
            Walk the shelves, count what's there, post the variance. Every count is a snapshot — DRAFT until you're ready to commit.
          </p>
        </div>

        <div class="page-hero-actions">
          <button class="btn btn-light btn-pill" @click="loadAudits(true)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i><span>Refresh</span>
          </button>
          <button v-can="'inventory:manage'" class="btn btn-pill btn-cta" @click="openCreate">
            <i class="ri-add-line"></i><span>New Audit</span>
          </button>
        </div>
      </div>

      <!-- ============== Toolbar ============== -->
      <div class="card mb-3 toolbar-card">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-md-5">
              <label class="form-label">Outlet</label>
              <select v-model="filters.outlet_id" class="form-select" @change="loadAudits()">
                <option value="">All outlets</option>
                <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
            </div>

            <div class="col-md-5">
              <label class="form-label">Status</label>
              <select v-model="filters.status" class="form-select" @change="loadAudits()">
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="posted">Posted</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div class="col-md-2 d-grid">
              <button class="btn btn-light" @click="loadAudits(true)" :disabled="refreshing">
                <i class="ri-refresh-line me-1"></i>Refresh
              </button>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-3 small text-muted mt-2">
            <span><strong>{{ summary.total }}</strong> audit{{ summary.total === 1 ? '' : 's' }}</span>
            <span class="d-none d-sm-inline">•</span>
            <span><strong class="text-warning">{{ summary.draft }}</strong> draft</span>
            <span class="d-none d-sm-inline">•</span>
            <span><strong class="text-success">{{ summary.posted }}</strong> posted</span>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="card-body d-flex align-items-center gap-2">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          <div class="text-muted">Loading audits…</div>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="!audits.length" class="card empty-card text-center py-5">
        <div class="empty-icon"><i class="ri-clipboard-line"></i></div>
        <h5 class="mt-2 mb-1">No audits yet</h5>
        <p class="text-muted mb-3">Start your first stock count to track variances and reconcile on-hand.</p>
        <div>
          <button v-can="'inventory:manage'" class="btn btn-primary" @click="openCreate">
            <i class="ri-add-line me-1"></i> Start an audit
          </button>
        </div>
      </div>

      <!-- ============== Audits table ============== -->
      <div v-else class="card data-card">
        <div class="card-body p-0">
          <div class="table-responsive data-scroll">
            <table class="table align-middle mb-0 audits-table">
              <thead>
                <tr>
                  <th style="width: 80px">ID</th>
                  <th style="width: 160px">Audited at</th>
                  <th>Outlet</th>
                  <th style="width: 130px">Status</th>
                  <th style="width: 110px" class="text-end">Lines</th>
                  <th>Note</th>
                  <th style="width: 120px" class="text-end"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in audits" :key="a.id">
                  <td>
                    <span class="id-chip">#{{ a.id }}</span>
                  </td>

                  <td>
                    <div class="when-date">{{ fmtDateOnly(a.audited_at) }}</div>
                    <div class="when-time">{{ fmtTimeShort(a.audited_at) }}</div>
                  </td>

                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <div
                        class="outlet-avatar"
                        :style="{ '--accent': colorFor(outletById.get(a.outlet_id)?.name) }"
                      >
                        {{ initialsOf(outletById.get(a.outlet_id)?.name) }}
                      </div>
                      <div class="item-name">
                        {{ outletById.get(a.outlet_id)?.name || `#${a.outlet_id}` }}
                      </div>
                    </div>
                  </td>

                  <td>
                    <span class="status-chip" :class="`tone-${statusTone(a.status)}`">
                      <span class="dot-mini"></span>{{ a.status }}
                    </span>
                  </td>

                  <td class="text-end">
                    <span class="lines-pill">{{ a.lines?.length ?? 0 }}</span>
                  </td>

                  <td class="text-truncate" style="max-width: 320px;">
                    <span v-if="a.note">{{ a.note }}</span>
                    <span v-else class="text-muted">—</span>
                  </td>

                  <td class="text-end">
                    <button class="row-icon-btn" title="Edit lines" @click="openEditLines(a)">
                      <i class="ri-pencil-line"></i>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Modal: Create Audit ============== -->
    <div class="modal fade" id="inventoryAuditCreateModal" tabindex="-1" aria-hidden="true" ref="createModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">New</div>
              <h5 class="modal-title">Start a new audit</h5>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" :disabled="saving"></button>
          </div>

          <div v-if="saving" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Creating…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label">Outlet *</label>
                <select v-model="createForm.outlet_id" class="form-select" required>
                  <option value="" disabled>— Select outlet —</option>
                  <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
                </select>
              </div>

              <div class="col-12">
                <label class="form-label">Note</label>
                <textarea
                  v-model="createForm.note"
                  class="form-control"
                  rows="3"
                  placeholder="Optional context — e.g. month-end count, surprise audit, opening shift…"
                />
              </div>

              <div class="col-12">
                <div class="tip-card">
                  <i class="ri-lightbulb-flash-line tip-icon"></i>
                  <div class="small">
                    <div class="fw-semibold mb-1">What happens next</div>
                    <div class="text-muted">
                      The audit is created in DRAFT status. You'll be taken straight to the counting screen to enter what you see on the shelf.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Cancel</button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="saveCreate">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              Create &amp; start counting
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============== Modal: Edit Lines ============== -->
    <div class="modal fade" id="inventoryAuditLinesModal" tabindex="-1" aria-hidden="true" ref="linesModalEl" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-xl">
        <div class="modal-content modal-modern position-relative">
          <div class="modal-header modal-header-modern">
            <div>
              <div class="modal-eyebrow">Audit #{{ activeAudit?.id }}</div>
              <h5 class="modal-title">Counted lines</h5>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" :disabled="saving"></button>
          </div>

          <div v-if="saving" class="modal-overlay">
            <div class="text-center">
              <span class="spinner-border"></span>
              <div class="small text-muted mt-2">Saving…</div>
            </div>
          </div>

          <div class="modal-body modal-body-modern">
            <!-- Add line panel -->
            <div class="add-line-card">
              <div class="row g-2 align-items-end">
                <div class="col-md-6">
                  <label class="form-label">Item</label>
                  <select v-model="lineItemId" class="form-select">
                    <option value="" disabled>— Choose item —</option>
                    <option v-for="it in items" :key="it.id" :value="it.id">{{ it.name }}</option>
                  </select>
                </div>

                <div class="col-md-3">
                  <label class="form-label">Counted qty</label>
                  <input
                    v-model="lineQty"
                    type="number"
                    step="0.000001"
                    class="form-control"
                    placeholder="e.g. 12.5"
                    @keyup.enter="addLine"
                  />
                </div>

                <div class="col-md-3">
                  <label class="form-label">Note</label>
                  <input
                    v-model="lineNote"
                    class="form-control"
                    placeholder="optional"
                    @keyup.enter="addLine"
                  />
                </div>

                <div class="col-12 d-flex justify-content-end">
                  <button type="button" class="btn btn-soft-primary" @click="addLine">
                    <i class="ri-add-line me-1"></i>Add / update line
                  </button>
                </div>
              </div>
            </div>

            <!-- Lines table -->
            <div class="table-responsive mt-3 lines-scroll">
              <table class="table align-middle mb-0 audits-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style="width: 160px" class="text-end">Counted qty</th>
                    <th>Note</th>
                    <th style="width: 90px"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="ln in linesDraft" :key="ln.inventory_item_id">
                    <td>
                      <div class="d-flex align-items-center gap-2">
                        <div
                          class="outlet-avatar"
                          :style="{ '--accent': colorFor(itemById.get(ln.inventory_item_id)?.name) }"
                        >
                          {{ initialsOf(itemById.get(ln.inventory_item_id)?.name) }}
                        </div>
                        <div class="item-name">
                          {{ itemById.get(ln.inventory_item_id)?.name || `#${ln.inventory_item_id}` }}
                        </div>
                      </div>
                    </td>
                    <td class="text-end">
                      <span class="counted-pill">{{ ln.counted_qty }}</span>
                    </td>
                    <td>{{ ln.note || "—" }}</td>
                    <td class="text-end">
                      <button class="row-icon-btn danger" title="Remove" @click="removeLine(ln.inventory_item_id)">
                        <i class="ri-delete-bin-line"></i>
                      </button>
                    </td>
                  </tr>

                  <tr v-if="linesDraft.length === 0">
                    <td colspan="4" class="text-center text-muted py-4">
                      <i class="ri-inbox-line d-block mb-1" style="font-size: 1.6rem;"></i>
                      No lines yet — add the first count above.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="modal-footer">
            <div class="me-auto small text-muted">
              <i class="ri-information-line me-1"></i>{{ linesDraft.length }} line{{ linesDraft.length === 1 ? '' : 's' }}
            </div>
            <button type="button" class="btn btn-light" data-bs-dismiss="modal" :disabled="saving">Close</button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="saveLines">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              Save lines
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
  background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 60%, #8b5cf6 100%);
  color: #fff; box-shadow: 0 20px 40px -20px rgba(14,165,233,0.55);
  overflow: hidden; flex-wrap: wrap;
}
.page-hero::before {
  content: ""; position: absolute; inset: 0;
  background:
    radial-gradient(220px 140px at 90% 10%, rgba(255,255,255,0.22), transparent 65%),
    radial-gradient(280px 180px at 0% 110%, rgba(255,255,255,0.14), transparent 65%);
  pointer-events: none;
}
.page-hero-text { position: relative; max-width: 600px; }
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
.page-hero-actions .btn-light { background: rgba(255,255,255,0.95); color: #1e293b; border: none; }
.btn-cta { background: #fff !important; color: #6366f1 !important; font-weight: 700; border: none; box-shadow: 0 8px 16px -8px rgba(0,0,0,0.3); }

/* ============= Toolbar / Empty ============= */
.toolbar-card { background: linear-gradient(135deg, rgba(99,102,241,0.04) 0%, transparent 100%); }
.empty-card { background: var(--ct-card-bg, #fff); border: 1px solid var(--ct-border-color, #e6e9ef); }
.empty-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin: 0 auto;
  border-radius: 16px; background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1); font-size: 1.6rem;
}

/* ============= Audits table ============= */
.data-card { overflow: hidden; }
.data-scroll {
  max-height: calc(100vh - 360px);
  min-height: 240px;
  overflow: auto;
  scrollbar-width: thin;
}
.data-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.data-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }
.data-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.5); }

.audits-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: inset 0 -1px 0 var(--ct-border-color, #e6e9ef);
}

/* Lines table inside the edit-lines modal — scrolls within the modal body */
.lines-scroll {
  max-height: 45vh;
  overflow: auto;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 12px;
  scrollbar-width: thin;
}
.lines-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.lines-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }
.id-chip {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.78rem; font-weight: 700;
  padding: 0.2rem 0.5rem; border-radius: 6px;
  background: rgba(99,102,241,0.1); color: var(--ct-primary, #6366f1);
  border: 1px solid rgba(99,102,241,0.2);
}
.when-date { font-weight: 700; font-size: 0.82rem; color: var(--ct-body-color, #0f172a); line-height: 1.2; }
.when-time { font-size: 0.72rem; color: var(--ct-secondary-color, #64748b); font-family: "JetBrains Mono", ui-monospace, monospace; }

.outlet-avatar {
  width: 32px; height: 32px; border-radius: 9px;
  display: grid; place-items: center;
  font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800; font-size: 0.72rem;
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 24%, transparent);
  flex-shrink: 0;
}
.item-name { font-weight: 700; color: var(--ct-body-color, #0f172a); line-height: 1.2; }

.status-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.72rem; font-weight: 700;
  letter-spacing: 0.04em;
}
.dot-mini { width: 6px; height: 6px; border-radius: 50%; }
.tone-warning { background: rgba(245,158,11,0.18); color: #b45309; }
.tone-warning .dot-mini { background: #f59e0b; }
.tone-success { background: rgba(16,185,129,0.14); color: #047857; }
.tone-success .dot-mini { background: #10b981; }
.tone-default { background: rgba(100,116,139,0.14); color: #475569; }
.tone-default .dot-mini { background: #64748b; }

.lines-pill {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 8px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700; font-size: 0.78rem;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  color: var(--ct-secondary-color, #475569);
  min-width: 36px; text-align: center;
}

.counted-pill {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 6px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700; font-size: 0.78rem;
  background: rgba(99,102,241,0.1);
  color: var(--ct-primary, #6366f1);
  border: 1px solid rgba(99,102,241,0.2);
}

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
:deep(.modal-eyebrow) {
  font-size: 0.68rem; font-weight: 700; color: var(--ct-primary, #6366f1);
  letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.25rem;
}
:deep(.modal-header-modern .modal-title) {
  font-family: "Plus Jakarta Sans", sans-serif; font-weight: 800;
  letter-spacing: -0.02em; font-size: 1.25rem;
}
:deep(.modal-body-modern) {
  padding: 1.5rem;
  scrollbar-width: thin;
}
/* Bootstrap's modal-dialog-scrollable already caps body height — make scrollbars match the rest */
:deep(.modal-dialog-scrollable .modal-body)::-webkit-scrollbar { width: 8px; }
:deep(.modal-dialog-scrollable .modal-body)::-webkit-scrollbar-thumb {
  background: rgba(100,116,139,0.3); border-radius: 999px;
}

.modal-overlay {
  position: absolute; inset: 0; z-index: 5;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
}

.add-line-card {
  padding: 1rem;
  border: 1px dashed rgba(99,102,241,0.3);
  border-radius: 12px;
  background: rgba(99,102,241,0.04);
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
