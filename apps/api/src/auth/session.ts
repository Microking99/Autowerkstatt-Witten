/**
 * Sitzungen mit undurchsichtigen Tokens (256 Bit Zufall). In der Datenbank steht nur der
 * SHA-256-Hash. Deaktivierte Konten und widerrufene/abgelaufene Sitzungen werden bei jeder
 * Anfrage abgewiesen.
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { createActor, permissionsToList, type Actor } from '@werkstatt/domain';
import type { SessionUser } from '@werkstatt/contracts';
import type { DbOrTx } from '../db/index';
import { customerAccounts, sessions, userPermissionOverrides, users } from '../db/schema/index';
import { randomToken, sha256Hex } from '../lib/crypto';
import type { AuthInfo } from '../types';

type UserRow = typeof users.$inferSelect;

export async function loadOverrides(db: DbOrTx, userId: string) {
  return db
    .select({ permission: userPermissionOverrides.permission, granted: userPermissionOverrides.granted })
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.userId, userId));
}

export async function customerIdForUser(db: DbOrTx, userId: string): Promise<string | null> {
  const [row] = await db.select({ customerId: customerAccounts.customerId }).from(customerAccounts).where(eq(customerAccounts.userId, userId));
  return row?.customerId ?? null;
}

export async function buildActor(db: DbOrTx, user: UserRow): Promise<Actor> {
  const isCustomer = user.role === 'customer';
  return createActor({
    userId: user.id,
    role: user.role,
    status: user.status,
    customerId: isCustomer ? await customerIdForUser(db, user.id) : null,
    overrides: isCustomer ? [] : await loadOverrides(db, user.id),
  });
}

export function toSessionUser(user: UserRow, actor: Actor): SessionUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    permissions: permissionsToList(actor.permissions),
    customerId: actor.customerId,
  };
}

export async function createSession(
  db: DbOrTx,
  userId: string,
  meta: { userAgent: string | null; ip: string | null },
  ttlHours: number,
  now: Date,
): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + ttlHours * 3600_000);
  const [row] = await db
    .insert(sessions)
    .values({ userId, tokenHash: sha256Hex(token), expiresAt, lastUsedAt: now, userAgent: meta.userAgent, ip: meta.ip })
    .returning({ id: sessions.id });
  return { token, expiresAt, sessionId: row!.id };
}

export async function revokeAllSessions(db: DbOrTx, userId: string, now: Date, exceptSessionId?: string): Promise<void> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  for (const r of rows) {
    if (r.id === exceptSessionId) continue;
    await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, r.id));
  }
}

export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(header.trim());
  return match ? match[1]! : null;
}

export interface ResolvedSession {
  actor: Actor;
  auth: AuthInfo;
  user: UserRow;
}

/** Löst ein Token zu Sitzung, Benutzer und Actor auf; null bei ungültiger/abgelaufener Sitzung. */
export async function resolveSession(db: DbOrTx, token: string, now: Date): Promise<ResolvedSession | null> {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));
  if (!row) return null;
  if (row.user.status !== 'active') return null;
  // Nutzung höchstens alle 5 Minuten fortschreiben
  if (!row.session.lastUsedAt || now.getTime() - row.session.lastUsedAt.getTime() > 5 * 60_000) {
    await db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, row.session.id));
  }
  const actor = await buildActor(db, row.user);
  return {
    actor,
    user: row.user,
    auth: { sessionId: row.session.id, userId: row.user.id, email: row.user.email, displayName: row.user.displayName },
  };
}
