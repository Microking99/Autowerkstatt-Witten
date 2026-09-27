/**
 * Zeitanzeige und Teileliste einer Position in der Mechanikeransicht (reine Logik, ohne React
 * Native, unit-getestet).
 *
 * Zeit: maßgeblich ist der Server (`trackedMinutes`, `runningSince`). Lokal gezählt wird nur,
 * was noch in der Offline-Warteschlange steht (Start, Pause, Abschluss, "nicht durchgeführt"
 * mit ihrem Erfassungszeitpunkt). Ein Konflikt beendet die Vorschau: Was dahinter wartet, ist
 * noch nicht entschieden.
 */
import type { PartUsed, WorkItem } from '@werkstatt/contracts';
import type { QueueEntry } from '../../offline/queueCore';

const MINUTE = 60_000;

export interface ItemTiming {
  /** Erfasste Minuten einschließlich laufendem Abschnitt bis `now` */
  minutes: number;
  /** Beginn des laufenden Abschnitts (Server oder Gerät), sonst null */
  since: string | null;
  /** true: laufender Abschnitt nur auf dem Gerät gestartet (noch nicht übertragen) */
  sinceLocal: boolean;
}

type TimingEntry = Pick<QueueEntry, 'kind' | 'state' | 'createdAt'>;

/**
 * @param fetchedAt Zeitpunkt (Gerät), zu dem die Serverdaten geladen wurden. Der Server rechnet
 *   den laufenden Abschnitt bis zu seiner Antwort in `trackedMinutes` ein; weiter gezählt wird ab
 *   `fetchedAt`, damit eine abweichende Geräteuhr die Anzeige nicht verfälscht.
 */
export function itemTiming(
  item: Pick<WorkItem, 'executionStatus' | 'trackedMinutes' | 'runningSince'>,
  pending: readonly TimingEntry[],
  fetchedAt: string | null,
  now: Date,
): ItemTiming {
  const nowMs = now.getTime();
  const tracked = item.trackedMinutes ?? 0;
  let closedMs: number;
  // Beginn des laufenden Abschnitts auf der Uhr des Geräts
  let runStart: number | null = null;
  let since: string | null = null;
  let sinceLocal = false;
  if (item.executionStatus === 'in_progress' && item.runningSince) {
    const fetched = fetchedAt ? Date.parse(fetchedAt) : nowMs;
    const runningAtFetch = Math.max(0, fetched - Date.parse(item.runningSince));
    const running = Math.min(tracked * MINUTE, runningAtFetch);
    closedMs = tracked * MINUTE - running;
    runStart = fetched - running;
    since = item.runningSince;
  } else {
    closedMs = tracked * MINUTE;
  }
  for (const e of pending) {
    if (e.state === 'conflict') break;
    const at = Date.parse(e.createdAt);
    if (e.kind === 'startWorkItem') {
      if (runStart === null) {
        runStart = at;
        since = e.createdAt;
        sinceLocal = true;
      }
    } else if (e.kind === 'pauseWorkItem' || e.kind === 'finishWorkItem' || e.kind === 'notDoneWorkItem') {
      if (runStart !== null) closedMs += Math.max(0, at - runStart);
      runStart = null;
      since = null;
      sinceLocal = false;
    }
  }
  const runningMs = runStart !== null ? Math.max(0, nowMs - runStart) : 0;
  return { minutes: Math.round((closedMs + runningMs) / MINUTE), since, sinceLocal };
}

/** Eintrag der Teileliste: vom Server bestätigt oder noch in der Warteschlange. */
export interface PartRow {
  key: string;
  partNumber: string | null;
  description: string;
  quantity: number;
  /** Nur für Service/Inhaber vorhanden */
  unitPriceCents?: number | null;
  recordedAt: string;
  /** Noch nicht übertragen (Warteschlange); `conflict`: vom Server abgelehnt */
  pending: null | { entry: QueueEntry; conflict: boolean };
}

/** Teile vom Server (älteste zuerst), danach wartende Einträge aus der Warteschlange. */
export function partRows(serverParts: readonly PartUsed[] | undefined, pending: readonly QueueEntry[]): PartRow[] {
  const confirmed: PartRow[] = (serverParts ?? []).map((p) => ({
    key: p.id,
    partNumber: p.partNumber,
    description: p.description,
    quantity: p.quantity,
    ...(p.unitPriceCents !== undefined ? { unitPriceCents: p.unitPriceCents } : {}),
    recordedAt: p.recordedAt,
    pending: null,
  }));
  const waiting: PartRow[] = pending
    .filter((e) => e.kind === 'addPart')
    .map((e) => {
      const input = (e.payload.input ?? {}) as { partNumber?: string | null; description?: string; quantity?: number };
      return {
        key: e.id,
        partNumber: input.partNumber ?? null,
        description: input.description ?? '',
        quantity: input.quantity ?? 1,
        recordedAt: e.createdAt,
        pending: { entry: e, conflict: e.state === 'conflict' },
      };
    });
  return [...confirmed, ...waiting];
}

/** "2 × Ölfilter (OF-1034)" bzw. "4,5 × Motoröl" */
export function partLabel(p: Pick<PartRow, 'quantity' | 'description' | 'partNumber'>): string {
  return `${String(p.quantity).replace('.', ',')} × ${p.description}${p.partNumber ? ` (${p.partNumber})` : ''}`;
}
