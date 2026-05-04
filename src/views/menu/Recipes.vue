<!-- src/views/menu/Recipes.vue -->
<script setup>
import { ref, onMounted, computed, watch } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import SearchSelect from "../../components/SearchSelect.vue";

import { listMenuItems } from "../../api/menu";
import {
  getRecipeByMenuItem,
  createRecipe,
  replaceRecipeLines,
  deleteRecipeLine,
} from "../../api/recipes";

import { listUoms, listUomConversions } from "../../api/setupUom";
import { listInventoryItems } from "../../api/inventory";
import { getMyStoreProfile } from "../../api/systemStores";

// ✅ PDF (Vite-friendly)
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const toast = useToast();

const loading = ref(false);
const saving = ref(false);
const checking = ref(false);
const exporting = ref(false);

const menuItems = ref([]);
const uoms = ref([]);
const uomConversions = ref([]);
const inventoryItems = ref([]);
const storeProfile = ref(null);

const selectedMenuItemId = ref(null);
const recipe = ref(null);

// snapshots for dirty-check
const savedSnapshot = ref("");

// LEFT filters
const menuSearch = ref("");
const recipeFilter = ref("all"); // all | yes | no

// status map: { [menuId]: { has_recipe: bool, lines_count: number, checked: bool } }
const recipeStatusByMenuId = ref({});

function getMenuPrice(menuItemRaw) {
  // menu item price from backend (MenuItem.price)
  const p = Number(menuItemRaw?.price);
  return Number.isFinite(p) ? p : null;
}

function foodCostPct(cost, price) {
  const c = Number(cost);
  const p = Number(price);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return null;
  return (c / p) * 100;
}

// You can change this threshold any time (e.g. 30% or 35%)
const HIGH_FOOD_COST_PCT = 80;

function costStatus(pct) {
  if (pct == null) return { label: "N/A", kind: "na" };
  if (pct >= HIGH_FOOD_COST_PCT) return { label: "HIGH", kind: "high" };
  return { label: "OK", kind: "ok" };
}

// add line draft (UOM preloaded)
const newLine = ref({
  inventory_item_id: null,
  qty: "",
  uom_id: null,
});

// ---- helpers for URLs (images/logo) ----
const apiBaseURL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";
function absolutizeUrl(u) {
  if (!u || typeof u !== "string") return null;

  if (u.startsWith("http://") || u.startsWith("https://")) return u;

  // Backend mounts StaticFiles at /uploads (see app/main.py), so a stored
  // path like "/uploads/menu/123.png" is served directly at
  // ${apiBaseURL}/uploads/menu/123.png — no /assets prefix.
  if (u.startsWith("/uploads/")) return `${apiBaseURL}${u}`;
  if (u.startsWith("uploads/")) return `${apiBaseURL}/${u}`;

  if (u.startsWith("/")) return `${apiBaseURL}${u}`;
  return `${apiBaseURL}/${u}`;
}

function menuItemImageUrl(m) {
  const u =
    m?.image_url ||
    m?.photo_url ||
    m?.image ||
    m?.imagePath ||
    m?.image_path ||
    m?.thumbnail_url ||
    null;
  return absolutizeUrl(u);
}

function storeLogoUrl(s) {
  const u = s?.logo_url || s?.logo || s?.logoPath || s?.logo_path || null;
  return absolutizeUrl(u);
}

