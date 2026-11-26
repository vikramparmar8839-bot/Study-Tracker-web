import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';

/* =====================================================================
   NUDGE  ->  Supabase Realtime Broadcast (live, no database writes)
   Every user listens on their own channel "nudge:<their user id>".
   To nudge someone, you briefly join THEIR channel, send one message, and leave.
   Works while the app is open (foreground or background tab).
   ===================================================================== */

const COOLDOWN_MS = 30 * 1000;      // one nudge per person per 30s (sender side)
const INCOMING_GAP_MS = 10 * 1000;  // ignore the same sender if they nudge again within 10s (receiver side)
const SEND_TIMEOUT_MS = 6000;
const MAX_MESSAGE_LEN = 80;         // longest short message that can ride along with a nudge

/* ---------- sound (Web Audio: no audio file needed) ---------- */

let audioCtx = null;
function getCtx() {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}

/** Call from a click/tap: browsers only allow sound after the user has interacted with the page. */
export function enableNudgeAlerts() {
  try { getCtx()?.resume(); } catch { /* ignore */ }
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  } catch { /* ignore */ }
}

/** Pleasant but loud bell chime: a rising C-E-G-C arpeggio, played twice. */
export function playNudgeSound() {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    ctx.resume();

    // Compressor + master gain: loud without harsh distortion
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 10;
    const master = ctx.createGain();
    master.gain.value = 2.2; // lower this (e.g. 1.5) if too loud
    comp.connect(master);
    master.connect(ctx.destination);

    const t0 = ctx.currentTime + 0.02;
    const arpeggio = [1046.5, 1318.5, 1568, 2093]; // C6 E6 G6 C7
    const notes = [];
    for (let round = 0; round < 2; round++) {
      arpeggio.forEach((freq, i) => notes.push([freq, round * 1.4 + i * 0.16]));
    }

    // A bell = a few sine partials; the higher ones fade faster
    const partials = [
      { mult: 1, vol: 1.0, decay: 1.1 },
      { mult: 2, vol: 0.5, decay: 0.7 },
      { mult: 3, vol: 0.25, decay: 0.45 },
      { mult: 4.2, vol: 0.12, decay: 0.3 },
    ];

    notes.forEach(([freq, dt]) => {
      partials.forEach(({ mult, vol, decay }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        gain.gain.setValueAtTime(0.0001, t0 + dt);
        gain.gain.exponentialRampToValueAtTime(vol * 0.6, t0 + dt + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + decay);
        osc.connect(gain);
        gain.connect(comp);
        osc.start(t0 + dt);
        osc.stop(t0 + dt + decay + 0.05);
      });
    });
  } catch { /* sound is a bonus, never break the app */ }
}

/* ---------- send side ---------- */

const sending = new Set();          // ids I am sending to right now
const cooldownUntil = new Map();    // id -> time (ms) when I may nudge them again
const failedUntil = new Map();      // id -> time (ms) until the "couldn't send" state clears

function sendTo(toId, payload) {
  return new Promise((resolve) => {
    let finished = false;
    const ch = supabase.channel(`nudge:${toId}`);
    const done = (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      supabase.removeChannel(ch);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), SEND_TIMEOUT_MS);
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          const res = await ch.send({ type: 'broadcast', event: 'nudge', payload });
          done(res === 'ok');
        } catch {
          done(false);
        }
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        done(false);
      }
    });
  });
}

/**
 * const { send, status } = useNudgeSender();
 * status(userId) -> 'idle' | 'sending' | 'sent' (cooling down) | 'failed'
 * send(userId, { fromName, groupName, message })  // message is optional, max 80 chars
 */
