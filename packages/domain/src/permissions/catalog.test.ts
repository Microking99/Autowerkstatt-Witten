import { PERMISSIONS, type Permission } from '@werkstatt/contracts';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../common/result';
import { grant, revoke, IDS } from '../testing/fixtures';
import { createActor } from './actor';
import {
  ASSIGNABLE_PERMISSIONS,
  NEVER_ASSIGNABLE_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  canDisableUser,
  checkOverrides,
  effectivePermissions,
  isPermissionAllowedForRole,
  permissionsToList,
  pruneOverridesForRole,
  validatePermissionChange,
  type PermissionTargetUser,
} from './catalog';

// Erwartungswerte direkt aus der Tabelle in docs/rollen-und-rechte.md, Abschnitt 2 abgeschrieben.
const SERVICE_ASSIGNABLE: Permission[] = ['workItems.execute', 'payments.recordManual', 'payments.refund', 'serviceHistory.correct', 'audit.read'];
const SERVICE_NEVER: Permission[] = ['users.manage', 'settings.manage'];
const MECHANIC_DEFAULT: Permission[] = ['dashboard.view', 'workItems.execute', 'findings.write'];
const MECHANIC_ASSIGNABLE: Permission[] = [
  'customers.read',
  'vehicles.read',
  'appointments.read',
  'workOrders.read',
  'workOrders.completeReview',
  'intake.write',
  'documents.readInternal',
  'messages.customerChat',
  'serviceHistory.read',
];

const sorted = (list: readonly Permission[]): Permission[] => [...list].sort();

describe('Rechtetabelle nach docs/rollen-und-rechte.md', () => {
  it('Admin hat alle Rechte als Standard', () => {
    expect(sorted(ROLE_DEFAULT_PERMISSIONS.admin)).toEqual(sorted(PERMISSIONS));
    expect(ASSIGNABLE_PERMISSIONS.admin).toEqual([]);
    expect(NEVER_ASSIGNABLE_PERMISSIONS.admin).toEqual([]);
  });

  it('Service: Standard, zuweisbar und nie zuweisbar wie in der Tabelle', () => {
    expect(sorted(ASSIGNABLE_PERMISSIONS.service)).toEqual(sorted(SERVICE_ASSIGNABLE));
    expect(sorted(NEVER_ASSIGNABLE_PERMISSIONS.service)).toEqual(sorted(SERVICE_NEVER));
    const expectedDefault = PERMISSIONS.filter((p) => !SERVICE_ASSIGNABLE.includes(p) && !SERVICE_NEVER.includes(p));
    expect(sorted(ROLE_DEFAULT_PERMISSIONS.service)).toEqual(sorted(expectedDefault));
  });

  it('Mechaniker: Standard, zuweisbar und nie zuweisbar wie in der Tabelle', () => {
    expect(sorted(ROLE_DEFAULT_PERMISSIONS.mechanic)).toEqual(sorted(MECHANIC_DEFAULT));
    expect(sorted(ASSIGNABLE_PERMISSIONS.mechanic)).toEqual(sorted(MECHANIC_ASSIGNABLE));
    const expectedNever = PERMISSIONS.filter((p) => !MECHANIC_DEFAULT.includes(p) && !MECHANIC_ASSIGNABLE.includes(p));
    expect(sorted(NEVER_ASSIGNABLE_PERMISSIONS.mechanic)).toEqual(sorted(expectedNever));
    expect(NEVER_ASSIGNABLE_PERMISSIONS.mechanic).toContain('invoices.read');
    expect(NEVER_ASSIGNABLE_PERMISSIONS.mechanic).toContain('approvals.request');
  });

  it('kein Recht erlaubt es, im Namen des Kunden freizugeben', () => {
    expect(PERMISSIONS.some((p) => p.startsWith('approvals.') && p !== 'approvals.request')).toBe(false);
  });

  it('Kunden haben keine Rechte', () => {
    expect(effectivePermissions('customer', []).size).toBe(0);
    expect(isPermissionAllowedForRole('customer', 'dashboard.view')).toBe(false);
  });
});

