import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

async function getOtherProfile(senderId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('id, push_token')
    .neq('id', senderId)
    .limit(1)
    .single();
  return data;
}

Deno.serve(async (req) => {
  const payload = await req.json();
  const { table, record } = payload;

  let senderId: string | undefined;
  let title = '';
  let body = '';

  if (table === 'alerts') {
    senderId = record.user_id;
    const isSos = record.alert_type === 'sos';
    title = isSos ? '🚨 LARM' : '💛 Känner sig orolig';
    body = isSos ? 'Öppna appen för att se var hon är.' : record.feeling || 'Öppna appen för att se mer.';
  } else if (table === 'messages') {
    senderId = record.sender_id;
    title = '💬 Nytt meddelande';
    body = record.message_type === 'image' ? '📷 Skickade en bild' : record.content;
  } else {
    return new Response('ignored', { status: 200 });
  }

  if (!senderId) return new Response('no sender', { status: 200 });

  const recipient = await getOtherProfile(senderId);
  if (!recipient?.push_token) return new Response('no push token', { status: 200 });

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: recipient.push_token,
      title,
      body,
      sound: 'default',
      data: { table, id: record.id },
    }),
  });

  return new Response('sent', { status: 200 });
});
