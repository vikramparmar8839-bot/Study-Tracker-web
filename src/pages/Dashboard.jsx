import PomodoroTimer from "../PomodoroTimer";
import TodoCard from "../components/TodoCard";
import DashboardGroupCard from "./DashboardGroupCard";
import { formatStudyTime } from "../utils";

export default function Dashboard({
  chatNotify,
  clearStudyHistory,
  getOverallSyllabusProgress,
  maxWeeklySubjectStudyMinutes,
  navigateTo,
  overallAttendance,
  pomodoro,
  sessionsToday,
  settings,
  studySessions,
  studyStreak,
  subjects,
  todayStudyMinutes,
  todosApi,
  weeklyChart,
  weeklyStudyMinutes,
  weeklySubjectStudyTotals,
}) {
  const goal = Math.max(1, Number(settings.dailyStudyGoal) || 180);
  const goalProgress = Math.min(100, (todayStudyMinutes / goal) * 100);
  const greeting =
    new Date().getHours() < 12
      ? "Good morning"
      : new Date().getHours() < 18
      ? "Good afternoon"
      : "Good evening";

  return (
    <>
      <div className="dashboard-welcome">
        <h2>
          {greeting}
          {settings.studentName ? `, ${settings.studentName}` : ""} 👋
        </h2>
        <p>Stay consistent. Small sessions add up.</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <span>Overall Attendance</span>
          <strong>{overallAttendance()}%</strong>
        </div>
        <div className="stat-card">
          <span>Syllabus Progress</span>
          <strong>{getOverallSyllabusProgress()}%</strong>
        </div>
        <div className="stat-card">
          <span>Today's Study</span>
          <strong>{formatStudyTime(todayStudyMinutes)}</strong>
        </div>
        <div className="stat-card">
          <span>Study Streak</span>
          <strong>🔥 {studyStreak}</strong>
        </div>
      </div>

      <div className="productivity-grid">
        <PomodoroTimer
          pomodoro={pomodoro}
          subjects={subjects}
          sessionsToday={sessionsToday}
        />

        <div className="productivity-side">
          <div className="productivity-mini-card">
            <span className="mini-label">Daily Goal</span>
            <strong className="mini-value">
              {formatStudyTime(todayStudyMinutes)}
            </strong>
            <span className="mini-sub">
              Goal: {formatStudyTime(goal)}
            </span>
            <div className="small-progress">
              <div style={{ width: `${goalProgress}%` }} />
            </div>
          </div>

          <div className="productivity-mini-card">
            <span className="mini-label">This Week</span>
            <strong className="mini-value">
              {formatStudyTime(weeklyStudyMinutes)}
            </strong>
            <span className="mini-sub">Last 7 days</span>
          </div>

          <div className="productivity-mini-card weekchart-card">
            <div className="weekchart-header">
              <span className="mini-label">Study Activity</span>
              <span className="weekchart-streak">
                🔥 {studyStreak} {studyStreak === 1 ? "day" : "days"}
              </span>
            </div>

            <div
              className="weekchart"
              role="img"
              aria-label={`Study time this week: ${weeklyChart.days
                .map(
                  (day) =>
                    `${day.label} ${
                      day.minutes ? formatStudyTime(day.minutes) : "none"
                    }`
                )
                .join(", ")}`}
            >
              <div
                className="weekchart-goal"
                style={{
                  top: `calc(var(--chart-h) * ${
                    (100 - weeklyChart.goalLine) / 100
                  })`,
                }}
                aria-hidden="true"
              />
              {weeklyChart.days.map((day) => (
                <div
                  key={day.key}
                  className={`weekchart-col ${day.isToday ? "today" : ""} ${
                    day.isFuture ? "future" : ""
                  }`}
                  title={`${day.fullLabel}: ${
                    day.minutes ? formatStudyTime(day.minutes) : "No study"
                  }`}
                >
                  <div className="weekchart-track">
                    <div
                      className={`weekchart-bar level-${day.level}`}
                      style={{ height: `${day.height}%` }}
                    />
                  </div>
                  <span className="weekchart-day">{day.label}</span>
                </div>
              ))}
            </div>

            <div className="weekchart-footer">
              <span className="mini-sub">
                {weeklyChart.activeDays} active{" "}
                {weeklyChart.activeDays === 1 ? "day" : "days"} this week
              </span>
              <span className="weekchart-key">
                <i aria-hidden="true" /> Daily goal
              </span>
            </div>
          </div>
        </div>
      </div>

      <DashboardGroupCard
        notify={chatNotify}
        onOpen={() => navigateTo("groups")}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))",
          gap: "20px",
          marginTop: "20px",
        }}
      >
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Study by Subject</h2>
              <p>Where your study time went in the last 7 days.</p>
            </div>
          </div>

          {studySessions.length === 0 ? (
            <p className="empty">
              Start a focus session to see your study distribution.
            </p>
          ) : (
            weeklySubjectStudyTotals.map((item) => (
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
            ))
          )}
        </section>

        <TodoCard {...todosApi} />
      </div>

      <section className="panel" style={{ marginTop: "20px" }}>
        <div className="panel-header">
          <div>
            <h2>Recent Study Sessions</h2>
            <p>Your latest focus sessions.</p>
          </div>
          {studySessions.length > 0 && (
            <button className="danger-text" onClick={clearStudyHistory}>
              Clear History
            </button>
          )}
        </div>

        {studySessions.length === 0 ? (
          <p className="empty">No study sessions yet.</p>
        ) : (
          <div className="study-history">
            {[...studySessions]
              .slice(-7)
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
      </section>
    </>
  );
}
