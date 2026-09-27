import { computeIntakeHash } from '@werkstatt/domain';
import type { intakes, workItems } from '../db/schema/index';

type IntakeRow = typeof intakes.$inferSelect;
type WorkItemRow = typeof workItems.$inferSelect;

/** Inhalts-Hash der Annahme (kundenbezogener Inhalt + bei Annahme vereinbarte Positionen). */
export function intakeContentHash(row: IntakeRow, items: readonly WorkItemRow[]): string {
  return computeIntakeHash({
    workOrderId: row.workOrderId,
    odometerKm: row.odometerKm,
    fuelLevel: row.fuelLevel,
    customerComplaint: row.customerComplaint,
    damages: row.damages,
    agreedServices: row.agreedServices,
    costLimitCents: row.costLimitCents,
    notesCustomer: row.notesCustomer,
    items: items.map((i) => ({
      origin: i.origin,
      title: i.title,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      unitPriceCents: i.unitPriceCents,
      vatRateBp: i.vatRateBp,
      kind: i.kind,
    })),
  });
}
