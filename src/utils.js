// Small shared helpers for StudyTrack.
import liquidGlassCss from "./liquid-glass.css?inline";

// Liquid glass theme: liquid-glass.css is loaded as text and added to / removed
// from <head> on demand. It goes first in <head> so it keeps the same low
// priority it had when index.css imported it.
const GLASS_STYLE_ID = "studytrack-liquid-glass";

export function applyLiquidGlass(enabled) {
  document.documentElement.dataset.studytrackGlass = enabled ? "on" : "off";
  const existing = document.getElementById(GLASS_STYLE_ID);

  if (enabled && !existing) {
    const style = document.createElement("style");
    style.id = GLASS_STYLE_ID;
    style.textContent = liquidGlassCss;
    document.head.prepend(style);
  } else if (!enabled && existing) {
    existing.remove();
  }
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatStudyTime(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}
