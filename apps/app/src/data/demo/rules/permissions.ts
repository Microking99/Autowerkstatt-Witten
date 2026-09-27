/**
 * Rollenstandards und effektive Rechte (docs/rollen-und-rechte.md, Abschnitt 2).
 * Platzhalter für @werkstatt/domain/permissions; wird dort verbindlich umgesetzt.
 */
import type { Permission, Role } from '@werkstatt/contracts';

type StaffRole = Exclude<Role, 'customer'>;

/** ✓ = Standard */
const DEFAULTS: Record<StaffRole, Permission[]> = {
  admin: [
    'dashboard.view',
    'customers.read',
    'customers.write',
    'customerAccounts.manage',
    'vehicles.read',
    'vehicles.write',
    'vehicles.transferOwnership',
    'appointments.read',
    'appointments.write',
    'workOrders.read',
    'workOrders.write',
    'workOrders.completeReview',
    'workItems.execute',
    'intake.write',
    'findings.write',
    'approvals.request',
    'documents.readInternal',
    'documents.write',
    'documents.publish',
    'messages.customerChat',
    'invoices.read',
    'invoices.write',
    'payments.recordManual',
    'payments.refund',
    'serviceHistory.read',
    'serviceHistory.correct',
    'reports.export',
    'users.manage',
    'settings.manage',
    'audit.read',
  ],
  service: [
    'dashboard.view',
    'customers.read',
    'customers.write',
    'customerAccounts.manage',
    'vehicles.read',
    'vehicles.write',
    'vehicles.transferOwnership',
    'appointments.read',
    'appointments.write',
    'workOrders.read',
    'workOrders.write',
    'workOrders.completeReview',
    'intake.write',
    'findings.write',
    'approvals.request',
    'documents.readInternal',
    'documents.write',
    'documents.publish',
    'messages.customerChat',
    'invoices.read',
    'invoices.write',
    'serviceHistory.read',
    'reports.export',
  ],
  mechanic: ['dashboard.view', 'workItems.execute', 'findings.write'],
};

/** ○ = durch Admin zuweisbar */
const ASSIGNABLE: Record<StaffRole, Permission[]> = {
  admin: [],
  service: ['workItems.execute', 'payments.recordManual', 'payments.refund', 'serviceHistory.correct', 'audit.read'],
  mechanic: [
    'customers.read',
    'vehicles.read',
    'appointments.read',
    'workOrders.read',
    'workOrders.completeReview',
    'intake.write',
    'documents.readInternal',
    'messages.customerChat',
    'serviceHistory.read',
  ],
};

export function defaultPermissions(role: Role): Permission[] {
  return role === 'customer' ? [] : [...DEFAULTS[role]];
}

export function isAssignable(role: Role, permission: Permission): boolean {
  if (role === 'customer') return false;
  return DEFAULTS[role].includes(permission) || ASSIGNABLE[role].includes(permission);
}

export function effectivePermissions(
  role: Role,
  overrides: readonly { permission: Permission; granted: boolean }[],
): Permission[] {
  if (role === 'customer') return [];
  const set = new Set(defaultPermissions(role));
  for (const o of overrides) {
    if (!isAssignable(role, o.permission)) continue;
    if (o.granted) set.add(o.permission);
    else set.delete(o.permission);
  }
  return [...set];
}

export function hasPermission(
  actor: { role: Role; permissionOverrides: readonly { permission: Permission; granted: boolean }[] },
  permission: Permission,
): boolean {
  return effectivePermissions(actor.role, actor.permissionOverrides).includes(permission);
}
