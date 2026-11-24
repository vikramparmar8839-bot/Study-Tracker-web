import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listMyGroups, groupLeaderboard } from '../lib/api';
import { useGroupPresence } from '../hooks/useGroupPresence';
import { useLastSeen, useLastSeenHeartbeat, lastSeenInfo } from '../hooks/useLastSeen';
import { fmtDuration } from './Leaderboard';
import GroupChat from './GroupChat';
import { useGroupChat } from '../hooks/useGroupChat';
import { Avatar, RankBadge, MemberStatus } from './Groups';
import { NudgeButton } from './Nudge';

const VISIBLE = 3;

/* see-through buttons: a faint tint and a light outline instead of the dark fill */
const GLASS_BTN = {
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.28)',
  boxShadow: 'none',
};

/* one line saying where you stand: the reason to look at this card instead of the Groups page */
function gapMessage(rows, meId) {
  const me = rows.find((r) => r.user_id === meId);
  if (!me || rows.length < 2) return 'Invite a friend to compete with.';
  const mine = Number(me.total_sec || 0);
  const best = Math.max(...rows.map((r) => Number(r.total_sec || 0)));
  if (best === 0) return 'Nobody has studied yet. Start a session to take the lead.';

  const ahead = rows.filter((r) => Number(r.rank) < Number(me.rank));
  if (ahead.length === 0) {
    const others = rows.filter((r) => r.user_id !== meId)
      .sort((a, b) => Number(b.total_sec || 0) - Number(a.total_sec || 0));
    const second = others[0];
    const lead = mine - Number(second.total_sec || 0);
    return lead > 0
      ? `You're ${fmtDuration(lead)} ahead of ${second.display_name}. Keep the lead.`
      : `You're tied with ${second.display_name}. One session breaks it.`;
  }
  const next = ahead[ahead.length - 1]; // the person directly above me
  const behind = Number(next.total_sec || 0) - mine;
  return `${fmtDuration(behind)} behind ${next.display_name}. One focus session closes the gap.`;
}

/* top 3, or top 2 plus me when I'm ranked lower */
function pickVisible(rows, meId) {
  const top = rows.slice(0, VISIBLE);
  if (top.some((r) => r.user_id === meId)) return top;
  const me = rows.find((r) => r.user_id === meId);
  return me ? [...rows.slice(0, VISIBLE - 1), me] : top;
}

/* compact ranking + live status for ONE group */
function GroupBody({ group, notify, onOpen, switcher }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const seen = useLastSeen(rows.map((r) => r.user_id));
  const presence = useGroupPresence(group.id);

  /* chat right inside the dashboard card (same chat as the Study Groups page) */
  const [chatOpen, setChatOpen] = useState(false);
  const [expanded, setExpanded] = useState(false); // show every member right here
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
  const shown = expanded ? rows : pickVisible(rows, user.id);
  const hidden = rows.length - VISIBLE; // members beyond the compact view

  return (
    <>
      {/* one row: group switcher (or the group's name) on the left, weekly total on the right */}
      <div className="st-week-head" style={{ margin: '0 0 12px' }}>
        {switcher || <h4 style={{ margin: 0 }}>{group.name}</h4>}
        <span className="st-total">👥 {fmtDuration(total)} together this week</span>
      </div>

      {rows.length > 0 && (
        <p
          role="status"
          style={{
            margin: '0 0 12px',
            padding: '10px 14px',
            borderRadius: 14,
            fontSize: '0.9rem',
            fontWeight: 600,
            color: '#c9f7e1',
            background: 'rgba(94, 234, 168, 0.07)',
            border: '1px solid rgba(94, 234, 168, 0.2)',
          }}
        >
          {gapMessage(rows, user.id)}
        </p>
      )}

      <ol className="st-board compact">
        {shown.map((r) => {
          const isMe = r.user_id === user.id;
          const info = presence[r.user_id];
          const lastSeen = isMe ? new Date().toISOString() : seen[r.user_id];
          const active = info && info.state !== 'idle';
          const online = lastSeenInfo(lastSeen)?.online;
          const ring = active ? info.state : online ? 'online' : 'offline';
          return (
            <li key={r.user_id} className={isMe || r.is_me ? 'me' : ''}>
              <RankBadge rank={r.rank} totalSec={Number(r.total_sec)} />
              <Avatar name={r.display_name} id={r.user_id} status={ring} />
              <span className="st-who">
                <strong>{r.display_name}{isMe && ' (you)'}</strong>
                {/* compact view: chip only when studying or online. Expanded: "Last seen" too */}
                {(active || online || expanded) && <MemberStatus info={info} lastSeen={lastSeen} />}
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
      {rows.length === 0 && <p className="st-muted">No study time in this group yet.</p>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        <button type="button" className="secondary-button" style={GLASS_BTN} onClick={() => setChatOpen((o) => !o)}>
          💬 {chatOpen ? 'Hide chat' : 'Group chat'}
          {!chatOpen && unread > 0 && <span className="st-badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              minHeight: 44,
              padding: '0 4px',
              border: 0,
              background: 'transparent',
              color: '#aab4ff',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {expanded ? 'Show less' : `+${hidden} more ${hidden === 1 ? 'member' : 'members'}`}
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
            >
              <path d="M3 5l4 4 4-4" />
            </svg>
          </button>
        )}
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

/* Dashboard card: takes the place of "Subject Overview" (same panel, same width).
   Chat opens right here; the timer lives on the Study Groups page ("Open groups"). */
export default function DashboardGroupCard({ notify, onOpen }) {
  useLastSeenHeartbeat(); // keeps you shown as "Online" while you are on the dashboard
  const [groups, setGroups] = useState(null); // null = still loading
  const [activeId, setActiveId] = useState(null);

  useEffect(() => { listMyGroups().then(setGroups).catch(() => setGroups([])); }, []);

  const current = groups?.find((g) => g.id === activeId) || groups?.[0] || null;

  const switcher = groups && groups.length > 1 && current ? (
    <div
      className="pomo-tabs"
      role="tablist"
      aria-label="Your groups"
      style={{ width: 'fit-content', maxWidth: '100%', overflowX: 'auto', background: 'transparent', border: '1px solid rgba(255, 255, 255, 0.2)', boxShadow: 'none' }}
    >
      {groups.map((g) => (
        <button
          key={g.id}
          type="button"
          role="tab"
          aria-selected={g.id === current.id}
          className={g.id === current.id ? 'pomo-tab active' : 'pomo-tab'}
          style={{
            background: g.id === current.id ? 'rgba(255, 255, 255, 0.14)' : 'transparent',
            border: g.id === current.id ? '1px solid rgba(255, 255, 255, 0.3)' : '1px solid transparent',
            boxShadow: 'none',
          }}
          onClick={() => setActiveId(g.id)}
        >
          {g.name}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <section className="panel">
      <div className="panel-header" style={{ alignItems: 'center' }}>
        <div>
          <h2>Study Group</h2>
        </div>
        <button type="button" className="secondary-button" style={GLASS_BTN} onClick={onOpen}>Open groups</button>
      </div>

      {groups === null && <p className="st-muted">Loading your groups…</p>}

      {groups && groups.length === 0 && (
        <p className="st-muted">
          You're not in any group yet. Open Study Groups to create one or join with an invite code.
        </p>
      )}

      {current && (
        <>
          <GroupBody key={current.id} group={current} notify={notify} onOpen={onOpen} switcher={switcher} />
        </>
      )}
    </section>
  );
}
