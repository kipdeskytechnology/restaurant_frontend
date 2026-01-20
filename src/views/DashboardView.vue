<script setup>
import { onMounted, onBeforeUnmount, ref, computed, watch, h, defineComponent } from 'vue'
import http from '../api/http'
import { getDashboardSummary } from '../api/dashboard'
import DefaultLayout from "../layouts/DefaultLayout.vue";

// ------- lightweight KPI component (render function; runtime-only Vue friendly) -------
const Kpi = defineComponent({
  name: 'Kpi',
  props: { title: String, value: [String, Number], icon: String },
  setup(props) {
    return () =>
      h('div', { class: 'col-6 col-sm-4 col-md-3 col-xl-2' }, [
        h('div', { class: 'card widget-flat kpi-card h-100' }, [
          h('div', { class: 'card-body d-flex gap-3 align-items-center' }, [
            h('div', { class: 'flex-grow-1' }, [
              h('div', { class: 'text-muted small text-uppercase fw-semibold kpi-label' }, props.title),
              h('div', { class: 'h4 mb-0 kpi-value' }, String(props.value ?? ''))
            ]),
            h('div', { class: 'kpi-icon-wrap d-none d-sm-flex align-items-center justify-content-center' }, [
              h('i', { class: [props.icon || 'ri-dashboard-line', 'widget-icon1', 'fs-3'] })
            ])
          ])
        ])
      ])
  }
})

// ------- Filters: Month (defaults to THIS MONTH) -------
const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const month = ref(localStorage.getItem('dashboardMonth') || ym) // YYYY-MM
const outletId = ref(null)
const outlets = ref([])

// auto refresh
const autoRefresh = ref(JSON.parse(localStorage.getItem('dashboardAutoRefresh') ?? 'true'))
const refreshSeconds = ref(Number(localStorage.getItem('dashboardRefreshSec') ?? 60))
let refreshTimer = null

// mobile filters offcanvas
let filtersOffcanvas = null
function openFilters() {
  const el = document.getElementById('dashboardFiltersOffcanvas')
  const OC = window.bootstrap?.Offcanvas
  if (!el || !OC) return
  filtersOffcanvas = OC.getOrCreateInstance(el, { backdrop: true, keyboard: true })
  filtersOffcanvas.show()
}
function applyFilters() {
  filtersOffcanvas?.hide?.()
}

// ------- Currency handling -------
const currencyCode = ref('ZMW')
const currencySymbolMap = { ZMW: 'K', ZAR: 'R', USD: '$', EUR: '€', GBP: '£', ZWL: 'Z$', BWP: 'P' }
const currencySymbol = computed(() => currencySymbolMap[currencyCode.value] || currencyCode.value)

// ------- State -------
const loading = ref(true)
const kpis = ref({
  grossRevenue: 0, totalDiscount: 0, taxCollected: 0, otherIncome: 0,
  netRevenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0,
  totalReturn: 0, totalLoss: 0, netProfit: 0,

  salesCount: 0, openOrders: 0, tablesOccupied: 0, avgTicketTimeSec: 0,
  customersServed: 0, openTabs: 0, pendingKitchen: 0,
})

const tables = ref({
  bestSellers: [],
  lowStock: [],
  transactionsByEmployee: [],
  paymentMethods: [],
  topCustomers: [],
})

const snapshots = ref({ stockValuation: 0, losses: 0 })

// Charts
let donutChart = null
let employeeBarChart = null
let salesTrendChart = null

// ------- Utils -------
const fmtMoney = (v) =>
  Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtInt = (v) => Number(v || 0).toLocaleString()
const clearTimer = () => { if (refreshTimer) clearInterval(refreshTimer) }

function isoDate(d) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
function monthToRange(ymStr) {
  const [y, m] = String(ymStr || '').split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 0)
  return { start: isoDate(start), end: isoDate(end) }
}
function fmtDuration(sec) {
  sec = Number(sec || 0)
  if (sec <= 0) return '0m'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const mm = m % 60
    return `${h}h ${mm}m`
  }
  return `${m}m ${s}s`
}

