/**
 * Startet den API-Server und die Hintergrundläufe (Zustellung der Benachrichtigungen,
 * Zahlungsabgleich). Konfiguration: Umgebungsvariablen (apps/api/.env.example).
 */
import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import { deliverPendingNotifications } from './notifications/delivery';
import { reconcilePendingCheckouts } from './services/payments';
import { pruneIdempotencyKeys } from './lib/idempotency';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = await buildApp({ config });
  const timers: NodeJS.Timeout[] = [];

  if (config.BACKGROUND_JOBS) {
    let delivering = false;
    timers.push(
      setInterval(() => {
        if (delivering) return;
        delivering = true;
        deliverPendingNotifications({ db: app.deps.db, mailer: app.deps.mailer, push: app.deps.push, appBaseUrl: config.APP_BASE_URL, now: app.deps.now })
          .catch((err: unknown) => app.log.error({ err: err instanceof Error ? err.message : String(err) }, 'Zustellung fehlgeschlagen'))
          .finally(() => {
            delivering = false;
          });
      }, config.NOTIFICATION_INTERVAL_SECONDS * 1000),
    );
    const provider = app.deps.payments;
    if (provider) {
      let reconciling = false;
      timers.push(
        setInterval(() => {
          if (reconciling) return;
          reconciling = true;
          reconcilePendingCheckouts({ db: app.deps.db, provider, now: app.deps.now })
            .then((r) => r.checked > 0 && app.log.info(r, 'Zahlungsabgleich'))
            .catch((err: unknown) => app.log.error({ err: err instanceof Error ? err.message : String(err) }, 'Zahlungsabgleich fehlgeschlagen'))
            .finally(() => {
              reconciling = false;
            });
        }, config.RECONCILE_INTERVAL_SECONDS * 1000),
      );
    }
    timers.push(setInterval(() => void pruneIdempotencyKeys(app).catch(() => undefined), 6 * 3600_000));
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Beende Server');
    timers.forEach((t) => clearInterval(t));
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info(
    { payments: config.PAYMENT_PROVIDER, mail: config.MAIL_MODE, push: config.PUSH_MODE },
    'API bereit',
  );
}

void main();
