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

Deno.serve(async (req) => {
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'not_activated' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { mode, messages, imageBase64 } = await req.json();
  const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.prata;

  const anthropicMessages = messages.map((m: { role: string; content: string }) => ({
    role: m.role,
    content: m.content,
  }));

  if (imageBase64 && anthropicMessages.length) {
    const last = anthropicMessages[anthropicMessages.length - 1];
    anthropicMessages[anthropicMessages.length - 1] = {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: last.content },
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
    return new Response(JSON.stringify({ error: 'ai_call_failed', details }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  const data = await response.json();
  const text =
    data.content?.[0]?.text || 'Förlåt, jag förstod inte riktigt. Kan du säga det på ett annat sätt?';

  return new Response(JSON.stringify({ text }), {
    headers: { 'content-type': 'application/json' },
  });
});
