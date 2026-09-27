/**
 * Foto aufnehmen oder aus der Galerie wählen (expo-image-picker). Nativ mit Berechtigung,
 * im Browser über die Dateiauswahl (Kamera am Telefon-Browser über "capture").
 */
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export interface PickedImage {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

export type PickResult = { type: 'picked'; image: PickedImage } | { type: 'cancelled' } | { type: 'denied'; message: string } | { type: 'failed'; message: string };

export async function pickImage(source: 'camera' | 'library'): Promise<PickResult> {
  try {
    if (Platform.OS !== 'web') {
      const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        return {
          type: 'denied',
          message: source === 'camera' ? 'Ohne Kamerazugriff kann kein Foto aufgenommen werden. Das lässt sich in den Einstellungen des Geräts ändern.' : 'Ohne Zugriff auf die Fotos kann kein Bild gewählt werden. Das lässt sich in den Einstellungen des Geräts ändern.',
        };
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: false, exif: false };
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = res.canceled ? undefined : res.assets[0];
    if (!asset) return { type: 'cancelled' };
    return { type: 'picked', image: { uri: asset.uri, name: asset.fileName ?? `foto-${Date.now()}.jpg`, mimeType: asset.mimeType ?? 'image/jpeg', sizeBytes: asset.fileSize } };
  } catch {
    return { type: 'failed', message: 'Das Foto konnte nicht geladen werden.' };
  }
}

/** Client-UUID (expo-crypto; Idempotency-Key bzw. Objekt-ID für die Offline-Warteschlange). */
export function newClientId(): string {
  return Crypto.randomUUID();
}
