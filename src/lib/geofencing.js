import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { supabase } from './supabase';

export const GEOFENCE_TASK = 'vilda-geofence-task';

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { eventType, region } = data;
  if (eventType !== Location.GeofencingEventType.Enter) return;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return;

  await supabase.from('messages').insert({
    sender_id: session.user.id,
    content: `Kom fram till ${region.identifier}`,
    message_type: 'arrived',
  });
});

export async function startGeofencing(places) {
  if (!places.length) return;

  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status !== 'granted') return;

  const regions = places.map((place) => ({
    identifier: place.label,
    latitude: place.latitude,
    longitude: place.longitude,
    radius: place.radius_meters || 100,
    notifyOnEnter: true,
    notifyOnExit: false,
  }));

  await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
}
