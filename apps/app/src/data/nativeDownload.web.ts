/**
 * Browser: kein Dateisystem-Download. HttpApi lädt geschützte Dateien per fetch mit
 * Anmelde-Header und liefert eine Blob-URL (siehe http.ts `download`).
 */
import type { DownloadResult } from './api';

export async function nativeDownload(_url: string, _headers: Record<string, string>, _fallbackName: string): Promise<DownloadResult> {
  throw new Error('Im Browser nicht verwendet');
}

export const supportsNativeDownload = false;
