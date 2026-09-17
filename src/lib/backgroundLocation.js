import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { supabase } from './supabase';

export const LOCATION_TASK = 'vilda-location-task';

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const loc = data.locations?.[0];
  if (!loc) return;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return;

  const batteryLevel = await Battery.getBatteryLevelAsync();
  const batteryState = await Battery.getBatteryStateAsync();

  await supabase.from('locations').insert({
    user_id: session.user.id,
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    battery_level: Math.round(batteryLevel * 100),
    is_charging: batteryState === Battery.BatteryState.CHARGING,
  });
});

export async function startBackgroundLocationTracking() {
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') return;

    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (alreadyStarted) return;

    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 30000,
      distanceInterval: 0,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Vilda delar din position',
        notificationBody: 'Pappa kan se var du är för att hålla dig trygg.',
      },
    });
  } catch (e) {
    // Bakgrundsspårning kräver en EAS-utvecklingsbygge, funkar inte i Expo Go.
  }
}

export async function stopBackgroundLocationTracking() {
  try {
    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (alreadyStarted) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch (e) {
    // Ingenting att stoppa.
  }
}
