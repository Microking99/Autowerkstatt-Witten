/**
 * Bildschirmfotos für docs/entwurf/screenshots (Beispieldaten, Demo-Modus).
 * Aufruf: pnpm --filter @werkstatt/app screenshots (setzt SCREENSHOTS=1).
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { IDS, TOKENS, byTestId, closeSheet, loginAs, openDemoPanel } from './helpers';

const OUT = path.resolve(__dirname, '../../../docs/entwurf/screenshots');
const PHONE = { width: 390, height: 844 };
const PC = { width: 1440, height: 900 };

async function shot(page: Page, name: string) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function setup(page: Page, size: { width: number; height: number }, scheme: 'light' | 'dark' = 'light') {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: scheme });
}

test.describe.configure({ mode: 'serial' });

test('Anmeldung und Kundenstart', async ({ page }) => {
  await setup(page, PHONE);
  await page.goto('/anmelden');
  await expect(byTestId(page, 'anmeldung')).toBeVisible();
  await shot(page, 'anmeldung-telefon');
  await byTestId(page, 'demo-zugang-customer').click();
  await expect(byTestId(page, 'kunde-start')).toBeVisible();
  await expect(byTestId(page, 'start-entscheidungen')).toBeVisible();
  await shot(page, 'kunde-start-telefon');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'kunde-start-telefon-dunkel');
  await setup(page, PC);
  await shot(page, 'kunde-start-pc');
});

test('Fahrzeug mit Fälligkeiten und Servicehistorie', async ({ page }) => {
  await setup(page, PHONE);
  await loginAs(page, 'customer', `/kunde/fahrzeuge/${IDS.vehicles.golf}`);
  await expect(byTestId(page, 'faelligkeiten')).toBeVisible();
  await shot(page, 'kunde-fahrzeug-telefon');
  await setup(page, PC);
  await shot(page, 'kunde-fahrzeug-pc');
  await page.goto(`/kunde/fahrzeuge/${IDS.vehicles.octavia}/servicehistorie`);
  await expect(byTestId(page, 'kunde-servicehistorie')).toBeVisible();
  await shot(page, 'kunde-servicehistorie-pc');
  await setup(page, PHONE, 'dark');
  await shot(page, 'kunde-servicehistorie-telefon-dunkel');
});

test('Freigabe-Entscheidung', async ({ page }) => {
  await setup(page, PHONE);
  await loginAs(page, 'customer', `/kunde/auftraege/${IDS.workOrders.octaviaInspection}/freigaben/${IDS.approvals.brakes}`);
  await expect(byTestId(page, 'freigeben')).toBeVisible();
  await shot(page, 'kunde-freigabe-telefon');
  await setup(page, PC);
  await shot(page, 'kunde-freigabe-pc');
  await byTestId(page, 'freigeben').click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await shot(page, 'kunde-freigabe-dialog-pc');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'kunde-freigabe-pc-dunkel');
});

test('Rechnung und Zahlungsprüfung', async ({ page }) => {
  await setup(page, PHONE);
  await loginAs(page, 'customer', `/kunde/rechnungen/${IDS.invoices.golfWheels}`);
  await expect(byTestId(page, 'jetzt-bezahlen')).toBeVisible();
  await shot(page, 'kunde-rechnung-telefon');
  await byTestId(page, 'jetzt-bezahlen').click();
  await byTestId(page, 'bezahlen-dialog-bestaetigen').click();
  await expect(byTestId(page, 'demo-anbieterseite')).toBeVisible();
  await shot(page, 'demo-anbieterseite-telefon');
  await byTestId(page, 'anbieter-abschliessen').click();
  await expect(byTestId(page, 'zahlung-wird-geprueft')).toBeVisible();
  await shot(page, 'zahlung-wird-geprueft-telefon');
  await openDemoPanel(page);
  await byTestId(page, 'anbieter-paid').click();
  await closeSheet(page);
  await expect(byTestId(page, 'zahlung-bestaetigt')).toBeVisible({ timeout: 15_000 });
  await shot(page, 'zahlung-bestaetigt-telefon');
});

test('Chat', async ({ page }) => {
  await setup(page, PHONE);
  await loginAs(page, 'customer', `/kunde/auftraege/${IDS.workOrders.octaviaInspection}/chat`);
  await expect(byTestId(page, 'chat-verlauf')).toBeVisible();
  await shot(page, 'kunde-chat-telefon');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'kunde-chat-telefon-dunkel');
});

test('QR-Einstieg ohne Anmeldung und Freigabelink', async ({ page }) => {
  await setup(page, PHONE);
  await page.goto(`/q/${TOKENS.qrOctavia}`);
  await expect(byTestId(page, 'qr-anmeldung-noetig')).toBeVisible();
  await shot(page, 'qr-einstieg-ohne-anmeldung-telefon');
  await page.goto(`/q/${TOKENS.qrGolf}`);
  await expect(byTestId(page, 'qr-kurzansicht')).toBeVisible();
  await shot(page, 'qr-kurzansicht-telefon');
  await page.goto(`/f/${TOKENS.shareValid}`);
  await expect(byTestId(page, 'freigabe-ansicht')).toBeVisible();
  await shot(page, 'freigabe-link-telefon');
  await setup(page, PC);
  await shot(page, 'freigabe-link-pc');
});

test('Werkstatt-Übersicht und Mechaniker-Heute', async ({ page }) => {
  await setup(page, PC);
  await loginAs(page, 'owner');
  await expect(byTestId(page, 'werkstatt-uebersicht')).toBeVisible();
  await shot(page, 'werkstatt-uebersicht-pc');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'werkstatt-uebersicht-pc-dunkel');
  await page.evaluate(() => {
    sessionStorage.removeItem('werkstatt.sitzung');
    sessionStorage.removeItem('werkstatt.konto');
  });
  await setup(page, PHONE);
  await loginAs(page, 'mechanic');
  await expect(byTestId(page, 'mechaniker-heute')).toBeVisible();
  await shot(page, 'mechaniker-heute-telefon');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'mechaniker-heute-telefon-dunkel');
});
