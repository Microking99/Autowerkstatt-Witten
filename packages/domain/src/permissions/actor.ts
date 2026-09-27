/**
 * Handelnde Person (Actor) und Ergebnis einer Rechteprüfung (Decision).
 */
import type { Permission, Role, UserStatus } from '@werkstatt/contracts';
import { effectivePermissions, isStaffRole, type PermissionOverride } from './catalog';

/**
 * Angemeldete Person, für die geprüft wird.
 * - `permissions`: wirksame Rechte (Mitarbeiter); für Kunden leer.
 * - `customerId`: nur bei Kunden der verknüpfte Kundendatensatz, sonst `null`.
 * - `accountActive`: Konto im Status `active`. Inaktive Konten erhalten nie Zugriff.
 */
export interface Actor {
  userId: string;
  role: Role;
  permissions: ReadonlySet<Permission>;
  customerId: string | null;
  accountActive: boolean;
}

/** Gründe für eine verweigerte Prüfung. Deutsche Texte: {@link DENY_REASON_MESSAGES}. */
export type DenyReason =
  | 'ACCOUNT_INACTIVE'
  | 'NO_CUSTOMER_LINK'
  | 'MISSING_PERMISSION'
  | 'NOT_OWN_RECORD'
  | 'NOT_CURRENT_OWNER'
  | 'NOT_ASSIGNED'
  | 'INTERNAL_ONLY'
  | 'NOT_PUBLISHED'
  | 'DRAFT'
  | 'ROLE_NOT_ALLOWED'
  | 'NOT_CUSTOMER'
  | 'ITEM_NOT_AUTHORIZED'
  | 'WORK_ORDER_NOT_ACTIVE';

export const DENY_REASON_MESSAGES: Readonly<Record<DenyReason, string>> = {
  ACCOUNT_INACTIVE: 'Das Konto ist nicht aktiv.',
  NO_CUSTOMER_LINK: 'Das Kundenkonto ist mit keinem Kundendatensatz verknüpft.',
  MISSING_PERMISSION: 'Dafür fehlt die Berechtigung.',
  NOT_OWN_RECORD: 'Der Vorgang gehört nicht zu diesem Kunden.',
  NOT_CURRENT_OWNER: 'Nur der aktuelle Halter des Fahrzeugs hat Zugriff.',
  NOT_ASSIGNED: 'Nur zugewiesene Mitarbeiter haben Zugriff.',
  INTERNAL_ONLY: 'Interne Inhalte sind nur für Mitarbeiter sichtbar.',
  NOT_PUBLISHED: 'Das Dokument ist nicht für Kunden veröffentlicht.',
  DRAFT: 'Entwürfe sind für Kunden nicht sichtbar.',
  ROLE_NOT_ALLOWED: 'Für diese Rolle nicht erlaubt.',
  NOT_CUSTOMER: 'Nur der Kunde des Auftrags kann entscheiden.',
  ITEM_NOT_AUTHORIZED: 'Die Position ist nicht vereinbart oder freigegeben.',
  WORK_ORDER_NOT_ACTIVE: 'Im aktuellen Auftragsstatus können keine Arbeiten ausgeführt werden.',
};

/**
 * Ergebnis einer Rechteprüfung. `notFound` ist für Kunden immer `true`: Die API antwortet
 * dann mit 404 statt 403, damit die Existenz fremder Objekte nicht preisgegeben wird.
 * Für Mitarbeiter ist `notFound` `false` (403).
 */
export type Decision = { allowed: true } | { allowed: false; reason: DenyReason; notFound: boolean };

/** Erlaubt. */
export const ALLOW: Decision = Object.freeze({ allowed: true as const });

/** Verweigert mit Grund; `notFound` abhängig von der Rolle. */
export function deny(actor: Pick<Actor, 'role'>, reason: DenyReason): Decision {
  return { allowed: false, reason, notFound: actor.role === 'customer' };
}

/** Eingaben zum Aufbau eines Actors aus Konto, Rolle und Overrides. */
export interface CreateActorInput {
  userId: string;
  role: Role;
  status: UserStatus;
  /** Nur bei Kunden: verknüpfter Kundendatensatz (`customer_accounts.customer_id`). */
  customerId?: string | null;
  /** Nur bei Mitarbeitern. */
  overrides?: readonly PermissionOverride[];
}

/**
 * Baut einen Actor. Wirksame Rechte über {@link effectivePermissions}; Kunden erhalten
 * keine Rechte, Mitarbeiter keinen Kundenbezug.
 *
 * @throws DomainError bei ungültigen Overrides (siehe {@link effectivePermissions}).
 */
export function createActor(input: CreateActorInput): Actor {
  const staff = isStaffRole(input.role);
  return {
    userId: input.userId,
    role: input.role,
    permissions: effectivePermissions(input.role, input.overrides ?? []),
    customerId: staff ? null : (input.customerId ?? null),
    accountActive: input.status === 'active',
  };
}
