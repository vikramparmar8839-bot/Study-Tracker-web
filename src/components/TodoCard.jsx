import { useState } from "react";
import "./todo.css";

// Dashboard to-do card. Receives its data and actions from useTodos().
export default function TodoCard({
  todos,
  addTodo,
  toggleTodo,
  deleteTodo,
  clearDoneTodos,
}) {
  const [newTodo, setNewTodo] = useState("");
  const todosDone = todos.filter((t) => t.done).length;

  function handleAdd() {
    if (addTodo(newTodo)) setNewTodo("");
  }

  return (
    <section className="panel todo-panel">
      <div className="panel-header">
        <div>
          <h2>To-do List</h2>
          <p>
            {todos.length
              ? `${todosDone} of ${todos.length} done`
              : "Your personal tasks."}
          </p>
        </div>
        {todosDone > 0 && (
          <button className="danger-text" onClick={clearDoneTodos}>
            Clear done
          </button>
        )}
      </div>

      {todos.length > 0 && (
        <div className="todo-progress" aria-hidden="true">
          <div style={{ width: `${(todosDone / todos.length) * 100}%` }} />
        </div>
      )}

      <div className="todo-add">
        <input
          type="text"
          placeholder="Add a task…"
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <button className="primary-button" onClick={handleAdd}>
          Add
        </button>
      </div>

      {todos.length === 0 ? (
        <div className="todo-empty">
          <span aria-hidden="true">📝</span>
          <p>Nothing to do yet</p>
          <small>Add a task above to get started.</small>
        </div>
      ) : (
        <ul className="todo-list">
          {[...todos]
            .sort((a, b) => Number(a.done) - Number(b.done))
            .map((t) => (
              <li key={t.id} className={`todo-item ${t.done ? "done" : ""}`}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={t.done}
                  aria-label={`Mark "${t.text}" as ${t.done ? "not done" : "done"}`}
                  className="todo-check"
                  onClick={() => toggleTodo(t.id)}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                </button>
                <span className="todo-text" onClick={() => toggleTodo(t.id)}>
                  {t.text}
                </span>
                <button
                  type="button"
                  className="todo-delete"
                  aria-label={`Delete "${t.text}"`}
                  onClick={() => deleteTodo(t.id)}
                >
                  ✕
                </button>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
