import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Oberflächentests der App gegen die ECHTE API (apps/api) mit frischer Testdatenbank.
 *
 * Vorher (einmalig je Änderung an der App):
 *   pnpm --filter @werkstatt/app export:api-e2e      (Web-Export mit EXPO_PUBLIC_API_URL=http://127.0.0.1:3100)
 * Voraussetzung: lokale PostgreSQL-Instanz (pnpm --filter @werkstatt/api db:start) bzw. in CI
 * der Postgres-Dienst; Adresse über E2E_ADMIN_DATABASE_URL.
 *
 * Playwright startet selbst:
 *   1. apps/api/scripts/e2e-server.ts: API auf 3100 mit Datenbank werkstatt_e2e (wird neu angelegt),
 *      Test-Zahlungsanbieter und [TEST]-Daten; Steuerport 3101 nur auf 127.0.0.1
 *   2. e2e/serve.mjs dist-api 4174 (statischer Export)
 *
 * Zur Fehlersuche mit bereits laufenden Servern: E2E_EXTERNAL_SERVERS=1 und dieselben Werte für
 * E2E_PASSWORD und E2E_FIXTURE_FILE wie beim Start von e2e-server.
 *
 * Das Passwort der Testkonten wird je Lauf zufällig erzeugt und nur über die Umgebung an
 * Server und Tests gegeben; es wird nirgends gespeichert.
 *
 * Die Tests ändern Daten (Freigabe, Zahlung, Abschluss) und laufen deshalb nacheinander in
 * einem Worker und in fester Reihenfolge.
 */
const APP_PORT = 4174;
const API_PORT = 3100;

process.env.E2E_PASSWORD ??= randomBytes(18).toString('base64url');
const resultsDir = path.resolve(__dirname, 'test-results-api');
if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
process.env.E2E_FIXTURE_FILE ??= path.join(resultsDir, 'fixture.json');

function chromiumExecutable(): string | undefined {
  if (process.env.PW_CHROMIUM_EXECUTABLE) return process.env.PW_CHROMIUM_EXECUTABLE;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return undefined;
  const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  if (!dir) return undefined;
  const candidate = `${base}/${dir}/chrome-linux/chrome`;
  return existsSync(candidate) ? candidate : undefined;
}

const executablePath = chromiumExecutable();

export default defineConfig({
  testDir: './e2e-api',
  outputDir: './test-results-api/artefakte',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: process.env.E2E_EXTERNAL_SERVERS === '1' ? undefined : [
    {
      command: 'pnpm --filter @werkstatt/api e2e:server',
      cwd: path.resolve(__dirname, '../..'),
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      env: {
        E2E_PASSWORD: process.env.E2E_PASSWORD,
        E2E_FIXTURE_FILE: process.env.E2E_FIXTURE_FILE,
        E2E_APP_ORIGIN: `http://127.0.0.1:${APP_PORT}`,
        ...(process.env.E2E_ADMIN_DATABASE_URL ? { E2E_ADMIN_DATABASE_URL: process.env.E2E_ADMIN_DATABASE_URL } : {}),
      },
    },
    {
      command: `node e2e/serve.mjs dist-api ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
  projects: [
    {
      name: 'api',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
