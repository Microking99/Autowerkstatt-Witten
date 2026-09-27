/**
 * Hilfen für Oberflächentests gegen die echte API (playwright.api.config.ts).
 * Testdaten und Kennungen stammen aus apps/api/scripts/e2e-server.ts ([TEST]-Daten, frische
 * Datenbank je Lauf). Das Passwort kommt nur aus der Umgebung (E2E_PASSWORD).
 */
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';

export interface Fixture {
  appOrigin: string;
  apiUrl: string;
  controlUrl: string;
  users: { admin: string; service: string; mechanic: string; customer: string; foreignCustomer: string };
  customerId: string;
  vehicles: { golf: string; octavia: string; foreign: string };
  qrTokenGolf: string;
  workOrderId: string;
  oilItemId: string;
  approvalId: string;
  foreignWorkOrderId: string;
  invoiceId: string;
}

export type Role = keyof Fixture['users'];

let cached: Fixture | null = null;
export function fixture(): Fixture {
  if (cached) return cached;
  const file = process.env.E2E_FIXTURE_FILE;
  if (!file) throw new Error('E2E_FIXTURE_FILE fehlt');
  cached = JSON.parse(readFileSync(file, 'utf8')) as Fixture;
  return cached;
}

function password(): string {
  const pw = process.env.E2E_PASSWORD;
  if (!pw) throw new Error('E2E_PASSWORD fehlt');
  return pw;
}

export function byTestId(page: Page, testId: string): Locator {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

export function visibleText(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).filter({ visible: true }).first();
}

/**
 * Beobachtet einen Tab: Vertragsabweichungen (App prüft Antworten mit zod, EXPO_PUBLIC_CHECK_API=1),
 * Serverfehler (5xx) und unerwartete Konsolenfehler. `expectClean` schlägt fehl, wenn etwas davon
 * aufgetreten ist.
 */
export function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Erwartete Abweisungen (401/403/404/409) protokolliert der Browser als Ressourcenfehler
    if (/Failed to load resource: the server responded with a status of (4\d\d)/.test(text)) return;
    problems.push(`Konsole: ${text}`);
  });
  page.on('pageerror', (err) => problems.push(`Seitenfehler: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) problems.push(`Server ${res.status()}: ${res.request().method()} ${res.url()}`);
  });
  return {
    problems,
    expectClean(context = '') {
      expect(problems, `Probleme ${context}`).toEqual([]);
    },
  };
}

export async function login(page: Page, role: Role, next?: string) {
  await page.goto(next ? `/anmelden?weiter=${encodeURIComponent(next)}` : '/anmelden');
  await byTestId(page, 'email').fill(fixture().users[role]);
  await byTestId(page, 'passwort').fill(password());
  await byTestId(page, 'anmelden').click();
  await expect(byTestId(page, 'anmeldung')).toBeHidden({ timeout: 15_000 });
}

export async function logout(page: Page) {
  await page.evaluate(() => {
    sessionStorage.removeItem('werkstatt.sitzung');
    sessionStorage.removeItem('werkstatt.konto');
  });
}

export async function switchTo(page: Page, role: Role, next?: string) {
  await logout(page);
  await login(page, role, next);
}

/** Ansicht öffnen und warten, bis Laden abgeschlossen ist (kein Skelett mehr, kein Fehlerzustand). */
export async function openView(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

/** Anbieterbestätigung über den Steuerport des e2e-Servers simulieren (nur localhost). */
export async function providerConfirmsLatestCheckout(): Promise<{ checkoutId: string; webhookStatus: number }> {
  const res = await fetch(`${fixture().controlUrl}/fake-provider/pay-latest`, { method: 'POST' });
  if (!res.ok) throw new Error(`Steuerport: ${res.status} ${await res.text()}`);
  return (await res.json()) as { checkoutId: string; webhookStatus: number };
}
