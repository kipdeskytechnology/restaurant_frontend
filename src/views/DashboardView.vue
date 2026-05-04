<script setup>
// Restaurant dashboard — ported from POS frontenda Dashboard.vue with the
// data layer remapped to Restaurant's Order/OrderLine/Payment models. The
// visual structure (hero filter bar, day/month toggle, gradient stat tiles,
// KPI mini grid, soft-card sections, ApexCharts) is intentionally kept
// 1:1 so the look matches across products.
import { onMounted, onBeforeUnmount, ref, computed, watch, nextTick } from 'vue';
import http from '../api/http';
import {
  getDashboardCounts,
  getDashboardData,
  getDashboardSalesChart,
} from '../api/dashboard';
import { useAuthStore } from '../stores/auth';
import DefaultLayout from '../layouts/DefaultLayout.vue';

/* -------------------- Auth / role -------------------- */
const auth = useAuthStore();
const SUPER_ROLES_DASH = new Set(['admin', 'superadmin', 'super_admin', 'super admin', 'system_admin']);

// Restaurant's `me.roles` is an array of role names. POS used a single
// `me.role` string, so the source pattern doesn't translate directly —
// match if any of the user's roles is a known super role.
const isAdminUser = computed(() => {
  const roles = (auth.me?.roles || []).map((r) => String(r).trim().toLowerCase());
  return roles.some((r) => SUPER_ROLES_DASH.has(r));
});

/* -------------------- Filters -------------------- */
const today = new Date();
const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

const viewMode = ref(localStorage.getItem('dashboardViewMode') || 'month');
const month = ref(localStorage.getItem('dashboardMonth') || ym);
const day = ref(localStorage.getItem('dashboardDay') || todayYmd);
const outletId = ref(null);
const outlets = ref([]);

const autoRefresh = ref(JSON.parse(localStorage.getItem('dashboardAutoRefresh') ?? 'true'));
const refreshSeconds = ref(Number(localStorage.getItem('dashboardRefreshSec') ?? 60));
let refreshTimer = null;
const clearTimer = () => { if (refreshTimer) clearInterval(refreshTimer); };

async function loadOutlets() {
  try {
    // Restaurant frontend uses /system/outlets (not /outlets like POS).
    const { data } = await http.get('/system/outlets');
    outlets.value = Array.isArray(data) ? data : (data?.items || []);
    if (!isAdminUser.value && auth.me?.outlet_id) outletId.value = auth.me.outlet_id;
  } catch {
    outlets.value = [];
  }
}

const selectedOutletName = computed(() => {
  if (!outletId.value) return 'All Outlets';
  const o = outlets.value.find((x) => x.id === outletId.value);
  return o?.name || 'Outlet';
});

const periodLabel = computed(() => {
  if (viewMode.value === 'day') {
    try {
      const d = new Date(day.value + 'T00:00:00');
      return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return day.value; }
  }
  try {
    const [y, m] = month.value.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  } catch { return month.value; }
});

/* mobile filters offcanvas */
let filtersOffcanvas = null;
function openFilters() {
  const el = document.getElementById('dashboardFiltersOffcanvas');
  const OC = window.bootstrap?.Offcanvas;
  if (!el || !OC) return;
  filtersOffcanvas = OC.getOrCreateInstance(el, { backdrop: true, keyboard: true });
  filtersOffcanvas.show();
}
function applyFilters() { filtersOffcanvas?.hide?.(); }

/* -------------------- Currency -------------------- */
const currencyCode = ref('ZMW');
const currencySymbolMap = { ZMW: 'K', ZAR: 'R', USD: '$', EUR: '€', GBP: '£', ZWL: 'Z$', BWP: 'P' };
const currencySymbol = computed(() => currencySymbolMap[currencyCode.value] || currencyCode.value);

/* -------------------- State -------------------- */
const loading = ref(true);
const kpis = ref({
  grossRevenue: 0, totalDiscount: 0, taxCollected: 0, otherIncome: 0,
  netRevenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0,
  stockPurchase: 0, totalReturn: 0, totalLoss: 0, outstandingBalance: 0,
  netProfit: 0, totalOutlets: 0, totalProducts: 0, totalCustomers: 0,
  totalUsers: 0, todaysales: 0, customersToday: 0,
});

const tables = ref({
  bestSellers: [], outOfStock: [], fastMoving: {}, slowMoving: {},
  topCustomers: [], transactionsByEmployee: [], paymentMethods: [],
  salesByOutlet: [],
});
const monthTxCount = ref(0);
const snapshots = ref({ stockValuation: 0, losses: 0 });
const hourlyChart = ref([]);
const dailyChart = ref([]);

/* -------------------- Utils -------------------- */
const fmtMoney = (v) =>
  Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (v) => Number(v || 0).toLocaleString();
const fmtCompact = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return n.toFixed(0);
};

/* -------------------- API -------------------- */
function commonParams() {
  const p = { month: month.value, outlet_id: outletId.value };
  if (viewMode.value === 'day') p.day = day.value;
  return p;
}

async function loadCurrencyMeta() {
  try {
    const { data } = await http.get('/expenses/meta');
    if (data?.default_currency) currencyCode.value = String(data.default_currency).toUpperCase();
  } catch { /* ignore */ }
}

async function loadKpis() {
  const data = await getDashboardCounts(commonParams());
  Object.assign(kpis.value, data || {});
}

async function loadBlocksAndCharts() {
  const data = await getDashboardData(commonParams());
  snapshots.value.stockValuation = Number(data?.inventory?.stock_valuation || 0);
  snapshots.value.losses         = Number(data?.inventory?.losses || 0);

  tables.value.outOfStock              = data?.inventory?.out_of_stock || [];
  tables.value.bestSellers             = data?.best_sellers || [];
  tables.value.fastMoving              = data?.inventory?.fast_moving || {};
  tables.value.slowMoving              = data?.inventory?.slow_moving || {};
  tables.value.topCustomers            = data?.customer_insights?.top_customers || [];
  tables.value.transactionsByEmployee  = data?.employee_performance?.transactions || [];
  tables.value.paymentMethods          = data?.transactions?.payment_methods || [];
  tables.value.salesByOutlet           = data?.sales_by_outlet || [];
  monthTxCount.value                   = Number(data?.transactions?.count_month || 0);

  kpis.value.customersToday = Number(data?.customer_insights?.served_today || 0);

  await nextTick();
  await drawOutletDonut(tables.value.salesByOutlet);
  await drawEmployeeBar(data?.employee_performance?.sales || []);
}

