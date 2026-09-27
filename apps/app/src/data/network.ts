/**
 * Verbindungsstatus: im Demo-Modus über die Demo-Steuerung ("Offline"), sonst über NetInfo.
 */
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApi } from './ApiProvider';
import { isDemoApi } from './createApi';

export function useIsOffline(): boolean {
  const api = useApi();
  const demo = isDemoApi(api) ? api : null;
  const demoOffline = useSyncExternalStore(
    (cb) => (demo ? demo.controls.subscribe(cb) : () => undefined),
    () => (demo ? demo.controls.isOffline() : false),
    () => false,
  );
  const [netOffline, setNetOffline] = useState(false);
  useEffect(() => {
    if (demo) return;
    return NetInfo.addEventListener((state) => {
      setNetOffline(state.isConnected === false || state.isInternetReachable === false);
    });
  }, [demo]);
  return demo ? demoOffline : netOffline;
}
