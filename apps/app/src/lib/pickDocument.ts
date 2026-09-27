/**
 * Datei wählen (PDF, Bild) über expo-document-picker; im Browser die Dateiauswahl.
 */
import * as DocumentPicker from 'expo-document-picker';
import type { PickedImage } from './pickImage';

export async function pickDocument(types: string[] = ['application/pdf']): Promise<PickedImage | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: false });
  if (res.canceled) return null;
  const asset = res.assets[0];
  if (!asset) return null;
  return { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream', sizeBytes: asset.size };
}
