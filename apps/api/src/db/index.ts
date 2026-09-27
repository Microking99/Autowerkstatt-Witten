import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import * as schema from './schema/index';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type Tx = PgTransaction<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Datenbank oder laufende Transaktion */
export type DbOrTx = Db | Tx;

export interface DatabaseHandle {
  db: Db;
  pool: pg.Pool;
  close: () => Promise<void>;
}

// DATE-Spalten als Zeichenkette (YYYY-MM-DD) liefern, nicht als Date (keine Zeitzonenverschiebung)
pg.types.setTypeParser(1082, (v) => v);

export function createDatabase(url: string, options: { max?: number } = {}): DatabaseHandle {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  pool.on('error', () => {
    // Fehler auf ruhenden Verbindungen (z. B. Neustart der Datenbank) nicht als unbehandelt werfen;
    // die nächste Abfrage baut eine neue Verbindung auf.
  });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

/** Ordner mit den SQL-Migrationen; funktioniert aus `src/db` (tsx) und aus `dist` (Build). */
function resolveMigrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return path.resolve(process.env.MIGRATIONS_DIR);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')];
  return candidates.find((c) => existsSync(path.join(c, 'meta', '_journal.json'))) ?? candidates[0]!;
}

export const migrationsFolder = resolveMigrationsFolder();

export async function runMigrations(db: Db, folder: string = migrationsFolder): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}

export { schema };
