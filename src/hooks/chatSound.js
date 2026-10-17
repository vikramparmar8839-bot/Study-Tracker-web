/* ---- on/off setting (remembered in this browser) ---- */
const SOUND_KEY = 'studytrack-chat-sound';

export const loadChatSound = () => {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
};
export const saveChatSound = (on) => {
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* storage unavailable */ }
};

/* ---- a soft two-note "ping" made with the Web Audio API (no sound file needed) ---- */
let lastPing = 0;

export function playChatPing() {
  const now = Date.now();
  if (now - lastPing < 1500) return;       // never spam if several messages arrive together
  lastPing = now;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    ctx.resume?.();
    [[660, 0], [880, 0.12]].forEach(([freq, t]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.22);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.25);
    });
    setTimeout(() => ctx.close(), 900);
  } catch {
    /* audio blocked by the browser - ignore */
  }
}
