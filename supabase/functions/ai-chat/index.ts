import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPTS: Record<string, string> = {
  larMig:
    'Du är en vänlig, pedagogisk AI-hjälpare i en trygghetsapp för barn. Svara alltid på svenska, ' +
    'enkelt och åldersanpassat för ett barn i grundskoleåldern. Förklara saker steg för steg och ' +
    'ställ gärna en följdfråga så barnet får tänka själv. Var varm, tålmodig och uppmuntrande. ' +
    'Håll svaren korta (max några meningar).',
  orolig:
    'Du är en lugnande AI-hjälpare i en trygghetsapp för barn, till för ett barn som känner sig ' +
    'oroligt. Svara alltid på svenska, varmt och lugnt. Bekräfta känslan, hjälp barnet andas lugnt ' +
    'och ta en sak i taget. Ställ enkla frågor för att förstå situationen. Håll svaren korta. ' +
    'VIKTIGT: Om barnet beskriver en verklig nödsituation (fara, skadad, någon hotar dem, de är ' +
    'helt vilse och rädda) ska du DIREKT och tydligt säga åt dem att trycka på den röda SOS-knappen ' +
    'i appen eller prata med en vuxen de litar på. Försök aldrig lösa en nödsituation själv — din ' +
    'uppgift är att lugna och leda till riktig hjälp, inte att vara den hjälpen.',
  skolan:
    'Du är en pedagogisk AI-hjälpare i en trygghetsapp för barn, till för läxhjälp. Svara på ' +
    'svenska. Hjälp barnet förstå uppgiften steg för steg — ge ALDRIG bara det färdiga svaret, ' +
    'guida dem med ledande frågor tills de kommer fram till det själva. Om barnet skickar en bild ' +
    'på en uppgift, utgå från den. Håll svaren korta och tydliga.',
  prata:
    'Du är en vänlig AI-kompis i en trygghetsapp för barn, till för ett barn som vill prata. Svara ' +
    'på svenska, varmt och intresserat, som en trygg vän. Håll det lätt och positivt, korta svar. ' +
    'Om barnet tar upp något allvarligt eller oroväckande, uppmuntra dem vänligt att också prata ' +
    'med en vuxen de litar på.',
  video:
    'Du är en peppig AI-hjälpare i en trygghetsapp för barn, till för ett barn som vill göra videos. ' +
    'Svara på svenska, kort och konkret. Du kan INTE själv klippa eller skapa videofiler — förklara ' +
    'det tydligt men glatt om barnet frågar om det. Det du KAN hjälpa till med: ge enkla, ' +
    'åldersanpassade tips på hur man klipper i vanliga appar (t.ex. CapCut, iMovie, InShot), komma på ' +
    'roliga idéer att filma, och hjälpa till att skriva ett kort manus eller en lista med scener. Om ' +
    'barnet pratar om att lägga upp videon någonstans online, påminn vänligt och kort om att fråga en ' +
    'vuxen först och att aldrig dela sitt namn, skola eller var man bor i en video.',
};

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Kameran på iOS ger jpeg, men en skärmbild är png. Skickades allt som jpeg
// avvisade modellen bilden. Vi litar på vad telefonen säger om typen, och
// tittar på filens första tecken om svaret saknas eller är okänt.
function sniffMediaType(base64: string): string {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

function resolveMediaType(base64: string, fromClient?: string): string {
  if (fromClient && ALLOWED_MEDIA_TYPES.includes(fromClient)) return fromClient;
  return sniffMediaType(base64);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (!ANTHROPIC_API_KEY) {
    return json({ error: 'not_activated' }, 503);
  }

  // Funktionen kan anropas av vem som helst som har appens publika nyckel, och
  // varje anrop kostar pengar hos Anthropic. Därför: bara en inloggad
  // användare vars familj faktiskt har slagit på AI-chatten släpps igenom.
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
  );

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return json({ error: 'unauthorized' }, 401);
  }

  // Läses med användarens egen rättighet, så svaret är alltid den egna
  // familjens rad — ingen kan läsa en annan familjs inställning här.
  const { data: settings } = await userClient
    .from('app_settings')
    .select('ai_chat_enabled')
    .maybeSingle();
  if (!settings?.ai_chat_enabled) {
    return json({ error: 'not_activated' }, 503);
  }

  let body: {
    mode?: string;
    messages?: { role: string; content: string }[];
    imageBase64?: string;
    imageMediaType?: string;
  };
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: 'bad_request' }, 400);
  }

  const { mode, messages, imageBase64, imageMediaType } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: 'bad_request' }, 400);
  }

  const systemPrompt = SYSTEM_PROMPTS[mode || 'prata'] || SYSTEM_PROMPTS.prata;

  // Anthropic kräver att historiken börjar med ett meddelande från
  // användaren. Appen har en hälsning från assistenten först i listan, och så
  // länge den fick följa med avvisades varenda fråga — barnet fick "Kunde
  // inte svara" varje gång, hur rätt allt annat än var.
  const anthropicMessages: { role: string; content: unknown }[] = messages
    .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
    .map((m: { role: string; content: string }) => ({ role: m.role, content: m.content }));

  while (anthropicMessages.length && anthropicMessages[0].role !== 'user') {
    anthropicMessages.shift();
  }
  if (anthropicMessages.length === 0) {
    return json({ error: 'bad_request' }, 400);
  }

  if (imageBase64) {
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
    const mediaType = resolveMediaType(cleanBase64, imageMediaType);
    const last = anthropicMessages[anthropicMessages.length - 1];
    anthropicMessages[anthropicMessages.length - 1] = {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: cleanBase64 } },
        { type: 'text', text: String(last.content) },
      ],
    };
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: systemPrompt,
      messages: anthropicMessages,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    return json({ error: 'ai_call_failed', details }, 502);
  }

  const data = await response.json();
  const text =
    data.content?.[0]?.text || 'Förlåt, jag förstod inte riktigt. Kan du säga det på ett annat sätt?';

  return json({ text });
});
