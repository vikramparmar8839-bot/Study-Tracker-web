// Shared timer-finished sound for BOTH the Pomodoro timer and the study-group timer.
// One AudioContext is reused and "unlocked" on a button click, so the browser
// allows the sound later when the countdown ends.

let ctx = null;

function getCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx) ctx = new Ctx();
  return ctx;
}

/** Call this inside a click handler (e.g. when Start is pressed). */
export function unlockAlarm() {
  try {
    const c = getCtx();
    if (c && c.state === 'suspended') c.resume();
  } catch { /* ignore */ }
}

const ALARM_SECONDS = 6; // how long the alarm rings (change to 5-7 as you like)

/** Play the "time is up" sound: a double-beep that repeats for ALARM_SECONDS. */
export async function playAlarm(seconds = ALARM_SECONDS) {
  try {
    const c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') await c.resume();
    const offsets = [];
    for (let o = 0; o < seconds; o += 1) offsets.push(o, o + 0.3); // two beeps per second
    offsets.forEach((offset) => {
      const t = c.currentTime + offset;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } catch { /* audio blocked - ignore */ }
}