describe('Wirksame Rechte mit Overrides', () => {
  it('Standard + gewährte − entzogene', () => {
    const perms = effectivePermissions('service', [grant('payments.refund'), revoke('reports.export')]);
    expect(perms.has('payments.refund')).toBe(true);
    expect(perms.has('reports.export')).toBe(false);
    expect(perms.has('invoices.read')).toBe(true);
  });

  it('Mechaniker erhält zuweisbares Recht (workOrders.read)', () => {
    expect(effectivePermissions('mechanic', [grant('workOrders.read')]).has('workOrders.read')).toBe(true);
    expect(effectivePermissions('mechanic', []).has('workOrders.read')).toBe(false);
  });

  it('lehnt nicht zuweisbare Rechte ab (Mechaniker invoices.read, Service users.manage)', () => {
    expect(() => effectivePermissions('mechanic', [grant('invoices.read')])).toThrow(DomainError);
    expect(() => effectivePermissions('service', [grant('users.manage')])).toThrow(/nicht zugewiesen/);
    expect(checkOverrides('mechanic', [grant('payments.refund')])[0]?.code).toBe('PERMISSION_NOT_ASSIGNABLE');
  });

  it('lehnt Overrides für Kunden, doppelte und unbekannte Rechte ab', () => {
    expect(checkOverrides('customer', [grant('dashboard.view')])[0]?.code).toBe('CUSTOMER_HAS_NO_PERMISSIONS');
    expect(checkOverrides('service', [grant('audit.read'), revoke('audit.read')])[0]?.code).toBe('DUPLICATE_OVERRIDE');
    expect(checkOverrides('service', [{ permission: 'foo.bar' as Permission, granted: true }])[0]?.code).toBe('UNKNOWN_PERMISSION');
  });

  it('entfernt vor einem Rollenwechsel ungültige Overrides', () => {
    expect(pruneOverridesForRole('mechanic', [grant('payments.refund'), grant('workOrders.read')])).toEqual([grant('workOrders.read')]);
  });

  it('liefert Rechte in Katalogreihenfolge', () => {
    expect(permissionsToList(effectivePermissions('mechanic', []))).toEqual(['dashboard.view', 'workItems.execute', 'findings.write']);
  });

  it('baut Actors: Kunde ohne Rechte, Mitarbeiter ohne Kundenbezug, inaktive Konten markiert', () => {
    const c = createActor({ userId: IDS.customerAUser, role: 'customer', status: 'active', customerId: IDS.customerA });
    expect(c.permissions.size).toBe(0);
    expect(c.customerId).toBe(IDS.customerA);
    const m = createActor({ userId: IDS.mechanicUser, role: 'mechanic', status: 'disabled', customerId: IDS.customerA });
    expect(m.customerId).toBeNull();
    expect(m.accountActive).toBe(false);
  });
});

describe('Schutz des letzten Admins', () => {
  const lastAdmin: PermissionTargetUser = { id: IDS.adminUser, role: 'admin', status: 'active', overrides: [] };

  it('der letzte aktive Admin kann die Rolle nicht wechseln', () => {
    const r = validatePermissionChange({ targetUser: lastAdmin, newRole: 'service', activeAdminCount: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code)).toContain('LAST_ADMIN_ROLE_CHANGE');
  });

  it('der letzte aktive Admin kann users.manage nicht verlieren', () => {
    const r = validatePermissionChange({ targetUser: lastAdmin, newOverrides: [revoke('users.manage')], activeAdminCount: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.code).toBe('LAST_ADMIN_USERS_MANAGE');
  });

  it('der letzte aktive Admin kann nicht deaktiviert werden', () => {
    const r = canDisableUser({ targetUser: lastAdmin, activeAdminCount: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.code).toBe('LAST_ADMIN_DISABLE');
  });

  it('mit einem zweiten aktiven Admin ist all das erlaubt', () => {
    expect(validatePermissionChange({ targetUser: lastAdmin, newRole: 'service', activeAdminCount: 2 }).ok).toBe(true);
    expect(validatePermissionChange({ targetUser: lastAdmin, newOverrides: [revoke('users.manage')], activeAdminCount: 2 }).ok).toBe(true);
    expect(canDisableUser({ targetUser: lastAdmin, activeAdminCount: 2 }).ok).toBe(true);
  });

  it('andere Rechte des letzten Admins dürfen geändert werden', () => {
    const r = validatePermissionChange({ targetUser: lastAdmin, newOverrides: [revoke('reports.export')], activeAdminCount: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.permissions.has('users.manage')).toBe(true);
  });

  it('Mitarbeiter können deaktiviert werden', () => {
    const svc: PermissionTargetUser = { id: IDS.serviceUser, role: 'service', status: 'active', overrides: [] };
    expect(canDisableUser({ targetUser: svc, activeAdminCount: 1 }).ok).toBe(true);
  });
});

describe('Rollen- und Rechteänderung', () => {
  const svc: PermissionTargetUser = { id: IDS.serviceUser, role: 'service', status: 'active', overrides: [grant('payments.refund')] };

  it('prüft bestehende Overrides gegen die neue Rolle', () => {
    const r = validatePermissionChange({ targetUser: svc, newRole: 'mechanic', activeAdminCount: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]).toMatchObject({ code: 'PERMISSION_NOT_ASSIGNABLE', permission: 'payments.refund' });
  });

  it('erlaubt gültige Änderungen und liefert die wirksamen Rechte', () => {
    const r = validatePermissionChange({ targetUser: svc, newOverrides: [grant('audit.read')], activeAdminCount: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.permissions.has('audit.read')).toBe(true);
      expect(r.permissions.has('payments.refund')).toBe(false);
    }
  });

  it('Mitarbeiter können nicht zur Rolle Kunde wechseln, Kundenkonten haben keine Rechte', () => {
    expect(validatePermissionChange({ targetUser: svc, newRole: 'customer', activeAdminCount: 1 }).ok).toBe(false);
    const customer: PermissionTargetUser = { id: IDS.customerAUser, role: 'customer', status: 'active', overrides: [] };
    const r = validatePermissionChange({ targetUser: customer, newOverrides: [grant('dashboard.view')], activeAdminCount: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.code).toBe('NOT_STAFF');
  });
});
