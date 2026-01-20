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

import { listUoms } from "../../api/setupUom";
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
  const id = Number(line?.uom_id || 0);
  if (id) return;
  const def = defaultUomId();
  if (def) line.uom_id = def;
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
  inventoryItems.value = await listInventoryItems();

  // preload default UOM (changeable)
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
    recipe.value.lines = (recipe.value.lines || []).filter((x) => x.id !== line.id);
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

// ---------- PDF EXPORT (REDESIGNED) ----------
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
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);

    // ✅ force fresh response (avoids cached non-CORS copy)
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

/**
 * ✅ Watermark visible but not "overlaying" the content:
 * - Draw watermark FIRST (background)
 * - Make tables BODY transparent (fillColor: false) so watermark shows through
 * - Keep text readable by using very light watermark color
 */
function addWatermark(doc, text = "CONFIDENTIAL") {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  doc.saveGraphicsState?.();

  // lighter = "more transparent" look
  doc.setTextColor(248, 248, 248);
  doc.setFontSize(64);
  doc.setFont(undefined, "bold");
  doc.text(text, w / 2, h / 2, { align: "center", angle: 35 });

  doc.setFont(undefined, "normal");
  doc.setTextColor(0, 0, 0);

  doc.restoreGraphicsState?.();
}

function addTopBar(doc, title = "Recipe Report", subtitle = "") {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(111, 66, 193); // purple
  doc.rect(0, 0, w, 54, "F");
  doc.setFillColor(255, 111, 0); // orange accent
  doc.rect(0, 54, w, 4, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(title, 18, 32);

  if (subtitle) {
    doc.setFontSize(10);
    doc.text(subtitle, 18, 46);
  }

  doc.setTextColor(0, 0, 0);
}

function addFooter(doc, pageNo, totalPages, rightText = "") {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  doc.setDrawColor(235);
  doc.line(18, h - 38, w - 18, h - 38);

  doc.setFontSize(9);
  doc.setTextColor(130);

  const left = storeProfile.value?.name ? `${storeProfile.value.name}` : "Store";
  doc.text(left, 18, h - 22);

  const mid = `Page ${pageNo} of ${totalPages}`;
  doc.text(mid, w / 2, h - 22, { align: "center" });

  if (rightText) doc.text(rightText, w - 18, h - 22, { align: "right" });

  doc.setTextColor(0, 0, 0);
}

function computeLineCost(inv, qty, uomId) {
  if (!inv) return null;
  const avg = Number(inv.avg_cost);
  const base = Number(inv.base_uom_id);
  const q = Number(qty);

  if (!Number.isFinite(avg) || !Number.isFinite(q)) return null;
  if (!base || Number(base) !== Number(uomId)) return null;

  return avg * q;
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

async function drawCoverPage(doc, reportMeta) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  addWatermark(doc, "INTERNAL");
  addTopBar(doc, "Confidential Recipe Report", "Store Recipe & Costing Pack");

  const logoUrl = storeLogoUrl(storeProfile.value);
  const logoDataUrl = logoUrl ? await fetchAsDataUrl(logoUrl) : null;

  const storeName = storeProfile.value?.name || "Store";
  const topY = 84;

  // logo box
  if (logoDataUrl) {
    try {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(18, topY, 78, 78, 14, 14, "F");
      doc.addImage(logoDataUrl, "PNG", 26, topY + 8, 62, 62);
    } catch {
      // ignore
    }
  } else {
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(18, topY, 78, 78, 14, 14, "F");
    doc.setTextColor(140);
    doc.setFontSize(10);
    doc.text("LOGO", 57, topY + 44, { align: "center" });
    doc.setTextColor(0);
  }

  // big store name
  doc.setFontSize(28);
  doc.setTextColor(20, 20, 20);
  doc.setFont(undefined, "bold");
  doc.text(storeName, 110, topY + 34);
  doc.setFont(undefined, "normal");

  doc.setFontSize(11);
  doc.setTextColor(90, 90, 90);
  doc.text("Recipe & Costing Summary", 110, topY + 56);

  // store info card
  const cardY = 190;
  doc.setFillColor(248, 249, 250);
  doc.roundedRect(18, cardY, w - 36, 120, 14, 14, "F");

  doc.setTextColor(25, 25, 25);
  doc.setFontSize(12);
  doc.setFont(undefined, "bold");
  doc.text("Store Information", 34, cardY + 28);
  doc.setFont(undefined, "normal");

  const linesTxt = storeLineText();
  doc.setFontSize(10);
  doc.setTextColor(70, 70, 70);

  let yy = cardY + 48;
  if (linesTxt.length) {
    for (const ln of linesTxt) {
      doc.text(ln, 34, yy);
      yy += 14;
    }
  } else {
    doc.text("Store information not available.", 34, yy);
    yy += 14;
  }

  // confidentiality paragraph
  const para =
    "CONFIDENTIAL BUSINESS RECIPE DOCUMENT — This report contains proprietary recipes, ingredient usage, and costing estimates. " +
    "It is intended strictly for authorized management and approved staff. Unauthorized access, sharing, copying, or distribution is prohibited. " +
    "Keep this document secure at all times and handle it as sensitive business information.";

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(18, 328, w - 36, 120, 14, 14, "F");

  doc.setFontSize(12);
  doc.setTextColor(220, 53, 69);
  doc.setFont(undefined, "bold");
  doc.text("Security & Confidentiality Notice", 34, 356);
  doc.setFont(undefined, "normal");

  doc.setFontSize(10);
  doc.setTextColor(70, 70, 70);
  splitParagraph(doc, para, 34, 376, w - 68, 14);

  // business cost card
  doc.setFillColor(111, 66, 193);
  doc.roundedRect(18, 470, w - 36, 92, 16, 16, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont(undefined, "bold");
  doc.text("Current Cost of Running the Business (Estimated)", 34, 498);
  doc.setFont(undefined, "normal");

  doc.setFontSize(28);
  doc.text(`${fmtMoney(reportMeta.totalBusinessCost)}`, 34, 534);

  doc.setFontSize(10);
  doc.setTextColor(235, 235, 235);
  doc.text(
    `Based on ingredient avg_cost where recipe UOM equals ingredient Base UOM • ${reportMeta.dishesWithCost}/${reportMeta.totalDishes} dishes costed`,
    34,
    554
  );

  // generated stamp
  doc.setTextColor(120);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 18, h - 52);
  doc.text(`Report Scope: ${reportMeta.scopeLabel}`, w - 18, h - 52, { align: "right" });

  doc.setTextColor(0);
}

function drawDishIndex(doc, rows) {
  addWatermark(doc, "INTERNAL");
  addTopBar(doc, "Recipe Report", "Dish List (Index)");

  const pageW = doc.internal.pageSize.getWidth();
  const left = 18;
  const right = 18;
  const usable = pageW - left - right;

  // widths must sum to `usable`
  const w0 = 30;
  const w2 = 90;
  const w3 = 60;
  const w4 = 95;
  const w1 = usable - (w0 + w2 + w3 + w4);

  autoTable(doc, {
    startY: 78,
    margin: { left, right },
    tableWidth: usable, // ✅ lock table width

    head: [["#", "Dish", "Has Recipe", "Lines", "Est. Cost"]],
    body: rows,

    // ✅ keep head colored, make BODY transparent so watermark can show behind (no overlay)
    styles: { fontSize: 9, cellPadding: 6, overflow: "linebreak" },
    headStyles: { fillColor: [25, 118, 210], textColor: 255 },
    bodyStyles: { fillColor: false },
    alternateRowStyles: { fillColor: false },

    columnStyles: {
      0: { halign: "left", cellWidth: w0 },
      1: { halign: "left", cellWidth: w1 },
      2: { halign: "center", cellWidth: w2 },
      3: { halign: "right", cellWidth: w3 },
      4: { halign: "right", cellWidth: w4 },
    },

    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 2) {
        const v = String(data.cell.raw || "").toUpperCase();
        if (v === "YES") data.cell.styles.fillColor = [40, 167, 69];
        if (v === "NO") data.cell.styles.fillColor = [220, 53, 69];
        data.cell.styles.textColor = 255;
        data.cell.styles.fontStyle = "bold";
      }
    },
  });
}

