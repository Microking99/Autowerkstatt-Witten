/**
 * Konfiguration ausschließlich über Umgebungsvariablen, geprüft mit zod.
 * Vorlage ohne echte Werte: apps/api/.env.example. Geheimnisse werden nie geloggt.
 */
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1' || v === 'yes'));

const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: bool(false),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL fehlt'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    /** Erlaubte Herkünfte der Clients (Browser, Windows-Hülle), kommagetrennt */
    APP_ORIGINS: list,
    /** Basis-URL der App (Links in E-Mails, QR-Codes, Freigabelinks, Rückkehrseite) */
    APP_BASE_URL: z.string().url().default('http://localhost:8081'),
    /** Öffentlich erreichbare Basis-URL dieser API (Webhook-Adresse für den Zahlungsanbieter) */
    API_PUBLIC_URL: z.string().url().default('http://localhost:3000'),

    FILE_STORAGE_DIR: z.string().default('./storage'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),

    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 30),
    LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    AUTH_RATE_LIMIT_WINDOW: z.string().default('1 minute'),
    INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),

    PAYMENT_PROVIDER: z.enum(['fake', 'sumup']).default('fake'),
    SUMUP_API_KEY: z.string().optional(),
    SUMUP_MERCHANT_CODE: z.string().optional(),
    SUMUP_API_BASE: z.string().url().default('https://api.sumup.com'),
    ALLOW_LIVE_PAYMENTS: bool(false),
    /** Mindestabstand zwischen zwei Anbieterabfragen desselben Checkouts */
    PAYMENT_REFRESH_MIN_SECONDS: z.coerce.number().int().min(0).default(10),

    MAIL_MODE: z.enum(['log', 'smtp']).default('log'),
    MAIL_FROM: z.string().default('Autowerkstatt Witten <no-reply@localhost>'),
    /** Nur MAIL_MODE=log: vollständige Mails als Datei ablegen (lokaler Postausgang), nicht ins Log */
    MAIL_LOG_DIR: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_SECURE: bool(true),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    PUSH_MODE: z.enum(['log', 'expo']).default('log'),
    EXPO_ACCESS_TOKEN: z.string().optional(),

    /** Hintergrundläufe (Zustellung, Zahlungsabgleich) im Serverprozess */
    BACKGROUND_JOBS: bool(true),
    NOTIFICATION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),
    RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),

    /** Seed: E-Mail-Adresse, für die eine Admin-Einladung erzeugt wird */
    ADMIN_EMAIL: z.string().email().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === 'sumup') {
      if (!env.SUMUP_API_KEY) ctx.addIssue({ code: 'custom', path: ['SUMUP_API_KEY'], message: 'PAYMENT_PROVIDER=sumup verlangt SUMUP_API_KEY' });
      if (!env.SUMUP_MERCHANT_CODE)
        ctx.addIssue({ code: 'custom', path: ['SUMUP_MERCHANT_CODE'], message: 'PAYMENT_PROVIDER=sumup verlangt SUMUP_MERCHANT_CODE' });
      if (env.SUMUP_API_KEY && isLiveSumUpKey(env.SUMUP_API_KEY) && !env.ALLOW_LIVE_PAYMENTS) {
        ctx.addIssue({
          code: 'custom',
          path: ['SUMUP_API_KEY'],
          message: 'Live-Schlüssel erkannt. Echte Zahlungen nur mit ausdrücklicher Freigabe (ALLOW_LIVE_PAYMENTS=true).',
        });
      }
    }
    if (env.PAYMENT_PROVIDER === 'fake' && env.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'Der Test-Zahlungsanbieter ist in Produktion nicht erlaubt' });
    }
    if (env.MAIL_MODE === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'MAIL_MODE=smtp verlangt SMTP_HOST' });
    }
  });

/**
 * SumUp-Schlüssel: Testschlüssel tragen die Kennzeichnung `sup_sk_test_`. Alles andere
 * (auch unbekannte Formate) wird vorsichtshalber als Live-Schlüssel behandelt.
 */
export function isLiveSumUpKey(key: string): boolean {
  return !key.startsWith('sup_sk_test_');
}

export type AppConfig = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Ungültige Konfiguration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Liest und prüft die Konfiguration. Fehlermeldungen nennen nur Variablennamen, nie Werte. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || '(allgemein)'}: ${i.message}`));
  }
  return parsed.data;
}
