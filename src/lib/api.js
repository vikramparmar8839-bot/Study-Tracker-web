import { supabase } from './supabaseClient';

export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

const unwrap = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

/* ---------------- study sessions ---------------- */

export const SESSION_SAVED_EVENT = 'studytrack-session-saved';
const PENDING_KEY = 'studytrack-pending-sessions';

/** Save a finished Focus session. Server recomputes duration and rejects cheating. */
export const saveSession = ({ id, startedAt, endedAt, subject = null, groupId = null }) =>
  supabase
    .from('study_sessions')
    .insert({
      ...(id ? { id } : {}),
      started_at: new Date(startedAt).toISOString(),
      ended_at: new Date(endedAt).toISOString(),
      subject: subject || null,
      group_id: groupId,
    })
    .select()
    .single()
    .then(unwrap);

/* ---- offline-safe saving for the Pomodoro timer ---- */

const readPending = () => {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; } catch { return []; }
};
const writePending = (list) => {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
};

async function trySend(entry) {
  const { error } = await supabase.from('study_sessions').insert({
    id: entry.id,
    started_at: new Date(entry.startedAt).toISOString(),
    ended_at: new Date(entry.endedAt).toISOString(),
    subject: entry.subject || null,
  });
  if (!error) return 'saved';
  if (error.code === '23505') return 'saved';       // already stored earlier (retry after a lost response)
  if (error.code) return 'rejected';                // server said no (validation/RLS): retrying will not help
  return 'retry';                                   // network problem: try again later
}

/**
 * Call when a Focus session finishes. Safe to call when logged out or offline:
 * the session is kept on the device and sent on the next login / page load.
 */
export async function saveFocusSession({ subject = '', seconds }) {
  if (!seconds || seconds < 60) return;
  const endedAt = Date.now();
  const entry = {
    id: crypto.randomUUID(),
    startedAt: endedAt - seconds * 1000,
    endedAt,
    subject,
  };

  const { data } = await supabase.auth.getSession();
  if (!data.session) {                              // not logged in yet: keep it for later
    writePending([...readPending(), entry]);
    return;
  }
  const result = await trySend(entry);
  if (result === 'retry') writePending([...readPending(), entry]);
  if (result === 'saved') window.dispatchEvent(new Event(SESSION_SAVED_EVENT));
}

/** Send any sessions that could not be saved earlier. Called automatically after login. */
export async function flushPendingSessions() {
  const pending = readPending();
  if (!pending.length) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;

  const keep = [];
  let savedAny = false;
  for (const entry of pending) {
    const result = await trySend(entry);
    if (result === 'retry') keep.push(entry);
    if (result === 'saved') savedAny = true;
  }
  writePending(keep);
  if (savedAny) window.dispatchEvent(new Event(SESSION_SAVED_EVENT));
}

/** Numbers for the dashboard cards: today, this week, streak. */
export async function getMyStats() {
  const rows = await supabase.rpc('my_stats', { p_tz: TZ }).then(unwrap);
  const r = rows?.[0] ?? {};
  return {
    todaySec: Number(r.today_sec ?? 0),
    weekSec: Number(r.week_sec ?? 0),
    streak: r.streak ?? 0,
  };
}

/* ---------------- leaderboards ---------------- */

export const friendsLeaderboard = (period = 'week') =>
  supabase.rpc('friends_leaderboard', { p_period: period, p_tz: TZ }).then(unwrap);

export const groupLeaderboard = (groupId, period = 'week') =>
  supabase.rpc('group_leaderboard', { p_group: groupId, p_period: period, p_tz: TZ }).then(unwrap);

/* ---------------- friends ---------------- */

export const sendFriendRequest = (username) =>
  supabase.rpc('send_friend_request', { p_username: username }).then(unwrap);

export const respondToRequest = (id, accept) =>
  supabase.rpc('respond_friend_request', { p_id: id, p_accept: accept }).then(unwrap);

export const removeFriendship = (id) =>
  supabase.from('friendships').delete().eq('id', id).then(unwrap);

export async function listFriendships(myId) {
  const rows = await supabase
    .from('friendships')
    .select(`id, status, created_at, requester_id, receiver_id,
             requester:profiles!friendships_requester_id_fkey(id, username, display_name, avatar_url),
             receiver:profiles!friendships_receiver_id_fkey(id, username, display_name, avatar_url)`)
    .then(unwrap);

  return {
    friends: rows
      .filter((r) => r.status === 'accepted')
      .map((r) => ({ friendshipId: r.id, ...(r.requester_id === myId ? r.receiver : r.requester) })),
    incoming: rows.filter((r) => r.status === 'pending' && r.receiver_id === myId)
      .map((r) => ({ requestId: r.id, ...r.requester })),
    outgoing: rows.filter((r) => r.status === 'pending' && r.requester_id === myId)
      .map((r) => ({ requestId: r.id, ...r.receiver })),
  };
}

/* ---------------- groups ---------------- */

export const createGroup = (name) => supabase.rpc('create_group', { p_name: name }).then(unwrap);
export const joinGroup = (code) => supabase.rpc('join_group', { p_code: code }).then(unwrap);

export const listMyGroups = () =>
  supabase.from('groups').select('id, name, invite_code, owner_id, created_at').order('created_at').then(unwrap);

export const leaveGroup = (groupId, myId) =>
  supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', myId).then(unwrap);

/* ---------------- shared group timer ---------------- */

export const getGroupTimer = (groupId) =>
  supabase.from('group_timers').select('*').eq('group_id', groupId).maybeSingle().then(unwrap);

export const timerStart = (groupId, mode, durationSec) =>
  supabase.rpc('group_timer_start', { p_group: groupId, p_mode: mode, p_duration_sec: durationSec }).then(unwrap);
export const timerPause = (groupId) => supabase.rpc('group_timer_pause', { p_group: groupId }).then(unwrap);
export const timerResume = (groupId) => supabase.rpc('group_timer_resume', { p_group: groupId }).then(unwrap);
export const timerStop = (groupId) => supabase.rpc('group_timer_stop', { p_group: groupId }).then(unwrap);

export const getServerOffsetMs = async () => {
  const t0 = Date.now();
  const serverIso = await supabase.rpc('server_now').then(unwrap);
  const t1 = Date.now();
  return new Date(serverIso).getTime() - (t0 + t1) / 2; // add to Date.now() to get server time
};
