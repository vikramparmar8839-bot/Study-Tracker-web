import { useEffect, useState, useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabaseClient';

/* =====================================================================
   ONLINE / OFFLINE  ->  Supabase Realtime Presence (live, no database writes)
   LAST SEEN         ->  still saved in the database, but only every 5 minutes
   Same function names as before, so no other file needs to change.
   ===================================================================== */

/* ---------- live "who is online" (Presence) ---------- */

// A far-future date: still a valid ISO string for any code that parses it,
// and lastSeenInfo() treats it as online no matter when it renders.
const ONLINE_STAMP = '9999-12-31T00:00:00.000Z';

const online = new Set();   // ids of everyone connected right now
const leftAt = new Map();   // id -> time (ms) when I saw them disconnect
const listeners = new Set();
let version = 0;
let channel = null;
let users = 0;              // how many places called useLastSeenHeartbeat()

const emit = () => { version += 1; listeners.forEach((fn) => fn()); };
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const getVersion = () => version;

async function joinPresence() {
  if (channel) return;
  const { data } = await supabase.auth.getSession();
  const myId = data.session?.user?.id;
  if (!myId || users === 0 || channel) return;

  // key = my user id, so several tabs of the same person count as one
  const ch = supabase.channel('online-users', { config: { presence: { key: myId } } });
  channel = ch;
  ch
    .on('presence', { event: 'sync' }, () => {
      const next = new Set(Object.keys(ch.presenceState()));
      for (const id of online) if (!next.has(id)) leftAt.set(id, Date.now());
      online.clear();
      next.forEach((id) => online.add(id));
      emit();
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ch.track({ here: true, at: Date.now() });
      }
      if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) && channel === ch) {
        channel = null;
        supabase.removeChannel(ch);
        setTimeout(joinPresence, 2000); // returns early if users === 0
      }
    });
}

// re-announce "I'm here" (e.g. after the app comes back to the foreground)
function retrack() {
  if (channel) channel.track({ here: true, at: Date.now() });
}

function leavePresence() {
  const ch = channel;
  channel = null; // null first so the CLOSED callback doesn't rejoin
  if (ch) supabase.removeChannel(ch);
  online.clear();
  emit();
}

/* ---------- write side: save "last seen" in the database, rarely ---------- */

const SEND_GAP_MS = 50 * 1000;      // never more than once per 50s (the server function allows this)
const BEAT_EVERY_MS = 5 * 60 * 1000; // while the app is open, even in a background tab
let lastSent = 0;                    // shared by every caller, so double-mounting costs nothing

async function touch(force = false) {
  const t = Date.now();
  if (!force && t - lastSent < SEND_GAP_MS) return;
  lastSent = t;
  try { await supabase.rpc('touch_last_seen'); } catch { /* not important */ }
}

/**
 * Call in the always-mounted signed-in layout (already done in App.jsx).
 * - joins the live Presence channel (this is what makes you show as Online)
 * - saves "last seen" on open, every 5 min, and when the page is closed
 * It does NOT stop when the tab is hidden, so background tabs stay Online.
 */
export function useLastSeenHeartbeat() {
  useEffect(() => {
    users += 1;
    joinPresence();
    touch();
    const id = setInterval(() => touch(), BEAT_EVERY_MS);
    const onLeave = () => touch(true); // best effort, the browser may cut it short
    window.addEventListener('pagehide', onLeave);
    const onBack = () => {
      if (document.visibilityState !== 'visible') return;
      joinPresence(); // rejoin if the channel was dropped
      retrack();      // re-announce "I'm here"
    };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    window.addEventListener('online', onBack);
    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', onLeave);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
      window.removeEventListener('online', onBack);
      users -= 1;
      if (users === 0) leavePresence();
    };
  }, []);
}

/* ---------- read side ---------- */

/**
 * const seen = useLastSeen(userIds);  ->  { [userId]: ISO timestamp }
 * People connected right now get a fixed "online" marker.
 * Everyone else gets their saved last seen time (or the moment I saw them leave, if newer).
 */
export function useLastSeen(userIds) {
  useSyncExternalStore(subscribe, getVersion); // re-render the moment someone joins or leaves
  const [saved, setSaved] = useState({});
  const [, setTick] = useState(0);
  const key = [...userIds].sort().join(',');

  useEffect(() => {
    if (!key) return undefined;
    let active = true;
    let lastLoad = 0;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      const t = Date.now();
      if (t - lastLoad < 5000) return;
      lastLoad = t;
      const { data } = await supabase
        .from('user_last_seen')
        .select('user_id,last_seen_at')
        .in('user_id', key.split(','));
      if (active && data) setSaved(Object.fromEntries(data.map((r) => [r.user_id, r.last_seen_at])));
    };
    load();
    const reload = setInterval(load, BEAT_EVERY_MS);
    const tick = setInterval(() => setTick((n) => n + 1), 60_000); // keeps "5m ago" text moving
    const onShow = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => {
      active = false;
      clearInterval(reload);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
    };
  }, [key]);

  const out = {};
  for (const id of userIds) {
    if (online.has(id)) {
      out[id] = ONLINE_STAMP; // fixed "online right now" marker, never goes stale between renders
    } else {
      const best = Math.max(saved[id] ? Date.parse(saved[id]) : 0, leftAt.get(id) || 0);
      if (best) out[id] = new Date(best).toISOString();
    }
  }
  return out;
}

/* ---------- label helper ---------- */

const ONLINE_WINDOW_MS = 5 * 1000;

/** -> null (never seen) | { online: true } | { online: false, text: '3h ago' } */
export function lastSeenInfo(iso) {
  if (!iso) return null;
  if (iso === ONLINE_STAMP) return { online: true, text: 'now' };
  const ms = Math.max(0, Date.now() - Date.parse(iso));
  const min = Math.floor(ms / 60000);
  if (ms < ONLINE_WINDOW_MS) return { online: true, text: 'now' };
  if (min < 60) return { online: false, text: `${min}m ago` };
  const h = Math.floor(min / 60);
  if (h < 24) return { online: false, text: `${h}h ago` };
  const d = Math.floor(h / 24);
  return { online: false, text: d === 1 ? 'yesterday' : `${d}d ago` };
}