async function loadSalesChart() {
  const data = await getDashboardSalesChart(commonParams());
  if (viewMode.value === 'day') {
    hourlyChart.value = Array.isArray(data) ? data : [];
    dailyChart.value = [];
  } else {
    dailyChart.value = Array.isArray(data) ? data : [];
    hourlyChart.value = [];
  }
  await nextTick();
  if (viewMode.value === 'day') {
    await drawHourlyChart(hourlyChart.value);
    await drawHourlyTxnChart(hourlyChart.value);
  } else {
    await drawSalesTrend(dailyChart.value);
  }
}

/* -------------------- Charts (ApexCharts, lazy) -------------------- */
let Apex = null;
let salesByOutletChart = null;
let employeeBarChart = null;
let salesTrendChart = null;
let hourlyAreaChart = null;
let hourlyTxnChart = null;

async function ensureApex() {
  if (!Apex) {
    const mod = await import('apexcharts');
    Apex = mod.default || mod;
  }
}
function destroyChart(inst, sel) {
  try { if (inst) inst.destroy(); } catch {}
  const el = document.querySelector(sel);
  if (el) el.innerHTML = '';
}

const APEX_THEME = {
  colors: ['#6366f1', '#10b981', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6'],
  fontFamily: 'Inter, "Plus Jakarta Sans", system-ui, sans-serif',
};

async function drawOutletDonut(rows) {
  await ensureApex();
  destroyChart(salesByOutletChart, '#salesByOutletChart');
  const el = document.querySelector('#salesByOutletChart');
  if (!el) return;
  const labels = rows.map((r) => r?.outlet?.name || 'Unknown');
  const values = rows.map((r) => Number(r?.total || 0));
  if (!values.length) {
    el.innerHTML = '<div class="text-center text-muted small py-5">No sales data</div>';
    return;
  }
  salesByOutletChart = new Apex(el, {
    chart: { type: 'donut', height: 280, toolbar: { show: false }, fontFamily: APEX_THEME.fontFamily },
    series: values,
    labels,
    colors: APEX_THEME.colors,
    stroke: { width: 0 },
    legend: { position: 'bottom', fontWeight: 500 },
    dataLabels: { enabled: false },
    tooltip: { y: { formatter: (v) => `${currencySymbol.value}${Number(v).toFixed(2)}` } },
    plotOptions: {
      pie: {
        donut: {
          size: '72%',
          labels: {
            show: true,
            name: { fontSize: '0.75rem', color: '#64748b' },
            value: { fontSize: '1.15rem', fontWeight: 700 },
            total: {
              show: true,
              label: 'Total',
              fontSize: '0.75rem',
              color: '#64748b',
              formatter: () => `${currencySymbol.value}${fmtCompact(values.reduce((a, b) => a + b, 0))}`,
            },
          },
        },
      },
    },
  });
  salesByOutletChart.render();
}

async function drawEmployeeBar(rows) {
  await ensureApex();
  destroyChart(employeeBarChart, '#employeeChart');
  const el = document.querySelector('#employeeChart');
  if (!el) return;
  const labels = rows.map((r) => r?.user?.last_name || r?.user?.first_name || 'Unknown');
  const values = rows.map((r) => Number(r?.total_sales || 0));
  if (!values.length) {
    el.innerHTML = '<div class="text-center text-muted small py-5">No employee data</div>';
    return;
  }
  employeeBarChart = new Apex(el, {
    chart: { type: 'bar', height: 280, toolbar: { show: false }, fontFamily: APEX_THEME.fontFamily },
    series: [{ name: 'Sales', data: values }],
    colors: ['#6366f1'],
    xaxis: { categories: labels, labels: { style: { colors: '#64748b' } } },
    yaxis: { labels: { formatter: (v) => `${currencySymbol.value}${fmtCompact(v)}`, style: { colors: '#64748b' } } },
    grid: { borderColor: '#eef2f7', strokeDashArray: 4 },
    plotOptions: { bar: { borderRadius: 6, columnWidth: '55%' } },
    dataLabels: { enabled: false },
    tooltip: { y: { formatter: (v) => `${currencySymbol.value}${Number(v).toFixed(2)}` } },
  });
  employeeBarChart.render();
}

async function drawSalesTrend(rows) {
  await ensureApex();
  destroyChart(salesTrendChart, '#salesTrendChart');
  const el = document.querySelector('#salesTrendChart');
  if (!el) return;

  const processed = rows.map((d) => Number(d.processed || 0));
  const refunded  = rows.map((d) => Number(d.refunded || 0));
  const days      = rows.map((d) => `Day ${d.day}`);

  // Linear regression on observed days only — extrapolating across the
  // whole month would project a misleadingly straight line for partial months.
  const todayDay = new Date().getDate();
  const past = rows.filter((r) => Number(r.day) <= todayDay);
  const y = past.map((r) => Number(r.processed || 0));
  const n = y.length || 1;
  const x = Array.from({ length: n }, (_, i) => i + 1);
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const denom = (n * sumX2 - sumX * sumX) || 1;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const trend = rows.map((_, idx) => Math.max(0, Math.round(intercept + slope * (idx + 1))));

  salesTrendChart = new Apex(el, {
    chart: { height: 320, stacked: true, toolbar: { show: false }, fontFamily: APEX_THEME.fontFamily },
    stroke: { width: [0, 0, 3], curve: 'smooth' },
    colors: ['#6366f1', '#ef4444', '#f59e0b'],
    series: [
      { name: 'Processed', type: 'bar', data: processed },
      { name: 'Refunded',  type: 'bar', data: refunded },
      { name: 'Trend',     type: 'line', data: trend },
    ],
    fill: { opacity: [0.95, 0.7, 1] },
    plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
    grid: { borderColor: '#eef2f7', strokeDashArray: 4 },
    xaxis: { categories: days, labels: { style: { colors: '#64748b', fontSize: '0.7rem' } } },
    yaxis: { labels: { formatter: (v) => `${currencySymbol.value}${fmtCompact(v)}`, style: { colors: '#64748b' } } },
    legend: { position: 'top', horizontalAlign: 'right', fontWeight: 500 },
    dataLabels: { enabled: false },
    tooltip: { shared: true, y: { formatter: (v) => `${currencySymbol.value} ${fmtMoney(v)}` } },
  });
  salesTrendChart.render();
}

async function drawHourlyChart(rows) {
  await ensureApex();
  destroyChart(hourlyAreaChart, '#hourlyChart');
  const el = document.querySelector('#hourlyChart');
  if (!el) return;

  const cats     = rows.map((r) => `${String(r.hour).padStart(2, '0')}:00`);
  const processed = rows.map((r) => Number(r.processed || 0));
  const refunded  = rows.map((r) => Number(r.refunded || 0));

  hourlyAreaChart = new Apex(el, {
    chart: { type: 'area', height: 320, toolbar: { show: false }, zoom: { enabled: false }, fontFamily: APEX_THEME.fontFamily },
    colors: ['#6366f1', '#ef4444'],
    series: [
      { name: 'Processed', data: processed },
      { name: 'Refunded',  data: refunded },
    ],
    stroke: { curve: 'smooth', width: 3 },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] },
    },
    grid: { borderColor: '#eef2f7', strokeDashArray: 4 },
    xaxis: { categories: cats, labels: { style: { colors: '#64748b', fontSize: '0.7rem' } } },
    yaxis: { labels: { formatter: (v) => `${currencySymbol.value}${fmtCompact(v)}`, style: { colors: '#64748b' } } },
    legend: { position: 'top', horizontalAlign: 'right' },
    dataLabels: { enabled: false },
    markers: { size: 0, hover: { size: 5 } },
    tooltip: { shared: true, y: { formatter: (v) => `${currencySymbol.value} ${fmtMoney(v)}` } },
  });
  hourlyAreaChart.render();
}

