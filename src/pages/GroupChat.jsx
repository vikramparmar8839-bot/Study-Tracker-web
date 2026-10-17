import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './group-chat.css';

const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function GroupChat({ chat }) {
  const { user } = useAuth();
  const { messages, send, loading, error } = chat;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  // stay at the newest message
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function submit(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const ok = await send(body);
    if (ok) setText('');
    setSending(false);
  }

  return (
    <div className="st-chat">
      <div className="st-chat-list" ref={listRef}>
        {loading && <p className="st-chat-note">Loading messages…</p>}
        {!loading && messages.length === 0 && (
          <p className="st-chat-note">No messages yet. Say hi 👋</p>
        )}
        {messages.map((m) => {
          const mine = m.user_id === user.id;
          return (
            <div key={m.id} className={mine ? 'st-msg mine' : 'st-msg'}>
              {!mine && <span className="st-msg-name">{m.sender_name}</span>}
              <div className="st-msg-bubble">{m.body}</div>
              <span className="st-msg-time">{timeOf(m.created_at)}</span>
            </div>
          );
        })}
      </div>

      {error && <p className="st-error">{error}</p>}

      <form className="st-chat-form" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message your group…"
          maxLength={500}
          autoComplete="off"
        />
        <button type="submit" disabled={sending || !text.trim()}>Send</button>
      </form>
    </div>
  );
}
