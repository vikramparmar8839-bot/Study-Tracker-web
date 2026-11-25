import { useEffect, useState } from "react";

export const TODOS_STORAGE_KEY = "studytrack-todos";

// Owns the to-do list: state, localStorage persistence and the actions.
// App keeps `todos` / `setTodos` so Export, Import and Reset can reach them.
export default function useTodos() {
  const [todos, setTodos] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TODOS_STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(TODOS_STORAGE_KEY, JSON.stringify(todos));
  }, [todos]);

  function addTodo(rawText) {
    const text = String(rawText).trim();
    if (!text) return false;
    setTodos((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text, done: false },
    ]);
    return true;
  }

  function toggleTodo(id) {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    );
  }

  function deleteTodo(id) {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  }

  function clearDoneTodos() {
    setTodos((prev) => prev.filter((t) => !t.done));
  }

  return { todos, setTodos, addTodo, toggleTodo, deleteTodo, clearDoneTodos };
}
