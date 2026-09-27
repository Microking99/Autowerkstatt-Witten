/**
 * Einladungen (Mitarbeiter und Kunden) und Rücksetz-Links: Token nur als Hash gespeichert,
 * Link nur in der E-Mail. Einladung 7 Tage, Rücksetzlink 1 Stunde gültig, jeweils einmalig.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { routes } from '@werkstatt/contracts';
import type { DbOrTx } from '../db/index';
import { invitations, passwordResets } from '../db/schema/index';
import { randomToken, sha256Hex } from '../lib/crypto';
import type { Mailer } from '../notifications/channels';

export async function createInvitation(
  tx: DbOrTx,
  input: { userId: string; purpose: 'staff' | 'customer'; createdBy: string | null; ttlDays: number; now: Date },
): Promise<{ token: string; expiresAt: Date }> {
  // ältere, offene Einladungen desselben Kontos verfallen
  await tx
    .update(invitations)
    .set({ revokedAt: input.now })
    .where(and(eq(invitations.userId, input.userId), isNull(invitations.usedAt), isNull(invitations.revokedAt)));
  const token = randomToken(32);
  const expiresAt = new Date(input.now.getTime() + input.ttlDays * 86_400_000);
  await tx.insert(invitations).values({
    userId: input.userId,
    tokenHash: sha256Hex(token),
    purpose: input.purpose,
    expiresAt,
    createdBy: input.createdBy,
  });
  return { token, expiresAt };
}

export function invitationLink(appBaseUrl: string, token: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}${routes.invitation(token)}`;
}

export function resetLink(appBaseUrl: string, token: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}${routes.resetPassword(token)}`;
}

export async function sendInvitationMail(
  mailer: Mailer,
  logger: FastifyBaseLogger,
  input: { to: string; displayName: string; purpose: 'staff' | 'customer'; link: string; expiresAt: Date },
): Promise<void> {
  const until = input.expiresAt.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
  const text =
    input.purpose === 'staff'
      ? `Hallo ${input.displayName},\n\nSie wurden zur Werkstattsoftware der Autowerkstatt Witten eingeladen.\nLegen Sie Ihr Passwort über diesen Link fest (gültig bis ${until}, nur einmal verwendbar):\n\n${input.link}\n\nFalls Sie diese Einladung nicht erwartet haben, ignorieren Sie diese E-Mail.`
      : `Guten Tag,\n\ndie Autowerkstatt Witten lädt Sie zu Ihrem Kundenzugang ein. Dort sehen Sie Ihre Fahrzeuge, Aufträge, Freigaben, Rechnungen und Nachrichten.\nLegen Sie Ihr Passwort über diesen Link fest (gültig bis ${until}, nur einmal verwendbar):\n\n${input.link}\n\nFalls Sie diese Einladung nicht erwartet haben, ignorieren Sie diese E-Mail.`;
  try {
    await mailer.send({ to: input.to, subject: 'Einladung: Autowerkstatt Witten', text });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Einladung konnte nicht versendet werden');
  }
}

export async function createPasswordReset(
  tx: DbOrTx,
  input: { userId: string; ttlMinutes: number; now: Date },
): Promise<{ token: string; expiresAt: Date }> {
  await tx
    .update(passwordResets)
    .set({ usedAt: input.now })
    .where(and(eq(passwordResets.userId, input.userId), isNull(passwordResets.usedAt)));
  const token = randomToken(32);
  const expiresAt = new Date(input.now.getTime() + input.ttlMinutes * 60_000);
  await tx.insert(passwordResets).values({ userId: input.userId, tokenHash: sha256Hex(token), expiresAt });
  return { token, expiresAt };
}
