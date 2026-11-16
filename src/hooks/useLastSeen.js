import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

/* ---------- write side: tell the server "I'm here", rarely ---------- */

const SEND_GAP_MS = 5 * 60 * 1000;   // never send more than once per 5 min (server also enforces this)
const BEAT_EVERY_MS = 10 * 60 * 1000; // while the tab is open and visible
let lastSent = 0;                     // shared by every caller, so double-mounting costs nothing

async function touch() {
  const t = Date.now();
  if (t - lastSent < SEND_GAP_MS) return;
  lastSent = t;
  try { await supabase.rpc('touch_last_seen'); } catch { /* not important */ }
}

/**
 * Call ONCE in the always-mounted signed-in layout (same place `notify` is created).
 * Writes: on open, when you come back to the tab, when you leave it, and every 10 min while visible.
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
 * Loads once, then re-checks every 2 min, and only while the tab is visible.
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
    const id = setInterval(load, 120_000);
    return () => { active = false; clearInterval(id); };
  }, [key]);

  return map;
}

/* ---------- label helper ---------- */

/** -> null (never seen) | { online: true } | { online: false, text: '3h ago' } */
export function lastSeenInfo(iso) {
  if (!iso) return null;
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  if (min < 11) return { online: true, text: 'now' }; // heartbeat is every <=10 min
  if (min < 60) return { online: false, text: `${min}m ago` };
  const h = Math.floor(min / 60);
  if (h < 24) return { online: false, text: `${h}h ago` };
  const d = Math.floor(h / 24);
  return { online: false, text: d === 1 ? 'yesterday' : `${d}d ago` };
}
