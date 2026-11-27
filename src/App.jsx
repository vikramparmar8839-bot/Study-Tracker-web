import { useEffect, useMemo, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { usePomodoro, POMODORO_STORAGE_KEY } from "./PomodoroTimer";
import "./index.css";
import "./mobile-layout.css";
import { useAuth } from "./context/AuthContext";
import Leaderboard from "./pages/Leaderboard";
import Friends from "./pages/Friends";
import Groups from "./pages/Groups";
import { useChatNotifications } from "./hooks/useChatNotifications";
import { useLastSeenHeartbeat } from "./hooks/useLastSeen";
import { NudgeHost } from "./pages/Nudge";
import { syncPush, unlinkPush } from "./lib/push";
import Dashboard from "./pages/Dashboard";
import Statistics from "./pages/Statistics";
import Settings from "./pages/Settings";
import Timetable from "./pages/Timetable";
import Syllabus from "./pages/Syllabus";
import Attendance from "./pages/Attendance";
import useTodos, { TODOS_STORAGE_KEY } from "./hooks/useTodos";
import { DEFAULT_SUBJECTS, DEFAULT_SETTINGS, ACCENT_OPTIONS } from "./constants";
import { applyLiquidGlass, getLocalDateKey } from "./utils";
import {
  parseSyllabus,
  extractPdfText as extractSyllabusText,
  normalizeSyllabus,
  getAllSubjects,
} from "./syllabusParser";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// Apply the saved choice right away so the page doesn't flash without glass
try {
  const savedSettings = JSON.parse(
    localStorage.getItem("studytrack-settings") || "{}"
  );
  applyLiquidGlass(savedSettings.liquidGlass !== false);
} catch {
  applyLiquidGlass(true);
}

function App() {
  const { user, profile, signOut, updateProfile } = useAuth();
  const chatNotify = useChatNotifications();
  useLastSeenHeartbeat(); // keeps "online" status fresh on every page, not just Groups

  // Re-link this device's push subscription to whoever is signed in: on load, on sign-in
  // and whenever the app returns to the foreground. No permission prompt, no button needed.
  useEffect(() => {
    if (!user?.id) return undefined;
    const run = () => { syncPush(user.id); };
    run();
    const onVisible = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user?.id]);

  // stop this device getting the old account's pushes, then sign out
  async function handleSignOut() {
    try { await unlinkPush(); } catch { /* signing out matters more */ }
    signOut();
  }
  const [page, setPage] = useState("dashboard");
  const [moreOpen, setMoreOpen] = useState(false);

  const [subjects, setSubjects] = useState(() => {
    try {
      const saved = localStorage.getItem("studytrack-subjects");
      return saved ? JSON.parse(saved) : DEFAULT_SUBJECTS;
    } catch {
      return DEFAULT_SUBJECTS;
    }
  });

  const [syllabus, setSyllabus] = useState(() => {
    try {
      const saved = localStorage.getItem("studytrack-full-syllabus");
      return saved ? normalizeSyllabus(JSON.parse(saved)) : null;
    } catch {
      return null;
    }
  });

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBenchmark, setNewBenchmark] = useState(75);
  const [selectedSyllabusSubject, setSelectedSyllabusSubject] = useState(null);
  const [expandedUnits, setExpandedUnits] = useState({});
  const [newTopic, setNewTopic] = useState("");
  const [uploadingPdf, setUploadingPdf] = useState(false);

  const DAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const [timetable, setTimetable] = useState(() => {
    try {
      const saved = localStorage.getItem("studytrack-timetable");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [showTimetableForm, setShowTimetableForm] = useState(false);
  const [editingTimetableId, setEditingTimetableId] = useState(null);
  const [timetableForm, setTimetableForm] = useState({
    day: "Monday",
    subject: "",
    startTime: "09:00",
    endTime: "10:00",
    room: "",
    teacher: "",
  });

  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem("studytrack-settings");
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [importingBackup, setImportingBackup] = useState(false);

  // =========================================================
  // PRODUCTIVITY / FOCUS
  // =========================================================

  const [studySessions, setStudySessions] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("studytrack-sessions") || "[]");
    } catch {
      return [];
    }
  });

  const todosApi = useTodos();
  const { todos, setTodos } = todosApi;

  // Called by the Pomodoro timer whenever a focus session ends
  function logFocusSession({ subject, minutes }) {
    setStudySessions((sessions) => [
      ...sessions,
      {
        id: Date.now(),
        date: getLocalDateKey(),
        subject: subject || "General Study",
        duration: minutes,
        type: "focus",
      },
    ]);
  }

  // Lives in App so the timer keeps running while you change pages
  const pomodoro = usePomodoro({
    subjects,
    onSessionComplete: logFocusSession,
  });

  useEffect(() => {
    localStorage.setItem("studytrack-subjects", JSON.stringify(subjects));
  }, [subjects]);

  useEffect(() => {
    localStorage.setItem("studytrack-full-syllabus", JSON.stringify(syllabus));
  }, [syllabus]);

  useEffect(() => {
    localStorage.setItem("studytrack-timetable", JSON.stringify(timetable));
  }, [timetable]);

  useEffect(() => {
    localStorage.setItem("studytrack-settings", JSON.stringify(settings));
    document.documentElement.dataset.studytrackTheme = settings.theme;
    applyLiquidGlass(settings.liquidGlass !== false);
    document.documentElement.dataset.studytrackAccent = ACCENT_OPTIONS.some(
      (option) => option.id === settings.accent
    )
      ? settings.accent
      : "indigo";
  }, [settings]);

  useEffect(() => {
    localStorage.setItem("studytrack-sessions", JSON.stringify(studySessions));
  }, [studySessions]);

  // =========================================================
  // ATTENDANCE
  // =========================================================

  function addSubject() {
    const name = newName.trim();
    if (!name) return;

    const newSubject = {
      id: Date.now(),
      name,
      present: 0,
      absent: 0,
      benchmark: Number(newBenchmark),
    };

    setSubjects((prev) => [...prev, newSubject]);
    setNewName("");
    setNewBenchmark(Number(settings.defaultBenchmark) || 75);
    setShowAdd(false);
  }

  function markAttendance(id, type) {
    setSubjects((prev) =>
      prev.map((subject) => {
        if (subject.id !== id) return subject;
        return {
          ...subject,
          present: type === "present" ? subject.present + 1 : subject.present,
          absent: type === "absent" ? subject.absent + 1 : subject.absent,
        };
      })
    );
  }

  function updateBenchmark(id, value) {
    setSubjects((prev) =>
      prev.map((subject) =>
        subject.id === id
          ? {
              ...subject,
              benchmark: Math.min(100, Math.max(0, Number(value))),
            }
          : subject
      )
    );
  }

  function deleteSubject(id) {
    const subject = subjects.find((item) => item.id === id);
    setSubjects((prev) => prev.filter((subject) => subject.id !== id));

    if (subject) {
      setStudySessions((prev) =>
        prev.map((session) =>
          session.subject === subject.name
            ? { ...session, subject: "General Study" }
            : session
        )
      );
    }
  }

  function getPercentage(subject) {
    const total = subject.present + subject.absent;
    if (total === 0) return 0;
    return Math.round((subject.present / total) * 100);
  }

  function getClassesNeeded(subject) {
    const percentage = getPercentage(subject);
    if (percentage >= subject.benchmark) return 0;
    if (subject.benchmark >= 100) return Infinity;

    const P = subject.present;
    const T = subject.present + subject.absent;
    const B = subject.benchmark / 100;
    return Math.ceil((B * T - P) / (1 - B));
  }

  function getClassesCanMiss(subject) {
    const percentage = getPercentage(subject);
    if (percentage < subject.benchmark) return 0;
    if (subject.benchmark <= 0) return Infinity;

    const P = subject.present;
    const T = subject.present + subject.absent;
    const B = subject.benchmark / 100;
    return Math.floor(P / B - T);
  }

  function overallAttendance() {
    let present = 0;
    let total = 0;

    subjects.forEach((subject) => {
      present += subject.present;
      total += subject.present + subject.absent;
    });

    if (total === 0) return 0;
    return Math.round((present / total) * 100);
  }

  // =========================================================
  // PDF SYLLABUS IMPORT
  // =========================================================

  async function extractPdfText(file) {
    try {
      return await extractSyllabusText(pdfjsLib, file);
    } catch (error) {
      console.error("PDFJS ERROR:", error);
      throw new Error(
        error?.message || "The PDF could not be opened by the PDF reader."
      );
    }
  }

  async function handleWholePdfUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      alert("Please select a PDF file.");
      return;
    }

    setUploadingPdf(true);

    try {
      const text = await extractPdfText(file);
      const { syllabus: parsed, warnings } = parseSyllabus(text);
      console.log("Syllabus text sample:", text.slice(0, 1500));
      const allSubjects = getAllSubjects(parsed);
      const totalSubjects = allSubjects.length;
      const totalUnits = allSubjects.reduce(
        (total, subject) => total + subject.units.length,
        0
      );

      if (totalSubjects === 0) {
        alert(
          "No syllabus subjects were detected. The PDF may be a scanned image or may not use Unit/Module headings."
        );
        setUploadingPdf(false);
        event.target.value = "";
        return;
      }

      const replace = window.confirm(
        `Detected ${totalSubjects} subjects and ${totalUnits} units.` +
          (warnings.length
            ? `\n\nWarnings:\n- ${warnings.join("\n- ")}`
            : "") +
          `\n\nPress OK to import the syllabus.\nYour current imported syllabus will be replaced.`
      );

      if (replace) {
        setSyllabus(parsed);
        setSelectedSyllabusSubject(null);
        setExpandedUnits({});
        alert(
          `Syllabus imported successfully!\n\n${totalSubjects} subjects\n${totalUnits} units`
        );
      }
    } catch (error) {
      console.error("PDF IMPORT ERROR:", error);
      alert(`Could not read the PDF.\n\n${error?.message || String(error)}`);
    }

    setUploadingPdf(false);
    event.target.value = "";
  }

  // =========================================================
  // TIMETABLE
  // =========================================================

  function resetTimetableForm() {
    setTimetableForm({
      day: "Monday",
      subject: subjects[0]?.name || "",
      startTime: "09:00",
      endTime: "10:00",
      room: "",
      teacher: "",
    });
    setEditingTimetableId(null);
  }

  function openTimetableForm(entry = null) {
    if (entry) {
      setEditingTimetableId(entry.id);
      setTimetableForm({
        day: entry.day,
        subject: entry.subject,
        startTime: entry.startTime,
        endTime: entry.endTime,
        room: entry.room || "",
        teacher: entry.teacher || "",
      });
    } else {
      resetTimetableForm();
    }
    setShowTimetableForm(true);
  }

  function saveTimetableEntry() {
    const subject = timetableForm.subject.trim();

    if (!subject || !timetableForm.startTime || !timetableForm.endTime) {
      alert("Please select a subject and enter the class time.");
      return;
    }

    if (timetableForm.startTime >= timetableForm.endTime) {
      alert("End time must be later than start time.");
      return;
    }

    const entry = {
      ...timetableForm,
      subject,
      id: editingTimetableId || Date.now(),
    };

    setTimetable((prev) =>
      editingTimetableId
        ? prev.map((item) => (item.id === editingTimetableId ? entry : item))
        : [...prev, entry]
    );

    setShowTimetableForm(false);
    resetTimetableForm();
  }

  function deleteTimetableEntry(id) {
    setTimetable((prev) => prev.filter((entry) => entry.id !== id));
  }

  function getDayEntries(day) {
    return timetable
      .filter((entry) => entry.day === day)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  // =========================================================
  // SYLLABUS PROGRESS
  // =========================================================

  function getSubjectProgress(subject) {
    const topics = subject.units.flatMap((unit) => unit.topics);
    if (topics.length === 0) return 0;
    const completed = topics.filter((topic) => topic.completed).length;
    return Math.round((completed / topics.length) * 100);
  }

  function getOverallSyllabusProgress() {
    if (!syllabus) return 0;

    const allSubjects = getAllSubjects(syllabus);

    const topics = allSubjects.flatMap((subject) =>
      subject.units.flatMap((unit) => unit.topics)
    );

    if (topics.length === 0) return 0;

    const completed = topics.filter((topic) => topic.completed).length;
    return Math.round((completed / topics.length) * 100);
  }

  function updateSubjectInSyllabus(subjectId, updater) {
    setSyllabus((prev) => {
      if (!prev) return prev;

      const updateSemester = (list) =>
        list.map((subject) =>
          subject.id === subjectId ? updater(subject) : subject
        );

      return {
        groups: (prev.groups || []).map((group) => ({
          ...group,
          subjects: updateSemester(group.subjects || []),
        })),
      };
    });
  }

  function toggleTopic(subjectId, unitId, topicId) {
    updateSubjectInSyllabus(subjectId, (subject) => ({
      ...subject,
      units: subject.units.map((unit) =>
        unit.id !== unitId
          ? unit
          : {
              ...unit,
              topics: unit.topics.map((topic) =>
                topic.id === topicId
                  ? { ...topic, completed: !topic.completed }
                  : topic
              ),
            }
      ),
    }));
  }

  function toggleUnit(unitId) {
    setExpandedUnits((prev) => ({
      ...prev,
      [unitId]: !prev[unitId],
    }));
  }

  function addManualTopic(subjectId, unitId) {
    const name = newTopic.trim();
    if (!name) return;

    updateSubjectInSyllabus(subjectId, (subject) => ({
      ...subject,
      units: subject.units.map((unit) =>
        unit.id !== unitId
          ? unit
          : {
              ...unit,
              topics: [
                ...unit.topics,
                {
                  id: `${Date.now()}-${Math.random()}`,
                  name,
                  completed: false,
                },
              ],
            }
      ),
    }));

    setNewTopic("");
  }

  // =========================================================
  // PRODUCTIVITY HELPERS
  // =========================================================

  const todayKey = getLocalDateKey();

  const todayStudyMinutes = useMemo(
    () =>
      studySessions
        .filter((session) => session.date === todayKey)
        .reduce((total, session) => total + Number(session.duration || 0), 0),
    [studySessions, todayKey]
  );

  const sessionsToday = useMemo(
    () =>
      studySessions.filter(
        (session) => session.date === todayKey && session.type === "focus"
      ).length,
    [studySessions, todayKey]
  );

  const totalStudyMinutes = useMemo(
    () =>
      studySessions.reduce(
        (total, session) => total + Number(session.duration || 0),
        0
      ),
    [studySessions]
  );

  const weeklyStudyMinutes = useMemo(() => {
    // Start of the day 6 days ago, so "last 7 days" includes whole days
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - 6);

    return studySessions
      .filter((session) => {
        const sessionDate = new Date(`${session.date}T12:00:00`);
        return sessionDate >= weekStart;
      })
      .reduce((total, session) => total + Number(session.duration || 0), 0);
  }, [studySessions]);

  const studyStreak = useMemo(() => {
    const dates = new Set(studySessions.map((session) => session.date));
    let streak = 0;
    const current = new Date();

    // Haven't studied yet today? The streak is still alive from yesterday.
    if (!dates.has(getLocalDateKey(current))) {
      current.setDate(current.getDate() - 1);
    }

    while (dates.has(getLocalDateKey(current))) {
      streak++;
      current.setDate(current.getDate() - 1);
    }

    return streak;
  }, [studySessions]);

