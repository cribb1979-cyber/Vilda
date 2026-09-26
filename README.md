# Trygghetsappen (Vilda)

En trygghetsapp för ett barn som åker buss mellan två föräldrar. Barnet har en
app med SOS, "jag känner mig orolig", hitta hem och chatt. Föräldern ser var
barnet är, får notis när barnet kommer fram, och kan lägga in platser hemifrån.

Flera familjer kan använda appen samtidigt. Varje familj ser bara sin egen
data — det gäller i databasen, inte bara i appen.

---

## 1. Kom igång (ny installation)

### Steg 1: Kör databasschemat
Supabase Dashboard → ditt projekt → **SQL Editor** → New query. Klistra in
hela `supabase/schema.sql` och kör.

### Steg 2: Slå på ankomstnotiserna
Ny query: klistra in hela `supabase/ankomstnotiser.sql` och kör. Den lägger
till triggern som säger till när barnet kommer fram till en sparad plats.

### Steg 3: Koppla appen till Supabase
I `src/lib/supabase.js` läses två värden från omgivningen:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Båda hittas i Supabase under **Project Settings → API**. **De måste finnas på
det ställe där bygget görs** — antingen i en `.env`-fil i projektroten (kopiera
`.env.example`) eller som environment variables i EAS. Saknas de startar appen
med tomma värden och ingenting fungerar.

### Steg 4: Slå på realtimen
Schemat lägger redan in tabellerna i realtimen (`locations`, `messages`,
`alerts`, `trips`, `today_note`, `app_settings`, `saved_places`). Har du kört
migreringen i stället gör den samma sak. Inget mer behövs — men om en plats du
lägger in hemifrån inte syns i barnets app förrän den startats om, är det här
det har gått fel.

### Steg 5: Skapa webhooks för push-notiserna
Push-notiserna skickas av edge-funktionen `send-push`. **Ingenting i
SQL-filerna kopplar in den** — den måste kopplas i dashboarden:

Supabase Dashboard → **Database → Webhooks → Create a new hook**. Skapa två:
en för tabellen `messages` och en för `alerts`, båda på händelsen `INSERT`,
typ **Supabase Edge Function**, funktion `send-push`.

Utan de här två blir det inga notiser alls, hur rätt allt annat än är.

### Steg 6: AI-chatten (frivillig)
AI-chatten är avstängd tills två saker är gjorda:

1. `ANTHROPIC_API_KEY` sätts som hemlighet för funktionen: Edge Functions →
   Secrets (eller `supabase secrets set ANTHROPIC_API_KEY=...`).
2. En förälder slår på den i **Inställningar → AI-chatten**.

Utan nyckeln svarar funktionen "AI-hjälpen är inte aktiverad än". Med nyckeln
kostar varje fråga pengar hos Anthropic — därför kontrollerar funktionen både
att den som frågar är inloggad och att föräldern har slagit på den.

### Steg 7: Bygg och installera
```bash
npm install
npx expo start          # testa i Expo Go
eas build --profile production --platform ios   # riktigt bygge
```

Bakgrundsposition och push-notiser fungerar **inte** i Expo Go — de kräver ett
riktigt bygge.

---

## 2. Om du redan har en databas med data i

Kör `supabase/migrering-familjer.sql` i SQL Editor i stället för schema.sql.
Den lägger till familjer, flyttar in era befintliga rader i en familj som heter
"Vår familj", och bevarar dagens notering och appinställningarna.

**Kör hela filen en gång, och bara en gång.** Den är en enda transaktion: går
något fel rullas allt tillbaka och ingenting har ändrats. Kör den inte igen
efteråt — tabellerna finns då redan.

Migreringen tar bort **alla** gamla åtkomstregler på de berörda tabellerna och
sätter dit de nya. Det är med flit: regler i Postgres läggs ihop med ELLER, så
en enda kvarglömd gammal regel hade gett varje inloggad användare åtkomst till
allt — utan ett enda felmeddelande.

Kontrollera efteråt:

```sql
select * from families;                                  -- en rad
select display_name, family_id from profiles;            -- samma family_id
select tablename, policyname from pg_policies            -- bara de nya namnen
  where schemaname = 'public' order by tablename;
```

---

## 3. Så funkar familjer och inbjudningskoder

- **Första personen** trycker "Skapa konto" → "Skapa en ny familj". Hen blir
  förälder och får en **inbjudningskod** på sex tecken.
- **Alla andra** (barnet, den andra föräldern) trycker "Skapa konto" → "Jag har
  en kod", fyller i koden, och väljer om de är barn eller förälder.
- Koden ligger kvar i **Inställningar → Inbjudningskod**. Där kan du dela den
  och skapa en ny om den skulle ha spridits.

Koden använder bokstäver och siffror som inte går att blanda ihop (ingen `I`,
`O`, `0` eller `1`). En ny kod tar bort den gamla direkt; den som redan är med
i familjen påverkas inte.

En person kan bara tillhöra en familj. Det går inte att byta i efterhand.

