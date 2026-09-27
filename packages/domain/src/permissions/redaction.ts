/**
 * Feldfilter je Rolle. Sie ersetzen keine Objektprüfung: Vorher muss die passende
 * `can…`-Funktion `allowed: true` geliefert haben. Die Funktionen verändern ihre Eingabe
 * nicht, sondern liefern neue Objekte, in denen verbotene Felder fehlen (nicht nur leer sind).
 */
import type { ApprovalRequest, Intake, Invoice, ServiceEntry, WorkItem, WorkOrderDetail } from '@werkstatt/contracts';
import type { Actor } from './actor';

function omit<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...value } as Record<PropertyKey, unknown>;
  for (const k of keys) delete copy[k];
  return copy as Omit<T, K>;
}

/**
 * Position für die Rolle filtern (auch einzeln, z. B. als Antwort auf Start oder Teil erfassen).
 * - Mechaniker: kein Positionspreis und keine Teilepreise (`unitPriceCents`).
 * - Kunde: keine laufende Zeiterfassung (`runningSince`), keine erfasste Arbeitszeit
 *   (`trackedMinutes`) und keine verbauten Teile (`parts`).
 * - Admin/Service: unverändert.
 */
export function redactWorkItemForActor(item: WorkItem, actor: Pick<Actor, 'role'>): WorkItem {
  if (actor.role === 'mechanic') {
    const rest = omit(item, ['unitPriceCents']);
    return item.parts ? { ...rest, parts: item.parts.map((p) => omit(p, ['unitPriceCents'])) } : rest;
  }
  // Arbeitszeiten einzelner Mitarbeiter sind interne Angaben; Kunden sehen Leistung und Preis
  if (actor.role === 'customer') return omit(item, ['runningSince', 'parts', 'trackedMinutes']);
  return item.parts ? { ...item, parts: item.parts.map((p) => ({ ...p })) } : { ...item };
}

/**
 * Auftrag für die Rolle filtern.
 * - Mechaniker: keine Preise (`unitPriceCents` je Position und je Teil), keine Kostenrahmen
 *   (`costLimitCents` am Auftrag und in der Annahme). Interne Hinweise bleiben sichtbar.
 * - Kunde: keine internen Notizen (`notesInternal`), keine internen Annahmehinweise
 *   (`intake.notesInternal`), keine Zeiterfassung und keine verbauten Teile je Position.
 * - Admin/Service: unverändert.
 */
export function redactWorkOrderForActor(detail: WorkOrderDetail, actor: Pick<Actor, 'role'>): WorkOrderDetail {
  const items: WorkItem[] = detail.items.map((item) => redactWorkItemForActor(item, actor));
  if (actor.role === 'mechanic') {
    const intake: Intake | null = detail.intake ? omit(detail.intake, ['costLimitCents']) : null;
    return { ...omit(detail, ['costLimitCents']), items, intake };
  }
  if (actor.role === 'customer') {
    const intake: Intake | null = detail.intake ? omit(detail.intake, ['notesInternal']) : null;
    return { ...omit(detail, ['notesInternal']), items, intake };
  }
  return { ...detail, items, intake: detail.intake ? { ...detail.intake } : null };
}

/**
 * Serviceeintrag für die Rolle filtern. Kunden sehen den Auftragsbezug nur, wenn der Auftrag
 * ihnen selbst gehört; bei Einträgen aus Aufträgen eines anderen (z. B. früheren) Halters
 * wird `workOrderId` auf `null` gesetzt. Mitarbeiter: unverändert.
 *
 * @param context.workOrderCustomerId Auftraggeber des Ursprungsauftrags (`null`, wenn der
 *   Eintrag keinen Auftrag hat).
 */
export function serviceEntryForActor(
  entry: ServiceEntry,
  context: { workOrderCustomerId: string | null },
  actor: Pick<Actor, 'role' | 'customerId'>,
): ServiceEntry {
  if (actor.role !== 'customer') return { ...entry };
  const own = entry.workOrderId !== null && actor.customerId !== null && context.workOrderCustomerId === actor.customerId;
  return { ...entry, workOrderId: own ? entry.workOrderId : null };
}

/**
 * Rechnung für die Rolle filtern. Kunden sehen keine Zahlungsversuche (`checkouts`) und keine
 * Erstattungsvorgänge (`refunds`); die erstatteten Beträge stehen an den Zahlungen.
 */
export function redactInvoiceForActor(invoice: Invoice, actor: Pick<Actor, 'role'>): Invoice {
  if (actor.role === 'customer') return omit(invoice, ['checkouts', 'refunds']);
  return { ...invoice };
}

/**
 * Freigabeanfrage für die Rolle filtern. Kunden sehen nur gesendete Versionen
 * (`sentAt` gesetzt); Mitarbeiter alle.
 */
export function redactApprovalRequestForActor(request: ApprovalRequest, actor: Pick<Actor, 'role'>): ApprovalRequest {
  if (actor.role === 'customer') return { ...request, versions: request.versions.filter((v) => v.sentAt !== null) };
  return { ...request, versions: [...request.versions] };
}
