/**
 * Kanonischer Inhalt einer Freigabeversion und ihr Inhalts-Hash (SHA-256).
 *
 * Der Hash bindet die Kundenentscheidung an genau den gezeigten Inhalt (R-FRG-3, R-FRG-4).
 * In den Hash gehen ein: Kundentext, Positionen (Titel, Beschreibung, Menge, Einheit,
 * Einzelpreis, USt-Satz, Wartungsart, Zeilennetto), Summen, Währung, Terminänderung, neuer
 * Fertigstellungstermin, Fotos und Dokumentversion. Ändert sich einer davon, ändert sich der
 * Hash.
 *
 * Normalisierung (damit gleicher Inhalt immer denselben Hash ergibt):
 * - Texte: Zeilenenden `\n`, Unicode NFC, Leerraum am Rand entfernt; leere optionale Texte → null.
 * - Mengen als kanonische Dezimalzeichenkette ("1.5"), Beträge als ganze Cent.
 * - IDs klein geschrieben; Foto-IDs sortiert und ohne Dubletten (Reihenfolge ohne Bedeutung).
 * - Positionen in der vorgelegten Reihenfolge (Reihenfolge ist Teil der Darstellung).
 * - Zeitpunkte als ISO 8601 in UTC.
 * - Schlüsselreihenfolge durch kanonisches JSON (sortiert), Formatversion `v`.
 */
import { DomainError } from '../common/result';
import { toIsoDateTime } from '../common/dates';
import { canonicalJson, normalizeId, normalizeOptionalText, normalizeText, sha256Hex } from '../common/hash';
import { canonicalQuantity } from '../common/money';
import { calculateTotals, type VatBreakdownEntry } from './totals';

/** Eine Position der Freigabe (entspricht `ApprovalLine` aus @werkstatt/contracts). */
export interface ApprovalLineInput {
  title: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  vatRateBp: number;
  maintenanceTypeId: string | null;
}

/** Inhalt einer Freigabeversion, wie ihn die Werkstatt erstellt. */
export interface ApprovalContentInput {
  summaryCustomer: string;
  lines: readonly ApprovalLineInput[];
  scheduleChange?: string | null;
  /** Neuer Fertigstellungstermin (ISO 8601 oder Date). */
  newReadyAt?: string | Date | null;
  photoIds?: readonly string[];
  documentVersionId?: string | null;
}

/** Normalisierte Position. */
export interface CanonicalApprovalLine {
  title: string;
  description: string | null;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  vatRateBp: number;
  maintenanceTypeId: string | null;
  lineNetCents: number;
}

/** Normalisierter, hashbarer Inhalt einer Freigabeversion. */
export interface CanonicalApprovalContent {
  v: 1;
  summaryCustomer: string;
  lines: CanonicalApprovalLine[];
  totalNetCents: number;
  totalVatCents: number;
  totalGrossCents: number;
  vatBreakdown: VatBreakdownEntry[];
  currency: 'EUR';
  scheduleChange: string | null;
  newReadyAt: string | null;
  photoIds: string[];
  documentVersionId: string | null;
}

function invalid(message: string): never {
  throw new DomainError('INVALID_APPROVAL_CONTENT', message);
}

/**
 * Normalisiert den Inhalt einer Freigabeversion und berechnet die Summen.
 * @throws DomainError bei ungültigem Inhalt (keine Positionen, leerer Titel, Menge ≤ 0,
 *   nicht ganzzahliger Preis, ungültiger Steuersatz).
 */
export function canonicalApprovalContent(input: ApprovalContentInput): CanonicalApprovalContent {
  const summaryCustomer = normalizeText(input.summaryCustomer);
  if (summaryCustomer.length === 0) invalid('Die Beschreibung für den Kunden fehlt.');
  if (input.lines.length === 0) invalid('Mindestens eine Position ist nötig.');
  for (const line of input.lines) {
    if (normalizeText(line.title).length === 0) invalid('Jede Position braucht einen Titel.');
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) invalid('Menge muss größer als 0 sein.');
    if (!Number.isInteger(line.unitPriceCents)) invalid('Einzelpreis muss ganzzahlig in Cent sein.');
  }
  const totals = calculateTotals(input.lines);
  const lines: CanonicalApprovalLine[] = input.lines.map((line, index) => ({
    title: normalizeText(line.title),
    description: normalizeOptionalText(line.description),
    quantity: canonicalQuantity(line.quantity),
    unit: normalizeText(line.unit),
    unitPriceCents: line.unitPriceCents,
    vatRateBp: line.vatRateBp,
    maintenanceTypeId: line.maintenanceTypeId === null ? null : normalizeId(line.maintenanceTypeId),
    lineNetCents: totals.lineNetCents[index] ?? 0,
  }));
  const photoIds = [...new Set((input.photoIds ?? []).map(normalizeId))].sort();
  return {
    v: 1,
    summaryCustomer,
    lines,
    totalNetCents: totals.totalNetCents,
    totalVatCents: totals.totalVatCents,
    totalGrossCents: totals.totalGrossCents,
    vatBreakdown: totals.vatBreakdown,
    currency: 'EUR',
    scheduleChange: normalizeOptionalText(input.scheduleChange),
    newReadyAt: input.newReadyAt === null || input.newReadyAt === undefined ? null : toIsoDateTime(input.newReadyAt),
    photoIds,
    documentVersionId: input.documentVersionId ? normalizeId(input.documentVersionId) : null,
  };
}

/** SHA-256 (hex, 64 Zeichen) über das kanonische JSON des Inhalts. */
export function computeContentHash(content: CanonicalApprovalContent): string {
  return sha256Hex(canonicalJson(content));
}

/** Kurzform: normalisieren und hashen. */
export function hashApprovalContent(input: ApprovalContentInput): string {
  return computeContentHash(canonicalApprovalContent(input));
}