async function drawHourlyTxnChart(rows) {
  await ensureApex();
  destroyChart(hourlyTxnChart, '#hourlyTxnChart');
  const el = document.querySelector('#hourlyTxnChart');
  if (!el) return;

  const cats = rows.map((r) => `${String(r.hour).padStart(2, '0')}`);
  const txns = rows.map((r) => Number(r.transactions || 0));

  hourlyTxnChart = new Apex(el, {
    chart: { type: 'bar', height: 180, toolbar: { show: false }, sparkline: { enabled: false }, fontFamily: APEX_THEME.fontFamily },
    colors: ['#10b981'],
    series: [{ name: 'Transactions', data: txns }],
    plotOptions: { bar: { borderRadius: 4, columnWidth: '50%' } },
    dataLabels: { enabled: false },
    grid: { borderColor: '#eef2f7', strokeDashArray: 4, padding: { left: 0, right: 0 } },
    xaxis: { categories: cats, labels: { style: { colors: '#94a3b8', fontSize: '0.65rem' } }, axisTicks: { show: false } },
    yaxis: { labels: { formatter: (v) => Math.round(v), style: { colors: '#94a3b8', fontSize: '0.65rem' } } },
    legend: { show: false },
    tooltip: { y: { formatter: (v) => `${Math.round(v)} txn` } },
  });
  hourlyTxnChart.render();
}

/* -------------------- Mini KPI tiles (mirrors POS layout) -------------------- */
// Built as a computed so currencySymbol/kpis reactivity flows through. Order
// and labels match pos/frontenda Dashboard.vue 1:1; only "Products" is
// renamed to "Menu Items" to suit a restaurant menu.
const miniKpis = computed(() => [
  { t: 'Total Discount',    v: `${currencySymbol.value}${fmtMoney(kpis.value.totalDiscount)}`,     i: 'ri-price-tag-3-line' },
  { t: 'Tax Collected',     v: `${currencySymbol.value}${fmtMoney(kpis.value.taxCollected)}`,      i: 'ri-bank-line' },
  { t: 'Other Income',      v: `${currencySymbol.value}${fmtMoney(kpis.value.otherIncome)}`,       i: 'ri-money-dollar-circle-line' },
  { t: 'COGS',              v: `${currencySymbol.value}${fmtMoney(kpis.value.cogs)}`,              i: 'ri-shopping-bag-3-line' },
  { t: 'Operating Exp.',    v: `${currencySymbol.value}${fmtMoney(kpis.value.operatingExpenses)}`, i: 'ri-exchange-dollar-line' },
  { t: 'Stock Purchase',    v: `${currencySymbol.value}${fmtMoney(kpis.value.stockPurchase)}`,     i: 'ri-truck-line' },
  { t: 'Total Refunds',     v: `${currencySymbol.value}${fmtMoney(kpis.value.totalReturn)}`,       i: 'ri-arrow-go-back-line' },
  { t: 'Total Loss',        v: `${currencySymbol.value}${fmtMoney(kpis.value.totalLoss)}`,         i: 'ri-error-warning-line' },
  { t: 'Outstanding',       v: `${currencySymbol.value}${fmtMoney(kpis.value.outstandingBalance)}`,i: 'ri-hand-coin-line' },
  { t: 'Stock Valuation',   v: `${currencySymbol.value}${fmtMoney(snapshots.value.stockValuation)}`,i: 'ri-archive-2-line' },
  { t: 'Outlets',           v: fmtInt(kpis.value.totalOutlets),    i: 'ri-store-2-line' },
  { t: 'Menu Items',        v: fmtInt(kpis.value.totalProducts),   i: 'ri-restaurant-2-line' },
  { t: 'Customers',         v: fmtInt(kpis.value.totalCustomers),  i: 'ri-user-3-line' },
  { t: 'Users',             v: fmtInt(kpis.value.totalUsers),      i: 'ri-team-line' },
]);

/* -------------------- Day-mode derived insights -------------------- */
const dayKpis = computed(() => {
  const totalSales = hourlyChart.value.reduce((a, r) => a + Number(r.processed || 0), 0);
  const totalRefunds = hourlyChart.value.reduce((a, r) => a + Number(r.refunded || 0), 0);
  const totalTxn = hourlyChart.value.reduce((a, r) => a + Number(r.transactions || 0), 0);
  const avgBasket = totalTxn > 0 ? totalSales / totalTxn : 0;
  let peakHour = null, peakValue = -1;
  for (const r of hourlyChart.value) {
    if (Number(r.processed || 0) > peakValue) {
      peakValue = Number(r.processed || 0);
      peakHour = r.hour;
    }
  }
  return {
    totalSales, totalRefunds, totalTxn, avgBasket,
    peakHour: peakHour == null ? '—' : `${String(peakHour).padStart(2, '0')}:00`,
    peakValue: peakValue < 0 ? 0 : peakValue,
  };
});

/* -------------------- Lifecycle -------------------- */
async function loadAll() {
  loading.value = true;
  try {
    await Promise.all([
      loadCurrencyMeta(),
      loadKpis(),
      loadBlocksAndCharts(),
      loadSalesChart(),
    ]);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  if (!auth.me) { try { await auth.fetchMe(); } catch {} }
  await loadOutlets();
  loadAll();
  if (autoRefresh.value) {
    clearTimer();
    refreshTimer = setInterval(loadAll, refreshSeconds.value * 1000);
  }
});

