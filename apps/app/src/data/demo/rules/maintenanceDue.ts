/**
 * Fälligkeiten aus der Servicehistorie (R-SERV-2 bis R-SERV-4, R-KAL-1).
 *
 * - Kombinierte Intervalle: die zuerst erreichte Grenze (Datum oder km) ist maßgeblich.
 * - Ohne aktuellen km-Stand keine vorgetäuschte km-Fälligkeit: Liegt die letzte Angabe
 *   länger zurück, wird hochgerechnet und als Schätzung gekennzeichnet; ohne ausreichende
 *   Angaben bleibt die km-Fälligkeit unbekannt.
 *
 * Platzhalter für @werkstatt/domain; reine Funktionen.
 */
import type { DueBasis, MaintenanceDue } from '@werkstatt/contracts';
import { formatDate, formatKm } from '../../../lib/format';
import type { DOdometer, DServiceEntry } from '../model';

const DAY = 86_400_000;
/** km-Angabe gilt bis zu 14 Tage als aktuell */
const RECENT_DAYS = 14;
/** Für eine Hochrechnung müssen die Angaben mindestens 60 Tage auseinanderliegen */
const MIN_SPAN_DAYS = 60;
const SOON_DAYS = 60;
const SOON_KM = 1_500;

function dayDiff(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso.length === 10 ? `${fromIso}T00:00:00Z` : fromIso);
  const to = Date.parse(toIso.length === 10 ? `${toIso}T00:00:00Z` : toIso);
  return Math.floor((to - from) / DAY);
}

export interface KmEstimate {
  km: number | null;
  basis: Extract<DueBasis, 'km_recorded' | 'km_estimated' | 'unknown'>;
  kmPerDay: number | null;
  lastReading: DOdometer | null;
}

export function estimateCurrentKm(readings: readonly DOdometer[], vehicleId: string, today: string): KmEstimate {
  const own = readings
    .filter((r) => r.vehicleId === vehicleId && r.plausibility === 'ok')
    .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1));
  const last = own.at(-1) ?? null;
  if (!last) return { km: null, basis: 'unknown', kmPerDay: null, lastReading: null };
  const first = own.find((r) => dayDiff(r.recordedAt, last.recordedAt) >= MIN_SPAN_DAYS) ?? null;
  const kmPerDay =
    first && first !== last ? Math.max(0, (last.valueKm - first.valueKm) / dayDiff(first.recordedAt, last.recordedAt)) : null;
  const sinceLast = dayDiff(last.recordedAt, today);
  if (sinceLast <= RECENT_DAYS) return { km: last.valueKm, basis: 'km_recorded', kmPerDay, lastReading: last };
  if (kmPerDay !== null) {
    return { km: Math.round(last.valueKm + kmPerDay * sinceLast), basis: 'km_estimated', kmPerDay, lastReading: last };
  }
  return { km: null, basis: 'unknown', kmPerDay: null, lastReading: last };
}

function latestPerType(entries: readonly DServiceEntry[]): DServiceEntry[] {
  const byKey = new Map<string, DServiceEntry>();
  for (const e of entries) {
    if (e.status !== 'valid') continue;
    const key = e.maintenanceTypeId ?? `titel:${e.title}`;
    const current = byKey.get(key);
    if (!current || e.performedOn > current.performedOn) byKey.set(key, e);
  }
  return [...byKey.values()];
}

export function computeMaintenanceDue(
  entries: readonly DServiceEntry[],
  readings: readonly DOdometer[],
  vehicleId: string,
  today: string,
): MaintenanceDue[] {
  const estimate = estimateCurrentKm(readings, vehicleId, today);
  const latest = latestPerType(entries.filter((e) => e.vehicleId === vehicleId));
  const result = latest
    .filter((e) => e.nextDueDate !== null || e.nextDueKm !== null)
    .map((entry): MaintenanceDue => {
      const dateDays = entry.nextDueDate ? dayDiff(today, entry.nextDueDate) : null;
      const kmRemaining = entry.nextDueKm !== null && estimate.km !== null ? entry.nextDueKm - estimate.km : null;
      const kmDays =
        kmRemaining === null
          ? null
          : kmRemaining <= 0
            ? 0
            : estimate.kmPerDay && estimate.kmPerDay > 0
              ? Math.floor(kmRemaining / estimate.kmPerDay)
              : null;

      let governingLimit: MaintenanceDue['governingLimit'];
      if (dateDays === null && kmRemaining === null) governingLimit = 'none';
      else if (dateDays === null) governingLimit = 'km';
      else if (kmDays === null) governingLimit = 'date';
      else governingLimit = kmDays < dateDays ? 'km' : 'date';

      const overdue = (dateDays !== null && dateDays < 0) || (kmRemaining !== null && kmRemaining <= 0);
      const soon = (dateDays !== null && dateDays <= SOON_DAYS) || (kmRemaining !== null && kmRemaining <= SOON_KM);
      const state: MaintenanceDue['state'] =
        governingLimit === 'none' ? 'unknown' : overdue ? 'overdue' : soon ? 'due_soon' : 'ok';
      const basis: DueBasis = governingLimit === 'date' ? 'date' : governingLimit === 'km' ? estimate.basis : 'unknown';

      return {
        vehicleId,
        maintenanceTypeId: entry.maintenanceTypeId,
        title: entry.title,
        lastServiceEntryId: entry.id,
        dueDate: entry.nextDueDate,
        dueKm: entry.nextDueKm,
        governingLimit,
        basis,
        estimatedCurrentKm: estimate.basis === 'km_estimated' && entry.nextDueKm !== null ? estimate.km : null,
        state,
        explanation: explain(entry, estimate, governingLimit),
      };
    });
  const rank = { overdue: 0, due_soon: 1, ok: 2, unknown: 3 } as const;
  return result.sort((a, b) => rank[a.state] - rank[b.state] || (a.dueDate ?? '9999') .localeCompare(b.dueDate ?? '9999'));
}

function explain(entry: DServiceEntry, estimate: KmEstimate, governing: MaintenanceDue['governingLimit']): string {
  const parts: string[] = [];
  if (entry.nextDueDate && entry.nextDueKm !== null) {
    parts.push(`Fällig am ${formatDate(entry.nextDueDate)} oder bei ${formatKm(entry.nextDueKm)}, je nachdem, was zuerst eintritt.`);
  } else if (entry.nextDueDate) {
    parts.push(`Fällig am ${formatDate(entry.nextDueDate)}.`);
  } else if (entry.nextDueKm !== null) {
    parts.push(`Fällig bei ${formatKm(entry.nextDueKm)}.`);
  }
  if (entry.nextDueKm !== null) {
    if (estimate.basis === 'km_recorded' && estimate.km !== null) {
      parts.push(`Aktueller Kilometerstand: ${formatKm(estimate.km)}.`);
    } else if (estimate.basis === 'km_estimated' && estimate.km !== null && estimate.lastReading) {
      parts.push(
        `Kilometerstand geschätzt: etwa ${formatKm(estimate.km)}, hochgerechnet aus der letzten Angabe vom ${formatDate(
          estimate.lastReading.recordedAt,
        )}.`,
      );
    } else {
      parts.push('Ohne aktuellen Kilometerstand lässt sich die Kilometerfälligkeit nicht bestimmen.');
    }
  }
  if (governing === 'km' && estimate.basis === 'km_estimated') parts.push('Die Kilometergrenze wird voraussichtlich zuerst erreicht.');
  return parts.join(' ');
}
