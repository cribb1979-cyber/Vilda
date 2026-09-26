import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Returnerar vad som hände i stället för att bara ge upp tyst. Förut kunde
// det här misslyckas utan att någon märkte det — och då kom inga notiser
// alls, utan att någonstans stod varför.
export async function registerForPushNotifications(profileId) {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    return { ok: false, reason: 'permission_denied' };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    // Utan projectId kan ingen push-token hämtas, och då är notiserna döda
    // hur bra allt annat än är.
    return { ok: false, reason: 'missing_project_id' };
  }

  let token;
  try {
    ({ data: token } = await Notifications.getExpoPushTokenAsync({ projectId }));
  } catch (e) {
    return { ok: false, reason: 'token_failed', message: e?.message };
  }

  if (!token) return { ok: false, reason: 'token_failed' };

  const { error } = await supabase.from('profiles').update({ push_token: token }).eq('id', profileId);
  if (error) return { ok: false, reason: 'save_failed', message: error.message };

  return { ok: true, token };
}