// ------- API -------
async function loadCurrencyMeta() {
  try {
    const { data } = await http.get('/expenses/meta')
    if (data?.default_currency) currencyCode.value = String(data.default_currency).toUpperCase()
  } catch { /* fallback */ }
}

async function loadOutlets() {
  try {
    const { data } = await http.get('/system/outlets')
    outlets.value = Array.isArray(data) ? data : (data?.items || [])
  } catch {
    outlets.value = []
  }
}

async function loadDashboard() {
  const { start, end } = monthToRange(month.value)

  // ✅ uses your wrapper
  const data = await getDashboardSummary({ start, end, outlet_id: outletId.value })

  // KPIs
  kpis.value.salesCount = Number(data?.kpis?.sales_count || 0)
  kpis.value.grossRevenue = Number(data?.kpis?.gross_revenue || 0)
  kpis.value.totalDiscount = Number(data?.kpis?.discounts || 0)
  kpis.value.taxCollected = Number(data?.kpis?.tax_collected || 0)
  kpis.value.otherIncome = Number(data?.kpis?.service_charge_tips || 0)
  kpis.value.netRevenue = Number(data?.kpis?.net_revenue || 0)
  kpis.value.cogs = Number(data?.kpis?.food_cost_cogs || 0)
  kpis.value.grossProfit = Number(data?.kpis?.gross_profit || 0)
  kpis.value.operatingExpenses = Number(data?.kpis?.operating_expenses || 0)
  kpis.value.totalReturn = Number(data?.kpis?.refunds_voids || 0)
  kpis.value.totalLoss = Number(data?.kpis?.wastage_loss || 0)
  kpis.value.netProfit = Number(data?.kpis?.net_profit || 0)

  kpis.value.openOrders = Number(data?.kpis?.open_orders || 0)
  kpis.value.tablesOccupied = Number(data?.kpis?.tables_occupied || 0)
  kpis.value.avgTicketTimeSec = Number(data?.kpis?.avg_ticket_time_sec || 0)

  kpis.value.customersServed = Number(data?.customer_insights?.customers_served || 0)
  kpis.value.openTabs = Number(data?.cards?.open_tabs || 0)
  kpis.value.pendingKitchen = Number(data?.cards?.pending_kitchen_tickets || 0)

  // Snapshot cards
  snapshots.value.stockValuation = Number(data?.cards?.inventory_valuation || 0)
  snapshots.value.losses = Number(data?.cards?.inventory_losses_wastage || 0)

  // Tables
  tables.value.bestSellers = (data?.best_sellers || []).map(r => ({
    name: r.dish,
    quantity: Number(r.qty_sold || 0),
    revenue: Number(r.revenue || 0),
  }))

  tables.value.lowStock = (data?.low_stock || []).map(r => ({
    item: r.item,
    available_qty: Number(r.available_qty || 0),
    min_level: Number(r.min_level || 0),
    status: r.status || 'OK'
  }))

  tables.value.transactionsByEmployee = (data?.staff_performance || []).map(s => ({
    user: { id: s.user_id, last_name: s.name },
    transactions: Number(s.orders || 0),
    total_sales: Number(s.sales || 0),
    avg_sec: Number(s.avg_ticket_time_sec || 0),
  }))

  // Charts
  const trendRows = (data?.daily || []).map(d => ({
    day: Number(d.day || 0),
    processed: Number(d.processed || 0),
    refunded: Number(d.voided || 0),
  }))
  await drawSalesTrend(trendRows)

  const donutRows = (data?.donut || []).map(x => ({
    outlet: { name: x.label },
    total: Number(x.value || 0),
  }))
  await drawChannelDonut(donutRows)

  const empRows = (data?.staff_performance || []).map(s => ({
    user: { last_name: s.name },
    total_sales: Number(s.sales || 0),
  }))
  await drawEmployeeBar(empRows)
}

