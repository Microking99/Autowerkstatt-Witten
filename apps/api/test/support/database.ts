/**
 * Testdatenbanken: Aus TEST_DATABASE_URL (sonst lokaler Cluster) wird einmalig eine
 * Vorlage mit allen Migrationen gebaut; jede Testdatei erhält eine eigene Kopie
 * (CREATE DATABASE … TEMPLATE), damit Tests unabhängig und parallel laufen.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';

export const DEFAULT_TEST_URL = 'postgres://werkstatt@127.0.0.1:54329/werkstatt_test';
export const TEMPLATE_DB = 'werkstatt_test_template';

export function baseTestUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL;
}

export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export async function adminQuery(sqlText: string): Promise<void> {
  const client = new pg.Client({ connectionString: baseTestUrl() });
  await client.connect();
  try {
    await client.query(sqlText);
  } finally {
    await client.end();
  }
}

export async function createTestDatabase(): Promise<{ name: string; url: string }> {
  const name = `werkstatt_t_${randomBytes(6).toString('hex')}`;
  await adminQuery(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`);
  return { name, url: withDatabase(baseTestUrl(), name) };
}

export async function dropTestDatabase(name: string): Promise<void> {
  if (!/^werkstatt_t_[0-9a-f]+$/.test(name)) throw new Error('Unerwarteter Datenbankname');
  await adminQuery(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
}
