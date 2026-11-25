import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { listGroupMessages, sendGroupMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const TYPING_TTL_MS = 4000;     // hide "typing" this long after the last signal
const TYPING_THROTTLE_MS = 2000; // send at most one signal this often

/**
 * Live chat for one group.
 *   const { messages, send, loading, error, typingNames, notifyTyping } = useGroupChat(groupId);
 *
 * typingNames  -> names of other members typing right now
 * notifyTyping(myName) -> call while the user types (throttled inside)
 */
export function useGroupChat(groupId) {
  const { user } = useAuth();
  const myId = user?.id;
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typing, setTyping] = useState({}); // userId -> display name

  const channelRef = useRef(null);
  const readyRef = useRef(false);
  const timersRef = useRef({});
  const lastSentRef = useRef(0);

  // add a message once (realtime and the send() reply can both deliver the same one)
  const add = useCallback((m) => {
    setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
  }, []);

  useEffect(() => {
    if (!groupId) return undefined;
    let active = true;
    setMessages([]);
    setLoading(true);
    setError('');
    setTyping({});

    const clearTyping = (uid) => {
      clearTimeout(timersRef.current[uid]);
      delete timersRef.current[uid];
      setTyping((t) => {
        if (!(uid in t)) return t;
        const next = { ...t };
        delete next[uid];
        return next;
      });
    };

    listGroupMessages(groupId)
      .then((rows) => {
        if (!active) return;
        // keep anything realtime delivered while we were loading
        setMessages((prev) => {
          const seen = new Set(rows.map((r) => r.id));
          return [...rows, ...prev.filter((p) => !seen.has(p.id))];
        });
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));

    const channel = supabase
      .channel(`group-chat-${groupId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
        (p) => {
          if (!active) return;
          add(p.new);
          clearTyping(p.new.user_id); // their message arrived, so they are done typing
        })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!active || !payload?.user_id || payload.user_id === myId) return;
        const uid = payload.user_id;
        setTyping((t) => ({ ...t, [uid]: payload.name || 'Someone' }));
        clearTimeout(timersRef.current[uid]);
        timersRef.current[uid] = setTimeout(() => clearTyping(uid), TYPING_TTL_MS);
      })
      .subscribe((status) => { readyRef.current = status === 'SUBSCRIBED'; });

    channelRef.current = channel;

    return () => {
      active = false;
      readyRef.current = false;
      channelRef.current = null;
      Object.values(timersRef.current).forEach(clearTimeout);
      timersRef.current = {};
      supabase.removeChannel(channel);
    };
  }, [groupId, add, myId]);

  const send = useCallback(async (text) => {
    setError('');
    try {
      const row = await sendGroupMessage(groupId, text);
      if (row) add(row);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }, [groupId, add]);

  // tell the others I am typing (at most once every 2s)
  const notifyTyping = useCallback((name) => {
    const now = Date.now();
    if (!readyRef.current || !channelRef.current || now - lastSentRef.current < TYPING_THROTTLE_MS) return;
    lastSentRef.current = now;
    channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { user_id: myId, name } });
  }, [myId]);

  return { messages, send, loading, error, typingNames: Object.values(typing), notifyTyping };
}