// ------- Charts (ApexCharts) -------
let Apex = null
async function ensureApex() {
  if (!Apex) {
    const mod = await import('apexcharts')
    Apex = mod.default || mod
  }
}
function destroyChart(inst, elSelector) {
  try { if (inst) inst.destroy() } catch {}
  const el = document.querySelector(elSelector)
  if (el) el.innerHTML = ''
}

async function drawChannelDonut(rows) {
  await ensureApex()
  destroyChart(donutChart, '#salesByOutletChart')

  const labels = rows.map(r => r?.outlet?.name || 'Unknown')
  const values = rows.map(r => Number(r?.total || 0))

  donutChart = new Apex(document.querySelector('#salesByOutletChart'), {
    chart: { type: 'donut', height: 280, toolbar: { show: false } },
    series: values,
    labels,
    legend: { position: 'bottom' },
    tooltip: { y: { formatter: (v) => `${currencySymbol.value}${Number(v).toFixed(2)}` } },
    plotOptions: {
      pie: {
        donut: {
          size: '70%',
          labels: {
            show: true,
            total: {
              show: true,
              label: 'Total',
              formatter: () => `${currencySymbol.value}${values.reduce((a,b)=>a+b,0).toFixed(2)}`
            }
          }
        }
      }
    }
  })
  donutChart.render()
}

async function drawEmployeeBar(rows) {
  await ensureApex()
  destroyChart(employeeBarChart, '#employeeChart')

  const labels = rows.map(r => r?.user?.last_name || 'Unknown')
  const values = rows.map(r => Number(r?.total_sales || 0))

  employeeBarChart = new Apex(document.querySelector('#employeeChart'), {
    chart: { type: 'bar', height: 280, toolbar: { show: false } },
    series: [{ name: 'Sales', data: values }],
    xaxis: { categories: labels },
    tooltip: { y: { formatter: (v) => `${currencySymbol.value}${Number(v).toFixed(2)}` } }
  })
  employeeBarChart.render()
}

async function drawSalesTrend(rows) {
  await ensureApex()
  destroyChart(salesTrendChart, '#salesTrendChart')

  const processed = rows.map(d => Number(d.processed || 0))
  const refunded = rows.map(d => Number(d.refunded || 0))

  const y = processed
  const n = y.length || 1
  const x = Array.from({ length: n }, (_, i) => i + 1)
  const sumX = x.reduce((a,b)=>a+b,0)
  const sumY = y.reduce((a,b)=>a+b,0)
  const sumXY = x.reduce((acc,xi,i)=>acc + xi*y[i],0)
  const sumX2 = x.reduce((acc,xi)=>acc + xi*xi,0)
  const denom = (n*sumX2 - sumX*sumX) || 1
  const slope = (n*sumXY - sumX*sumY) / denom
  const intercept = (sumY - slope*sumX) / n
  const trend = rows.map((_, idx) => Math.max(0, Math.round(intercept + slope * (idx+1))))

  salesTrendChart = new Apex(document.querySelector('#salesTrendChart'), {
    chart: { height: 320, stacked: true, toolbar: { show: false } },
    stroke: { width: [0,0,2], curve: 'straight' },
    series: [
      { name: 'Processed', type: 'bar', data: processed },
      { name: 'Refunded/Void', type: 'bar', data: refunded },
      { name: 'Trend', type: 'line', data: trend }
    ],
    fill: { opacity: [1,0.5,1] },
    xaxis: { categories: rows.map(r => String(r.day || '')) },
    yaxis: { labels: { formatter: (v) => `${currencySymbol.value} ${Math.round(v)}` } },
    legend: { position: 'top' },
    tooltip: { shared: true, y: { formatter: (v) => `${currencySymbol.value} ${Math.round(v)}` } }
  })
  salesTrendChart.render()
}

