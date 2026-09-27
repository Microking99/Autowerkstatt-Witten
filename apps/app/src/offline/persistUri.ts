/**
 * Nativ: Foto aus dem Zwischenspeicher der Kamera in einen dauerhaften App-Ordner kopieren,
 * damit es auch nach einem Neustart noch übertragen werden kann (Offline-Warteschlange).
 * Browser: persistUri.web.ts.
 */
import { Directory, File, Paths } from 'expo-file-system';

export async function persistUri(uri: string, name: string): Promise<string> {
  if (!uri.startsWith('file:')) return uri;
  try {
    const folder = new Directory(Paths.document, 'offline-fotos');
    if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
    const target = new File(folder, `${Date.now()}-${name.replace(/[^A-Za-z0-9._-]/g, '_')}`);
    new File(uri).copy(target);
    return target.uri;
  } catch {
    return uri;
  }
}
