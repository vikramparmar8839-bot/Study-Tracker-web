import { useEffect, useState } from 'react';
import { friendsLeaderboard } from '../lib/api';
import './social.css';

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'all', label: 'All time' },
];

export const fmtDuration = (sec) => {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
};

const MEDALS = ['🥇', '🥈', '🥉'];

export default function Leaderboard() {
  const [period, setPeriod] = useState('week');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setRows(null);
    friendsLeaderboard(period)
      .then((r) => active && setRows(r))
      .catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [period]);

  const top = rows?.[0]?.total_sec ? Number(rows[0].total_sec) : 0;

  return (
    <section className="st-page">
      <div className="page-header">
        <div>
          <h1>Leaderboard</h1>
          <p>See how your study time stacks up against your friends.</p>
        </div>
      </div>

      <div className="st-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={period === t.key}
                  className={period === t.key ? 'active' : ''} onClick={() => setPeriod(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="st-error">{error}</p>}
      {!rows && !error && <p className="st-muted">Loading…</p>}

      {rows && rows.length === 1 && (
        <p className="st-muted">It's just you so far. Add friends from the Friends page to compete.</p>
      )}

      <ol className="st-board">
        {rows?.map((r) => (
          <li key={r.user_id} className={`st-row glass ${r.is_me ? 'me' : ''}`}>
            <span className="st-rank">{MEDALS[Number(r.rank) - 1] ?? `#${r.rank}`}</span>
            <span className="st-avatar">{r.avatar_url ? <img src={r.avatar_url} alt="" /> : r.display_name[0]}</span>
            <span className="st-who">
              <strong>{r.display_name}{r.is_me && ' (you)'}</strong>
              <small>@{r.username} · 🔥 {r.streak}</small>
            </span>
            <span className="st-bar"><i style={{ width: top ? `${(Number(r.total_sec) / top) * 100}%` : 0 }} /></span>
            <span className="st-time">{fmtDuration(Number(r.total_sec))}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
