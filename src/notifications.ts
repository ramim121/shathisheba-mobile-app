import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { apiCreate } from './api/client';

/**
 * Push registration. The phone's token goes to the backend, which sends through
 * Firebase (the native FCM token — google-services.json is baked into the
 * Android build) or through Expo (an ExponentPushToken, when the build has an
 * EAS project id).
 *
 * Expo Go cannot receive remote push on Android since SDK 53, and merely
 * importing expo-notifications there raises a red error. So the module is
 * loaded lazily and only in a real build (release APK or development build);
 * in Expo Go everything here is a no-op and the in-app inbox still works.
 */

type NotificationsModule = typeof import('expo-notifications');

export const pushSupported = Platform.OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

let mod: NotificationsModule | null | undefined;
function notifications(): NotificationsModule | null {
  if (mod !== undefined) return mod;
  if (!pushSupported) return (mod = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-notifications') as NotificationsModule;
    // Show notifications that arrive while the app is open, not only in the tray.
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    mod = null;
  }
  return mod;
}

let registered: string | null = null;

export async function registerForPush(): Promise<string | null> {
  const Notifications = notifications();
  if (!Notifications) return null;
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

    let token: string | null = null;
    // Native FCM token first: the backend sends to it directly with the
    // Firebase service account, no Expo account involved.
    try { token = String((await Notifications.getDevicePushTokenAsync()).data); } catch { token = null; }
    if (!token) {
      const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
      if (projectId) {
        try { token = (await Notifications.getExpoPushTokenAsync({ projectId })).data; } catch { token = null; }
      }
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
  const Notifications = notifications();
  if (!Notifications) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    callback((response.notification.request.content.data ?? {}) as Record<string, unknown>);
  });
  return () => sub.remove();
}
