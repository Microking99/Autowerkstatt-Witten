/**
 * Baut die Fastify-Instanz (ohne Port). Tests verwenden `buildApp` + `app.inject(...)`;
 * `server.ts` startet den Server und die Hintergrundläufe.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { API_PREFIX } from '@werkstatt/contracts';
import type { AppConfig } from './config';
import { createDatabase, type DatabaseHandle } from './db/index';
import { registerErrorHandling } from './lib/errors';
import { registerIdempotency } from './lib/idempotency';
import { bearerToken, resolveSession } from './auth/session';
import { LocalFileStorage } from './storage/fileStorage';
import { ExpoPushSender, LogMailer, LogPushSender, SmtpMailer } from './notifications/channels';
import { FakePaymentProvider } from './payments/fakeProvider';
import { SumUpPaymentProvider } from './payments/sumupProvider';
import type { PaymentProvider } from './payments/provider';
import { RealtimeHub } from './realtime/hub';
import type { App, AppDeps } from './types';
import { registerRoutes } from './routes/index';

export interface BuildAppOptions {
  config: AppConfig;
  /** Vorhandene Datenbankverbindung (Tests); sonst wird eine aus DATABASE_URL erzeugt */
  database?: DatabaseHandle;
  /** Einzelne Abhängigkeiten ersetzen (Tests: Fake-Anbieter, Uhr, Mailer) */
  overrides?: Partial<Omit<AppDeps, 'config' | 'db'>>;
  logger?: FastifyServerOptions['logger'];
}

/** Maskiert Tokens in öffentlichen Pfaden, bevor URLs ins Log gelangen. */
export function maskUrlForLog(url: string): string {
  return url
    .replace(/(\/public\/(?:qr|shares)\/)[^/?#]+/g, '$1[token]')
    .replace(/([?&](?:token|weiter)=)[^&#]*/gi, '$1[entfernt]');
}

export function createPaymentProvider(config: AppConfig): PaymentProvider {
  if (config.PAYMENT_PROVIDER === 'sumup') {
    return new SumUpPaymentProvider({
      apiKey: config.SUMUP_API_KEY!,
      merchantCode: config.SUMUP_MERCHANT_CODE!,
      baseUrl: config.SUMUP_API_BASE,
    });
  }
  return new FakePaymentProvider(config.SUMUP_MERCHANT_CODE);
}

export async function buildApp(options: BuildAppOptions): Promise<App> {
  const { config } = options;
  const ownsDatabase = !options.database;
  const database = options.database ?? createDatabase(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });

  const logger: FastifyServerOptions['logger'] =
    options.logger ??
    (config.LOG_LEVEL === 'silent'
      ? false
      : {
          level: config.LOG_LEVEL,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["idempotency-key"]',
              'headers.authorization',
              '*.password',
              '*.currentPassword',
              '*.newPassword',
              '*.token',
              '*.apiKey',
            ],
            censor: '[entfernt]',
          },
          serializers: {
            req(req: { method: string; url: string; id: string }) {
              return { method: req.method, url: maskUrlForLog(req.url), reqId: req.id };
            },
          },
        });

  const app = Fastify({
    logger,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const baseLogger = app.log;
  const mailer =
    options.overrides?.mailer ??
    (config.MAIL_MODE === 'smtp'
      ? new SmtpMailer(
          { host: config.SMTP_HOST!, port: config.SMTP_PORT, secure: config.SMTP_SECURE, user: config.SMTP_USER, password: config.SMTP_PASSWORD },
          config.MAIL_FROM,
        )
      : new LogMailer(baseLogger, config.MAIL_LOG_DIR ?? null));
  const push = options.overrides?.push ?? (config.PUSH_MODE === 'expo' ? new ExpoPushSender(config.EXPO_ACCESS_TOKEN) : new LogPushSender(baseLogger));

  const deps: AppDeps = {
    config,
    db: database.db,
    storage: options.overrides?.storage ?? new LocalFileStorage(config.FILE_STORAGE_DIR),
    mailer,
    push,
    payments: options.overrides?.payments !== undefined ? options.overrides.payments : createPaymentProvider(config),
    realtime: options.overrides?.realtime ?? new RealtimeHub(),
    now: options.overrides?.now ?? (() => new Date()),
  };
  app.decorate('deps', deps);
  app.decorateRequest('actor', null);
  app.decorateRequest('auth', null);
  app.decorateRequest('idempotency', null);

  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: 'same-site' } });
  await app.register(cors, {
    origin: config.APP_ORIGINS.length > 0 ? config.APP_ORIGINS : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replay'],
    credentials: false,
    maxAge: 600,
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1, fields: 10, fieldSize: 1024 } });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  registerErrorHandling(app);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('cache-control', 'no-store');
    const token = bearerToken(request);
    if (!token) return;
    const resolved = await resolveSession(deps.db, token, deps.now());
    if (resolved) {
      request.actor = resolved.actor;
      request.auth = resolved.auth;
    }
  });

  registerIdempotency(app);

  await app.register(async (api) => registerRoutes(api as unknown as App), { prefix: API_PREFIX });

  if (ownsDatabase) {
    app.addHook('onClose', async () => {
      await database.close();
    });
  }
  return app as unknown as App;
}
