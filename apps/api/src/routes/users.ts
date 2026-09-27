/**
 * Mitarbeiterverwaltung (Recht users.manage): einladen, Rolle/Rechte ändern, deaktivieren.
 * Regeln (letzter aktiver Admin, zuweisbare Rechte) entscheidet die Geschäftslogik.
 */
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { InviteStaffRequestSchema, StaffUserSchema, UpdateStaffRequestSchema, type StaffUser } from '@werkstatt/contracts';
import {
  canDisableUser,
  effectivePermissions,
  hasPermission,
  permissionsToList,
  validatePermissionChange,
  type PermissionOverride,
} from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { userPermissionOverrides, users } from '../db/schema/index';
import { audit, auditContextFrom } from '../lib/audit';
import { conflict, unprocessable } from '../lib/errors';
import { IdParamsSchema, ensure, ensureFound, iso, requireActor } from '../lib/http';
import { createInvitation, invitationLink, sendInvitationMail } from '../auth/invitations';
import { loadOverrides, revokeAllSessions } from '../auth/session';
import type { App } from '../types';

type UserRow = typeof users.$inferSelect;

function safeEffective(role: UserRow['role'], overrides: PermissionOverride[]) {
  try {
    return permissionsToList(effectivePermissions(role, overrides));
  } catch {
    return [];
  }
}

export async function toStaffUser(db: DbOrTx, user: UserRow): Promise<StaffUser> {
  const overrides = await loadOverrides(db, user.id);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    permissionOverrides: overrides.map((o) => ({ permission: o.permission, granted: o.granted })),
    effectivePermissions: safeEffective(user.role, overrides),
    lastLoginAt: iso(user.lastLoginAt),
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Aktive Admins, die users.manage wirksam besitzen. Innerhalb einer Transaktion aufrufen:
 * Die Zeilen der aktiven Admins werden gesperrt (feste Reihenfolge), damit zwei gleichzeitige
 * Änderungen (z. B. zwei Admins deaktivieren sich gegenseitig) nacheinander geprüft werden und
 * nie der letzte aktive Admin verloren geht.
 */
export async function countActiveAdmins(db: DbOrTx): Promise<number> {
  const admins = await db
    .select()
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.status, 'active')))
    .orderBy(asc(users.id))
    .for('update');
  let count = 0;
  for (const a of admins) {
    const overrides = await loadOverrides(db, a.id);
    if (safeEffective(a.role, overrides).includes('users.manage')) count += 1;
  }
  return count;
}

async function loadStaff(db: DbOrTx, id: string): Promise<UserRow> {
  const [user] = await db.select().from(users).where(and(eq(users.id, id), ne(users.role, 'customer')));
  return ensureFound(user);
}

