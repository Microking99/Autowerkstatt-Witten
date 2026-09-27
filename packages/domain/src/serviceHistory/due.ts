/**
 * Wartungsfälligkeiten aus der Servicehistorie (R-SERV-4, R-KAL-1).
 *
 * Regeln:
 * - Nur gültige Einträge (`status = valid`); je Wartungsart zählt der jüngste Eintrag.
 * - Kombinierte Intervalle (Zeit und km): Maßgeblich ist die zuerst erreichte Grenze.
 * - km-Fälligkeit gilt nur als sicher (`km_recorded`), wenn nach dem Eintrag ein km-Stand
 *   erfasst wurde (Ablesedatum nach dem Durchführungsdatum).
 * - Sonst wird geschätzt (`km_estimated`), wenn mindestens 2 km-Stände über mindestens 30 Tage
 *   vorliegen (Durchschnitt km pro Tag zwischen ältestem und jüngstem Stand; der km-Stand des
 *   Eintrags zählt mit). Die Erklärung sagt ausdrücklich "geschätzt anhand ...".
 * - Ohne Grundlage wird keine km-Fälligkeit vorgetäuscht (`unknown`).
 * - Als unplausibel markierte km-Stände (`lower_than_previous`) werden nicht verwendet.
 * - Ablesezeitpunkte werden in Berliner Kalendertage umgerechnet.
 */
import type { DueBasis, MaintenanceDue } from '@werkstatt/contracts';
import { addDays, addMonths, compareIsoDates, daysBetween, type IsoDate } from '../common/dates';
import { berlinDateOf } from '../format/berlin';
import { formatDate, formatDecimal, formatKm } from '../format/format';
import type { ServiceEntryRecord } from './entries';

/** km-Stand eines Fahrzeugs (Historie). */
export interface OdometerReadingInput {
  valueKm: number;
  recordedAt: string;
  plausibility?: 'ok' | 'lower_than_previous';
}

type DueState = MaintenanceDue['state'];

const SEVERITY: Record<DueState, number> = { overdue: 3, due_soon: 2, ok: 1, unknown: 0 };

interface KmPoint {
  date: IsoDate;
  km: number;
}

interface KmAssessment {
  basis: Extract<DueBasis, 'km_recorded' | 'km_estimated' | 'unknown'>;
  currentKm: number | null;
  /** Nur bei Schätzung. */
  estimatedCurrentKm: number | null;
  /** Durchschnitt km pro Tag, falls ermittelbar. */
  kmPerDay: number | null;
  pointCount: number;
  recordedOn: IsoDate | null;
}

function assessKm(entry: ServiceEntryRecord, readings: readonly OdometerReadingInput[], today: IsoDate): KmAssessment {
  const plausible: KmPoint[] = readings
    .filter((r) => r.plausibility !== 'lower_than_previous' && Number.isFinite(r.valueKm) && r.valueKm >= 0)
    .map((r) => ({ date: berlinDateOf(r.recordedAt), km: r.valueKm }))
    .filter((p) => compareIsoDates(p.date, today) <= 0);

  const points = [...plausible];
  if (entry.odometerKm !== null) points.push({ date: entry.performedOn, km: entry.odometerKm });
  const unique = new Map<string, KmPoint>();
  for (const p of points) unique.set(`${p.date}|${p.km}`, p);
  const sorted = [...unique.values()].sort((a, b) => compareIsoDates(a.date, b.date) || a.km - b.km);

  let kmPerDay: number | null = null;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (sorted.length >= 2 && first && last && daysBetween(first.date, last.date) >= 30 && last.km >= first.km) {
    kmPerDay = (last.km - first.km) / daysBetween(first.date, last.date);
  }

  const after = plausible
    .filter((p) => compareIsoDates(p.date, entry.performedOn) > 0)
    .sort((a, b) => compareIsoDates(a.date, b.date) || a.km - b.km);
  const latestAfter = after[after.length - 1];
  if (latestAfter) {
    return { basis: 'km_recorded', currentKm: latestAfter.km, estimatedCurrentKm: null, kmPerDay, pointCount: sorted.length, recordedOn: latestAfter.date };
  }
  if (kmPerDay !== null && last) {
    const estimate = Math.round(last.km + kmPerDay * Math.max(0, daysBetween(last.date, today)));
    return { basis: 'km_estimated', currentKm: estimate, estimatedCurrentKm: estimate, kmPerDay, pointCount: sorted.length, recordedOn: null };
  }
  return { basis: 'unknown', currentKm: null, estimatedCurrentKm: null, kmPerDay, pointCount: sorted.length, recordedOn: null };
}

