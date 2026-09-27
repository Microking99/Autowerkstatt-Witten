/**
 * Offline-Warteschlange der Mechanikeransicht (ADR-011), reine Logik ohne React Native.
 *
 * - Jeder Eintrag trägt eine Client-UUID. Sie ist zugleich Idempotency-Key bzw. Objekt-ID
 *   (Feststellung, Foto, Nachricht), damit eine Wiederholung nach Verbindungsabbruch auf dem
 *   Server nichts doppelt anlegt.
 * - Reihenfolge: Einträge werden in der Reihenfolge der Erfassung übertragen. Innerhalb eines
 *   Bereichs (Position bzw. Auftrag) wartet alles hinter einem abgelehnten Eintrag, bis er
 *   geklärt ist (erneut senden oder verwerfen). Andere Bereiche laufen weiter.
 * - Verbindungsfehler lassen den Eintrag unverändert stehen (später erneut). Vom Server
 *   abgelehnte Übergänge (z. B. 409) werden als Konflikt angezeigt, nie still verworfen.
 * - Freigaben, Zahlungen, fachlicher Abschluss und Rechnungen gibt es hier nicht: Offline
 *   erfasste Daten gelten nie als Freigabe oder Zahlung (AGENTS.md Regel 10).
 */

export type QueueOpKind =
  | 'photo'
  | 'createFinding'
  | 'reportFinding'
  | 'startWorkItem'
  | 'pauseWorkItem'
  | 'finishWorkItem'
  | 'notDoneWorkItem'
  | 'addPart'
  | 'addInternalNote'
  | 'sendMessage';

export type QueueState = 'pending' | 'sending' | 'conflict';

export interface QueueError {
  status: number;
  code: string;
  message: string;
}

export interface QueueEntry {
  /** Client-UUID: Idempotency-Key bzw. ID des angelegten Objekts */
  id: string;
  kind: QueueOpKind;
  workOrderId: string;
  /** Bereich für die Reihenfolge, z. B. "item:<id>" oder "order:<id>" */
  scope: string;
  /** Kurzbeschreibung für die Synchronisierungsansicht */
  label: string;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  state: QueueState;
  lastError: QueueError | null;
  lastAttemptAt: string | null;
  /** Einträge, die vorher erfolgreich übertragen sein müssen (z. B. Fotos vor der Feststellung) */
  dependsOn: string[];
}

export type NewQueueEntry = Pick<QueueEntry, 'id' | 'kind' | 'workOrderId' | 'scope' | 'label' | 'payload'> & { dependsOn?: string[] };

export function createEntry(input: NewQueueEntry, now: string): QueueEntry {
  return { ...input, dependsOn: input.dependsOn ?? [], createdAt: now, attempts: 0, state: 'pending', lastError: null, lastAttemptAt: null };
}

export type Outcome = { type: 'done' } | { type: 'network' } | { type: 'rejected'; error: QueueError };

/**
 * Fehlerarten: Verbindungsfehler und vorübergehende Serverprobleme (0, 408, 429, 5xx) →
 * später erneut; 401 → Anmeldung abgelaufen, ebenfalls später erneut (nach neuer Anmeldung);
 * übrige 4xx → Konflikt, den der Mechaniker klären muss.
 */
export function classifyError(error: { status: number; code: string; message: string }): Outcome {
  const { status } = error;
  if (status === 0 || status === 401 || status === 408 || status === 429 || status >= 500) return { type: 'network' };
  return { type: 'rejected', error: { status, code: error.code, message: error.message } };
}

/**
 * Nächster übertragbarer Eintrag: der älteste wartende, dessen Bereich nicht durch einen
 * früheren Konflikt oder einen noch offenen früheren Eintrag blockiert ist und dessen
 * Abhängigkeiten nicht mehr in der Warteschlange stehen.
 */
