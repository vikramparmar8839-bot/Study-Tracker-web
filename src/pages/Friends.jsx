import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listFriendships, sendFriendRequest, respondToRequest, removeFriendship } from '../lib/api';
import './social.css';

export default function Friends() {
  const { user } = useAuth();
  const [data, setData] = useState({ friends: [], incoming: [], outgoing: [] });
  const [username, setUsername] = useState('');
  const [msg, setMsg] = useState({ type: '', text: '' });

  const refresh = useCallback(() => listFriendships(user.id).then(setData), [user.id]);
  useEffect(() => { refresh().catch((e) => setMsg({ type: 'error', text: e.message })); }, [refresh]);

  const run = async (fn, okText) => {
    try { await fn(); setMsg({ type: 'ok', text: okText }); await refresh(); }
    catch (e) { setMsg({ type: 'error', text: e.message }); }
  };

  return (
    <section className="st-page">
      <div className="page-header">
        <div>
          <h1>Friends</h1>
          <p>Add friends by username to compare study time.</p>
        </div>
      </div>

      <form className="st-inline glass" onSubmit={(e) => {
        e.preventDefault();
        if (!username.trim()) return;
        run(() => sendFriendRequest(username.replace(/^@/, '')), 'Request sent').then(() => setUsername(''));
      }}>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Friend's username" />
        <button type="submit">Send request</button>
      </form>
      {msg.text && <p className={msg.type === 'error' ? 'st-error' : 'st-ok'}>{msg.text}</p>}

      {data.incoming.length > 0 && (
        <>
          <h2>Requests</h2>
          <ul className="st-list">
            {data.incoming.map((p) => (
              <li key={p.requestId} className="glass">
                <span><strong>{p.display_name}</strong> <small>@{p.username}</small></span>
                <span>
                  <button onClick={() => run(() => respondToRequest(p.requestId, true), 'Friend added')}>Accept</button>
                  <button className="ghost" onClick={() => run(() => respondToRequest(p.requestId, false), 'Request declined')}>Decline</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Your friends ({data.friends.length})</h2>
      <ul className="st-list">
        {data.friends.map((f) => (
          <li key={f.friendshipId} className="glass">
            <span><strong>{f.display_name}</strong> <small>@{f.username}</small></span>
            <button className="ghost" onClick={() => run(() => removeFriendship(f.friendshipId), 'Friend removed')}>Remove</button>
          </li>
        ))}
        {data.friends.length === 0 && <li className="st-muted">No friends yet.</li>}
      </ul>

      {data.outgoing.length > 0 && (
        <>
          <h2>Sent requests</h2>
          <ul className="st-list">
            {data.outgoing.map((p) => (
              <li key={p.requestId} className="glass">
                <span><strong>{p.display_name}</strong> <small>@{p.username} · pending</small></span>
                <button className="ghost" onClick={() => run(() => removeFriendship(p.requestId), 'Request cancelled')}>Cancel</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
