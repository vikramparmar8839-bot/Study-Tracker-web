import { useCallback, useEffect, useRef, useState } from 'react';
import { enableNudgeAlerts, useNudgeReceiver, useNudgeSender } from '../hooks/useNudge';

const QUICK_MESSAGES = [
  '📚📚',
  "Focus",
  'Come online ☕',
];
const MAX_MESSAGE_LEN = 80;

const chipStyle = {
  padding: '6px 10px',
  borderRadius: 999,
  fontSize: '0.8rem',
  color: 'rgba(255, 255, 255, 0.92)',
  background: 'rgba(255, 255, 255, 0.08)',
  border: '1px solid rgba(255, 255, 255, 0.22)',
  boxShadow: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/* small "👋 Nudge" button, put it next to a member.
   Tap it to pick a quick message, type your own, or send a plain nudge. */
export function NudgeButton({ toId, toName, myName, groupName }) {
  const { send, status } = useNudgeSender();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const wrapRef = useRef(null);
  const s = status(toId);
  const busy = s === 'sending' || s === 'sent';
  const label = s === 'sending' ? 'Sending…' : s === 'sent' ? 'Nudged ✓' : s === 'failed' ? 'Failed, retry' : '👋 Nudge';

  // close the box when you tap outside it or press Escape
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const fire = (message) => {
    setOpen(false);
    setText('');
    send(toId, { fromName: myName, groupName, message });
  };

  return (
    <span
      ref={wrapRef}
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, marginLeft: 8 }}
    >
      <button
        type="button"
        className="ghost"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Send ${toName} a nudge with a sound`}
        aria-label={`Nudge ${toName}`}
        style={{
          minHeight: 32,
          padding: '0 10px',
          fontSize: '0.8rem',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          /* see-through glass look, same as the other buttons on the card */
          background: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid rgba(255, 255, 255, 0.28)',
          boxShadow: 'none',
          color: 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderRadius: 10,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {label}
      </button>

      {open && !busy && (
        <div
          role="dialog"
          aria-label={`Nudge ${toName}`}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 'calc(100% + 8px)',
            zIndex: 50,
            width: 'min(280px, 78vw)',
            display: 'grid',
            gap: 10,
            padding: 12,
            borderRadius: 14,
            color: '#fff',
            background: 'rgba(30, 34, 60, 0.96)',
            border: '1px solid rgba(170, 180, 255, 0.4)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            textAlign: 'left',
          }}
        >
          <strong style={{ fontSize: '0.85rem' }}>Nudge {toName}</strong>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {QUICK_MESSAGES.map((m) => (
              <button key={m} type="button" style={chipStyle} onClick={() => fire(m)}>
                {m}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={text}
              maxLength={MAX_MESSAGE_LEN}
              placeholder="Write a short message…"
              aria-label="Short message"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && text.trim()) fire(text.trim());
              }}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '7px 10px',
                borderRadius: 10,
                fontSize: '0.85rem',
                color: '#fff',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.22)',
                outline: 'none',
              }}
            />
            <button
              type="button"
              disabled={!text.trim()}
              onClick={() => fire(text.trim())}
              style={{ ...chipStyle, borderRadius: 10, opacity: text.trim() ? 1 : 0.5 }}
            >
              Send
            </button>
          </div>

          <button
            type="button"
            onClick={() => fire('')}
            style={{ ...chipStyle, borderRadius: 10, textAlign: 'center' }}
          >
            👋 Just nudge, no message
          </button>
        </div>
      )}
    </span>
  );
}

/* Mount ONCE in the signed-in layout (App.jsx). Plays the sound and shows the toast when someone nudges you. */
export function NudgeHost({ soundOn = true }) {
  const [toasts, setToasts] = useState([]);

  const onNudge = useCallback((n) => {
    setToasts((t) => [...t.slice(-2), n]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 6000);
  }, []);
  useNudgeReceiver({ soundOn, onNudge });

  // the first tap anywhere unlocks sound (browsers block audio until the user interacts) and asks for notification permission
  useEffect(() => {
    let done = false;
    const unlock = () => {
      if (done) return;
      done = true;
      enableNudgeAlerts();
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        left: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((n) => (
        <div
          key={n.id}
          style={{
            pointerEvents: 'auto',
            maxWidth: 340,
            padding: '12px 16px',
            borderRadius: 14,
            color: '#fff',
            background: 'rgba(30, 34, 60, 0.96)',
            border: '1px solid rgba(170, 180, 255, 0.5)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
            fontSize: '0.95rem',
          }}
        >
          <strong>👋 {n.fromName} nudged you</strong>
          {n.message ? (
            <div style={{ fontSize: '0.95rem', marginTop: 4, wordBreak: 'break-word' }}>
              “{n.message}”
            </div>
          ) : null}
          <div style={{ opacity: 0.8, fontSize: '0.85rem', marginTop: 2 }}>
            {n.groupName ? `Time to study! (${n.groupName})` : 'Time to study!'}
          </div>
        </div>
      ))}
    </div>
  );
}
