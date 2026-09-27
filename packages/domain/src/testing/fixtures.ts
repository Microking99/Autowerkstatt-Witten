/**
 * Gekennzeichnete Testdaten ([TEST]) für die Unit-Tests. Keine echten Personen- oder Kundendaten.
 * Nicht Teil der öffentlichen Schnittstelle (nicht in src/index.ts exportiert).
 */
import type { Permission, Role } from '@werkstatt/contracts';
import type { Actor } from '../permissions/actor';
import { createActor } from '../permissions/actor';
import type { PermissionOverride } from '../permissions/catalog';

/** Deterministische UUID (v4-Format) für Tests. */
export function tid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const IDS = {
  adminUser: tid(1),
  serviceUser: tid(2),
  mechanicUser: tid(3),
  otherMechanicUser: tid(4),
  customerAUser: tid(5),
  customerBUser: tid(6),
  customerA: tid(101),
  customerB: tid(102),
  customerC: tid(103),
  vehicle1: tid(201),
  vehicle2: tid(202),
  vehicle3: tid(203),
  workOrderA: tid(301),
  workOrderB: tid(302),
  maintenanceOil: tid(401),
  maintenanceInspection: tid(402),
} as const;

export function staffActor(role: Exclude<Role, 'customer'>, userId: string, overrides: PermissionOverride[] = []): Actor {
  return createActor({ userId, role, status: 'active', overrides });
}

export function customerActor(userId: string, customerId: string, status: 'active' | 'disabled' | 'invited' = 'active'): Actor {
  return createActor({ userId, role: 'customer', status, customerId });
}

export const admin = (): Actor => staffActor('admin', IDS.adminUser);
export const service = (overrides: PermissionOverride[] = []): Actor => staffActor('service', IDS.serviceUser, overrides);
export const mechanic = (overrides: PermissionOverride[] = []): Actor => staffActor('mechanic', IDS.mechanicUser, overrides);
export const customerA = (): Actor => customerActor(IDS.customerAUser, IDS.customerA);
export const customerB = (): Actor => customerActor(IDS.customerBUser, IDS.customerB);

export const grant = (permission: Permission): PermissionOverride => ({ permission, granted: true });
export const revoke = (permission: Permission): PermissionOverride => ({ permission, granted: false });
