<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useToast } from "vue-toastification";

import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { StatusBadge, EmptyState, LoadingState } from "../../components/ui";
import { listKdsTickets, setLineStatus, readyAllForOrder, bumpOrder, listKdsEvents } from "../../api/kds";
import { listOutlets } from "../../api/lookups";
import { subscribe as pusherSubscribe, isPusherConfigured } from "../../api/pusher";
import { useAuthStore } from "../../stores/auth";

const toast = useToast();
const auth = useAuthStore();

// ---------- state ----------
const loading = ref(true);
const refreshing = ref(false);
const board = ref({ tickets: [], counts: { new: 0, in_progress: 0, ready: 0, total: 0 } });
const outlets = ref([]);

const filters = ref({
  outlet_id: "",
  include_ready: true,
  station: "",  // "" = all stations, "unassigned" = items without a station
});

// Persist preferred station per browser/device (good for wall-mounted screens)
const STATION_LS_KEY = "kdsPreferredStation";
try {
  const saved = localStorage.getItem(STATION_LS_KEY);
  if (saved !== null) filters.value.station = saved;
} catch {}

const fullscreen = ref(false);
const refreshTimer = ref(null);
const tickTimer = ref(null);
const tickNow = ref(Date.now());
const lastFetchedAt = ref(null);

// pusher subscription (real-time events) — when configured, polling becomes a safety net
const pusherActive = ref(false);
const pusherUnsub = ref(null);

// Adaptive poll cadence: fast (8s) without push, slow (30s) safety-net when push is live
const REFRESH_MS_FAST = 8000;
const REFRESH_MS_SLOW = 30000;
const TICK_MS = 1000;

// ---------- sound (J) ----------
// Persist mute toggle per browser. Defaults to UNMUTED so kitchen staff
// don't miss tickets the first time they open the screen.
const SOUND_LS_KEY = "kdsSoundMuted";
const muted = ref(false);
try {
  muted.value = localStorage.getItem(SOUND_LS_KEY) === "1";
} catch {}

let _audioCtx = null;
let _audioBlocked = false;
const seenOrderIds = new Set();   // for polling-based new-ticket detection
let initialBoardLoaded = false;   // suppress beeps on first load

function _ensureAudio() {
  if (_audioCtx || _audioBlocked) return _audioCtx;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { _audioBlocked = true; return null; }
    _audioCtx = new Ctor();
    return _audioCtx;
  } catch {
    _audioBlocked = true;
    return null;
  }
}

function _beep({ freq = 880, durationMs = 180, volume = 0.25 } = {}) {
  if (muted.value) return;
  const ctx = _ensureAudio();
  if (!ctx) return;
  // Browser may suspend the context until user interaction
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain).connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationMs / 1000);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000 + 0.05);
  } catch {}
}

function newTicketChime() {
  // Two-tone "ding-DONG" — distinct from a generic notification
  _beep({ freq: 880, durationMs: 130, volume: 0.25 });
  setTimeout(() => _beep({ freq: 1320, durationMs: 200, volume: 0.25 }), 130);
}

function toggleMute() {
  muted.value = !muted.value;
  try { localStorage.setItem(SOUND_LS_KEY, muted.value ? "1" : "0"); } catch {}
  if (!muted.value) {
    // Unmuting is a user gesture — perfect chance to seed the AudioContext
    // and verify with a short test beep so kitchen staff hear that it works.
    _ensureAudio();
    _beep({ freq: 660, durationMs: 80, volume: 0.18 });
  }
}

// ---------- helpers ----------
function fmtMinutes(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 1) return `${r}s`;
  return `${m}m${r ? ` ${r}s` : ""}`;
}

function ageColor(seconds) {
  const m = (Number(seconds) || 0) / 60;
  if (m >= 15) return "ticket-age-red";
  if (m >= 8) return "ticket-age-amber";
  return "ticket-age-green";
}

function statusTone(s) {
  switch (s) {
    case "NEW": return "info";
    case "IN_PROGRESS": return "warning";
    case "READY": return "success";
    case "BUMPED": return "default";
    default: return "default";
  }
}

function statusLabel(s) {
  switch (s) {
    case "NEW": return "New";
    case "IN_PROGRESS": return "Cooking";
    case "READY": return "Ready";
    case "BUMPED": return "Done";
    default: return s || "—";
  }
}

