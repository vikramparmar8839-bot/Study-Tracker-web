 import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { saveFocusSession, saveSession, memberStatusSet, listMyGroups, SESSION_SAVED_EVENT } from "./lib/api"; // adjust the path if this file lives elsewhere
import { playAlarm, unlockAlarm } from "./lib/alarm"; // adjust the path if this file lives elsewhere

/* ------------------------------------------------------------------
   Pomodoro timer for StudyTrack

   usePomodoro()    -> all timer state + logic. Call it ONCE in App so the
                       timer keeps running while you visit other pages.
   <PomodoroTimer>  -> the card UI that displays it on the Dashboard.
------------------------------------------------------------------- */

const PRESETS = {
  classic: { label: "Classic", focus: 25, short: 5, long: 15, rounds: 4 },
  deep: { label: "Deep work", focus: 50, short: 10, long: 30, rounds: 3 },
  quick: { label: "Quick", focus: 15, short: 3, long: 10, rounds: 4 },
};

const DEFAULTS = {
  focus: 25,
  short: 5,
  long: 15,
  rounds: 4,
  autoStart: false,
  sound: true,
};

const LIMITS = {
  focus: [1, 180],
  short: [1, 60],
  long: [1, 90],
  rounds: [1, 12],
};

const PHASES = {
  focus: { label: "Focus", hint: "Stay on one thing." },
  short: { label: "Short break", hint: "Stand up, drink some water." },
  long: { label: "Long break", hint: "You earned this one." },
};

export const POMODORO_STORAGE_KEY = "studytrack-pomodoro";
export const POMODORO_GROUP_KEY = "studytrack-pomodoro-group";

/* pet cat preferences + progress live in their own key so they never
   interfere with the timer settings */
export const PET_STORAGE_KEY = "studytrack-pet";
const PET_EVENT = "studytrack-pet-change";
const PET_DEFAULTS = {
  show: true,
  walk: true,
  bubbles: true,
  outfits: true,
  name: "Mochi",
  coat: "persian",
  total: 0, // focus sessions finished together
  seconds: 0, // total focus time studied together (unlocks rewards)
  head: "auto", // which unlocked hat to wear: "auto" | "none" | a hat key
  streak: 0, // consecutive days studied
  bestStreak: 0,
  lastDay: "", // last day a focus session was finished (YYYY-MM-DD)
  nudge: null, // { text, id } — lets Settings make the cat say something
};

function loadPet() {
  try {
    const stored = JSON.parse(localStorage.getItem(PET_STORAGE_KEY)) || {};
    const pet = { ...PET_DEFAULTS, ...stored };
    /* older saves only counted sessions: assume ~25 min each so nobody loses progress */
    if (stored.seconds == null) pet.seconds = (Number(stored.total) || 0) * 25 * 60;
    return pet;
  } catch {
    return { ...PET_DEFAULTS };
  }
}

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* add a finished (or partly finished) focus session to the pet's progress */
function addStudy(c, secs) {
  const today = dayKey();
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  let streak = Number(c.streak) || 0;
  if (c.lastDay !== today) streak = c.lastDay === dayKey(yest) ? streak + 1 : 1;
  return {
    ...c,
    total: (Number(c.total) || 0) + 1,
    seconds: (Number(c.seconds) || 0) + secs,
    streak,
    bestStreak: Math.max(Number(c.bestStreak) || 0, streak),
    lastDay: today,
  };
}

/* hours of focus time the cat has studied with you */
const petHours = (pet) => (Number(pet.seconds) || 0) / 3600;
const fmtHours = (h) => `${h < 10 ? h.toFixed(1).replace(/\.0$/, "") : Math.floor(h)}h`;

/* patch = object, or (current) => next */
function updatePetStore(patch) {
  const current = loadPet();
  const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
  try {
    localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(PET_EVENT));
  return next;
}

