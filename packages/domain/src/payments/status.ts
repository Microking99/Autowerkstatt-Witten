/**
 * Zahlungsstatus einer Rechnung, berechnet aus bestätigten Zahlungen und Erstattungen
 * (docs/datenmodell.md, Abschnitt 5 und 8). Der Zahlungsstatus wird nie gespeichert.
 *
 * Festlegungen:
 * - Gezählt werden nur bestätigte Zahlungen (Tabelle `payments` enthält nur solche) und nur
 *   Erstattungen im Status `succeeded`.
 * - Erstattungen eröffnen keine neue Forderung: `openCents = max(0, Rechnungsbetrag −
 *   Zahlungen)`. Eine erstattete Rechnung ist damit nicht wieder "offen".
 * - Überzahlung = Zahlungen − Erstattungen − Rechnungsbetrag (> 0). Bei stornierten
 *   Rechnungen gilt jeder nicht erstattete Betrag als Überzahlung.
 * - Überfällig: gestellt, offener Betrag > 0 und `today` nach dem Fälligkeitsdatum.
 */
import type { InvoiceStatus, PaymentStatus, RefundStatus } from '@werkstatt/contracts';
import { compareIsoDates, type IsoDate } from '../common/dates';

/** Minimale Rechnungsdaten. */
export interface InvoicePaymentInput {
  status: InvoiceStatus;
  totalGrossCents: number;
  /** Fälligkeitsdatum `YYYY-MM-DD` oder `null`. */
  dueDate: IsoDate | null;
}

/** Bestätigte Zahlung. */
export interface PaymentAmountInput {
  amountCents: number;
}

/** Erstattung. Nur `succeeded` zählt als erstattet. */
export interface RefundAmountInput {
  amountCents: number;
  status: RefundStatus;
}

export interface InvoicePaymentStatus {
  /** Für Entwürfe `no_invoice` (Kunden sehen Entwürfe nicht). */
  status: PaymentStatus;
  paidCents: number;
  refundedCents: number;
  openCents: number;
  overdue: boolean;
  /** Überzahlter Betrag (> 0 = Überzahlung, muss geklärt oder erstattet werden). */
  overpaidCents: number;
  overpaid: boolean;
  /** `false` für Entwürfe: kein Kundenstatus. */
  customerVisible: boolean;
}

/** Zahlungsstatus aus Beträgen (für gestellte Rechnungen). */
export function derivePaymentStatus(totalGrossCents: number, paidCents: number, refundedCents: number): PaymentStatus {
  if (refundedCents > 0) {
    const netPaid = paidCents - refundedCents;
    if (netPaid <= 0) return 'refunded';
    if (netPaid >= totalGrossCents) return 'paid';
    return 'partially_refunded';
  }
  if (paidCents <= 0) return 'open';
  if (paidCents < totalGrossCents) return 'partially_paid';
  return 'paid';
}

/**
 * Berechnet den Zahlungsstatus einer Rechnung.
 * - Entwurf: `no_invoice`, `customerVisible: false`.
 * - Storniert: `cancelled` (nie überfällig); bereits gezahltes Geld wird als Überzahlung gemeldet.
 * - Gestellt: `open` | `partially_paid` | `paid` | `partially_refunded` | `refunded`.
 *
 * @param input.today Heutiges Datum in Berlin (`YYYY-MM-DD`), z. B. `berlinDateOf(now)`.
 */
export function computeInvoicePaymentStatus(input: {
  invoice: InvoicePaymentInput;
  payments: readonly PaymentAmountInput[];
  refunds: readonly RefundAmountInput[];
  today: IsoDate;
}): InvoicePaymentStatus {
  const { invoice, today } = input;
  const paidCents = input.payments.reduce((sum, p) => sum + p.amountCents, 0);
  const refundedCents = input.refunds.filter((r) => r.status === 'succeeded').reduce((sum, r) => sum + r.amountCents, 0);
  const netPaid = paidCents - refundedCents;

  if (invoice.status === 'draft') {
    return { status: 'no_invoice', paidCents, refundedCents, openCents: 0, overdue: false, overpaidCents: 0, overpaid: false, customerVisible: false };
  }
  if (invoice.status === 'cancelled') {
    const overpaidCents = Math.max(0, netPaid);
    return { status: 'cancelled', paidCents, refundedCents, openCents: 0, overdue: false, overpaidCents, overpaid: overpaidCents > 0, customerVisible: true };
  }
  const openCents = Math.max(0, invoice.totalGrossCents - paidCents);
  const overpaidCents = Math.max(0, netPaid - invoice.totalGrossCents);
  const overdue = openCents > 0 && invoice.dueDate !== null && compareIsoDates(today, invoice.dueDate) > 0;
  return {
    status: derivePaymentStatus(invoice.totalGrossCents, paidCents, refundedCents),
    paidCents,
    refundedCents,
    openCents,
    overdue,
    overpaidCents,
    overpaid: overpaidCents > 0,
    customerVisible: true,
  };
}

/** Rechnung mit ihren Zahlungen und Erstattungen (für die Zusammenfassung je Auftrag). */
export interface InvoiceWithPayments {
  invoice: InvoicePaymentInput;
  payments: readonly PaymentAmountInput[];
  refunds: readonly RefundAmountInput[];
}

/**
 * Zahlungsstatus eines Auftrags über alle Rechnungen:
 * - keine gestellte oder stornierte Rechnung (nur Entwürfe oder keine) → `no_invoice`
 * - nur stornierte → `cancelled`
 * - sonst Status aus den Summen der gestellten Rechnungen; überfällig, wenn eine davon
 *   überfällig ist.
 */
export function aggregatePaymentStatus(invoices: readonly InvoiceWithPayments[], today: IsoDate): { status: PaymentStatus; overdue: boolean } {
  const visible = invoices.filter((i) => i.invoice.status !== 'draft');
  if (visible.length === 0) return { status: 'no_invoice', overdue: false };
  const issued = visible.filter((i) => i.invoice.status === 'issued');
  if (issued.length === 0) return { status: 'cancelled', overdue: false };
  let total = 0;
  let paid = 0;
  let refunded = 0;
  let overdue = false;
  for (const entry of issued) {
    const s = computeInvoicePaymentStatus({ ...entry, today });
    total += entry.invoice.totalGrossCents;
    paid += s.paidCents;
    refunded += s.refundedCents;
    overdue = overdue || s.overdue;
  }
  return { status: derivePaymentStatus(total, paid, refunded), overdue };
}
