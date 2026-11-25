export default function Timetable({
  DAYS,
  deleteTimetableEntry,
  editingTimetableId,
  getDayEntries,
  openTimetableForm,
  resetTimetableForm,
  saveTimetableEntry,
  setShowTimetableForm,
  setTimetableForm,
  showTimetableForm,
  subjects,
  timetable,
  timetableForm,
}) {
  const totalClasses = timetable.length;

  const setField = (key) => (e) =>
    setTimetableForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Timetable</h1>
          <p>Plan your weekly classes in one place.</p>
        </div>
        <button
          className="primary-button"
          onClick={() => openTimetableForm()}
        >
          + Add Class
        </button>
      </div>

      <div className="stats-grid cols-3">
        <div className="stat-card">
          <span>Weekly Classes</span>
          <strong>{totalClasses}</strong>
        </div>
        <div className="stat-card">
          <span>Days Scheduled</span>
          <strong>
            {DAYS.filter((day) => getDayEntries(day).length > 0).length}
          </strong>
        </div>
        <div className="stat-card">
          <span>Subjects Scheduled</span>
          <strong>
            {new Set(timetable.map((entry) => entry.subject)).size}
          </strong>
        </div>
      </div>

      {showTimetableForm && (
        <div className="panel timetable-form">
          <div className="panel-header">
            <div>
              <h2>{editingTimetableId ? "Edit Class" : "Add Class"}</h2>
              <p>Enter the details for this weekly class.</p>
            </div>
            <button
              className="danger-text"
              onClick={() => {
                setShowTimetableForm(false);
                resetTimetableForm();
              }}
            >
              Cancel
            </button>
          </div>

          <div className="form-grid">
            <label>
              Day
              <select value={timetableForm.day} onChange={setField("day")}>
                {DAYS.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Subject
              <select
                value={timetableForm.subject}
                onChange={setField("subject")}
              >
                <option value="">Select subject</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.name}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Start time
              <input
                type="time"
                value={timetableForm.startTime}
                onChange={setField("startTime")}
              />
            </label>

            <label>
              End time
              <input
                type="time"
                value={timetableForm.endTime}
                onChange={setField("endTime")}
              />
            </label>

            <label>
              Room
              <input
                type="text"
                placeholder="e.g. Lab 2"
                value={timetableForm.room}
                onChange={setField("room")}
              />
            </label>

            <label>
              Teacher
              <input
                type="text"
                placeholder="Optional"
                value={timetableForm.teacher}
                onChange={setField("teacher")}
              />
            </label>
          </div>

          <button className="primary-button" onClick={saveTimetableEntry}>
            {editingTimetableId ? "Save Changes" : "Add Class"}
          </button>
        </div>
      )}

      {timetable.length === 0 ? (
        <div className="panel empty-state">
          <div className="empty-icon">🗓️</div>
          <h2>Your timetable is empty</h2>
          <p>
            Add your weekly classes and they will stay saved in this browser.
          </p>
          <button
            className="primary-button"
            onClick={() => openTimetableForm()}
          >
            + Add Your First Class
          </button>
        </div>
      ) : (
        <div className="timetable-grid">
          {DAYS.map((day) => {
            const entries = getDayEntries(day);

            return (
              <section key={day} className="panel">
                <div className="panel-header">
                  <h2>{day}</h2>
                  <span>
                    {entries.length} class
                    {entries.length === 1 ? "" : "es"}
                  </span>
                </div>

                {entries.length === 0 ? (
                  <div className="timetable-empty">No classes</div>
                ) : (
                  <div className="timetable-list">
                    {entries.map((entry) => (
                      <div key={entry.id} className="timetable-class">
                        <strong className="timetable-class-name">
                          {entry.subject}
                        </strong>

                        <div className="timetable-class-meta">
                          <span>
                            🕐 {entry.startTime} – {entry.endTime}
                          </span>
                          {entry.room && <span>📍 {entry.room}</span>}
                          {entry.teacher && <span>👨‍🏫 {entry.teacher}</span>}
                        </div>

                        <div className="timetable-class-actions">
                          <button
                            className="secondary-button"
                            onClick={() => openTimetableForm(entry)}
                          >
                            Edit
                          </button>
                          <button
                            className="danger-text"
                            onClick={() => deleteTimetableEntry(entry.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
