/**
 * Offline-Warteschlange: Speichern, Übertragen, Wiederholen, Verwerfen.
 *
 * Alle Mechaniker-Aktionen, die offline möglich sind, laufen hier durch ("Postausgang"):
 * Eintrag speichern, dann sofort übertragen, wenn eine Verbindung besteht. So bleibt die
 * Reihenfolge erhalten, auch wenn zwischendurch die Verbindung abbricht.
 *
 * Diese Datei importiert nichts aus React Native (Unit-Tests mit DemoApi).
 */
import type { FindingInput, FinishWorkItemInput, NotDoneWorkItemInput, PartUsedInput, WerkstattApi } from '../data/api';
import { toApiError } from '../data/errors';
import {
  applyOutcome,
  classifyError,
  createEntry,
  discardEntry,
  idempotencyKeyOf,
  isDeviceTimeConflict,
  markSending,
  nextRunnable,
  occurredAtOf,
  parseStored,
  retryEntry,
  serialize,
  type NewQueueEntry,
  type Outcome,
  type QueueEntry,
  type QueueError,
} from './queueCore';

export interface QueueStorage {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
}

export interface PhotoPayload {
  photoId: string;
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  context: 'finding' | 'work' | 'chat' | 'intake';
  caption?: string | null;
  findingId?: string | null;
  takenAt: string;
}

/**
 * Einen Eintrag gegen die API ausführen. Idempotenz über die Client-UUID des Eintrags (nach
 * manueller Wiederholung mit Zähler). Zeiten tragen den Erfassungszeitpunkt (`occurredAt`).
 */
export async function execute(api: WerkstattApi, entry: QueueEntry): Promise<void> {
  const p = entry.payload;
  const key = idempotencyKeyOf(entry);
  const occurredAt = occurredAtOf(entry);
  const time = occurredAt ? { occurredAt } : {};
  // Objekte mit Client-ID (Foto, Feststellung, Nachricht): Schlüssel sonst aus der Objekt-ID;
  // nach "Erneut senden" eigener Schlüssel, damit nicht die gespeicherte Ablehnung zurückkommt.
  // Die Objekt-ID bleibt gleich, eine Ablehnung hat nichts angelegt: keine Dublette möglich.
  const retried = entry.revision ? key : null;
  switch (entry.kind) {
    case 'photo': {
      const photo = p as unknown as PhotoPayload;
      const file = await api.uploadFile({ uri: photo.uri, name: photo.name, mimeType: photo.mimeType, sizeBytes: photo.sizeBytes }, { idempotencyKey: `${key}.upload` });
      await api.attachPhoto(
        entry.workOrderId,
        { id: photo.photoId, fileId: file.id, context: photo.context, caption: photo.caption ?? null, findingId: photo.findingId ?? null, takenAt: photo.takenAt },
        retried ? { idempotencyKey: `${retried}.photo` } : undefined,
      );
      return;
    }
    case 'createFinding':
      await api.createFinding(entry.workOrderId, { ...(p as unknown as FindingInput), id: entry.id }, retried ? { idempotencyKey: retried } : undefined);
      return;
    case 'reportFinding':
      await api.reportFinding(String(p.findingId), { idempotencyKey: key });
      return;
    case 'startWorkItem':
      await api.startWorkItem(String(p.itemId), time, { idempotencyKey: key });
      return;
    case 'pauseWorkItem':
      await api.pauseWorkItem(String(p.itemId), time, { idempotencyKey: key });
      return;
    case 'finishWorkItem':
      await api.finishWorkItem(String(p.itemId), { ...(p.input as FinishWorkItemInput), ...time }, { idempotencyKey: key });
      return;
    case 'notDoneWorkItem':
      await api.notDoneWorkItem(String(p.itemId), { ...(p.input as NotDoneWorkItemInput), ...time }, { idempotencyKey: key });
      return;
    case 'addPart':
      await api.addPart(String(p.itemId), p.input as PartUsedInput, { idempotencyKey: key });
      return;
    case 'addInternalNote':
      await api.addInternalNote(entry.workOrderId, { body: String(p.body) }, { idempotencyKey: key });
      return;
    case 'sendMessage':
      await api.sendMessage(entry.workOrderId, { clientMessageId: entry.id, body: String(p.body ?? ''), fileIds: [] }, retried ? { idempotencyKey: `message:${retried}` } : undefined);
      return;
  }
}

