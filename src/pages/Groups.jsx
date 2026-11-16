import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { createGroup, joinGroup, listMyGroups, leaveGroup, groupLeaderboard } from '../lib/api';
import { useMemberTimer } from '../hooks/useMemberTimer';
import { useGroupPresence } from '../hooks/useGroupPresence';
import { fmtDuration } from './Leaderboard';
import GroupChat from './GroupChat';
import { useGroupChat } from '../hooks/useGroupChat';
import { useLastSeen, useLastSeenHeartbeat, lastSeenInfo } from '../hooks/useLastSeen';
import './social.css';
import './groups-status.css';

const formatClock = (sec) =>
  `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/* small live-status chip shown next to each member */
function MemberStatus({ info, lastSeen }) {
  if (!info || info.state === 'idle') {
    const seen = lastSeenInfo(lastSeen);
    if (seen?.online) return <span className="st-status idle online">Online</span>;
    return <span className="st-status idle">{seen ? `Last seen ${seen.text}` : 'Not studying'}</span>;
  }
  const label = info.state === 'focus' ? 'Focusing' : 'On break';
  return (
    <span className={`st-status ${info.state}`}>
      {label} · {info.paused ? 'paused' : `${formatClock(info.remaining)} left`}
    </span>
  );
}

/* medals for the top 3; "–" while nobody has studied yet (avoids two #1s on a 0m tie) */
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const MEDAL_CLASS = { 1: 'gold', 2: 'silver', 3: 'bronze' };
function RankBadge({ rank, totalSec }) {
  if (!(totalSec > 0)) return <span className="st-rank none" title="No study time yet">–</span>;
  const medal = MEDALS[rank];
  return <span className={`st-rank ${medal ? MEDAL_CLASS[rank] : ''}`}>{medal || `#${rank}`}</span>;
}

