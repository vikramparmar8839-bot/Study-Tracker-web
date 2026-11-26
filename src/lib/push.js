// Web push helpers for StudyTrack. Lives next to supabaseClient.js.
import { supabase } from './supabaseClient';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// Set when the user switches push OFF on purpose, so the silent re-sync below never turns it back on.
const OPT_OUT_KEY = 'studytrack-push-off';
const SYNC_MIN_GAP_MS = 60_000;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

const optedOut = () => {
  try { return localStorage.getItem(OPT_OUT_KEY) === '1'; } catch { return false; }
};
const setOptedOut = (on) => {
  try {
    if (on) localStorage.setItem(OPT_OUT_KEY, '1');
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch { /* ignore */ }
};

// True if this device already has a push subscription and permission is granted.
export async function isPushOn() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  return !!sub;
}

/* Make sure this browser has a valid subscription AND that it is saved for the user who is
   signed in right now. Safe to run again and again (the RPC upserts by endpoint). */
async function subscribeAndSave() {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const appKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

  // An existing subscription is only valid for the VAPID key it was created with.
  // If the key changed since, drop it and subscribe again with the current key.
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const current = sub.options?.applicationServerKey;
    const same = current && new Uint8Array(current).toString() === appKey.toString();
    if (!same) {
      // Remove the stale row first so the old endpoint doesn't linger in the table.
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appKey,
    });
  }

  const json = sub.toJSON();
  // RPC (see push_subscriptions.sql) so a device can switch between accounts cleanly.
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
  });
  if (error) throw error;
}

export async function enablePush() {
  if (!pushSupported()) {
    throw new Error('Push is not supported here. On iPhone, add StudyTrack to your Home Screen first.');
  }
  if (!VAPID_PUBLIC_KEY) throw new Error('Missing VITE_VAPID_PUBLIC_KEY in .env');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  setOptedOut(false);
  await subscribeAndSave();
}

export async function disablePush() {
  setOptedOut(true); // remembered, so the silent re-sync leaves it off
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/* ---------- silent re-sync (no permission prompt) ----------
   Call this when the app opens, when a user signs in, and when the app comes back to the
   foreground. If permission is already granted and the user did not switch push off, it
   re-creates / re-saves the subscription for the CURRENT account, so nothing depends on
   having pressed a button after the last login. */
let syncInflight = null;
let lastSyncUser = '';
let lastSyncAt = 0;

export function syncPush(userId, { force = false } = {}) {
  if (!pushSupported() || !VAPID_PUBLIC_KEY) return Promise.resolve(false);
  if (Notification.permission !== 'granted' || optedOut()) return Promise.resolve(false);

  const who = userId || '';
  if (!force && who === lastSyncUser && Date.now() - lastSyncAt < SYNC_MIN_GAP_MS) {
    return Promise.resolve(true);
  }
  if (syncInflight) return syncInflight;

  syncInflight = subscribeAndSave()
    .then(() => {
      lastSyncUser = who;
      lastSyncAt = Date.now();
      return true;
    })
    .catch((e) => {
      console.warn('push sync failed', e);
      return false;
    })
    .finally(() => { syncInflight = null; });
  return syncInflight;
}

/* Call right before signing out: stops this device receiving the old account's pushes.
   The browser subscription stays, so the next sign-in re-links it via syncPush(). */
export async function unlinkPush() {
  lastSyncUser = '';
  lastSyncAt = 0;
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
}

// Call next to the live nudge. The server builds the title from the sender's profile.
export async function sendPush(toUserId, { message = '', groupName = '' } = {}) {
  try {
    const body = { to_user_id: toUserId, message, group_name: groupName };

    // getSession() refreshes an expired access token first, so an idle tab doesn't send a dead one.
    await supabase.auth.getSession().catch(() => {});
    let { error } = await supabase.functions.invoke('send-push', { body });

    // Still a 401? Force a refresh and try once more.
    if (error?.context?.status === 401) {
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError) {
        ({ error } = await supabase.functions.invoke('send-push', { body }));
      }
    }

    if (error) {
      // error.context is the raw Response; its body says whether the gateway or your function rejected it.
      let text = '';
      try { text = await error.context?.text?.(); } catch { /* ignore */ }
      console.warn('push failed', error, text);
    }
  } catch (e) {
    console.warn('push failed', e);
  }
}
