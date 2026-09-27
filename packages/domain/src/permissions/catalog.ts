/**
 * Rechtekatalog, Standardrechte je Rolle und Rechte-Overrides.
 * Quelle: docs/rollen-und-rechte.md, Abschnitt 2 (✓ = Standard, ○ = zuweisbar, – = nie).
 */
import { PERMISSIONS, type Permission, type Role, type UserStatus } from '@werkstatt/contracts';
import { DomainError, type DomainIssue } from '../common/result';

/** Mitarbeiterrollen (Kunden haben keine einstellbaren Rechte). */
export type StaffRole = Exclude<Role, 'customer'>;

/** Eintrag der Rechtetabelle: Standard (✓), zuweisbar (○) oder nie zuweisbar (–). */
export type PermissionCell = 'default' | 'assignable' | 'never';

const D = 'default' as const;
const A = 'assignable' as const;
const N = 'never' as const;

/**
 * Rechtetabelle exakt nach docs/rollen-und-rechte.md, Abschnitt 2.
 * Reihenfolge wie `PERMISSIONS` in @werkstatt/contracts.
 */
export const PERMISSION_MATRIX: Readonly<Record<Permission, Readonly<Record<StaffRole, PermissionCell>>>> = {
  'dashboard.view': { admin: D, service: D, mechanic: D },
  'customers.read': { admin: D, service: D, mechanic: A },
  'customers.write': { admin: D, service: D, mechanic: N },
  'customerAccounts.manage': { admin: D, service: D, mechanic: N },
  'vehicles.read': { admin: D, service: D, mechanic: A },
  'vehicles.write': { admin: D, service: D, mechanic: N },
  'vehicles.transferOwnership': { admin: D, service: D, mechanic: N },
  'appointments.read': { admin: D, service: D, mechanic: A },
  'appointments.write': { admin: D, service: D, mechanic: N },
  'workOrders.read': { admin: D, service: D, mechanic: A },
  'workOrders.write': { admin: D, service: D, mechanic: N },
  'workOrders.completeReview': { admin: D, service: D, mechanic: A },
  'workItems.execute': { admin: D, service: A, mechanic: D },
  'intake.write': { admin: D, service: D, mechanic: A },
  'findings.write': { admin: D, service: D, mechanic: D },
  'approvals.request': { admin: D, service: D, mechanic: N },
  'documents.readInternal': { admin: D, service: D, mechanic: A },
  'documents.write': { admin: D, service: D, mechanic: N },
  'documents.publish': { admin: D, service: D, mechanic: N },
  'messages.customerChat': { admin: D, service: D, mechanic: A },
  'invoices.read': { admin: D, service: D, mechanic: N },
  'invoices.write': { admin: D, service: D, mechanic: N },
  'payments.recordManual': { admin: D, service: A, mechanic: N },
  'payments.refund': { admin: D, service: A, mechanic: N },
  'serviceHistory.read': { admin: D, service: D, mechanic: A },
  'serviceHistory.correct': { admin: D, service: A, mechanic: N },
  'reports.export': { admin: D, service: D, mechanic: N },
  'users.manage': { admin: D, service: N, mechanic: N },
  'settings.manage': { admin: D, service: N, mechanic: N },
  'audit.read': { admin: D, service: A, mechanic: N },
};

const STAFF_ROLE_LIST: readonly StaffRole[] = ['admin', 'service', 'mechanic'];

function collect(role: StaffRole, cell: PermissionCell): Permission[] {
  return PERMISSIONS.filter((p) => PERMISSION_MATRIX[p][role] === cell);
}

function buildByRole(cell: PermissionCell): Readonly<Record<StaffRole, readonly Permission[]>> {
  const out = {} as Record<StaffRole, readonly Permission[]>;
  for (const role of STAFF_ROLE_LIST) out[role] = Object.freeze(collect(role, cell));
  return Object.freeze(out);
}

/** Standardrechte (✓) je Mitarbeiterrolle. */
export const ROLE_DEFAULT_PERMISSIONS: Readonly<Record<StaffRole, readonly Permission[]>> = buildByRole('default');

/** Durch den Admin zusätzlich zuweisbare Rechte (○) je Mitarbeiterrolle. */
export const ASSIGNABLE_PERMISSIONS: Readonly<Record<StaffRole, readonly Permission[]>> = buildByRole('assignable');

/** Für die Rolle nie zuweisbare Rechte (–). */
export const NEVER_ASSIGNABLE_PERMISSIONS: Readonly<Record<StaffRole, readonly Permission[]>> = buildByRole('never');

