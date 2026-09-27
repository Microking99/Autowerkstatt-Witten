import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { API_URL, IS_DEMO, WEB_URL } from '../config';
import type { WerkstattApi } from './api';
import { DemoApi, type DemoStorage } from './demo/DemoApi';
import { HttpApi } from './http';

const DEMO_STATE_KEY = 'werkstatt-demo-zustand';

/** Demo-Zustand im sessionStorage (nur Web): Neuladen behält Änderungen, neuer Tab beginnt neu. */
function webDemoStorage(): DemoStorage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const s = window.sessionStorage;
    return {
      load: () => s.getItem(DEMO_STATE_KEY),
      save: (value) => s.setItem(DEMO_STATE_KEY, value),
      clear: () => s.removeItem(DEMO_STATE_KEY),
    };
  } catch {
    return null;
  }
}

export function createApi(): WerkstattApi {
  if (IS_DEMO) {
    const origin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : WEB_URL || undefined;
    return new DemoApi({ storage: webDemoStorage(), latencyMs: 250, publicBaseUrl: origin });
  }
  return new HttpApi({
    baseUrl: API_URL,
    validateResponses: __DEV__,
    newId: () => Crypto.randomUUID(),
  });
}

export function isDemoApi(api: WerkstattApi): api is DemoApi {
  return api.mode === 'demo';
}