// ------- Lifecycle -------
async function loadAll() {
  loading.value = true
  await Promise.all([
    loadCurrencyMeta(),
    loadOutlets(),
    loadDashboard()
  ])
  loading.value = false
}

onMounted(() => {
  loadAll()
  if (autoRefresh.value) {
    clearTimer()
    refreshTimer = setInterval(loadAll, refreshSeconds.value * 1000)
  }
})

onBeforeUnmount(() => {
  clearTimer()
  destroyChart(donutChart, '#salesByOutletChart')
  destroyChart(employeeBarChart, '#employeeChart')
  destroyChart(salesTrendChart, '#salesTrendChart')
  try { filtersOffcanvas?.hide?.() } catch {}
})

watch(month, (v) => {
  localStorage.setItem('dashboardMonth', v)
  loadAll()
})

watch([outletId, autoRefresh, refreshSeconds], () => {
  localStorage.setItem('dashboardAutoRefresh', JSON.stringify(!!autoRefresh.value))
  localStorage.setItem('dashboardRefreshSec', String(Math.max(5, Number(refreshSeconds.value) || 60)))
  clearTimer()
  if (autoRefresh.value) {
    refreshTimer = setInterval(loadAll, Math.max(5, Number(refreshSeconds.value) || 60) * 1000)
  }
})
</script>