function stateByDays(daysLeft: number, dueSoonDays: number): DueState {
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= dueSoonDays) return 'due_soon';
  return 'ok';
}

function stateByKm(kmLeft: number, dueSoonKm: number): DueState {
  if (kmLeft < 0) return 'overdue';
  if (kmLeft <= dueSoonKm) return 'due_soon';
  return 'ok';
}

/**
 * Bewertet die Fälligkeit zu einem Serviceeintrag.
 * Liefert `null` für nicht gültige Einträge (`superseded`, `voided`).
 *
 * @param input.today Heutiges Datum in Berlin (`YYYY-MM-DD`).
 * @param input.dueSoonDays Ab wie vielen Resttagen "bald fällig" (Standard 30).
 * @param input.dueSoonKm Ab wie vielen Rest-km "bald fällig" (Standard 1000).
 */
export function evaluateMaintenanceDue(input: {
  entry: ServiceEntryRecord;
  odometerReadings: readonly OdometerReadingInput[];
  today: IsoDate;
  dueSoonDays?: number;
  dueSoonKm?: number;
}): MaintenanceDue | null {
  const { entry, today } = input;
  if (entry.status !== 'valid') return null;
  const dueSoonDays = input.dueSoonDays ?? 30;
  const dueSoonKm = input.dueSoonKm ?? 1000;

  const dueDate = entry.nextDueDate ?? (entry.intervalMonths ? addMonths(entry.performedOn, entry.intervalMonths) : null);
  const dueKm = entry.nextDueKm ?? (entry.odometerKm !== null && entry.intervalKm ? entry.odometerKm + entry.intervalKm : null);
  const hasKmInterval = entry.intervalKm !== null && entry.intervalKm > 0;
  const base = {
    vehicleId: entry.vehicleId,
    maintenanceTypeId: entry.maintenanceTypeId,
    title: entry.maintenanceTypeName ?? entry.title,
    lastServiceEntryId: entry.id,
    dueDate,
    dueKm,
  };

  // Zeitgrenze
  let dateState: DueState | null = null;
  let dateText: string | null = null;
  if (dueDate !== null) {
    const daysLeft = daysBetween(today, dueDate);
    dateState = stateByDays(daysLeft, dueSoonDays);
    const suffix = daysLeft < 0 ? `, seit ${-daysLeft} Tagen überschritten` : daysLeft === 0 ? ', also heute' : `, noch ${daysLeft} Tage`;
    dateText = `Zeitgrenze: fällig am ${formatDate(dueDate)}${suffix}.`;
  }

  // Kilometergrenze
  const km = assessKm(entry, input.odometerReadings, today);
  let kmState: DueState | null = null;
  let kmReach: IsoDate | null = null;
  let kmText: string | null = null;
  if (dueKm !== null) {
    if (km.currentKm !== null) {
      const kmLeft = dueKm - km.currentKm;
      kmState = stateByKm(kmLeft, dueSoonKm);
      if (km.kmPerDay !== null && km.kmPerDay > 0) kmReach = addDays(today, Math.ceil(kmLeft / km.kmPerDay));
      if (km.basis === 'km_recorded') {
        kmText = `Kilometergrenze: fällig bei ${formatKm(dueKm)}, zuletzt erfasst ${formatKm(km.currentKm)} am ${formatDate(km.recordedOn!)}.`;
      } else {
        kmText =
          `Kilometergrenze: fällig bei ${formatKm(dueKm)}; aktueller Stand geschätzt anhand von ${km.pointCount} Kilometerständen ` +
          `(Durchschnitt ${formatDecimal(km.kmPerDay ?? 0, 1)} km pro Tag): etwa ${formatKm(km.currentKm)}. Keine Ablesung nach dem Eintrag.`;
      }
    } else {
      kmText = `Kilometergrenze bei ${formatKm(dueKm)} nicht beurteilbar: kein km-Stand nach dem Eintrag und zu wenige Daten für eine Schätzung.`;
    }
  } else if (hasKmInterval) {
    kmText = 'Kilometergrenze nicht berechenbar: km-Stand bei der Durchführung unbekannt.';
  }

  const texts = (lead: string): string => [lead, dateText, kmText].filter((t): t is string => t !== null).join(' ');

  // Keine Grenze bestimmbar
  if (dateState === null && kmState === null) {
    if (dueDate === null && dueKm === null && !hasKmInterval) {
      return { ...base, governingLimit: 'none', basis: 'unknown', estimatedCurrentKm: null, state: 'unknown', explanation: 'Für diesen Eintrag ist kein Wartungsintervall hinterlegt.' };
    }
    return {
      ...base,
      governingLimit: 'km',
      basis: 'unknown',
      estimatedCurrentKm: null,
      state: 'unknown',
      explanation: texts('Fälligkeit unbekannt.'),
    };
  }

  // Maßgebliche Grenze wählen: dringlicherer Zustand; bei Gleichstand die früher erreichte.
  let governing: 'date' | 'km';
  if (kmState === null) governing = 'date';
  else if (dateState === null) governing = 'km';
  else if (SEVERITY[kmState] !== SEVERITY[dateState]) governing = SEVERITY[kmState] > SEVERITY[dateState] ? 'km' : 'date';
  else governing = kmReach !== null && dueDate !== null && compareIsoDates(kmReach, dueDate) < 0 ? 'km' : 'date';

  const state = governing === 'date' ? dateState! : kmState!;
  const basis: DueBasis = governing === 'date' ? 'date' : km.basis;
  const lead =
    governing === 'date'
      ? 'Maßgeblich ist die Zeitgrenze.'
      : km.basis === 'km_estimated'
        ? 'Maßgeblich ist die Kilometergrenze (geschätzt).'
        : 'Maßgeblich ist die Kilometergrenze.';
  return {
    ...base,
    governingLimit: governing,
    basis,
    // Schätzung nur, wenn eine Kilometergrenze sie braucht (reine Zeitintervalle wie HU: keine)
    estimatedCurrentKm: dueKm !== null ? km.estimatedCurrentKm : null,
    state,
    explanation: texts(lead),
  };
}

