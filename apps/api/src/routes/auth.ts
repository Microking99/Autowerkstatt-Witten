/**
 * Anmeldung und Konto: login, logout, me, Einladung annehmen, Passwort vergessen/zurücksetzen,
 * Passwort ändern. Gleiche Fehlermeldung bei unbekannter E-Mail und falschem Passwort,
 * Sperre nach wiederholten Fehlversuchen, Rate-Limit, Audit.
 */
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  AcceptInvitationRequestSchema,
  ChangePasswordRequestSchema,
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  ResetPasswordRequestSchema,
  SessionUserSchema,
} from '@werkstatt/contracts';
import { invitations, passwordResets, sessions, users } from '../db/schema/index';
import { audit, auditContextFrom } from '../lib/audit';
import { hashPassword, sha256Hex, verifyAgainstDummy, verifyPassword } from '../lib/crypto';
import { HttpError, badRequest } from '../lib/errors';
import { requireActor } from '../lib/http';
import { buildActor, createSession, revokeAllSessions, toSessionUser } from '../auth/session';
import { createPasswordReset, resetLink } from '../auth/invitations';
import type { App } from '../types';

const INVALID_CREDENTIALS = 'E-Mail-Adresse oder Passwort ist falsch.';

export async function authRoutes(app: App): Promise<void> {
  const { config } = app.deps;
  const authRateLimit = (keyed: 'email' | 'ip') => ({
    rateLimit: {
      max: config.AUTH_RATE_LIMIT_MAX,
      timeWindow: config.AUTH_RATE_LIMIT_WINDOW,
      hook: 'preHandler' as const,
      keyGenerator: (req: { ip: string; body?: unknown }) => {
        if (keyed === 'ip') return req.ip;
        const email = (req.body as { email?: unknown } | undefined)?.email;
        return `${req.ip}|${typeof email === 'string' ? email.toLowerCase() : ''}`;
      },
    },
  });

  function meta(request: { headers: Record<string, unknown>; ip: string }) {
    const ua = request.headers['user-agent'];
    return { userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null, ip: request.ip };
  }

  app.post(
    '/auth/login',
    { schema: { body: LoginRequestSchema, response: { 200: LoginResponseSchema } }, config: { ...authRateLimit('email'), idempotency: false } },
    async (request) => {
      const { db, now: clock } = app.deps;
      const now = clock();
      const ctx = auditContextFrom(request);
      const [user] = await db.select().from(users).where(eq(users.email, request.body.email));

      if (!user || !user.passwordHash || user.status === 'invited') {
        await verifyAgainstDummy(request.body.password);
        await audit(db, ctx, { action: 'auth.login_failed', entityType: 'auth', entityId: user?.id ?? null, data: { reason: user ? 'not_activated' : 'unknown_email' } });
        throw new HttpError(401, 'invalid_credentials', INVALID_CREDENTIALS);
      }
      if (user.lockedUntil && user.lockedUntil > now) {
        await verifyAgainstDummy(request.body.password);
        await audit(db, { ...ctx, actorUserId: null }, { action: 'auth.login_failed', entityType: 'user', entityId: user.id, data: { reason: 'locked' } });
        throw new HttpError(429, 'too_many_attempts', 'Zu viele Fehlversuche. Bitte später erneut versuchen.');
      }
      const valid = await verifyPassword(user.passwordHash, request.body.password);
      if (!valid) {
        const [updated] = await db
          .update(users)
          .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
          .where(eq(users.id, user.id))
          .returning({ failed: users.failedLoginCount });
        const failed = updated?.failed ?? 1;
        await audit(db, ctx, { action: 'auth.login_failed', entityType: 'user', entityId: user.id, data: { reason: 'wrong_password', failedCount: failed } });
        if (failed >= config.LOGIN_MAX_FAILED_ATTEMPTS) {
          const lockedUntil = new Date(now.getTime() + config.LOGIN_LOCK_MINUTES * 60_000);
          await db.update(users).set({ lockedUntil, failedLoginCount: 0 }).where(eq(users.id, user.id));
          await audit(db, ctx, { action: 'auth.account_locked', entityType: 'user', entityId: user.id, data: { lockedUntil: lockedUntil.toISOString() } });
        }
        throw new HttpError(401, 'invalid_credentials', INVALID_CREDENTIALS);
      }
      if (user.status === 'disabled') {
        await audit(db, ctx, { action: 'auth.login_failed', entityType: 'user', entityId: user.id, data: { reason: 'disabled' } });
        throw new HttpError(403, 'account_disabled', 'Der Zugang ist gesperrt. Bitte wenden Sie sich an die Werkstatt.');
      }

      return db.transaction(async (tx) => {
        const [fresh] = await tx
          .update(users)
          .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now })
          .where(eq(users.id, user.id))
          .returning();
        const session = await createSession(tx, user.id, meta(request), config.SESSION_TTL_HOURS, now);
        const actor = await buildActor(tx, fresh!);
        await audit(tx, { ...ctx, actorUserId: user.id, actorRole: user.role }, { action: 'auth.login_succeeded', entityType: 'user', entityId: user.id });
        return { token: session.token, expiresAt: session.expiresAt.toISOString(), user: toSessionUser(fresh!, actor) };
      });
    },
  );

  app.post('/auth/logout', { schema: {} }, async (request, reply) => {
    requireActor(request);
    const { db, now } = app.deps;
    await db.update(sessions).set({ revokedAt: now() }).where(eq(sessions.id, request.auth!.sessionId));
    await audit(db, auditContextFrom(request), { action: 'auth.logout', entityType: 'user', entityId: request.auth!.userId });
    return reply.code(204).send();
  });

  app.get('/auth/me', { schema: { response: { 200: SessionUserSchema } } }, async (request) => {
    const actor = requireActor(request);
    const [user] = await app.deps.db.select().from(users).where(eq(users.id, actor.userId));
    return toSessionUser(user!, actor);
  });

  app.post(
    '/auth/invitations/accept',
    { schema: { body: AcceptInvitationRequestSchema, response: { 200: LoginResponseSchema } }, config: { ...authRateLimit('ip'), idempotency: false } },
    async (request) => {
      const { db, now: clock } = app.deps;
      const now = clock();
      const passwordHash = await hashPassword(request.body.password);
      return db.transaction(async (tx) => {
        const [inv] = await tx
          .update(invitations)
          .set({ usedAt: now })
          .where(
            and(
              eq(invitations.tokenHash, sha256Hex(request.body.token)),
              isNull(invitations.usedAt),
              isNull(invitations.revokedAt),
              gt(invitations.expiresAt, now),
            ),
          )
          .returning();
        const [user] = inv ? await tx.select().from(users).where(eq(users.id, inv.userId)) : [];
        if (!inv || !user || user.status !== 'invited') {
          throw badRequest('Die Einladung ist ungültig, abgelaufen oder wurde bereits verwendet.', undefined, 'invitation_invalid');
        }
        const [activated] = await tx
          .update(users)
          .set({ passwordHash, status: 'active', passwordChangedAt: now, lastLoginAt: now, failedLoginCount: 0, lockedUntil: null })
          .where(eq(users.id, user.id))
          .returning();
        const session = await createSession(tx, user.id, meta(request), config.SESSION_TTL_HOURS, now);
        const actor = await buildActor(tx, activated!);
        await audit(tx, { ...auditContextFrom(request), actorUserId: user.id, actorRole: user.role }, {
          action: 'user.activated',
          entityType: 'user',
          entityId: user.id,
          data: { purpose: inv.purpose },
        });
        return { token: session.token, expiresAt: session.expiresAt.toISOString(), user: toSessionUser(activated!, actor) };
      });
    },
  );

  app.post(
    '/auth/password/forgot',
    { schema: { body: ForgotPasswordRequestSchema }, config: authRateLimit('ip') },
    async (request, reply) => {
      const { db, now: clock, mailer } = app.deps;
      const now = clock();
      const [user] = await db.select().from(users).where(eq(users.email, request.body.email));
      if (user && user.status === 'active' && user.passwordHash) {
        const { token } = await db.transaction(async (tx) => {
          const created = await createPasswordReset(tx, { userId: user.id, ttlMinutes: config.PASSWORD_RESET_TTL_MINUTES, now });
          await audit(tx, auditContextFrom(request), { action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id });
          return created;
        });
        const link = resetLink(config.APP_BASE_URL, token);
        // Versand nicht abwarten: gleiche Antwortzeit für bekannte und unbekannte Adressen
        void mailer
          .send({
            to: user.email,
            subject: 'Passwort zurücksetzen: Autowerkstatt Witten',
            text: `Guten Tag,\n\nfür Ihr Konto wurde das Zurücksetzen des Passworts angefordert.\nÜber diesen Link legen Sie ein neues Passwort fest (${config.PASSWORD_RESET_TTL_MINUTES} Minuten gültig, nur einmal verwendbar):\n\n${link}\n\nWenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail. Ihr Passwort bleibt dann unverändert.`,
          })
          .catch((err: unknown) => request.log.error({ err: err instanceof Error ? err.message : String(err) }, 'Rücksetz-Mail nicht versendet'));
      }
      return reply.code(204).send();
    },
  );

  app.post(
    '/auth/password/reset',
    { schema: { body: ResetPasswordRequestSchema }, config: authRateLimit('ip') },
    async (request, reply) => {
      const { db, now: clock } = app.deps;
      const now = clock();
      const passwordHash = await hashPassword(request.body.password);
      await db.transaction(async (tx) => {
        const [reset] = await tx
          .update(passwordResets)
          .set({ usedAt: now })
          .where(and(eq(passwordResets.tokenHash, sha256Hex(request.body.token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, now)))
          .returning();
        const [user] = reset ? await tx.select().from(users).where(eq(users.id, reset.userId)) : [];
        if (!reset || !user || user.status !== 'active') {
          throw badRequest('Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.', undefined, 'reset_invalid');
        }
        await tx
          .update(users)
          .set({ passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null })
          .where(eq(users.id, user.id));
        await revokeAllSessions(tx, user.id, now);
        await audit(tx, { ...auditContextFrom(request), actorUserId: user.id, actorRole: user.role }, {
          action: 'auth.password_reset',
          entityType: 'user',
          entityId: user.id,
        });
      });
      return reply.code(204).send();
    },
  );

  app.post('/auth/password/change', { schema: { body: ChangePasswordRequestSchema } }, async (request, reply) => {
    const actor = requireActor(request);
    const { db, now: clock } = app.deps;
    const now = clock();
    const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, request.body.currentPassword))) {
      throw badRequest('Das aktuelle Passwort ist falsch.', undefined, 'invalid_current_password');
    }
    const passwordHash = await hashPassword(request.body.newPassword);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, passwordChangedAt: now }).where(eq(users.id, user.id));
      await revokeAllSessions(tx, user.id, now, request.auth!.sessionId);
      await audit(tx, auditContextFrom(request), { action: 'auth.password_changed', entityType: 'user', entityId: user.id });
    });
    return reply.code(204).send();
  });
}
