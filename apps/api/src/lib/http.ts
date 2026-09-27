/**
 * Hilfen für Routen: Anmeldung verlangen, Rechteentscheidungen der Geschäftslogik in
 * HTTP-Antworten übersetzen, Seitenweise Listen.
 */
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DENY_REASON_MESSAGES, type Actor, type Decision } from '@werkstatt/domain';
import { forbidden, notFound, unauthorized } from './errors';

export function requireActor(request: FastifyRequest): Actor {
  if (!request.actor) throw unauthorized();
  return request.actor;
}

/**
 * Übersetzt eine Entscheidung: erlaubt → nichts; für Kunden (notFound) → 404, sonst 403 mit
 * deutscher Begründung.
 */
export function ensure(decision: Decision): void {
  if (decision.allowed) return;
  if (decision.notFound) throw notFound();
  throw forbidden(DENY_REASON_MESSAGES[decision.reason]);
}

/** Wie `ensure`, aber "nicht vorhanden" wird unabhängig von der Rolle zu 404. */
export function ensureFound<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw notFound();
  return value;
}

export function isStaff(actor: Actor): boolean {
  return actor.role !== 'customer';
}

export const PageQuerySchema = z.object({
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

export function page<T>(rows: T[], offset: number, limit: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit), nextCursor: hasMore ? encodeCursor(offset + limit) : null };
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
export const isoReq = (d: Date): string => d.toISOString();

export const IdParamsSchema = z.object({ id: z.string().uuid() });