<template>
  <DefaultLayout>
    <div class="dashboard-page container-fluid" style="zoom: 90%;">
      <div class="dashboard-wrap mt-3">
        <div class="glass card shadow-xxl border-0 overflow-hidden">
          <!-- Header / Filters -->
          <div class="card-header bg-light-subtle p-2 p-md-3">
            <div class="d-flex align-items-center justify-content-between gap-2 flex-wrap">
              <div class="d-flex align-items-center gap-2">
                <img src="/src/assets/images/logo.png" alt="logo" class="brand-logo me-1" />
                <div>
                  <h2 class="h5 mb-0">Restaurant Overview</h2>
                  <div class="text-muted small d-none d-sm-block">
                    Performance for {{ month || 'current month' }}
                  </div>
                </div>
              </div>
  
              <!-- Desktop controls -->
              <div class="d-none d-md-flex align-items-center gap-2">
                <div class="d-flex flex-column">
                  <label class="form-label small mb-1">Month</label>
                  <input
                    type="month"
                    v-model="month"
                    class="form-control form-control-sm"
                    style="min-width: 140px"
                  />
                </div>
  
                <div class="d-flex flex-column">
                  <label class="form-label small mb-1">Outlet</label>
                  <select v-model="outletId" class="form-select form-select-sm" style="min-width: 190px">
                    <option :value="null">All Outlets</option>
                    <option v-for="o in outlets" :key="o.id" :value="o.id">
                      {{ o.name }}
                    </option>
                  </select>
                </div>
  
                <div class="vr d-none d-lg-block mx-1" />
  
                <div class="d-flex flex-column flex-lg-row align-items-lg-center gap-2">
                  <div class="form-check form-switch mb-0">
                    <input
                      class="form-check-input"
                      type="checkbox"
                      id="autoRefreshSwitch"
                      v-model="autoRefresh"
                    />
                    <label class="form-check-label small" for="autoRefreshSwitch">
                      Auto-refresh
                    </label>
                  </div>
                  <div class="d-flex align-items-center gap-1">
                    <input
                      v-model.number="refreshSeconds"
                      type="number"
                      min="5"
                      step="5"
                      class="form-control form-control-sm"
                      style="width: 80px"
                    />
                    <span class="text-muted small">sec</span>
                  </div>
                </div>
              </div>
  
              <!-- Mobile controls -->
              <div class="d-flex d-md-none align-items-center gap-2 w-100 justify-content-end">
                <div class="flex-grow-1">
                  <input
                    type="month"
                    v-model="month"
                    class="form-control form-control-sm"
                  />
                </div>
                <button class="btn btn-sm btn-outline-secondary" @click="loadAll">
                  <i class="ri-refresh-line"></i>
                </button>
                <button class="btn btn-sm btn-primary" @click="openFilters">
                  <i class="ri-equalizer-line me-1"></i>
                  Filters
                </button>
              </div>
            </div>
          </div>
  
          <div class="card-body p-2 p-md-3 position-relative">
            <!-- loading overlay -->
            <div
              v-if="loading"
              class="dash-overlay d-flex flex-column align-items-center justify-content-center"
            >
              <div class="spinner-border spinner-border-sm mb-2" role="status"></div>
              <div class="small text-muted">Refreshing metrics…</div>
            </div>
  
            <!-- Row A: KPI cards (restaurant) -->
            <div class="mb-2 mb-md-3">
              <div class="row g-2 g-md-3">
                <Kpi title="SALES COUNT" :value="fmtInt(kpis.salesCount)" icon="ri-file-list-3-line" />
                <Kpi title="GROSS REVENUE" :value="`${currencySymbol}${fmtMoney(kpis.grossRevenue)}`" icon="ri-line-chart-line" />
                <Kpi title="TOTAL DISCOUNTS" :value="`${currencySymbol}${fmtMoney(kpis.totalDiscount)}`" icon="ri-price-tag-3-line" />
                <Kpi title="TAX COLLECTED" :value="`${currencySymbol}${fmtMoney(kpis.taxCollected)}`" icon="ri-bank-line" />
                <Kpi title="SERVICE/TIPS" :value="`${currencySymbol}${fmtMoney(kpis.otherIncome)}`" icon="ri-hand-heart-line" />
                <Kpi title="NET REVENUE" :value="`${currencySymbol}${fmtMoney(kpis.netRevenue)}`" icon="ri-funds-line" />
  
                <Kpi title="FOOD COST (COGS)" :value="`${currencySymbol}${fmtMoney(kpis.cogs)}`" icon="ri-restaurant-2-line" />
                <Kpi title="GROSS PROFIT" :value="`${currencySymbol}${fmtMoney(kpis.grossProfit)}`" icon="ri-bar-chart-2-line" />
                <Kpi title="EXPENSES" :value="`${currencySymbol}${fmtMoney(kpis.operatingExpenses)}`" icon="ri-exchange-dollar-line" />
                <Kpi title="REFUNDS/VOIDS" :value="`${currencySymbol}${fmtMoney(kpis.totalReturn)}`" icon="ri-arrow-go-back-line" />
                <Kpi title="WASTAGE/LOSS" :value="`${currencySymbol}${fmtMoney(kpis.totalLoss)}`" icon="ri-delete-bin-6-line" />
                <Kpi title="NET PROFIT" :value="`${currencySymbol}${fmtMoney(kpis.netProfit)}`" icon="ri-money-cny-box-line" />
  
                <Kpi title="OPEN ORDERS" :value="fmtInt(kpis.openOrders)" icon="ri-timer-line" />
                <Kpi title="TABLES OCCUPIED" :value="fmtInt(kpis.tablesOccupied)" icon="ri-table-line" />
                <Kpi title="AVG TICKET TIME" :value="fmtDuration(kpis.avgTicketTimeSec)" icon="ri-time-line" />
                <Kpi title="CUSTOMERS SERVED" :value="fmtInt(kpis.customersServed)" icon="ri-user-3-line" />
                <Kpi title="OPEN TABS" :value="fmtInt(kpis.openTabs)" icon="ri-bill-line" />
                <Kpi title="PENDING KITCHEN" :value="fmtInt(kpis.pendingKitchen)" icon="ri-fire-line" />
              </div>
            </div>
  
            <!-- Sales Trend -->
            <div class="card soft-card mb-3">
              <div class="card-header d-flex justify-content-between align-items-center">
                <span class="fw-semibold">Sales (Processed vs Voids) & Trend</span>
                <span class="badge bg-light text-muted small d-none d-md-inline-flex">
                  {{ month || 'Current month' }}
                </span>
              </div>
              <div class="card-body pt-2">
                <div id="salesTrendChart" style="height: 320px;"></div>
              </div>
            </div>
  
            <!-- Middle grid -->
            <div class="row g-3 mb-1">
              <!-- Best sellers -->
              <div class="col-lg-3">
                <div class="card soft-card h-100">
                  <div class="card-header fw-semibold py-2 d-flex align-items-center justify-content-between">
                    <span>Best Selling Dishes</span>
                    <i class="ri-star-smile-line text-warning"></i>
                  </div>
                  <div class="card-body p-0">
                    <div class="table-responsive dash-table">
                      <table class="table table-sm table-hover mb-0 align-middle">
                        <thead class="table-light sticky-top">
                          <tr>
                            <th>Dish</th>
                            <th>Qty</th>
                            <th class="text-end">Revenue</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="row in tables.bestSellers" :key="row?.name">
                            <td class="small">{{ row?.name }}</td>
                            <td class="small">{{ row?.quantity }}</td>
                            <td class="text-end small">
                              {{ currencySymbol }}{{ Number(row?.revenue||0).toFixed(2) }}
                            </td>
                          </tr>
                          <tr v-if="!tables.bestSellers.length">
                            <td colspan="3" class="text-center text-muted small py-2">
                              No sales yet
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
  
              <!-- Low stock -->
              <div class="col-lg-3">
                <div class="card soft-card h-100">
                  <div class="card-header fw-semibold py-2 d-flex align-items-center justify-content-between">
                    <span>Low Stock / Out-of-Stock</span>
                    <i class="ri-alert-line text-danger"></i>
                  </div>
                  <div class="card-body p-0">
                    <div class="table-responsive dash-table">
                      <table class="table table-sm table-hover mb-0 align-middle">
                        <thead class="table-light">
                          <tr>
                            <th>Item</th>
                            <th class="text-end">Qty</th>
                            <th class="text-end">Min</th>
                            <th class="text-end">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="row in tables.lowStock" :key="row?.item">
                            <td class="small">{{ row?.item || 'Unknown' }}</td>
                            <td class="text-end small">{{ row?.available_qty }}</td>
                            <td class="text-end small">{{ row?.min_level }}</td>
                            <td class="text-end small">
                              <span class="badge"
                                :class="row.status === 'OUT' ? 'bg-danger' : (row.status === 'LOW' ? 'bg-warning text-dark' : 'bg-success')"
                              >
                                {{ row.status }}
                              </span>
                            </td>
                          </tr>
                          <tr v-if="!tables.lowStock.length">
                            <td colspan="4" class="text-center text-muted small py-2">
                              None
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
  
              <!-- Customer insights -->
              <div class="col-lg-3">
                <div class="card soft-card h-100">
                  <div class="card-header fw-semibold py-2 d-flex align-items-center justify-content-between">
                    <span>Customer Insights</span>
                    <i class="ri-user-star-line text-primary"></i>
                  </div>
                  <div class="card-body small">
                    <p class="mb-2">
                      Customers served:
                      <b>{{ fmtInt(kpis.customersServed || 0) }}</b>
                    </p>
                    <div class="dash-mini-title text-muted mb-1">Note</div>
                    <ul class="mb-0 ps-3">
                      <li class="text-muted">Top customers list not yet in API</li>
                    </ul>
                  </div>
                </div>
              </div>
  
              <!-- Donut (Sales by channel) -->
              <div class="col-lg-3">
                <div class="card soft-card h-100">
                  <div class="card-header fw-semibold py-2 d-flex align-items-center justify-content-between">
                    <span>Sales by Channel</span>
                    <i class="ri-pie-chart-2-line text-success"></i>
                  </div>
                  <div class="card-body">
                    <div id="salesByOutletChart" style="height: 280px;"></div>
                  </div>
                </div>
              </div>
            </div>
  
            <!-- Bottom row -->
            <div class="row g-3">
              <!-- Employee performance -->
              <div class="col-xl-6">
                <div class="card soft-card h-100">
                  <div class="card-header fw-semibold py-2">
                    Staff Performance
                  </div>
                  <div class="card-body">
                    <div class="row g-3">
                      <div class="col-lg-7">
                        <div id="employeeChart" style="height: 280px;"></div>
                      </div>
                      <div class="col-lg-5 border-start small">
                        <div class="mb-3">
                          <h6 class="fw-semibold mb-1">Orders by Staff</h6>
                          <ul class="mb-0 ps-3">
                            <li
                              v-for="t in tables.transactionsByEmployee"
                              :key="t?.user?.id"
                              class="mb-1"
                            >
                              {{ t?.user?.last_name || 'Unknown' }}:
                              {{ t?.transactions }} orders
                              <span class="text-muted">
                                • Avg {{ fmtDuration(t?.avg_sec) }}
                              </span>
                            </li>
                            <li v-if="!tables.transactionsByEmployee.length" class="text-muted">
                              None
                            </li>
                          </ul>
                        </div>
  
                        <div>
                          <h6 class="fw-semibold mb-1">Payment Breakdown</h6>
                          <ul class="mb-0 ps-3">
                            <li v-if="!tables.paymentMethods.length" class="text-muted">
                              Not available yet (add to backend later)
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
  
              <!-- Inventory + Ops snapshot cards -->
              <div class="col-xl-2">
                <div class="card soft-card mb-3">
                  <div class="card-body">
                    <div class="text-muted small mb-1">Inventory Valuation</div>
                    <div class="h4 mb-0">
                      {{ currencySymbol }} {{ fmtMoney(snapshots.stockValuation) }}
                    </div>
                  </div>
                </div>
  
                <div class="card soft-card mb-3">
                  <div class="card-body">
                    <div class="text-muted small mb-1">Inventory Losses / Wastage</div>
                    <div class="h4 mb-0 text-danger">
                      {{ currencySymbol }} {{ fmtMoney(snapshots.losses) }}
                    </div>
                  </div>
                </div>
  
                <div class="card soft-card mb-3">
                  <div class="card-body">
                    <div class="text-muted small mb-1">Open Tabs</div>
                    <div class="h4 mb-0">
                      {{ fmtInt(kpis.openTabs) }}
                    </div>
                  </div>
                </div>
  
                <div class="card soft-card">
                  <div class="card-body">
                    <div class="text-muted small mb-1">Pending Kitchen Tickets</div>
                    <div class="h4 mb-0">
                      {{ fmtInt(kpis.pendingKitchen) }}
                    </div>
                  </div>
                </div>
              </div>
  
              <!-- Placeholder card (you can replace with fast/slow moving menu items later) -->
              <div class="col-xl-4">
                <div class="card soft-card h-100">
                  <div class="card-body small">
                    <h6 class="fw-semibold mb-1">Notes</h6>
                    <ul class="mb-0 ps-3">
                      <li class="mb-1">Fast/slow moving dishes can be added when backend provides it.</li>
                      <li class="mb-1">Open Tabs currently counts OPEN DINE_IN orders.</li>
                      <li>Pending Kitchen counts KDS lines not DONE.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div> <!-- /bottom row -->
          </div> <!-- /card-body -->
        </div> <!-- /glass card -->
      </div>
  
      <!-- Mobile Filters Offcanvas -->
      <div
        class="offcanvas offcanvas-bottom"
        tabindex="-1"
        id="dashboardFiltersOffcanvas"
        aria-labelledby="dashboardFiltersOffcanvasLabel"
        style="zoom: 90%;"
      >
        <div class="offcanvas-header">
          <h6 id="dashboardFiltersOffcanvasLabel" class="mb-0">
            Dashboard Filters
          </h6>
          <button
            type="button"
            class="btn-close text-reset"
            data-bs-dismiss="offcanvas"
            aria-label="Close"
          ></button>
        </div>
        <div class="offcanvas-body small">
          <div class="row g-2">
            <div class="col-12">
              <label class="form-label small mb-1">Month</label>
              <input
                type="month"
                v-model="month"
                class="form-control form-control-sm"
              />
            </div>
            <div class="col-12">
              <label class="form-label small mb-1">Outlet</label>
              <select v-model="outletId" class="form-select form-select-sm">
                <option :value="null">All Outlets</option>
                <option v-for="o in outlets" :key="'m-o-'+o.id" :value="o.id">
                  {{ o.name }}
                </option>
              </select>
            </div>
            <div class="col-12">
              <div class="form-check form-switch">
                <input
                  class="form-check-input"
                  type="checkbox"
                  id="autoRefreshSwitchMobile"
                  v-model="autoRefresh"
                />
                <label class="form-check-label" for="autoRefreshSwitchMobile">
                  Auto-refresh
                </label>
              </div>
            </div>
            <div class="col-6">
              <label class="form-label small mb-1">Refresh every (sec)</label>
              <input
                v-model.number="refreshSeconds"
                type="number"
                min="5"
                step="5"
                class="form-control form-control-sm"
              />
            </div>
          </div>
          <div class="d-flex justify-content-end gap-2 mt-3">
            <button class="btn btn-light btn-sm" data-bs-dismiss="offcanvas">
              Close
            </button>
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
:root {
  --glass-bg: rgba(255, 255, 255, 0.75);
  --glass-border: rgba(255, 255, 255, 0.5);
  --table-header-bg: #eef2f7;
}

