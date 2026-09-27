/**
 * Geschützte Bilder (Fotos, Chat-Anhänge): nativ lädt expo-image die Quelle direkt mit dem
 * Anmelde-Header (`source={{ uri, headers }}`). Browser: authImage.web.ts.
 */
import type { ImageSourceSpec } from '../data/api';

export type AuthImageState = { status: 'ready'; uri: string; headers?: Record<string, string> } | { status: 'loading' } | { status: 'error' };

export function useAuthImage(source: ImageSourceSpec): AuthImageState {
  return { status: 'ready', uri: source.uri, headers: source.headers };
}