/**
 * Fälligkeiten eines Fahrzeugs: je Wartungsart der jüngste gültige Eintrag (nach Datum, dann
 * Revision), sortiert nach Dringlichkeit (überfällig zuerst), dann nach Datum.
 */
export function evaluateVehicleMaintenance(input: {
  entries: readonly ServiceEntryRecord[];
  odometerReadings: readonly OdometerReadingInput[];
  today: IsoDate;
  dueSoonDays?: number;
  dueSoonKm?: number;
}): MaintenanceDue[] {
  const latest = new Map<string, ServiceEntryRecord>();
  for (const entry of input.entries) {
    if (entry.status !== 'valid') continue;
    const key = entry.maintenanceTypeId ?? `entry:${entry.id}`;
    const current = latest.get(key);
    if (
      !current ||
      compareIsoDates(entry.performedOn, current.performedOn) > 0 ||
      (compareIsoDates(entry.performedOn, current.performedOn) === 0 && entry.revisionNo > current.revisionNo)
    ) {
      latest.set(key, entry);
    }
  }
  const results: MaintenanceDue[] = [];
  for (const entry of latest.values()) {
    const due = evaluateMaintenanceDue({ ...input, entry });
    if (due) results.push(due);
  }
  return results.sort((a, b) => {
    const s = SEVERITY[b.state] - SEVERITY[a.state];
    if (s !== 0) return s;
    if (a.dueDate && b.dueDate) return compareIsoDates(a.dueDate, b.dueDate);
    return a.dueDate ? -1 : b.dueDate ? 1 : 0;
  });
}
