import type { OdometerSource, Role } from '@werkstatt/contracts';

export const odometerSourceLabel: Record<OdometerSource, string> = {
  intake: 'bei Annahme',
  work_completion: 'beim Arbeitsabschluss',
  customer: 'von Ihnen angegeben',
  staff: 'von der Werkstatt erfasst',
};

export const authorRoleLabel: Partial<Record<Role, string>> = {
  admin: 'Werkstatt',
  service: 'Werkstatt',
  mechanic: 'Werkstatt',
};
