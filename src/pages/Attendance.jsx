export default function Attendance({
  addSubject,
  deleteSubject,
  getClassesCanMiss,
  getClassesNeeded,
  getPercentage,
  markAttendance,
  newBenchmark,
  newName,
  setNewBenchmark,
  setNewName,
  setShowAdd,
  showAdd,
  subjects,
  updateBenchmark,
}) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Attendance</h1>
          <p>Track attendance for every subject.</p>
        </div>
        <button
          className="primary-button"
          onClick={() => setShowAdd(!showAdd)}
        >
          + Add Subject
        </button>
      </div>

      {showAdd && (
        <div className="panel add-form">
          <h2>Add Subject</h2>
          <input
            type="text"
            placeholder="Subject name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            type="number"
            min="0"
            max="100"
            placeholder="Benchmark %"
            value={newBenchmark}
            onChange={(e) => setNewBenchmark(e.target.value)}
          />
          <button className="primary-button" onClick={addSubject}>
            Add Subject
          </button>
        </div>
      )}

      <div className="attendance-list">
        {subjects.map((subject) => {
          const percentage = getPercentage(subject);
          const needed = getClassesNeeded(subject);
          const canMiss = getClassesCanMiss(subject);

          return (
            <div className="attendance-card" key={subject.id}>
              <div className="attendance-card-header">
                <div>
                  <h2>{subject.name}</h2>
                  <span>{subject.present + subject.absent} total classes</span>
                </div>
                <button
                  className="danger-text"
                  onClick={() => deleteSubject(subject.id)}
                >
                  Delete
                </button>
              </div>

              <div className="attendance-main">
                <div className="big-percentage">{percentage}%</div>
                <p
                  className={
                    percentage >= subject.benchmark
                      ? "good-text"
                      : "danger-text"
                  }
                >
                  {percentage >= subject.benchmark
                    ? "Above your benchmark"
                    : "Below your benchmark"}
                </p>
              </div>

              <div className="benchmark-box">
                <label>
                  Benchmark
                  <div className="benchmark-input">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={subject.benchmark}
                      onChange={(e) =>
                        updateBenchmark(subject.id, e.target.value)
                      }
                    />
                    <span>%</span>
                  </div>
                </label>
              </div>

              <div className="large-progress">
                <div style={{ width: `${Math.min(percentage, 100)}%` }} />
              </div>

              <div className="attendance-numbers">
                <span>
                  Present: <strong>{subject.present}</strong>
                </span>
                <span>
                  Absent: <strong>{subject.absent}</strong>
                </span>
                <span>
                  Total: <strong>{subject.present + subject.absent}</strong>
                </span>
              </div>

              <div className="attendance-actions">
                <button
                  className="present-button"
                  onClick={() => markAttendance(subject.id, "present")}
                >
                  + Present
                </button>
                <button
                  className="absent-button"
                  onClick={() => markAttendance(subject.id, "absent")}
                >
                  + Absent
                </button>
              </div>

              <div className="attendance-message">
                {percentage < subject.benchmark ? (
                  needed === Infinity ? (
                    <span>100% attendance is required.</span>
                  ) : (
                    <span>
                      Attend the next <strong>{needed}</strong> classes to
                      reach <strong>{subject.benchmark}%</strong>.
                    </span>
                  )
                ) : canMiss === Infinity ? (
                  <span>You can miss any number of classes.</span>
                ) : (
                  <span>
                    You can miss <strong>{canMiss}</strong> class
                    {canMiss !== 1 ? "es" : ""} and stay at{" "}
                    <strong>{subject.benchmark}%</strong>.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
