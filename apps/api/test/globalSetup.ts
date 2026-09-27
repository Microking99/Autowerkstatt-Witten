/**
 * Baut vor allen Tests die Vorlagedatenbank mit allen Migrationen (drizzle/).
 * Voraussetzung: laufender PostgreSQL (TEST_DATABASE_URL oder `pnpm db:start`).
 */
import { createDatabase, runMigrations } from '../src/db/index';
import { TEMPLATE_DB, adminQuery, baseTestUrl, withDatabase } from './support/database';

export default async function setup(): Promise<void> {
  try {
    await adminQuery(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
    await adminQuery(`CREATE DATABASE ${TEMPLATE_DB}`);
  } catch (err) {
    throw new Error(
      `Test-Datenbank nicht erreichbar (${baseTestUrl().replace(/\/\/[^@]*@/, '//***@')}). ` +
        `Bitte TEST_DATABASE_URL setzen oder "pnpm --filter @werkstatt/api db:start" ausführen. Ursache: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const handle = createDatabase(withDatabase(baseTestUrl(), TEMPLATE_DB), { max: 1 });
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
}
