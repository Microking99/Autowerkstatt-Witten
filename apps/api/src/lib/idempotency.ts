/**
 * Idempotenz für schreibende Anfragen (Header `Idempotency-Key`), je Benutzer + Methode +
 * konkretem Pfad. Die erste Antwort (2xx/4xx) wird gespeichert und bei Wiederholung mit
 * demselben Schlüssel unverändert zurückgegeben (Schutz bei Verbindungsabbrüchen und für die
 * Offline-Warteschlange). Serverfehler (5xx) werden nicht gespeichert, damit ein erneuter
 * Versuch möglich bleibt. Gleicher Schlüssel mit anderem Inhalt → 422.
 * Routen mit `config: { idempotency: false }` (Antwort enthält ein Geheimnis) werden nicht
 * gespeichert.
 */
import { and, eq, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { idempotencyKeys } from '../db/schema/index';
import { sha256Hex } from './crypto';
import { errorBody } from './errors';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
export const IDEMPOTENCY_REPLAY_HEADER = 'idempotent-replay';

function routeKey(request: FastifyRequest): string {
  return `${request.method} ${request.url.split('?')[0]}`;
}

function requestHash(request: FastifyRequest): string {
  const body = request.body;
  if (body === undefined || body === null) return sha256Hex('null');
  if (Buffer.isBuffer(body)) return sha256Hex(body);
  try {
    return sha256Hex(JSON.stringify(body));
  } catch {
    return sha256Hex('unserializable');
  }
}

export function registerIdempotency(app: FastifyInstance): void {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!WRITE_METHODS.has(request.method)) return;
    // Antworten mit Geheimnissen (Sitzungstoken, einmaliger Freigabelink) werden nie gespeichert
    if ((request.routeOptions.config as { idempotency?: boolean } | undefined)?.idempotency === false) return;
    const raw = request.headers['idempotency-key'];
    if (raw === undefined || !request.actor) return;
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key || !KEY_PATTERN.test(key)) {
      return reply.code(400).send(errorBody('invalid_idempotency_key', 'Der Idempotency-Key ist ungültig (8 bis 128 Zeichen: Buchstaben, Ziffern, . _ : -).'));
    }
    const { db } = app.deps;
    const route = routeKey(request);
    const hash = requestHash(request);
    const inserted = await db
      .insert(idempotencyKeys)
      .values({ key, userId: request.actor.userId, route, requestHash: hash })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });
    if (inserted[0]) {
      request.idempotency = { id: inserted[0].id };
      return;
    }
    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, request.actor.userId), eq(idempotencyKeys.route, route), eq(idempotencyKeys.key, key)));
    if (!existing) {
      return reply.code(409).send(errorBody('idempotency_conflict', 'Die Anfrage wird gerade verarbeitet. Bitte erneut versuchen.'));
    }
    if (existing.requestHash !== hash) {
      return reply.code(422).send(errorBody('idempotency_key_reused', 'Dieser Idempotency-Key wurde bereits für eine andere Anfrage verwendet.'));
    }
    if (existing.statusCode === null) {
      return reply.code(409).send(errorBody('idempotency_in_progress', 'Die Anfrage wird gerade verarbeitet. Bitte erneut versuchen.'));
    }
    reply.header(IDEMPOTENCY_REPLAY_HEADER, 'true');
    reply.code(existing.statusCode);
    if (existing.response === null || existing.response === undefined) return reply.send();
    return reply.type('application/json; charset=utf-8').serializer((p: unknown) => JSON.stringify(p)).send(existing.response);
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const state = request.idempotency;
    if (!state) return payload;
    request.idempotency = null;
    const { db } = app.deps;
    if (reply.statusCode >= 500) {
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, state.id));
      return payload;
    }
    let response: unknown = null;
    if (typeof payload === 'string' && payload.length > 0) {
      try {
        response = JSON.parse(payload) as unknown;
      } catch {
        response = null;
      }
    }
    await db.update(idempotencyKeys).set({ statusCode: reply.statusCode, response }).where(eq(idempotencyKeys.id, state.id));
    return payload;
  });
}

/** Entfernt alte Einträge (Aufräumlauf). */
export async function pruneIdempotencyKeys(app: FastifyInstance, olderThanDays = 7): Promise<void> {
  const cutoff = new Date(app.deps.now().getTime() - olderThanDays * 86_400_000);
  await app.deps.db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, cutoff));
}
