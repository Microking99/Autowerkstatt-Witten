/**
 * Bildschirmfotos der Werkstatt- und Mechanikeransichten (APP-2) für docs/entwurf/screenshots.
 * Beispieldaten im Demo-Modus. Die Uhr steht auf Dienstag, 29.09.2026, 08:40 Uhr, damit der
 * Kalender einen Werktag zeigt (die Beispieldaten richten sich nach "heute").
 * Aufruf: pnpm --filter @werkstatt/app screenshots (setzt SCREENSHOTS=1).
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { IDS, byTestId, closeSheet, loginAs, logout, openDemoPanel } from './helpers';

const OUT = path.resolve(__dirname, '../../../docs/entwurf/screenshots');
const PHONE = { width: 390, height: 844 };
const PC = { width: 1440, height: 900 };
const NOW = new Date('2026-09-29T08:40:00+02:00');
const SPRINTER_DOOR = '0000000a-0000-4000-8000-000000000012';
const SERVICE_USER = '00000001-0000-4000-8000-000000000002';
/** Hinweise (Toasts) verschwinden nach 5 Sekunden; vorher würden sie Inhalte verdecken. */
const TOAST_MS = 5300;

async function shot(page: Page, name: string) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function setup(page: Page, size: { width: number; height: number }, scheme: 'light' | 'dark' = 'light') {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: scheme });
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.clock.resume();
});

test('Kalender mit Konflikten', async ({ page }) => {
  await setup(page, PC);
  await loginAs(page, 'service', '/werkstatt/kalender');
  await expect(byTestId(page, 'kalender-tag')).toBeVisible({ timeout: 20_000 });
  await expect(byTestId(page, `termin-${IDS.appointments.sprinterToday}`)).toBeVisible();
  await shot(page, 'werkstatt-kalender-pc');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'werkstatt-kalender-pc-dunkel');
});

test('Auftrag anlegen (Assistent)', async ({ page }) => {
  await setup(page, PC);
  await loginAs(page, 'service', `/werkstatt/auftraege/neu?kunde=${IDS.customers.miriam}&fahrzeug=${IDS.vehicles.golf}`);
  await expect(byTestId(page, 'auftrag-titel')).toBeVisible({ timeout: 20_000 });
  await byTestId(page, 'auftrag-titel').fill('Ölwechsel und Bremsen prüfen');
  if ((await page.getByTestId('wizard-position-0-titel').filter({ visible: true }).count()) === 0) await byTestId(page, 'wizard-position').click();
  await byTestId(page, 'wizard-position-0-titel').fill('Ölwechsel inkl. Ölfilter');
  await byTestId(page, 'wizard-position-0-preis').fill('89,00');
  await byTestId(page, 'wizard-position').click();
  await byTestId(page, 'wizard-position-1-titel').fill('Bremsen prüfen');
  await byTestId(page, 'wizard-position-1-preis').fill('29,00');
  // Kopf mit Schrittanzeige zeigen
  await page.evaluate(() => document.querySelectorAll('*').forEach((el) => el.scrollTop > 0 && el.scrollTo({ top: 0 })));
  await shot(page, 'werkstatt-auftrag-anlegen-pc');
});

test('Auftrag: Übersicht, Rechnung, Freigabe mit Vorschau', async ({ page }) => {
  await setup(page, PC);
  await loginAs(page, 'service', `/werkstatt/auftraege/${IDS.workOrders.octaviaInspection}`);
  await expect(byTestId(page, 'werkstatt-auftrag-uebersicht')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'werkstatt-auftrag-uebersicht-pc');

  await page.goto(`/werkstatt/auftraege/${SPRINTER_DOOR}/rechnung`);
  await expect(byTestId(page, 'rechnung-zahlstatus')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'werkstatt-rechnung-pc');

  await page.goto(`/werkstatt/auftraege/${IDS.workOrders.octaviaInspection}/freigaben/neu`);
  await expect(byTestId(page, 'anfrage-titel')).toBeVisible({ timeout: 20_000 });
  await byTestId(page, 'anfrage-titel').fill('Keilrippenriemen erneuern');
  await byTestId(page, 'anfrage-beschreibung').fill('Der Keilrippenriemen zeigt Risse an mehreren Rippen. Wir empfehlen den Austausch, bevor er reißt.');
  await byTestId(page, 'zeile-0-titel').fill('Keilrippenriemen');
  await byTestId(page, 'zeile-0-preis').fill('48,00');
  await byTestId(page, 'anfrage-position-hinzufuegen').click();
  await byTestId(page, 'zeile-1-titel').fill('Arbeitszeit');
  await byTestId(page, 'zeile-1-menge').fill('0,5');
  await byTestId(page, 'zeile-1-preis').fill('90,00');
  await page.getByRole('radio', { name: 'Vorschau wie beim Kunden' }).filter({ visible: true }).first().click();
  await expect(byTestId(page, 'vorschau-kunde')).toBeVisible();
  await shot(page, 'werkstatt-freigabe-vorschau-pc');
});

