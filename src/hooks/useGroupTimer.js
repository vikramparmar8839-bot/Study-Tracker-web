import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  getGroupTimer, getServerOffsetMs, timerStart, timerPause, timerResume, timerStop, saveSession,
} from '../lib/api';

/**
 * Live shared timer for a study group.
 *
 * Everyone reads the same row (group_timers). Remaining time is computed from the
 * server's `started_at`, corrected by a clock offset, so all members see the same
 * countdown without the database being written every second.
 *
 * When a running timer reaches zero, each member's client saves its own study session
 * (only for the part of the timer they were actually present for).
 */
export function useGroupTimer(groupId, { onSessionSaved } = {}) {
  const [timer, setTimer] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const offsetRef = useRef(0);
  const presentFromRef = useRef(null);   // server-time ms when this client first saw the run
  const savedForRef = useRef(null);      // started_at already saved, avoids double saves

  const serverNow = () => Date.now() + offsetRef.current;

  // initial load + realtime subscription
  useEffect(() => {
    if (!groupId) return;
    let active = true;

    (async () => {
      offsetRef.current = await getServerOffsetMs().catch(() => 0);
      const row = await getGroupTimer(groupId);
      if (active) setTimer(row);
    })();

    const channel = supabase
      .channel(`group-timer-${groupId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'group_timers', filter: `group_id=eq.${groupId}` },
        (payload) => active && setTimer(payload.new))
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [groupId]);

  // remember when this client joined the current run
  useEffect(() => {
    if (timer?.status === 'running' && presentFromRef.current == null) presentFromRef.current = serverNow();
    if (timer?.status !== 'running' && timer?.status !== 'paused') presentFromRef.current = null;
  }, [timer?.status, timer?.started_at]);

  const computeRemaining = useCallback((t) => {
    if (!t) return 0;
    if (t.status === 'running') {
      const elapsed = (serverNow() - new Date(t.started_at).getTime()) / 1000;
      return Math.max(0, Math.ceil(t.duration_sec - elapsed));
    }
    if (t.status === 'paused') return t.paused_remaining_sec ?? t.duration_sec;
    return t.duration_sec;
  }, []);

  // tick once per second
  useEffect(() => {
    setRemaining(computeRemaining(timer));
    if (timer?.status !== 'running') return;
    const id = setInterval(() => setRemaining(computeRemaining(timer)), 1000);
    return () => clearInterval(id);
  }, [timer, computeRemaining]);

  // finished? save my session once
  useEffect(() => {
    if (timer?.status !== 'running' || remaining > 0) return;
    if (savedForRef.current === timer.started_at) return;
    savedForRef.current = timer.started_at;

    if (timer.mode !== 'focus') return;           // breaks are not study time
    const endMs = new Date(timer.started_at).getTime() + timer.duration_sec * 1000;
    const startMs = Math.max(new Date(timer.started_at).getTime(), presentFromRef.current ?? endMs);
    if (endMs - startMs < 60_000) return;          // joined too late to count

    saveSession({ startedAt: startMs, endedAt: endMs, groupId })
      .then((s) => onSessionSaved?.(s))
      .catch((e) => console.error('Could not save group session', e));
  }, [remaining, timer, groupId, onSessionSaved]);

  return {
    timer,
    remaining,
    status: timer?.status ?? 'idle',
    start: (mode = 'focus', minutes = 25) => timerStart(groupId, mode, minutes * 60),
    pause: () => timerPause(groupId),
    resume: () => timerResume(groupId),
    stop: () => timerStop(groupId),
  };
}

export const formatClock = (sec) =>
  `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