/* round initial badge with a colour derived from the user id */
function Avatar({ name, id }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const hue = [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return <span className="st-avatar" style={{ '--h': hue }} aria-hidden="true">{initial}</span>;
}

function GroupRoom({ group, onLeave, notify }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const seen = useLastSeen(rows.map((r) => r.user_id));
  const [minutes, setMinutes] = useState(25);
  const [chatOpen, setChatOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(group.invite_code);
      setCopied(true);
    } catch { /* clipboard blocked: the code is still visible to select */ }
  };
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(id);
  }, [copied]);

  // leaving needs a second click within 3s so it can't happen by accident
  useEffect(() => {
    if (!confirmLeave) return undefined;
    const id = setTimeout(() => setConfirmLeave(false), 3000);
    return () => clearTimeout(id);
  }, [confirmLeave]);

  // chat lives here (not inside GroupChat) so the history stays loaded when you hide it
  const chat = useGroupChat(group.id);
  const unread = notify.unread[group.id] || 0;
  const newestAt = chat.messages.length ? chat.messages[chat.messages.length - 1].created_at : null;

  // tell the app-wide notifier whether this chat is open, and mark messages read while it is
  useEffect(() => {
    notify.setChatOpen(group.id, chatOpen);
    return () => notify.setChatOpen(group.id, false);
  }, [chatOpen, group.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (chatOpen && !chat.loading) notify.markRead(group.id, newestAt);
  }, [chatOpen, chat.loading, newestAt, group.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadBoard = useCallback(() => groupLeaderboard(group.id, 'week').then(setRows).catch(() => {}), [group.id]);

  // MY OWN timer: only I can start / pause / stop it
  const mine = useMemberTimer(group.id, { onSessionSaved: loadBoard });
  // live status of everybody in the group
  const presence = useGroupPresence(group.id);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  // refresh the totals when somebody starts or finishes a focus run
  const focusingKey = Object.entries(presence)
    .filter(([, p]) => p.state === 'focus')
    .map(([id]) => id)
    .sort()
    .join(',');
  useEffect(() => {
    const id = setTimeout(loadBoard, 1500); // small delay so the saved session is committed
    return () => clearTimeout(id);
  }, [focusingKey, loadBoard]);

  // for myself use the local timer so the chip reacts instantly
  const myInfo =
    mine.status === 'idle'
      ? { state: 'idle' }
      : { state: mine.mode, paused: mine.status === 'paused', remaining: mine.remaining };

  const stateLabel =
    mine.status === 'idle' ? 'Ready'
    : mine.status === 'paused' ? 'Paused'
    : mine.mode === 'focus' ? 'Focus' : 'Break';

  return (
    <div className="st-group glass">
      <div className="st-group-head">
        <div>
          <h3>{group.name}</h3>
          <div className="st-code-row">
            <small>Invite code: <code>{group.invite_code}</code></small>
            <button type="button" className="ghost st-copy" onClick={copyCode} aria-label="Copy invite code">
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        </div>
        <button
          className={`ghost st-leave${confirmLeave ? ' danger' : ''}`}
          onClick={() => (confirmLeave ? onLeave(group) : setConfirmLeave(true))}
        >
          {confirmLeave ? 'Confirm leave?' : 'Leave'}
        </button>
      </div>

      <div className="st-timer">
        <div className="st-clock">{formatClock(mine.remaining)}</div>
        <small>{stateLabel}</small>

        <div className="st-timer-controls">
          {mine.status === 'idle' && (
            <>
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {[15, 25, 35, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
              <button onClick={() => mine.start('focus', minutes)}>Start my focus</button>
              <button className="ghost" onClick={() => mine.start('break', 5)}>5 min break</button>
            </>
          )}
          {mine.status === 'running' && <button onClick={mine.pause}>Pause</button>}
          {mine.status === 'paused' && <button onClick={mine.resume}>Resume</button>}
          {mine.status !== 'idle' && (
            <button
              className="ghost"
              onClick={mine.stop}
              title={mine.mode === 'focus' ? 'Log the time you studied so far (needs at least 1 minute)' : 'Stop the break'}
            >
              {mine.mode === 'focus' ? 'Finish' : 'Stop'}
            </button>
          )}
        </div>
      </div>

      <div className="st-week-head">
        <h4>This week</h4>
        <span className="st-total">👥 {fmtDuration(rows.reduce((a, r) => a + Number(r.total_sec || 0), 0))} together</span>
      </div>
      <ol className="st-board compact">
        {rows.map((r) => {
          const isMe = r.user_id === user.id;
          return (
            <li key={r.user_id} className={isMe || r.is_me ? 'me' : ''}>
              <RankBadge rank={r.rank} totalSec={Number(r.total_sec)} />
              <Avatar name={r.display_name} id={r.user_id} />
              <span className="st-who">
                <strong>{r.display_name}{isMe && ' (you)'}</strong>
                <MemberStatus
                  info={isMe ? myInfo : presence[r.user_id]}
                  lastSeen={isMe ? new Date().toISOString() : seen[r.user_id]}
                />
              </span>
              <span className="st-time">{fmtDuration(Number(r.total_sec))}</span>
            </li>
          );
        })}
      </ol>

      <div className="st-chat-bar">
      <button className="ghost" onClick={() => setChatOpen((o) => !o)}>
        💬 {chatOpen ? 'Hide chat' : 'Group chat'}
        {!chatOpen && unread > 0 && <span className="st-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <button
        type="button"
        className="ghost st-sound-toggle"
        onClick={notify.toggleSound}
        title={notify.soundOn ? 'Chat sound on (click to mute)' : 'Chat sound off (click to turn on)'}
        aria-label={notify.soundOn ? 'Mute chat sound' : 'Turn on chat sound'}
      >
        {notify.soundOn ? '🔔' : '🔕'}
      </button>
      </div>
      {chatOpen && <GroupChat chat={chat} />}
    </div>
  );
}

export default function Groups({ notify }) {
  const { user } = useAuth();
  useLastSeenHeartbeat(); // better: move this call to the app-wide layout so it also runs on other pages
  const [groups, setGroups] = useState([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');

  const refresh = useCallback(() => listMyGroups().then(setGroups), []);
  useEffect(() => { refresh().catch((e) => setMsg(e.message)); }, [refresh]);

  const run = async (fn) => { try { setMsg(''); await fn(); await refresh(); } catch (e) { setMsg(e.message); } };

  return (
    <section className="st-page">
      <div className="page-header">
        <div>
          <h1>Study groups</h1>
          <p>Focus together. Everyone runs their own timer, and you can see who's studying live.</p>
        </div>
      </div>

      <div className="st-two">
        <form className="st-inline glass" onSubmit={(e) => { e.preventDefault(); run(() => createGroup(name)).then(() => setName('')); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name" />
          <button type="submit">Create</button>
        </form>
        <form className="st-inline glass" onSubmit={(e) => { e.preventDefault(); run(() => joinGroup(code)).then(() => setCode('')); }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Invite code" />
          <button type="submit">Join</button>
        </form>
      </div>
      {msg && <p className="st-error">{msg}</p>}

      {groups.map((g) => (
        <GroupRoom key={g.id} group={g} notify={notify} onLeave={(grp) => run(() => leaveGroup(grp.id, user.id))} />
      ))}
      {groups.length === 0 && <p className="st-muted">You're not in any group yet. Create one or paste an invite code.</p>}
    </section>
  );
}
