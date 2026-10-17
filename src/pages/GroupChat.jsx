import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './group-chat.css';

const MAX_LEN = 500;

/* built-in emoji set (no extra package needed). The key is the tab icon. */
const EMOJI = {
  '😀': ['😀', '😄', '😁', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤓', '🤔',
         '😅', '😉', '🙂', '🙃', '😴', '🥱', '😭', '😢', '😤', '😡', '🤯', '🥳'],
  '👍': ['👍', '👎', '👏', '🙌', '🙏', '💪', '👀', '🤝', '✌️', '🤞', '👋', '🤗'],
  '📚': ['📚', '📖', '✏️', '📝', '💡', '🎯', '⏰', '☕', '🍕', '🔥', '⚡', '🏆',
         '⭐', '✅', '❌', '💯'],
  '❤️': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '🎉', '🎊', '🚀', '🌟',
        '🌈', '🐱', '🙈', '💤'],
};

/* a message that is just 1-3 emojis is shown big, without a bubble */
const ONLY_EMOJI = /^(?:\p{Extended_Pictographic}[\uFE0F\u200D]*\s*){1,3}$/u;

const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function GroupChat({ chat }) {
  const { user } = useAuth();
  const { messages, send, loading, error } = chat;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tab, setTab] = useState(Object.keys(EMOJI)[0]);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const pickerRef = useRef(null);

  // stay at the newest message
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // close the picker when clicking elsewhere or pressing Escape
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onDown = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setPickerOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  function insertEmoji(emoji) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    if (next.length > MAX_LEN) return;
    setText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function submit(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const ok = await send(body);
    if (ok) {
      setText('');
      setPickerOpen(false);
    }
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
          const big = ONLY_EMOJI.test(m.body.trim());
          return (
            <div key={m.id} className={mine ? 'st-msg mine' : 'st-msg'}>
              {!mine && <span className="st-msg-name">{m.sender_name}</span>}
              <div className={big ? 'st-msg-bubble emoji-only' : 'st-msg-bubble'}>{m.body}</div>
              <span className="st-msg-time">{timeOf(m.created_at)}</span>
            </div>
          );
        })}
      </div>

      {error && <p className="st-error">{error}</p>}

      <form className="st-chat-form" onSubmit={submit}>
        <div className="st-emoji-wrap" ref={pickerRef}>
          <button
            type="button"
            className="ghost st-emoji-btn"
            onClick={() => setPickerOpen((o) => !o)}
            aria-label="Add emoji"
            aria-expanded={pickerOpen}
            title="Add emoji"
          >
            😊
          </button>

          {pickerOpen && (
            <div className="st-emoji-panel" role="dialog" aria-label="Emoji picker">
              <div className="st-emoji-tabs">
                {Object.keys(EMOJI).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={tab === key ? 'st-emoji-tab active' : 'st-emoji-tab'}
                    onClick={() => setTab(key)}
                  >
                    {key}
                  </button>
                ))}
              </div>
              <div className="st-emoji-grid">
                {EMOJI[tab].map((emoji) => (
                  <button key={emoji} type="button" className="st-emoji-item" onClick={() => insertEmoji(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message your group…"
          maxLength={MAX_LEN}
          autoComplete="off"
        />
        <button type="submit" disabled={sending || !text.trim()}>Send</button>
      </form>
    </div>
  );
}
