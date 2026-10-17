import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { listGroupMessages, sendGroupMessage } from '../lib/api';

/**
 * Live chat for one group.
 *   const { messages, send, loading, error } = useGroupChat(groupId);
 */
export function useGroupChat(groupId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
        (p) => active && add(p.new))
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [groupId, add]);

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

  return { messages, send, loading, error };
}