onBeforeUnmount(() => {
  clearTimer();
  destroyChart(salesByOutletChart, '#salesByOutletChart');
  destroyChart(employeeBarChart, '#employeeChart');
  destroyChart(salesTrendChart, '#salesTrendChart');
  destroyChart(hourlyAreaChart, '#hourlyChart');
  destroyChart(hourlyTxnChart, '#hourlyTxnChart');
  try { filtersOffcanvas?.hide?.(); } catch {}
});

watch(viewMode, (v) => {
  localStorage.setItem('dashboardViewMode', v);
  loadAll();
});
watch(month, (v) => { localStorage.setItem('dashboardMonth', v); loadAll(); });
watch(day,   (v) => { localStorage.setItem('dashboardDay', v);   if (viewMode.value === 'day') loadAll(); });
watch(outletId, () => loadAll());

watch([autoRefresh, refreshSeconds], () => {
  localStorage.setItem('dashboardAutoRefresh', JSON.stringify(!!autoRefresh.value));
  localStorage.setItem('dashboardRefreshSec', String(Math.max(5, Number(refreshSeconds.value) || 60)));
  clearTimer();
  if (autoRefresh.value) {
    refreshTimer = setInterval(loadAll, Math.max(5, Number(refreshSeconds.value) || 60) * 1000);
  }
});
</script>