const clamp = (n, [min, max]) => Math.min(max, Math.max(min, n));
const pad = (n) => String(n).padStart(2, "0");
const fmt = (secs) => `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(POMODORO_STORAGE_KEY)) };
  } catch {
    return DEFAULTS;
  }
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.28, 0.56].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.12, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.22);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.24);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    /* audio blocked — ignore */
  }
}

/* ================================================================
   Hook
================================================================ */

const RUN_KEY = "studytrack-pomodoro-run";
const PAUSE_LIMIT_MS = 60 * 60 * 1000; // a timer left paused for 1 hour is wrapped up automatically

/* read the timer that was running before the page was refreshed */
function restoreRun() {
  const settings = loadSettings();
  let s = null;
  try { s = JSON.parse(localStorage.getItem(RUN_KEY)); } catch { /* ignore */ }
  if (!s || !PHASES[s.phase]) return null;

  const base = {
    phase: s.phase,
    round: Number(s.round) || 0,
    subject: s.subject || "",
    runId: s.runId || "",
    running: false,
    remaining: settings[s.phase] * 60,
    endsAt: 0,
    finished: null,
  };

  if (s.running) {
    const left = Math.ceil((s.endsAt - Date.now()) / 1000);
    if (left > 0) return { ...base, running: true, remaining: left, endsAt: s.endsAt };

    /* it ran out while the page was closed */
    if (s.phase !== "focus") return { ...base, phase: "focus", remaining: settings.focus * 60 };
    const done = base.round + 1;
    const cycleEnd = done >= settings.rounds;
    const next = cycleEnd ? "long" : "short";
    return {
      ...base,
      phase: next,
      round: cycleEnd ? 0 : done,
      remaining: settings[next] * 60,
      finished: { secs: Number(s.total) || settings.focus * 60, endedAt: s.endsAt, runId: s.runId || "" },
    };
  }

  if (s.locked) {
    const left = Math.max(1, Number(s.remaining) || base.remaining); // paused
    const savedAt = Number(s.savedAt) || Date.now();
    if (Date.now() - savedAt > PAUSE_LIMIT_MS) {
      /* paused for over an hour while the page was closed: log what was studied, then reset */
      const studied = s.phase === "focus" ? Math.max(0, (Number(s.total) || 0) - left) : 0;
      return studied >= 60
        ? { ...base, finished: { secs: studied, endedAt: savedAt, runId: s.runId || "" } }
        : base;
    }
    return { ...base, remaining: left };
  }
  return base;
}

export function usePomodoro({ subjects = [], onSessionComplete } = {}) {
  const subjectNames = subjects.map((s) => (typeof s === "string" ? s : s.name));

  const [settings, setSettings] = useState(loadSettings);
  const [restored] = useState(restoreRun); // timer saved before a refresh (or null)
  const [phase, setPhase] = useState(restored?.phase ?? "focus");
  const [remaining, setRemaining] = useState(() => restored?.remaining ?? loadSettings().focus * 60);
  const [running, setRunning] = useState(restored?.running ?? false);
  const [round, setRound] = useState(restored?.round ?? 0); // focus sessions finished in this cycle
  const [subject, setSubject] = useState(restored?.subject ?? ""); // "" = General Study
  const [petEvent, setPetEvent] = useState({ type: "", id: 0 }); // lets the cat react to Skip / Reset
  /* study group this timer is attached to ("" = just me). The group sees my status and gets my sessions. */
  const [groupId, setGroupIdState] = useState(() => {
    try { return localStorage.getItem(POMODORO_GROUP_KEY) || ""; } catch { return ""; }
  });
  const setGroupId = (id) => {
    setGroupIdState(id);
    try { localStorage.setItem(POMODORO_GROUP_KEY, id || ""); } catch { /* storage unavailable */ }
  };
  const remainingRef = useRef(0);

  const endRef = useRef(restored?.endsAt || 0);
  const handledRef = useRef(false);
  const prevTotal = useRef(0);
  const baseTitle = useRef(document.title);

  const total = settings[phase] * 60;
  const elapsed = total - remaining;
  const locked = running || remaining !== total; // a session is in progress
  const progress = total ? (elapsed / total) * 100 : 0;
  remainingRef.current = remaining;

  /* every focus/break run gets its own id: the server saves a finished run under this id, and the
     browser uses the same id, so a session is never counted twice */
  const runIdRef = useRef(restored?.runId || "");
  const wasLockedRef = useRef(locked);
  const lastPhaseRef = useRef(phase);

  /* drop a subject that was deleted */
  useEffect(() => {
    if (subject && !subjectNames.includes(subject)) setSubject("");
  }, [subjectNames.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  /* persist settings */
  useEffect(() => {
    try {
      localStorage.setItem(POMODORO_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable */
    }
  }, [settings]);

  /* remember the running timer so a refresh doesn't lose it */
  useEffect(() => {
    if (locked) {
      if (!runIdRef.current || !wasLockedRef.current || lastPhaseRef.current !== phase) {
        runIdRef.current = crypto.randomUUID(); // a new run has started
      }
    } else {
      runIdRef.current = "";
    }
    wasLockedRef.current = locked;
    lastPhaseRef.current = phase;
    try {
      localStorage.setItem(RUN_KEY, JSON.stringify({
        phase, round, subject, running, locked, total,
        runId: runIdRef.current,
        savedAt: Date.now(),
        endsAt: running ? endRef.current : 0,
        remaining: running ? 0 : remaining,
      }));
    } catch {
      /* storage unavailable */
    }
  }, [phase, round, subject, running, locked, total, remaining]);

  /* a focus run that ended while the page was closed still counts */
  useEffect(() => {
    const f = restored?.finished;
    if (!f || handledRef.current) return;
    handledRef.current = true;
    onSessionComplete?.({ subject: restored.subject, minutes: Math.round(f.secs / 60) });
    updatePetStore((c) => addStudy(c, f.secs));
    saveSession({
      id: f.runId || undefined,
      startedAt: f.endedAt - f.secs * 1000,
      endedAt: f.endedAt,
      subject: restored.subject || null,
      groupId: groupId || null,
    })
      .then(() => window.dispatchEvent(new Event(SESSION_SAVED_EVENT)))
      .catch(console.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* an untouched timer follows the selected length */
  useEffect(() => {
    if (prevTotal.current === 0) { prevTotal.current = total; return; } // first render: keep restored time
    if (prevTotal.current === total) return;
    prevTotal.current = total;
    if (!running) setRemaining(total);
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

  /* tick against a deadline so background tabs stay accurate */
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((endRef.current - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [running]);

  /* timer reached zero */
  useEffect(() => {
    if (running && remaining === 0) finishPhase();
  }, [remaining, running]); // eslint-disable-line react-hooks/exhaustive-deps

  /* publish my status to ALL my study groups (each group board reads this).
     Which group the dropdown picks only decides where the study TIME is counted. */
  const statusRef = useRef(null);
  const pushStatusToAllGroups = () => {
    const a = statusRef.current;
    if (!a) return;
    listMyGroups()
      .then((list) =>
        Promise.all(
          list.map((g) =>
            memberStatusSet(
              g.id, a.state, a.paused, a.state === "idle" ? 0 : remainingRef.current, a.total,
              a.state === "idle" ? null : a.runId || null, a.creditGroup, a.subject,
            ).catch(() => {}),
          ),
        ),
      )
      .catch(() => {});
  };

  useEffect(() => {
    statusRef.current = {
      state: !locked ? "idle" : phase === "focus" ? "focus" : "break",
      paused: locked && !running,
      total,
      runId: runIdRef.current,
      creditGroup: groupId || null, // the group that gets the study time (server saves it if the tab is closed)
      subject: subject || null,
    };
    pushStatusToAllGroups();
  }, [running, locked, phase, total, groupId, subject]); // eslint-disable-line react-hooks/exhaustive-deps

  /* heartbeat: keeps me from going stale, and also covers groups I join mid-session */
  useEffect(() => {
    if (!locked) return undefined;
    const id = setInterval(pushStatusToAllGroups, 45000);
    return () => clearInterval(id);
  }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps

  /* countdown in the browser tab */
  useEffect(() => {
    const base = baseTitle.current;
    document.title = running ? `${fmt(remaining)} · ${PHASES[phase].label} | ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [running, remaining, phase]);

  function goTo(nextPhase, autoStart = false) {
    const secs = settings[nextPhase] * 60;
    setPhase(nextPhase);
    setRemaining(secs);
    if (autoStart) {
      endRef.current = Date.now() + secs * 1000;
      setRunning(true);
    } else {
      setRunning(false);
    }
  }

  /* with a group attached the time counts on the group board (and in my own stats); otherwise personal only */
  function logSession(secs) {
    const id = runIdRef.current || undefined; // same id the server uses, so it can never be saved twice
    if (groupId) {
      if (secs < 60) return; // under a minute does not count for a group
      const endedAt = Date.now();
      saveSession({ id, startedAt: endedAt - secs * 1000, endedAt, groupId })
        .then(() => window.dispatchEvent(new Event(SESSION_SAVED_EVENT)))
        .catch(console.error);
    } else {
      saveFocusSession({ subject, seconds: secs, id }).catch(console.error); // backend
    }
  }

  function finishPhase() {
    if (settings.sound) playAlarm();

    if (phase === "focus") {
      onSessionComplete?.({ subject, minutes: settings.focus });
      logSession(settings.focus * 60);
      updatePetStore((c) => addStudy(c, settings.focus * 60));
      const done = round + 1;
      if (done >= settings.rounds) {
        setRound(0);
        goTo("long", settings.autoStart);
      } else {
        setRound(done);
        goTo("short", settings.autoStart);
      }
    } else {
      goTo("focus", settings.autoStart);
    }
  }

  function start() {
    unlockAlarm(); // lets the browser play the sound when the timer ends
    endRef.current = Date.now() + remaining * 1000;
    setRunning(true);
  }

  function pause() {
    setRemaining(Math.max(0, Math.ceil((endRef.current - Date.now()) / 1000)));
    setRunning(false);
  }

  function reset() {
    if (elapsed > 0) setPetEvent({ type: "reset", id: Date.now() });
    setRunning(false);
    setRemaining(total);
  }

  function skip() {
    if (phase === "focus") setPetEvent({ type: "skip", id: Date.now() });
    goTo(phase === "focus" ? "short" : "focus", false);
  }

  /* log the time studied so far and stop (needs at least 1 minute) */
  function finishEarly() {
    if (phase !== "focus" || elapsed < 60) return;
    onSessionComplete?.({
      subject,
      minutes: Math.max(1, Math.round(elapsed / 60)),
      partial: true,
    });
    logSession(elapsed);
    updatePetStore((c) => addStudy(c, elapsed));
    setRunning(false);
    setRemaining(total);
  }

  /* a timer left paused for an hour is wrapped up: time studied so far is logged and the timer resets */
  const autoFinishRef = useRef(() => {});
  autoFinishRef.current = () => {
    if (phase === "focus" && elapsed >= 60) finishEarly();
    else { setRunning(false); setRemaining(total); }
  };
  useEffect(() => {
    if (!locked || running) return undefined;
    const id = setTimeout(() => autoFinishRef.current(), PAUSE_LIMIT_MS);
    return () => clearTimeout(id);
  }, [locked, running]);

  function applyPreset(key) {
    const { label, ...values } = PRESETS[key]; // eslint-disable-line no-unused-vars
    setSettings((s) => ({ ...s, ...values }));
    setRound(0);
  }

  const update = (key) => (value) => setSettings((s) => ({ ...s, [key]: value }));

  function applySettings(next) {
    setSettings({ ...DEFAULTS, ...(next || {}) });
    setRound(0);
    reset();
  }

  function resetAll() {
    setRunning(false);
    setPhase("focus");
    setRound(0);
    setSubject("");
    setSettings(DEFAULTS);
    setRemaining(DEFAULTS.focus * 60);
  }

  const activePreset =
    Object.entries(PRESETS).find(
      ([, p]) =>
        p.focus === settings.focus &&
        p.short === settings.short &&
        p.long === settings.long &&
        p.rounds === settings.rounds
    )?.[0] || "custom";

  return {
    settings, phase, remaining, running, round, subject, setSubject, petEvent, groupId, setGroupId,
    total, elapsed, locked, progress, activePreset,
    goTo, start, pause, reset, skip, finishEarly,
    applyPreset, update, applySettings, resetAll,
  };
}

