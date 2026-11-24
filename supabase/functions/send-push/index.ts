// Supabase Edge Function (TypeScript on Deno): push a nudge to every device of a user.
// The title is built here from the caller's profile, so clients can't spoof who sent it.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;

    // Who is calling? (JWT from the signed-in user)
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: auth } = await caller.auth.getUser();
    const sender = auth?.user;
    if (!sender) return json({ error: 'not signed in' }, 401);

    const { to_user_id, message, group_name } = await req.json();
    if (!to_user_id || to_user_id === sender.id) return json({ error: 'bad recipient' }, 400);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: prof } = await admin
      .from('profiles')
      .select('display_name, username')
      .eq('id', sender.id)
      .single();
    const name = prof?.display_name || prof?.username || 'A friend';

    const text = String(message ?? '').trim().slice(0, 80);
    const payload = JSON.stringify({
      title: `👋 ${name} nudged you`,
      body: text ? `“${text}”` : group_name ? `Time to study! (${group_name})` : 'Time to study!',
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

    return json({ sent });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
