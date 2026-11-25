import PushToggle from "./PushToggle";
import { ACCENT_OPTIONS } from "../constants";
import { formatStudyTime } from "../utils";

export default function Settings({
  exportBackup,
  handleBackupImport,
  importingBackup,
  resetAllData,
  setNewBenchmark,
  settings,
  updateSetting,
}) {
  const clamp = (value) => Math.min(100, Math.max(0, Number(value)));
  const goal = Math.max(1, Number(settings.dailyStudyGoal) || 180);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Personalize StudyTrack and manage your data.</p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gap: "20px",
          maxWidth: "900px",
        }}
      >
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>👤 Student Profile</h2>
              <p>Your name is stored only in this browser for now.</p>
            </div>
          </div>

          <label>
            Student name
            <input
              type="text"
              placeholder="Enter your name"
              value={settings.studentName}
              onChange={(e) =>
                updateSetting("studentName", e.target.value)
              }
            />
          </label>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>🎯 Attendance Preferences</h2>
              <p>These defaults are used for new attendance subjects.</p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
              gap: "16px",
            }}
          >
            <label>
              Default benchmark (%)
              <input
                type="number"
                min="0"
                max="100"
                value={settings.defaultBenchmark}
                onChange={(e) => {
                  const value = clamp(e.target.value);
                  updateSetting("defaultBenchmark", value);
                  setNewBenchmark(value);
                }}
              />
            </label>

            <label>
              Warning threshold (%)
              <input
                type="number"
                min="0"
                max="100"
                value={settings.warningThreshold}
                onChange={(e) =>
                  updateSetting(
                    "warningThreshold",
                    clamp(e.target.value)
                  )
                }
              />
            </label>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>📚 Study Goal</h2>
              <p>Set how much focused study you want to complete each day.</p>
            </div>
          </div>

          <label>
            Daily study goal (minutes)
            <input
              type="number"
              min="1"
              max="1440"
              value={goal}
              onChange={(e) =>
                updateSetting(
                  "dailyStudyGoal",
                  Math.min(1440, Math.max(1, Number(e.target.value) || 1))
                )
              }
            />
          </label>

          <p style={{ marginTop: "10px", fontSize: "13px", opacity: 0.65 }}>
            Current goal: {formatStudyTime(goal)} per day.
          </p>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>🌙 Appearance</h2>
              <p>
                Choose your preferred theme and accent color.
              </p>
            </div>
          </div>

          <label>
            Theme
            <select
              value={settings.theme}
              onChange={(e) => updateSetting("theme", e.target.value)}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>

          <div className="glass-toggle-row">
            <div className="glass-toggle-text">
              <strong>Liquid glass</strong>
              <span>Frosted, translucent cards and blur effects.</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.liquidGlass !== false}
              aria-label="Liquid glass theme"
              className={`glass-switch ${
                settings.liquidGlass !== false ? "on" : ""
              }`}
              onClick={() =>
                updateSetting("liquidGlass", settings.liquidGlass === false)
              }
            >
              <span className="glass-switch-knob" />
              <span className="glass-switch-label">
                {settings.liquidGlass !== false ? "On" : "Off"}
              </span>
            </button>
          </div>

          <div style={{ marginTop: "18px" }}>
            <span>Accent color</span>
            <div
              className="accent-picker"
              role="radiogroup"
              aria-label="Accent color"
            >
              {ACCENT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={settings.accent === option.id}
                  className={`accent-swatch ${
                    settings.accent === option.id ? "selected" : ""
                  }`}
                  onClick={() => updateSetting("accent", option.id)}
                >
                  <span
                    className="accent-dot"
                    style={{ "--swatch": option.swatch }}
                  />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <p style={{ marginTop: "14px", fontSize: "13px", opacity: 0.65 }}>
            Theme, glass effect and accent color update immediately and are
            remembered on this device.
          </p>
        </div>

         <PushToggle />
         
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>💾 Backup & Restore</h2>
              <p>
                Save your attendance, syllabus, timetable, study history and
                settings as one file.
              </p>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <button className="primary-button" onClick={exportBackup}>
              ⬇️ Export Backup
            </button>

            <label
              className="secondary-button"
              style={{ cursor: "pointer" }}
            >
              {importingBackup ? "Importing..." : "⬆️ Import Backup"}
              <input
                type="file"
                accept="application/json,.json"
                hidden
                disabled={importingBackup}
                onChange={handleBackupImport}
              />
            </label>
          </div>
        </div>

        <div
          className="panel"
          style={{ border: "1px solid rgba(239,68,68,0.35)" }}
        >
          <div className="panel-header">
            <div>
              <h2>🗑️ Reset App Data</h2>
              <p>This removes all StudyTrack data saved in this browser.</p>
            </div>
          </div>

          <button className="danger-text" onClick={resetAllData}>
            Reset all data
          </button>
        </div>
      </div>
    </>
  );
}
