/**
 * Browser: Blob-URLs überleben kein Neuladen. Für die Offline-Warteschlange wird das Foto
 * daher als Daten-URI gespeichert (bis 4 MB; größere bleiben Blob-URL und gehen beim
 * Neuladen verloren, darauf weist die Synchronisierungsansicht hin).
 */
const LIMIT = 4 * 1024 * 1024;

export async function persistUri(uri: string, _name: string): Promise<string> {
  if (!uri.startsWith('blob:')) return uri;
  try {
    const blob = await (await fetch(uri)).blob();
    if (blob.size > LIMIT) return uri;
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Lesen fehlgeschlagen'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return uri;
  }
}
