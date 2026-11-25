import { formatStudyTime } from "../utils";

export default function Statistics({
  DAYS,
  getDayEntries,
  getPercentage,
  maxWeeklySubjectStudyMinutes,
  settings,
  studySessions,
  studyStreak,
  subjects,
  timetable,
  todayStudyMinutes,
  totalStudyMinutes,
  weeklyStudyMinutes,
  weeklySubjectStudyTotals,
}) {
  const totalPresent = subjects.reduce((sum, s) => sum + s.present, 0);
  const totalAbsent = subjects.reduce((sum, s) => sum + s.absent, 0);
  const totalClasses = totalPresent + totalAbsent;
  const overall =
    totalClasses > 0
      ? Math.round((totalPresent / totalClasses) * 100)
      : 0;

  const subjectStats = subjects.map((s) => ({
    ...s,
    percentage: getPercentage(s),
    total: s.present + s.absent,
  }));

  const scheduledBySubject = subjects.map((s) => ({
    name: s.name,
    count: timetable.filter((entry) => entry.subject === s.name).length,
  }));

  const maxScheduled = Math.max(
    ...scheduledBySubject.map((i) => i.count),
    1
  );

  const scheduledDays = DAYS.map((day) => ({
    day: day.slice(0, 3),
    count: getDayEntries(day).length,
  }));

  const maxDaily = Math.max(
    ...scheduledDays.map((i) => i.count),
    1
  );

  const goal = Math.max(1, Number(settings.dailyStudyGoal) || 180);
  const goalProgress = Math.min(
    100,
    (todayStudyMinutes / goal) * 100
  );

  const track = {
    height: "12px",
    background: "rgba(128,128,128,0.18)",
    borderRadius: "999px",
    overflow: "hidden",
  };

  const row = {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "7px",
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Statistics</h1>
          <p>See your attendance, study and timetable performance.</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <span>Overall Attendance</span>
          <strong>{overall}%</strong>
        </div>
        <div className="stat-card">
          <span>Total Study Time</span>
          <strong>{formatStudyTime(totalStudyMinutes)}</strong>
        </div>
        <div className="stat-card">
          <span>This Week</span>
          <strong>{formatStudyTime(weeklyStudyMinutes)}</strong>
        </div>
        <div className="stat-card">
          <span>Study Streak</span>
          <strong>🔥 {studyStreak}</strong>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))",
          gap: "20px",
          marginTop: "20px",
        }}
      >
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Today's Goal</h2>
              <p>Focused study completed today.</p>
            </div>
          </div>

          <div className="big-percentage">
            {Math.round(goalProgress)}%
          </div>

          <div className="large-progress" style={{ marginTop: "14px" }}>
            <div style={{ width: `${goalProgress}%` }} />
          </div>

          <p style={{ marginTop: "12px", opacity: 0.7 }}>
            {formatStudyTime(todayStudyMinutes)} of{" "}
            {formatStudyTime(goal)}
          </p>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Study by Subject</h2>
              <p>Your recorded focus time in the last 7 days.</p>
            </div>
          </div>

          {weeklySubjectStudyTotals.map((item) => (
            <div className="study-subject-row" key={item.name}>
              <div className="study-subject-header">
                <span>{item.name}</span>
                <strong>{formatStudyTime(item.minutes)}</strong>
              </div>
              <div className="study-subject-bar">
                <div
                  style={{
                    width: `${
                      (item.minutes / maxWeeklySubjectStudyMinutes) * 100
                    }%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Attendance by Subject</h2>
              <p>Your current attendance percentage.</p>
            </div>
          </div>

          {subjectStats.length === 0 ? (
            <p>No subjects available yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "18px" }}>
              {subjectStats.map((item) => (
                <div key={item.id}>
                  <div style={row}>
                    <strong>{item.name}</strong>
                    <strong>{item.percentage}%</strong>
                  </div>

                  <div style={track}>
                    <div
                      style={{
                        width: `${item.percentage}%`,
                        height: "100%",
                        background:
                          item.percentage >= item.benchmark
                            ? "#22c55e"
                            : "#f59e0b",
                        borderRadius: "999px",
                        transition: "width .4s ease",
                      }}
                    />
                  </div>

                  <div
                    style={{
                      marginTop: "6px",
                      fontSize: "12px",
                      opacity: 0.65,
                    }}
                  >
                    Target: {item.benchmark}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Present vs Absent</h2>
              <p>Class distribution for each subject.</p>
            </div>
          </div>

          {subjectStats.length === 0 ? (
            <p>No attendance data yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "18px" }}>
              {subjectStats.map((item) => {
                const presentWidth = item.total
                  ? (item.present / item.total) * 100
                  : 0;

                return (
                  <div key={item.id}>
                    <div style={row}>
                      <strong>{item.name}</strong>
                      <span style={{ fontSize: "12px", opacity: 0.7 }}>
                        {item.present} present · {item.absent} absent
                      </span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        height: "14px",
                        borderRadius: "999px",
                        overflow: "hidden",
                        background: "rgba(128,128,128,0.18)",
                      }}
                    >
                      <div
                        style={{
                          width: `${presentWidth}%`,
                          background: "#22c55e",
                        }}
                      />
                      <div style={{ flex: 1, background: "#ef4444" }} />
                    </div>
                  </div>
                );
              })}

              <div
                style={{
                  display: "flex",
                  gap: "18px",
                  fontSize: "13px",
                  opacity: 0.75,
                }}
              >
                <span>🟢 Present</span>
                <span>🔴 Absent</span>
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Attendance vs Benchmark</h2>
              <p>Compare your current percentage with your target.</p>
            </div>
          </div>

          {subjectStats.length === 0 ? (
            <p>No subjects available yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "16px" }}>
              {subjectStats.map((item) => (
                <div key={item.id}>
                  <div style={{ ...row, marginBottom: "6px" }}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.percentage}% / {item.benchmark}%
                    </span>
                  </div>

                  <div
                    style={{
                      position: "relative",
                      height: "10px",
                      borderRadius: "999px",
                      background: "rgba(128,128,128,0.18)",
                    }}
                  >
                    <div
                      style={{
                        width: `${item.percentage}%`,
                        height: "100%",
                        borderRadius: "999px",
                        background:
                          item.percentage >= item.benchmark
                            ? "#22c55e"
                            : "#f59e0b",
                      }}
                    />

                    <div
                      style={{
                        position: "absolute",
                        left: `${item.benchmark}%`,
                        top: "-5px",
                        width: "3px",
                        height: "20px",
                        background: "currentColor",
                        borderRadius: "3px",
                        opacity: 0.7,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Classes by Subject</h2>
              <p>Weekly classes from your timetable.</p>
            </div>
          </div>

          {timetable.length === 0 ? (
            <p>No timetable classes added yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "14px" }}>
              {scheduledBySubject
                .filter((item) => item.count > 0)
                .map((item) => (
                  <div key={item.name}>
                    <div style={{ ...row, marginBottom: "6px" }}>
                      <strong>{item.name}</strong>
                      <span>{item.count}</span>
                    </div>

                    <div style={{ ...track, height: "10px" }}>
                      <div
                        style={{
                          width: `${(item.count / maxScheduled) * 100}%`,
                          height: "100%",
                          background: "#6366f1",
                          borderRadius: "999px",
                        }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="panel" style={{ gridColumn: "1 / -1" }}>
          <div className="panel-header">
            <div>
              <h2>Weekly Class Distribution</h2>
              <p>How your scheduled classes are spread across the week.</p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6,minmax(0,1fr))",
              gap: "14px",
              alignItems: "end",
              minHeight: "190px",
            }}
          >
            {scheduledDays.map((item) => (
              <div
                key={item.day}
                style={{
                  height: "170px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <strong>{item.count}</strong>
                <div
                  style={{
                    width: "min(44px,70%)",
                    height: `${Math.max(
                      item.count
                        ? (item.count / maxDaily) * 120
                        : 4,
                      4
                    )}px`,
                    background: "#22d3ee",
                    borderRadius: "10px 10px 4px 4px",
                    transition: "height .4s ease",
                  }}
                />
                <span style={{ fontSize: "12px", opacity: 0.7 }}>
                  {item.day}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel" style={{ gridColumn: "1 / -1" }}>
          <div className="panel-header">
            <div>
              <h2>Recent Study Sessions</h2>
              <p>Your latest recorded focus sessions.</p>
            </div>
          </div>

          {studySessions.length === 0 ? (
            <p className="empty">No study sessions recorded yet.</p>
          ) : (
            <div className="study-history">
              {[...studySessions]
                .slice(-10)
                .reverse()
                .map((session) => (
                  <div className="study-history-row" key={session.id}>
                    <div>
                      <strong>{session.subject}</strong>
                      <div className="study-history-date">
                        {session.date}
                      </div>
                    </div>
                    <div className="study-history-time">
                      {formatStudyTime(session.duration)}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