// ---------- lookups ----------
const inventoryOptions = computed(() =>
  (inventoryItems.value || [])
    .map((inv) => ({
      label: inv.name || inv.code || `Item #${inv.id}`,
      value: inv.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
);

const uomOptions = computed(() =>
  (uoms.value || []).map((u) => ({
    label: `${u.code} — ${u.name}`,
    value: u.id,
  }))
);

const invNameById = computed(() => {
  const m = new Map(
    (inventoryItems.value || []).map((x) => [
      x.id,
      x.name || x.code || `Item #${x.id}`,
    ])
  );
  return (id) => m.get(Number(id)) || `Item #${id}`;
});

const invById = computed(() => {
  const m = new Map((inventoryItems.value || []).map((x) => [Number(x.id), x]));
  return m;
});

const uomCodeById = computed(() => {
  const m = new Map((uoms.value || []).map((u) => [Number(u.id), u.code]));
  return (id) => m.get(Number(id)) || "";
});

// Build weighted graph:
// 1 FROM = multiplier * TO  => qty_to = qty_from * multiplier
const convGraph = computed(() => {
  const g = new Map(); // uomId -> [{ to, factor }]
  for (const c of uomConversions.value || []) {
    const from = Number(c.from_uom_id);
    const to = Number(c.to_uom_id);
    const mult = Number(c.multiplier);

    if (!from || !to || !Number.isFinite(mult) || mult <= 0) continue;

    if (!g.has(from)) g.set(from, []);
    if (!g.has(to)) g.set(to, []);

    g.get(from).push({ to, factor: mult });
    g.get(to).push({ to: from, factor: 1 / mult }); // reverse
  }
  return g;
});

// factor(from, to): multiply qty_in_from by this to get qty_in_to
function conversionFactor(fromId, toId) {
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
      if (seen.has(e.to)) continue;
      const f2 = f * e.factor;
      if (e.to === toId) return f2;
      seen.add(e.to);
      q.push({ id: e.to, f: f2 });
    }
  }
  return null;
}

// compatible UOM IDs for an inventory item (base + all reachable via conversions)
// Internal computation — used to populate the memoized cache below.
function _computeCompatibleUomIds(invId) {
  const inv = invById.value.get(Number(invId));
  const baseId = Number(inv?.base_uom_id || 0);

  if (!baseId) return (uoms.value || []).map((u) => Number(u.id));

  const g = convGraph.value;
  const seen = new Set([baseId]);
  const q = [baseId];

  while (q.length) {
    const cur = q.shift();
    for (const e of g.get(cur) || []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      q.push(e.to);
    }
  }

  return Array.from(seen);
}

// PERF: precompute UOM compatibility & options once per inventory item.
// Recomputes only when uoms / conversions / inventory change — not per template render.
const compatibleUomMap = computed(() => {
  const map = new Map();
  for (const inv of inventoryItems.value || []) {
    map.set(Number(inv.id), _computeCompatibleUomIds(Number(inv.id)));
  }
  return map;
});

const uomOptionsMap = computed(() => {
  const map = new Map();
  const allUoms = uoms.value || [];
  for (const [invId, ids] of compatibleUomMap.value) {
    const allowed = new Set(ids);
    map.set(
      invId,
      allUoms
        .filter((u) => allowed.has(Number(u.id)))
        .map((u) => ({ label: `${u.code} — ${u.name}`, value: u.id }))
    );
  }
  return map;
});

const uomsByInvMap = computed(() => {
  const map = new Map();
  const allUoms = uoms.value || [];
  for (const [invId, ids] of compatibleUomMap.value) {
    const allowed = new Set(ids);
    map.set(invId, allUoms.filter((u) => allowed.has(Number(u.id))));
  }
  return map;
});

function compatibleUomIdsForInventory(invId) {
  return compatibleUomMap.value.get(Number(invId)) || _computeCompatibleUomIds(Number(invId));
}

function uomOptionsForInventory(invId) {
  return uomOptionsMap.value.get(Number(invId)) || [];
}

function uomsForInventory(invId) {
  return uomsByInvMap.value.get(Number(invId)) || (uoms.value || []);
}

// PERF: run async tasks with a concurrency cap (avoids hammering the API
// with 500 sequential or 500 parallel requests).
async function runWithConcurrency(items, fn, limit = 10) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try { results[i] = await fn(items[i], i); }
      catch (e) { results[i] = { __err: e }; }
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

// ---------- recipe state ----------
const lines = computed(() => recipe.value?.lines || []);

const payloadSnapshot = computed(() => {
  if (!recipe.value) return "";
  const l = (recipe.value.lines || []).map((x) => ({
    inventory_item_id: Number(x.inventory_item_id),
    qty: Number(x.qty),
    uom_id: Number(x.uom_id),
  }));
  return JSON.stringify(l);
});

const isDirty = computed(() => {
  if (!recipe.value) return false;
  return payloadSnapshot.value !== savedSnapshot.value;
});

const canSave = computed(() => {
  if (!recipe.value) return false;
  if (saving.value) return false;
  return (recipe.value.lines || []).every((l) => {
    const invId = Number(l.inventory_item_id || 0);
    const uomId = Number(l.uom_id || 0);
    const qty = Number(l.qty || 0);
    return invId && uomId && qty > 0;
  });
});

const meta = computed(() => {
  const l = lines.value || [];
  const unique = new Set(l.map((x) => Number(x.inventory_item_id))).size;
  return { total: l.length, unique };
});

// Live cost summary for the recipe editor — uses the SAME helpers as the PDF.
const recipeCostSummary = computed(() => {
  if (!recipe.value) return null;
  const { cost, countedLines, skippedLines } = computeRecipeCost(recipe.value);
  const price = getMenuPrice(selectedMenuItem.value);
  const pct = foodCostPct(cost, price);
  return {
    cost,
    countedLines,
    skippedLines,
    price,
    pct,
    status: costStatus(pct),
  };
});

// PERF: precompute image URLs for the menu list once (and re-derive only when
// menuItems changes). Avoids calling absolutizeUrl in v-for on every render.
const menuImageById = computed(() => {
  const map = new Map();
  for (const m of menuItems.value || []) map.set(Number(m.id), menuItemImageUrl(m));
  return map;
});

// Track menu items whose image 404'd at runtime so we render the icon
// placeholder instead of a broken-image glyph. We can't pre-detect this
// without HEAD-ing every URL, so the @error handler drives it lazily.
const brokenImageIds = ref(new Set());
function markImageBroken(id) {
  const next = new Set(brokenImageIds.value);
  next.add(Number(id));
  brokenImageIds.value = next;
}

// ---------- menu list ----------
function statusFor(menuId) {
  return (
    recipeStatusByMenuId.value[menuId] || {
      has_recipe: false,
      lines_count: 0,
      checked: false,
    }
  );
}

const filteredMenuItems = computed(() => {
  const q = menuSearch.value.trim().toLowerCase();
  let arr = menuItems.value || [];

  // ✅ per-stroke filter (reactive computed)
  if (q) arr = arr.filter((m) => (m.name || "").toLowerCase().includes(q));

  if (recipeFilter.value === "yes") {
    arr = arr.filter(
      (m) => statusFor(m.id).checked && statusFor(m.id).has_recipe
    );
  } else if (recipeFilter.value === "no") {
    arr = arr.filter(
      (m) => statusFor(m.id).checked && !statusFor(m.id).has_recipe
    );
  }

  return arr;
});

const selectedMenuItem = computed(() => {
  const id = Number(selectedMenuItemId.value || 0);
  return menuItems.value.find((m) => Number(m.id) === id) || null;
});

const selectedMenuItemName = computed(() => selectedMenuItem.value?.name || "");

// ---------- helpers ----------
function defaultUomId() {
  return uoms.value?.[0]?.id || null;
}

function ensureLineUom(line) {
  const invId = Number(line?.inventory_item_id || 0);
  const allowed = compatibleUomIdsForInventory(invId);

  if (!allowed?.length) return;

  const cur = Number(line?.uom_id || 0);
  if (allowed.includes(cur)) return;

  const inv = invById.value.get(invId);
  line.uom_id = Number(inv?.base_uom_id || allowed[0]);
}

function normalizeLoadedRecipeUoms() {
  if (!recipe.value) return;
  recipe.value.lines = recipe.value.lines || [];
  for (const l of recipe.value.lines) ensureLineUom(l);
}

function resetNewLine() {
  newLine.value = { inventory_item_id: null, qty: "", uom_id: defaultUomId() };
}

function setSnapshot() {
  savedSnapshot.value = payloadSnapshot.value || "";
}

// ---------- actions ----------
async function loadLookups() {
  menuItems.value = await listMenuItems({ limit: 500, available: "all" });
  uoms.value = await listUoms();
  uomConversions.value = await listUomConversions();
  inventoryItems.value = await listInventoryItems();

  if (!newLine.value.uom_id) newLine.value.uom_id = defaultUomId();
}

async function loadStoreProfile() {
  try {
    storeProfile.value = await getMyStoreProfile();
  } catch {
    storeProfile.value = null;
  }
}

async function ensureRecipeForMenuItem(menuId) {
  loading.value = true;
  try {
    const r = await getRecipeByMenuItem(Number(menuId));
    if (r) {
      recipe.value = r;
      selectedMenuItemId.value = Number(menuId);

      normalizeLoadedRecipeUoms();
      setSnapshot();

      recipeStatusByMenuId.value[Number(menuId)] = {
        has_recipe: (recipe.value.lines || []).length > 0,
        lines_count: (recipe.value.lines || []).length,
        checked: true,
      };
      return;
    }

    recipe.value = await createRecipe({ menu_item_id: Number(menuId) });
    selectedMenuItemId.value = Number(menuId);

    recipe.value.lines = recipe.value.lines || [];
    normalizeLoadedRecipeUoms();

    toast.success("Recipe created (empty)");
    setSnapshot();

    recipeStatusByMenuId.value[Number(menuId)] = {
      has_recipe: false,
      lines_count: 0,
      checked: true,
    };
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load/create recipe");
  } finally {
    loading.value = false;
  }
}

async function refreshRecipeStatuses() {
  checking.value = true;
  try {
    const items = menuItems.value || [];
    // PERF: parallel with a cap of 10 in-flight requests.
    // Was sequential (1 at a time) — for 500 items this now finishes in ~50× less wall time.
    const results = await runWithConcurrency(items, async (m) => {
      try {
        const r = await getRecipeByMenuItem(Number(m.id));
        const linesCount = r ? (r.lines || []).length : 0;
        return [m.id, {
          has_recipe: !!r && linesCount > 0,
          lines_count: linesCount,
          checked: true,
        }];
      } catch {
        return [m.id, { has_recipe: false, lines_count: 0, checked: true }];
      }
    }, 10);

    const state = {};
    for (const r of results) {
      if (r && Array.isArray(r)) state[r[0]] = r[1];
    }
    recipeStatusByMenuId.value = state;
  } finally {
    checking.value = false;
  }
}

function addLineLocal() {
  if (!recipe.value) return;

  const invId = Number(newLine.value.inventory_item_id || 0);
  const qty = Number(newLine.value.qty || 0);
  const uomId = Number(newLine.value.uom_id || 0);

  if (!invId) return toast.error("Pick an inventory item");
  if (!uomId) return toast.error("Pick a UOM");
  if (!qty || qty <= 0) return toast.error("Qty must be > 0");

  const exists = (recipe.value.lines || []).some(
    (l) => Number(l.inventory_item_id) === invId
  );
  if (exists)
    return toast.error("This ingredient already exists (edit it instead)");

  recipe.value.lines = recipe.value.lines || [];
  recipe.value.lines.unshift({
    id: 0,
    recipe_id: recipe.value.id,
    inventory_item_id: invId,
    qty,
    uom_id: uomId,
  });

  resetNewLine();
}

function removeLineLocal(idx) {
  if (!recipe.value) return;
  recipe.value.lines.splice(idx, 1);
}

async function removeLineServer(line) {
  if (!recipe.value) return;
  if (!line.id) return;

  if (!confirm("Delete this line on the server?")) return;

  loading.value = true;
  try {
    await deleteRecipeLine(recipe.value.id, line.id);
    recipe.value.lines = (recipe.value.lines || []).filter(
      (x) => x.id !== line.id
    );
    toast.success("Line deleted");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to delete line");
  } finally {
    loading.value = false;
  }
}

async function saveAllLines() {
  if (!recipe.value) return;
  if (!canSave.value) return toast.error("Fix invalid lines before saving.");

  const payload = {
    lines: (recipe.value.lines || []).map((l) => ({
      inventory_item_id: Number(l.inventory_item_id),
      qty: Number(l.qty),
      uom_id: Number(l.uom_id),
    })),
  };

  saving.value = true;
  try {
    recipe.value = await replaceRecipeLines(recipe.value.id, payload);

    normalizeLoadedRecipeUoms();
    toast.success("Recipe saved");
    setSnapshot();

    const mid = Number(selectedMenuItemId.value);
    recipeStatusByMenuId.value[mid] = {
      has_recipe: (recipe.value.lines || []).length > 0,
      lines_count: (recipe.value.lines || []).length,
      checked: true,
    };
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to save recipe");
  } finally {
    saving.value = false;
  }
}

async function discardChanges() {
  if (!recipe.value || !isDirty.value) return;
  if (!confirm("Discard unsaved changes?")) return;
  await ensureRecipeForMenuItem(Number(selectedMenuItemId.value));
}

// ---------- PDF EXPORT (DESIGN IMPROVED ONLY) ----------
function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmtQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function withCacheBust(url) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}cb=${Date.now()}`;
}

async function fetchAsDataUrl(url) {
  return await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        // Always PNG output (stable for jsPDF)
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = withCacheBust(url);
  });
}

// PERF: per-export image cache. The PDF runs the dish-page renderer in two
// passes (measure pages, then final). Without this cache every dish image
// is downloaded twice. Cleared at the start of every export.
let _pdfImageCache = new Map();
async function cachedFetchAsDataUrl(url) {
  if (!url) return null;
  if (_pdfImageCache.has(url)) return _pdfImageCache.get(url);
  const data = await fetchAsDataUrl(url);
  if (data) _pdfImageCache.set(url, data);
  return data;
}

function storeLineText() {
  const s = storeProfile.value;
  if (!s) return [];
  const out = [];
  if (s.name) out.push(s.name);
  const addr = [s.address, s.city, s.country].filter(Boolean).join(", ");
  if (addr) out.push(addr);
  const contacts = [s.phone, s.email].filter(Boolean).join(" • ");
  if (contacts) out.push(contacts);
  return out;
}

// --- PDF theme (design only) ---
const PDF_THEME = {
  margin: 18,
  barH: 64,
  radius: 14,
  brand: {
    primary: [111, 66, 193], // purple
    accent: [255, 111, 0], // orange
    info: [0, 188, 212], // cyan
    blueHead: [25, 118, 210],
  },
  gray: {
    text: [25, 25, 25],
    muted: [110, 110, 110],
    line: [232, 232, 232],
    card: [248, 249, 250],
    white: [255, 255, 255],
  },
  status: {
    ok: [40, 167, 69],
    high: [220, 53, 69],
    na: [108, 117, 125],
    warn: [255, 193, 7],
  },
};

let cachedStoreLogoDataUrl = null;

// small helpers (design only)
function safeSetFont(doc, style = "normal") {
  // keep default family, only style (bold/normal)
  try {
    doc.setFont(undefined, style);
  } catch {
    // ignore if not supported in runtime
  }
}

function withOpacity(doc, opacity, fn) {
  try {
    if (doc.setGState && doc.GState) {
      const gs = new doc.GState({ opacity, "stroke-opacity": opacity });
      doc.setGState(gs);
      fn();
      doc.setGState(new doc.GState({ opacity: 1, "stroke-opacity": 1 }));
      return;
    }
  } catch {
    // ignore
  }
  fn();
}

function drawImageContain(doc, dataUrl, x, y, w, h, padding = 0) {
  if (!dataUrl) return;
  try {
    const props = doc.getImageProperties(dataUrl);
    const iw = props?.width || 1;
    const ih = props?.height || 1;
    const maxW = Math.max(1, w - padding * 2);
    const maxH = Math.max(1, h - padding * 2);
    const r = Math.min(maxW / iw, maxH / ih);
    const dw = iw * r;
    const dh = ih * r;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    doc.addImage(dataUrl, "PNG", dx, dy, dw, dh);
  } catch {
    // fallback: draw as-is
    try {
      doc.addImage(dataUrl, "PNG", x + padding, y + padding, w - padding * 2, h - padding * 2);
    } catch {
      // ignore
    }
  }
}

/**
 * ✅ Watermark: drawn FIRST (background)
 * - uses light opacity when supported
 */
function addWatermark(doc, text = "CONFIDENTIAL") {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  doc.saveGraphicsState?.();

  withOpacity(doc, 0.08, () => {
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(72);
    safeSetFont(doc, "bold");
    doc.text(text, w / 2, h / 2, { align: "center", angle: 35 });
    safeSetFont(doc, "normal");
  });

  doc.setTextColor(0, 0, 0);
  doc.restoreGraphicsState?.();
}

function addTopBar(doc, title = "Recipe Report", subtitle = "") {
  const w = doc.internal.pageSize.getWidth();
  const h = PDF_THEME.barH;

  // solid brand bar + accent line (clean, modern)
  doc.setFillColor(...PDF_THEME.brand.primary);
  doc.rect(0, 0, w, h, "F");
  doc.setFillColor(...PDF_THEME.brand.accent);
  doc.rect(0, h - 4, w, 4, "F");

  // subtle bottom hairline
  doc.setDrawColor(...PDF_THEME.gray.line);
  doc.line(0, h, w, h);

  // title + subtitle
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  safeSetFont(doc, "bold");
  doc.text(title, PDF_THEME.margin, 28);
  safeSetFont(doc, "normal");

  if (subtitle) {
    doc.setFontSize(10);
    doc.text(subtitle, PDF_THEME.margin, 46);
  }

  // right badge + optional logo
  const badgeText = "INTERNAL";
  doc.setFontSize(9);
  const tw = doc.getTextWidth(badgeText);
  const padX = 10;
  const bx = w - PDF_THEME.margin - (tw + padX * 2);
  const by = 18;

  // badge background
  withOpacity(doc, 0.18, () => {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(bx, by - 12, tw + padX * 2, 18, 7, 7, "F");
  });

  doc.setTextColor(255, 255, 255);
  safeSetFont(doc, "bold");
  doc.text(badgeText, bx + padX, by);
  safeSetFont(doc, "normal");

  // small logo chip (purely visual)
  if (cachedStoreLogoDataUrl) {
    const lx = bx - 30;
    const ly = by - 18;
    doc.setFillColor(255, 255, 255);
    withOpacity(doc, 0.22, () => {
      doc.roundedRect(lx, ly, 22, 22, 8, 8, "F");
    });
    drawImageContain(doc, cachedStoreLogoDataUrl, lx, ly, 22, 22, 2);
  }

  doc.setTextColor(0, 0, 0);
}

function addFooter(doc, pageNo, totalPages, rightText = "") {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const m = PDF_THEME.margin;

  doc.setDrawColor(...PDF_THEME.gray.line);
  doc.line(m, h - 38, w - m, h - 38);

  doc.setFontSize(9);
  doc.setTextColor(...PDF_THEME.gray.muted);

  const left = storeProfile.value?.name ? `${storeProfile.value.name}` : "Store";
  doc.text(left, m, h - 22);

  const mid = `Page ${pageNo} of ${totalPages}`;
  doc.text(mid, w / 2, h - 22, { align: "center" });

  if (rightText) doc.text(rightText, w - m, h - 22, { align: "right" });

  doc.setTextColor(0, 0, 0);
}

function computeLineCost(inv, qty, uomId) {
  if (!inv) return null;

  const avg = Number(inv.avg_cost); // avg_cost per BASE UOM
  const base = Number(inv.base_uom_id);
  const q = Number(qty);

  if (!Number.isFinite(avg) || !Number.isFinite(q) || !base) return null;

  const f = conversionFactor(Number(uomId), base); // qty_in_uom -> qty_in_base
  if (f == null) return null;

  const qtyInBase = q * f;
  return avg * qtyInBase;
}

function computeRecipeCost(recipeObj) {
  const linesArr = recipeObj?.lines || [];
  let cost = 0;
  let countedLines = 0;
  let skippedLines = 0;

  for (const ln of linesArr) {
    const inv = invById.value.get(Number(ln.inventory_item_id));
    const c = computeLineCost(inv, ln.qty, ln.uom_id);
    if (c == null) skippedLines += 1;
    else {
      cost += c;
      countedLines += 1;
    }
  }

  return { cost, countedLines, skippedLines };
}

function splitParagraph(doc, text, x, y, maxWidth, lineHeight = 14) {
  const lines = doc.splitTextToSize(text, maxWidth);
  lines.forEach((t, i) => doc.text(t, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

function drawStatCard(doc, x, y, w, h, label, value, accentKind = "primary") {
  doc.setFillColor(...PDF_THEME.gray.white);
  doc.roundedRect(x, y, w, h, PDF_THEME.radius, PDF_THEME.radius, "F");
  doc.setDrawColor(...PDF_THEME.gray.line);
  doc.roundedRect(x, y, w, h, PDF_THEME.radius, PDF_THEME.radius, "S");

  // accent strip
  const accent =
    accentKind === "accent"
      ? PDF_THEME.brand.accent
      : accentKind === "info"
      ? PDF_THEME.brand.info
      : PDF_THEME.brand.primary;
  doc.setFillColor(...accent);
  doc.roundedRect(x, y, 6, h, 8, 8, "F");

  doc.setTextColor(...PDF_THEME.gray.muted);
  doc.setFontSize(9);
  doc.text(label, x + 16, y + 22);

  doc.setTextColor(...PDF_THEME.gray.text);
  doc.setFontSize(18);
  safeSetFont(doc, "bold");
  doc.text(String(value), x + 16, y + 50);
  safeSetFont(doc, "normal");

  doc.setTextColor(0, 0, 0);
}

async function drawCoverPage(doc, reportMeta) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const m = PDF_THEME.margin;

  addWatermark(doc, "INTERNAL");

  // top hero band
  doc.setFillColor(...PDF_THEME.brand.primary);
  doc.rect(0, 0, w, 170, "F");
  doc.setFillColor(...PDF_THEME.brand.accent);
  doc.rect(0, 170, w, 6, "F");

  // logo block
  const topY = 44;
  doc.setFillColor(255, 255, 255);
  withOpacity(doc, 0.16, () => {
    doc.roundedRect(m, topY, 76, 76, 18, 18, "F");
  });

  if (cachedStoreLogoDataUrl) {
    drawImageContain(doc, cachedStoreLogoDataUrl, m, topY, 76, 76, 10);
  } else {
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text("LOGO", m + 38, topY + 44, { align: "center" });
  }

  const storeName = storeProfile.value?.name || "Store";
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  safeSetFont(doc, "bold");
  doc.text("Recipe & Costing Pack", m + 92, 74);
  safeSetFont(doc, "normal");
  doc.setFontSize(12);
  withOpacity(doc, 0.95, () => {
    doc.text(storeName, m + 92, 96);
  });

  doc.setFontSize(10);
  withOpacity(doc, 0.85, () => {
    doc.text(
      `Generated: ${new Date().toLocaleString()}`,
      m + 92,
      118
    );
    doc.text(
      `Scope: ${reportMeta.scopeLabel}`,
      m + 92,
      136
    );
  });

  // stat row
  const gap = 12;
  const cardY = 200;
  const cardH = 76;
  const cardW = (w - m * 2 - gap * 2) / 3;

  drawStatCard(doc, m, cardY, cardW, cardH, "Total Dishes", reportMeta.totalDishes, "info");
  drawStatCard(
    doc,
    m + cardW + gap,
    cardY,
    cardW,
    cardH,
    "Dishes Costed",
    `${reportMeta.dishesWithCost}/${reportMeta.totalDishes}`,
    "accent"
  );
  drawStatCard(
    doc,
    m + (cardW + gap) * 2,
    cardY,
    cardW,
    cardH,
    "Total Est. Cost",
    fmtMoney(reportMeta.totalBusinessCost),
    "primary"
  );

  // Store info card
  const infoY = 296;
  doc.setFillColor(...PDF_THEME.gray.card);
  doc.roundedRect(m, infoY, w - m * 2, 112, PDF_THEME.radius, PDF_THEME.radius, "F");

  doc.setTextColor(...PDF_THEME.gray.text);
  doc.setFontSize(12);
  safeSetFont(doc, "bold");
  doc.text("Store Information", m + 16, infoY + 28);
  safeSetFont(doc, "normal");

  doc.setFontSize(10);
  doc.setTextColor(...PDF_THEME.gray.muted);
  let yy = infoY + 50;
  const linesTxt = storeLineText();
  if (linesTxt.length) {
    for (const ln of linesTxt) {
      doc.text(ln, m + 16, yy);
      yy += 14;
    }
  } else {
    doc.text("Store information not available.", m + 16, yy);
  }

  // Confidentiality card
  const noticeY = 428;
  doc.setFillColor(...PDF_THEME.gray.white);
  doc.roundedRect(m, noticeY, w - m * 2, 152, PDF_THEME.radius, PDF_THEME.radius, "F");
  doc.setDrawColor(...PDF_THEME.gray.line);
  doc.roundedRect(m, noticeY, w - m * 2, 152, PDF_THEME.radius, PDF_THEME.radius, "S");

  // left accent
  doc.setFillColor(...PDF_THEME.status.high);
  doc.roundedRect(m, noticeY, 6, 152, 8, 8, "F");

  doc.setTextColor(220, 53, 69);
  doc.setFontSize(12);
  safeSetFont(doc, "bold");
  doc.text("Security & Confidentiality Notice", m + 18, noticeY + 30);
  safeSetFont(doc, "normal");

  const para =
    "CONFIDENTIAL BUSINESS RECIPE DOCUMENT — This report contains proprietary recipes, ingredient usage, and costing estimates. " +
    "It is intended strictly for authorized management and approved staff. Unauthorized access, sharing, copying, or distribution is prohibited. " +
    "Keep this document secure at all times and handle it as sensitive business information.";

  doc.setFontSize(10);
  doc.setTextColor(...PDF_THEME.gray.muted);
  splitParagraph(doc, para, m + 18, noticeY + 54, w - m * 2 - 36, 14);

  // Bottom highlight
  const bottomY = 606;
  doc.setFillColor(...PDF_THEME.brand.primary);
  doc.roundedRect(m, bottomY, w - m * 2, 96, 18, 18, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  safeSetFont(doc, "bold");
  doc.text("Estimated Cost Snapshot", m + 18, bottomY + 30);
  safeSetFont(doc, "normal");

  doc.setFontSize(26);
  safeSetFont(doc, "bold");
  doc.text(`${fmtMoney(reportMeta.totalBusinessCost)}`, m + 18, bottomY + 68);
  safeSetFont(doc, "normal");

  doc.setFontSize(9);
  doc.setTextColor(235, 235, 235);
  doc.text(
    `Based on inventory avg_cost and UOM conversions • ${reportMeta.dishesWithCost}/${reportMeta.totalDishes} dishes costed`,
    m + 18,
    bottomY + 86
  );

  doc.setTextColor(0, 0, 0);
}

function drawLegendPills(doc, y) {
  const w = doc.internal.pageSize.getWidth();
  const m = PDF_THEME.margin;

  const pills = [
    { text: `OK  (< ${HIGH_FOOD_COST_PCT}%)`, color: PDF_THEME.status.ok },
    { text: `HIGH  (> ${HIGH_FOOD_COST_PCT}%)`, color: PDF_THEME.status.high },
    { text: "N/A  (no price/cost)", color: PDF_THEME.status.na },
  ];

  let x = m;
  const h = 18;

  doc.setFontSize(9);
  safeSetFont(doc, "bold");

  for (const p of pills) {
    const tw = doc.getTextWidth(p.text);
    const bw = tw + 18;

    doc.setFillColor(...p.color);
    doc.roundedRect(x, y, bw, h, 7, 7, "F");

    doc.setTextColor(255, 255, 255);
    doc.text(p.text, x + 9, y + 13);

    x += bw + 8;
    if (x > w - m - 80) break;
  }

  safeSetFont(doc, "normal");
  doc.setTextColor(0, 0, 0);
}

function drawDishIndex(doc, rows) {
  addWatermark(doc, "INTERNAL");
  addTopBar(doc, "Recipe Report", "Dish List (Index)");

  const pageW = doc.internal.pageSize.getWidth();
  const left = 18;
  const right = 18;
  const usable = pageW - left - right;

  // widths must sum to `usable`
  const w0 = 28;  // #
  const w2 = 68;  // Price
  const w3 = 76;  // Est. Cost
  const w4 = 72;  // Food Cost %
  const w5 = 56;  // Cost Status
  const w6 = 56;  // Recipe (YES/NO)
  const w7 = 45;  // Page (or range)
  const w1 = usable - (w0 + w2 + w3 + w4 + w5 + w6 + w7); // Dish

  autoTable(doc, {
    startY: 78,
    margin: { left, right },
    tableWidth: usable, // ✅ lock table width

    head: [["#", "Dish", "Price", "Est. Cost", "Food Cost %", "Cost", "Recipe", "Page"]],
    body: rows,

    styles: { fontSize: 9, cellPadding: 6, overflow: "linebreak" },
    headStyles: { fillColor: [25, 118, 210], textColor: 255 },
    bodyStyles: { fillColor: false },
    alternateRowStyles: { fillColor: false },

    columnStyles: {
      0: { halign: "left",   cellWidth: w0 },
      1: { halign: "left",   cellWidth: w1 },
      2: { halign: "right",  cellWidth: w2 },
      3: { halign: "right",  cellWidth: w3 },
      4: { halign: "right",  cellWidth: w4 },
      5: { halign: "center", cellWidth: w5 }, // Cost status
      6: { halign: "center", cellWidth: w6 }, // Recipe yes/no
      7: { halign: "center", cellWidth: w7 }, // Page number / range
    },

    didParseCell: (data) => {
      // ✅ Header alignment matches body alignment
      if (data.section === "head") {
        const col = data.column.index;
        if (col === 2 || col === 3 || col === 4) data.cell.styles.halign = "right";
        else if (col === 5 || col === 6 || col === 7) data.cell.styles.halign = "center";
        else data.cell.styles.halign = "left";
      }

      // ✅ Cost Status coloring (col 5)
      if (data.section === "body" && data.column.index === 5) {
        const v = String(data.cell.raw || "").toUpperCase();
        if (v === "HIGH") data.cell.styles.fillColor = [220, 53, 69];     // red
        else if (v === "OK") data.cell.styles.fillColor = [40, 167, 69];  // green
        else data.cell.styles.fillColor = [108, 117, 125];                // gray

        data.cell.styles.textColor = 255;
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.halign = "center";
      }

      // ✅ Recipe YES/NO coloring (col 6)
      if (data.section === "body" && data.column.index === 6) {
        const v = String(data.cell.raw || "").toUpperCase();
        if (v === "YES") data.cell.styles.fillColor = [40, 167, 69];      // green
        else if (v === "NO") data.cell.styles.fillColor = [220, 53, 69];  // red
        else data.cell.styles.fillColor = [108, 117, 125];                // gray

        data.cell.styles.textColor = 255;
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.halign = "center";
      }
    },
  });
}

async function drawDishPage(doc, dish, index, total) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const m = PDF_THEME.margin;

  addWatermark(doc, "CONFIDENTIAL");
  addTopBar(doc, "Recipe Report", storeProfile.value?.name || "");

  // Title
  doc.setTextColor(...PDF_THEME.gray.text);
  doc.setFontSize(18);
  safeSetFont(doc, "bold");
  doc.text(dish.name || `Menu Item #${dish.id}`, m, 92);
  safeSetFont(doc, "normal");

  // status pill
  const hasRecipe = dish.hasRecipe;
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  const pillColor = hasRecipe ? PDF_THEME.status.ok : PDF_THEME.status.high;
  doc.setFillColor(...pillColor);
  doc.roundedRect(w - m - 138, 78, 138, 22, 7, 7, "F");
  safeSetFont(doc, "bold");
  doc.text(hasRecipe ? "HAS RECIPE" : "MISSING RECIPE", w - m - 69, 93, { align: "center" });
  safeSetFont(doc, "normal");

  // Cards row
  const imgX = m;
  const imgY = 110;
  const imgW = 160;
  const imgH = 124;

  // Image card
  doc.setFillColor(...PDF_THEME.gray.card);
  doc.roundedRect(imgX, imgY, imgW, imgH, PDF_THEME.radius, PDF_THEME.radius, "F");
  doc.setDrawColor(...PDF_THEME.gray.line);
  doc.roundedRect(imgX, imgY, imgW, imgH, PDF_THEME.radius, PDF_THEME.radius, "S");

  const imgUrl = menuItemImageUrl(dish.raw);
  let dishImg = null;
  if (imgUrl) dishImg = await cachedFetchAsDataUrl(imgUrl);

  if (dishImg) {
    drawImageContain(doc, dishImg, imgX, imgY, imgW, imgH, 10);
  } else {
    doc.setTextColor(...PDF_THEME.gray.muted);
    doc.setFontSize(10);
    doc.text("No Image", imgX + imgW / 2, imgY + imgH / 2 + 4, { align: "center" });
    doc.setTextColor(0);
  }

  // Summary card
  const sumX = imgX + imgW + 14;
  const sumY = imgY;
  const sumW = w - m - sumX;
  const sumH = imgH;

  doc.setFillColor(...PDF_THEME.gray.white);
  doc.roundedRect(sumX, sumY, sumW, sumH, PDF_THEME.radius, PDF_THEME.radius, "F");
  doc.setDrawColor(...PDF_THEME.gray.line);
  doc.roundedRect(sumX, sumY, sumW, sumH, PDF_THEME.radius, PDF_THEME.radius, "S");

  // header
  doc.setFontSize(11);
  doc.setTextColor(...PDF_THEME.gray.text);
  safeSetFont(doc, "bold");
  doc.text("Dish Summary", sumX + 14, sumY + 26);
  safeSetFont(doc, "normal");

  // small stats
  doc.setFontSize(9);
  doc.setTextColor(...PDF_THEME.gray.muted);
  doc.text(`Lines: ${dish.linesCount}`, sumX + 14, sumY + 46);
  doc.text(`Costed Lines: ${dish.countedLines}`, sumX + 14, sumY + 60);
  doc.text(`Skipped (UOM mismatch): ${dish.skippedLines}`, sumX + 14, sumY + 74);

  // pricing & costing (fixed spacing, no overlaps)
  const priceTxt = dish.price == null ? "-" : fmtMoney(dish.price);
  const pctTxt = dish.foodCostPct == null ? "-" : `${dish.foodCostPct.toFixed(1)}%`;

  doc.setFontSize(9);
  doc.text(`Menu Price: ${priceTxt}`, sumX + 14, sumY + 92);
  doc.text(`Food Cost %: ${pctTxt}`, sumX + 14, sumY + 106);

  doc.setFontSize(15);
  doc.setTextColor(...PDF_THEME.gray.text);
  safeSetFont(doc, "bold");
  doc.text(`Est. Cost: ${fmtMoney(dish.cost)}`, sumX + 14, sumY + 124);
  safeSetFont(doc, "normal");

  // status pill (inside summary)
  const s = dish.costStatus?.kind || "na";
  const statusTxt = dish.costStatus?.label || "N/A";
  const statusColor = s === "high" ? PDF_THEME.status.high : s === "ok" ? PDF_THEME.status.ok : PDF_THEME.status.na;

  doc.setFillColor(...statusColor);
  doc.roundedRect(sumX + sumW - 88, sumY + 96, 74, 22, 7, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  safeSetFont(doc, "bold");
  doc.text(statusTxt, sumX + sumW - 51, sumY + 111, { align: "center" });
  safeSetFont(doc, "normal");
  doc.setTextColor(0, 0, 0);

  // Table
  const startY = 260;

  if (!hasRecipe) {
    doc.setFontSize(12);
    doc.setTextColor(...PDF_THEME.gray.muted);
    doc.text("No recipe lines for this dish.", m, startY);
    doc.setTextColor(0);
  } else {
    const linesArr = (dish.recipe?.lines || []).map((ln) => {
      const inv = invById.value.get(Number(ln.inventory_item_id));
      const invName = inv?.name || inv?.code || `Item #${ln.inventory_item_id}`;
      const qty = Number(ln.qty);
      const uCode = uomCodeById.value(Number(ln.uom_id)) || "UOM";

      const avgCost = inv?.avg_cost ?? null;
      const baseUomId = inv?.base_uom_id ?? null;

      let lineCost = null;
      // keep original behavior here (design only)
      if (avgCost != null && baseUomId != null && Number(baseUomId) === Number(ln.uom_id)) {
        const c = Number(avgCost);
        if (Number.isFinite(c) && Number.isFinite(qty)) lineCost = c * qty;
      }

      return [
        invName,
        fmtQty(qty),
        uCode,
        avgCost == null ? "-" : fmtMoney(avgCost),
        lineCost == null ? "-" : fmtMoney(lineCost),
      ];
    });

    const pageW = doc.internal.pageSize.getWidth();
    const left = m;
    const right = m;
    const usable = pageW - left - right;

    // widths must sum to `usable`
    const wQty = 60;
    const wUom = 55;
    const wAvg = 70;
    const wLine = 70;
    const wIng = usable - (wQty + wUom + wAvg + wLine);

    autoTable(doc, {
      startY,
      margin: { left, right },
      tableWidth: usable, // ✅ lock table width
    
      head: [["Ingredient", "Qty", "UOM", "Avg Cost", "Line Cost"]],
      body: linesArr,
    
      styles: { fontSize: 9, cellPadding: 6, overflow: "linebreak" },
      headStyles: { fillColor: [111, 66, 193], textColor: 255 },
    
      // ✅ make BODY transparent so watermark shows behind (not over text)
      bodyStyles: { fillColor: false },
      alternateRowStyles: { fillColor: false },
    
      columnStyles: {
        0: { halign: "left", cellWidth: wIng },
        1: { halign: "right", cellWidth: wQty },
        2: { halign: "center", cellWidth: wUom },
        3: { halign: "right", cellWidth: wAvg },
        4: { halign: "right", cellWidth: wLine },
      },
    
      didParseCell: (data) => {
        // ✅ FORCE header alignment to match body alignment
        if (data.section === "head") {
          const col = data.column.index;
          if (col === 1 || col === 3 || col === 4) data.cell.styles.halign = "right";
          else if (col === 2) data.cell.styles.halign = "center";
          else data.cell.styles.halign = "left";
        }
      },
    });

    const finalY = doc.lastAutoTable?.finalY || startY + 20;

    // Note card
    doc.setFillColor(...PDF_THEME.gray.card);
    doc.roundedRect(m, finalY + 14, w - m * 2, 64, PDF_THEME.radius, PDF_THEME.radius, "F");

    doc.setFontSize(11);
    doc.setTextColor(...PDF_THEME.gray.text);
    safeSetFont(doc, "bold");
    doc.text("Costing Note", m + 14, finalY + 38);
    safeSetFont(doc, "normal");

    doc.setFontSize(9);
    doc.setTextColor(...PDF_THEME.gray.muted);
    doc.text(
      "Line costs are calculated only when recipe UOM equals ingredient Base UOM.",
      m + 14,
      finalY + 54
    );

    doc.setFontSize(14);
    doc.setTextColor(...PDF_THEME.gray.text);
    safeSetFont(doc, "bold");
    doc.text(`Total: ${fmtMoney(dish.cost)}`, w - m - 14, finalY + 48, { align: "right" });
    safeSetFont(doc, "normal");
    doc.setTextColor(0, 0, 0);
  }

  // small counter (top of footer zone)
  doc.setTextColor(...PDF_THEME.gray.muted);
  doc.setFontSize(9);
  doc.text(`Dish ${index} of ${total}`, w - m, h - 52, { align: "right" });
  doc.setTextColor(0);
}

