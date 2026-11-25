// Shared constants for StudyTrack.

export const DEFAULT_SUBJECTS = [
  { id: 1, name: "Mathematics", present: 17, absent: 7, benchmark: 75 },
  { id: 2, name: "Physics", present: 23, absent: 5, benchmark: 80 },
  { id: 3, name: "C++ Programming", present: 17, absent: 8, benchmark: 50 },
];

export const DEFAULT_SETTINGS = {
  studentName: "",
  defaultBenchmark: 75,
  warningThreshold: 75,
  dailyStudyGoal: 180,
  theme: "dark",
  accent: "indigo",
  liquidGlass: true,
};

// Accent presets. The actual colors live in index.css
// (:root[data-studytrack-accent="..."]); "swatch" is only for the picker dots.
export const ACCENT_OPTIONS = [
  { id: "indigo", label: "Indigo", swatch: "#6366f1" },
  { id: "violet", label: "Violet", swatch: "#8b5cf6" },
  { id: "rose", label: "Rose", swatch: "#f43f5e" },
  { id: "emerald", label: "Emerald", swatch: "#10b981" },
  { id: "orange", label: "Orange", swatch: "#f97316" },
  { id: "cyan", label: "Cyan", swatch: "#06b6d4" },
];