/** true für admin, service, mechanic. */
export function isStaffRole(role: Role): role is StaffRole {
  return role !== 'customer';
}

/** true, wenn das Recht für die Rolle Standard oder zuweisbar ist (✓ oder ○). */
export function isPermissionAllowedForRole(role: Role, permission: Permission): boolean {
  if (!isStaffRole(role)) return false;
  const row = PERMISSION_MATRIX[permission];
  return row !== undefined && row[role] !== 'never';
}

/** Ein Override: Recht zusätzlich gewähren (`granted: true`) oder entziehen (`false`). */
export interface PermissionOverride {
  permission: Permission;
  granted: boolean;
}

export type PermissionIssueCode =
  | 'CUSTOMER_HAS_NO_PERMISSIONS'
  | 'UNKNOWN_PERMISSION'
  | 'DUPLICATE_OVERRIDE'
  | 'PERMISSION_NOT_ASSIGNABLE'
  | 'INVALID_ROLE'
  | 'NOT_STAFF'
  | 'LAST_ADMIN_ROLE_CHANGE'
  | 'LAST_ADMIN_USERS_MANAGE'
  | 'LAST_ADMIN_DISABLE';

/** Problem bei Rollen/Rechten, ggf. mit betroffenem Recht. */
export interface PermissionIssue extends DomainIssue<PermissionIssueCode> {
  permission?: string;
}

/**
 * Prüft Overrides gegen die Rolle. Leere Liste = in Ordnung.
 * - Kunden dürfen keine Overrides haben.
 * - Unbekannte Rechte und doppelte Einträge werden abgelehnt.
 * - Gewähren eines für die Rolle nie zuweisbaren Rechts (–) wird abgelehnt.
 * - Entziehen ist für jedes Recht erlaubt (bei nicht vorhandenen Rechten wirkungslos).
 */
export function checkOverrides(role: Role, overrides: readonly PermissionOverride[]): PermissionIssue[] {
  const issues: PermissionIssue[] = [];
  if (!isStaffRole(role)) {
    if (overrides.length > 0) {
      issues.push({ code: 'CUSTOMER_HAS_NO_PERMISSIONS', message: 'Kunden haben keine einstellbaren Rechte.' });
    }
    return issues;
  }
  const seen = new Set<string>();
  for (const o of overrides) {
    const known = (PERMISSIONS as readonly string[]).includes(o.permission);
    if (!known) {
      issues.push({ code: 'UNKNOWN_PERMISSION', message: `Unbekanntes Recht: ${String(o.permission)}`, permission: o.permission });
      continue;
    }
    if (seen.has(o.permission)) {
      issues.push({ code: 'DUPLICATE_OVERRIDE', message: `Recht mehrfach angegeben: ${o.permission}`, permission: o.permission });
      continue;
    }
    seen.add(o.permission);
    if (o.granted && PERMISSION_MATRIX[o.permission][role] === 'never') {
      issues.push({
        code: 'PERMISSION_NOT_ASSIGNABLE',
        message: `Das Recht ${o.permission} kann der Rolle ${role} nicht zugewiesen werden.`,
        permission: o.permission,
      });
    }
  }
  return issues;
}

/**
 * Wirksame Rechte: Standardrechte der Rolle + gewährte − entzogene Overrides.
 * Kunden haben keine Rechte (leere Menge).
 *
 * @throws DomainError, wenn die Overrides ungültig sind (z. B. ein für die Rolle nicht
 *   zuweisbares Recht gewährt wird). Gespeicherte Overrides sind vorher mit
 *   {@link validatePermissionChange} geprüft; ein Fehler hier ist ein Datenfehler.
 */
export function effectivePermissions(role: Role, overrides: readonly PermissionOverride[] = []): ReadonlySet<Permission> {
  const issues = checkOverrides(role, overrides);
  const first = issues[0];
  if (first) throw new DomainError(first.code, first.message);
  if (!isStaffRole(role)) return new Set<Permission>();
  const set = new Set<Permission>(ROLE_DEFAULT_PERMISSIONS[role]);
  for (const o of overrides) {
    if (o.granted) set.add(o.permission);
    else set.delete(o.permission);
  }
  return set;
}

/** Rechte als Liste in Katalogreihenfolge (für DTOs wie `SessionUser.permissions`). */
export function permissionsToList(permissions: ReadonlySet<Permission>): Permission[] {
  return PERMISSIONS.filter((p) => permissions.has(p));
}

