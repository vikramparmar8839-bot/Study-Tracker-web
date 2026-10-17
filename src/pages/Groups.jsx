import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { createGroup, joinGroup, listMyGroups, leaveGroup, groupLeaderboard } from '../lib/api';
import { useGroupTimer, formatClock } from '../hooks/useGroupTimer';
import { fmtDuration } from './Leaderboard';
import './social.css';

function GroupRoom({ group, onLeave }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [minutes, setMinutes] = useState(25);

  const loadBoard = useCallback(() => groupLeaderboard(group.id, 'week').then(setRows).catch(() => {}), [group.id]);
  const { remaining, status, timer, start, pause, resume, stop } = useGroupTimer(group.id, { onSessionSaved: loadBoard });

  useEffect(() => { loadBoard(); }, [loadBoard]);

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
        <div className="st-clock">{formatClock(remaining)}</div>
        <small>{status === 'idle' ? 'Ready' : status === 'finished' ? 'Finished' : `${timer?.mode} · ${status}`}</small>

        <div className="st-timer-controls">
          {(status === 'idle' || status === 'finished') && (
            <>
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {[15, 25, 35, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
              <button onClick={() => start('focus', minutes)}>Start focus for everyone</button>
              <button className="ghost" onClick={() => start('short', 5)}>5 min break</button>
            </>
          )}
          {status === 'running' && <button onClick={pause}>Pause</button>}
          {status === 'paused' && <button onClick={resume}>Resume</button>}
          {(status === 'running' || status === 'paused') && <button className="ghost" onClick={stop}>Stop</button>}
        </div>
      </div>

      <h4>This week</h4>
      <ol className="st-board compact">
        {rows.map((r) => (
          <li key={r.user_id} className={r.is_me ? 'me' : ''}>
            <span className="st-rank">#{r.rank}</span>
            <span className="st-who"><strong>{r.display_name}{r.user_id === user.id && ' (you)'}</strong></span>
            <span className="st-time">{fmtDuration(Number(r.total_sec))}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function Groups() {
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
          <p>Start a shared timer and focus together.</p>
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
        <GroupRoom key={g.id} group={g} onLeave={(grp) => run(() => leaveGroup(grp.id, user.id))} />
      ))}
      {groups.length === 0 && <p className="st-muted">You're not in any group yet. Create one or paste an invite code.</p>}
    </section>
  );
}
