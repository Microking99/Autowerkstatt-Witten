/**
 * Einfacher Aktualisierungsbus: Nach jeder erfolgreichen Änderung (Mutation) laden alle
 * sichtbaren Abfragen im Hintergrund neu. Für den Umfang dieser App genügt das und
 * vermeidet veraltete Anzeigen (z. B. Status nach einer Freigabe).
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeInvalidation(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function invalidateAll(): void {
  for (const l of [...listeners]) l();
}
