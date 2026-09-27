import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyBaseLogger, FastifyInstance, RawServerDefault } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Actor } from '@werkstatt/domain';
import type { AppConfig } from './config';
import type { Db } from './db/index';
import type { FileStorage } from './storage/fileStorage';
import type { Mailer, PushSender } from './notifications/channels';
import type { PaymentProvider } from './payments/provider';
import type { RealtimeHub } from './realtime/hub';

export interface AppDeps {
  config: AppConfig;
  db: Db;
  storage: FileStorage;
  mailer: Mailer;
  push: PushSender;
  /** null, wenn kein Zahlungsanbieter konfiguriert ist */
  payments: PaymentProvider | null;
  realtime: RealtimeHub;
  /** Uhr (in Tests steuerbar) */
  now: () => Date;
}

/** Angemeldeter Benutzer der aktuellen Anfrage (zusätzlich zum Actor der Geschäftslogik). */
export interface AuthInfo {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
}

export interface IdempotencyState {
  id: string;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** false: Antwort nicht für Idempotency-Key speichern (enthält Geheimnisse) */
    idempotency?: boolean;
  }
  interface FastifyInstance {
    deps: AppDeps;
  }
  interface FastifyRequest {
    /** Geschäftslogik-Actor; null ohne gültige Sitzung */
    actor: Actor | null;
    auth: AuthInfo | null;
    idempotency: IdempotencyState | null;
  }
}

export type App = FastifyInstance<RawServerDefault, IncomingMessage, ServerResponse, FastifyBaseLogger, ZodTypeProvider>;
