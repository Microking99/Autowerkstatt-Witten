import { defineConfig } from 'drizzle-kit';

/**
 * Migrationen werden mit `pnpm db:generate` aus dem Schema erzeugt und als SQL unter
 * `drizzle/` versioniert. Eigene SQL-Migrationen (Erweiterungen, Trigger) entstehen mit
 * `pnpm exec drizzle-kit generate --custom --name=<name>`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://werkstatt@127.0.0.1:54329/werkstatt_dev',
  },
  strict: true,
  verbose: true,
});
