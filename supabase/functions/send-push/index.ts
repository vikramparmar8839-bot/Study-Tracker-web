// Supabase Edge Function (TypeScript on Deno): push a nudge to every device of a user.
// The title is built here from the caller's profile, so clients can't spoof who sent it.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Only these sites may call this function from a browser.
const ALLOWED_ORIGINS = [
  'https://studytracker-vikram.vercel.app',
  'http://localhost:5173', // Vite dev server; remove if you never test locally
];

const corsFor = (req: Request) => {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  };
};

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(req), 'Content-Type': 'application/json' },
  });

// Server-side rate limit: one push per sender -> recipient pair every PAIR_GAP_MS.
// Kept in memory, so it resets when the function restarts. Good enough to stop casual spam.
const PAIR_GAP_MS = 10 * 1000;
const lastSent = new Map<string, number>();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;

    // Who is calling? (JWT from the signed-in user)
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: auth } = await caller.auth.getUser();
    const sender = auth?.user;
    if (!sender) return json(req, { error: 'not signed in' }, 401);

    const body = await req.json();
    const to_user_id = body?.to_user_id;
    if (typeof to_user_id !== 'string' || !to_user_id || to_user_id === sender.id) {
      return json(req, { error: 'bad recipient' }, 400);
    }
    const message = String(body?.message ?? '').trim().slice(0, 80);
    const group_name = String(body?.group_name ?? '').trim().slice(0, 40);

    // Rate limit (per sender + recipient).
    const key = `${sender.id}:${to_user_id}`;
    const now = Date.now();
    if (now - (lastSent.get(key) ?? 0) < PAIR_GAP_MS) {
      return json(req, { error: 'too many nudges, slow down' }, 429);
    }
    lastSent.set(key, now);
    if (lastSent.size > 5000) {
      for (const [k, t] of lastSent) if (now - t > PAIR_GAP_MS) lastSent.delete(k);
    }

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Only allow nudging someone you share a group with, or an accepted friend.
    let allowed = false;

    const { data: mine } = await admin
      .from('group_members')
      .select('group_id')
      .eq('user_id', sender.id);
    const myGroupIds = (mine ?? []).map((r) => r.group_id);
    if (myGroupIds.length > 0) {
      const { data: shared } = await admin
        .from('group_members')
        .select('group_id')
        .eq('user_id', to_user_id)
        .in('group_id', myGroupIds)
        .limit(1);
      allowed = (shared?.length ?? 0) > 0;
    }

    if (!allowed) {
      const { data: friend } = await admin
        .from('friendships')
        .select('id')
        .eq('status', 'accepted') // change if your accepted friendships use another status value
        .or(
          `and(requester_id.eq.${sender.id},receiver_id.eq.${to_user_id}),` +
            `and(requester_id.eq.${to_user_id},receiver_id.eq.${sender.id})`
        )
        .limit(1);
      allowed = (friend?.length ?? 0) > 0;
    }

    if (!allowed) return json(req, { error: 'not allowed to nudge this user' }, 403);

    const { data: prof } = await admin
      .from('profiles')
      .select('display_name, username')
      .eq('id', sender.id)
      .single();
    const name = prof?.display_name || prof?.username || 'A friend';

    const payload = JSON.stringify({
      title: `👋 ${name} nudged you`,
      body: message ? `“${message}”` : group_name ? `Time to study! (${group_name})` : 'Time to study!',
      url: '/',
    });

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT')!,
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!
    );

    const { data: subs, error } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', to_user_id);
    if (error) throw error;

    let sent = 0;
    await Promise.all(
      (subs ?? []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          );
          sent++;
        } catch (e) {
          // 404/410 = device unsubscribed or expired: clean it up.
          if (e.statusCode === 404 || e.statusCode === 410) {
            await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
          } else {
            console.error('push error', e.statusCode, e.body);
          }
        }
      })
    );

    return json(req, { sent });
  } catch (e) {
    console.error('send-push error', e);
    return json(req, { error: 'internal error' }, 500);
  }
});
