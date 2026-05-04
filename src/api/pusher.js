// src/api/pusher.js
//
// Lazy, single-instance Pusher client. Returns null when not configured —
// callers should fall back to polling. Frontend reads VITE_PUSHER_KEY and
// VITE_PUSHER_CLUSTER (Vite env vars exposed to the client at build time).

import Pusher from "pusher-js";

let _client = null;
let _attempted = false;

export function getPusherClient() {
  if (_client) return _client;
  if (_attempted) return null;
  _attempted = true;

  const key = (import.meta.env.VITE_PUSHER_KEY || "").trim();
  const cluster = (import.meta.env.VITE_PUSHER_CLUSTER || "ap2").trim();

  if (!key) {
    // Pusher not configured for this build; callers should fall back to polling.
    return null;
  }

  try {
    _client = new Pusher(key, {
      cluster,
      forceTLS: true,
      enabledTransports: ["ws", "wss"],
      // Public channels only for now — no auth endpoint configured.
    });
    return _client;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Pusher init failed; using polling fallback", e);
    return null;
  }
}

/**
 * Subscribe to a channel and bind one or more events.
 * Returns an unsubscribe function that unbinds and unsubscribes.
 *
 * Usage:
 *   const off = subscribe("store-1-kds", {
 *     "kds.lines-sent": (d) => { ... },
 *     "kds.line-status": (d) => { ... },
 *   });
 *   ...later: off();
 */
export function subscribe(channelName, eventHandlers = {}) {
  const c = getPusherClient();
  if (!c) return () => {};

  const channel = c.subscribe(channelName);
  const bound = [];
  for (const [evt, handler] of Object.entries(eventHandlers)) {
    channel.bind(evt, handler);
    bound.push([evt, handler]);
  }
  return () => {
    for (const [evt, handler] of bound) {
      try { channel.unbind(evt, handler); } catch {}
    }
    try { c.unsubscribe(channelName); } catch {}
  };
}

export function isPusherConfigured() {
  return !!(import.meta.env.VITE_PUSHER_KEY || "").trim();
}
