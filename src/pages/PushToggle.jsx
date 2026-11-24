import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { enablePush, disablePush, isPushOn, pushSupported } from '../lib/push';

// Settings panel: turn closed-app nudge notifications on or off for this device.
export default function PushToggle() {
  const { user } = useAuth();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const supported = pushSupported();
  const blocked = supported && Notification.permission === 'denied';

  useEffect(() => {
    isPushOn().then(setOn).catch(() => {});
  }, []);

  async function toggle() {
    if (busy || !user) return;
    setBusy(true);
    setError('');
    try {
      if (on) {
        await disablePush();
        setOn(false);
      } else {
        await enablePush();
        setOn(true);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>🔔 Nudge Notifications</h2>
          <p>Get a notification when a friend nudges you, even if StudyTrack is closed.</p>
        </div>
      </div>

      {!supported ? (
        <p style={{ fontSize: '13px', opacity: 0.7 }}>
          This browser doesn't support push. On iPhone, add StudyTrack to your Home Screen
          (Share, then Add to Home Screen) and open it from there.
        </p>
      ) : blocked ? (
        <p style={{ fontSize: '13px', opacity: 0.7 }}>
          Notifications are blocked for this site. Allow them in your browser's site settings, then
          come back here.
        </p>
      ) : (
        <div className="glass-toggle-row">
          <div className="glass-toggle-text">
            <strong>Push notifications on this device</strong>
            <span>{on ? 'You will be notified of nudges.' : 'Currently off.'}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Push notifications"
            disabled={busy}
            className={`glass-switch ${on ? 'on' : ''}`}
            onClick={toggle}
          >
            <span className="glass-switch-knob" />
            <span className="glass-switch-label">{busy ? '…' : on ? 'On' : 'Off'}</span>
          </button>
        </div>
      )}

      {error && (
        <p className="danger-text" style={{ marginTop: '10px', fontSize: '13px' }}>
          {error}
        </p>
      )}
    </div>
  );
}
