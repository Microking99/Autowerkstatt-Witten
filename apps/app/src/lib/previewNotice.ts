/**
 * Vorschau zum Teilen (EXPO_PUBLIC_PREVIEW=1): Der Rahmen, in dem sie läuft, erlaubt weder neue
 * Tabs noch Downloads. Statt stumm nichts zu tun, meldet die Oberfläche, was sich in der fertigen
 * App öffnen würde. openFile.web löst das Ereignis aus, die Wurzel (app/_layout.tsx) zeigt den Hinweis.
 */
export const PREVIEW_FILE_EVENT = 'werkstatt:vorschau-datei';

export function announcePreviewFile(fileName: string): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PREVIEW_FILE_EVENT, { detail: { fileName } }));
}
