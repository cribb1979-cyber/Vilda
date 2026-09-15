# Vilda – trygghetsapp

## Kom igång

### 1. Kör databasschemat
Öppna Supabase Dashboard → ditt "Vilda"-projekt → **SQL Editor** → New query,
klistra in innehållet i `supabase/schema.sql` och kör.

### 2. Lägg till era konton
Gå till **Authentication → Users → Add user** i Supabase och skapa två konton:
- Ditt konto (förälder)
- Din dotters konto (barn)

Kör sedan i SQL Editor (byt ut UUID:erna mot de riktiga user-id:na från Authentication-listan):

```sql
insert into profiles (id, role, display_name) values
  ('DITT-USER-ID-HAR', 'parent', 'Pappa'),
  ('HENNES-USER-ID-HAR', 'child', 'Vilda');
```

### 3. Lägg till "hem" som sparad plats (för hitta-hem-pilen)
```sql
insert into saved_places (label, latitude, longitude) values
  ('hem', 59.XXXXX, 18.XXXXX); -- byt mot er riktiga hemkoordinat
```
Enklast sätt att hitta koordinaterna: sök på er adress i Google Maps,
högerklicka på pricken → koordinaterna visas högst upp.

### 4. Koppla appen till Supabase
Kopiera `.env.example` till `.env` och fyll i **anon/public key**
(Project Settings → API i Supabase). URL:en är redan ifylld.

### 5. Installera och kör
```bash
npm install
npx expo start
```
Skanna QR-koden med Expo Go-appen på din och hennes iPhone för att testa,
eller bygg en riktig development build (`eas build`) för fullt stöd
för bakgrundsposition.

## Vad som är byggt
- Inloggning (samma app, olika vy beroende på roll)
- Barn-vy: SOS-knapp, "orolig"-flöde (förvalda känslor, lugnande uppläst
  röst, ring pappa), "hitta hem"-pil med riktning och avstånd
- Förälder-vy: senaste position, batteristatus, live-flöde av
  meddelanden och larm
- Databasschema med RLS (Row Level Security) så bara ni två kommer åt datan

## Vad som återstår att bygga
- Riktig karta i förälder-vyn (t.ex. `react-native-maps`)
- Bakgrundsposition som fortsätter när appen är stängd
  (`expo-location` + `expo-task-manager`, se kommentar i `ChildScreen.js`)
- Push-notiser till dig vid larm/orolig (`expo-notifications`)
- Geofencing för automatisk "kommit fram"-avisering
- Riktigt telefonnummer i "Ring pappa"-knappen (`Linking.openURL('tel:...')`)
- SOS via SMS som backup (Twilio, valfritt)