export async function userRoutes(app: App): Promise<void> {
  app.get('/users', { schema: { response: { 200: z.array(StaffUserSchema) } } }, async (request) => {
    ensure(hasPermission(requireActor(request), 'users.manage'));
    const { db } = app.deps;
    const rows = await db.select().from(users).where(inArray(users.role, ['admin', 'service', 'mechanic'])).orderBy(asc(users.displayName));
    return Promise.all(rows.map((u) => toStaffUser(db, u)));
  });

  app.post('/users/invite', { schema: { body: InviteStaffRequestSchema, response: { 201: StaffUserSchema } } }, async (request, reply) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'users.manage'));
    const { db, now: clock, config, mailer } = app.deps;
    const now = clock();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, request.body.email));
    if (existing) throw conflict('email_taken', 'Für diese E-Mail-Adresse gibt es bereits ein Konto.');
    const result = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: request.body.email, displayName: request.body.displayName, role: request.body.role, status: 'invited' })
        .returning();
      const invitation = await createInvitation(tx, { userId: user!.id, purpose: 'staff', createdBy: actor.userId, ttlDays: config.INVITATION_TTL_DAYS, now });
      await audit(tx, auditContextFrom(request), { action: 'user.invited', entityType: 'user', entityId: user!.id, data: { role: user!.role } });
      return { user: user!, invitation };
    });
    await sendInvitationMail(mailer, request.log, {
      to: result.user.email,
      displayName: result.user.displayName,
      purpose: 'staff',
      link: invitationLink(config.APP_BASE_URL, result.invitation.token),
      expiresAt: result.invitation.expiresAt,
    });
    return reply.code(201).send(await toStaffUser(db, result.user));
  });

  app.get('/users/:id', { schema: { params: IdParamsSchema, response: { 200: StaffUserSchema } } }, async (request) => {
    ensure(hasPermission(requireActor(request), 'users.manage'));
    const { db } = app.deps;
    return toStaffUser(db, await loadStaff(db, request.params.id));
  });

  app.patch(
    '/users/:id',
    { schema: { params: IdParamsSchema, body: UpdateStaffRequestSchema, response: { 200: StaffUserSchema } } },
    async (request) => {
      const actor = requireActor(request);
      ensure(hasPermission(actor, 'users.manage'));
      const { db } = app.deps;
      return db.transaction(async (tx) => {
        const target = await loadStaff(tx, request.params.id);
        const currentOverrides = await loadOverrides(tx, target.id);
        const body = request.body;
        const change = validatePermissionChange({
          targetUser: { id: target.id, role: target.role, status: target.status, overrides: currentOverrides },
          newRole: body.role,
          newOverrides: body.permissionOverrides,
          activeAdminCount: await countActiveAdmins(tx),
        });
        if (!change.ok) {
          throw unprocessable('permission_change_rejected', change.issues.map((i) => i.message).join(' '), change.issues);
        }
        const ctx = auditContextFrom(request);
        if (body.displayName !== undefined && body.displayName !== target.displayName) {
          await tx.update(users).set({ displayName: body.displayName }).where(eq(users.id, target.id));
          await audit(tx, ctx, { action: 'user.updated', entityType: 'user', entityId: target.id, data: { displayName: body.displayName } });
        }
        if (change.role !== target.role) {
          await tx.update(users).set({ role: change.role }).where(eq(users.id, target.id));
          await audit(tx, ctx, { action: 'user.role_changed', entityType: 'user', entityId: target.id, data: { from: target.role, to: change.role } });
        }
        const before = JSON.stringify([...currentOverrides].sort((a, b) => a.permission.localeCompare(b.permission)));
        const after = JSON.stringify([...change.overrides].sort((a, b) => a.permission.localeCompare(b.permission)));
        if (before !== after) {
          await tx.delete(userPermissionOverrides).where(eq(userPermissionOverrides.userId, target.id));
          if (change.overrides.length > 0) {
            await tx
              .insert(userPermissionOverrides)
              .values(change.overrides.map((o) => ({ userId: target.id, permission: o.permission, granted: o.granted, createdBy: actor.userId })));
          }
          await audit(tx, ctx, {
            action: 'user.permissions_changed',
            entityType: 'user',
            entityId: target.id,
            data: { before: currentOverrides, after: change.overrides },
          });
        }
        const [fresh] = await tx.select().from(users).where(eq(users.id, target.id));
        return toStaffUser(tx, fresh!);
      });
    },
  );

  app.post('/users/:id/disable', { schema: { params: IdParamsSchema, response: { 200: StaffUserSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'users.manage'));
    const { db, now: clock } = app.deps;
    const now = clock();
    const result = await db.transaction(async (tx) => {
      const target = await loadStaff(tx, request.params.id);
      const check = canDisableUser({
        targetUser: { id: target.id, role: target.role, status: target.status, overrides: await loadOverrides(tx, target.id) },
        activeAdminCount: await countActiveAdmins(tx),
      });
      if (!check.ok) throw unprocessable(check.issue.code.toLowerCase(), check.issue.message);
      const [updated] = await tx.update(users).set({ status: 'disabled' }).where(eq(users.id, target.id)).returning();
      await revokeAllSessions(tx, target.id, now);
      await audit(tx, auditContextFrom(request), { action: 'user.disabled', entityType: 'user', entityId: target.id });
      return toStaffUser(tx, updated!);
    });
    // Echtzeitverbindungen sofort trennen (nicht erst bei der nächsten Sitzungsprüfung)
    app.deps.realtime.disconnectUser(result.id);
    return result;
  });

  app.post('/users/:id/enable', { schema: { params: IdParamsSchema, response: { 200: StaffUserSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'users.manage'));
    const { db } = app.deps;
    return db.transaction(async (tx) => {
      const target = await loadStaff(tx, request.params.id);
      const status = target.passwordHash ? 'active' : 'invited';
      const [updated] = await tx.update(users).set({ status, failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, target.id)).returning();
      await audit(tx, auditContextFrom(request), { action: 'user.enabled', entityType: 'user', entityId: target.id, data: { status } });
      return toStaffUser(tx, updated!);
    });
  });
}
