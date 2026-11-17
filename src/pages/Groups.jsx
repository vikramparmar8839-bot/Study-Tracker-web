import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { createGroup, joinGroup, listMyGroups, leaveGroup, groupLeaderboard, SESSION_SAVED_EVENT } from '../lib/api';
import { unlockAlarm } from '../lib/alarm';
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

/* medals for the top 3; "–" while nobody has studied yet (avoids two #1s on a 0m tie) */
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const MEDAL_CLASS = { 1: 'gold', 2: 'silver', 3: 'bronze' };
export function RankBadge({ rank, totalSec }) {
  if (!(totalSec > 0)) return <span className="st-rank none" title="No study time yet">–</span>;
  const medal = MEDALS[rank];
  return <span className={`st-rank ${medal ? MEDAL_CLASS[rank] : ''}`}>{medal || `#${rank}`}</span>;
}

/* stickman avatar, drawn as an inline SVG (no images, no storage).
   Everything about it is derived from the user id, so each person always gets the same one:
   hat (none / cap / beanie / spiky hair), idle pose (arms down / wave / cheer) and background colour.
   While studying he holds a book, on a break he holds a cup.
   Status ring: focus (pulsing indigo) · break (pulsing green) · online (steady green) · offline (dimmed) */
function Stickman({ n, status }) {
  const hat = Math.floor(n / 3) % 4;
  const pose = Math.floor(n / 11) % 3;
  const IDLE_ARMS = ['M20 20L13 26M20 20L27 26', 'M20 20L13 26M20 20L27 13', 'M20 20L13 13M20 20L27 13'];
  const soft = { fill: 'currentColor', fillOpacity: 0.25 };
  return (
    <svg
      viewBox="0 0 40 40"
      width="100%"
      height="100%"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* body + legs */}
      <path d="M20 17V27M20 27L14 35M20 27L26 35" />

      {/* arms (and what he is holding) */}
      {status === 'focus' ? (
        <>
          <path d="M20 20L15 25M20 20L25 25" />
          <rect x="14" y="23" width="12" height="7" rx="1.2" strokeWidth="1.6" {...soft} />
          <path d="M20 23V30" strokeWidth="1.2" />
        </>
      ) : status === 'break' ? (
        <>
          <path d="M20 20L13 26M20 20L26 22" />
          <path d="M25 15h6v5.5a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z" strokeWidth="1.5" {...soft} />
        </>
      ) : (
        <path d={IDLE_ARMS[pose]} />
      )}

      {/* head + face */}
      <circle cx="20" cy="12" r="5" />
      <circle cx="18.2" cy="11.3" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="21.8" cy="11.3" r="0.9" fill="currentColor" stroke="none" />
      {status === 'focus'
        ? <path d="M18.6 14.2H21.4" strokeWidth="1.1" />
        : <path d="M18 13.5Q20 15.4 22 13.5" strokeWidth="1.1" />}

      {/* hat */}
      {hat === 1 && (
        <>
          <path d="M14.8 10.5A5.4 5.4 0 0 1 25.2 10.5Z" strokeWidth="1.6" {...soft} />
          <path d="M25 10.5H30" strokeWidth="1.8" />
        </>
      )}
      {hat === 2 && (
        <>
          <path d="M14.6 9.5Q20 2 25.4 9.5Z" strokeWidth="1.6" {...soft} />
          <circle cx="20" cy="4.4" r="1.3" fill="currentColor" stroke="none" />
        </>
      )}
      {hat === 3 && <path d="M17.5 7.2L16.5 4.2M20 6.8V3.6M22.5 7.2L23.5 4.2" strokeWidth="1.6" />}
    </svg>
  );
}

export function Avatar({ name, id, status }) {
  const n = [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span
      className={`st-avatar${status ? ` ring-${status}` : ''}`}
      style={{ '--h': n % 360 }}
      role="img"
      aria-label={name}
    >
      <Stickman n={n} status={status} />
    </span>
  );
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
  const live = attached && pomodoro.locked;
  const busyElsewhere = pomodoro.locked && !attached;

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
    busyElsewhere ? 'Your timer is running for another group (or just you)'
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

export default function Groups({ notify, pomodoro }) {
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
        <GroupRoom key={g.id} group={g} notify={notify} pomodoro={pomodoro} onLeave={(grp) => run(() => leaveGroup(grp.id, user.id))} />
      ))}
      {groups.length === 0 && <p className="st-muted">You're not in any group yet. Create one or paste an invite code.</p>}
    </section>
  );
}
