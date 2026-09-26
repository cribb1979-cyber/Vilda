-- Vilda / Trygghetsapp - ankomstnotiser med platsens namn
-- Kör detta i Supabase Dashboard -> SQL Editor -> New query, EFTER att
-- schema.sql eller migrering-familjer.sql är körd.
--
-- Vad det gör: när barnets telefon skickar in en ny position som ligger
-- innanför radien för en sparad plats, och positionen innan låg utanför,
-- skapas ett meddelande i familjechatten: "Vilda har kommit till Mammas hem".
-- Den befintliga push-funktionen skickar notisen till föräldrarna.
--
-- Varför på servern och inte i telefonen: geofences ligger lokalt på den
-- telefon som skapar dem, så en plats som du lägger in hemifrån skulle
-- aldrig börja gälla förrän barnets app startats om. Här gäller varje ny
-- plats direkt, för alla, och notisen får platsens namn.

-- ============================================
-- AVSTÅND (haversine, meter)
-- ============================================
create or replace function distance_meters(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
) returns double precision
language sql immutable as $$
  select 6371000 * 2 * atan2(
    sqrt(
      sin(radians(lat2 - lat1) / 2) ^ 2 +
      cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2
    ),
    sqrt(
      greatest(0, 1 - (
        sin(radians(lat2 - lat1) / 2) ^ 2 +
        cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2
      ))
    )
  )
$$;

-- ============================================
-- ANKOMST
-- ============================================
create or replace function notify_place_arrival() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_prev locations;
  v_place saved_places;
  v_child text;
  v_text text;
begin
  -- Hela arbetet ligger i ett eget block med en fångst längst ner. Skälet:
  -- den här funktionen körs inuti barnets insättning i locations. Om den
  -- skulle kasta ett fel rullas hela insättningen tillbaka, och då slutar
  -- föräldern se barnet helt — utan att något syns i appen. En notis är
  -- trevlig att ha; positionen är livsviktig.
  begin
    -- Bara barnets positioner ska ge ankomstnotiser. Att en förälder rör sig
    -- hem till sig själv ska inte larma.
    select display_name into v_child
    from profiles
    where id = new.user_id and role = 'child';
    if v_child is null then
      return new;
    end if;

    -- Positionen innan den här, för att hitta själva övergången in i zonen.
    select * into v_prev
    from locations
    where user_id = new.user_id and id <> new.id
    order by recorded_at desc
    limit 1;
    if v_prev.id is null then
      return new;
    end if;

    for v_place in
      select * from saved_places
      where family_id = (select family_id from profiles where id = new.user_id)
        and label <> 'byte'
    loop
      -- Inne nu, men utanför alldeles nyss = hon har just kommit fram.
      -- Ligger både förra och den här positionen inne i zonen är hon redan
      -- framme och ska inte larma igen.
      if distance_meters(new.latitude, new.longitude, v_place.latitude, v_place.longitude)
           <= coalesce(v_place.radius_meters, 100)
         and distance_meters(v_prev.latitude, v_prev.longitude, v_place.latitude, v_place.longitude)
           > coalesce(v_place.radius_meters, 100)
      then
        v_text := v_child || ' har kommit till ' || v_place.name;

        -- Skyddar mot att GPS:en fladdrar precis på gränsen och larmar flera
        -- gånger om samma ankomst.
        if not exists (
          select 1 from messages
          where sender_id = new.user_id
            and message_type = 'arrived'
            and content = v_text
            and created_at > now() - interval '5 minutes'
        ) then
          insert into messages (sender_id, content, message_type)
          values (new.user_id, v_text, 'arrived');
        end if;
      end if;
    end loop;

    return new;
  exception when others then
    -- Positionen sparas, notisen uteblir, och orsaken hamnar i loggen.
    raise warning 'ankomstnotis kunde inte skapas: %', sqlerrm;
    return new;
  end;
end $$;

drop trigger if exists locations_place_arrival on locations;
create trigger locations_place_arrival
  after insert on locations
  for each row
  execute function notify_place_arrival();
