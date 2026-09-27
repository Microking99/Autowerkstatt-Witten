/**
 * Wendet alle SQL-Migrationen aus apps/api/drizzle an (idempotent).
 *   pnpm --filter @werkstatt/api db:migrate
 */
import { createDatabase, migrationsFolder, runMigrations } from '../src/db/index';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL fehlt (siehe apps/api/.env.example).');
  process.exit(1);
}

const handle = createDatabase(url, { max: 1 });
try {
  await runMigrations(handle.db);
  console.log(`Migrationen angewendet (${migrationsFolder}).`);
} catch (err) {
  console.error('Migration fehlgeschlagen:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await handle.close();
}
