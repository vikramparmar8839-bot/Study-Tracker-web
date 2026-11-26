import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { getServerOffsetMs, listMemberStatuses } from '../lib/api';

const PAUSE_STALE_MS = 3_600_000; // a PAUSED timer with no sign of life for 1 hour -> idle
/* a RUNNING timer needs no heartbeat: it stays live until its server-side ends_at passes,
   even if the tab is closed or frozen in the background */

/**
 * Live status of every member in a group.
 *
 *   const presence = useGroupPresence(groupId);
 *   presence[userId] -> { state: 'idle' | 'focus' | 'break', paused: bool, remaining: seconds }
 *   (a member with no entry is simply idle)
 */
export function useGroupPresence(groupId) {
  const [rows, setRows] = useState({});
  const [now, setNow] = useState(Date.now());
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!groupId) return undefined;
    let active = true;
    setRows({});

    (async () => {
      offsetRef.current = await getServerOffsetMs().catch(() => 0);
      const list = await listMemberStatuses(groupId).catch(() => []);
      if (active) setRows((prev) => ({ ...Object.fromEntries(list.map((r) => [r.user_id, r])), ...prev }));
    })();

    const channel = supabase
      .channel(`group-status-${groupId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'group_member_status', filter: `group_id=eq.${groupId}` },
        (p) => {
          if (!active) return;
          if (p.eventType === 'DELETE') {
            setRows((r) => { const next = { ...r }; delete next[p.old.user_id]; return next; });
          } else {
            setRows((r) => ({ ...r, [p.new.user_id]: p.new }));
          }
        })
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [groupId]);

  /* safety net: re-read the table every 15s in case a realtime event is missed */
  useEffect(() => {
    if (!groupId) return undefined;
    let active = true;
    const id = setInterval(async () => {
      const list = await listMemberStatuses(groupId).catch(() => null);
      if (active && list) setRows(Object.fromEntries(list.map((r) => [r.user_id, r])));
    }, 15_000);
    return () => { active = false; clearInterval(id); };
  }, [groupId]);

  /* one tick per second, only while somebody is actually running */
  const anyRunning = Object.values(rows).some((r) => r.state !== 'idle' && !r.paused);
  useEffect(() => {
    if (!anyRunning) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  return useMemo(() => {
    const serverNow = now + offsetRef.current;
    const out = {};
    for (const [uid, r] of Object.entries(rows)) {
      const remaining = r.paused
        ? r.remaining_sec
        : Math.max(0, Math.ceil((Date.parse(r.ends_at) - serverNow) / 1000));
      const live = r.state !== 'idle' && (r.paused
        ? serverNow - Date.parse(r.updated_at) < PAUSE_STALE_MS
        : remaining > 0);
      out[uid] = live
        ? { state: r.state, paused: r.paused, remaining }
        : { state: 'idle', paused: false, remaining: 0 };
    }
    return out;
  }, [rows, now]);
}
