/**
 * Browser: PDF und Bilder in neuem Tab anzeigen, andere Dateien (ZIP, CSV) herunterladen.
 * Blob-URLs werden nach kurzer Zeit freigegeben.
 */
import type { DownloadResult } from '../data/api';

function toBlobUrl(result: DownloadResult): { url: string; created: boolean } {
  if (!result.uri.startsWith('data:')) return { url: result.uri, created: false };
  const [meta, data] = result.uri.split(',');
  const binary = atob(data ?? '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const type = meta?.split(':')[1]?.split(';')[0] ?? result.mimeType;
  return { url: URL.createObjectURL(new Blob([bytes], { type })), created: true };
}

export async function openFile(result: DownloadResult, _title?: string): Promise<'opened' | 'unsupported'> {
  if (typeof window === 'undefined') return 'unsupported';
  const { url, created } = toBlobUrl(result);
  const inline = result.mimeType === 'application/pdf' || result.mimeType.startsWith('image/');
  if (inline) {
    window.open(url, '_blank', 'noopener');
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = result.fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  if (created || url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'opened';
}

/** Text (z. B. CSV) als Datei speichern. */
export async function saveTextFile(text: string, fileName: string, mimeType: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