/** Entfernt Overrides, die für die Rolle ungültig wären (z. B. vor einem Rollenwechsel). */
export function pruneOverridesForRole(role: Role, overrides: readonly PermissionOverride[]): PermissionOverride[] {
  if (!isStaffRole(role)) return [];
  const seen = new Set<string>();
  return overrides.filter((o) => {
    if (!(PERMISSIONS as readonly string[]).includes(o.permission) || seen.has(o.permission)) return false;
    seen.add(o.permission);
    return !(o.granted && PERMISSION_MATRIX[o.permission][role] === 'never');
  });
}

/** Benutzerkonto, dessen Rolle/Rechte geändert oder das deaktiviert werden soll. */
export interface PermissionTargetUser {
  id: string;
  role: Role;
  status: UserStatus;
  overrides: readonly PermissionOverride[];
}

function holdsUserManagement(role: Role, status: UserStatus, overrides: readonly PermissionOverride[]): boolean {
  if (role !== 'admin' || status !== 'active') return false;
  try {
    return effectivePermissions(role, overrides).has('users.manage');
  } catch {
    return false;
  }
}

export interface PermissionChangeInput {
  targetUser: PermissionTargetUser;
  /** Neue Rolle (nur Mitarbeiterrollen). Fehlt: Rolle bleibt. */
  newRole?: Role;
  /** Neue vollständige Override-Liste. Fehlt: bisherige Overrides bleiben (und werden gegen die neue Rolle geprüft). */
  newOverrides?: readonly PermissionOverride[];
  /**
   * Anzahl aktiver Admins, die derzeit `users.manage` wirksam besitzen, einschließlich des
   * Zielkontos (falls es dazugehört). Ist das Zielkonto der einzige, ist es "der letzte
   * aktive Admin".
   */
  activeAdminCount: number;
}

export type PermissionChangeResult =
  | { ok: true; role: StaffRole; overrides: PermissionOverride[]; permissions: ReadonlySet<Permission> }
  | { ok: false; issues: PermissionIssue[] };

/**
 * Prüft eine Rollen-/Rechteänderung an einem Mitarbeiterkonto.
 * - Nur Mitarbeiterkonten; Zielrolle nie `customer`.
 * - Overrides müssen zur (neuen) Rolle passen.
 * - Der letzte aktive Admin darf weder die Rolle wechseln noch `users.manage` verlieren.
 */
export function validatePermissionChange(input: PermissionChangeInput): PermissionChangeResult {
  const { targetUser, activeAdminCount } = input;
  if (!isStaffRole(targetUser.role)) {
    return { ok: false, issues: [{ code: 'NOT_STAFF', message: 'Kundenkonten haben keine Rollen- oder Rechteeinstellungen.' }] };
  }
  const role = input.newRole ?? targetUser.role;
  if (!isStaffRole(role)) {
    return { ok: false, issues: [{ code: 'INVALID_ROLE', message: 'Ein Mitarbeiterkonto kann nicht zur Rolle Kunde wechseln.' }] };
  }
  const overrides = [...(input.newOverrides ?? targetUser.overrides)];
  const issues: PermissionIssue[] = checkOverrides(role, overrides);

  const isLastAdmin = holdsUserManagement(targetUser.role, targetUser.status, targetUser.overrides) && activeAdminCount <= 1;
  if (isLastAdmin) {
    if (role !== 'admin') {
      issues.push({ code: 'LAST_ADMIN_ROLE_CHANGE', message: 'Der letzte aktive Admin kann seine Rolle nicht wechseln.' });
    } else if (issues.length === 0 && !effectivePermissions(role, overrides).has('users.manage')) {
      issues.push({
        code: 'LAST_ADMIN_USERS_MANAGE',
        message: 'Dem letzten aktiven Admin kann das Recht users.manage nicht entzogen werden.',
        permission: 'users.manage',
      });
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, role, overrides, permissions: effectivePermissions(role, overrides) };
}

/**
 * Darf das Konto deaktiviert werden? Der letzte aktive Admin (mit `users.manage`) nicht.
 * `activeAdminCount` wie bei {@link validatePermissionChange}.
 */
export function canDisableUser(input: { targetUser: PermissionTargetUser; activeAdminCount: number }): { ok: true } | { ok: false; issue: PermissionIssue } {
  const { targetUser, activeAdminCount } = input;
  if (holdsUserManagement(targetUser.role, targetUser.status, targetUser.overrides) && activeAdminCount <= 1) {
    return { ok: false, issue: { code: 'LAST_ADMIN_DISABLE', message: 'Der letzte aktive Admin kann nicht deaktiviert werden.' } };
  }
  return { ok: true };
}
