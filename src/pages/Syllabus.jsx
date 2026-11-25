import { getAllSubjects } from "../syllabusParser";

export default function Syllabus({
  addManualTopic,
  expandedUnits,
  getOverallSyllabusProgress,
  getSubjectProgress,
  handleWholePdfUpload,
  newTopic,
  renderSemesterSubjects,
  selectedSyllabusSubject,
  setNewTopic,
  syllabus,
  toggleTopic,
  toggleUnit,
  uploadingPdf,
}) {
  const allSubjects = getAllSubjects(syllabus);

  const selectedSubject = allSubjects.find(
    (subject) => subject.id === selectedSyllabusSubject
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Syllabus</h1>
          <p>Track your complete college syllabus.</p>
        </div>
        <label className="pdf-upload-button">
          {uploadingPdf ? "Reading PDF..." : "📄 Upload Complete Syllabus"}
          <input
            type="file"
            accept=".pdf,application/pdf"
            disabled={uploadingPdf}
            onChange={handleWholePdfUpload}
          />
        </label>
      </div>

      {!syllabus ? (
        <div className="panel empty-state">
          <div className="empty-icon">📚</div>
          <h2>Upload your syllabus</h2>
          <p>
            Upload any syllabus PDF (college scheme, JEE, NEET, etc.). The app
            will detect subjects, units and topics automatically.
          </p>
          <label className="pdf-upload-button">
            📄 Choose PDF
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleWholePdfUpload}
            />
          </label>
        </div>
      ) : (
        <>
          <div className="syllabus-overall-card">
            <div>
              <span>Overall Syllabus Progress</span>
              <strong>{getOverallSyllabusProgress()}%</strong>
            </div>
            <div className="large-progress">
              <div
                style={{ width: `${getOverallSyllabusProgress()}%` }}
              />
            </div>
          </div>

          <div className="semester-tabs">
            {(syllabus.groups || []).map((group) => (
              <div key={group.id}>
                <h2>{group.label}</h2>
                {renderSemesterSubjects(group.subjects)}
              </div>
            ))}
          </div>

          {selectedSubject && (
            <div className="panel selected-syllabus">
              <div className="selected-syllabus-header">
                <div>
                  <h2>{selectedSubject.name}</h2>
                  <span>{selectedSubject.code}</span>
                </div>
                <strong>{getSubjectProgress(selectedSubject)}%</strong>
              </div>

              <div className="large-progress">
                <div
                  style={{
                    width: `${getSubjectProgress(selectedSubject)}%`,
                  }}
                />
              </div>

              <div className="unit-list">
                {selectedSubject.units.map((unit) => {
                  const completed = unit.topics.filter(
                    (topic) => topic.completed
                  ).length;

                  return (
                    <div className="unit-card" key={unit.id}>
                      <button
                        className="unit-header"
                        onClick={() => toggleUnit(unit.id)}
                      >
                        <div>
                          <strong>{unit.name}</strong>
                          <span>
                            {completed} / {unit.topics.length} completed
                          </span>
                        </div>
                        <span>
                          {expandedUnits[unit.id] ? "▲" : "▼"}
                        </span>
                      </button>

                      {expandedUnits[unit.id] && (
                        <div className="unit-topics">
                          {unit.topics.map((topic) => (
                            <label
                              className={`syllabus-topic ${
                                topic.completed ? "completed" : ""
                              }`}
                              key={topic.id}
                            >
                              <input
                                type="checkbox"
                                checked={topic.completed}
                                onChange={() =>
                                  toggleTopic(
                                    selectedSubject.id,
                                    unit.id,
                                    topic.id
                                  )
                                }
                              />
                              <span>{topic.name}</span>
                            </label>
                          ))}

                          <div className="manual-topic">
                            <input
                              type="text"
                              placeholder="Add topic..."
                              value={newTopic}
                              onChange={(e) => setNewTopic(e.target.value)}
                            />
                            <button
                              className="secondary-button"
                              onClick={() =>
                                addManualTopic(
                                  selectedSubject.id,
                                  unit.id
                                )
                              }
                            >
                              + Add
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
