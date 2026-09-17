-- Vilda / Trygghetsapp - grundschema
-- Kör detta i Supabase Dashboard -> SQL Editor -> New query

-- ============================================
-- PROFILES (kopplas till Supabase Auth users)
-- ============================================
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  role text not null check (role in ('parent', 'child')),
  display_name text not null,
  push_token text,
  phone_number text,
  location_sharing_enabled boolean not null default false,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

-- Alla i familjen (bara 2 användare) kan se varandras profiler
create policy "Familjemedlemmar kan se profiler"
  on profiles for select
  using (auth.uid() is not null);

create policy "Användare kan uppdatera sin egen profil"
  on profiles for update
  using (auth.uid() = id);

-- ============================================
-- LOCATIONS (senaste position + historik under en resa)
-- ============================================
create table locations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) not null,
  latitude double precision not null,
  longitude double precision not null,
  battery_level integer, -- 0-100
  is_charging boolean default false,
  recorded_at timestamptz default now()
);

create index locations_user_recorded_idx on locations (user_id, recorded_at desc);

alter table locations enable row level security;

create policy "Familjemedlemmar kan se positioner"
  on locations for select
  using (auth.uid() is not null);

create policy "Användare kan skriva sin egen position"
  on locations for insert
  with check (auth.uid() = user_id);

-- ============================================
-- TRIPS (en resa till/från skolan, för geofence-status)
-- ============================================
create table trips (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) not null,
  status text not null check (status in ('started', 'arrived', 'cancelled')) default 'started',
  destination_label text, -- t.ex. 'skola' eller 'hem'
  started_at timestamptz default now(),
  ended_at timestamptz
);

alter table trips enable row level security;

create policy "Familjemedlemmar kan se resor"
  on trips for select
  using (auth.uid() is not null);

create policy "Användare kan hantera sina egna resor"
  on trips for all
  using (auth.uid() = user_id);

-- ============================================
-- MESSAGES (enkla meddelanden mellan förälder och barn)
-- ============================================
create table messages (
  id uuid default gen_random_uuid() primary key,
  sender_id uuid references profiles(id) not null,
  content text not null,
  message_type text default 'text' check (message_type in ('text', 'image', 'preset_feeling', 'sos', 'arrived', 'trip_started')),
  is_read boolean default false,
  created_at timestamptz default now()
);

alter table messages enable row level security;

create policy "Familjemedlemmar kan se meddelanden"
  on messages for select
  using (auth.uid() is not null);

create policy "Användare kan skicka meddelanden"
  on messages for insert
  with check (auth.uid() = sender_id);

create policy "Användare kan markera meddelanden som lästa"
  on messages for update
  using (auth.uid() is not null);

-- ============================================
-- ALERTS (SOS / orolig - separat tabell för snabb åtkomst + historik)
-- ============================================
create table alerts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) not null,
  alert_type text not null check (alert_type in ('sos', 'worried')),
  feeling text, -- t.ex. 'vilse', 'laskigt', 'missade_hallplats', 'ensam', 'annat'
  note text,
  latitude double precision,
  longitude double precision,
  resolved boolean default false,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

alter table alerts enable row level security;

create policy "Familjemedlemmar kan se larm"
  on alerts for select
  using (auth.uid() is not null);

create policy "Användare kan skapa larm"
  on alerts for insert
  with check (auth.uid() = user_id);

create policy "Familjemedlemmar kan uppdatera larm (t.ex. markera löst)"
  on alerts for update
  using (auth.uid() is not null);

create policy "Familjemedlemmar kan radera larm"
  on alerts for delete
  using (auth.uid() is not null);

-- ============================================
-- SAVED PLACES (hem, skola - för hitta-hem-pilen och geofencing)
-- ============================================
create table saved_places (
  id uuid default gen_random_uuid() primary key,
  label text not null unique, -- 'hem', 'skola'
  latitude double precision not null,
  longitude double precision not null,
  radius_meters integer default 100,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

alter table saved_places enable row level security;

create policy "Familjemedlemmar kan se sparade platser"
  on saved_places for select
  using (auth.uid() is not null);

create policy "Föräldrar kan hantera sparade platser"
  on saved_places for all
  using (auth.uid() is not null);

-- ============================================
-- CHAT IMAGES (Storage-bucket för bilder i chatten)
-- ============================================
insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', true)
on conflict (id) do nothing;

create policy "Familjemedlemmar kan ladda upp chattbilder"
  on storage.objects for insert
  with check (bucket_id = 'chat-images' and auth.uid() is not null);

create policy "Familjemedlemmar kan se chattbilder"
  on storage.objects for select
  using (bucket_id = 'chat-images');

-- ============================================
-- TODAY NOTE (en rad som föräldern skriver, t.ex. "Mormor hämtar dig idag")
-- ============================================
create table today_note (
  id integer primary key default 1,
  content text,
  updated_at timestamptz default now(),
  constraint today_note_singleton check (id = 1)
);

alter table today_note enable row level security;

create policy "Familjemedlemmar kan se dagens notering"
  on today_note for select
  using (auth.uid() is not null);

create policy "Familjemedlemmar kan skriva dagens notering"
  on today_note for insert
  with check (auth.uid() is not null);

create policy "Familjemedlemmar kan uppdatera dagens notering"
  on today_note for update
  using (auth.uid() is not null);

-- ============================================
-- APP SETTINGS (rubriktext i appen, t.ex. barnets namn eller familjenamn.
-- Läsbar av alla eftersom inloggningsskärmen visar den innan man loggat in.)
-- ============================================
create table app_settings (
  id integer primary key default 1,
  display_name text default 'Vilda',
  updated_at timestamptz default now(),
  constraint app_settings_singleton check (id = 1)
);

alter table app_settings enable row level security;

create policy "Alla kan se appens namn"
  on app_settings for select
  using (true);

create policy "Familjemedlemmar kan skriva appens namn"
  on app_settings for insert
  with check (auth.uid() is not null);

create policy "Familjemedlemmar kan uppdatera appens namn"
  on app_settings for update
  using (auth.uid() is not null);

-- ============================================
-- REALTIME (så appen får push direkt vid nya rader)
-- ============================================
alter publication supabase_realtime add table locations;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table alerts;
alter publication supabase_realtime add table trips;
alter publication supabase_realtime add table today_note;
alter publication supabase_realtime add table app_settings;
