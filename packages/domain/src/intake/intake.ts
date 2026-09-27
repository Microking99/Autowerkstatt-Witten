/**
 * Digitale Fahrzeugannahme: kanonischer Inhalt und Hash für die Bestätigung (R-ANN-1 bis R-ANN-3).
 *
 * Die Bestätigung bezieht sich NUR auf den kundenbezogenen Inhalt der Annahme und die dort
 * vereinbarten Leistungen: km-Stand, Tankstand, Beanstandung, Schäden, vereinbarte
 * Leistungen (Text und Positionen mit Herkunft `intake`), Kostenrahmen, Hinweise an den Kunden.
 * Nicht enthalten sind interne Hinweise (`notesInternal`) und spätere Zusatzarbeiten
 * (Positionen mit Herkunft `offer`/`additional`): Diese brauchen eine eigene Freigabe.
 */
import type { WorkItemKind, WorkItemOrigin } from '@werkstatt/contracts';
import { canonicalJson, normalizeId, normalizeOptionalText, normalizeText, sha256Hex } from '../common/hash';
import { canonicalQuantity } from '../common/money';

/** Annahme, wie sie erfasst wurde. */
export interface IntakeHashInput {
  workOrderId: string;
  odometerKm: number | null;
  fuelLevel?: string | null;
  customerComplaint: string;
  damages?: readonly { area: string; description: string; photoId: string | null }[];
  agreedServices: string;
  costLimitCents?: number | null;
  notesCustomer?: string | null;
  /** Wird NICHT in den Hash übernommen (intern). */
  notesInternal?: string | null;
  /** Positionen des Auftrags; berücksichtigt werden nur die mit Herkunft `intake`. */
  items?: readonly {
    origin: WorkItemOrigin;
    title: string;
    description?: string | null;
    quantity: number;
    unit: string;
    unitPriceCents?: number | null;
    /** Umsatzsteuersatz in Basispunkten; bestimmt den Bruttobetrag und ist daher Teil des Hashs. */
    vatRateBp?: number | null;
    kind?: WorkItemKind | null;
  }[];
}

/** Normalisierter, hashbarer Inhalt der Annahme. */
export interface CanonicalIntakeContent {
  /** Format 2: Positionen enthalten Art und USt-Satz (Bruttobetrag). */
  v: 2;
  workOrderId: string;
  odometerKm: number | null;
  fuelLevel: string | null;
  customerComplaint: string;
  damages: { area: string; description: string; photoId: string | null }[];
  agreedServices: string;
  agreedItems: {
    kind: WorkItemKind | null;
    title: string;
    description: string | null;
    quantity: string;
    unit: string;
    unitPriceCents: number | null;
    vatRateBp: number | null;
  }[];
  costLimitCents: number | null;
  notesCustomer: string | null;
}

/** Normalisiert den bestätigungsrelevanten Inhalt der Annahme. */
export function canonicalIntakeContent(intake: IntakeHashInput): CanonicalIntakeContent {
  return {
    v: 2,
    workOrderId: normalizeId(intake.workOrderId),
    odometerKm: intake.odometerKm,
    fuelLevel: normalizeOptionalText(intake.fuelLevel),
    customerComplaint: normalizeText(intake.customerComplaint),
    damages: (intake.damages ?? []).map((d) => ({
      area: normalizeText(d.area),
      description: normalizeText(d.description),
      photoId: d.photoId === null ? null : normalizeId(d.photoId),
    })),
    agreedServices: normalizeText(intake.agreedServices),
    agreedItems: (intake.items ?? [])
      .filter((i) => i.origin === 'intake')
      .map((i) => ({
        kind: i.kind ?? null,
        title: normalizeText(i.title),
        description: normalizeOptionalText(i.description),
        quantity: canonicalQuantity(i.quantity),
        unit: normalizeText(i.unit),
        unitPriceCents: i.unitPriceCents ?? null,
        vatRateBp: i.vatRateBp ?? null,
      })),
    costLimitCents: intake.costLimitCents ?? null,
    notesCustomer: normalizeOptionalText(intake.notesCustomer),
  };
}

/**
 * Inhalts-Hash der Annahme (SHA-256 hex über das kanonische JSON). Der Kunde bestätigt genau
 * diesen Stand (`ConfirmIntakeRequest.contentHash`); ändert sich der kundenbezogene Inhalt,
 * ändert sich der Hash und die Bestätigung passt nicht mehr.
 */
export function computeIntakeHash(intake: IntakeHashInput): string {
  return sha256Hex(canonicalJson(canonicalIntakeContent(intake)));
}
