import type { ApprovalLine, WorkItem } from '@werkstatt/contracts';

/** Bruttobetrag einer Zeile (Cent), Rundung je Zeile wie in der Freigabeversion. */
export function lineGross(line: Pick<WorkItem, 'quantity'> & { unitPriceCents?: number | null; vatRateBp?: number }): number {
  const net = Math.round(line.quantity * (line.unitPriceCents ?? 0));
  return net + Math.round((net * (line.vatRateBp ?? 1900)) / 10_000);
}

export function lineNet(line: Pick<ApprovalLine, 'quantity' | 'unitPriceCents'>): number {
  return Math.round(line.quantity * line.unitPriceCents);
}
