-- ============================================================
-- Vilda / Trygghetsapp - migrering till FLERA FAMILJER
--
-- Kör HELA filen en gång i Supabase Dashboard -> SQL Editor -> New query,
-- på din BEFINTLIGA databas (den som redan kör den gamla schema.sql).
--
-- Efteråt är all data separerad per familj. Din befintliga data hamnar i
-- familjen "Vår familj", och inbjudningskoden hittar du i appens
-- inställningar efter att den nya appversionen är installerad.
--
-- Hela filen körs som en enda transaktion: går något fel rullas allt
-- tillbaka och ingenting har ändrats.
-- ============================================================

begin;

-- ---------- 1. Hjälpfunktioner ----------
create or replace function generate_invite_code() returns text
language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 32) + 1)::int, 1),
    ''
  )
  from generate_series(1, 6)
$$;

-- ---------- 2. Familjer ----------
create table if not exists families (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Vår familj',
  invite_code text not null unique default generate_invite_code(),
  created_at timestamptz default now()
);

-- ---------- 3. Varje profil hör till en familj ----------
alter table profiles
  add column if not exists family_id uuid references families(id) on delete cascade;

-- ---------- 4. Din befintliga data hamnar i en familj ----------
insert into families (name)
select 'Vår familj'
where not exists (select 1 from families);

update profiles
set family_id = (select id from families order by created_at limit 1)
where family_id is null;

-- ---------- 5. Vem tillhör vilken familj ----------
-- Alla är "security definer" så att de kan läsa profiles utan att fastna i
-- sina egna regler (annars uppstår en oändlig loop).
create or replace function my_family_id() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from profiles where id = auth.uid()
$$;

create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function is_parent() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'parent' from profiles where id = auth.uid()), false)
$$;

create or replace function in_my_family(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = uid
      and p.family_id is not null
      and p.family_id = my_family_id()
  )
$$;

-- ---------- 6. Sparade platser hör till familjen ----------
alter table saved_places
  add column if not exists family_id uuid references families(id) on delete cascade;

-- Befintliga platser: till den som skapade dem, annars till första familjen.
update saved_places sp
set family_id = coalesce(
  (select p.family_id from profiles p where p.id = sp.created_by),
  (select id from families order by created_at limit 1)
)
where sp.family_id is null;

alter table saved_places alter column family_id set not null;
alter table saved_places alter column family_id set default my_family_id();

-- En hem- och en skolplats PER FAMILJ (förut gällde det hela databasen).
drop index if exists saved_places_unique_hem_skola;
create unique index saved_places_unique_hem_skola
  on saved_places (family_id, label)
  where label in ('hem', 'skola');

-- ---------- 7. Riktade meddelanden ----------
-- recipient_id = null -> familjechatten. Satt -> bara avsändare + mottagare.
alter table messages
  add column if not exists recipient_id uuid references profiles(id) on delete cascade;

create index if not exists messages_created_idx on messages (created_at desc);
-- En riktad tråd söks upp som (jag, du) eller (du, jag).
create index if not exists messages_thread_idx on messages (sender_id, recipient_id);

-- Ankomstnotisen (ankomstnotiser.sql) skriver message_type = 'arrived'. Finns
-- en gammal check-regel kvar som inte tillåter det, fallerar triggern på varje
-- position — därför ser vi till att listan är den nya. Regeln tas bort under
-- vilket namn den än har.
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'messages'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%message_type%'
  loop
    execute format('alter table messages drop constraint %I', r.conname);
  end loop;
end $$;

alter table messages add constraint messages_message_type_check
  check (message_type in ('text', 'image', 'preset_feeling', 'sos', 'arrived', 'trip_started'));

-- ---------- 8. Dagsnotering och appinställningar per familj ----------
-- De var en enda rad för hela databasen. Vi sparar undan innehållet först
-- så att din nuvarande dagsnotering och AI-inställning följer med.
-- Ingen filtrering på id: den gamla tabellen hade alltid exakt en rad, och
-- genom att inte nämna kolumnnamnet slipper migreringen gissa hur den såg ut.
-- limit 1 gör att en oväntad extra rad inte kraschar hela körningen.
create temp table _gammal_notering as select content from today_note limit 1;
create temp table _gammal_inst as select display_name, ai_chat_enabled from app_settings limit 1;

drop table if exists today_note;
drop table if exists app_settings;

