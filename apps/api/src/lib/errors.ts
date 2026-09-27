/**
 * Einheitliches Fehlerformat `ApiError` (packages/contracts/src/dto.ts):
 * `{ error: { code, message, details? } }`. Meldungen sind deutsch und verraten keine
 * fremden Daten; für Kunden sind "nicht erlaubt" und "nicht vorhanden" gleich (404).
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import type { ApiError } from '@werkstatt/contracts';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown, code = 'bad_request') => new HttpError(400, code, message, details);
export const unauthorized = (message = 'Anmeldung erforderlich.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Dafür fehlt die Berechtigung.', code = 'forbidden') => new HttpError(403, code, message);
export const notFound = (message = 'Nicht gefunden oder kein Zugriff.') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) => new HttpError(422, code, message, details);

export function errorBody(code: string, message: string, details?: unknown): ApiError {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}

interface PgError {
  code?: string;
  constraint?: string;
}

function isPgError(err: unknown): err is PgError & Error {
  return typeof err === 'object' && err !== null && typeof (err as PgError).code === 'string' && /^[0-9A-Z]{5}$/.test((err as PgError).code!);
}

/** Registriert Fehler- und 404-Behandlung. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_req: FastifyRequest, reply: FastifyReply) => {
    void reply.code(404).send(errorBody('not_found', 'Nicht gefunden.'));
  });

  app.setErrorHandler((error: FastifyError | HttpError | Error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message, error.details));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      // Ungültige IDs im Pfad sind "nicht gefunden" (keine Existenzpreisgabe, kein 500)
      if ((error as FastifyError).validationContext === 'params') {
        return reply.code(404).send(errorBody('not_found', 'Nicht gefunden oder kein Zugriff.'));
      }
      const details = error.validation.map((v) => ({
        path: [((error as FastifyError).validationContext ?? 'body') as string, ...String(v.instancePath ?? '').split('/').filter(Boolean)].join('.'),
        message: v.message ?? 'Ungültig',
      }));
      return reply.code(400).send(errorBody('validation_failed', 'Die Eingaben sind ungültig.', details));
    }
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error, issues: error.cause.issues }, 'Antwort entspricht nicht dem Vertrag');
      return reply.code(500).send(errorBody('internal_error', 'Interner Fehler.'));
    }
    if (isPgError(error)) {
      if (error.code === '23505') {
        request.log.warn({ constraint: error.constraint }, 'Eindeutigkeitsverletzung');
        return reply.code(409).send(errorBody('conflict', 'Der Datensatz existiert bereits oder wurde gleichzeitig geändert.'));
      }
      if (error.code === '40001' || error.code === '40P01') {
        return reply.code(409).send(errorBody('conflict', 'Gleichzeitige Änderung, bitte erneut versuchen.'));
      }
      if (error.code === '22P02') {
        return reply.code(404).send(errorBody('not_found', 'Nicht gefunden oder kein Zugriff.'));
      }
    }
    const fe = error as FastifyError;
    const status = typeof fe.statusCode === 'number' ? fe.statusCode : 500;
    if (status === 429) {
      return reply.code(429).send(errorBody('too_many_requests', 'Zu viele Anfragen. Bitte später erneut versuchen.'));
    }
    if (status === 413 || fe.code === 'FST_REQ_FILE_TOO_LARGE' || fe.code === 'FST_FILES_LIMIT') {
      return reply.code(413).send(errorBody('payload_too_large', 'Die Datei ist zu groß.'));
    }
    if (status === 415 || fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || fe.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      return reply.code(415).send(errorBody('unsupported_media_type', 'Dieses Format wird nicht unterstützt.'));
    }
    if (status >= 400 && status < 500) {
      return reply.code(status).send(errorBody('bad_request', 'Die Anfrage ist ungültig.'));
    }
    request.log.error({ err: error }, 'Unerwarteter Fehler');
    return reply.code(500).send(errorBody('internal_error', 'Interner Fehler.'));
  });
}
