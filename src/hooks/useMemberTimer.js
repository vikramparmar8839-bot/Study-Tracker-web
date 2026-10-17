import { useEffect, useRef, useState } from 'react';
import { saveSession, memberStatusSet, memberStatusTouch, SESSION_SAVED_EVENT } from '../lib/api';

/**
 * YOUR OWN timer inside a study group. Nobody else controls it.
 *  - counts down against a deadline (accurate in background tabs)
 *  - survives leaving the Groups page / refreshing (kept in localStorage)
 *  - publishes your status so group mates see "Focusing 18:32 left"
 *  - when a focus run ends (or you press Finish) it saves ONLY the time you really studied
 */
const keyFor = (g) => `studytrack-group-timer:${g}`;
const IDLE = { mode: 'focus', status: 'idle', durationSec: 25 * 60, endsAt: 0, pausedRemaining: 0 };

const loadSaved = (g) => {
  try { return { ...IDLE, ...JSON.parse(localStorage.getItem(keyFor(g))) }; } catch { return IDLE; }
};
const calc = (s) =>
  s.status === 'running' ? Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000))
  : s.status === 'paused' ? s.pausedRemaining
  : s.durationSec;

export function useMemberTimer(groupId, { onSessionSaved } = {}) {
  const [t, setT] = useState(IDLE);
  const [remaining, setRemaining] = useState(IDLE.durationSec);
  const tRef = useRef(IDLE);

  function push(s) {
    if (!groupId) return;
    memberStatusSet(
      groupId,
      s.status === 'idle' ? 'idle' : s.mode,
      s.status === 'paused',
      s.status === 'idle' ? 0 : calc(s),
      s.durationSec,
    ).catch(console.error);
  }

  function commit(next) {
    tRef.current = next;
    setT(next);
    setRemaining(calc(next));
    try { localStorage.setItem(keyFor(groupId), JSON.stringify(next)); } catch { /* storage unavailable */ }
    push(next);
  }

  function saveStudied(secs, endedAtMs) {
    if (secs < 60) return;                           // under a minute does not count
    saveSession({ startedAt: endedAtMs - secs * 1000, endedAt: endedAtMs, groupId })
      .then((row) => {
        window.dispatchEvent(new Event(SESSION_SAVED_EVENT));
        onSessionSaved?.(row);
      })
      .catch((e) => console.error('Could not save group session', e));
  }

  function finish(s, endedAtMs) {
    if (s.mode === 'focus') saveStudied(s.durationSec, endedAtMs);
    commit({ ...s, status: 'idle', endsAt: 0, pausedRemaining: 0 });
  }

  /* restore this group's timer (also covers "finished while I was away") */
  useEffect(() => {
    if (!groupId) return;
    const saved = loadSaved(groupId);
    tRef.current = saved;
    setT(saved);
    setRemaining(calc(saved));
    if (saved.status === 'running' && saved.endsAt <= Date.now()) finish(saved, saved.endsAt);
    else if (saved.status !== 'idle') push(saved);   // refresh my status for the others
    else push(saved);                                // make sure I show as idle
  }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* tick */
  useEffect(() => {
    if (t.status !== 'running') return undefined;
    const id = setInterval(() => {
      const s = tRef.current;
      if (s.status !== 'running') return;
      const r = calc(s);
      setRemaining(r);
      if (r === 0) finish(s, Date.now());
    }, 250);
    return () => clearInterval(id);
  }, [t.status, groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* heartbeat so others know I'm still here */
  useEffect(() => {
    if (!groupId || t.status === 'idle') return undefined;
    const id = setInterval(() => memberStatusTouch(groupId).catch(() => {}), 45_000);
    return () => clearInterval(id);
  }, [groupId, t.status]);

  return {
    mode: t.mode,
    status: t.status,          // 'idle' | 'running' | 'paused'
    remaining,
    durationSec: t.durationSec,

    start(mode = 'focus', minutes = 25) {
      const durationSec = minutes * 60;
      commit({ mode, status: 'running', durationSec, endsAt: Date.now() + durationSec * 1000, pausedRemaining: 0 });
    },
    pause() {
      const s = tRef.current;
      if (s.status !== 'running') return;
      commit({ ...s, status: 'paused', endsAt: 0, pausedRemaining: calc(s) });
    },
    resume() {
      const s = tRef.current;
      if (s.status !== 'paused') return;
      commit({ ...s, status: 'running', endsAt: Date.now() + s.pausedRemaining * 1000, pausedRemaining: 0 });
    },
    /** Finish / stop: logs the focus time studied so far (if >= 1 min) and goes idle */
    stop() {
      const s = tRef.current;
      if (s.status === 'idle') return;
      if (s.mode === 'focus') saveStudied(s.durationSec - calc(s), Date.now());
      commit({ ...s, status: 'idle', endsAt: 0, pausedRemaining: 0 });
    },
  };
}
