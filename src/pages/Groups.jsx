import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { createGroup, joinGroup, listMyGroups, leaveGroup, groupLeaderboard } from '../lib/api';
import { useMemberTimer } from '../hooks/useMemberTimer';
import { useGroupPresence } from '../hooks/useGroupPresence';
import { fmtDuration } from './Leaderboard';
import GroupChat from './GroupChat';
import { useGroupChat } from '../hooks/useGroupChat';
import './social.css';
import './groups-status.css';

const formatClock = (sec) =>
  `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/* small live-status chip shown next to each member */
function MemberStatus({ info }) {
  if (!info || info.state === 'idle') return <span className="st-status idle">Not studying</span>;
  const label = info.state === 'focus' ? '🔥 Focusing' : '☕ On break';
  return (
    <span className={`st-status ${info.state}`}>
      {label} · {info.paused ? 'paused' : `${formatClock(info.remaining)} left`}
    </span>
  );
}

function GroupRoom({ group, onLeave, notify }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [minutes, setMinutes] = useState(25);
  const [chatOpen, setChatOpen] = useState(false);

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
          <small>Invite code: <code>{group.invite_code}</code></small>
        </div>
        <button className="ghost" onClick={() => onLeave(group)}>Leave</button>
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

      <h4>This week</h4>
      <ol className="st-board compact">
        {rows.map((r) => {
          const isMe = r.user_id === user.id;
          return (
            <li key={r.user_id} className={r.is_me ? 'me' : ''}>
              <span className="st-rank">#{r.rank}</span>
              <span className="st-who">
                <strong>{r.display_name}{isMe && ' (you)'}</strong>
                <MemberStatus info={isMe ? myInfo : presence[r.user_id]} />
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
