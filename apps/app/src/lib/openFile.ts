/**
 * Heruntergeladene Datei öffnen (nativ): über das Teilen-Menü des Systems (expo-sharing),
 * damit der Nutzer sie in einer passenden App öffnen oder speichern kann.
 * Browser: openFile.web.ts.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { DownloadResult } from '../data/api';

export async function openFile(result: DownloadResult, title?: string): Promise<'opened' | 'unsupported'> {
  if (!(await Sharing.isAvailableAsync())) return 'unsupported';
  await Sharing.shareAsync(result.uri, { mimeType: result.mimeType, dialogTitle: title ?? result.fileName, UTI: result.mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined });
  return 'opened';
}

/** Text (z. B. CSV-Export) als Datei im Cache ablegen und über das Teilen-Menü anbieten. */
export async function saveTextFile(text: string, fileName: string, mimeType: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(text);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: fileName });
}
