/**
 * Kleine Anzeigehelfer der Kundensicht.
 */
import { appointmentKindLabels, appointmentStatusLabels, type Appointment, type MaintenanceDue, type StatusLabel } from '@werkstatt/contracts';
import { keepPlates, formatDate, formatKm, formatTimeRange } from '../../lib/format';

export const dueStateLabels: Record<MaintenanceDue['state'], StatusLabel> = {
  overdue: { label: 'Überfällig', tone: 'danger', icon: 'WarningCircle' },
  due_soon: { label: 'Bald fällig', tone: 'warning', icon: 'Clock' },
  ok: { label: 'In Ordnung', tone: 'success', icon: 'CheckCircle' },
  unknown: { label: 'Unbekannt', tone: 'neutral', icon: 'Minus' },
};

export const estimateLabel: StatusLabel = { label: 'km geschätzt', tone: 'info', icon: 'Gauge' };

export function dueSummary(d: MaintenanceDue): string {
  const parts: string[] = [];
  if (d.dueDate) parts.push(`am ${formatDate(d.dueDate)}`);
  if (d.dueKm !== null) parts.push(`bei ${formatKm(d.dueKm)}`);
  if (parts.length === 0) return 'Fälligkeit unbekannt';
  return `Fällig ${parts.join(' oder ')}`;
}

export function appointmentTitle(a: Appointment): string {
  return `${appointmentKindLabels[a.kind]}, ${keepPlates(a.vehicleLabel)}`;
}

export function appointmentWhen(a: Appointment): string {
  const open = a.proposals.find((p) => p.status === 'open');
  if (a.status === 'proposed' && open) return `Vorschlag: ${formatTimeRange(open.startsAt, open.endsAt)}`;
  if (a.status === 'requested') return `Wunsch: ${formatTimeRange(a.startsAt, a.endsAt)}`;
  return formatTimeRange(a.startsAt, a.endsAt);
}

export { appointmentStatusLabels };

export function salutationName(c: { salutation: string | null; lastName: string | null; companyName: string | null; kind: string } | undefined): string {
  if (!c) return '';
  if (c.kind === 'business' && c.companyName) return c.companyName;
  if (c.salutation && c.lastName) return `${c.salutation} ${c.lastName}`;
  return c.lastName ?? '';
}