export type SubmitResult = { type: 'done' } | { type: 'queued' } | { type: 'rejected'; error: QueueError };

export class OfflineQueue {
  private entries: QueueEntry[] = [];
  private listeners = new Set<() => void>();
  private flushing: Promise<void> | null = null;
  private loaded = false;

  constructor(
    private readonly api: WerkstattApi,
    private readonly storage: QueueStorage,
    private readonly key: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async init(): Promise<void> {
    if (this.loaded) return;
    this.entries = parseStored(await this.storage.load(this.key).catch(() => null));
    this.loaded = true;
    this.emit();
  }

  list(): QueueEntry[] {
    return this.entries;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    for (const l of [...this.listeners]) l();
  }

  private async set(entries: QueueEntry[]) {
    this.entries = entries;
    this.emit();
    try {
      await this.storage.save(this.key, serialize(entries));
    } catch {
      // Speicher voll oder nicht verfügbar: Einträge bleiben im Speicher der laufenden App
    }
  }

  async enqueue(items: NewQueueEntry[]): Promise<void> {
    await this.init();
    const at = this.now().toISOString();
    await this.set([...this.entries, ...items.map((i) => createEntry(i, at))]);
  }

  /**
   * Alles Übertragbare senden. Läuft nur einmal gleichzeitig. Bei einem Verbindungsfehler
   * endet der Durchlauf (später erneut); Konflikte blockieren nur ihren Bereich.
   */
  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.run().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async run(): Promise<void> {
    await this.init();
    for (;;) {
      const next = nextRunnable(this.entries);
      if (!next) return;
      await this.set(markSending(this.entries, next.id));
      let outcome: Outcome;
      try {
        await execute(this.api, next);
        outcome = { type: 'done' };
      } catch (e) {
        outcome = classifyError(toApiError(e));
      }
      await this.set(applyOutcome(this.entries, next.id, outcome, this.now().toISOString()));
      if (outcome.type === 'network') return;
    }
  }

  /**
   * Aktion des Mechanikers: speichern und sofort übertragen, wenn online. Lehnt der Server
   * dabei ab, wird der Eintrag nicht in der Warteschlange behalten, sondern der Fehler direkt
   * in der Ansicht gezeigt. Ohne Verbindung bleibt er gespeichert ("Nicht synchronisiert").
   *
   * Sofort übertragen heißt: Erfassung und Übertragung fallen zusammen. Lehnt der Server nur
   * den Zeitpunkt vom Gerät ab (Geräteuhr weicht ab), wird einmal ohne Gerätezeit gesendet;
   * dann gilt die Serverzeit, die hier dem Erfassungszeitpunkt entspricht.
   */
  async submit(items: NewQueueEntry[], options: { online: boolean }): Promise<SubmitResult> {
    await this.enqueue(items);
    if (!options.online) return { type: 'queued' };
    await this.flush();
    const ids = new Set(items.map((i) => i.id));
    const clock = this.entries.filter((e) => ids.has(e.id) && isDeviceTimeConflict(e));
    if (clock.length > 0) {
      let entries = this.entries;
      for (const e of clock) entries = retryEntry(entries, e.id, { withoutDeviceTime: true });
      await this.set(entries);
      await this.flush();
    }
    const mine = this.entries.filter((e) => ids.has(e.id));
    if (mine.length === 0) return { type: 'done' };
    const conflict = mine.find((e) => e.state === 'conflict');
    if (conflict?.lastError) {
      let entries = this.entries;
      for (const e of mine) entries = discardEntry(entries, e.id).entries;
      await this.set(entries);
      return { type: 'rejected', error: conflict.lastError };
    }
    return { type: 'queued' };
  }

  /** Konflikt erneut senden (neuer Idempotency-Key); `withoutDeviceTime`: Serverzeit statt Gerätezeit. */
  async retry(id: string, options: { withoutDeviceTime?: boolean } = {}): Promise<void> {
    await this.set(retryEntry(this.entries, id, options));
    await this.flush();
  }

  async discard(id: string): Promise<string[]> {
    const { entries, removed } = discardEntry(this.entries, id);
    await this.set(entries);
    return removed;
  }
}
