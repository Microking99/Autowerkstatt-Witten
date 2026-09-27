/**
 * Rollenstandards und wirksame Rechte im Demo-Modus: vollständig aus @werkstatt/domain
 * (Rechtekatalog nach docs/rollen-und-rechte.md, Abschnitt 2).
 */
import type { Permission, Role } from '@werkstatt/contracts';
import {
  ASSIGNABLE_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  canDisableUser,
  effectivePermissions as domainEffectivePermissions,
  isPermissionAllowedForRole,
  isStaffRole,
  permissionsToList,
  validatePermissionChange,
} from '@werkstatt/domain';

export { canDisableUser, validatePermissionChange };

export function defaultPermissions(role: Role): Permission[] {
  return isStaffRole(role) ? [...ROLE_DEFAULT_PERMISSIONS[role]] : [];
}

/** Standard (✓) oder durch den Admin zuweisbar (○). */
export function isAssignable(role: Role, permission: Permission): boolean {
  return isPermissionAllowedForRole(role, permission);
}

export function assignablePermissions(role: Role): Permission[] {
  return isStaffRole(role) ? [...ASSIGNABLE_PERMISSIONS[role]] : [];
}

/** Wirksame Rechte als Liste (Standard + gewährte − entzogene Overrides). */
export function effectivePermissions(role: Role, overrides: readonly { permission: Permission; granted: boolean }[]): Permission[] {
  return permissionsToList(domainEffectivePermissions(role, overrides));
}

export function hasPermission(actor: { role: Role; permissionOverrides: readonly { permission: Permission; granted: boolean }[] }, permission: Permission): boolean {
  return effectivePermissions(actor.role, actor.permissionOverrides).includes(permission);
}