function shortQty(v) {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// Live age in seconds: server age + (clientNow - lastFetched)
function liveAge(t) {
  if (!t) return 0;
  const driftMs = lastFetchedAt.value ? (tickNow.value - lastFetchedAt.value) : 0;
  return Math.max(0, Number(t.age_seconds || 0) + Math.floor(driftMs / 1000));
}

// ---------- load ----------
async function loadOutlets() {
  try { outlets.value = (await listOutlets()) || []; }
  catch { outlets.value = []; }
}

async function fetchTickets(showSpinner = false) {
  if (showSpinner) loading.value = true;
  else refreshing.value = true;
  try {
    const params = { include_ready: filters.value.include_ready };
    if (filters.value.outlet_id) params.outlet_id = filters.value.outlet_id;
    if (filters.value.station) params.station = filters.value.station;
    const data = await listKdsTickets(params);
    board.value = data || { tickets: [], counts: { new: 0, in_progress: 0, ready: 0, total: 0 }, stations: [] };
    lastFetchedAt.value = Date.now();

    // Detect new tickets that appeared since the last fetch (polling fallback path).
    // We don't beep on the very first load (initialBoardLoaded), only on subsequent ones.
    if (initialBoardLoaded) {
      let appeared = 0;
      for (const t of (board.value.tickets || [])) {
        if (!seenOrderIds.has(t.order_id)) appeared++;
      }
      if (appeared > 0) newTicketChime();
    }
    // Refresh the seen set
    seenOrderIds.clear();
    for (const t of (board.value.tickets || [])) seenOrderIds.add(t.order_id);
    initialBoardLoaded = true;
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load KDS");
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function persistStation(v) {
  try { localStorage.setItem(STATION_LS_KEY, v ?? ""); } catch {}
  filters.value.station = v ?? "";
  fetchTickets(false);
}

// ---------- actions ----------
async function startCooking(line) {
  try {
    await setLineStatus(line.id, "IN_PROGRESS");
    line.kds_status = "IN_PROGRESS";
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update");
  }
}

async function markReady(line) {
  try {
    await setLineStatus(line.id, "READY");
    line.kds_status = "READY";
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update");
  }
}

async function reopenLine(line) {
  try {
    await setLineStatus(line.id, "NEW");
    line.kds_status = "NEW";
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to update");
  }
}

async function readyAll(ticket) {
  try {
    await readyAllForOrder(ticket.order_id);
    for (const ln of ticket.lines) {
      if (ln.kds_status === "NEW" || ln.kds_status === "IN_PROGRESS") ln.kds_status = "READY";
    }
    toast.success("All marked ready");
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed");
  }
}

// ---------- activity drawer (global event feed across all orders) ----------
// Persistent recent-events panel. Opens via the header button; once open it
// auto-refreshes whenever any KDS Pusher event lands (the same handlers that
// drive the live board). Polling fallback: it also re-fetches whenever the
// board does, so it stays current even if push is degraded.
const activityOpen = ref(false);
const activityEvents = ref([]);
const activityLoading = ref(false);
const ACTIVITY_LIMIT = 100;

async function refreshActivity() {
  activityLoading.value = true;
  try {
    activityEvents.value = (await listKdsEvents({ limit: ACTIVITY_LIMIT })) || [];
  } catch (e) {
    // Silent — don't toast every poll cycle. The empty state will explain.
    activityEvents.value = [];
  } finally {
    activityLoading.value = false;
  }
}

function openActivity() {
  activityOpen.value = true;
  refreshActivity();
}

function closeActivity() {
  activityOpen.value = false;
}

// Cheap helper for live updates: only re-fetch when the drawer is actually
// visible. Prevents wasted requests when the cook closed the panel.
function refreshActivityIfOpen() {
  if (activityOpen.value) refreshActivity();
}

// ---------- per-ticket timeline drawer ----------
const timelineOrder = ref(null); // the ticket whose timeline is open
const timelineEvents = ref([]);
const timelineLoading = ref(false);

async function openTimeline(ticket) {
  timelineOrder.value = ticket;
  timelineLoading.value = true;
  timelineEvents.value = [];
  try {
    const rows = await listKdsEvents({ order_id: ticket.order_id, limit: 500 });
    // API returns newest-first; reverse so the timeline reads top-down chronologically.
    timelineEvents.value = (rows || []).slice().reverse();
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load timeline");
  } finally {
    timelineLoading.value = false;
  }
}

function closeTimeline() {
  timelineOrder.value = null;
  timelineEvents.value = [];
}

function eventLabel(t) {
  switch (t) {
    case "order.created":        return "Order created";
    case "order.line-added":     return "Line added";
    case "kds.line-sent":        return "Sent to kitchen";
    case "kds.line-started":     return "Started cooking";
    case "kds.line-ready":       return "Marked ready";
    case "kds.line-reopened":    return "Re-opened";
    case "kds.line-bumped":      return "Line bumped";
    case "kds.order-bumped":     return "Ticket bumped";
    case "kds.order-ready-all":  return "All marked ready";
    default: return t || "—";
  }
}

function eventTone(t) {
  if (t === "order.created" || t === "kds.line-sent") return "info";
  if (t === "kds.line-started")                       return "warning";
  if (t === "kds.line-ready" || t === "kds.order-ready-all") return "success";
  if (t === "kds.line-reopened")                      return "warning";
  if (t === "kds.line-bumped" || t === "kds.order-bumped") return "default";
  return "default";
}

function fmtAbs(s) {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ---------- bump confirm modal ----------
// Bumping is destructive (the ticket disappears off the board), so we ask
// once before firing. Uses the project-standard Bootstrap modal pattern
// instead of the native confirm() so the kitchen UI stays themed.
const bumpTarget = ref(null);
const bumpBusy = ref(false);

function bump(ticket) {
  bumpTarget.value = ticket;
  showBootstrapModal("kdsBumpModal");
}

function cancelBump() {
  bumpTarget.value = null;
  hideBootstrapModal("kdsBumpModal");
}

async function confirmBump() {
  const ticket = bumpTarget.value;
  if (!ticket) return;
  bumpBusy.value = true;
  try {
    await bumpOrder(ticket.order_id);
    board.value.tickets = board.value.tickets.filter((t) => t.order_id !== ticket.order_id);
    toast.success(`${ticket.order_no} bumped`);
    hideBootstrapModal("kdsBumpModal");
    bumpTarget.value = null;
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to bump");
  } finally {
    bumpBusy.value = false;
  }
}

// ---------- bootstrap modal helpers (mirror MenuManager) ----------
function showBootstrapModal(id) {
  const el = document.getElementById(id);
  if (el && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(el).show();
}
function hideBootstrapModal(id) {
  const el = document.getElementById(id);
  if (el && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(el).hide();
}

// ---------- fullscreen toggle ----------
function toggleFullscreen() {
  fullscreen.value = !fullscreen.value;
  if (fullscreen.value && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else if (!fullscreen.value && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

// ---------- realtime (Pusher) ----------
function onLineStatusEvent(payload) {
  // payload: { order_id, line_id, status, outlet_id }
  refreshActivityIfOpen();
  if (filters.value.outlet_id && Number(payload.outlet_id) !== Number(filters.value.outlet_id)) return;
  // Station filter: if active, the line might not be on the board (different station). Skip silently.
  for (const t of board.value.tickets) {
    if (t.order_id !== payload.order_id) continue;
    let touched = false;
    for (const ln of t.lines) {
      if (ln.id === payload.line_id) {
        ln.kds_status = payload.status;
        touched = true;
      }
    }
    if (!touched) return; // line not in our station-filtered view
    t.pending_count = t.lines.filter((l) => l.kds_status === "NEW" || l.kds_status === "IN_PROGRESS").length;
    t.ready_count = t.lines.filter((l) => l.kds_status === "READY").length;
    return;
  }
  // Order not on board — only re-fetch if no station filter (else likely intended for another station)
  if (!filters.value.station) fetchTickets(false);
}

function onOrderBumped(payload) {
  refreshActivityIfOpen();
  // remove the ticket entirely
  if (!payload?.order_id) return;
  board.value.tickets = board.value.tickets.filter((t) => t.order_id !== payload.order_id);
}

function onOrderReadyAll(payload) {
  refreshActivityIfOpen();
  for (const t of board.value.tickets) {
    if (t.order_id !== payload.order_id) continue;
    for (const ln of t.lines) {
      if (ln.kds_status === "NEW" || ln.kds_status === "IN_PROGRESS") {
        ln.kds_status = "READY";
      }
    }
    t.pending_count = 0;
    t.ready_count = t.lines.length;
  }
}

function onLinesSent(payload) {
  refreshActivityIfOpen();
  // Cheapest correct path: re-fetch (the ticket may not be on the board yet, or
  // an existing one may need new lines spliced in). The push tells us *when*.
  if (filters.value.outlet_id && Number(payload.outlet_id) !== Number(filters.value.outlet_id)) return;
  // Fire chime immediately on push (don't wait for the refetch round-trip).
  // The polling path also detects new tickets, but push is faster — this gives
  // the kitchen instant audible feedback.
  if (!seenOrderIds.has(Number(payload.order_id))) {
    newTicketChime();
  }
  fetchTickets(false);
}

function startRealtime() {
  const storeId = auth.me?.store_id;
  if (!storeId || !isPusherConfigured()) {
    pusherActive.value = false;
    return;
  }
  const channel = `store-${storeId}-kds`;
  pusherUnsub.value = pusherSubscribe(channel, {
    "kds.lines-sent": onLinesSent,
    "kds.line-status": onLineStatusEvent,
    "kds.order-bumped": onOrderBumped,
    "kds.order-ready-all": onOrderReadyAll,
  });
  pusherActive.value = !!pusherUnsub.value;
}

function stopRealtime() {
  if (pusherUnsub.value) {
    try { pusherUnsub.value(); } catch {}
    pusherUnsub.value = null;
  }
  pusherActive.value = false;
}

// ---------- lifecycle ----------
onMounted(async () => {
  await loadOutlets();
  // Auth.me may not be loaded yet on a hard reload of /kds — ensure it
  if (!auth.me && auth.isAuthed) {
    try { await auth.fetchMe(); } catch {}
  }
  await fetchTickets(true);

  startRealtime();

  // Polling acts as the safety net: fast cadence when push isn't live,
  // slow cadence when it is.
  const cadence = pusherActive.value ? REFRESH_MS_SLOW : REFRESH_MS_FAST;
  refreshTimer.value = setInterval(() => {
    fetchTickets(false);
    refreshActivityIfOpen();
  }, cadence);
  tickTimer.value = setInterval(() => { tickNow.value = Date.now(); }, TICK_MS);
});

onBeforeUnmount(() => {
  stopRealtime();
  if (refreshTimer.value) clearInterval(refreshTimer.value);
  if (tickTimer.value) clearInterval(tickTimer.value);
});
</script>

<template>
  <DefaultLayout>
    <div class="kds-shell" :class="{ 'kds-fullscreen': fullscreen }">
      <!-- header -->
      <div class="kds-header">
        <div class="d-flex align-items-center gap-3 flex-wrap">
          <h4 class="mb-0 text-white">
            <i class="ri-restaurant-fill me-2 text-warning"></i>
            Kitchen Display
          </h4>
          <div class="kds-counts">
            <span class="kds-count-pill kds-new">{{ board.counts.new }} new</span>
            <span class="kds-count-pill kds-in-progress">{{ board.counts.in_progress }} cooking</span>
            <span class="kds-count-pill kds-ready">{{ board.counts.ready }} ready</span>
          </div>
        </div>

        <div class="d-flex align-items-center gap-2 flex-wrap pt-2">
          <div class="row">
            <div class="col-6">
              <select v-model="filters.outlet_id" class="form-select form-select-sm" style="min-width: 160px" @change="fetchTickets(true)">
                <option value="">All outlets</option>
                <option v-for="o in outlets" :key="o.id" :value="o.id">{{ o.code }} — {{ o.name }}</option>
              </select>
            </div>
            <div class="col-6">
              <select
                :value="filters.station"
                class="form-select form-select-sm kds-station-select"
                style="min-width: 150px"
                @change="(e) => persistStation(e.target.value)"
              >
                <option value="">All stations</option>
                <option v-for="s in (board.stations || [])" :key="s" :value="s">{{ s }}</option>
                <option value="unassigned">— Unassigned —</option>
              </select>
            </div>
          </div>
          
          <div class="form-check form-switch text-white">
            <input v-model="filters.include_ready" @change="fetchTickets(true)" class="form-check-input" type="checkbox" id="kdsIncludeReady" />
            <label class="form-check-label small" for="kdsIncludeReady">Show Ready</label>
          </div>
          <span v-if="pusherActive" class="kds-live-pill" title="Real-time updates active">
            <span class="kds-live-dot"></span> LIVE
          </span>
          <button
            class="btn btn-sm btn-outline-light"
            :class="{ 'kds-active-tool': activityOpen }"
            @click="activityOpen ? closeActivity() : openActivity()"
            title="Show kitchen activity log"
          >
            <i class="ri-history-line"></i>
            <span class="d-none d-md-inline ms-1">Activity</span>
          </button>
          <button
            class="btn btn-sm btn-outline-light"
            @click="toggleMute"
            :title="muted ? 'Unmute new-ticket sound' : 'Mute new-ticket sound'"
          >
            <i :class="muted ? 'ri-volume-mute-line' : 'ri-volume-up-line'"></i>
          </button>
          <button class="btn btn-sm btn-outline-light" @click="fetchTickets(true)" :disabled="refreshing || loading">
            <i class="ri-refresh-line" :class="{ rotating: refreshing }"></i>
          </button>
          <button class="btn btn-sm btn-outline-light" @click="toggleFullscreen" :title="fullscreen ? 'Exit fullscreen' : 'Fullscreen'">
            <i :class="fullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'"></i>
          </button>
        </div>
      </div>

      <!-- body -->
      <div class="kds-body">
        <LoadingState v-if="loading" label="Loading tickets…" />
        <EmptyState
          v-else-if="!board.tickets.length"
          icon="ri-checkbox-circle-line"
          title="All caught up!"
          message="No active kitchen tickets right now."
        />
        <div v-else class="kds-grid">
          <div
            v-for="t in board.tickets"
            :key="t.order_id"
            class="kds-ticket"
            :class="ageColor(liveAge(t))"
          >
            <div class="ticket-head">
              <div>
                <div class="ticket-order-no">
                  {{ t.order_no }}
                  <!-- PAID = customer already settled. Cooks should treat
                       these as "customer waiting at counter, prioritise". -->
                  <span v-if="t.is_paid" class="kds-paid-pill" title="Customer has already paid">
                    <i class="ri-check-line"></i> PAID
                  </span>
                </div>
                <div class="ticket-meta">
                  <span class="badge bg-secondary me-1">{{ t.order_type }}</span>
                  <span v-if="t.table_no" class="badge bg-info me-1">T {{ t.table_no }}</span>
                  <span v-if="t.customer_name" class="text-muted small">{{ t.customer_name }}</span>
                </div>
                <div v-if="t.outlet_name && !filters.outlet_id" class="text-muted small mt-1">
                  <i class="ri-store-2-line"></i> {{ t.outlet_name }}
                </div>
              </div>
              <div class="ticket-age">
                <i class="ri-time-line"></i>
                {{ fmtMinutes(liveAge(t)) }}
              </div>
            </div>

            <div v-if="t.note" class="ticket-note">
              <i class="ri-sticky-note-line"></i> {{ t.note }}
            </div>

            <div class="ticket-lines">
              <div
                v-for="line in t.lines"
                :key="line.id"
                class="kds-line"
                :class="`status-${(line.kds_status || 'NEW').toLowerCase()}`"
              >
                <div class="kds-line-row">
                  <div class="kds-line-qty">{{ shortQty(line.qty) }}×</div>
                  <div class="kds-line-name">
                    <div class="fw-bold">{{ line.item_name }}</div>
                    <div class="d-flex flex-wrap gap-1 mt-1">
                      <span v-if="line.station" class="kds-station-chip">
                        <i class="ri-map-pin-line"></i> {{ line.station }}
                      </span>
                    </div>
                    <div v-if="line.modifiers?.length" class="kds-line-mods">
                      <span v-for="m in line.modifiers" :key="m.id" class="kds-mod">
                        + {{ m.name }}
                      </span>
                    </div>
                    <div v-if="line.note" class="kds-line-note">
                      <i class="ri-sticky-note-line"></i> {{ line.note }}
                    </div>
                  </div>
                  <StatusBadge :tone="statusTone(line.kds_status)">
                    {{ statusLabel(line.kds_status) }}
                  </StatusBadge>
                </div>

                <div class="kds-line-actions">
                  <button v-if="line.kds_status === 'NEW'" class="btn btn-sm btn-warning" @click="startCooking(line)">
                    <i class="ri-fire-line"></i> Start
                  </button>
                  <button v-if="line.kds_status === 'IN_PROGRESS'" class="btn btn-sm btn-success" @click="markReady(line)">
                    <i class="ri-checkbox-circle-line"></i> Ready
                  </button>
                  <button v-if="line.kds_status === 'READY'" class="btn btn-sm btn-outline-secondary" @click="reopenLine(line)">
                    <i class="ri-arrow-go-back-line"></i> Re-open
                  </button>
                </div>
              </div>
            </div>

            <div class="ticket-foot">
              <button
                class="btn btn-sm btn-outline-light"
                @click="openTimeline(t)"
                title="Show full event history"
              >
                <i class="ri-history-line"></i>
              </button>
              <button
                v-if="t.pending_count > 0"
                class="btn btn-sm btn-light flex-grow-1"
                @click="readyAll(t)"
              >
                <i class="ri-check-double-line"></i> All Ready
              </button>
              <button class="btn btn-sm btn-dark flex-grow-1" @click="bump(t)">
                <i class="ri-arrow-right-circle-line"></i> Bump
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Timeline drawer (teleported so it overlays correctly in fullscreen) -->
      <Teleport to="body">
      <transition name="fade">
        <div
          v-if="timelineOrder"
          class="kds-drawer-backdrop"
          @click.self="closeTimeline"
        >
          <div class="kds-drawer">
            <div class="kds-drawer-head">
              <div>
                <div class="kds-drawer-title">Timeline · {{ timelineOrder.order_no }}</div>
                <div class="kds-drawer-sub">
                  {{ timelineOrder.order_type }}
                  <span v-if="timelineOrder.table_no"> · Table {{ timelineOrder.table_no }}</span>
                </div>
              </div>
              <button class="btn btn-sm btn-outline-light" @click="closeTimeline">
                <i class="ri-close-line"></i>
              </button>
            </div>

            <div class="kds-drawer-body">
              <LoadingState v-if="timelineLoading" label="Loading timeline…" />
              <EmptyState
                v-else-if="!timelineEvents.length"
                icon="ri-history-line"
                title="No events"
                message="This order has no recorded events."
              />
              <ol v-else class="tl-list">
                <li v-for="e in timelineEvents" :key="e.id" class="tl-item">
                  <span class="tl-dot" :class="`tl-tone-${eventTone(e.event_type)}`"></span>
                  <div class="tl-body">
                    <div class="tl-row">
                      <span class="tl-label">{{ eventLabel(e.event_type) }}</span>
                      <span class="tl-time">{{ fmtAbs(e.occurred_at) }}</span>
                    </div>
                    <div class="tl-meta small">
                      <span v-if="e.user_name" class="tl-user">
                        <i class="ri-user-line"></i> {{ e.user_name }}
                      </span>
                      <span v-if="e.meta?.item_name" class="tl-item-name">
                        · {{ e.meta.item_name }}
                        <span v-if="e.meta.qty"> ({{ e.meta.qty }})</span>
                      </span>
                      <span v-if="e.from_status && e.to_status" class="tl-transition">
                        · {{ e.from_status || '—' }} → {{ e.to_status }}
                      </span>
                    </div>
                  </div>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </transition>
      </Teleport>

      <!-- Activity drawer (global event feed) -->
      <Teleport to="body">
      <transition name="fade">
        <div
          v-if="activityOpen"
          class="kds-drawer-backdrop"
          @click.self="closeActivity"
        >
          <div class="kds-drawer">
            <div class="kds-drawer-head">
              <div>
                <div class="kds-drawer-title">
                  <i class="ri-history-line me-1"></i> Kitchen Activity
                </div>
                <div class="kds-drawer-sub">
                  Last {{ ACTIVITY_LIMIT }} events across the kitchen — live
                </div>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-sm btn-outline-light" @click="refreshActivity" :disabled="activityLoading" title="Refresh">
                  <i class="ri-refresh-line" :class="{ rotating: activityLoading }"></i>
                </button>
                <button class="btn btn-sm btn-outline-light" @click="closeActivity">
                  <i class="ri-close-line"></i>
                </button>
              </div>
            </div>

            <div class="kds-drawer-body">
              <LoadingState v-if="activityLoading && !activityEvents.length" label="Loading activity…" />
              <EmptyState
                v-else-if="!activityEvents.length"
                icon="ri-history-line"
                title="No activity yet"
                message="Events will appear here as orders move through the kitchen."
              />
              <ol v-else class="tl-list">
                <li v-for="e in activityEvents" :key="e.id" class="tl-item">
                  <span class="tl-dot" :class="`tl-tone-${eventTone(e.event_type)}`"></span>
                  <div class="tl-body">
                    <div class="tl-row">
                      <span class="tl-label">{{ eventLabel(e.event_type) }}</span>
                      <span class="tl-time">{{ fmtAbs(e.occurred_at) }}</span>
                    </div>
                    <div class="tl-meta small">
                      <span v-if="e.order_no" class="tl-order">
                        <i class="ri-bill-line"></i> {{ e.order_no }}
                      </span>
                      <span v-if="e.meta?.item_name" class="tl-item-name">
                        · {{ e.meta.item_name }}
                        <span v-if="e.meta.qty"> ({{ e.meta.qty }})</span>
                      </span>
                      <span v-if="e.user_name" class="tl-user">
                        · <i class="ri-user-line"></i> {{ e.user_name }}
                      </span>
                      <span v-if="e.from_status && e.to_status" class="tl-transition">
                        · {{ e.from_status || '—' }} → {{ e.to_status }}
                      </span>
                    </div>
                  </div>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </transition>
      </Teleport>

      <!-- Bump confirmation modal (replaces native confirm()).
           Teleported to <body> so Bootstrap's z-index/backdrop machinery
           isn't trapped inside the fullscreen kitchen container (z-index 2000).
           Without this, fullscreen mode shows a frozen overlay because the
           modal is hidden behind the kitchen shell. -->
      <Teleport to="body">
        <div class="modal fade" id="kdsBumpModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content kds-modal">
              <div class="modal-header">
                <h5 class="modal-title">
                  <i class="ri-arrow-right-circle-line me-2 text-warning"></i>
                  Bump ticket?
                </h5>
                <button type="button" class="btn-close btn-close-white" @click="cancelBump" :disabled="bumpBusy"></button>
              </div>
              <div class="modal-body">
                <p class="mb-2" v-if="bumpTarget">
                  <strong>{{ bumpTarget.order_no }}</strong> will leave the board.
                  <span v-if="bumpTarget.pending_count > 0" class="text-warning d-block mt-2">
                    <i class="ri-alert-line me-1"></i>
                    This ticket has <strong>{{ bumpTarget.pending_count }}</strong>
                    line{{ bumpTarget.pending_count === 1 ? '' : 's' }} not yet ready —
                    bumping will mark them done without serving.
                  </span>
                </p>
              </div>
              <div class="modal-footer">
                <button class="btn btn-light" @click="cancelBump" :disabled="bumpBusy">Cancel</button>
                <button class="btn btn-dark" @click="confirmBump" :disabled="bumpBusy">
                  <span v-if="bumpBusy" class="spinner-border spinner-border-sm me-1"></span>
                  <i v-else class="ri-arrow-right-circle-line me-1"></i>
                  Bump
                </button>
              </div>
            </div>
          </div>
        </div>
      </Teleport>
    </div>
  </DefaultLayout>
</template>

<style scoped>
/* Kitchen displays stay dark regardless of app theme — high contrast for
   readability under bright kitchen lighting, no glare for cooks. */
.kds-shell {
  background:
    radial-gradient(900px 500px at 0% 0%, rgba(99, 102, 241, 0.08), transparent 60%),
    radial-gradient(700px 400px at 100% 100%, rgba(236, 72, 153, 0.06), transparent 60%),
    #0b1220;
  margin: -1rem -12px 0;
  min-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  color: #e2e8f0;
  font-family: "Inter", "Plus Jakarta Sans", system-ui, sans-serif;
}
/* In fullscreen mode the KDS becomes a fixed overlay covering the entire
   viewport — the sidebar, topbar and footer all sit underneath it. Works
   both in browser-fullscreen and regular windowed mode. */
.kds-shell.kds-fullscreen {
  position: fixed;
  inset: 0;
  margin: 0;
  min-height: 100vh;
  height: 100vh;
  z-index: 2000;
  overflow: hidden;
}

/* ===================== Header ===================== */
.kds-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.85rem;
  padding: 0.85rem 1.25rem;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  flex-wrap: wrap;
  position: relative;
}
.kds-header::before {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 2px;
  background: linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899);
}

.kds-header h4 {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  letter-spacing: -0.015em;
}

.kds-counts {
  display: flex;
  gap: 0.4rem;
}
.kds-count-pill {
  padding: 0.25rem 0.85rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
}
.kds-new {
  background: rgba(99, 102, 241, 0.18);
  color: #c7d2fe;
  border-color: rgba(99, 102, 241, 0.35);
}
.kds-in-progress {
  background: rgba(245, 158, 11, 0.18);
  color: #fcd34d;
  border-color: rgba(245, 158, 11, 0.35);
}
.kds-ready {
  background: rgba(16, 185, 129, 0.18);
  color: #6ee7b7;
  border-color: rgba(16, 185, 129, 0.35);
}

/* LIVE indicator */
.kds-live-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.16);
  color: #6ee7b7;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  border: 1px solid rgba(16, 185, 129, 0.4);
}
.kds-live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  animation: live-pulse 1.4s ease-in-out infinite;
}
@keyframes live-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
  70% { opacity: 0.55; box-shadow: 0 0 0 7px rgba(16, 185, 129, 0); }
}

.rotating { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Header form controls — dark friendly */
.kds-header :deep(.form-select),
.kds-header :deep(.form-control) {
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: #e2e8f0;
}
.kds-header :deep(.form-select):focus,
.kds-header :deep(.form-control):focus {
  background: rgba(15, 23, 42, 0.85);
  border-color: rgba(99, 102, 241, 0.6);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
  color: #fff;
}
.kds-station-select {
  background: linear-gradient(135deg, #f59e0b, #f97316) !important;
  color: #1c1917 !important;
  font-weight: 700 !important;
  border: none !important;
}
.kds-station-select:focus {
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.35) !important;
}
.kds-header :deep(.btn-outline-light) {
  border-color: rgba(148, 163, 184, 0.25);
  color: #e2e8f0;
}
.kds-header :deep(.btn-outline-light:hover) {
  background: rgba(148, 163, 184, 0.12);
  border-color: rgba(148, 163, 184, 0.4);
  color: #fff;
}

/* ===================== Body & grid ===================== */
.kds-body {
  flex: 1;
  padding: 1rem 1.25rem;
  overflow-y: auto;
}
.kds-body::-webkit-scrollbar { width: 10px; }
.kds-body::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.25);
  border-radius: 999px;
}

.kds-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 1rem;
  align-items: start;
}

/* ===================== Ticket card ===================== */
.kds-ticket {
  background: #131c30;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 14px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.5);
  color: #f1f5f9;
  position: relative;
  overflow: hidden;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.kds-ticket:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px -8px rgba(0, 0, 0, 0.6);
}

/* Age-based top accent rail (replaces the 3px outline border) */
.kds-ticket::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4px;
  background: #475569;
  border-radius: 14px 14px 0 0;
}
.ticket-age-green::before { background: linear-gradient(90deg, #10b981, #06b6d4); }
.ticket-age-amber::before { background: linear-gradient(90deg, #f59e0b, #f97316); }
.ticket-age-red::before { background: linear-gradient(90deg, #ef4444, #ec4899); }

.ticket-age-red {
  border-color: rgba(239, 68, 68, 0.55);
  animation: pulse-red 1.6s ease-in-out infinite;
}
@keyframes pulse-red {
  0%, 100% { box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.5), 0 0 0 0 rgba(239, 68, 68, 0.55); }
  50%      { box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.5), 0 0 0 8px rgba(239, 68, 68, 0); }
}

.ticket-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.85rem 0.95rem 0.65rem;
  border-bottom: 1px dashed rgba(148, 163, 184, 0.15);
}
.ticket-order-no {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-size: 1.5rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* PAID pill: customer paid up-front. Distinct from order status badges so
   the kitchen sees it at a glance even on a fast-moving board. */
.kds-paid-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.18);
  color: #6ee7b7;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  border: 1px solid rgba(16, 185, 129, 0.45);
  text-transform: uppercase;
}
.kds-paid-pill i { font-size: 0.85rem; }
.ticket-meta {
  margin-top: 0.25rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
}
.ticket-meta :deep(.badge) {
  font-weight: 700;
  letter-spacing: 0.02em;
}
.ticket-age {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-size: 1.05rem;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.06);
  padding: 0.3rem 0.65rem;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  white-space: nowrap;
  border: 1px solid rgba(148, 163, 184, 0.15);
}
.ticket-age-red   .ticket-age { background: rgba(239, 68, 68, 0.18); color: #fca5a5; border-color: rgba(239, 68, 68, 0.4); }
.ticket-age-amber .ticket-age { background: rgba(245, 158, 11, 0.16); color: #fcd34d; border-color: rgba(245, 158, 11, 0.4); }
.ticket-age-green .ticket-age { background: rgba(16, 185, 129, 0.16); color: #6ee7b7; border-color: rgba(16, 185, 129, 0.4); }

.ticket-note {
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  color: #422006;
  padding: 0.55rem 0.85rem;
  margin: 0.65rem 0.85rem 0;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.ticket-lines {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.65rem 0.85rem;
}

/* ===================== Line cards ===================== */
.kds-line {
  background: #0e172a;
  border-left: 4px solid #475569;
  border-radius: 8px;
  padding: 0.6rem 0.7rem;
  transition: background 0.15s ease;
}
.kds-line.status-new {
  border-left-color: #6366f1;
}
.kds-line.status-in_progress {
  border-left-color: #f59e0b;
  background: linear-gradient(135deg, #1a253c 0%, #0e172a 100%);
}
.kds-line.status-ready {
  border-left-color: #10b981;
  background: rgba(16, 185, 129, 0.08);
  opacity: 0.7;
}
.kds-line.status-ready .kds-line-name .fw-bold {
  text-decoration: line-through;
  text-decoration-thickness: 2px;
  text-decoration-color: rgba(255, 255, 255, 0.4);
  color: #94a3b8;
}

.kds-line-row {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
}
.kds-line-qty {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-size: 1.4rem;
  font-weight: 800;
  color: #fbbf24;
  min-width: 36px;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.kds-line-name {
  flex-grow: 1;
  line-height: 1.25;
  font-size: 1.05rem;
  color: #f1f5f9;
}
.kds-line-mods {
  margin-top: 0.25rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.kds-mod {
  font-size: 0.75rem;
  background: rgba(99, 102, 241, 0.22);
  color: #c7d2fe;
  padding: 0.08rem 0.45rem;
  border-radius: 5px;
  font-weight: 600;
  border: 1px solid rgba(99, 102, 241, 0.3);
}
.kds-station-chip {
  font-size: 0.68rem;
  background: rgba(245, 158, 11, 0.18);
  color: #fcd34d;
  padding: 0.1rem 0.5rem;
  border-radius: 5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  border: 1px solid rgba(245, 158, 11, 0.32);
}
.kds-line-note {
  margin-top: 0.3rem;
  background: rgba(245, 158, 11, 0.16);
  color: #fcd34d;
  padding: 0.2rem 0.5rem;
  border-radius: 5px;
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.kds-line-actions {
  margin-top: 0.5rem;
  display: flex;
  gap: 0.4rem;
  justify-content: flex-end;
}
.kds-line-actions .btn {
  font-weight: 700;
  border-radius: 8px;
  padding: 0.35rem 0.85rem;
}
.kds-line-actions .btn-warning {
  background: linear-gradient(135deg, #f59e0b, #f97316);
  border: none;
  color: #1c1917;
  box-shadow: 0 4px 10px -4px rgba(245, 158, 11, 0.5);
}
.kds-line-actions .btn-success {
  background: linear-gradient(135deg, #10b981, #06b6d4);
  border: none;
  box-shadow: 0 4px 10px -4px rgba(16, 185, 129, 0.5);
}
.kds-line-actions .btn-outline-secondary {
  border-color: rgba(148, 163, 184, 0.3);
  color: #cbd5e1;
}
.kds-line-actions .btn-outline-secondary:hover {
  background: rgba(148, 163, 184, 0.12);
  color: #fff;
  border-color: rgba(148, 163, 184, 0.5);
}

/* ===================== Footer ===================== */
.ticket-foot {
  display: flex;
  gap: 0.4rem;
  padding: 0.65rem 0.85rem 0.85rem;
  border-top: 1px solid rgba(148, 163, 184, 0.1);
}
.ticket-foot .btn {
  font-weight: 700;
  border-radius: 8px;
}
.ticket-foot .btn-light {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(148, 163, 184, 0.18);
  color: #e2e8f0;
}
.ticket-foot .btn-light:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.ticket-foot .btn-dark {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border: none;
  color: #fff;
  box-shadow: 0 4px 12px -4px rgba(99, 102, 241, 0.55);
}
.ticket-foot .btn-dark:hover { filter: brightness(1.08); }
/* "History" clock button on each ticket — was invisible because btn-outline-light
   defaults to white-on-white outside the header context. */
.ticket-foot .btn-outline-light {
  background: transparent;
  border: 1px solid rgba(148, 163, 184, 0.35);
  color: #e2e8f0;
}
.ticket-foot .btn-outline-light:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border-color: rgba(148, 163, 184, 0.6);
}

/* Empty state and loading on dark surface */
.kds-body :deep(.empty-state),
.kds-body :deep(.loading-state) {
  color: #cbd5e1;
}

/* ===================== Timeline drawer ===================== */
.kds-drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  z-index: 2100;
  display: flex;
  justify-content: flex-end;
}
.kds-drawer {
  width: min(440px, 100vw);
  height: 100%;
  background: #0f172a;
  color: #e2e8f0;
  border-left: 1px solid rgba(148, 163, 184, 0.18);
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.55);
}
.kds-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.85);
}
/* Refresh + close buttons in the drawer head — explicit theming so they
   stay readable against the dark drawer surface (default Bootstrap
   btn-outline-light has near-white text/border that disappears here). */
.kds-drawer-head .btn-outline-light {
  background: transparent;
  border: 1px solid rgba(148, 163, 184, 0.35);
  color: #e2e8f0;
}
.kds-drawer-head .btn-outline-light:hover,
.kds-drawer-head .btn-outline-light:focus {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border-color: rgba(148, 163, 184, 0.6);
}
.kds-drawer-head .btn-outline-light:disabled {
  opacity: 0.55;
  color: #cbd5e1;
}
.kds-drawer-title {
  font-family: "Plus Jakarta Sans", sans-serif;
  font-weight: 800;
  font-size: 1.1rem;
  letter-spacing: -0.01em;
}
.kds-drawer-sub {
  color: #94a3b8;
  font-size: 0.85rem;
  margin-top: 0.15rem;
}
.kds-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 0.85rem;
}

/* Timeline list */
.tl-list {
  list-style: none;
  padding: 0 0 0 0.5rem;
  margin: 0;
}
.tl-item {
  position: relative;
  padding: 0 0 0.85rem 1.5rem;
  border-left: 2px solid rgba(148, 163, 184, 0.22);
}
.tl-item:last-child {
  border-left-color: transparent;
  padding-bottom: 0;
}
.tl-dot {
  position: absolute;
  left: -7px;
  top: 4px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #475569;
  box-shadow: 0 0 0 3px rgba(15, 23, 42, 1);
}
.tl-tone-info    { background: #6366f1; }
.tl-tone-warning { background: #f59e0b; }
.tl-tone-success { background: #10b981; }
.tl-tone-default { background: #475569; }

.tl-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.65rem;
}
.tl-label {
  font-weight: 700;
  color: #f1f5f9;
}
.tl-time {
  color: #94a3b8;
  font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  white-space: nowrap;
}
.tl-meta {
  margin-top: 0.2rem;
  color: #cbd5e1;
}
.tl-meta .tl-user { color: #a5b4fc; font-weight: 600; }
.tl-meta .tl-item-name { color: #cbd5e1; }
.tl-meta .tl-order { color: #fcd34d; font-weight: 600; }
.tl-meta .tl-transition { color: #94a3b8; font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace; font-size: 0.75rem; }

/* Active state for header toggle (used by Activity button when its drawer
   is open). Mirrors the LIVE pill colors so they visually rhyme. */
.kds-active-tool,
.kds-active-tool i,
.kds-active-tool span {
  background: rgba(99, 102, 241, 0.22) !important;
  border-color: rgba(99, 102, 241, 0.55) !important;
  color: #c7d2fe !important;
}
.kds-active-tool:hover {
  background: rgba(99, 102, 241, 0.32) !important;
  color: #fff !important;
}

/* Dark Bootstrap modal — keeps the kitchen UI consistent when fullscreen. */
.kds-modal {
  background: #131c30;
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.18);
}
/* Bootstrap's btn-close uses a dark SVG by default; force the white variant
   filter so the X is visible on our dark modal header. */
.kds-modal .btn-close {
  filter: invert(1) grayscale(100%) brightness(2);
  opacity: 0.85;
}
.kds-modal .btn-close:hover { opacity: 1; }
.kds-modal .modal-header {
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}
.kds-modal .modal-footer {
  border-top: 1px solid rgba(148, 163, 184, 0.18);
}
.kds-modal .modal-title { color: #f1f5f9; font-weight: 700; }
.kds-modal .btn-light {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: #e2e8f0;
}
.kds-modal .btn-light:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.kds-modal .btn-dark {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border: none;
  color: #fff;
  box-shadow: 0 4px 12px -4px rgba(99, 102, 241, 0.55);
}
.kds-modal .btn-dark:hover { filter: brightness(1.08); }
.kds-modal .btn-dark:disabled { opacity: 0.7; }
</style>