create table today_note (
  family_id uuid primary key references families(id) on delete cascade,
  content text,
  updated_at timestamptz default now()
);

create table app_settings (
  family_id uuid primary key references families(id) on delete cascade,
  display_name text not null default 'Familjen',
  ai_chat_enabled boolean not null default false,
  updated_at timestamptz default now()
);

insert into today_note (family_id, content)
select (select id from families order by created_at limit 1), content from _gammal_notering;

insert into app_settings (family_id, display_name, ai_chat_enabled)
select (select id from families order by created_at limit 1), display_name, ai_chat_enabled from _gammal_inst;

insert into app_settings (family_id)
select f.id from families f
where not exists (select 1 from app_settings s where s.family_id = f.id);

alter table families enable row level security;
alter table today_note enable row level security;
alter table app_settings enable row level security;

-- ---------- 9. Bort med de gamla reglerna ----------
-- VIKTIGT: reglerna nedan togs bort med namn, och regler i Postgres är
-- tillåtande var för sig — de läggs ihop med ELLER. En enda gammal regel som
-- heter något annat än vi trodde skulle därför ligga kvar och ge varje
-- inloggad användare åtkomst till allt, utan ett enda felmeddelande.
-- Därför tar vi bort ALLA regler på tabellerna i stället för att gissa namn.
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'families', 'profiles', 'locations', 'trips', 'messages',
        'alerts', 'saved_places', 'today_note', 'app_settings'
      )
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------- 10. Nya regler: bara den egna familjen ----------
create policy "Se sin egen familj"
  on families for select
  using (id = my_family_id());

create policy "Föräldrar kan ändra familjen"
  on families for update
  using (id = my_family_id() and is_parent());

create policy "Se sin familjs profiler"
  on profiles for select
  using (id = auth.uid() or family_id = my_family_id());

-- with check hindrar att man skriver om sin egen roll eller familj. Utan den
-- kunde ett barn sätta role = 'parent' på sin egen rad och därmed få
-- föräldrars rättigheter — och byta familj, tvärtemot vad reglerna ovan lovar.
-- "is not distinct from" jämför säkert även när värdet är tomt.
create policy "Uppdatera sin egen profil"
  on profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and family_id is not distinct from my_family_id()
    and role is not distinct from my_role()
  );

create policy "Se sin familjs positioner"
  on locations for select
  using (in_my_family(user_id));

create policy "Skriva sin egen position"
  on locations for insert
  with check (auth.uid() = user_id);

create policy "Se sin familjs resor"
  on trips for select
  using (in_my_family(user_id));

create policy "Hantera sina egna resor"
  on trips for all
  using (auth.uid() = user_id);

create policy "Se familjechatten och sina egna trådar"
  on messages for select
  using (
    in_my_family(sender_id)
    and (recipient_id is null or recipient_id = auth.uid() or sender_id = auth.uid())
  );

create policy "Skicka meddelanden"
  on messages for insert
  with check (
    auth.uid() = sender_id
    and my_family_id() is not null
    and (recipient_id is null or in_my_family(recipient_id))
  );

create policy "Markera meddelanden som lästa"
  on messages for update
  using (
    in_my_family(sender_id)
    and (recipient_id is null or recipient_id = auth.uid() or sender_id = auth.uid())
  );

create policy "Se sin familjs larm"
  on alerts for select
  using (in_my_family(user_id));

create policy "Skapa larm"
  on alerts for insert
  with check (auth.uid() = user_id);

create policy "Uppdatera sin familjs larm"
  on alerts for update
  using (in_my_family(user_id));

create policy "Radera sin familjs larm"
  on alerts for delete
  using (in_my_family(user_id));

create policy "Se sin familjs platser"
  on saved_places for select
  using (family_id = my_family_id());

create policy "Hantera sin familjs platser"
  on saved_places for all
  using (family_id = my_family_id())
  with check (family_id = my_family_id());

-- TODAY NOTE
-- Bara en förälder skriver dagsnoteringen. Det är förälderns besked till
-- barnet om dagen, och barnet ska inte kunna skriva om det.
create policy "Se sin familjs dagsnotering"
  on today_note for select
  using (family_id = my_family_id());

create policy "Skriva sin familjs dagsnotering"
  on today_note for insert
  with check (family_id = my_family_id() and is_parent());

create policy "Uppdatera sin familjs dagsnotering"
  on today_note for update
  using (family_id = my_family_id() and is_parent());

