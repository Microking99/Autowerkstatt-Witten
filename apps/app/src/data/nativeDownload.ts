/**
 * Nativ (iOS/Android): geschützte Datei mit Anmelde-Header in den Cache laden
 * (expo-file-system). Öffnen/Teilen übernimmt src/lib/openFile.ts (expo-sharing).
 * Browser: siehe nativeDownload.web.ts (dort liefert HttpApi einen Blob).
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { DownloadResult } from './api';
import { ApiError } from './errors';

export async function nativeDownload(url: string, headers: Record<string, string>, fallbackName: string): Promise<DownloadResult> {
  const folder = new Directory(Paths.cache, 'downloads');
  try {
    if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
  } catch {
    // Ordner existiert bereits
  }
  try {
    const file = await File.downloadFileAsync(url, folder, { headers, idempotent: true });
    return { uri: file.uri, fileName: file.name || fallbackName, mimeType: file.type || 'application/octet-stream' };
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    // Nicht-2xx-Antworten meldet expo-file-system als UnableToDownload (Status im Text)
    if (/\b40[34]\b/.test(message)) throw ApiError.notFound('Die Datei ist nicht verfügbar.');
    if (/\b401\b/.test(message)) throw ApiError.unauthorized();
    throw ApiError.network('Die Datei konnte nicht geladen werden.');
  }
}

export const supportsNativeDownload = true;
