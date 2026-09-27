import { existsSync, readdirSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E-Tests gegen den statisch ausgelieferten Demo-Export (dist-demo).
 * Vorher: `pnpm --filter @werkstatt/app export:demo`.
 * Server: e2e/serve.mjs (statische Dateien mit SPA-Fallback, nur localhost).
 *
 * Browser: vorinstalliertes Chromium unter PLAYWRIGHT_BROWSERS_PATH (z. B. /opt/pw-browsers).
 * Passt die Revision nicht zur Playwright-Version, kann der Pfad über
 * PW_CHROMIUM_EXECUTABLE gesetzt werden. Es wird nie `playwright install` ausgeführt.
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);

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
  testDir: './e2e',
  outputDir: './test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: `node e2e/serve.mjs dist-demo ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'telefon',
      testIgnore: /screenshots\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false },
    },
    {
      name: 'pc',
      testIgnore: /screenshots\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // Bildschirmfotos für docs/entwurf/screenshots nur auf Anforderung (SCREENSHOTS=1)
    ...(process.env.SCREENSHOTS
      ? [{ name: 'screenshots', testMatch: /screenshots\.spec\.ts/, use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } }]
      : []),
  ],
});