async function exportToPdf() {
  if (exporting.value) return;

  exporting.value = true;
  try {
    const list = filteredMenuItems.value || [];
    if (list.length === 0) {
      toast.info("No menu items to export (check filters)");
      return;
    }
    // PERF: reset per-export image cache so a fresh export still picks up
    // newly uploaded images (instead of stale data) but each unique URL is
    // still fetched only once during this export run.
    _pdfImageCache = new Map();

    cachedStoreLogoDataUrl = null;
    try {
      const logoUrl = storeLogoUrl(storeProfile.value);
      if (logoUrl) cachedStoreLogoDataUrl = await cachedFetchAsDataUrl(logoUrl);
    } catch {
      cachedStoreLogoDataUrl = null;
    }

    // PERF: fetch all recipes in parallel (capped at 10 concurrent) instead of
    // one-at-a-time. For 200 dishes this drops minutes to seconds.
    const recipesByMenuId = new Map();
    const fetched = await runWithConcurrency(list, async (m) => {
      try { return [m.id, await getRecipeByMenuItem(Number(m.id))]; }
      catch { return [m.id, null]; }
    }, 10);
    for (const r of fetched) {
      if (r && Array.isArray(r)) recipesByMenuId.set(r[0], r[1]);
    }

    // Build dish data
    const dishes = [];
    let totalBusinessCost = 0;
    let dishesWithCost = 0;

    for (const m of list) {
      const r = recipesByMenuId.get(m.id) || null;

      const hasRecipe = !!r && (r.lines || []).length > 0;
      const linesCount = (r?.lines || []).length || 0;

      const { cost, countedLines, skippedLines } = hasRecipe
        ? computeRecipeCost(r)
        : { cost: 0, countedLines: 0, skippedLines: 0 };

      if (hasRecipe && cost > 0) {
        totalBusinessCost += cost;
        dishesWithCost += 1;
      }

      const price = getMenuPrice(m);
      const pct = hasRecipe ? foodCostPct(cost, price) : null;
      const status = costStatus(pct);

      dishes.push({
        id: m.id,
        name: m.name || `Menu Item #${m.id}`,
        raw: m,
        price,
        recipe: r,
        hasRecipe,
        linesCount,
        cost,
        countedLines,
        skippedLines,
        foodCostPct: pct,
        costStatus: status,
      });
    }

    const reportMeta = {
      totalBusinessCost,
      dishesWithCost,
      totalDishes: dishes.length,
      scopeLabel:
        recipeFilter.value === "all"
          ? "All dishes"
          : recipeFilter.value === "yes"
          ? "Dishes with recipes"
          : "Dishes missing recipes",
    };

    // ---------------------------
    // PASS 1: measure real dish page ranges
    // ---------------------------
    const tmp = new jsPDF({ unit: "pt", format: "a4" });

    // Cover
    await drawCoverPage(tmp, reportMeta);

    // Index (with placeholder Page column so layout matches final)
    tmp.addPage();
    const tmpIndexRows = dishes.map((d, i) => {
      const pctTxt = d.foodCostPct == null ? "-" : `${d.foodCostPct.toFixed(1)}%`;
      const costStatusTxt = d.hasRecipe ? d.costStatus.label : "N/A";
      const recipeStatusTxt = d.hasRecipe ? "YES" : "NO";

      return [
        String(i + 1),
        d.name,
        d.price == null ? "-" : fmtMoney(d.price),
        d.hasRecipe ? fmtMoney(d.cost) : "-",
        d.hasRecipe ? pctTxt : "-",
        costStatusTxt,
        recipeStatusTxt,
        "", // placeholder page (unknown in pass 1)
      ];
    });
    drawDishIndex(tmp, tmpIndexRows);

    // Dish pages + capture page ranges
    tmp.addPage();
    const dishPages = new Map(); // id -> {start, end}

    for (let i = 0; i < dishes.length; i++) {
      if (i > 0) tmp.addPage();

      const start = tmp.getNumberOfPages();
      await drawDishPage(tmp, dishes[i], i + 1, dishes.length);
      const end = tmp.getNumberOfPages();

      dishPages.set(dishes[i].id, { start, end });
    }

    // Helper for index page cell
    const pageCell = (id) => {
      const p = dishPages.get(id);
      if (!p) return "-";
      return p.start === p.end ? String(p.start) : `${p.start}-${p.end}`;
    };

    // ---------------------------
    // PASS 2: render final PDF with correct page numbers
    // ---------------------------
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    // Cover
    await drawCoverPage(doc, reportMeta);

    // Index with real pages
    doc.addPage();
    const indexRows = dishes.map((d, i) => {
      const pctTxt = d.foodCostPct == null ? "-" : `${d.foodCostPct.toFixed(1)}%`;
      const costStatusTxt = d.hasRecipe ? d.costStatus.label : "N/A";
      const recipeStatusTxt = d.hasRecipe ? "YES" : "NO";

      return [
        String(i + 1),
        d.name,
        d.price == null ? "-" : fmtMoney(d.price),
        d.hasRecipe ? fmtMoney(d.cost) : "-",
        d.hasRecipe ? pctTxt : "-",
        costStatusTxt,        // ✅ cost status
        recipeStatusTxt,      // ✅ recipe yes/no status
        pageCell(d.id),       // ✅ page number or range
      ];
    });
    drawDishIndex(doc, indexRows);

    // Dish pages
    doc.addPage();
    for (let i = 0; i < dishes.length; i++) {
      if (i > 0) doc.addPage();
      await drawDishPage(doc, dishes[i], i + 1, dishes.length);
    }

    // Footers + final page numbers
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      addFooter(doc, p, totalPages, "Internal Use Only");
    }

    doc.save(`recipe-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success("PDF exported");
  } catch (e) {
    toast.error(e?.message || "Failed to export PDF");
  } finally {
    exporting.value = false;
  }
}

onMounted(async () => {
  loading.value = true;
  try {
    await Promise.all([loadLookups(), loadStoreProfile()]);
    resetNewLine();
    await refreshRecipeStatuses();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load recipes screen");
  } finally {
    loading.value = false;
  }
});

watch(
  () => newLine.value.inventory_item_id,
  (invId) => {
    if (!invId) {
      newLine.value.uom_id = defaultUomId();
      return;
    }

    const inv = invById.value.get(Number(invId));
    const base = Number(inv?.base_uom_id || 0);

    const opts = uomOptionsForInventory(invId);
    const baseOpt = opts.find((o) => Number(o.value) === base);

    newLine.value.uom_id = baseOpt ? baseOpt.value : opts[0]?.value ?? null;
  }
);
</script>

<template>
  <DefaultLayout>
    <div style="zoom: 80%">
    <!-- ============== HERO ============== -->
    <div class="page-hero">
      <div class="page-hero-text">
        <div class="eyebrow">
          <i class="ri-restaurant-2-line"></i>
          <span>Catalog</span>
        </div>
        <h1 class="hero-title">Recipes</h1>
        <p class="hero-sub">
          <span v-if="storeProfile?.name">{{ storeProfile.name }} — </span>
          Build ingredient recipes for live food-cost % and accurate stock depletion.
        </p>
      </div>

      <div class="page-hero-actions">
        <button
          class="btn btn-light btn-pill"
          :disabled="loading || checking"
          @click="refreshRecipeStatuses"
        >
          <i class="ri-refresh-line" :class="{ rotating: checking }"></i>
          <span>{{ checking ? "Checking…" : "Refresh status" }}</span>
        </button>
        <button
          class="btn btn-pill btn-cta"
          :disabled="loading || checking || exporting"
          @click="exportToPdf"
        >
          <i class="ri-file-download-line"></i>
          <span>{{ exporting ? "Exporting…" : "Export PDF" }}</span>
        </button>
      </div>
    </div>

    <div class="row g-3">
      <!-- ============== LEFT — menu list ============== -->
      <div class="col-12 col-lg-4">
        <div class="recipe-card menu-pane">
          <div class="pane-head">
            <div class="pane-head-title">
              <i class="ri-restaurant-line me-2 text-primary"></i>
              Menu Items
            </div>
            <span class="pane-count">{{ filteredMenuItems.length }} shown</span>
          </div>

          <div class="pane-controls">
            <div class="position-relative search-wrap">
              <i class="ri-search-line search-ico"></i>
              <input
                v-model="menuSearch"
                type="search"
                class="form-control ps-5"
                placeholder="Search dish…"
              />
            </div>

            <div class="seg-toggle" role="group">
              <button
                class="seg-btn"
                :class="{ active: recipeFilter === 'all' }"
                @click="recipeFilter = 'all'"
                type="button"
              >All</button>
              <button
                class="seg-btn"
                :class="{ active: recipeFilter === 'yes' }"
                @click="recipeFilter = 'yes'"
                type="button"
              >With</button>
              <button
                class="seg-btn"
                :class="{ active: recipeFilter === 'no' }"
                @click="recipeFilter = 'no'"
                type="button"
              >Missing</button>
            </div>
          </div>

          <div class="menu-scroll">
            <div
              v-for="m in filteredMenuItems"
              :key="m.id"
              class="menu-tile"
              :class="{ active: Number(selectedMenuItemId) === Number(m.id) }"
              role="button"
              tabindex="0"
              @click="ensureRecipeForMenuItem(m.id)"
              @keydown.enter="ensureRecipeForMenuItem(m.id)"
            >
              <div class="tile-img">
                <img
                  v-if="menuImageById.get(m.id) && !brokenImageIds.has(Number(m.id))"
                  :src="menuImageById.get(m.id)"
                  :alt="m.name"
                  loading="lazy"
                  @error="markImageBroken(m.id)"
                />
                <i v-else class="ri-restaurant-2-line"></i>
              </div>

              <div class="tile-meta">
                <div class="tile-title">{{ m.name }}</div>
                <div class="tile-row">
                  <span
                    class="status-pill"
                    :class="statusFor(m.id).checked && statusFor(m.id).has_recipe ? 'on' : 'off'"
                  >
                    <i :class="statusFor(m.id).checked && statusFor(m.id).has_recipe ? 'ri-check-line' : 'ri-close-line'"></i>
                    {{ statusFor(m.id).checked && statusFor(m.id).has_recipe ? "Recipe" : "Missing" }}
                  </span>
                  <span class="lines-pill">{{ statusFor(m.id).lines_count || 0 }} lines</span>
                </div>
              </div>

              <i class="ri-arrow-right-s-line tile-chevron"></i>
            </div>

            <div v-if="filteredMenuItems.length === 0" class="empty-mini">
              <i class="ri-search-line"></i>
              <div>No menu items match.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ============== RIGHT — recipe editor ============== -->
      <div class="col-12 col-lg-8">
        <div class="recipe-card editor-pane">
          <div class="pane-head editor-head">
            <div class="dish-info">
              <div class="dish-avatar">
                <img
                  v-if="selectedMenuItem && menuItemImageUrl(selectedMenuItem) && !brokenImageIds.has(Number(selectedMenuItem.id))"
                  :src="menuItemImageUrl(selectedMenuItem)"
                  :alt="selectedMenuItemName"
                  @error="markImageBroken(selectedMenuItem.id)"
                />
                <i v-else class="ri-restaurant-2-line"></i>
              </div>
              <div class="dish-text">
                <div class="dish-eyebrow">Recipe Editor</div>
                <div class="dish-name">
                  <span v-if="selectedMenuItemId">{{ selectedMenuItemName }}</span>
                  <span v-else class="text-muted">Pick a dish on the left</span>
                </div>
                <div v-if="recipe" class="dish-sub">
                  {{ meta.total }} line{{ meta.total === 1 ? '' : 's' }} • {{ meta.unique }} unique ingredient{{ meta.unique === 1 ? '' : 's' }}
                </div>
              </div>
            </div>

            <div class="dish-actions">
              <span v-if="recipe" class="dirty-pill" :class="isDirty ? 'dirty' : 'clean'">
                <i :class="isDirty ? 'ri-edit-circle-line' : 'ri-check-line'"></i>
                {{ isDirty ? "Unsaved" : "Saved" }}
              </span>
              <button class="btn btn-sm btn-light" :disabled="saving || !isDirty" @click="discardChanges">
                Discard
              </button>
              <button v-can="'recipes:manage'" class="btn btn-sm btn-primary" :disabled="!canSave" @click="saveAllLines">
                <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
                {{ saving ? "Saving…" : "Save recipe" }}
              </button>
            </div>
          </div>

          <div class="pane-body">
            <div v-if="loading && !recipe" class="loading-row">
              <span class="spinner-border spinner-border-sm"></span>
              Loading…
            </div>

            <div v-else-if="!recipe" class="empty-pane">
              <i class="ri-book-open-line"></i>
              <h5>Pick a dish to start</h5>
              <p class="text-muted">Select a menu item on the left and we'll create or load its recipe automatically.</p>
            </div>

            <template v-else>
              <!-- Add ingredient -->
              <div class="add-strip">
                <div class="row g-2 align-items-end">
                  <div class="col-md-6">
                    <label class="form-label small mb-1">Inventory item</label>
                    <SearchSelect
                      v-model="newLine.inventory_item_id"
                      :options="inventoryOptions"
                      placeholder="Search inventory…"
                      :clearable="true"
                      :searchable="true"
                    />
                  </div>
                  <div class="col-md-2">
                    <label class="form-label small mb-1">Qty</label>
                    <input
                      v-model="newLine.qty"
                      type="number"
                      step="1"
                      class="form-control"
                      placeholder="0.25"
                    />
                  </div>
                  <div class="col-md-3">
                    <label class="form-label small mb-1">UOM</label>
                    <SearchSelect
                      v-model="newLine.uom_id"
                      :options="uomOptionsForInventory(newLine.inventory_item_id)"
                      placeholder="UOM…"
                      :clearable="true"
                      :searchable="true"
                    />
                  </div>
                  <div class="col-md-1 d-grid">
                    <button v-can="'recipes:manage'" class="add-line-btn" :disabled="saving" @click="addLineLocal" title="Add ingredient">
                      <i class="ri-add-line"></i>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Lines list -->
              <div v-if="lines.length === 0" class="empty-mini mt-3">
                <i class="ri-flask-line"></i>
                <div>No ingredients yet — add one above.</div>
              </div>

              <div v-else class="lines-list mt-3">
                <div
                  v-for="(l, idx) in lines"
                  :key="`${l.id || 0}-${idx}`"
                  class="line-row"
                  :class="{ 'is-local': !l.id }"
                >
                  <div class="line-name-col">
                    <div class="line-name">{{ invNameById(l.inventory_item_id) }}</div>
                    <div class="line-sub">
                      <span class="state-pill" :class="l.id ? 'saved' : 'local'">
                        <i :class="l.id ? 'ri-check-line' : 'ri-edit-line'"></i>
                        {{ l.id ? "Saved" : "Local" }}
                      </span>
                      <span class="muted">{{ Number(l.qty || 0) }} {{ uomCodeById(l.uom_id) || "—" }}</span>
                    </div>
                  </div>

                  <input
                    v-model="l.qty"
                    type="number"
                    step="0.000001"
                    class="line-qty"
                  />

                  <select v-model="l.uom_id" class="line-uom">
                    <option v-for="u in uomsForInventory(l.inventory_item_id)" :key="u.id" :value="u.id">
                      {{ u.code }} — {{ u.name }}
                    </option>
                  </select>

                  <div class="line-actions">
                    <button
                      class="line-ico"
                      :disabled="saving"
                      @click="removeLineLocal(idx)"
                      :title="l.id ? 'Remove from list (still on server until you Save)' : 'Remove'"
                    >
                      <i class="ri-subtract-line"></i>
                    </button>
                    <button
                      v-if="l.id"
                      class="line-ico danger"
                      :disabled="saving"
                      @click="removeLineServer(l)"
                      title="Delete on server now"
                    >
                      <i class="ri-delete-bin-line"></i>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Cost summary -->
              <div v-if="recipeCostSummary && lines.length > 0" class="cost-summary mt-3">
                <div class="summary-row">
                  <span class="summary-label">
                    <i class="ri-money-dollar-circle-line me-1"></i>
                    Estimated cost
                  </span>
                  <span class="summary-value">K {{ fmtMoney(recipeCostSummary.cost) }}</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">
                    <i class="ri-price-tag-3-line me-1"></i>
                    Menu price
                  </span>
                  <span class="summary-value">
                    {{ recipeCostSummary.price == null ? "—" : `K ${fmtMoney(recipeCostSummary.price)}` }}
                  </span>
                </div>
                <div class="summary-divider"></div>
                <div
                  class="summary-fc"
                  :class="`fc-${recipeCostSummary.status.kind}`"
                >
                  <span v-if="recipeCostSummary.pct == null">
                    <i class="ri-information-line me-1"></i>
                    Set a menu price &amp; ingredient avg costs to see food cost %
                  </span>
                  <span v-else>
                    <i :class="recipeCostSummary.status.kind === 'high' ? 'ri-alarm-warning-line' : 'ri-check-line'" class="me-1"></i>
                    Food cost <strong>{{ recipeCostSummary.pct.toFixed(1) }}%</strong>
                    <span class="status-tag">{{ recipeCostSummary.status.label }}</span>
                  </span>
                </div>
                <div v-if="recipeCostSummary.skippedLines" class="summary-warn">
                  <i class="ri-error-warning-line me-1"></i>
                  {{ recipeCostSummary.skippedLines }} line{{ recipeCostSummary.skippedLines === 1 ? '' : 's' }} skipped
                  (no avg cost or unconvertible UOM)
                </div>
              </div>

              <div class="hint-line mt-2">
                <i class="ri-information-line me-1"></i>
                Save replaces all lines on the server in one atomic call.
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
    </div>
    <!-- /zoom wrapper -->
  </DefaultLayout>
</template>

<style scoped>
.rotating { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ============= Hero ============= */
.page-hero {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 1.5rem 1.75rem;
  margin-bottom: 1.25rem;
  border-radius: 22px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #ec4899 100%);
  color: #fff;
  box-shadow: 0 20px 40px -20px rgba(99, 102, 241, 0.55);
  overflow: hidden;
  flex-wrap: wrap;
}
.page-hero::before {
  content: "";
  position: absolute; inset: 0;
  background:
    radial-gradient(220px 140px at 90% 10%, rgba(255, 255, 255, 0.22), transparent 65%),
    radial-gradient(280px 180px at 0% 110%, rgba(255, 255, 255, 0.14), transparent 65%);
  pointer-events: none;
}
.page-hero-text { position: relative; max-width: 600px; }
.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.65rem;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 0.6rem;
}
.hero-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  letter-spacing: -0.025em;
  font-size: 1.85rem;
  margin: 0;
  color: #fff;
}
.hero-sub {
  color: rgba(255, 255, 255, 0.85);
  margin: 0.35rem 0 0;
  font-size: 0.9rem;
}
.page-hero-actions {
  position: relative;
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.btn-pill {
  border-radius: 999px !important;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.btn-pill i { font-size: 1rem; }
.page-hero-actions .btn-light {
  background: rgba(255, 255, 255, 0.95);
  color: #1e293b;
  border: none;
}
.page-hero-actions .btn-light:hover { background: #fff; color: #1e293b; }
.btn-cta {
  background: #fff !important;
  color: #6366f1 !important;
  font-weight: 700;
  border: none;
  box-shadow: 0 8px 16px -8px rgba(0, 0, 0, 0.3);
}
.btn-cta:hover { background: #fff !important; color: #4f46e5 !important; }

@media (max-width: 575.98px) {
  .page-hero { padding: 1.25rem; }
  .hero-title { font-size: 1.4rem; }
}

/* ============= Shared card ============= */
.recipe-card {
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  color: var(--ct-body-color, #1e293b);
  box-shadow: var(--ct-box-shadow-sm, 0 1px 2px rgba(15,23,42,.04));
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem 1.1rem;
  border-bottom: 1px dashed var(--ct-border-color, #e6e9ef);
}
.pane-head-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 1rem;
  letter-spacing: -0.015em;
  color: var(--ct-body-color, #0f172a);
}
.pane-count {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  border: 1px solid var(--ct-border-color, #e6e9ef);
}

/* ============= Menu pane (left) ============= */
.menu-pane { overflow: hidden; }

.pane-controls {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px dashed var(--ct-border-color, #e6e9ef);
}
.search-wrap { position: relative; }
.search-ico {
  position: absolute;
  left: 0.85rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ct-secondary-color, #94a3b8);
  pointer-events: none;
}

.seg-toggle {
  display: inline-flex;
  background: var(--ct-tertiary-bg, #f8fafc);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
}
.seg-btn {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--ct-secondary-color, #64748b);
  padding: 0.35rem 0.6rem;
  border-radius: 7px;
  font-weight: 600;
  font-size: 0.78rem;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.seg-btn:hover { color: var(--ct-body-color, #1e293b); }
.seg-btn.active {
  background: var(--ct-card-bg, #fff);
  color: var(--ct-primary, #6366f1);
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
}

.menu-scroll {
  padding: 0.5rem;
  max-height: 64vh;
  overflow-y: auto;
}
.menu-scroll::-webkit-scrollbar { width: 6px; }
.menu-scroll::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, 0.3);
  border-radius: 999px;
}

.menu-tile {
  display: grid;
  grid-template-columns: 44px 1fr 18px;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.6rem;
  border-radius: 12px;
  border: 1px solid transparent;
  cursor: pointer;
  outline: none;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.menu-tile:hover {
  background: rgba(99, 102, 241, 0.05);
}
.menu-tile.active {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.3);
}
.menu-tile + .menu-tile { margin-top: 0.25rem; }

.tile-img {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--ct-tertiary-bg, #f8fafc);
  display: grid;
  place-items: center;
  color: var(--ct-secondary-color, #94a3b8);
  font-size: 1.15rem;
}
.tile-img img { width: 100%; height: 100%; object-fit: cover; }

.tile-meta { min-width: 0; }
.tile-title {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--ct-body-color, #1e293b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}
.tile-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.2rem;
}

.status-pill, .lines-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
}
.status-pill.on {
  background: rgba(16, 185, 129, 0.14);
  color: #047857;
}
.status-pill.off {
  background: rgba(239, 68, 68, 0.12);
  color: #b91c1c;
}
.lines-pill {
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
  border: 1px solid var(--ct-border-color, #e6e9ef);
}

.tile-chevron {
  color: var(--ct-secondary-color, #94a3b8);
  font-size: 1.05rem;
}

.empty-mini {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 1.5rem 1rem;
  color: var(--ct-secondary-color, #64748b);
  font-size: 0.85rem;
}
.empty-mini i {
  font-size: 1.5rem;
  color: var(--ct-secondary-color, #94a3b8);
}

/* ============= Editor pane (right) ============= */
.editor-head {
  align-items: flex-start;
}
.dish-info {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-width: 0;
}
.dish-avatar {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 1.4rem;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  box-shadow: 0 8px 18px -8px rgba(99, 102, 241, 0.55);
  overflow: hidden;
  flex-shrink: 0;
}
.dish-avatar img { width: 100%; height: 100%; object-fit: cover; }

.dish-text { min-width: 0; }
.dish-eyebrow {
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--ct-primary, #6366f1);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 0.15rem;
}
.dish-name {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 1.1rem;
  color: var(--ct-body-color, #0f172a);
  letter-spacing: -0.015em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}
.dish-sub {
  font-size: 0.78rem;
  color: var(--ct-secondary-color, #64748b);
  margin-top: 0.15rem;
}

.dish-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.dirty-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
}
.dirty-pill.clean {
  background: rgba(16, 185, 129, 0.14);
  color: #047857;
}
.dirty-pill.dirty {
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
}

.pane-body { padding: 1rem 1.1rem 1.1rem; }

.loading-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--ct-secondary-color, #64748b);
  padding: 1rem 0;
}

.empty-pane {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--ct-secondary-color, #64748b);
}
.empty-pane i {
  font-size: 2.5rem;
  color: var(--ct-primary, #6366f1);
  opacity: 0.6;
  display: block;
  margin-bottom: 0.5rem;
}
.empty-pane h5 {
  margin: 0.25rem 0 0.5rem;
  color: var(--ct-body-color, #1e293b);
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 700;
}

/* ============= Add ingredient strip ============= */
.add-strip {
  border: 1px dashed var(--ct-border-color, #e6e9ef);
  background: var(--ct-tertiary-bg, #f8fafc);
  border-radius: 14px;
  padding: 0.85rem;
}
.add-line-btn {
  width: 100%;
  height: calc(2.25rem + 2px);
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: 1.05rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 10px -4px rgba(99, 102, 241, 0.5);
  transition: filter 0.15s ease, opacity 0.15s ease;
}
.add-line-btn:hover { filter: brightness(1.05); }
.add-line-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--ct-tertiary-bg, #e2e8f0);
  color: var(--ct-secondary-color, #94a3b8);
  box-shadow: none;
}

/* ============= Lines list ============= */
.lines-list { display: flex; flex-direction: column; gap: 0.5rem; }

.line-row {
  display: grid;
  grid-template-columns: 1fr 110px 200px auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.55rem 0.7rem;
  background: var(--ct-card-bg, #fff);
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 10px;
  transition: border-color 0.15s ease;
}
.line-row:hover { border-color: rgba(99, 102, 241, 0.3); }
.line-row.is-local {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.04), transparent);
  border-color: rgba(245, 158, 11, 0.25);
}

.line-name-col { min-width: 0; }
.line-name {
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--ct-body-color, #1e293b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}
.line-sub {
  margin-top: 0.2rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  color: var(--ct-secondary-color, #64748b);
}
.state-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.18rem;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
}
.state-pill.saved {
  background: rgba(16, 185, 129, 0.14);
  color: #047857;
}
.state-pill.local {
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
}
.line-sub .muted { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.line-qty {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82rem;
  font-weight: 600;
  text-align: right;
  padding: 0.3rem 0.45rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 6px;
  background: var(--ct-card-bg, #fff);
  color: var(--ct-body-color, #1e293b);
  width: 100%;
}
.line-qty:focus { outline: none; border-color: var(--ct-primary, #6366f1); }

.line-uom {
  font-size: 0.82rem;
  padding: 0.3rem 0.45rem;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  border-radius: 6px;
  background: var(--ct-card-bg, #fff);
  color: var(--ct-body-color, #1e293b);
  width: 100%;
}
.line-uom:focus { outline: none; border-color: var(--ct-primary, #6366f1); }

.line-actions { display: flex; gap: 0.3rem; }
.line-ico {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--ct-secondary-color, #94a3b8);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.line-ico:hover { background: rgba(99, 102, 241, 0.08); color: var(--ct-primary, #6366f1); }
.line-ico.danger:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; }

/* ============= Cost summary ============= */
.cost-summary {
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(139, 92, 246, 0.04));
  border: 1px solid var(--ct-border-color, #e6e9ef);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--ct-secondary-color, #64748b);
}
.summary-label {
  display: inline-flex;
  align-items: center;
  font-weight: 600;
}
.summary-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  color: var(--ct-body-color, #1e293b);
}
.summary-divider {
  height: 1px;
  background: var(--ct-border-color, #e6e9ef);
  margin: 0.15rem 0;
}
.summary-fc {
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
}
.summary-fc strong {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  margin: 0 0.25rem;
}
.summary-fc .status-tag {
  margin-left: 0.5rem;
  font-size: 0.7rem;
  font-weight: 800;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.5);
}
.fc-ok {
  background: rgba(16, 185, 129, 0.14);
  color: #047857;
}
.fc-high {
  background: rgba(239, 68, 68, 0.12);
  color: #b91c1c;
}
.fc-na {
  background: var(--ct-tertiary-bg, #f8fafc);
  color: var(--ct-secondary-color, #64748b);
}
.summary-warn {
  font-size: 0.78rem;
  color: #b45309;
  background: rgba(245, 158, 11, 0.1);
  border-radius: 8px;
  padding: 0.35rem 0.55rem;
}

.hint-line {
  font-size: 0.78rem;
  color: var(--ct-secondary-color, #64748b);
}

/* SearchSelect dropdown — float above neighboring cards */
:deep(.searchselect .dropdown-panel) { z-index: 2000 !important; }
:deep(.searchselect) { position: relative; z-index: 5; }

@media (max-width: 767.98px) {
  .line-row { grid-template-columns: 1fr; gap: 0.4rem; }
  .menu-scroll { max-height: 50vh; }
}
</style>
