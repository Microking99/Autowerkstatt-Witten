/**
 * Fahrzeuge: km-Plausibilität, Halterwechsel, Kennzeichen und FIN.
 */
import { VinSchema } from '@werkstatt/contracts';
import { toDate } from '../common/dates';
import { fail, ok, type DomainIssue, type Result } from '../common/result';

// ---------------------------------------------------------------------------
// Kilometerstände
// ---------------------------------------------------------------------------

export type OdometerPlausibility = 'ok' | 'lower_than_previous';

/**
 * Plausibilität eines neuen km-Stands (R-FZG-2: Werte werden nie überschrieben; unplausible
 * werden gespeichert, aber markiert). `lower_than_previous`, wenn der Wert unter dem höchsten
 * zuvor (zum selben oder früheren Zeitpunkt) erfassten plausiblen Stand liegt.
 * Bereits als unplausibel markierte Stände werden als Vergleich nicht herangezogen.
 */
export function checkOdometerPlausibility(
  previousReadings: readonly { valueKm: number; recordedAt: string; plausibility?: OdometerPlausibility }[],
  value: number,
  recordedAt: Date | string,
): OdometerPlausibility {
  const at = toDate(recordedAt).getTime();
  let max = Number.NEGATIVE_INFINITY;
  for (const r of previousReadings) {
    if (r.plausibility === 'lower_than_previous') continue;
    if (toDate(r.recordedAt).getTime() <= at && r.valueKm > max) max = r.valueKm;
  }
  return value < max ? 'lower_than_previous' : 'ok';
}

// ---------------------------------------------------------------------------
// Halterwechsel
// ---------------------------------------------------------------------------

/** Aktueller Halterzeitraum (`vehicle_ownerships`). */
export interface OwnershipPeriod {
  id: string;
  customerId: string;
  startedAt: string;
  endedAt: string | null;
}

export type OwnershipTransferCode = 'NOT_CURRENT' | 'SAME_CUSTOMER' | 'BEFORE_CURRENT_START' | 'IN_FUTURE';

/** Plan für einen Halterwechsel. */
export interface OwnershipTransferPlan {
  /** Bisherigen Zeitraum beenden. */
  endCurrent: { ownershipId: string; endedAt: string };
  /** Neuen Zeitraum beginnen. */
  startNew: { customerId: string; startedAt: string; endedAt: null };
  /**
   * Freigaben für Dritte, die der bisherige Halter angelegt hat, sind zu widerrufen, und die
   * öffentliche QR-Kurzansicht ist auszuschalten: Beides hat der bisherige Halter entschieden,
   * nicht der neue (docs/rollen-und-rechte.md, Abschnitt 4).
   */
  revokeSharesOfPreviousOwner: true;
  disableQrPublicView: true;
}

/**
 * Plant einen Halterwechsel (R-FZG-3, R-FZG-4). Aufträge, Rechnungen, Dokumente und
 * Nachrichten bleiben beim bisherigen Kunden (sie tragen dessen `customer_id`).
 * - nicht an denselben Kunden,
 * - Wechselzeitpunkt nach Beginn des aktuellen Zeitraums,
 * - mit `now`: nicht in der Zukunft (sonst gälte der neue Halter nach der Regel
 *   `ended_at IS NULL` schon vor dem Wechsel als aktuell).
 */
export function planOwnershipTransfer(input: {
  current: OwnershipPeriod;
  newCustomerId: string;
  effectiveAt: Date | string;
  now?: Date;
}): Result<OwnershipTransferPlan, DomainIssue<OwnershipTransferCode>> {
  const { current, newCustomerId } = input;
  if (current.endedAt !== null) return fail('NOT_CURRENT', 'Der angegebene Halterzeitraum ist bereits beendet.');
  if (current.customerId === newCustomerId) return fail('SAME_CUSTOMER', 'Der neue Halter ist bereits aktueller Halter.');
  const effective = toDate(input.effectiveAt);
  if (effective.getTime() <= toDate(current.startedAt).getTime()) {
    return fail('BEFORE_CURRENT_START', 'Der Wechsel muss nach Beginn des aktuellen Halterzeitraums liegen.');
  }
  if (input.now && effective.getTime() > input.now.getTime()) {
    return fail('IN_FUTURE', 'Ein Halterwechsel kann nicht in der Zukunft gebucht werden.');
  }
  const at = effective.toISOString();
  return ok({
    endCurrent: { ownershipId: current.id, endedAt: at },
    startNew: { customerId: newCustomerId, startedAt: at, endedAt: null },
    revokeSharesOfPreviousOwner: true,
    disableQrPublicView: true,
  });
}

/** Aktueller Halter aus den Zeiträumen (`ended_at IS NULL`), sonst `null`. */
export function currentOwnerCustomerId(periods: readonly Pick<OwnershipPeriod, 'customerId' | 'endedAt'>[]): string | null {
  return periods.find((p) => p.endedAt === null)?.customerId ?? null;
}

// ---------------------------------------------------------------------------
// Kennzeichen und FIN
// ---------------------------------------------------------------------------

const LETTERS = 'A-ZÄÖÜ';

/**
 * Vereinheitlicht ein deutsches Kennzeichen: Großschreibung, einheitliche Trennzeichen
 * ("Unterscheidungszeichen-Buchstaben Ziffern"), z. B. "en-ab 123" → "EN-AB 123",
 * "EN AB 123" → "EN-AB 123", "en-ab123e" → "EN-AB 123E".
 * Nicht eindeutig zerlegbare Eingaben (z. B. "ENAB123") werden nur großgeschrieben und
 * Leerraum vereinheitlicht.
 */
export function normalizeLicensePlate(input: string): string {
  const upper = input.trim().toUpperCase();
  const tokens = upper.split(/[\s\-_.:‐-―]+/).filter((t) => t.length > 0);
  const district = new RegExp(`^[${LETTERS}]{1,3}$`);
  const letters = new RegExp(`^[${LETTERS}]{1,2}$`);
  const digits = /^\d{1,4}[EH]?$/;
  const lettersDigits = new RegExp(`^([${LETTERS}]{1,2})(\\d{1,4}[EH]?)$`);
  const [a, b, c] = tokens;
  if (tokens.length === 3 && a && b && c && district.test(a) && letters.test(b) && digits.test(c)) {
    return `${a}-${b} ${c}`;
  }
  if (tokens.length === 2 && a && b && district.test(a)) {
    const m = lettersDigits.exec(b);
    if (m) return `${a}-${m[1]} ${m[2]}`;
  }
  return tokens.join(' ');
}

/** true, wenn das (normalisierte) Kennzeichen dem üblichen deutschen Aufbau entspricht. */
export function isGermanLicensePlate(normalized: string): boolean {
  return new RegExp(`^[${LETTERS}]{1,3}-[${LETTERS}]{1,2} [1-9]\\d{0,3}[EH]?$`).test(normalized);
}

/** Suchschlüssel für Kennzeichen: nur Buchstaben und Ziffern ("EN-AB 123" → "ENAB123"). */
export function licensePlateSearchKey(input: string): string {
  return input.toUpperCase().replace(new RegExp(`[^${LETTERS}0-9]`, 'g'), '');
}

/** Prüft und normalisiert eine FIN über `VinSchema` aus @werkstatt/contracts (17 Zeichen, ohne I, O, Q). */
export function validateVin(input: string): Result<string, DomainIssue<'INVALID_VIN'>> {
  const parsed = VinSchema.safeParse(input);
  if (!parsed.success) return fail('INVALID_VIN', 'FIN muss 17 Zeichen haben (ohne I, O, Q).');
  return ok(parsed.data);
}
