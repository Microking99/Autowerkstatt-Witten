/**
 * Klickweg C: Rechnung bezahlen. "Jetzt bezahlen" ändert nichts; erst die serverseitig
 * geprüfte Anbieterbestätigung setzt "Bezahlt". Abbruch lässt die Rechnung offen.
 */
import { expect, test } from '@playwright/test';
import { IDS, byTestId, closeSheet, failNextRequest, loginAs, nav, openDemoPanel, visibleText } from './helpers';

const invoicePath = `/kunde/rechnungen/${IDS.invoices.golfWheels}`;

async function startPayment(page: import('@playwright/test').Page) {
  await byTestId(page, 'jetzt-bezahlen').click();
  await expect(page.getByRole('alertdialog', { name: /Zahlung über 99,96.*starten\?/ })).toBeVisible();
  await byTestId(page, 'bezahlen-dialog-bestaetigen').click();
  await expect(byTestId(page, 'demo-anbieterseite')).toBeVisible();
  await expect(visibleText(page, 'Simulierte Zahlungsseite des Anbieters (Demo)')).toBeVisible();
}

test.describe('Klickweg C: Rechnung', () => {
  test('Rechnungen → Jetzt bezahlen → Anbieterseite → "wird geprüft" → Bestätigung → Bezahlt', async ({ page }) => {
    await loginAs(page, 'customer');
    await nav(page, 'rechnungen');
    await visibleText(page, /R.2026.0311/).click();
    await expect(byTestId(page, 'rechnung-status')).toContainText('Offen');
    await startPayment(page);
    await byTestId(page, 'anbieter-abschliessen').click();
    await expect(byTestId(page, 'zahlung-wird-geprueft')).toBeVisible();
    await expect(visibleText(page, /Status der Rechnung: offen/)).toBeVisible();

    await openDemoPanel(page);
    await byTestId(page, 'anbieter-paid').click();
    await closeSheet(page);
    await expect(byTestId(page, 'zahlung-bestaetigt')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Zur Rechnung' }).filter({ visible: true }).click();
    await expect(byTestId(page, 'rechnung-status')).toContainText('Bezahlt');
  });

  test('Abbruch auf der Anbieterseite → Rechnung bleibt offen', async ({ page }) => {
    await loginAs(page, 'customer', invoicePath);
    await startPayment(page);
    await byTestId(page, 'anbieter-abbrechen').click();
    await expect(byTestId(page, 'zahlung-abgebrochen')).toBeVisible();
    await expect(visibleText(page, /Die Rechnung ist weiterhin offen/)).toBeVisible();
    await byTestId(page, 'zur-rechnung').click();
    await expect(byTestId(page, 'rechnung-status')).toContainText('Offen');
  });

  test('Doppelt gemeldete Bestätigung bucht nur einmal', async ({ page }) => {
    await loginAs(page, 'customer', invoicePath);
    await startPayment(page);
    await byTestId(page, 'anbieter-abschliessen').click();
    await openDemoPanel(page);
    await byTestId(page, 'anbieter-duplicate').click();
    await expect(page.getByTestId('toast').filter({ hasText: /Wiederholung erkannt/ }).first()).toBeVisible();
    await closeSheet(page);
    await expect(byTestId(page, 'zahlung-bestaetigt')).toBeVisible({ timeout: 15_000 });
    await page.goto(invoicePath);
    await expect(byTestId(page, 'rechnung-status')).toContainText('Bezahlt');
    await expect(page.getByText('Online (SumUp)').filter({ visible: true })).toHaveCount(1);
  });

  test('Fehlgeschlagen beim Anbieter → nicht abgeschlossen, Rechnung offen', async ({ page }) => {
    await loginAs(page, 'customer', invoicePath);
    await startPayment(page);
    await byTestId(page, 'anbieter-abschliessen').click();
    await openDemoPanel(page);
    await byTestId(page, 'anbieter-failed').click();
    await closeSheet(page);
    await expect(byTestId(page, 'zahlung-abgebrochen')).toBeVisible({ timeout: 15_000 });
  });

  test('Verbindungsfehler beim Start der Zahlung → Hinweis, nichts abgebucht', async ({ page }) => {
    await loginAs(page, 'customer', invoicePath);
    await expect(byTestId(page, 'jetzt-bezahlen')).toBeVisible();
    await failNextRequest(page);
    await byTestId(page, 'jetzt-bezahlen').click();
    await byTestId(page, 'bezahlen-dialog-bestaetigen').click();
    await expect(byTestId(page, 'zahlung-start-fehler')).toContainText('Es wurde nichts abgebucht');
    await expect(byTestId(page, 'rechnung-status')).toContainText('Offen');
  });

  test('Fremde Rechnung per URL → Nicht verfügbar', async ({ page }) => {
    await loginAs(page, 'customer', `/kunde/rechnungen/${IDS.invoices.transit}`);
    await expect(byTestId(page, 'nicht-verfuegbar')).toBeVisible();
  });
});