export function nextRunnable(entries: readonly QueueEntry[], skip: ReadonlySet<string> = new Set()): QueueEntry | null {
  const blockedScopes = new Set<string>();
  const present = new Set(entries.map((e) => e.id));
  for (const entry of entries) {
    if (entry.state === 'conflict' || entry.state === 'sending' || skip.has(entry.id)) {
      blockedScopes.add(entry.scope);
      continue;
    }
    if (blockedScopes.has(entry.scope)) continue;
    const waiting = entry.dependsOn.some((d) => present.has(d));
    if (waiting) {
      blockedScopes.add(entry.scope);
      continue;
    }
    return entry;
  }
  return null;
}

/** Ergebnis eines Übertragungsversuchs in die Warteschlange einarbeiten. */
export function applyOutcome(entries: readonly QueueEntry[], id: string, outcome: Outcome, now: string): QueueEntry[] {
  if (outcome.type === 'done') return entries.filter((e) => e.id !== id);
  return entries.map((e) => {
    if (e.id !== id) return e;
    const attempted = { ...e, attempts: e.attempts + 1, lastAttemptAt: now };
    if (outcome.type === 'network') return { ...attempted, state: 'pending' as const };
    return { ...attempted, state: 'conflict' as const, lastError: outcome.error };
  });
}

export function markSending(entries: readonly QueueEntry[], id: string): QueueEntry[] {
  return entries.map((e) => (e.id === id ? { ...e, state: 'sending' as const } : e));
}

/** Nach einem Abbruch (App beendet) gelten "wird gesendet" wieder als wartend. */
export function recoverInterrupted(entries: readonly QueueEntry[]): QueueEntry[] {
  return entries.map((e) => (e.state === 'sending' ? { ...e, state: 'pending' as const } : e));
}

/** Konflikt erneut versuchen: zurück auf "wartet". */
export function retryEntry(entries: readonly QueueEntry[], id: string): QueueEntry[] {
  return entries.map((e) => (e.id === id && e.state === 'conflict' ? { ...e, state: 'pending' as const, lastError: null } : e));
}

/**
 * Eintrag verwerfen. Abhängige Einträge (z. B. "An Service melden" einer verworfenen
 * Feststellung) werden mit verworfen, weil sie ohne ihn keinen Sinn ergeben.
 */
export function discardEntry(entries: readonly QueueEntry[], id: string): { entries: QueueEntry[]; removed: string[] } {
  const removed = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of entries) {
      if (!removed.has(e.id) && e.dependsOn.some((d) => removed.has(d))) {
        removed.add(e.id);
        changed = true;
      }
    }
  }
  return { entries: entries.filter((e) => !removed.has(e.id)), removed: [...removed] };
}

export interface QueueSummary {
  pending: number;
  conflicts: number;
  total: number;
}

export function summarize(entries: readonly QueueEntry[]): QueueSummary {
  const conflicts = entries.filter((e) => e.state === 'conflict').length;
  return { pending: entries.length - conflicts, conflicts, total: entries.length };
}

/** Einträge zu einem Auftrag bzw. einer Position (für "Nicht synchronisiert" in den Ansichten). */
export function entriesFor(entries: readonly QueueEntry[], filter: { workOrderId?: string; scope?: string }): QueueEntry[] {
  return entries.filter((e) => (filter.workOrderId ? e.workOrderId === filter.workOrderId : true) && (filter.scope ? e.scope === filter.scope : true));
}

/** Gespeicherter Zustand: Version für spätere Formatänderungen. */
export interface StoredQueue {
  v: 1;
  entries: QueueEntry[];
}

export function parseStored(raw: string | null): QueueEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredQueue;
    if (parsed?.v !== 1 || !Array.isArray(parsed.entries)) return [];
    return recoverInterrupted(parsed.entries);
  } catch {
    return [];
  }
}

export function serialize(entries: readonly QueueEntry[]): string {
  return JSON.stringify({ v: 1, entries: [...entries] } satisfies StoredQueue);
}