/* ================================================================
   UI
================================================================ */

/* number input that lets you clear and retype before it commits */
function NumberField({ label, value, range, suffix, disabled, onChange }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  return (
    <label className="pomo-field">
      <span>{label}</span>
      <div className="pomo-field-input">
        <input
          type="number"
          inputMode="numeric"
          min={range[0]}
          max={range[1]}
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = parseInt(e.target.value, 10);
            if (!Number.isNaN(n) && n >= range[0] && n <= range[1]) onChange(n);
          }}
          onBlur={(e) => {
            const n = parseInt(e.target.value, 10);
            const next = Number.isNaN(n) ? value : clamp(n, range);
            setDraft(String(next));
            onChange(next);
          }}
        />
        {suffix && <em>{suffix}</em>}
      </div>
    </label>
  );
}

/* ================================================================
   Pet cat — walks along the top of the Focus card, talks in speech
   bubbles, changes mood with your sessions, naps while you focus,
   wakes for the last minute, plays with yarn on breaks, wears
   outfits you unlock, and celebrates when a session is finished.
================================================================ */

/* every reward unlocks by total hours of focus time studied together (`at` = hours).
   kind: outfit | coat | behavior | extra */
const REWARDS = [
  { key: "bow", kind: "outfit", label: "bow tie", emoji: "🎀", at: 1 },
  { key: "glasses", kind: "outfit", label: "glasses", emoji: "🕶️", at: 5 },
  { key: "toy", kind: "behavior", label: "toy mouse to chase on breaks", short: "toy mouse", emoji: "🐭", at: 8 },
  { key: "scarf", kind: "outfit", label: "cozy scarf", emoji: "🧣", at: 10 },
  { key: "c_black", kind: "coat", coat: "black", label: "Black coat", emoji: "🖤", at: 12 },
  { key: "c_calico", kind: "coat", coat: "calico", label: "Calico coat", emoji: "🧡", at: 15 },
  { key: "crown", kind: "outfit", head: true, label: "crown", emoji: "👑", at: 20 },
  { key: "desk", kind: "extra", label: "cozy desk & plant scene", emoji: "🪴", at: 30 },
  { key: "gradcap", kind: "outfit", head: true, label: "graduation cap", emoji: "🎓", at: 35 },
  { key: "c_tiger", kind: "coat", coat: "tiger", label: "Tiger coat", emoji: "🐅", at: 40 },
  { key: "wizard", kind: "outfit", head: true, label: "wizard hat & wand", emoji: "🧙", at: 50 },
  { key: "book", kind: "behavior", label: "naps on a book during breaks", emoji: "📖", at: 60 },
  { key: "cape", kind: "outfit", label: "hero cape", emoji: "🦸", at: 75 },
  { key: "halo", kind: "outfit", head: true, label: "golden halo", emoji: "😇", at: 100 },
  { key: "c_galaxy", kind: "coat", coat: "galaxy", label: "Galaxy coat", emoji: "🌌", at: 120 },
  { key: "aura", kind: "extra", label: "glowing aura", emoji: "✨", at: 150 },
  { key: "companion", kind: "extra", label: "kitten companion", emoji: "🐈", at: 200 },
];

const coatAt = (key) => REWARDS.find((r) => r.coat === key)?.at ?? 0;

const COATS = {
  persian: { label: "Persian", swatch: "#9ba6bd", body: "#9ba6bd", light: "#cdd4e0", ink: "#5b6478", eye: "#1b1b22", iris: "#f0932b", ear: "#e3a9b4" },
  orange: { label: "Orange", swatch: "#f4a259", body: "#f4a259", light: "#fbc98f", ink: "#7c4a1e", eye: "#1f2937", ear: "#f2a0a0" },
  gray: { label: "Gray", swatch: "#9aa5b1", body: "#9aa5b1", light: "#cfd6dd", ink: "#475569", eye: "#1f2937", ear: "#e7b6c0" },
  black: { label: "Black", swatch: "#374151", body: "#374151", light: "#4b5563", ink: "#cbd5e1", eye: "#fde68a", ear: "#9d6b7b" },
  white: { label: "White", swatch: "#f5f5f4", body: "#f5f5f4", light: "#ffffff", ink: "#94a3b8", eye: "#1f2937", ear: "#f9c4cc", line: "#d6d3d1" },
  calico: {
    label: "Calico",
    swatch: "linear-gradient(135deg, #f8f4ee 42%, #f4a259 42% 70%, #374151 70%)",
    body: "#f8f4ee", light: "#ffffff", ink: "#8b6f5a", eye: "#1f2937", ear: "#f2a0a0",
    earL: "#f4a259", earR: "#374151", tail: "#f4a259", patches: true,
  },
  tiger: { label: "Tiger", swatch: "#e8913a", body: "#e8913a", light: "#f7c98b", ink: "#5a2d0c", eye: "#1f2937", iris: "#7ccf4a", ear: "#f2a0a0", tail: "#c46a1d", stripes: true },
  galaxy: { label: "Galaxy", swatch: "linear-gradient(135deg, #1e1b4b, #6d28d9)", body: "#312e81", light: "#4f46e5", ink: "#c7d2fe", eye: "#fde68a", ear: "#a78bfa", stars: true },
};

const CAT_LINES = {
  low: [
    "Wanna study together? 📚",
    "I'm bored… start a timer?",
    "Psst… one tiny session?",
    "{name} is waiting for you 🐾",
  ],
  ok: [
    "Purr… 💕",
    "Keep going, you're doing great!",
    "Meow! 🐱",
    "Don't forget to drink water 💧",
  ],
  happy: [
    "You're on fire! 🔥",
    "Best study buddy ever 💖",
    "Purrrr… 😻",
    "{name} is so proud of you 💖",
    "Treat time? 🐟",
  ],
};
const NAP_LINES = ["Zzz… 😴", "Shh… I'm napping", "Mrrp… keep going 💪"];
const WAKE_LINES = ["Almost there! ✨", "You've got this! 💪", "Nearly done! 🎯"];
const NIGHT_LINES = ["It's getting late… 🌙", "{name} is sleepy… 😴", "Maybe get some sleep soon? 🛌"];
const DONE_LINES = ["{name} says: nice work! 🎉", "Session done! Great job 🌟", "Yay! {name} is proud of you 💖"];

/* little burst of confetti when a session is completed */
const CONFETTI = Array.from({ length: 10 }, (_, i) => ({
  ch: ["🎉", "✨", "💖", "⭐", "🎊"][i % 5],
  dx: `${(i - 4.5) * 16}px`,
  dy: `${-70 - (i % 3) * 28}px`,
  delay: `${(i % 4) * 70}ms`,
}));

const TAIL_PATH = "M22 76 C 4 80, 0 54, 14 49";
const BALL_SIZE = 26;

let catGreeted = false; // greet once per page load, not every time you revisit the Dashboard

const rand = (min, max) => min + Math.random() * (max - min);
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const isNightNow = () => {
  const h = new Date().getHours();
  return h >= 22 || h < 5;
};
/* October gets a witch hat, December a Santa hat */
const seasonalHat = () => {
  const m = new Date().getMonth();
  return m === 9 ? "witch" : m === 11 ? "santa" : null;
};

function pickLine(pool, lastRef) {
  let line = pool[Math.floor(Math.random() * pool.length)];
  for (let i = 0; i < 4 && line === lastRef.current && pool.length > 1; i += 1) {
    line = pool[Math.floor(Math.random() * pool.length)];
  }
  lastRef.current = line;
  return line;
}

function meow() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.linearRampToValueAtTime(880, t + 0.18);
    osc.frequency.exponentialRampToValueAtTime(480, t + 0.5);
    filter.type = "bandpass";
    filter.frequency.value = 1400;
    filter.Q.value = 1.2;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.6);
    setTimeout(() => ctx.close(), 900);
  } catch {
    /* audio blocked — ignore */
  }
}

