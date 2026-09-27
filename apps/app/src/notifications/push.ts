/**
 * Push-Benachrichtigungen (expo-notifications).
 *
 * - Registrierung nur in echten Builds (nicht im Demo-Modus, nicht im Browser) und nur
 *   nach Anmeldung; das Gerät wird über POST /devices bei der API hinterlegt.
 * - Tippen auf eine Benachrichtigung öffnet den Zielpfad (nur interne Pfade über
 *   safeNextPath). Ohne Anmeldung führt der Bereichsschutz über /anmelden?weiter=… zum Ziel.
 * - Benachrichtigungen enthalten nur Pfade und IDs, nie Inhalte oder Tokens.
 *
 * Offen: Expo-Push-Dienst (braucht EAS-Projekt-ID) oder direkte APNs/FCM-Zustellung durch
 * die API. Ohne Projekt-ID wird das native Geräte-Token registriert.
 */
import { safeNextPath } from '@werkstatt/contracts';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useSession } from '../auth/session';
import { IS_DEMO } from '../config';
import { useApi } from '../data/ApiProvider';

const nativePush = !IS_DEMO && Platform.OS !== 'web';

if (nativePush) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

function openTarget(data: unknown) {
  const target = typeof data === 'object' && data !== null ? (data as { targetPath?: unknown }).targetPath : undefined;
  const safe = typeof target === 'string' ? safeNextPath(target) : null;
  if (safe) router.push(safe as Href);
}

export function usePushNotifications() {
  const api = useApi();
  const { status } = useSession();
  const registered = useRef(false);

  // Tippen auf Benachrichtigungen (auch beim Kaltstart der App)
  useEffect(() => {
    if (!nativePush) return;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => response && openTarget(response.notification.request.content.data))
      .catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener((response) => openTarget(response.notification.request.content.data));
    return () => sub.remove();
  }, []);

  // Registrierung nach Anmeldung
  useEffect(() => {
    if (!nativePush || status !== 'signedIn' || registered.current || !Device.isDevice) return;
    registered.current = true;
    (async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('standard', { name: 'Werkstatt', importance: Notifications.AndroidImportance.DEFAULT });
      }
      const current = await Notifications.getPermissionsAsync();
      const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
      if (!granted) return;
      const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
      const token = projectId
        ? (await Notifications.getExpoPushTokenAsync({ projectId })).data
        : String((await Notifications.getDevicePushTokenAsync()).data);
      await api.registerDevice({ platform: Platform.OS === 'ios' ? 'ios' : 'android', pushToken: token });
    })().catch(() => {
      registered.current = false;
    });
  }, [api, status]);
}