-- APP SETTINGS
-- Samma sak: familjens namn och AI-brytaren är förälderns inställningar.
create policy "Se sin familjs inställningar"
  on app_settings for select
  using (family_id = my_family_id());

create policy "Skriva sin familjs inställningar"
  on app_settings for insert
  with check (family_id = my_family_id() and is_parent());

create policy "Uppdatera sin familjs inställningar"
  on app_settings for update
  using (family_id = my_family_id() and is_parent());

-- ---------- 11. Chattbilder: en mapp per familj ----------
-- Förut kunde vem som helst som var inloggad lista hela bildmappen och
-- därmed se alla familjers bilder. Nu kommer var familj bara åt sin egen.
-- Samma sak här: hellre svepa bort allt som handlar om chattbilder än att
-- lita på att vi minns namnen. Vi tar både regler som heter något med
-- chattbilder och regler som nämner bucketens namn i själva villkoret.
-- Regler för andra buckets rörs inte.
do $$
declare
  r record;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        policyname ilike '%chattbild%'
        or policyname ilike '%chat-images%'
        or coalesce(qual, '') ilike '%chat-images%'
        or coalesce(with_check, '') ilike '%chat-images%'
      )
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

create policy "Ladda upp familjens chattbilder"
  on storage.objects for insert
  with check (bucket_id = 'chat-images' and (storage.foldername(name))[1] = my_family_id()::text);

create policy "Se familjens chattbilder"
  on storage.objects for select
  using (
    bucket_id = 'chat-images'
    and ((storage.foldername(name))[1] = my_family_id()::text or owner = auth.uid())
  );

-- ---------- 12. Skapa konto / familj ----------
-- Det ENDA sättet att skapa en profil. Körs med förhöjd rättighet,
-- kontrollerar inloggning, och ger en användare exakt en profil.
create or replace function create_family_and_profile(
  p_display_name text,
  p_family_name text default 'Vår familj'
) returns families
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_family families;
begin
  if v_uid is null then
    raise exception 'Du måste vara inloggad.';
  end if;
  if exists (select 1 from profiles where id = v_uid) then
    raise exception 'Det finns redan en profil för det här kontot.';
  end if;

  insert into families (name)
  values (coalesce(nullif(trim(p_family_name), ''), 'Vår familj'))
  returning * into v_family;

  insert into profiles (id, family_id, role, display_name)
  values (v_uid, v_family.id, 'parent', coalesce(nullif(trim(p_display_name), ''), 'Förälder'));

  insert into app_settings (family_id) values (v_family.id)
  on conflict (family_id) do nothing;

  return v_family;
end $$;

create or replace function join_family_with_code(
  p_code text,
  p_display_name text,
  p_role text default 'child'
) returns families
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_family families;
begin
  if v_uid is null then
    raise exception 'Du måste vara inloggad.';
  end if;
  if exists (select 1 from profiles where id = v_uid) then
    raise exception 'Det finns redan en profil för det här kontot.';
  end if;
  if p_role not in ('parent', 'child') then
    raise exception 'Ogiltig roll.';
  end if;

  select * into v_family from families where invite_code = upper(trim(p_code));
  if v_family.id is null then
    raise exception 'Fel kod. Kontrollera koden med den som bjöd in dig.';
  end if;

  insert into profiles (id, family_id, role, display_name)
  values (v_uid, v_family.id, p_role, coalesce(nullif(trim(p_display_name), ''), 'Medlem'));

  return v_family;
end $$;

create or replace function rotate_invite_code() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_family uuid := my_family_id();
  v_code text;
begin
  if v_family is null or not is_parent() then
    raise exception 'Bara en förälder kan byta koden.';
  end if;

  loop
    v_code := generate_invite_code();
    exit when not exists (select 1 from families where invite_code = v_code);
  end loop;

  update families set invite_code = v_code where id = v_family;
  return v_code;
end $$;

commit;

-- ---------- 13. Realtime ----------
-- today_note och app_settings skapades om ovan. När en tabell tas bort
-- försvinner den också ur publikationen, så de måste läggas tillbaka här.
-- Utan det slutar dagsnoteringen och familjens namn att komma fram direkt
-- till den andras telefon, utan att något ser ut att ha gått fel.
-- Körs sist, efter commit, när allt annat är på plats.
do $$
declare
  t text;
begin
  foreach t in array array['saved_places', 'today_note', 'app_settings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