<template>
  <DefaultLayout>
    <div class="dashboard-page">
      <!-- ============= HERO / FILTER BAR ============= -->
      <div class="dash-hero card border-0 shadow-sm mb-3">
        <div class="dash-hero-body">
          <div class="d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3">
            <!-- Title block -->
            <div class="d-flex align-items-center gap-3 min-w-0">
              <div class="dash-hero-badge">
                <i class="ri-dashboard-3-line"></i>
              </div>
              <div class="min-w-0">
                <div class="text-uppercase fw-semibold dash-hero-eyebrow">
                  {{ viewMode === 'day' ? 'Daily snapshot' : 'Monthly overview' }}
                </div>
                <h2 class="h4 mb-0 text-truncate dash-hero-title">{{ periodLabel }}</h2>
                <div class="text-muted small text-truncate">
                  <i class="ri-store-2-line me-1"></i>{{ selectedOutletName }}
                  <span class="mx-2 opacity-25">|</span>
                  <i class="ri-time-line me-1"></i>{{ autoRefresh ? `Auto-refresh every ${refreshSeconds}s` : 'Manual refresh' }}
                </div>
              </div>
            </div>

            <!-- Filter controls (desktop) -->
            <div class="dash-filter-row d-none d-md-flex align-items-end flex-wrap gap-2">
              <div class="dash-segmented" role="tablist" aria-label="Dashboard view mode">
                <button
                  type="button"
                  class="dash-seg-btn"
                  :class="{ active: viewMode === 'month' }"
                  @click="viewMode = 'month'"
                >
                  <i class="ri-calendar-2-line me-1"></i>Month
                </button>
                <button
                  type="button"
                  class="dash-seg-btn"
                  :class="{ active: viewMode === 'day' }"
                  @click="viewMode = 'day'"
                >
                  <i class="ri-calendar-event-line me-1"></i>Single Day
                </button>
              </div>

              <div class="d-flex flex-column">
                <label class="form-label small mb-1">{{ viewMode === 'day' ? 'Date' : 'Month' }}</label>
                <input
                  v-if="viewMode === 'day'"
                  type="date"
                  v-model="day"
                  class="form-control form-control-sm"
                  style="min-width: 160px"
                />
                <input
                  v-else
                  type="month"
                  v-model="month"
                  class="form-control form-control-sm"
                  style="min-width: 160px"
                />
              </div>

              <div class="d-flex flex-column">
                <label class="form-label small mb-1">Outlet</label>
                <select
                  v-model="outletId"
                  class="form-select form-select-sm"
                  style="min-width: 200px"
                  :disabled="!isAdminUser"
                >
                  <option :value="null">All Outlets</option>
                  <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
                </select>
              </div>

              <div class="vr d-none d-xl-block mx-1" style="height: 36px; align-self: end" />

              <div class="d-flex align-items-end gap-2">
                <div class="form-check form-switch mb-1">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    id="autoRefreshSwitch"
                    v-model="autoRefresh"
                  />
                  <label class="form-check-label small" for="autoRefreshSwitch">Auto</label>
                </div>
                <div class="d-flex flex-column">
                  <label class="form-label small mb-1">Sec</label>
                  <input
                    v-model.number="refreshSeconds"
                    type="number"
                    min="5"
                    step="5"
                    class="form-control form-control-sm"
                    style="width: 80px"
                  />
                </div>
                <button
                  class="btn btn-soft-primary btn-sm align-self-end"
                  @click="loadAll"
                  title="Refresh now"
                >
                  <i class="ri-refresh-line"></i>
                </button>
              </div>
            </div>

            <!-- Filter controls (mobile / tablet) -->
            <div class="d-flex d-md-none align-items-center gap-2 w-100">
              <div class="dash-segmented flex-grow-1">
                <button
                  type="button"
                  class="dash-seg-btn flex-fill"
                  :class="{ active: viewMode === 'month' }"
                  @click="viewMode = 'month'"
                ><i class="ri-calendar-2-line me-1"></i>Month</button>
                <button
                  type="button"
                  class="dash-seg-btn flex-fill"
                  :class="{ active: viewMode === 'day' }"
                  @click="viewMode = 'day'"
                ><i class="ri-calendar-event-line me-1"></i>Day</button>
              </div>
              <button class="btn btn-light btn-sm" @click="loadAll" aria-label="Refresh">
                <i class="ri-refresh-line"></i>
              </button>
              <button class="btn btn-primary btn-sm" @click="openFilters">
                <i class="ri-equalizer-line"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ============= LOADING ============= -->
      <div class="dash-content position-relative">
        <div
          v-if="loading"
          class="dash-overlay d-flex flex-column align-items-center justify-content-center"
        >
          <div class="spinner-border spinner-border-sm mb-2 text-primary" role="status"></div>
          <div class="small text-muted">Refreshing metrics…</div>
        </div>

        <!-- =================== SINGLE-DAY MODE ================== -->
        <template v-if="viewMode === 'day'">
          <div class="row g-2 g-md-3 mb-3">
            <div class="col-6 col-lg-3">
              <div class="card stat-tile stat-primary h-100">
                <div class="card-body">
                  <div class="stat-label">Total Sales</div>
                  <div class="stat-value">{{ currencySymbol }}{{ fmtMoney(dayKpis.totalSales) }}</div>
                  <div class="stat-sub"><i class="ri-shopping-cart-2-line"></i> {{ fmtInt(dayKpis.totalTxn) }} transactions</div>
                </div>
                <div class="stat-icon"><i class="ri-line-chart-line"></i></div>
              </div>
            </div>
            <div class="col-6 col-lg-3">
              <div class="card stat-tile stat-success h-100">
                <div class="card-body">
                  <div class="stat-label">Avg Basket</div>
                  <div class="stat-value">{{ currencySymbol }}{{ fmtMoney(dayKpis.avgBasket) }}</div>
                  <div class="stat-sub"><i class="ri-shopping-bag-3-line"></i> per transaction</div>
                </div>
                <div class="stat-icon"><i class="ri-shopping-bag-3-line"></i></div>
              </div>
            </div>
            <div class="col-6 col-lg-3">
              <div class="card stat-tile stat-warning h-100">
                <div class="card-body">
                  <div class="stat-label">Peak Hour</div>
                  <div class="stat-value">{{ dayKpis.peakHour }}</div>
                  <div class="stat-sub"><i class="ri-flashlight-line"></i> {{ currencySymbol }}{{ fmtCompact(dayKpis.peakValue) }} peak</div>
                </div>
                <div class="stat-icon"><i class="ri-time-line"></i></div>
              </div>
            </div>
            <div class="col-6 col-lg-3">
              <div class="card stat-tile stat-danger h-100">
                <div class="card-body">
                  <div class="stat-label">Refunds</div>
                  <div class="stat-value">{{ currencySymbol }}{{ fmtMoney(dayKpis.totalRefunds) }}</div>
                  <div class="stat-sub"><i class="ri-arrow-go-back-line"></i> for the day</div>
                </div>
                <div class="stat-icon"><i class="ri-error-warning-line"></i></div>
              </div>
            </div>
          </div>

          <div class="card soft-card mb-3">
            <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
              <div>
                <span class="fw-semibold">Hourly Sales Trend</span>
                <div class="text-muted small">Processed vs refunded for {{ periodLabel }}</div>
              </div>
              <span class="badge bg-primary-subtle text-primary">
                <i class="ri-time-line me-1"></i>00:00 – 23:00
              </span>
            </div>
            <div class="card-body">
              <div id="hourlyChart" class="dash-chart-lg"></div>
            </div>
          </div>

          <div class="row g-2 g-md-3 mb-3">
            <div class="col-12 col-xl-6">
              <div class="card soft-card h-100">
                <div class="card-header d-flex justify-content-between align-items-center">
                  <span class="fw-semibold">Transactions by Hour</span>
                  <i class="ri-bar-chart-grouped-line text-success"></i>
                </div>
                <div class="card-body">
                  <div id="hourlyTxnChart" class="dash-chart-sm"></div>
                </div>
              </div>
            </div>

            <div class="col-12 col-xl-6">
              <div class="card soft-card h-100">
                <div class="card-header d-flex justify-content-between align-items-center">
                  <span class="fw-semibold">Sales by Outlet</span>
                  <i class="ri-store-3-line text-success"></i>
                </div>
                <div class="card-body">
                  <div id="salesByOutletChart" class="dash-chart-sm"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="row g-2 g-md-3">
            <div class="col-12 col-lg-6">
              <div class="card soft-card h-100">
                <div class="card-header d-flex justify-content-between align-items-center">
                  <span class="fw-semibold">Top Sellers Today</span>
                  <i class="ri-star-smile-line text-warning"></i>
                </div>
                <div class="card-body p-0">
                  <div class="table-responsive dash-table">
                    <table class="table table-sm table-hover mb-0 align-middle">
                      <thead>
                        <tr>
                          <th>Dish</th>
                          <th class="text-end">Qty</th>
                          <th class="text-end">Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="row in tables.bestSellers" :key="row?.product_id || row?.name">
                          <td class="small fw-medium">{{ row?.name }}</td>
                          <td class="text-end small">{{ fmtInt(row?.quantity) }}</td>
                          <td class="text-end small">{{ currencySymbol }}{{ fmtMoney(row?.revenue) }}</td>
                        </tr>
                        <tr v-if="!tables.bestSellers.length">
                          <td colspan="3" class="text-center text-muted small py-4">No sales yet today</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <div class="col-12 col-lg-6">
              <div class="card soft-card h-100">
                <div class="card-header d-flex justify-content-between align-items-center">
                  <span class="fw-semibold">Payment Methods</span>
                  <i class="ri-bank-card-2-line text-primary"></i>
                </div>
                <div class="card-body">
                  <ul class="dash-pm-list mb-0">
                    <li v-for="m in tables.paymentMethods" :key="m?.payment_method">
                      <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="fw-medium">{{ m?.payment_method || 'Unknown' }}</span>
                        <span class="text-muted small">
                          {{ m?.count }}x &middot; {{ currencySymbol }}{{ fmtMoney(m?.total) }}
                        </span>
                      </div>
                    </li>
                    <li v-if="!tables.paymentMethods.length" class="text-muted small text-center py-3">
                      No transactions yet today
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- =================== MONTH MODE ======================= -->
        <template v-else>
          <div class="row g-2 g-md-3 mb-3">
            <div class="col-6 col-md-4 col-xl-3" v-for="k in [
              { t: 'Gross Revenue',     v: `${currencySymbol}${fmtMoney(kpis.grossRevenue)}`,     i: 'ri-line-chart-line',         tone: 'primary' },
              { t: 'Net Revenue',       v: `${currencySymbol}${fmtMoney(kpis.netRevenue)}`,       i: 'ri-funds-line',              tone: 'success' },
              { t: 'Gross Profit',      v: `${currencySymbol}${fmtMoney(kpis.grossProfit)}`,      i: 'ri-bar-chart-2-line',        tone: 'info' },
              { t: 'Net Profit',        v: `${currencySymbol}${fmtMoney(kpis.netProfit)}`,        i: 'ri-money-cny-box-line',      tone: 'warning' },
            ]" :key="'big-'+k.t">
              <div class="card stat-tile h-100" :class="`stat-${k.tone}`">
                <div class="card-body">
                  <div class="stat-label">{{ k.t }}</div>
                  <div class="stat-value">{{ k.v }}</div>
                  <div class="stat-sub"><i class="ri-calendar-line"></i> {{ periodLabel }}</div>
                </div>
                <div class="stat-icon"><i :class="k.i"></i></div>
              </div>
            </div>
          </div>

          <div class="row g-2 g-md-3 mb-3">
            <div class="col-6 col-sm-4 col-md-3 col-xl-2"
                 v-for="k in miniKpis" :key="'kpi-'+k.t">
              <div class="card kpi-mini h-100">
                <div class="card-body d-flex align-items-center gap-2">
                  <div class="kpi-mini-icon"><i :class="k.i"></i></div>
                  <div class="min-w-0 flex-grow-1">
                    <div class="kpi-mini-label">{{ k.t }}</div>
                    <div class="kpi-mini-value text-truncate">{{ k.v }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="card soft-card mb-3">
            <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
              <div>
                <span class="fw-semibold">Sales Trend</span>
                <div class="text-muted small">Processed vs refunded with linear trend line</div>
              </div>
              <span class="badge bg-primary-subtle text-primary">
                <i class="ri-calendar-2-line me-1"></i>{{ monthTxCount }} txns
              </span>
            </div>
            <div class="card-body">
              <div id="salesTrendChart" class="dash-chart-lg"></div>
            </div>
          </div>

          <div class="row g-2 g-md-3 mb-3">
            <div class="col-12 col-md-6 col-xl-3">
              <div class="card soft-card h-100">
                <div class="card-header d-flex justify-content-between align-items-center">
                  <span class="fw-semibold">Best Sellers</span>
                  <i class="ri-star-smile-line text-warning"></i>
                </div>
                <div class="card-body p-0">
                  <div class="table-responsive dash-table">
                    <table class="table table-sm table-hover mb-0 align-middle">
                      <thead>
                        <tr><th>Dish</th><th class="text-end">Qty</th><th class="text-end">Revenue</th></tr>
                      </thead>
                      <tbody>
                        <tr v-for="row in tables.bestSellers" :key="row?.product_id || row?.name">
                          <td class="small fw-medium">{{ row?.name }}</td>
                          <td class="text-end small">{{ fmtInt(row?.quantity) }}</td>
                          <td class="text-end small">{{ currencySymbol }}{{ fmtMoney(row?.revenue) }}</td>
                        </tr>
                        <tr v-if="!tables.bestSellers.length">
                          <td colspan="3" class="text-center text-muted small py-3">No sales yet</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <div class="col-12 col-md-6 col-xl-3">
              <div class="card soft-card h-100">
                <div class="card-header d-flex justify-content-between align-items-center">
                  <span class="fw-semibold">Out of Stock</span>
                  <i class="ri-alert-line text-danger"></i>
                </div>
                <div class="card-body p-0">
                  <div class="table-responsive dash-table">
                    <table class="table table-sm table-hover mb-0 align-middle">
                      <thead>
                        <tr><th>Ingredient</th><th class="text-end">Qty</th></tr>
                      </thead>
                      <tbody>
                        <tr v-for="row in tables.outOfStock" :key="row?.product?.id">
                          <td class="small fw-medium">{{ row?.product?.name || 'Unknown' }}</td>
                          <td class="text-end small">
                            {{ row?.quantity }}
                            <i class="ri-alert-fill text-danger ms-1"></i>
                          </td>
                        </tr>
                        <tr v-if="!tables.outOfStock.length">
                          <td colspan="2" class="text-center text-muted small py-3">All stocked</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <div class="col-12 col-md-6 col-xl-3">
              <div class="card soft-card h-100">
                <div class="card-header d-flex justify-content-between align-items-center">
                  <span class="fw-semibold">Customer Insights</span>
                  <i class="ri-user-star-line text-primary"></i>
                </div>
                <div class="card-body small">
                  <p class="mb-2">
                    Customers served today:
                    <b>{{ fmtInt(kpis.customersToday || 0) }}</b>
                  </p>
                  <div class="dash-mini-title text-muted mb-1">Top Customers</div>
                  <ul class="list-unstyled mb-0">
                    <li v-for="c in tables.topCustomers"
                        :key="c?.customer?.id"
                        class="d-flex justify-content-between mb-1">
                      <span class="text-truncate me-2">{{ c?.customer?.name || 'Walk-In' }}</span>
                      <span class="fw-semibold">{{ currencySymbol }}{{ fmtCompact(c?.total_spent) }}</span>
                    </li>
                    <li v-if="!tables.topCustomers.length" class="text-muted small">None yet</li>
                  </ul>
                </div>
              </div>
            </div>

            <div class="col-12 col-md-6 col-xl-3">
              <div class="card soft-card h-100">
                <div class="card-header d-flex justify-content-between align-items-center">
                  <span class="fw-semibold">Sales by Outlet</span>
                  <i class="ri-store-3-line text-success"></i>
                </div>
                <div class="card-body">
                  <div id="salesByOutletChart" class="dash-chart-sm"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="row g-2 g-md-3">
            <div class="col-12 col-xl-6">
              <div class="card soft-card h-100">
                <div class="card-header fw-semibold">Employee Performance</div>
                <div class="card-body">
                  <div class="row g-3">
                    <div class="col-12 col-lg-7">
                      <div id="employeeChart" class="dash-chart-sm"></div>
                    </div>
                    <div class="col-12 col-lg-5 dash-side-list">
                      <div class="mb-3">
                        <div class="dash-mini-title text-muted mb-1">Transactions by Employee</div>
                        <ul class="list-unstyled mb-0 small">
                          <li v-for="t in tables.transactionsByEmployee"
                              :key="t?.user?.id"
                              class="d-flex justify-content-between mb-1">
                            <span>{{ t?.user?.last_name || t?.user?.first_name || 'Unknown' }}</span>
                            <span class="fw-semibold">{{ t?.transactions }}</span>
                          </li>
                          <li v-if="!tables.transactionsByEmployee.length" class="text-muted">None</li>
                        </ul>
                      </div>
                      <div>
                        <div class="dash-mini-title text-muted mb-1">Payment Methods</div>
                        <ul class="list-unstyled mb-0 small">
                          <li v-for="m in tables.paymentMethods"
                              :key="m?.payment_method"
                              class="d-flex justify-content-between mb-1">
                            <span>{{ m?.payment_method }} <span class="text-muted">×{{ m?.count }}</span></span>
                            <span class="fw-semibold">{{ currencySymbol }}{{ fmtCompact(m?.total) }}</span>
                          </li>
                          <li v-if="!tables.paymentMethods.length" class="text-muted">None</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="col-12 col-xl-6">
              <div class="card soft-card h-100">
                <div class="card-header fw-semibold">Dish Velocity</div>
                <div class="card-body small">
                  <div class="row g-3">
                    <div class="col-12 col-md-6">
                      <div class="dash-mini-title text-muted mb-2">
                        <i class="ri-flashlight-line text-success me-1"></i>Fast Moving
                      </div>
                      <ul class="list-unstyled mb-0">
                        <li v-for="(qty, name) in tables.fastMoving"
                            :key="'fast-'+name"
                            class="d-flex justify-content-between mb-1">
                          <span class="text-truncate me-2">{{ name }}</span>
                          <span class="fw-semibold">{{ fmtInt(qty) }}</span>
                        </li>
                        <li v-if="!Object.keys(tables.fastMoving).length" class="text-muted">None</li>
                      </ul>
                    </div>
                    <div class="col-12 col-md-6 dash-side-list">
                      <div class="dash-mini-title text-muted mb-2">
                        <i class="ri-pause-circle-line text-warning me-1"></i>Slow Moving
                      </div>
                      <ul class="list-unstyled mb-0">
                        <li v-for="(qty, name) in tables.slowMoving"
                            :key="'slow-'+name"
                            class="d-flex justify-content-between mb-1">
                          <span class="text-truncate me-2">{{ name }}</span>
                          <span class="fw-semibold">{{ fmtInt(qty) }}</span>
                        </li>
                        <li v-if="!Object.keys(tables.slowMoving).length" class="text-muted">None</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- ============= MOBILE FILTERS OFFCANVAS ============= -->
      <div
        class="offcanvas offcanvas-bottom"
        tabindex="-1"
        id="dashboardFiltersOffcanvas"
        aria-labelledby="dashboardFiltersOffcanvasLabel"
      >
        <div class="offcanvas-header">
          <h6 id="dashboardFiltersOffcanvasLabel" class="mb-0">Dashboard Filters</h6>
          <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
        </div>
        <div class="offcanvas-body small">
          <div class="row g-3">
            <div class="col-12">
              <label class="form-label small mb-1">View Mode</label>
              <div class="dash-segmented">
                <button type="button" class="dash-seg-btn flex-fill" :class="{ active: viewMode === 'month' }" @click="viewMode = 'month'">
                  <i class="ri-calendar-2-line me-1"></i>Month
                </button>
                <button type="button" class="dash-seg-btn flex-fill" :class="{ active: viewMode === 'day' }" @click="viewMode = 'day'">
                  <i class="ri-calendar-event-line me-1"></i>Day
                </button>
              </div>
            </div>
            <div class="col-12">
              <label class="form-label small mb-1">{{ viewMode === 'day' ? 'Date' : 'Month' }}</label>
              <input v-if="viewMode === 'day'" type="date" v-model="day" class="form-control form-control-sm" />
              <input v-else type="month" v-model="month" class="form-control form-control-sm" />
            </div>
            <div class="col-12">
              <label class="form-label small mb-1">Outlet</label>
              <select v-model="outletId" class="form-select form-select-sm" :disabled="!isAdminUser">
                <option :value="null">All Outlets</option>
                <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.name }}</option>
              </select>
            </div>
            <div class="col-7">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="autoRefreshSwitchMobile" v-model="autoRefresh" />
                <label class="form-check-label" for="autoRefreshSwitchMobile">Auto-refresh</label>
              </div>
            </div>
            <div class="col-5">
              <label class="form-label small mb-1">Every (sec)</label>
              <input v-model.number="refreshSeconds" type="number" min="5" step="5" class="form-control form-control-sm" />
            </div>
          </div>
          <div class="d-flex justify-content-end gap-2 mt-3">
            <button class="btn btn-light btn-sm" data-bs-dismiss="offcanvas">Close</button>
            <button class="btn btn-primary btn-sm" @click="applyFilters">
              <i class="ri-check-line me-1"></i>Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<style scoped>
