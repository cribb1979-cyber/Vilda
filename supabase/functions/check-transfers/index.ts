import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

Deno.serve(async () => {
  const { data: transferPlaces } = await supabase.from('saved_places').select('*').eq('label', 'byte');
  if (!transferPlaces?.length) return new Response('no transfer places', { status: 200 });

  const { data: child } = await supabase.from('profiles').select('id').eq('role', 'child').limit(1).maybeSingle();
  if (!child) return new Response('no child profile', { status: 200 });

  const checked: string[] = [];

  for (const place of transferPlaces) {
    const dwellMinutes = place.dwell_minutes || 15;
    const windowMinutes = dwellMinutes + 10;
    const since = new Date(Date.now() - windowMinutes * 60000).toISOString();

    const { data: locations } = await supabase
      .from('locations')
      .select('*')
      .eq('user_id', child.id)
      .gte('recorded_at', since)
      .order('recorded_at', { ascending: false });

    if (!locations?.length) continue;

    const latest = locations[0];
    const latestDistance = distanceMeters(
      latest.latitude,
      latest.longitude,
      place.latitude,
      place.longitude
    );
    if (latestDistance > (place.radius_meters || 100)) continue; // redan lämnat platsen

    // Hitta hur länge barnet varit kvar (utan uppehåll) i zonen
    let entryTime = latest.recorded_at;
    for (const loc of locations) {
      const d = distanceMeters(loc.latitude, loc.longitude, place.latitude, place.longitude);
      if (d > (place.radius_meters || 100)) break;
      entryTime = loc.recorded_at;
    }

    const dwellMs = Date.now() - new Date(entryTime).getTime();
    const dwellActualMinutes = Math.round(dwellMs / 60000);
    if (dwellActualMinutes < dwellMinutes) continue;

    const noteId = `place:${place.id}`;
    const { data: existingAlert } = await supabase
      .from('alerts')
      .select('id')
      .eq('alert_type', 'byte_stuck')
      .eq('note', noteId)
      .gte('created_at', entryTime)
      .limit(1)
      .maybeSingle();

    if (existingAlert) continue; // redan larmat för den här bytesperioden

    await supabase.from('alerts').insert({
      user_id: child.id,
      alert_type: 'byte_stuck',
      feeling: `🚏 Kvar vid ${place.name} i ${dwellActualMinutes} min`,
      note: noteId,
      latitude: latest.latitude,
      longitude: latest.longitude,
    });

    checked.push(place.name);
  }

  return new Response(JSON.stringify({ alerted: checked }), {
    headers: { 'content-type': 'application/json' },
  });
});
