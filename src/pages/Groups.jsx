import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { createGroup, joinGroup, listMyGroups, leaveGroup, groupLeaderboard, SESSION_SAVED_EVENT } from '../lib/api';
import { unlockAlarm } from '../lib/alarm';
import { useGroupPresence } from '../hooks/useGroupPresence';
import { fmtDuration } from './Leaderboard';
import GroupChat from './GroupChat';
import { useGroupChat } from '../hooks/useGroupChat';
import { useLastSeen, lastSeenInfo } from '../hooks/useLastSeen';
import { NudgeButton } from './Nudge';
import { Avatar } from './Avatar';
import './social.css';
import './groups-status.css';

const formatClock = (sec) =>
  `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/* small live-status chip shown next to each member */
export function MemberStatus({ info, lastSeen }) {
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

export { Avatar }; // re-export so older `import { Avatar } from './Groups'` still works

/* medals for the top 3; "–" while nobody has studied yet (avoids two #1s on a 0m tie) */
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const MEDAL_CLASS = { 1: 'gold', 2: 'silver', 3: 'bronze' };
export function RankBadge({ rank, totalSec }) {
  if (!(totalSec > 0)) return <span className="st-rank none" title="No study time yet">–</span>;
  const medal = MEDALS[rank];
  return <span className={`st-rank ${medal ? MEDAL_CLASS[rank] : ''}`}>{medal || `#${rank}`}</span>;
}

function GroupRoom({ group, onLeave, notify, pomodoro }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const seen = useLastSeen(rows.map((r) => r.user_id));
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

  // MY timer is the same Pomodoro timer as on the Dashboard; it just gets attached to this group
  const attached = pomodoro.groupId === group.id;
  const live = pomodoro.locked; // my status is broadcast to every group, so it is live in all of them
  const busyElsewhere = pomodoro.locked && !attached; // controls stay with the group that counts the time

  // refresh the board as soon as my session is saved
  useEffect(() => {
    window.addEventListener(SESSION_SAVED_EVENT, loadBoard);
    return () => window.removeEventListener(SESSION_SAVED_EVENT, loadBoard);
  }, [loadBoard]);

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
  const myInfo = live
    ? { state: pomodoro.phase === 'focus' ? 'focus' : 'break', paused: !pomodoro.running, remaining: pomodoro.remaining }
    : { state: 'idle' };

  const stateLabel =
    busyElsewhere ? 'Your timer is running (controls are in the group it counts for)'
    : !live ? 'Ready'
    : !pomodoro.running ? 'Paused'
    : pomodoro.phase === 'focus' ? 'Focus' : 'Break';

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
        <div className="st-clock">{formatClock(busyElsewhere ? 0 : pomodoro.remaining)}</div>
        <small>{stateLabel}</small>

        {!busyElsewhere && (
          <div className="st-timer-controls">
            {!pomodoro.locked && pomodoro.phase === 'focus' && (
              <select
                value={pomodoro.settings.focus}
                onChange={(e) => pomodoro.update('focus')(Number(e.target.value))}
              >
                {[...new Set([15, 25, 35, 45, 60, 90, pomodoro.settings.focus])]
                  .sort((a, b) => a - b)
                  .map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            )}
            {!pomodoro.running && (
              <button onClick={() => { unlockAlarm(); pomodoro.setGroupId(group.id); pomodoro.start(); }}>
                {live ? 'Resume' : pomodoro.phase === 'focus' ? 'Start my focus' : 'Start break'}
              </button>
            )}
            {pomodoro.running && <button onClick={pomodoro.pause}>Pause</button>}
            {!pomodoro.locked && pomodoro.phase === 'focus' && (
              <button
                className="ghost"
                onClick={() => { unlockAlarm(); pomodoro.setGroupId(group.id); pomodoro.goTo('short', true); }}
              >
                {pomodoro.settings.short} min break
              </button>
            )}
            {!pomodoro.locked && pomodoro.phase !== 'focus' && (
              <button className="ghost" onClick={() => pomodoro.goTo('focus', false)}>Back to focus</button>
            )}
            {live && pomodoro.phase === 'focus' && (
              <button
                className="ghost"
                onClick={pomodoro.finishEarly}
                disabled={pomodoro.elapsed < 60}
                title="Log the time you studied so far (needs at least 1 minute)"
              >
                Finish
              </button>
            )}
            {live && <button className="ghost" onClick={pomodoro.reset}>{pomodoro.phase === 'focus' ? 'Reset' : 'Stop'}</button>}
          </div>
        )}
      </div>

      <div className="st-week-head">
        <h4>This week</h4>
        <span className="st-total">👥 {fmtDuration(rows.reduce((a, r) => a + Number(r.total_sec || 0), 0))} together</span>
      </div>
      <ol className="st-board compact">
        {rows.map((r) => {
          const isMe = r.user_id === user.id;
          const info = isMe ? myInfo : presence[r.user_id];
          const lastSeen = isMe ? new Date().toISOString() : seen[r.user_id];
          const ring = info && info.state !== 'idle'
            ? info.state
            : lastSeenInfo(lastSeen)?.online ? 'online' : 'offline';
          return (
            <li key={r.user_id} className={isMe || r.is_me ? 'me' : ''}>
              <RankBadge rank={r.rank} totalSec={Number(r.total_sec)} />
              <Avatar name={r.display_name} id={r.user_id} status={ring} />
              <span className="st-who">
                <strong>{r.display_name}{isMe && ' (you)'}</strong>
                <MemberStatus info={info} lastSeen={lastSeen} />
              </span>
              <span className="st-time">{fmtDuration(Number(r.total_sec))}</span>
              {!isMe && (
                <NudgeButton
                  toId={r.user_id}
                  toName={r.display_name}
                  myName={rows.find((x) => x.user_id === user.id)?.display_name}
                  groupName={group.name}
                />
              )}
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
      {chatOpen && <GroupChat chat={chat} presence={presence} seen={seen} />}
    </div>
  );
}

export default function Groups({ notify, pomodoro }) {
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
        <GroupRoom key={g.id} group={g} notify={notify} pomodoro={pomodoro} onLeave={(grp) => run(() => leaveGroup(grp.id, user.id))} />
      ))}
      {groups.length === 0 && <p className="st-muted">You're not in any group yet. Create one or paste an invite code.</p>}
    </section>
  );
}