/* ---------------- Page wrapper ---------------- */
.dashboard-page {
  padding: 1rem 0.75rem;
  max-width: 1600px;
  margin: 0 auto;
}
@media (min-width: 768px) {
  .dashboard-page { padding: 1.25rem 1rem; }
}
@media (min-width: 1200px) {
  .dashboard-page { padding: 1.5rem 1.25rem; }
}

/* ---------------- Hero / filter bar ---------------- */
.dash-hero {
  background:
    radial-gradient(600px 220px at 0% 0%, rgba(99, 102, 241, .14), transparent 60%),
    radial-gradient(700px 250px at 100% 100%, rgba(16, 185, 129, .12), transparent 60%),
    linear-gradient(180deg, var(--ct-card-bg, #fff), var(--ct-card-bg, #fff));
  border: 1px solid var(--ct-border-color, #e6e9ef) !important;
  border-radius: 18px;
  overflow: hidden;
}
.dash-hero-body { padding: 1rem 1.1rem; }
@media (min-width: 768px) { .dash-hero-body { padding: 1.15rem 1.4rem; } }

.dash-hero-eyebrow {
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  color: #6366f1;
}
.dash-hero-title {
  font-family: "Plus Jakarta Sans", "Inter", sans-serif;
  font-weight: 800;
  letter-spacing: -.02em;
  line-height: 1.15;
}
.dash-hero-badge {
  width: 48px; height: 48px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #fff;
  font-size: 1.45rem;
  box-shadow: 0 8px 18px -8px rgba(99, 102, 241, .55);
  flex-shrink: 0;
}
@media (max-width: 575.98px) {
  .dash-hero-badge { width: 40px; height: 40px; font-size: 1.2rem; border-radius: 12px; }
  .dash-hero-title { font-size: 1.05rem; }
}

.dash-filter-row { row-gap: 0.5rem; }

/* Segmented control */
.dash-segmented {
  display: inline-flex;
  background: rgba(99, 102, 241, .08);
  padding: 4px;
  border-radius: 999px;
  gap: 2px;
}
.dash-seg-btn {
  border: none;
  background: transparent;
  color: #475569;
  padding: 0.4rem 0.95rem;
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: 999px;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color .2s ease, color .2s ease, box-shadow .2s ease;
}
.dash-seg-btn:hover { color: #6366f1; }
.dash-seg-btn.active {
  background: #fff;
  color: #4f46e5;
  box-shadow: 0 4px 10px -4px rgba(99, 102, 241, .35);
}
@media (max-width: 575.98px) {
  .dash-seg-btn { padding: 0.4rem 0.6rem; font-size: 0.75rem; }
}

/* ---------------- Content area ---------------- */
.dash-content { min-height: 200px; }

.dash-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, .55);
  backdrop-filter: blur(2px);
  z-index: 5;
  border-radius: 14px;
}
[data-bs-theme="dark"] .dash-overlay { background: rgba(15, 23, 42, .55); }

/* ---------------- Stat tile (large KPI) ---------------- */
.stat-tile {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  transition: transform .2s ease, box-shadow .2s ease;
}
.stat-tile:hover { transform: translateY(-2px); box-shadow: 0 14px 32px -16px rgba(15,23,42,.25); }
.stat-tile .card-body { position: relative; z-index: 1; padding: 1rem 1.1rem; }
.stat-tile .stat-label {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 0.35rem;
}
.stat-tile .stat-value {
  font-family: "Plus Jakarta Sans", "Inter", sans-serif;
  font-weight: 800;
  letter-spacing: -.02em;
  font-size: clamp(1.05rem, 1.4vw + 0.6rem, 1.6rem);
  line-height: 1.2;
  margin-bottom: 0.25rem;
  word-break: break-word;
}
.stat-tile .stat-sub {
  font-size: 0.72rem;
  color: #94a3b8;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.stat-tile .stat-icon {
  position: absolute;
  right: -10px; bottom: -10px;
  width: 78px; height: 78px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  color: rgba(255,255,255,0.7);
  z-index: 0;
}
.stat-tile.stat-primary { background: linear-gradient(135deg, rgba(99,102,241,.1), rgba(139,92,246,.05)); }
.stat-tile.stat-primary .stat-value { color: #4f46e5; }
.stat-tile.stat-primary .stat-icon  { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; }
.stat-tile.stat-success { background: linear-gradient(135deg, rgba(16,185,129,.1), rgba(6,182,212,.05)); }
.stat-tile.stat-success .stat-value { color: #047857; }
.stat-tile.stat-success .stat-icon  { background: linear-gradient(135deg, #10b981, #06b6d4); color: #fff; }
.stat-tile.stat-warning { background: linear-gradient(135deg, rgba(245,158,11,.1), rgba(239,68,68,.05)); }
.stat-tile.stat-warning .stat-value { color: #b45309; }
.stat-tile.stat-warning .stat-icon  { background: linear-gradient(135deg, #f59e0b, #ef4444); color: #fff; }
.stat-tile.stat-danger { background: linear-gradient(135deg, rgba(239,68,68,.1), rgba(244,63,94,.05)); }
.stat-tile.stat-danger .stat-value { color: #b91c1c; }
.stat-tile.stat-danger .stat-icon  { background: linear-gradient(135deg, #ef4444, #f43f5e); color: #fff; }
.stat-tile.stat-info { background: linear-gradient(135deg, rgba(6,182,212,.1), rgba(14,165,233,.05)); }
.stat-tile.stat-info .stat-value { color: #0e7490; }
.stat-tile.stat-info .stat-icon  { background: linear-gradient(135deg, #06b6d4, #0ea5e9); color: #fff; }

/* ---------------- KPI mini ---------------- */
.kpi-mini {
  border-radius: 14px;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
  transition: border-color .2s ease, transform .2s ease, box-shadow .2s ease;
}
.kpi-mini:hover {
  border-color: rgba(99,102,241,.25);
  transform: translateY(-1px);
  box-shadow: 0 10px 24px -16px rgba(15,23,42,.2);
}
.kpi-mini .card-body { padding: 0.7rem 0.85rem; }
.kpi-mini-icon {
  flex-shrink: 0;
  width: 36px; height: 36px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(99,102,241,.1);
  color: #6366f1;
  font-size: 1.05rem;
}
.kpi-mini-label {
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kpi-mini-value {
  font-family: "Plus Jakarta Sans", "Inter", sans-serif;
  font-weight: 700;
  font-size: 0.98rem;
  letter-spacing: -.015em;
  color: var(--ct-body-color, #1e293b);
}

/* ---------------- Soft card ---------------- */
.soft-card {
  border-radius: 16px;
  border: 1px solid var(--ct-border-color, #e6e9ef);
  background: var(--ct-card-bg, #fff);
}
.soft-card .card-header {
  background: transparent;
  border-bottom: 1px solid var(--ct-border-color, #e6e9ef);
  padding: 0.75rem 1rem;
  font-weight: 600;
}
.soft-card .card-body { padding: 1rem; }

/* ---------------- Tables in cards ---------------- */
.dash-table { max-height: 260px; overflow: auto; }
.dash-table .table { margin-bottom: 0; font-size: 0.8rem; }
.dash-table .table > :not(caption) > * > * { padding: 0.5rem 0.75rem; }
.dash-table thead th {
  position: sticky;
  top: 0;
  background: var(--ct-tertiary-bg, #f8fafc);
  z-index: 1;
}

/* ---------------- Charts ---------------- */
.dash-chart-lg { min-height: 320px; width: 100%; }
.dash-chart-sm { min-height: 280px; width: 100%; }
@media (max-width: 575.98px) {
  .dash-chart-lg { min-height: 260px; }
  .dash-chart-sm { min-height: 240px; }
}

/* ---------------- Side list separator ---------------- */
.dash-side-list {
  border-left: 1px solid var(--ct-border-color, #e6e9ef);
  padding-left: 1rem;
}
@media (max-width: 991.98px) {
  .dash-side-list {
    border-left: none;
    border-top: 1px dashed var(--ct-border-color, #e6e9ef);
    padding-left: 0;
    padding-top: 0.85rem;
    margin-top: 0.5rem;
  }
}

/* ---------------- Misc ---------------- */
.dash-mini-title {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.dash-pm-list { list-style: none; padding: 0; margin: 0; }
.dash-pm-list li { padding: 0.5rem 0; border-bottom: 1px dashed var(--ct-border-color, #e6e9ef); }
.dash-pm-list li:last-child { border-bottom: none; }
.min-w-0 { min-width: 0; }

/* ---------------- Dark mode ---------------- */
[data-bs-theme="dark"] .dash-hero {
  background:
    radial-gradient(600px 220px at 0% 0%, rgba(99, 102, 241, .25), transparent 60%),
    radial-gradient(700px 250px at 100% 100%, rgba(16, 185, 129, .18), transparent 60%),
    var(--ct-card-bg);
}
[data-bs-theme="dark"] .dash-segmented { background: rgba(99,102,241,.18); }
[data-bs-theme="dark"] .dash-seg-btn { color: #cbd5e1; }
[data-bs-theme="dark"] .dash-seg-btn.active { background: #1e293b; color: #c7d2fe; }
[data-bs-theme="dark"] .stat-tile.stat-primary .stat-value { color: #c7d2fe; }
[data-bs-theme="dark"] .stat-tile.stat-success .stat-value { color: #6ee7b7; }
[data-bs-theme="dark"] .stat-tile.stat-warning .stat-value { color: #fcd34d; }
[data-bs-theme="dark"] .stat-tile.stat-danger  .stat-value { color: #fca5a5; }
[data-bs-theme="dark"] .stat-tile.stat-info    .stat-value { color: #67e8f9; }
[data-bs-theme="dark"] .kpi-mini-icon { background: rgba(99,102,241,.18); color: #c7d2fe; }
[data-bs-theme="dark"] .dash-table thead th { background: var(--ct-tertiary-bg); }
[data-bs-theme="dark"] .dash-overlay { background: rgba(11, 18, 32, .55); }
</style>
