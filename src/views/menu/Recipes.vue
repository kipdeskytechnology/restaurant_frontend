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

  // handle both "/uploads/..." and "uploads/..."
  if (u.startsWith("/uploads/")) return `${apiBaseURL}/assets${u}`;
  if (u.startsWith("uploads/")) return `${apiBaseURL}/assets/${u}`;

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
function compatibleUomIdsForInventory(invId) {
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

// For SearchSelect (label/value)
function uomOptionsForInventory(invId) {
  const allowed = new Set(compatibleUomIdsForInventory(invId));
  return (uoms.value || [])
    .filter((u) => allowed.has(Number(u.id)))
    .map((u) => ({ label: `${u.code} — ${u.name}`, value: u.id }));
}

// For <select> rows (uom objects)
function uomsForInventory(invId) {
  const allowed = new Set(compatibleUomIdsForInventory(invId));
  return (uoms.value || []).filter((u) => allowed.has(Number(u.id)));
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
  const state = { ...recipeStatusByMenuId.value };
  try {
    for (const m of menuItems.value || []) {
      try {
        const r = await getRecipeByMenuItem(Number(m.id));
        const linesCount = r ? (r.lines || []).length : 0;
        state[m.id] = {
          has_recipe: !!r && linesCount > 0,
          lines_count: linesCount,
          checked: true,
        };
      } catch {
        state[m.id] = { has_recipe: false, lines_count: 0, checked: true };
      }
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
  const left = PDF_THEME.margin;
  const right = PDF_THEME.margin;
  const usable = pageW - left - right;

  // legend
  drawLegendPills(doc, 78);

  // widths must sum to `usable`
  const w0 = 28;  // #
  const w2 = 68;  // Price
  const w3 = 76;  // Est. Cost
  const w4 = 72;  // Food Cost %
  const w5 = 56;  // Cost Status
  const w6 = 56;  // Recipe (YES/NO)
  const w7 = 45;  // Page
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
      0: { halign: "left",  cellWidth: w0 },
      1: { halign: "left",  cellWidth: w1 },
      2: { halign: "right", cellWidth: w2 },
      3: { halign: "right", cellWidth: w3 },
      4: { halign: "right", cellWidth: w4 },
      5: { halign: "center", cellWidth: w5 }, // Cost status pill
      6: { halign: "center", cellWidth: w6 }, // Recipe YES/NO pill
      7: { halign: "center", cellWidth: w7 }, // Page number
    },
  
    didParseCell: (data) => {
      // ✅ header alignment to match body columns
      if (data.section === "head") {
        const col = data.column.index;
        if (col === 2 || col === 3 || col === 4) data.cell.styles.halign = "right";
        else if (col === 5 || col === 6 || col === 7) data.cell.styles.halign = "center";
        else data.cell.styles.halign = "left";
      }
  
      // ✅ Cost Status coloring (column 5)
      if (data.section === "body" && data.column.index === 5) {
        const v = String(data.cell.raw || "").toUpperCase();
  
        if (v === "HIGH") data.cell.styles.fillColor = [220, 53, 69];   // red
        else if (v === "OK") data.cell.styles.fillColor = [40, 167, 69]; // green
        else data.cell.styles.fillColor = [108, 117, 125];              // gray
  
        data.cell.styles.textColor = 255;
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.halign = "center";
      }
  
      // ✅ Recipe YES/NO coloring (column 6)
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
  if (imgUrl) dishImg = await fetchAsDataUrl(imgUrl);

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

    // cache logo ONCE (design only)
    cachedStoreLogoDataUrl = null;
    const logoUrl = storeLogoUrl(storeProfile.value);
    if (logoUrl) cachedStoreLogoDataUrl = await fetchAsDataUrl(logoUrl);

    const doc = new jsPDF({ unit: "pt", format: "a4" });

    // Build stats FIRST (so cover + index are correct)
    const dishes = [];
    let totalBusinessCost = 0;
    let dishesWithCost = 0;

    for (const m of list) {
      let r = null;
      try {
        r = await getRecipeByMenuItem(Number(m.id));
      } catch {
        r = null;
      }

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

    // PAGE 1: cover
    await drawCoverPage(doc, reportMeta);

    // PAGE 2+: index of all dishes
    doc.addPage();
    const DISH_PAGES_START_AT = 3; // cover=1, index=2, first dish page=3

    const indexRows = dishes.map((d, i) => {
      const pctTxt = d.foodCostPct == null ? "-" : `${d.foodCostPct.toFixed(1)}%`;
    
      const costStatusTxt = d.hasRecipe ? d.costStatus.label : "N/A";
      const recipeStatusTxt = d.hasRecipe ? "YES" : "NO";
      const pageNoTxt = String(DISH_PAGES_START_AT + i);
    
      return [
        String(i + 1),
        d.name,
        d.price == null ? "-" : fmtMoney(d.price),
        d.hasRecipe ? fmtMoney(d.cost) : "-",
        d.hasRecipe ? pctTxt : "-",
        costStatusTxt,      // ✅ Cost status (OK/HIGH/N/A)
        recipeStatusTxt,    // ✅ Recipe status (YES/NO)
        pageNoTxt,          // ✅ Page number
      ];
    });
    drawDishIndex(doc, indexRows);

    // After index, start dish pages on a fresh page
    doc.addPage();

    // Dish pages (one per page)
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
    <!-- HERO HEADER -->
    <div class="recipes-hero mb-3" style="zoom: 80%;">
      <div class="d-flex align-items-center justify-content-between gap-2 flex-wrap">
        <div class="d-flex align-items-center gap-3">
          <div class="store-badge">
            <img
              v-if="storeProfile && storeLogoUrl(storeProfile)"
              :src="storeLogoUrl(storeProfile)"
              class="store-logo"
            />
            <div v-else class="store-logo placeholder"></div>
          </div>

          <div class="min-w-0">
            <div class="hero-title">Recipes</div>
            <div class="hero-subtitle">
              <span v-if="storeProfile?.name" class="me-2">🏪 {{ storeProfile.name }}</span>
              <span class="opacity-75">Build ingredient recipes for costing & stock usage.</span>
            </div>
          </div>
        </div>

        <div class="d-flex gap-2">
          <button class="btn btn-light" :disabled="loading || checking" @click="refreshRecipeStatuses">
            <span v-if="checking"><span class="spinner-border spinner-border-sm me-1"></span> Checking…</span>
            <span v-else>Refresh Status</span>
          </button>

          <button class="btn btn-light" :disabled="loading || checking || exporting" @click="exportToPdf">
            <span v-if="exporting"><span class="spinner-border spinner-border-sm me-1"></span> Exporting…</span>
            <span v-else>Export to PDF</span>
          </button>
        </div>
      </div>
    </div>

    <div class="row g-3" style="zoom: 80%;">
      <!-- LEFT -->
      <div class="col-12 col-md-4">
        <div class="card soft-card">
          <div class="card-body">
            <div class="d-flex align-items-center justify-content-between mb-2">
              <div class="fw-bold">Menu Items</div>
              <span class="chip chip-muted">{{ filteredMenuItems.length }} shown</span>
            </div>

            <div class="row g-2">
              <div class="col-12">
                <label class="form-label">Search</label>
                <input v-model="menuSearch" class="form-control" placeholder="Type dish name..." />
              </div>

              <div class="col-12">
                <label class="form-label">Filter</label>
                <select v-model="recipeFilter" class="form-select">
                  <option value="all">All</option>
                  <option value="yes">With recipe</option>
                  <option value="no">Missing recipe</option>
                </select>
              </div>
            </div>

            <div class="menu-scroll mt-3">
              <div
                v-for="m in filteredMenuItems"
                :key="m.id"
                class="menu-tile"
                :class="Number(selectedMenuItemId) === Number(m.id) ? 'active' : ''"
                role="button"
                @click="ensureRecipeForMenuItem(m.id)"
              >
                <div class="tile-img">
                  <img v-if="menuItemImageUrl(m)" :src="menuItemImageUrl(m)" />
                  <div v-else class="tile-img placeholder">🍽️</div>
                </div>

                <div class="min-w-0">
                  <div class="tile-title text-truncate">{{ m.name }}</div>
                  <div class="tile-meta">
                    <span
                      class="chip"
                      :class="statusFor(m.id).checked && statusFor(m.id).has_recipe ? 'chip-green' : 'chip-red'"
                    >
                      {{ statusFor(m.id).checked && statusFor(m.id).has_recipe ? "Has recipe" : "Missing" }}
                    </span>
                    <span class="chip chip-muted ms-1">{{ statusFor(m.id).lines_count || 0 }} lines</span>
                  </div>
                </div>

                <i class="ri-arrow-right-s-line tile-arrow"></i>
              </div>

              <div v-if="filteredMenuItems.length === 0" class="text-center text-muted py-4">
                No menu items found
              </div>
            </div>

            <div class="text-muted small mt-2">
              Tip: click a dish to load/create its recipe.
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT -->
      <div class="col-12 col-md-8">
        <div class="card soft-card">
          <div class="card-header bg-white border-0 pb-0">
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
              <div class="d-flex align-items-center gap-3">
                <div class="dish-avatar">
                  <img
                    v-if="selectedMenuItem && menuItemImageUrl(selectedMenuItem)"
                    :src="menuItemImageUrl(selectedMenuItem)"
                  />
                  <div v-else class="dish-avatar placeholder">🍽️</div>
                </div>

                <div>
                  <div class="fw-bold">Recipe Editor</div>
                  <div class="text-muted small">
                    <span v-if="selectedMenuItemId">
                      Dish: <b>{{ selectedMenuItemName }}</b>
                      <span v-if="recipe" class="ms-2">• {{ meta.total }} lines • {{ meta.unique }} unique</span>
                    </span>
                    <span v-else>Select a dish on the left.</span>
                  </div>
                </div>
              </div>

              <div class="d-flex gap-2 align-items-center">
                <span v-if="recipe" class="chip" :class="isDirty ? 'chip-warn' : 'chip-green'">
                  {{ isDirty ? "Unsaved changes" : "Saved" }}
                </span>

                <button class="btn btn-light" :disabled="saving || !isDirty" @click="discardChanges">
                  Discard
                </button>

                <button class="btn btn-primary" :disabled="!canSave" @click="saveAllLines">
                  <span v-if="saving"><span class="spinner-border spinner-border-sm me-1"></span> Saving…</span>
                  <span v-else>Save</span>
                </button>
              </div>
            </div>
          </div>

          <div class="card-body pt-3">
            <div v-if="loading" class="d-flex align-items-center gap-2">
              <div class="spinner-border" role="status" aria-hidden="true"></div>
              <div>Loading…</div>
            </div>

            <div v-else-if="!recipe" class="text-center text-muted py-5">
              Select a dish on the left to view or create its recipe.
            </div>

            <template v-else>
              <!-- Add ingredient -->
              <div class="add-card mb-3">
                <div class="row g-2 align-items-end">
                  <div class="col-md-6">
                    <label class="form-label">Inventory item</label>
                    <SearchSelect
                      v-model="newLine.inventory_item_id"
                      :options="inventoryOptions"
                      placeholder="Search inventory items…"
                      :clearable="true"
                      :searchable="true"
                    />
                  </div>

                  <div class="col-md-2">
                    <label class="form-label">Qty</label>
                    <input
                      v-model="newLine.qty"
                      type="number"
                      step="0.000001"
                      class="form-control"
                      placeholder="0.25"
                    />
                  </div>

                  <div class="col-md-2">
                    <label class="form-label">UOM</label>
                    <SearchSelect
                      v-model="newLine.uom_id"
                      :options="uomOptionsForInventory(newLine.inventory_item_id)"
                      placeholder="Pick UOM…"
                      :clearable="true"
                      :searchable="true"
                    />
                  </div>

                  <div class="col-md-2 d-grid">
                    <button class="btn btn-primary" :disabled="saving" @click="addLineLocal">
                      <i class="ri-add-line me-1"></i> Add
                    </button>
                  </div>
                </div>
              </div>

              <!-- Lines table -->
              <div class="table-responsive">
                <table class="table table-sm table-bordered align-middle mb-0">
                  <thead class="bg-light">
                    <tr>
                      <th>Ingredient</th>
                      <th style="width: 140px" class="text-end">Qty</th>
                      <th style="width: 220px">UOM</th>
                      <th style="width: 190px"></th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr v-for="(l, idx) in lines" :key="`${l.id || 0}-${idx}`">
                      <td>
                        <div class="fw-semibold">{{ invNameById(l.inventory_item_id) }}</div>
                        <div class="text-muted small">
                          <span class="chip chip-muted me-1">{{ l.id ? "Saved" : "Local" }}</span>
                          • {{ Number(l.qty || 0) }} {{ uomCodeById(l.uom_id) || "UOM" }}
                        </div>
                      </td>

                      <td class="text-end">
                        <input
                          v-model="l.qty"
                          type="number"
                          step="0.000001"
                          class="form-control form-control-sm text-end"
                        />
                      </td>

                      <td>
                        <select v-model="l.uom_id" class="form-select form-select-sm">
                          <option v-for="u in uomsForInventory(l.inventory_item_id)" :key="u.id" :value="u.id">
                            {{ u.code }} — {{ u.name }}
                          </option>
                        </select>
                      </td>

                      <td class="text-end">
                        <button class="btn btn-sm btn-outline-danger me-2" :disabled="saving" @click="removeLineLocal(idx)">
                          Remove
                        </button>
                        <button v-if="l.id" class="btn btn-sm btn-danger" :disabled="saving" @click="removeLineServer(l)">
                          Delete
                        </button>
                      </td>
                    </tr>

                    <tr v-if="lines.length === 0">
                      <td colspan="4" class="text-center text-muted">No ingredients yet</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="text-muted small mt-2">
                Save replaces all lines to keep the recipe consistent.
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
.recipes-hero{
  background: linear-gradient(135deg, #6f42c1 0%, #ff6f00 55%, #00bcd4 100%);
  border-radius: 16px;
  padding: 18px 18px;
  color: #fff;
  box-shadow: 0 10px 25px rgba(0,0,0,.10);
}
.hero-title{ font-size: 20px; font-weight: 800; letter-spacing: .3px; }
.hero-subtitle{ font-size: 12px; opacity: .95; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.store-badge{ width: 52px; height: 52px; border-radius: 14px; background: rgba(255,255,255,.18); display:flex; align-items:center; justify-content:center; }
.store-logo{ width: 44px; height: 44px; border-radius: 12px; object-fit: cover; background: #fff; }
.store-logo.placeholder{ width: 44px; height: 44px; border-radius: 12px; background: rgba(255,255,255,.25); }
.soft-card{ border: 0; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,.06); }
.menu-scroll{ max-height: 62vh; overflow: auto; padding-right: 4px; }
.menu-tile{
  display:flex; align-items:center; gap:10px;
  border: 1px solid rgba(0,0,0,.06);
  border-radius: 14px;
  padding: 10px;
  margin-bottom: 10px;
  background: #fff;
  transition: all .15s ease;
}
.menu-tile:hover{ transform: translateY(-1px); box-shadow: 0 8px 20px rgba(0,0,0,.06); }
.menu-tile.active{ border-color: rgba(111,66,193,.35); background: rgba(111,66,193,.05); }
.tile-img{ width: 44px; height: 44px; border-radius: 12px; overflow:hidden; background: #f6f6f8; display:flex; align-items:center; justify-content:center; }
.tile-img img{ width: 100%; height: 100%; object-fit: cover; }
.tile-img.placeholder{ color:#888; font-size: 18px; }
.tile-title{ font-weight: 700; }
.tile-meta{ margin-top: 4px; display:flex; align-items:center; flex-wrap:wrap; }
.tile-arrow{ margin-left:auto; color: rgba(0,0,0,.35); font-size: 18px; }
.chip{
  display:inline-flex; align-items:center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid rgba(0,0,0,.08);
  background: #fff;
}
.chip-muted{ background: #f8f9fa; color: #555; }
.chip-green{ background: rgba(40,167,69,.12); border-color: rgba(40,167,69,.25); color:#1e7e34; }
.chip-red{ background: rgba(220,53,69,.12); border-color: rgba(220,53,69,.25); color:#b21f2d; }
.chip-warn{ background: rgba(255,193,7,.18); border-color: rgba(255,193,7,.3); color:#8a6d00; }
.dish-avatar{ width: 46px; height: 46px; border-radius: 14px; overflow:hidden; background:#f6f6f8; display:flex; align-items:center; justify-content:center; }
.dish-avatar img{ width: 100%; height: 100%; object-fit: cover; }
.dish-avatar.placeholder{ color:#888; font-size: 18px; }
.add-card{
  border: 1px dashed rgba(0,0,0,.12);
  background: linear-gradient(180deg, rgba(111,66,193,.06), rgba(255,111,0,.04));
  border-radius: 16px;
  padding: 12px;
}
</style>