// Weekly chart: Monday-Sunday of the current week, minutes studied per day
  const weeklyChart = useMemo(() => {
    const goalMinutes = Math.max(
      1,
      Number(settings.dailyStudyGoal) || 180
    );

    const minutesByDate = {};
    studySessions.forEach((session) => {
      minutesByDate[session.date] =
        (minutesByDate[session.date] || 0) + Number(session.duration || 0);
    });

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const todayKey = getLocalDateKey(today);

    // Monday of the current week
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const key = getLocalDateKey(date);
      const minutes = minutesByDate[key] || 0;

      // Level is relative to the daily goal, so level 4 = goal reached
      let level = 0;
      if (minutes > 0) {
        const ratio = minutes / goalMinutes;
        level = ratio >= 1 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : 1;
      }

      days.push({
        key,
        minutes,
        level,
        isToday: key === todayKey,
        isFuture: date > today,
        label: date.toLocaleDateString(undefined, { weekday: "short" }),
        fullLabel: date.toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
      });
    }

    // Scale bars to the goal (or the best day, if higher) so they stay readable
    const scaleMax = Math.max(goalMinutes, ...days.map((day) => day.minutes));

    return {
      days: days.map((day) => ({
        ...day,
        height: day.minutes ? Math.max(6, (day.minutes / scaleMax) * 100) : 0,
      })),
      goalLine: (goalMinutes / scaleMax) * 100,
      activeDays: days.filter((day) => day.minutes > 0).length,
    };
  }, [studySessions, settings.dailyStudyGoal]);


  const subjectStudyTotals = useMemo(
    () =>
      subjects.map((subject) => ({
        name: subject.name,
        minutes: studySessions
          .filter((session) => session.subject === subject.name)
          .reduce(
            (total, session) => total + Number(session.duration || 0),
            0
          ),
      })),
    [subjects, studySessions]
  );

  const maxSubjectStudyMinutes = Math.max(
    ...subjectStudyTotals.map((item) => item.minutes),
    1
  );

  // Same rolling "last 7 days" window as weeklyStudyMinutes, split by subject
  const weeklySubjectStudyTotals = useMemo(() => {
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - 6);

    const weekSessions = studySessions.filter((session) => {
      const sessionDate = new Date(`${session.date}T12:00:00`);
      return sessionDate >= weekStart;
    });

    return subjects.map((subject) => ({
      name: subject.name,
      minutes: weekSessions
        .filter((session) => session.subject === subject.name)
        .reduce((total, session) => total + Number(session.duration || 0), 0),
    }));
  }, [subjects, studySessions]);

  const maxWeeklySubjectStudyMinutes = Math.max(
    ...weeklySubjectStudyTotals.map((item) => item.minutes),
    1
  );

  function clearStudyHistory() {
    if (!studySessions.length) return;

    const confirmed = window.confirm(
      "Clear all recorded study sessions? This cannot be undone."
    );

    if (confirmed) {
      setStudySessions([]);
    }
  }

  function renderSemesterSubjects(list) {
    return (
      <div className="syllabus-subject-grid">
        {(list || []).map((subject) => (
          <button
            key={subject.id}
            className={`syllabus-subject-card ${
              selectedSyllabusSubject === subject.id ? "selected" : ""
            }`}
            onClick={() => setSelectedSyllabusSubject(subject.id)}
          >
            <strong>{subject.name}</strong>
            <span>{getSubjectProgress(subject)}%</span>
            <div className="small-progress">
              <div style={{ width: `${getSubjectProgress(subject)}%` }} />
            </div>
          </button>
        ))}
      </div>
    );
  }

  // =========================================================
  // SETTINGS / BACKUP
  // =========================================================

  function updateSetting(key, value) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function exportBackup() {
    const backup = {
      app: "StudyTrack",
      version: 2,
      exportedAt: new Date().toISOString(),
      subjects,
      syllabus,
      timetable,
      settings,
      studySessions,
      todos,
      pomodoro: pomodoro.settings,
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `studytrack-backup-${getLocalDateKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleBackupImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportingBackup(true);

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const backup = JSON.parse(reader.result);

        if (backup.app !== "StudyTrack" || !Array.isArray(backup.subjects)) {
          throw new Error("This is not a valid StudyTrack backup.");
        }

        const replace = window.confirm(
          "Import this backup? Your current StudyTrack data will be replaced."
        );

        if (!replace) return;

        setSubjects(backup.subjects);
        setSyllabus(normalizeSyllabus(backup.syllabus));
        setTimetable(Array.isArray(backup.timetable) ? backup.timetable : []);
        setSettings({
          ...DEFAULT_SETTINGS,
          ...(backup.settings || {}),
        });
        setStudySessions(
          Array.isArray(backup.studySessions) ? backup.studySessions : []
        );
        setTodos(Array.isArray(backup.todos) ? backup.todos : []);
        pomodoro.applySettings(backup.pomodoro);
        setPage("dashboard");

        alert("Backup imported successfully!");
      } catch (error) {
        alert(`Could not import backup.\n\n${error.message || String(error)}`);
      } finally {
        setImportingBackup(false);
        event.target.value = "";
      }
    };

    reader.readAsText(file);
  }

  function resetAllData() {
    const confirmed = window.confirm(
      "Reset StudyTrack? This will permanently remove your attendance, syllabus, timetable, study history and settings from this browser."
    );

    if (!confirmed) return;

    setSubjects(DEFAULT_SUBJECTS);
    setSyllabus(null);
    setTimetable([]);
    setSettings(DEFAULT_SETTINGS);
    setStudySessions([]);
    setTodos([]);
    setNewBenchmark(75);
    pomodoro.resetAll();
    setPage("dashboard");

    localStorage.removeItem("studytrack-subjects");
    localStorage.removeItem("studytrack-full-syllabus");
    localStorage.removeItem("studytrack-timetable");
    localStorage.removeItem("studytrack-settings");
    localStorage.removeItem("studytrack-sessions");
    localStorage.removeItem(TODOS_STORAGE_KEY);
    localStorage.removeItem(POMODORO_STORAGE_KEY);

    alert("StudyTrack has been reset.");
  }

  // =========================================================
  // APP SHELL
  // =========================================================

  function navigateTo(nextPage) {
    setPage(nextPage);
    setMoreOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function changeUsername() {
    const value = window.prompt(
      "Choose your username (3-20 characters: lowercase letters, numbers, _).\nFriends use it to add you.",
      profile?.username || ""
    );
    if (!value) return;
    try {
      await updateProfile({ username: value.trim().toLowerCase().replace(/^@/, "") });
    } catch (error) {
      alert(
        /unique|duplicate/i.test(error.message)
          ? "That username is already taken."
          : "Usernames need 3-20 lowercase letters, numbers or _."
      );
    }
  }

  const NAV = [
    ["dashboard", "🏠 Dashboard"],
    ["attendance", "📊 Attendance"],
    ["syllabus", "📚 Syllabus"],
    ["timetable", "🗓️ Timetable"],
    ["statistics", "📈 Statistics"],
    ["leaderboard", "🏆 Leaderboard"],
    ["friends", "👥 Friends"],
    ["groups", "🤝 Study Groups"],
    ["settings", "⚙️ Settings"],
  ];

  // Mobile bottom bar: the four most-used pages, everything else under "More"
  const MOBILE_TABS = [
    ["dashboard", "🏠", "Home"],
    ["attendance", "📊", "Attendance"],
    ["syllabus", "📚", "Syllabus"],
    ["timetable", "🗓️", "Timetable"],
  ];
  const MORE_KEYS = ["statistics", "leaderboard", "friends", "groups", "settings"];
  const moreItems = NAV.filter(([key]) => MORE_KEYS.includes(key));
  const moreActive = MORE_KEYS.includes(page);
  const pageTitle =
    NAV.find(([key]) => key === page)?.[1].replace(/^\S+\s/, "") || "StudyTrack";

  return (
    <div className="app-shell">

      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">S</div>
          <div>
            <h2>StudyTrack</h2>
            <span>Student Dashboard</span>
          </div>
        </div>

        <nav>
          {NAV.map(([key, label]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => navigateTo(key)}
            >
              {label}
              {key === "groups" && chatNotify.total > 0 && (
                <span className="nav-badge">{chatNotify.total > 9 ? "9+" : chatNotify.total}</span>
              )}
            </button>
          ))}
        </nav>

        {profile && (
          <div style={{ display: "grid", gap: "8px", padding: "14px 8px 4px", fontSize: "13px" }}>
            <div>
              <strong>{profile.display_name}</strong>
              <div style={{ opacity: 0.65 }}>@{profile.username}</div>
            </div>
            <div className="account-actions">
              <button type="button" className="account-btn" onClick={changeUsername}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                Change username
              </button>
              <button type="button" className="account-btn account-btn--signout" onClick={handleSignOut}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="m16 17 5-5-5-5" />
                  <path d="M21 12H9" />
                </svg>
                Sign out
              </button>
            </div>
          </div>
        )}
      </aside>

      <main className="main">
        <header className="mobile-topbar">
          <div className="mobile-topbar-logo">S</div>
          <span>{pageTitle}</span>
        </header>

        <div key={page} className="page-transition">
          {page === "dashboard" && (
            <Dashboard
              chatNotify={chatNotify}
              clearStudyHistory={clearStudyHistory}
              getOverallSyllabusProgress={getOverallSyllabusProgress}
              maxWeeklySubjectStudyMinutes={maxWeeklySubjectStudyMinutes}
              navigateTo={navigateTo}
              overallAttendance={overallAttendance}
              pomodoro={pomodoro}
              sessionsToday={sessionsToday}
              settings={settings}
              studySessions={studySessions}
              studyStreak={studyStreak}
              subjects={subjects}
              todayStudyMinutes={todayStudyMinutes}
              todosApi={todosApi}
              weeklyChart={weeklyChart}
              weeklyStudyMinutes={weeklyStudyMinutes}
              weeklySubjectStudyTotals={weeklySubjectStudyTotals}
            />
          )}
          {page === "attendance" && (
            <Attendance
              addSubject={addSubject}
              deleteSubject={deleteSubject}
              getClassesCanMiss={getClassesCanMiss}
              getClassesNeeded={getClassesNeeded}
              getPercentage={getPercentage}
              markAttendance={markAttendance}
              newBenchmark={newBenchmark}
              newName={newName}
              setNewBenchmark={setNewBenchmark}
              setNewName={setNewName}
              setShowAdd={setShowAdd}
              showAdd={showAdd}
              subjects={subjects}
              updateBenchmark={updateBenchmark}
            />
          )}
          {page === "syllabus" && (
            <Syllabus
              addManualTopic={addManualTopic}
              expandedUnits={expandedUnits}
              getOverallSyllabusProgress={getOverallSyllabusProgress}
              getSubjectProgress={getSubjectProgress}
              handleWholePdfUpload={handleWholePdfUpload}
              newTopic={newTopic}
              renderSemesterSubjects={renderSemesterSubjects}
              selectedSyllabusSubject={selectedSyllabusSubject}
              setNewTopic={setNewTopic}
              syllabus={syllabus}
              toggleTopic={toggleTopic}
              toggleUnit={toggleUnit}
              uploadingPdf={uploadingPdf}
            />
          )}
          {page === "timetable" && (
            <Timetable
              DAYS={DAYS}
              deleteTimetableEntry={deleteTimetableEntry}
              editingTimetableId={editingTimetableId}
              getDayEntries={getDayEntries}
              openTimetableForm={openTimetableForm}
              resetTimetableForm={resetTimetableForm}
              saveTimetableEntry={saveTimetableEntry}
              setShowTimetableForm={setShowTimetableForm}
              setTimetableForm={setTimetableForm}
              showTimetableForm={showTimetableForm}
              subjects={subjects}
              timetable={timetable}
              timetableForm={timetableForm}
            />
          )}
          {page === "statistics" && (
            <Statistics
              DAYS={DAYS}
              getDayEntries={getDayEntries}
              getPercentage={getPercentage}
              maxWeeklySubjectStudyMinutes={maxWeeklySubjectStudyMinutes}
              settings={settings}
              studySessions={studySessions}
              studyStreak={studyStreak}
              subjects={subjects}
              timetable={timetable}
              todayStudyMinutes={todayStudyMinutes}
              totalStudyMinutes={totalStudyMinutes}
              weeklyStudyMinutes={weeklyStudyMinutes}
              weeklySubjectStudyTotals={weeklySubjectStudyTotals}
            />
          )}
          {page === "leaderboard" && <Leaderboard />}
          {page === "friends" && <Friends />}
          {page === "groups" && (
  <Groups notify={chatNotify} pomodoro={pomodoro} />
)}
          {page === "settings" && (
            <Settings
              exportBackup={exportBackup}
              handleBackupImport={handleBackupImport}
              importingBackup={importingBackup}
              resetAllData={resetAllData}
              setNewBenchmark={setNewBenchmark}
              settings={settings}
              updateSetting={updateSetting}
            />
          )}
        </div>
      </main>

      {moreOpen && (
        <button
          type="button"
          className="more-overlay"
          aria-label="Close menu"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {moreOpen && (
        <div className="more-sheet" role="dialog" aria-label="More">
          <div className="more-sheet-grip" />
          <div className="more-sheet-list">
            {moreItems.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={page === key ? "active" : ""}
                onClick={() => navigateTo(key)}
              >
                {label}
                {key === "groups" && chatNotify.total > 0 && (
                  <span className="nav-badge">{chatNotify.total > 9 ? "9+" : chatNotify.total}</span>
                )}
              </button>
            ))}
          </div>

          {profile && (
            <div className="more-sheet-account">
              <div>
                <strong>{profile.display_name}</strong>
                <div style={{ opacity: 0.65 }}>@{profile.username}</div>
              </div>
              <div className="account-actions">
                <button
                  type="button"
                  className="account-btn"
                  onClick={() => { setMoreOpen(false); changeUsername(); }}
                >
                  Change username
                </button>
                <button
                  type="button"
                  className="account-btn account-btn--signout"
                  onClick={() => { setMoreOpen(false); handleSignOut(); }}
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <nav className="bottom-nav" aria-label="Main">
        {MOBILE_TABS.map(([key, icon, label]) => (
          <button
            key={key}
            type="button"
            className={page === key && !moreOpen ? "active" : ""}
            onClick={() => navigateTo(key)}
          >
            <span className="bottom-nav-icon">{icon}</span>
            <span className="bottom-nav-label">{label}</span>
          </button>
        ))}
        <button
          type="button"
          className={moreOpen || moreActive ? "active" : ""}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span className="bottom-nav-icon">
            ☰
            {chatNotify.total > 0 && <i className="bottom-nav-dot" />}
          </span>
          <span className="bottom-nav-label">More</span>
        </button>
      </nav>

      <NudgeHost soundOn={chatNotify.soundOn} />
    </div>
  );
}

export default App;
