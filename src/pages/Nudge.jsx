import { useCallback, useEffect, useState } from 'react';
import { enableNudgeAlerts, useNudgeReceiver, useNudgeSender } from '../hooks/useNudge';

/* small "👋 Nudge" button, put it next to a member */
export function NudgeButton({ toId, toName, myName, groupName }) {
  const { send, status } = useNudgeSender();
  const s = status(toId);
  const label = s === 'sending' ? 'Sending…' : s === 'sent' ? 'Nudged ✓' : s === 'failed' ? 'Failed, retry' : '👋 Nudge';
  return (
    <button
      type="button"
      className="ghost"
      disabled={s === 'sending' || s === 'sent'}
      onClick={() => send(toId, { fromName: myName, groupName })}
      title={`Send ${toName} a nudge with a sound`}
      aria-label={`Nudge ${toName}`}
      style={{
        minHeight: 32,
        padding: '0 10px',
        fontSize: '0.8rem',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        marginLeft: 8,
      }}
    >
      {label}
    </button>
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
          <div style={{ opacity: 0.8, fontSize: '0.85rem', marginTop: 2 }}>
            {n.groupName ? `Time to study! (${n.groupName})` : 'Time to study!'}
          </div>
        </div>
      ))}
    </div>
  );
}
