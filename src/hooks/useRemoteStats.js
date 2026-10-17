import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getMyStats, SESSION_SAVED_EVENT } from '../lib/api';

/**
 * Today / this week / streak from the database. Refreshes by itself
 * whenever a Focus session is saved.
 *
 *   const { todaySec, weekSec, streak, loaded } = useRemoteStats();
 */
export function useRemoteStats() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ todaySec: 0, weekSec: 0, streak: 0, loaded: false });

  const load = useCallback(() => {
    if (!user) return Promise.resolve();
    return getMyStats().then((s) => setStats({ ...s, loaded: true })).catch(() => {});
  }, [user]);

  useEffect(() => {
    load();
    window.addEventListener(SESSION_SAVED_EVENT, load);
    return () => window.removeEventListener(SESSION_SAVED_EVENT, load);
  }, [load]);

  return stats;
}
