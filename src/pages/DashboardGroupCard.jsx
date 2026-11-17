import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listMyGroups, groupLeaderboard } from '../lib/api';
import { useGroupPresence } from '../hooks/useGroupPresence';
import { useLastSeen, useLastSeenHeartbeat, lastSeenInfo } from '../hooks/useLastSeen';
import { fmtDuration } from './Leaderboard';
import GroupChat from './GroupChat';
import { useGroupChat } from '../hooks/useGroupChat';
import { Avatar, RankBadge, MemberStatus } from './Groups';

/* the ranking + live status for ONE group (same rows as the Study Groups page) */
function GroupBody({ group, notify, onOpen }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const seen = useLastSeen(rows.map((r) => r.user_id));
  const presence = useGroupPresence(group.id);

  /* chat right inside the dashboard card (same chat as the Study Groups page) */
  const [chatOpen, setChatOpen] = useState(false);
  const chat = useGroupChat(group.id);
  const unread = notify?.unread?.[group.id] || 0;
  const newestAt = chat.messages.length ? chat.messages[chat.messages.length - 1].created_at : null;

  // tell the app-wide notifier whether this chat is open, and mark messages read while it is
  useEffect(() => {
    notify?.setChatOpen(group.id, chatOpen);
    return () => notify?.setChatOpen(group.id, false);
  }, [chatOpen, group.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (chatOpen && !chat.loading) notify?.markRead(group.id, newestAt);
  }, [chatOpen, chat.loading, newestAt, group.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadBoard = useCallback(
    () => groupLeaderboard(group.id, 'week').then(setRows).catch(() => {}),
    [group.id],
  );
  useEffect(() => { loadBoard(); }, [loadBoard]);

  // refresh the totals when somebody starts or finishes a focus run
  const focusingKey = Object.entries(presence)
    .filter(([, p]) => p.state === 'focus')
    .map(([id]) => id)
    .sort()
    .join(',');
  useEffect(() => {
    const id = setTimeout(loadBoard, 1500);
    return () => clearTimeout(id);
  }, [focusingKey, loadBoard]);

  const total = rows.reduce((a, r) => a + Number(r.total_sec || 0), 0);

  return (
    <>
      <div className="st-week-head" style={{ marginTop: 6 }}>
        <h4 style={{ margin: 0 }}>{group.name} · This week</h4>
        <span className="st-total">👥 {fmtDuration(total)} together</span>
      </div>

      <ol className="st-board compact">
        {rows.map((r) => {
          const isMe = r.user_id === user.id;
          const info = presence[r.user_id];
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
      {rows.length === 0 && <p className="st-muted">No study time in this group yet.</p>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
        <button type="button" className="secondary-button" onClick={onOpen}>
          ▶ Open group timer
        </button>
        <button type="button" className="secondary-button" onClick={() => setChatOpen((o) => !o)}>
          💬 {chatOpen ? 'Hide chat' : 'Group chat'}
          {!chatOpen && unread > 0 && <span className="st-badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
      </div>

      {chatOpen && (
        /* .st-page gives the chat input, Send and emoji buttons their usual look */
        <div className="st-page" style={{ marginTop: 14 }}>
          <GroupChat chat={chat} />
        </div>
      )}
    </>
  );
}

/* Dashboard card: takes the place of "Subject Overview" (same panel, same width) */
export default function DashboardGroupCard({ notify, onOpen }) {
  useLastSeenHeartbeat(); // keeps you shown as "Online" while you are on the dashboard
  const [groups, setGroups] = useState(null); // null = still loading
  const [activeId, setActiveId] = useState(null);

  useEffect(() => { listMyGroups().then(setGroups).catch(() => setGroups([])); }, []);

  const current = groups?.find((g) => g.id === activeId) || groups?.[0] || null;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Study Group</h2>
          <p>See who is studying right now and how your group is doing this week.</p>
        </div>
        <button type="button" className="secondary-button" onClick={onOpen}>Open groups</button>
      </div>

      {groups === null && <p className="st-muted">Loading your groups…</p>}

      {groups && groups.length === 0 && (
        <p className="st-muted">
          You're not in any group yet. Open Study Groups to create one or join with an invite code.
        </p>
      )}

      {current && (
        <>
          {groups.length > 1 && (
            <div
              className="pomo-tabs"
              role="tablist"
              aria-label="Your groups"
              style={{ width: 'fit-content', maxWidth: '100%', overflowX: 'auto', marginBottom: 14 }}
            >
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="tab"
                  aria-selected={g.id === current.id}
                  className={g.id === current.id ? 'pomo-tab active' : 'pomo-tab'}
                  onClick={() => setActiveId(g.id)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
          <GroupBody
            key={current.id}
            group={current}
            notify={notify}
            onOpen={onOpen}
          />
        </>
      )}
    </section>
  );
}