function PetCat({ state, mood, paused, busy, phase, round, rounds, sessionsToday, sound, pet, event }) {
  const { walk, bubbles, outfits } = pet;
  const hours = petHours(pet);
  const name = (pet.name || "").trim() || PET_DEFAULTS.name;
  const coatKey = hours >= coatAt(pet.coat) ? pet.coat : "persian";
  const c = COATS[coatKey] || COATS.persian;
  const has = (key) => hours >= (REWARDS.find((r) => r.key === key)?.at ?? Infinity);
  const hasToy = has("toy");

  const [petted, setPetted] = useState(false);
  const [celebrating, setCelebrating] = useState(0); // 0 = no, otherwise an id that restarts the burst
  const [bubble, setBubble] = useState(null); // { text, id, ms }
  const [pos, setPos] = useState({ left: null, ms: 0 }); // px from the left of the track
  const [facing, setFacing] = useState(1); // 1 = right, -1 = left
  const [walking, setWalking] = useState(false);
  const [act, setAct] = useState(""); // "" | "stretch" | "groom" | "yawn"
  const [grumpy, setGrumpy] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [ball, setBall] = useState(null); // { x, rot } while the yarn ball is out
  const [night, setNight] = useState(isNightNow);
  const [bookNap, setBookNap] = useState(false); // napping on the book during a break (60h reward)

  const trackRef = useRef(null);
  const catRef = useRef(null);
  const lastLine = useRef("");
  const bubbleTimer = useRef(0);
  const petTimer = useRef(0);
  const celebrateTimer = useRef(0);
  const disarmTimer = useRef(0);
  const grumpyTimer = useRef(0);
  const flipTimer = useRef(0);
  const armed = useRef(false); // true while a timer session is in progress (or just ended)
  const celebratedAt = useRef(0);
  const prevState = useRef(state);
  const prevSessions = useRef(sessionsToday);
  const prevTotal = useRef(hours);
  const eventSeen = useRef(0);
  const nudgeSeen = useRef(pet.nudge?.id || 0);
  const hoursRef = useRef(hours);
  const clickCount = useRef(0);
  const lastClick = useRef(0);
  const ballRef = useRef(null);
  const rotRef = useRef(0);

  /* always-fresh values for timers/effects that must not restart on every change */
  const bubblesRef = useRef(bubbles);
  const nameRef = useRef(name);
  const nightRef = useRef(night);
  const statusRef = useRef({});
  bubblesRef.current = bubbles;
  nameRef.current = name;
  nightRef.current = night;
  hoursRef.current = hours;
  statusRef.current = { walking, petted, celebrating: !!celebrating, act, grumpy, flipping };

  const maxLeft = () => {
    const track = trackRef.current;
    const cat = catRef.current;
    return track && cat ? Math.max(0, track.clientWidth - cat.offsetWidth) : 0;
  };
  const curLeft = () => {
    const track = trackRef.current;
    const cat = catRef.current;
    return track && cat ? cat.getBoundingClientRect().left - track.getBoundingClientRect().left : 0;
  };

  const say = useCallback((text, ms = 4200) => {
    if (!bubblesRef.current) return;
    clearTimeout(bubbleTimer.current);
    setBubble({ text: text.replaceAll("{name}", nameRef.current), id: Date.now(), ms });
    bubbleTimer.current = setTimeout(() => setBubble(null), ms);
  }, []);

  const lineFor = () => {
    if (state === "focus") return pickLine(NAP_LINES, lastLine);
    if (state === "wake") return pickLine(WAKE_LINES, lastLine);
    const pool = [...CAT_LINES[mood]];
    if (night) pool.push(...NIGHT_LINES);
    if (phase === "focus" && round > 0 && round < rounds) {
      const left = rounds - round;
      pool.push(`${left} more ${left === 1 ? "session" : "sessions"} until a long break`);
    }
    if (state === "break") pool.push("Stretch those legs! 🧘");
    return pickLine(pool, lastLine);
  };

  const makeGrumpy = (ms) => {
    setGrumpy(true);
    clearTimeout(grumpyTimer.current);
    grumpyTimer.current = setTimeout(() => setGrumpy(false), ms);
  };

  /* roll the yarn ball somewhere else (the cat will chase it) */
  const kickBall = () => {
    const track = trackRef.current;
    const from = ballRef.current;
    if (!track || from == null) return;
    const maxB = Math.max(0, track.clientWidth - BALL_SIZE);
    let to = rand(0, maxB);
    if (Math.abs(to - from) < 120) to = from < maxB / 2 ? Math.min(maxB, from + 160) : Math.max(0, from - 160);
    ballRef.current = to;
    rotRef.current += (to - from) * 2;
    setBall({ x: to, rot: rotRef.current });
  };

  /* start on the right-hand side of the card */
  useLayoutEffect(() => {
    setPos({ left: maxLeft(), ms: 0 });
  }, []);

  /* keep the cat inside the card when the window is resized */
  useEffect(() => {
    const onResize = () => {
      setPos((p) => ({ left: Math.min(p.left ?? 0, maxLeft()), ms: 0 }));
      setWalking(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* night mode: after 10pm the cat wears a sleep cap and moves slowly */
  useEffect(() => {
    const id = setInterval(() => setNight(isNightNow()), 60000);
    return () => clearInterval(id);
  }, []);

  /* clear timers on unmount */
  useEffect(
    () => () => {
      clearTimeout(bubbleTimer.current);
      clearTimeout(petTimer.current);
      clearTimeout(celebrateTimer.current);
      clearTimeout(disarmTimer.current);
      clearTimeout(grumpyTimer.current);
      clearTimeout(flipTimer.current);
    },
    []
  );

  /* hide any open bubble when bubbles get switched off */
  useEffect(() => {
    if (!bubbles) {
      clearTimeout(bubbleTimer.current);
      setBubble(null);
    }
  }, [bubbles]);

  /* greet once when the page loads */
  useEffect(() => {
    const id = setTimeout(() => {
      if (catGreeted) return;
      catGreeted = true;
      const hello = sessionsToday === 0 ? "Hi! I'm {name}. Ready to study? 📚" : "Welcome back! 💕";
      say(hello, 6000);
    }, 1200);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* remember that a session is/was in progress, so a new finished session
     is told apart from sessionsToday simply loading in */
  useEffect(() => {
    clearTimeout(disarmTimer.current);
    if (busy) {
      armed.current = true;
    } else {
      disarmTimer.current = setTimeout(() => {
        armed.current = false;
      }, 6000);
    }
  }, [busy]);

  /* a session was finished -> celebrate */
  useEffect(() => {
    const prev = prevSessions.current;
    prevSessions.current = sessionsToday;
    if (sessionsToday > prev && armed.current) {
      armed.current = false;
      celebratedAt.current = Date.now();
      setCelebrating(Date.now());
      say(pickLine(DONE_LINES, lastLine), 4500);
      clearTimeout(celebrateTimer.current);
      celebrateTimer.current = setTimeout(() => setCelebrating(0), 2400);
    }
  }, [sessionsToday, say]);

  /* something new was unlocked -> announce it (the surprise moment) */
  useEffect(() => {
    const prev = prevTotal.current;
    prevTotal.current = hours;
    if (hours <= prev) return undefined;
    const fresh = REWARDS.filter((r) => prev < r.at && hours >= r.at);
    if (!fresh.length) return undefined;
    const names = fresh.map((r) => `${r.emoji} ${r.label}`).join(" + ");
    const id = setTimeout(() => say(`🎉 Unlocked: ${names}!`, 8000), 2800);
    return () => clearTimeout(id);
  }, [hours]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Settings asked the cat to say something (e.g. a locked coat was clicked) */
  useEffect(() => {
    const n = pet.nudge;
    if (!n || !n.id || n.id === nudgeSeen.current) return;
    nudgeSeen.current = n.id;
    if (Date.now() - n.id > 3000) return;
    say(n.text, 5500);
  }, [pet.nudge]); // eslint-disable-line react-hooks/exhaustive-deps

  /* react to Skip / Reset */
  useEffect(() => {
    if (!event || !event.id || event.id === eventSeen.current) return;
    eventSeen.current = event.id;
    if (Date.now() - event.id > 2000) return; // an old event from before this page was opened
    if (event.type === "skip") {
      makeGrumpy(2500);
      say("Hmph. Skipping already? 😒", 3500);
    } else if (event.type === "reset") {
      say("Starting over? Okay… 🐾", 3500);
    }
  }, [event]); // eslint-disable-line react-hooks/exhaustive-deps

  /* react to the timer starting / pausing / entering the last minute */
  useEffect(() => {
    const prev = prevState.current;
    prevState.current = state;
    if (prev === state) return;
    if (Date.now() - celebratedAt.current < 1500) return; // the celebration wins
    if (state === "focus") {
      say("Shh… focus time 🤫", 5000);
    }
    else if (state === "wake") say("Almost there! One last minute ✨", 3500);
    else if (state === "break") {
      say(phase === "long" ? "Long break — you earned it 🎉" : "Break time! Stretch & sip some water 💧");
    } else if (paused) say("Paused — I'll wait 🐾");
  }, [state, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /* chat a little now and then (never while napping) */
  useEffect(() => {
    if (state === "focus" || state === "wake") return undefined;
    const id = setInterval(() => say(lineFor(), 4200), 75000);
    return () => clearInterval(id);
  }, [state, mood, phase, round, rounds, night, say]); // eslint-disable-line react-hooks/exhaustive-deps

  /* idle behaviours: stretch, groom, yawn */
  useEffect(() => {
    if (state !== "idle" || reducedMotion()) return undefined;
    let t1;
    let t2;
    const loop = () => {
      t1 = setTimeout(
        () => {
          const s = statusRef.current;
          if (!s.walking && !s.petted && !s.celebrating && !s.act && !s.grumpy && !s.flipping) {
            const pool = nightRef.current ? ["yawn", "yawn", "stretch", "groom"] : ["stretch", "groom", "yawn"];
            setAct(pool[Math.floor(Math.random() * pool.length)]);
            t2 = setTimeout(() => setAct(""), 2600);
          }
          loop();
        },
        nightRef.current ? rand(8000, 16000) : rand(12000, 26000)
      );
    };
    loop();
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      setAct("");
    };
  }, [state]);

  /* 60h reward: on some breaks the cat naps on a book instead of playing */
  useEffect(() => {
    if (state === "break" && has("book") && Math.random() < 0.5) {
      setBookNap(true);
      say("Zzz… napping on my book 📖", 4500);
    } else {
      setBookNap(false);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the yarn ball (or toy mouse) comes out during breaks */
  useEffect(() => {
    const track = trackRef.current;
    if (state === "break" && walk && track && !bookNap) {
      const maxB = Math.max(0, track.clientWidth - BALL_SIZE);
      const x = curLeft() < maxLeft() / 2 ? maxB - rand(0, 80) : rand(0, 80);
      ballRef.current = Math.min(maxB, Math.max(0, x));
      rotRef.current = 0;
      setBall({ x: ballRef.current, rot: 0 });
    } else {
      ballRef.current = null;
      setBall(null);
    }
  }, [state, walk, bookNap]);

  /* wander along the card edge; stay put while napping or being petted;
     chase the yarn ball on breaks */
  useEffect(() => {
    if (!walk || state === "focus" || state === "wake" || petted || bookNap) {
      setPos((p) => (p.left == null ? p : { left: curLeft(), ms: 0 })); // freeze where it is
      setWalking(false);
      return undefined;
    }
    if (reducedMotion()) return undefined;

    let timer;
    const speed = () => (nightRef.current ? 0.028 : 0.045); // px per ms

    const moveTo = (to) => {
      const from = curLeft();
      const ms = Math.abs(to - from) / speed();
      if (ms < 60) return 0;
      setFacing(to > from ? 1 : -1);
      setWalking(true);
      setPos({ left: to, ms });
      return ms;
    };
    const wander = () => {
      const max = maxLeft();
      if (max < 60) return 0;
      const from = curLeft();
      let to = Math.random() * max;
      if (Math.abs(to - from) < 90) {
        to = from < max / 2 ? Math.min(max, from + 140) : Math.max(0, from - 140);
      }
      return moveTo(to);
    };
    const chase = () => {
      const bx = ballRef.current;
      if (bx == null) return wander();
      const from = curLeft();
      const to = bx > from + 50 ? bx - 60 : bx - 4; // stop with a paw next to the ball
      return moveTo(Math.min(maxLeft(), Math.max(0, to)));
    };
    const loop = () => {
      timer = setTimeout(
        () => {
          const s = statusRef.current;
          if (s.act || s.grumpy || s.flipping || s.celebrating) {
            loop();
            return;
          }
          if (state === "break") {
            const ms = chase();
            timer = setTimeout(() => {
              kickBall();
              loop();
            }, ms + 300);
          } else {
            const ms = wander();
            timer = setTimeout(loop, ms);
          }
        },
        state === "break" ? rand(500, 1200) : rand(3500, 8000)
      );
    };
    loop();
    return () => clearTimeout(timer);
  }, [state, petted, walk, bookNap]); // eslint-disable-line react-hooks/exhaustive-deps

  function pet_() {
    const now = Date.now();
    clickCount.current = now - lastClick.current > 1500 ? 1 : clickCount.current + 1;
    lastClick.current = now;
    const n = clickCount.current;
    const still = state === "focus" || state === "wake";

    /* easter eggs: poke it too much and it gets grumpy, keep going and it does a backflip */
    if (!still) {
      if (n >= 12) {
        clickCount.current = 0;
        setGrumpy(false);
        clearTimeout(grumpyTimer.current);
        setFlipping(true);
        clearTimeout(flipTimer.current);
        flipTimer.current = setTimeout(() => setFlipping(false), 1000);
        say("Ta-da! 🤸", 3000);
        return;
      }
      if (grumpy) {
        say("Hmph! 😾", 2500);
        return;
      }
      if (n === 7) {
        makeGrumpy(3500);
        say("Okay okay, that's enough! 😾", 3500);
        return;
      }
    }

    setPetted(true);
    clearTimeout(petTimer.current);
    petTimer.current = setTimeout(() => setPetted(false), 1500);
    if (sound && state !== "focus") meow();
    say(lineFor(), 3800);
  }

  /* what the cat is wearing */
  const heads = REWARDS.filter((r) => r.head && hours >= r.at);
  const autoHead = heads.length ? heads[heads.length - 1].key : null; // best hat unlocked so far
  let headItem = null;
  if (outfits) {
    if (night) headItem = "nightcap";
    else if (pet.head === "none") headItem = null;
    else if (pet.head && pet.head !== "auto" && heads.some((r) => r.key === pet.head)) headItem = pet.head;
    else headItem = seasonalHat() || autoHead;
  }
  const wearBow = outfits && has("bow");
  const wearGlasses = outfits && has("glasses");
  const wearScarf = outfits && has("scarf");
  const wearCape = outfits && has("cape");

  const cls = [
    "pet-cat",
    petted && "petted",
    walking && "walking",
    celebrating && "celebrating",
    grumpy && "grumpy",
    flipping && "flipping",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="cat-track" ref={trackRef}>
      {has("desk") && (
        <span aria-hidden="true" title="Cozy study corner" style={{ position: "absolute", left: 6, bottom: 0, fontSize: 20, pointerEvents: "none", opacity: 0.9 }}>
          🪴📚
        </span>
      )}
      {ball && (
        <button
          type="button"
          className="cat-yarn"
          style={{ left: ball.x, rotate: `${ball.rot}deg` }}
          onClick={kickBall}
          aria-label="Roll the yarn ball"
          title="Roll it!"
        >
          {hasToy ? (
            <svg viewBox="0 0 28 28" aria-hidden="true">
              <path d="M4 19 Q-1 25 6 26" fill="none" stroke="#e5a3b4" strokeWidth="1.6" strokeLinecap="round" />
              <ellipse cx="14" cy="17" rx="10" ry="7" fill="#9ca3af" />
              <circle cx="22" cy="13" r="4.2" fill="#9ca3af" />
              <circle cx="20" cy="8.6" r="3" fill="#e5a3b4" />
              <circle cx="25" cy="9.6" r="3" fill="#e5a3b4" />
              <circle cx="24.2" cy="12.4" r="1" fill="#111827" />
            </svg>
          ) : (
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <circle cx="14" cy="14" r="12" fill="#f26d8d" />
            <path d="M4 12 Q14 6 24 12 M3 17 Q14 11 25 17 M8 5 Q17 14 10 24" fill="none" stroke="#ffd1dc" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M22 21 Q27 24 25 27" fill="none" stroke="#f26d8d" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          )}
        </button>
      )}

      <div
        ref={catRef}
        className={cls}
        data-state={state}
        data-mood={mood}
        data-act={act || undefined}
        style={pos.left == null ? undefined : { left: pos.left, transitionDuration: `${pos.ms}ms` }}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && e.propertyName === "left") setWalking(false);
        }}
      >
        {bubble && (
          <div
            className="cat-bubble"
            key={bubble.id}
            aria-hidden="true"
            style={{ animationDuration: `${bubble.ms}ms` }}
          >
            {bubble.text}
          </div>
        )}

        {celebrating > 0 && (
          <div className="cat-confetti" key={celebrating} aria-hidden="true">
            {CONFETTI.map((piece, i) => (
              <span key={i} style={{ "--dx": piece.dx, "--dy": piece.dy, "--delay": piece.delay }}>
                {piece.ch}
              </span>
            ))}
          </div>
        )}

        {has("companion") && (
          <span aria-hidden="true" title="Kit, the kitten" style={{ position: "absolute", left: -24, bottom: 0, fontSize: 20, pointerEvents: "none" }}>
            🐈
          </span>
        )}
        {bookNap && (
          <span aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: -6, transform: "translateX(-50%)", fontSize: 22, pointerEvents: "none" }}>
            📖
          </span>
        )}

        <div className="cat-bob" style={{ scale: facing === -1 ? "-1 1" : "1 1" }}>
          <button
            type="button"
            className="cat-body"
            style={outfits && has("aura") ? { filter: "drop-shadow(0 0 7px rgba(251,191,36,.9))" } : undefined}
            onClick={pet_}
            aria-label={`Pet ${name}`}
            title={`Pet ${name}!`}
          >
            <svg viewBox="0 -16 120 116" aria-hidden="true">
              <defs>
                <clipPath id="cat-clip-head"><ellipse cx="94" cy="50" rx="23" ry="20" /></clipPath>
                <clipPath id="cat-clip-body"><ellipse cx="54" cy="74" rx="36" ry="16" /></clipPath>
              </defs>

              {/* tail (behind everything, curls up at the back) */}
              <g className="cat-tail">
                {c.line && <path d={TAIL_PATH} fill="none" stroke={c.line} strokeWidth="13.5" strokeLinecap="round" />}
                <path d={TAIL_PATH} fill="none" stroke={c.tail || c.body} strokeWidth="11" strokeLinecap="round" />
              </g>

              {/* far-side legs (slightly darker) */}
              <g className="cat-leg cat-leg-b">
                <rect x="26" y="80" width="8" height="19" rx="4" fill={c.body} stroke={c.line || "none"} strokeWidth="1" />
                <rect x="26" y="80" width="8" height="19" rx="4" fill="#000" opacity=".16" />
                <ellipse cx="30" cy="97.5" rx="5.4" ry="2.8" fill={c.light} />
              </g>
              <g className="cat-leg cat-leg-a">
                <rect x="66" y="80" width="8" height="19" rx="4" fill={c.body} stroke={c.line || "none"} strokeWidth="1" />
                <rect x="66" y="80" width="8" height="19" rx="4" fill="#000" opacity=".16" />
                <ellipse cx="70" cy="97.5" rx="5.4" ry="2.8" fill={c.light} />
              </g>
              {/* near-side legs */}
              <g className="cat-leg cat-leg-a">
                <rect x="38" y="80" width="9" height="19" rx="4.5" fill={c.body} stroke={c.line || "none"} strokeWidth="1" />
                <ellipse cx="42.5" cy="97.5" rx="5.8" ry="3" fill={c.light} />
              </g>
              <g className="cat-leg cat-leg-b">
                <rect x="76" y="80" width="9" height="19" rx="4.5" fill={c.body} stroke={c.line || "none"} strokeWidth="1" />
                <ellipse cx="80.5" cy="97.5" rx="5.8" ry="3" fill={c.light} />
              </g>

              {/* body in profile */}
              <ellipse cx="54" cy="74" rx="36" ry="16" fill={c.body} stroke={c.line || "none"} strokeWidth="1.2" />
              {c.patches && <ellipse cx="34" cy="70" rx="14" ry="9" fill="#374151" clipPath="url(#cat-clip-body)" />}
              {c.stripes && (
                <g clipPath="url(#cat-clip-body)" stroke={c.ink} strokeWidth="3" strokeLinecap="round" opacity=".5">
                  <line x1="30" y1="60" x2="33" y2="80" />
                  <line x1="42" y1="58" x2="45" y2="82" />
                  <line x1="54" y1="58" x2="57" y2="82" />
                  <line x1="66" y1="60" x2="68" y2="80" />
                </g>
              )}
              {c.stars && (
                <g clipPath="url(#cat-clip-body)" fill="#ffffff">
                  <circle cx="34" cy="68" r="1.5" /><circle cx="48" cy="74" r="1" /><circle cx="60" cy="66" r="1.6" />
                  <circle cx="72" cy="76" r="1" /><circle cx="42" cy="82" r="1.2" /><circle cx="66" cy="84" r="1.2" />
                </g>
              )}
              <ellipse cx="56" cy="84" rx="26" ry="6" fill={c.light} opacity=".75" />
              {/* fluffy chest ruff under the chin */}
              <ellipse cx="82" cy="70" rx="14" ry="11" fill={c.body} />

              {wearCape && (
                <path d="M70 60 Q46 54 20 70 Q30 92 62 85 Q76 76 70 60 Z" fill="#7c3aed" stroke="#5b21b6" strokeWidth="1" />
              )}
              {wearScarf && (
                <g>
                  <path d="M66 66 Q80 78 96 66 L96 73 Q80 85 66 74 Z" fill="#f97316" />
                  <rect x="70" y="74" width="7" height="15" rx="2.5" fill="#ea580c" />
                </g>
              )}
              {headItem === "wizard" && (
                <g>
                  <line x1="86" y1="96" x2="106" y2="72" stroke="#92400e" strokeWidth="2.2" strokeLinecap="round" />
                  <circle cx="107" cy="70.5" r="2.8" fill="#fde047" />
                </g>
              )}
              {wearBow && (
                <g>
                  <polygon points="80,72 69,66 69,78" fill="#ef4444" />
                  <polygon points="80,72 91,66 91,78" fill="#ef4444" />
                  <circle cx="80" cy="72" r="3.4" fill="#b91c1c" />
                </g>
              )}

              {/* head turned to face you */}
              <g className="cat-head">
                <g className="cat-ear cat-ear-l">
                  <path d="M72 42 Q70 27 83 28 Q91 29 90 35 Z" fill={c.earL || c.body} stroke={c.line || "none"} strokeWidth="1" />
                  <path d="M76 38 Q76 31 83 32 Q87 33 87 36 Z" fill={c.ear} />
                </g>
                <g className="cat-ear cat-ear-r">
                  <path d="M116 42 Q118 27 105 28 Q97 29 98 35 Z" fill={c.earR || c.body} stroke={c.line || "none"} strokeWidth="1" />
                  <path d="M112 38 Q112 31 105 32 Q101 33 101 36 Z" fill={c.ear} />
                </g>
                <ellipse cx="76" cy="58" rx="8" ry="7" fill={c.body} stroke={c.line || "none"} strokeWidth="1" />
                <ellipse cx="112" cy="58" rx="8" ry="7" fill={c.body} stroke={c.line || "none"} strokeWidth="1" />
                <ellipse cx="94" cy="50" rx="23" ry="20" fill={c.body} stroke={c.line || "none"} strokeWidth="1.2" />
                {c.patches && (
                  <g clipPath="url(#cat-clip-head)">
                    <ellipse cx="80" cy="38" rx="11" ry="8" fill="#f4a259" />
                    <ellipse cx="108" cy="58" rx="10" ry="8" fill="#374151" />
                  </g>
                )}
                {c.stripes && (
                  <g clipPath="url(#cat-clip-head)" stroke={c.ink} strokeWidth="2.4" strokeLinecap="round" opacity=".55">
                    <line x1="94" y1="31" x2="94" y2="40" />
                    <line x1="86" y1="32" x2="88" y2="39" />
                    <line x1="102" y1="32" x2="100" y2="39" />
                  </g>
                )}
                {c.stars && (
                  <g clipPath="url(#cat-clip-head)" fill="#ffffff">
                    <circle cx="82" cy="40" r="1.3" /><circle cx="106" cy="42" r="1.5" /><circle cx="96" cy="36" r="1" /><circle cx="110" cy="56" r="1" />
                  </g>
                )}
                <ellipse cx="94" cy="60" rx="11" ry="7" fill={c.light} opacity=".7" />

                <g className="cat-eyes">
                  <ellipse cx="85" cy="50" rx="5.5" ry="6" fill={c.iris || c.eye} />
                  <ellipse cx="85" cy="50.5" rx="2.6" ry="4.2" fill={c.eye} />
                  <ellipse cx="86.6" cy="47.8" rx="1.3" ry="1.5" fill="#ffffff" />
                  <ellipse cx="103" cy="50" rx="5.5" ry="6" fill={c.iris || c.eye} />
                  <ellipse cx="103" cy="50.5" rx="2.6" ry="4.2" fill={c.eye} />
                  <ellipse cx="104.6" cy="47.8" rx="1.3" ry="1.5" fill="#ffffff" />
                </g>
                {wearGlasses && (
                  <g fill="rgba(255,255,255,.18)" stroke="#1f2937" strokeWidth="2">
                    <circle cx="85" cy="50" r="7.8" />
                    <circle cx="103" cy="50" r="7.8" />
                    <line x1="92.8" y1="50" x2="95.2" y2="50" />
                  </g>
                )}
                {mood === "happy" && (
                  <g fill="#f08a8a" opacity=".55">
                    <ellipse cx="79" cy="58" rx="4.5" ry="2.8" />
                    <ellipse cx="109" cy="58" rx="4.5" ry="2.8" />
                  </g>
                )}
                <path d="M91.5 55.5 L96.5 55.5 Q96.5 58.3 94 59.5 Q91.5 58.3 91.5 55.5 Z" fill="#e58a96" />

                {grumpy || mood === "low" ? (
                  <path d="M89 66 Q94 61 99 66" fill="none" stroke={c.ink} strokeWidth="1.6" strokeLinecap="round" />
                ) : mood === "ok" ? (
                  <path d="M94 59.5 Q92 64 88.5 62.5 M94 59.5 Q96 64 99.5 62.5" fill="none" stroke={c.ink} strokeWidth="1.6" strokeLinecap="round" />
                ) : (
                  <path d="M88.5 61.5 Q94 71 99.5 61.5 Z" fill="#b3414f" stroke={c.ink} strokeWidth="1.2" strokeLinejoin="round" />
                )}
                <ellipse className="cat-yawn" cx="94" cy="65" rx="4.5" ry="5.5" fill="#b3414f" />
                <ellipse className="cat-paw" cx="80" cy="64" rx="5" ry="7" fill={c.light} stroke={c.ink} strokeWidth="1" />

                <g className="cat-brows" stroke={c.ink} strokeWidth="2.2" strokeLinecap="round">
                  <line x1="79" y1="43" x2="89" y2="46" />
                  <line x1="109" y1="43" x2="99" y2="46" />
                </g>
                <g stroke={c.ink} strokeWidth="1.1" strokeLinecap="round">
                  <line x1="77" y1="58" x2="64" y2="56" />
                  <line x1="77" y1="62" x2="64" y2="64" />
                  <line x1="111" y1="58" x2="124" y2="56" />
                  <line x1="111" y1="62" x2="124" y2="64" />
                </g>

                {headItem === "witch" && (
                  <g transform="translate(34 12) rotate(-8 60 22)">
                    <polygon points="45,22 61,-14 75,22" fill="#5b21b6" />
                    <polygon points="46.3,19 73.8,19 71.9,14 48.6,14" fill="#f59e0b" />
                    <ellipse cx="60" cy="22" rx="22" ry="5" fill="#4c1d95" />
                  </g>
                )}
                {headItem === "santa" && (
                  <g transform="translate(34 12) rotate(-6 60 22)">
                    <path d="M45 20 Q47 -6 72 -4 Q64 6 76 20 Z" fill="#dc2626" />
                    <rect x="42" y="16" width="38" height="8" rx="4" fill="#ffffff" />
                    <circle cx="72" cy="-4" r="5" fill="#ffffff" />
                  </g>
                )}
                {headItem === "crown" && (
                  <g transform="translate(34 12)">
                    <path d="M44 24 L46 8 L53 16 L60 4 L67 16 L74 8 L76 24 Z" fill="#fbbf24" stroke="#d97706" strokeWidth="1.2" strokeLinejoin="round" />
                    <circle cx="60" cy="14" r="2" fill="#ef4444" />
                    <circle cx="50" cy="19" r="1.5" fill="#3b82f6" />
                    <circle cx="70" cy="19" r="1.5" fill="#22c55e" />
                  </g>
                )}
                {headItem === "gradcap" && (
                  <g transform="translate(34 12)">
                    <rect x="50" y="20" width="20" height="8" rx="2" fill="#374151" />
                    <polygon points="38,16 60,8 82,16 60,24" fill="#1f2937" />
                    <line x1="78" y1="16" x2="78" y2="30" stroke="#fbbf24" strokeWidth="1.6" />
                    <circle cx="78" cy="31" r="2.2" fill="#fbbf24" />
                  </g>
                )}
                {headItem === "wizard" && (
                  <g transform="translate(34 12) rotate(-8 60 22)">
                    <polygon points="45,22 61,-14 75,22" fill="#1d4ed8" />
                    <ellipse cx="60" cy="22" rx="22" ry="5" fill="#1e3a8a" />
                    <circle cx="58" cy="6" r="1.8" fill="#fde047" />
                    <circle cx="65" cy="13" r="1.4" fill="#fde047" />
                    <circle cx="56" cy="15" r="1.2" fill="#fde047" />
                  </g>
                )}
                {headItem === "halo" && (
                  <ellipse cx="94" cy="21" rx="13" ry="3.8" fill="none" stroke="#fde047" strokeWidth="2.6" />
                )}
                {headItem === "nightcap" && (
                  <g transform="translate(34 12)">
                    <path d="M42 24 Q50 -4 74 8 Q90 16 88 34 Q74 18 42 24 Z" fill="#6366f1" />
                    <rect x="40" y="20" width="30" height="7" rx="3.5" fill="#e0e7ff" transform="rotate(-8 55 23)" />
                    <circle cx="88" cy="34" r="5" fill="#ffffff" />
                  </g>
                )}
              </g>

              <text className="cat-zzz" x="104" y="24" fontSize="14" fill="#8b93a7">Zzz</text>
              <text className="cat-heart" x="88" y="22" fontSize="16" fill="#ef5b7b">♥</text>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PomodoroTimer({ pomodoro: p, subjects = [], sessionsToday = 0 }) {
  const { settings, phase, remaining, running, round, locked } = p;
  const paused = locked && !running;

  /* study groups this timer can be attached to */
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    listMyGroups()
      .then((list) => {
        setGroups(list);
        // first time only: attach to the first group so the group sees you studying
        let saved = null;
        try { saved = localStorage.getItem(POMODORO_GROUP_KEY); } catch { /* ignore */ }
        if (saved === null && list.length) p.setGroupId(list[0].id);
        // the saved group was left/deleted
        else if (saved && !list.some((g) => g.id === saved)) p.setGroupId("");
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* pet cat: saved preferences + progress */
  const [pet, setPet] = useState(loadPet);
  useEffect(() => {
    const sync = () => setPet(loadPet());
    window.addEventListener(PET_EVENT, sync);
    return () => window.removeEventListener(PET_EVENT, sync);
  }, []);
  const changePet = (patch) => setPet(updatePetStore(patch));
  const petName = (pet.name || "").trim() || PET_DEFAULTS.name;
  const petHrs = petHours(pet);
  const petProgress = `${petName} has studied with you for ${fmtHours(petHrs)}`;
  const heads = REWARDS.filter((r) => r.head && petHrs >= r.at); // locked hats stay secret

  /* the cat naps while you focus, but wakes for the last minute */
  const nearEnd = running && phase === "focus" && remaining > 0 && remaining <= 60 && p.total > 120;
  const catState = running ? (phase === "focus" ? (nearEnd ? "wake" : "focus") : "break") : "idle";
  /* the cat's mood follows how many focus sessions you finished today */
  const catMood = sessionsToday >= 3 ? "happy" : sessionsToday >= 1 ? "ok" : "low";

  return (
    <section className="focus-card pomo" data-phase={phase}>
      {pet.show && (
        <PetCat
          state={catState}
          mood={catMood}
          paused={paused}
          busy={locked}
          phase={phase}
          round={round}
          rounds={settings.rounds}
          sessionsToday={sessionsToday}
          sound={settings.sound}
          pet={pet}
          event={p.petEvent}
        />
      )}

      <header className="focus-header">
        <div>
          <h2>Focus mode</h2>
          <p>{PHASES[phase].hint}</p>
        </div>
        <span className="pomo-today">
          {sessionsToday} {sessionsToday === 1 ? "session" : "sessions"} today
        </span>
      </header>

      <div className="pomo-tabs" role="tablist" aria-label="Timer mode">
        {Object.entries(PHASES).map(([key, ph]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={phase === key}
            className={phase === key ? "pomo-tab active" : "pomo-tab"}
            onClick={() => p.goTo(key, false)}
          >
            {ph.label}
          </button>
        ))}
      </div>

      <div className="pomo-ring" style={{ "--value": p.progress }}>
        <div className="pomo-ring-inner">
          <div className="pomo-time" role="timer" aria-label={`${fmt(remaining)} remaining`}>
            {fmt(remaining)}
          </div>
          <div className="pomo-state">
            {running ? PHASES[phase].label : paused ? "Paused" : "Ready"}
          </div>
        </div>
      </div>

      <div className="pomo-dots" aria-label={`${round} of ${settings.rounds} focus sessions done`}>
        {Array.from({ length: settings.rounds }, (_, i) => (
          <span key={i} className={i < round ? "pomo-dot done" : "pomo-dot"} />
        ))}
        <small>
          {round}/{settings.rounds} until long break
        </small>
      </div>

      <div className="pomo-selects">
      {phase === "focus" && (
        <div className="focus-subject">
          <select
            value={p.subject}
            onChange={(e) => p.setSubject(e.target.value)}
            disabled={running}
            aria-label="Subject"
          >
            <option value="">General Study</option>
            {subjects.map((s) => (
              <option key={s.id ?? s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {groups.length > 0 && (
        <div className="focus-subject">
          <select
            value={p.groupId}
            onChange={(e) => p.setGroupId(e.target.value)}
            disabled={locked}
            aria-label="Study with group"
            title={locked ? "Reset the timer to change group" : "Your status shows in all your groups; study time is counted for this one"}
          >
            <option value="">Just me</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                👥 {g.name}
              </option>
            ))}
          </select>
        </div>
      )}
      </div>

      <div className="focus-controls">
        {running ? (
          <button type="button" className="primary-button" onClick={p.pause}>
            ⏸ Pause
          </button>
        ) : (
          <button type="button" className="primary-button" onClick={p.start}>
            ▶ {paused ? "Resume" : "Start"}
          </button>
        )}

        {phase === "focus" && (
          <button
            type="button"
            className="secondary-button"
            onClick={p.finishEarly}
            disabled={p.elapsed < 60}
            title="Log the time studied so far (needs at least 1 minute)"
          >
            ✓ Finish
          </button>
        )}

        <button type="button" className="secondary-button" onClick={p.reset} disabled={!locked}>
          ↻ Reset
        </button>
        <button type="button" className="secondary-button" onClick={p.skip}>
          ⏭ Skip
        </button>
      </div>

      <details className="pomo-settings">
        <summary>Timer settings</summary>

        <div className="pomo-presets" role="group" aria-label="Presets">
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              disabled={locked}
              className={p.activePreset === key ? "pomo-chip active" : "pomo-chip"}
              onClick={() => p.applyPreset(key)}
            >
              {preset.label}
              <small>
                {preset.focus}/{preset.short}
              </small>
            </button>
          ))}
          <span className={p.activePreset === "custom" ? "pomo-chip active static" : "pomo-chip static"}>
            Custom
          </span>
        </div>

        <div className="pomo-grid">
          <NumberField label="Focus" suffix="min" range={LIMITS.focus} value={settings.focus} disabled={locked} onChange={p.update("focus")} />
          <NumberField label="Short break" suffix="min" range={LIMITS.short} value={settings.short} disabled={locked} onChange={p.update("short")} />
          <NumberField label="Long break" suffix="min" range={LIMITS.long} value={settings.long} disabled={locked} onChange={p.update("long")} />
          <NumberField label="Sessions per cycle" range={LIMITS.rounds} value={settings.rounds} disabled={locked} onChange={p.update("rounds")} />
        </div>

        <div className="pomo-toggles">
          <label className="pomo-toggle">
            <input
              type="checkbox"
              checked={settings.autoStart}
              onChange={(e) => p.update("autoStart")(e.target.checked)}
            />
            <span>Start the next timer automatically</span>
          </label>
          <label className="pomo-toggle">
            <input
              type="checkbox"
              checked={settings.sound}
              onChange={(e) => p.update("sound")(e.target.checked)}
            />
            <span>Play a sound when a timer ends</span>
          </label>
        </div>

        {locked && <p className="pomo-note">Reset the timer to change durations.</p>}

        <div className="pomo-pet">
          <h3>Pet cat</h3>

          <div className="pomo-toggles">
            <label className="pomo-toggle">
              <input type="checkbox" checked={pet.show} onChange={(e) => changePet({ show: e.target.checked })} />
              <span>Show the cat</span>
            </label>
            <label className="pomo-toggle">
              <input type="checkbox" checked={pet.walk} onChange={(e) => changePet({ walk: e.target.checked })} />
              <span>Let it walk around (and play with yarn on breaks)</span>
            </label>
            <label className="pomo-toggle">
              <input type="checkbox" checked={pet.bubbles} onChange={(e) => changePet({ bubbles: e.target.checked })} />
              <span>Speech bubbles</span>
            </label>
            <label className="pomo-toggle">
              <input type="checkbox" checked={pet.outfits} onChange={(e) => changePet({ outfits: e.target.checked })} />
              <span>Hats &amp; accessories</span>
            </label>
          </div>

          <div className="pomo-pet-row">
            <label className="pomo-field">
              <span>Name</span>
              <div className="pomo-field-input">
                <input
                  type="text"
                  maxLength={14}
                  value={pet.name}
                  placeholder={PET_DEFAULTS.name}
                  onChange={(e) => changePet({ name: e.target.value })}
                />
              </div>
            </label>

            <div className="pomo-field">
              <span>Coat</span>
              <div className="pomo-coats" role="group" aria-label="Coat colour">
                {Object.entries(COATS)
                  .filter(([key]) => petHrs >= coatAt(key)) // locked coats stay secret
                  .map(([key, coat]) => (
                    <button
                      key={key}
                      type="button"
                      className={pet.coat === key ? "pomo-coat active" : "pomo-coat"}
                      style={{ "--coat": coat.swatch }}
                      aria-label={coat.label}
                      aria-pressed={pet.coat === key}
                      title={coat.label}
                      onClick={() => changePet({ coat: key })}
                    />
                  ))}
              </div>
            </div>
          </div>

          <label className="pomo-field">
            <span>Hat</span>
            <div className="pomo-field-input">
              <select value={pet.head || "auto"} onChange={(e) => changePet({ head: e.target.value })}>
                <option value="auto">Auto (best unlocked)</option>
                <option value="none">No hat</option>
                {heads.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.emoji} {r.label}
                  </option>
                ))}
              </select>
            </div>
          </label>

          <p className="pomo-note">{petProgress}</p>
        </div>
      </details>
    </section>
  );
}
