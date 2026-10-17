import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { listMyGroups, newestMessageAt, countUnreadMessages } from '../lib/api';
import { loadChatSound, saveChatSound, playChatPing } from './chatSound';

/**
 * Call ONCE in App. Watches every group you are in, on every page, so it can
 *   - count unread messages per group (and in total, for the sidebar bubble)
 *   - play the ping when someone else writes
 *
 *   const notify = useChatNotifications();
 *   notify.unread[groupId]   notify.total   notify.soundOn   notify.toggleSound()
 *   notify.markRead(groupId, newestMessageTime)   notify.setChatOpen(groupId, true|false)
 */
const EPOCH = '1970-01-01T00:00:00.000Z';
const keyFor = (g) => `studytrack-chat-read:${g}`;

const getLastRead = (g) => {
  try { return localStorage.getItem(keyFor(g)); } catch { return null; }
};
const saveLastRead = (g, iso) => {
  if (!iso) return;
  const cur = getLastRead(g);
  if (cur && Date.parse(cur) >= Date.parse(iso)) return;   // never move backwards
  try { localStorage.setItem(keyFor(g), iso); } catch { /* storage unavailable */ }
};

export function useChatNotifications() {
  const { user } = useAuth();
  const [unread, setUnread] = useState({});
  const [soundOn, setSoundOn] = useState(loadChatSound);

  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;
  const openRef = useRef(new Set());   // groups whose chat panel is open right now
  const lastAtRef = useRef({});        // newest message time seen per group

  const markRead = useCallback((groupId, iso) => {
    setUnread((u) => (u[groupId] ? { ...u, [groupId]: 0 } : u));
    saveLastRead(groupId, iso ?? lastAtRef.current[groupId]);
  }, []);

  const setChatOpen = useCallback((groupId, isOpen) => {
    if (isOpen) openRef.current.add(groupId);
    else openRef.current.delete(groupId);
  }, []);

  /* unread counts when the app starts */
  useEffect(() => {
    if (!user) { setUnread({}); return undefined; }
    let active = true;
    (async () => {
      const groups = await listMyGroups().catch(() => []);
      const counts = {};
      for (const g of groups) {
        try {
          let last = getLastRead(g.id);
          if (!last) {                                  // first time here: old messages count as read
            last = (await newestMessageAt(g.id)) ?? EPOCH;
            saveLastRead(g.id, last);
          }
          counts[g.id] = await countUnreadMessages(g.id, last, user.id);
        } catch { counts[g.id] = 0; }
      }
      if (active) setUnread(counts);
    })();
    return () => { active = false; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* one live channel for ALL my groups (row-level security only sends me my groups' messages) */
  useEffect(() => {
    if (!user) return undefined;
    const channel = supabase
      .channel('chat-notify')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, (p) => {
        const m = p.new;
        lastAtRef.current[m.group_id] = m.created_at;
        if (m.user_id === user.id) return;                       // my own message

        const viewing = openRef.current.has(m.group_id) && document.visibilityState === 'visible';
        if (viewing) saveLastRead(m.group_id, m.created_at);     // I'm reading it right now
        else setUnread((u) => ({ ...u, [m.group_id]: (u[m.group_id] || 0) + 1 }));

        if (soundRef.current) playChatPing();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* coming back to the tab with a chat open = read */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      openRef.current.forEach((g) => markRead(g));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markRead]);

  const toggleSound = useCallback(() => {
    const next = !soundRef.current;
    setSoundOn(next);
    saveChatSound(next);
    if (next) playChatPing();                                    // quick preview when turning on
  }, []);

  const total = Object.values(unread).reduce((sum, n) => sum + n, 0);

  return { unread, total, soundOn, toggleSound, markRead, setChatOpen };
}