@media (prefers-color-scheme: dark) {
  :root {
    --glass-bg: rgba(20, 22, 27, 0.7);
    --glass-border: rgba(255, 255, 255, 0.08);
    --table-header-bg: #424b57;
  }
}

.dashboard-wrap {
  margin-top: 0.5rem;
}

.glass{
  background: var(--glass-bg);
  backdrop-filter: saturate(140%) blur(14px);
  border: 1px solid var(--glass-border);
  border-radius: 1.25rem;
}

.shadow-xxl {
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22);
}

.brand-logo {
  height: 28px;
  width: auto;
}

/* KPI cards */
.kpi-card {
  border: 0;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(255,255,255,0.9), rgba(244,247,252,0.9));
}

@media (prefers-color-scheme: dark) {
  .kpi-card {
    background: linear-gradient(135deg, rgba(32,36,44,0.9), rgba(18,20,27,0.9));
  }
}

.kpi-label {
  letter-spacing: 0.03em;
  font-size: 0.68rem;
}

.kpi-value {
  font-weight: 600;
}

.kpi-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: rgba(13, 110, 253, 0.08);
}

.widget-icon1 {
  opacity: 0.85;
}

/* tables in cards */
.dash-table {
  max-height: 260px;
}

.dash-table .table {
  margin-bottom: 0;
  font-size: 0.78rem;
}

.dash-table::-webkit-scrollbar {
  width: 6px;
}
.dash-table::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 999px;
}

/* sticky table header */
.table thead.sticky-top th {
  top: 0;
  z-index: 1;
  background-color: var(--table-header-bg) !important;
}

/* bottom split */
.border-start-md {
  border-left: 1px solid rgba(0,0,0,0.06);
}

@media (max-width: 767.98px) {
  .border-start-md {
    border-left: 0;
    border-top: 1px solid rgba(0,0,0,0.06);
    margin-top: 0.75rem;
    padding-top: 0.75rem;
  }
  .brand-logo {
    height: 24px;
  }
}

/* small helper */
.dash-mini-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* loading overlay */
.dash-overlay{
  position:absolute;
  inset:0;
  background: rgba(255,255,255,0.65);
  backdrop-filter: blur(6px);
  z-index: 10;
}
@media (prefers-color-scheme: dark) {
  .dash-overlay{
    background: rgba(0,0,0,0.35);
  }
}
</style>
