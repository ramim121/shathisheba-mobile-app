import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { apiCreate } from './api/client';

/**
 * Push registration. The phone's token goes to the backend, which sends through
 * Expo (an ExponentPushToken, when the build has an EAS project id) or straight
 * through Firebase (the native token, once google-services.json is in the
 * build). Until Firebase is set up there is no token to get: this returns null
 * quietly and the in-app notification inbox still works.
 */

// Show notifications that arrive while the app is open, not only in the tray.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registered: string | null = null;

export async function registerForPush(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Shathi Sheba',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#871449',
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;

    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    let token: string | null = null;
    if (projectId) {
      try { token = (await Notifications.getExpoPushTokenAsync({ projectId })).data; } catch { token = null; }
    }
    if (!token) {
      // Needs Firebase in the Android build; throws until it is there.
      try { token = String((await Notifications.getDevicePushTokenAsync()).data); } catch { return null; }
    }
    if (!token || token === registered) return token;
    await apiCreate('app/push/register', { token, platform: Platform.OS, app_version: Constants.expoConfig?.version ?? '' });
    registered = token;
    return token;
  } catch {
    return null;
  }
}

/** Calls back with a tapped notification's data ({ screen, order_id, ... }). */
export function onNotificationTap(callback: (data: Record<string, unknown>) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    callback((response.notification.request.content.data ?? {}) as Record<string, unknown>);
  });
  return () => sub.remove();
}