export function useNudgeSender() {
  const { user } = useAuth();
  const [, rerender] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const bump = useCallback((ms = 0) => {
    setTimeout(() => { if (alive.current) rerender((n) => n + 1); }, ms);
  }, []);

  const status = useCallback((toId) => {
    const now = Date.now();
    if (sending.has(toId)) return 'sending';
    if ((failedUntil.get(toId) || 0) > now) return 'failed';
    if ((cooldownUntil.get(toId) || 0) > now) return 'sent';
    return 'idle';
  }, []);

  const send = useCallback(async (toId, { fromName, groupName, message }) => {
    if (!user || toId === user.id || status(toId) !== 'idle') return;
    enableNudgeAlerts(); // we are inside a click, so this is allowed to unlock sound / ask for permission
    sending.add(toId);
    bump();
    const ok = await sendTo(toId, {
      fromId: user.id,
      fromName: String(fromName || 'Someone').slice(0, 40),
      groupName: String(groupName || '').slice(0, 40),
      message: String(message || '').trim().slice(0, MAX_MESSAGE_LEN),
      at: Date.now(),
    });
    sending.delete(toId);
    if (ok) {
      cooldownUntil.set(toId, Date.now() + COOLDOWN_MS);
      bump(COOLDOWN_MS + 50); // flip the button back to "Nudge" when the cooldown ends
    } else {
      failedUntil.set(toId, Date.now() + 3000);
      bump(3050);
    }
    bump();
  }, [user, status, bump]);

  return { send, status };
}

/* ---------- receive side ---------- */

const lastFrom = new Map(); // sender id -> time (ms) of the last nudge I accepted

/**
 * Mount once in the always-mounted signed-in layout (NudgeHost does this).
 * onNudge({ id, fromName, groupName, message }) is called for every accepted nudge, after the sound
 * and the system notification have been triggered.
 */
export function useNudgeReceiver({ soundOn = true, onNudge }) {
  const { user } = useAuth();
  const myId = user?.id;
  const soundRef = useRef(soundOn);
  const cbRef = useRef(onNudge);
  soundRef.current = soundOn;
  cbRef.current = onNudge;

  useEffect(() => {
    if (!myId) return undefined;
    let ch = null;
    let timer = null;
    let stopped = false;

    const handle = (payload) => {
      if (!payload || typeof payload.fromId !== 'string' || payload.fromId === myId) return;
      const now = Date.now();
      if (now - (lastFrom.get(payload.fromId) || 0) < INCOMING_GAP_MS) return; // anti-spam
      lastFrom.set(payload.fromId, now);

      const fromName = String(payload.fromName || 'Someone').slice(0, 40);
      const groupName = String(payload.groupName || '').slice(0, 40);
      const message = String(payload.message || '').trim().slice(0, MAX_MESSAGE_LEN);

      if (soundRef.current) playNudgeSound();
      try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ }

      // system notification only when the tab is not in front (otherwise the in-app toast is enough)
      if (document.visibilityState !== 'visible') {
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`👋 ${fromName} nudged you`, {
              body: message || (groupName ? `Time to study! (${groupName})` : 'Time to study!'),
              tag: `nudge-${payload.fromId}`,
            });
          }
        } catch { /* some mobile browsers only allow notifications via a service worker */ }
      }
      cbRef.current?.({ id: `${payload.fromId}-${now}`, fromName, groupName, message });
    };

    const join = () => {
      if (stopped || ch) return;
      const c = supabase.channel(`nudge:${myId}`);
      ch = c;
      c.on('broadcast', { event: 'nudge' }, ({ payload }) => handle(payload)).subscribe((status) => {
        // a dropped connection (phone slept, network blip) must be re-joined, not just errors
        if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) rejoin(c, 3000);
      });
    };

    const rejoin = (c, delay) => {
      if (stopped || ch !== c) return; // an old channel, or one we closed ourselves
      ch = null;                        // clear first: removeChannel() fires CLOSED again
      supabase.removeChannel(c);
      clearTimeout(timer);
      timer = setTimeout(join, delay);
    };

    // coming back to the app / network: make sure the channel is really alive
    const check = () => {
      if (stopped) return;
      if (!ch) { clearTimeout(timer); join(); return; }
      if (['closed', 'errored'].includes(ch.state)) rejoin(ch, 0);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };

    join();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
      if (ch) supabase.removeChannel(ch);
    };
  }, [myId]);
}