**Koden är familjens nyckel, och den som har den väljer själv om den går med
som barn eller förälder.** Ingen kontroll av vem som är vem finns — den som
får koden kan alltså välja "Förälder" och får då byta inbjudningskod, ändra
familjens namn, skriva dagsnoteringen och lägga in platser. Vill du vara säker:
skicka koden till barnet och till den andra föräldern var för sig, och byt kod
i Inställningar när den andra föräldern har gått med.

---

## 4. Chatten: familjechatt och riktade meddelanden

Överst i chatten finns en rad med mottagare:

- **👨👩👧 Familjen** — alla i familjen ser meddelandet.
- **En person** — meddelandet ser bara du och den personen.

Det styrs av `messages.recipient_id`: tomt betyder familjechatten, satt betyder
en privat tråd. Den andra föräldern ser alltså **inte** vad som skrivs till
barnet. Det gäller även bilder.

---

## 5. Ankomstnotiser ("Vilda har kommit till mammas hem")

När barnets telefon skickar in en ny position jämför en trigger i databasen
(`notify_place_arrival`) mot familjens sparade platser. Går barnet från att
vara utanför till att vara innanför radien skapas ett meddelande i chatten:

> ✅ Vilda har kommit till Mammas hem

Samma sak går ut som push-notis till familjen.

Det här ligger i databasen med flit. En geofence i telefonen skulle bara
fungera för platser som redan fanns i *den* telefonen — lade du in en plats
hemifrån skulle barnets app aldrig få veta det. Nu fungerar varje plats direkt,
för alla i familjen.

**Radien** ställs per plats när du lägger in den ("Säg till när hon är inom
… meter"). Standard är 100 meter. En stor gård eller ett köpcentrum kan behöva
mer. Dubbla notiser undviks genom att samma text inte får skickas igen inom
fem minuter.

---

## 6. Push-notiser

- Notiserna skickas av edge-funktionen `send-push`, som anropas av en
  **webhook som skapas i dashboarden** vid ny rad i `messages` eller `alerts`
  (se steg 5). Ingen SQL-fil skapar den.
- Ett riktat meddelande går bara till mottagaren. Ett meddelande i
  familjechatten går till alla i familjen utom avsändaren.
- Appen registrerar sin push-token när man loggar in. **Är notiserna
  avstängda i telefonen står det i Inställningar** med en knapp för att slå på
  dem igen.
- `send-push` behöver `SUPABASE_URL` och `SUPABASE_SERVICE_ROLE_KEY`, som
  Supabase sätter automatiskt.

---

## 7. Vad som är byggt

- Registrering: skapa familj eller gå med via kod
- Familjeavgränsning i databasen (RLS) på allt — profiler, positioner, larm,
  meddelanden, platser, dagsnotering, inställningar och chattbilder
- Chatt med familjechatt och riktade trådar, bilder
- Ankomstnotiser via databastrigger, med namn på platsen
- Barn-vy: SOS, orolig-flöde, hitta hem-pil, vägbeskrivning, familjekarta
- Förälder-vy: senaste position, status ("🏠 Hemma", "📍 Mammas hem"), batteri,
  familjekarta, platser, larmlista, inbjudningskod
- AI-chatt (avstängd som standard, slås på i Inställningar — kräver också
  `ANTHROPIC_API_KEY` som hemlighet, se steg 6)
- Push vid larm, meddelanden och ankomster (kräver webhookarna i steg 5)

## 8. Kvar att göra

- **`check-transfers` saknar schemaläggning.** Funktionen som larmar när barnet
  står kvar för länge vid en bytesplats är skriven och familjeavgränsad, men
  inget kör den. Den behöver en cron (Supabase Scheduled Functions, t.ex. var
  femte minut) för att göra något.
- **Chattbilderna ligger i en publik hink.** Åtkomsten är avgränsad per familj
  i reglerna, och filnamnen är slumpade så att en bild inte går att gissa sig
  till. Men den som har en direkt länk till en bild kan fortfarande öppna den
  utan inloggning. Nästa steg är en privat hink med tidsbegränsade länkar.
- **Oanvända paket:** `@react-navigation/native` och
  `@react-navigation/native-stack` importeras ingenstans och kan tas bort.
- Texten som sägs högt i vilse-läget, bakgrundsnotisen och iOS
  behörighetsdialog säger inte längre "Pappa" — den hämtas från förälderns
  namn. Kvar som *exempel* i ett tomt fält i registreringen står "T.ex. Pappa".
- **Rollvalet vid inbjudan.** Den som har koden väljer själv barn eller
  förälder (se avsnitt 3). Att skilja dem åt skulle kräva två koder.

---

## 9. Viktigt: ingenting är testkört

Ändringarna är skrivna men **inte körda**. Maskinen som byggde dem har ingen
JavaScript-miljö, så varken appen eller SQL-filerna har kunnat provas. Räkna
med att första körningen av `schema.sql` eller `migrering-familjer.sql` kan
behöva en rättelse, och testa i den här ordningen:

1. Kör SQL-filen. Kontrollera att det står "Success".
2. Skapa ett konto i appen → du ska få en inbjudningskod.
3. Skapa barnets konto med koden → barnet ska hamna i samma familj.
4. Kontrollera i Supabase att båda profilerna har samma `family_id`.
5. Låt barnets app skicka en position, och se att en notis kommer när hen
   kommer hem.
