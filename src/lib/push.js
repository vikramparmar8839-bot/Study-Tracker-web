// Web push helpers for StudyTrack. Lives next to supabaseClient.js.
import { supabase } from './supabaseClient';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

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

// True if this device already has a push subscription and permission is granted.
export async function isPushOn() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  return !!sub;
}

export async function enablePush() {
  if (!pushSupported()) {
    throw new Error('Push is not supported here. On iPhone, add StudyTrack to your Home Screen first.');
  }
  if (!VAPID_PUBLIC_KEY) throw new Error('Missing VITE_VAPID_PUBLIC_KEY in .env');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

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

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

// Call next to the live nudge. The server builds the title from the sender's profile.
export async function sendPush(toUserId, { message = '', groupName = '' } = {}) {
  try {
    const body = { to_user_id: toUserId, message, group_name: groupName };
    let { error } = await supabase.functions.invoke('send-push', { body });

    // A 401 usually means the access token expired (e.g. the tab was idle and the
    // background refresh was throttled). Refresh the session and try once more.
    if (error?.context?.status === 401) {
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError) {
        ({ error } = await supabase.functions.invoke('send-push', { body }));
      }
    }

    if (error) {
      // error.context is the raw Response; its body says whether the gateway or your function rejected it.
      let body = '';
      try { body = await error.context?.text?.(); } catch { /* ignore */ }
      console.warn('push failed', error, body);
    }
  } catch (e) {
    console.warn('push failed', e);
  }
}