async function drawDishPage(doc, dish, index, total) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  addWatermark(doc, "CONFIDENTIAL");
  addTopBar(doc, "Recipe Report", storeProfile.value?.name || "");

  // Title
  doc.setTextColor(20);
  doc.setFontSize(18);
  doc.setFont(undefined, "bold");
  doc.text(dish.name || `Menu Item #${dish.id}`, 18, 92);
  doc.setFont(undefined, "normal");

  // status pill
  const hasRecipe = dish.hasRecipe;
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.setFillColor(hasRecipe ? 40 : 220, hasRecipe ? 167 : 53, hasRecipe ? 69 : 69);
  doc.roundedRect(w - 148, 78, 130, 22, 7, 7, "F");
  doc.text(hasRecipe ? "HAS RECIPE" : "MISSING RECIPE", w - 83, 93, { align: "center" });

  // Image card
  const imgX = 18;
  const imgY = 110;
  const imgW = 150;
  const imgH = 110;

  doc.setFillColor(248, 249, 250);
  doc.roundedRect(imgX, imgY, imgW, imgH, 14, 14, "F");

  const imgUrl = menuItemImageUrl(dish.raw);
  let dishImg = null;
  if (imgUrl) dishImg = await fetchAsDataUrl(imgUrl);

  if (dishImg) {
    try {
      doc.addImage(dishImg, "JPEG", imgX + 8, imgY + 8, imgW - 16, imgH - 16);
    } catch {
      try {
        doc.addImage(dishImg, "PNG", imgX + 8, imgY + 8, imgW - 16, imgH - 16);
      } catch {
        // ignore
      }
    }
  } else {
    doc.setTextColor(140);
    doc.setFontSize(10);
    doc.text("No Image", imgX + imgW / 2, imgY + imgH / 2 + 4, { align: "center" });
    doc.setTextColor(0);
  }

  // Summary card
  const sumX = imgX + imgW + 14;
  const sumY = imgY;
  const sumW = w - 18 - sumX;
  const sumH = imgH;

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(sumX, sumY, sumW, sumH, 14, 14, "F");
  doc.setDrawColor(235);
  doc.roundedRect(sumX, sumY, sumW, sumH, 14, 14, "S");

  doc.setFontSize(11);
  doc.setTextColor(25);
  doc.setFont(undefined, "bold");
  doc.text("Dish Summary", sumX + 14, sumY + 28);
  doc.setFont(undefined, "normal");

  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(`Lines: ${dish.linesCount}`, sumX + 14, sumY + 50);
  doc.text(`Costed Lines: ${dish.countedLines}`, sumX + 14, sumY + 66);
  doc.text(`Skipped (UOM mismatch): ${dish.skippedLines}`, sumX + 14, sumY + 82);

  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.setFont(undefined, "bold");
  doc.text(`Est. Cost: ${fmtMoney(dish.cost)}`, sumX + 14, sumY + 108);
  doc.setFont(undefined, "normal");

  // Table
  const startY = 240;

  if (!hasRecipe) {
    doc.setFontSize(12);
    doc.setTextColor(120);
    doc.text("No recipe lines for this dish.", 18, startY);
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
    const left = 18;
    const right = 18;
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
    });

    const finalY = doc.lastAutoTable?.finalY || startY + 20;

    doc.setFillColor(248, 249, 250);
    doc.roundedRect(18, finalY + 14, w - 36, 64, 14, 14, "F");

    doc.setFontSize(11);
    doc.setTextColor(25);
    doc.setFont(undefined, "bold");
    doc.text("Costing Note", 32, finalY + 38);
    doc.setFont(undefined, "normal");

    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(
      "Line costs are calculated only when recipe UOM equals ingredient Base UOM.",
      32,
      finalY + 54
    );

    doc.setFontSize(14);
    doc.setTextColor(20);
    doc.setFont(undefined, "bold");
    doc.text(`Total: ${fmtMoney(dish.cost)}`, w - 32, finalY + 48, { align: "right" });
    doc.setFont(undefined, "normal");
  }

  // small counter
  doc.setTextColor(140);
  doc.setFontSize(9);
  doc.text(`Dish ${index} of ${total}`, w - 18, h - 52, { align: "right" });
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

      dishes.push({
        id: m.id,
        name: m.name || `Menu Item #${m.id}`,
        raw: m,
        recipe: r,
        hasRecipe,
        linesCount,
        cost,
        countedLines,
        skippedLines,
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
    const indexRows = dishes.map((d, i) => [
      String(i + 1),
      d.name,
      d.hasRecipe ? "YES" : "NO",
      String(d.linesCount || 0),
      d.hasRecipe ? fmtMoney(d.cost) : "-",
    ]);
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
  () => uoms.value.length,
  () => {
    if (!newLine.value.uom_id) newLine.value.uom_id = defaultUomId();
    if (recipe.value) normalizeLoadedRecipeUoms();
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
                      :options="uomOptions"
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
                          <option v-for="u in uoms" :key="u.id" :value="u.id">
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