test('Kundenakte, Halter, Benutzer', async ({ page }) => {
  await setup(page, PC);
  await loginAs(page, 'owner', `/werkstatt/kunden/${IDS.customers.miriam}`);
  await expect(byTestId(page, 'werkstatt-kundenakte')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'werkstatt-kundenakte-pc');
  await page.goto(`/werkstatt/fahrzeuge/${IDS.vehicles.octavia}?register=halter`);
  await expect(byTestId(page, 'halterwechsel')).toBeVisible({ timeout: 20_000 });
  await byTestId(page, 'halterwechsel').click();
  await expect(byTestId(page, 'datentrennung-hinweis')).toBeVisible();
  await shot(page, 'werkstatt-fahrzeug-halter-pc');
  await closeSheet(page).catch(() => undefined);
  await page.goto('/werkstatt/benutzer');
  await expect(byTestId(page, 'werkstatt-benutzer')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'werkstatt-benutzer-pc');
  await page.goto(`/werkstatt/benutzer/${SERVICE_USER}`);
  await expect(byTestId(page, 'werkstatt-benutzer-detail')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'werkstatt-benutzer-rechte-pc');
});

test('Werkstatt am Telefon', async ({ page }) => {
  await setup(page, PHONE);
  await loginAs(page, 'service', `/werkstatt/auftraege/${IDS.workOrders.octaviaInspection}`);
  await expect(byTestId(page, 'werkstatt-auftrag-uebersicht')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'werkstatt-auftrag-telefon');
  await page.goto('/werkstatt/auftraege');
  await expect(byTestId(page, 'werkstatt-auftraege')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'werkstatt-auftraege-telefon');
});

test('Mechaniker: Position, Feststellung, Synchronisierung offline', async ({ page }) => {
  await setup(page, PHONE);
  await loginAs(page, 'mechanic', `/mechaniker/auftraege/${IDS.workOrders.yaris}`);
  await expect(byTestId(page, 'mechaniker-auftrag')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(/^position-\d+$/).filter({ visible: true }).filter({ hasText: 'Inspektion mit Hybrid' }).first().click();
  await expect(byTestId(page, 'mechaniker-position')).toBeVisible();
  await byTestId(page, 'position-starten').click();
  await expect(byTestId(page, 'position-status')).toContainText('In Arbeit');
  await expect(page.getByTestId('wird-uebertragen').filter({ visible: true })).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(TOAST_MS);
  await shot(page, 'mechaniker-position-telefon');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'mechaniker-position-telefon-dunkel');
  await page.emulateMedia({ colorScheme: 'light' });

  // Auftrag einmal mit Verbindung öffnen (Lesecache auf dem Gerät), dann Feststellung
  await page.goto(`/mechaniker/auftraege/${IDS.workOrders.octaviaInspection}`);
  await expect(byTestId(page, 'mechaniker-auftrag')).toBeVisible({ timeout: 20_000 });
  await expect(byTestId(page, 'feststellung-erfassen')).toBeVisible({ timeout: 20_000 });
  await byTestId(page, 'feststellung-erfassen').click();
  await expect(byTestId(page, 'mechaniker-feststellung')).toBeVisible({ timeout: 20_000 });
  await byTestId(page, 'feststellung-text').fill('Keilrippenriemen rissig, mehrere Rippen betroffen.');
  await byTestId(page, 'dringlichkeit-urgent').click();
  await shot(page, 'mechaniker-feststellung-telefon');

  // Offline: Feststellung wird gespeichert, Synchronisierung zeigt den wartenden Eintrag
  await openDemoPanel(page);
  await byTestId(page, 'demo-offline').click();
  await closeSheet(page);
  await byTestId(page, 'an-service-melden').click();
  await expect(byTestId(page, 'nicht-synchronisiert')).toBeVisible({ timeout: 15_000 });
  await byTestId(page, 'reiter-sync').click();
  await expect(byTestId(page, 'wartend-0')).toBeVisible();
  await page.waitForTimeout(TOAST_MS);
  await shot(page, 'mechaniker-sync-offline-telefon');
  await logout(page);
});
