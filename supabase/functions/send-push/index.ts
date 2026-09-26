import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

type Recipient = { id: string; push_token: string | null };

// Mottagare är alltid någon i SAMMA familj som avsändaren. Den här
// funktionen kör med service-nyckeln och går därför förbi reglerna i
// databasen — därför måste familjen filtreras fram här i koden.
async function familyMembersExcept(senderId: string): Promise<Recipient[]> {
  const { data: sender } = await supabase
    .from('profiles')
    .select('family_id')
    .eq('id', senderId)
    .maybeSingle();

  if (!sender?.family_id) return [];

  const { data } = await supabase
    .from('profiles')
    .select('id, push_token')
    .eq('family_id', sender.family_id)
    .neq('id', senderId);

  return (data || []) as Recipient[];
}

async function profileById(id: string): Promise<Recipient | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id, push_token')
    .eq('id', id)
    .maybeSingle();
  return (data as Recipient) || null;
}

Deno.serve(async (req) => {
  let payload: { table?: string; record?: Record<string, any> };
  try {
    payload = await req.json();
  } catch (e) {
    return new Response('bad payload', { status: 200 });
  }

  const { table, record } = payload;
  if (!record) return new Response('no record', { status: 200 });

  let senderId: string | undefined;
  let title = '';
  let body = '';
  let recipients: Recipient[] = [];

  if (table === 'alerts') {
    senderId = record.user_id;
    if (record.alert_type === 'sos') {
      title = '🚨 LARM';
      body = 'Öppna appen för att se var hon är.';
    } else if (record.alert_type === 'byte_stuck') {
      title = '🚏 Kvar vid bytet';
      body = record.feeling || 'Öppna appen för att se var hon är.';
    } else {
      title = '💛 Känner sig orolig';
      body = record.feeling || 'Öppna appen för att se mer.';
    }
  } else if (table === 'messages') {
    senderId = record.sender_id;
    if (record.message_type === 'arrived') {
      title = '✅ Kommit fram';
      body = record.content;
    } else {
      title = '💬 Nytt meddelande';
      body = record.message_type === 'image' ? '📷 Skickade en bild' : record.content;
    }
  } else {
    return new Response('ignored', { status: 200 });
  }

  if (!senderId) return new Response('no sender', { status: 200 });

  if (table === 'messages' && record.recipient_id) {
    // Ett riktat meddelande ska bara gå till den det står till. Den andra
    // föräldern ska inte få en notis om vad som skrivs till barnet.
    const recipient = await profileById(record.recipient_id);
    recipients = recipient ? [recipient] : [];
  } else {
    recipients = await familyMembersExcept(senderId);
  }

  // En token kan hamna på flera rader om någon loggat in på samma telefon
  // två gånger — skicka ändå bara en notis per token.
  const seen = new Set<string>();
  const messages = recipients
    .filter((r) => r.push_token)
    .filter((r) => {
      if (seen.has(r.push_token!)) return false;
      seen.add(r.push_token!);
      return true;
    })
    .map((r) => ({
      to: r.push_token,
      title,
      body,
      sound: 'default',
      data: { table, id: record.id },
    }));

  if (!messages.length) return new Response('no push token', { status: 200 });

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    return new Response(JSON.stringify({ error: 'push_failed', status: response.status }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ sent: messages.length }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
