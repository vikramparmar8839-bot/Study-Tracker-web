import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

/* ---------- write side: tell the server "I'm here", rarely ---------- */

const SEND_GAP_MS = 50 * 1000;       // never send more than once per 50s (the server function must allow this too)
const BEAT_EVERY_MS = 60 * 1000;      // while the tab is open and visible
let lastSent = 0;                     // shared by every caller, so double-mounting costs nothing

async function touch() {
  const t = Date.now();
  if (t - lastSent < SEND_GAP_MS) return;
  lastSent = t;
  try { await supabase.rpc('touch_last_seen'); } catch { /* not important */ }
}

/**
 * Call ONCE in the always-mounted signed-in layout (same place `notify` is created).
 * Writes: on open, when you come back to the tab, when you leave it, and every 60s while visible.
 */
export function useLastSeenHeartbeat() {
  useEffect(() => {
    touch();
    const onVis = () => touch(); // fires on both hide and show; the gap keeps it cheap
    document.addEventListener('visibilitychange', onVis);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') touch();
    }, BEAT_EVERY_MS);
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(id); };
  }, []);
}

/* ---------- read side: one small query, no realtime ---------- */

/**
 * const seen = useLastSeen(userIds);  ->  { [userId]: ISO timestamp }
 * Loads once, then re-checks every 60s, and only while the tab is visible.
 */
export function useLastSeen(userIds) {
  const [map, setMap] = useState({});
  const key = [...userIds].sort().join(',');

  useEffect(() => {
    if (!key) return undefined;
    let active = true;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      const { data } = await supabase
        .from('user_last_seen')
        .select('user_id,last_seen_at')
        .in('user_id', key.split(','));
      if (active && data) setMap(Object.fromEntries(data.map((r) => [r.user_id, r.last_seen_at])));
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { active = false; clearInterval(id); };
  }, [key]);

  return map;
}

/* ---------- label helper ---------- */

const ONLINE_WINDOW_MS = 150 * 1000; // online = seen in the last 2.5 min (about 2 missed beats)

/** -> null (never seen) | { online: true } | { online: false, text: '3h ago' } */
export function lastSeenInfo(iso) {
  if (!iso) return null;
  const ms = Math.max(0, Date.now() - Date.parse(iso));
  const min = Math.floor(ms / 60000);
  if (ms < ONLINE_WINDOW_MS) return { online: true, text: 'now' }; // heartbeat is every 60s
  if (min < 60) return { online: false, text: `${min}m ago` };
  const h = Math.floor(min / 60);
  if (h < 24) return { online: false, text: `${h}h ago` };
  const d = Math.floor(h / 24);
  return { online: false, text: d === 1 ? 'yesterday' : `${d}d ago` };
}
