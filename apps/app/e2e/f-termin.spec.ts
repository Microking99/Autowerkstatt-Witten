/**
 * Klickweg F: Termin. Anfrage ist keine Buchung; Werkstatt bestätigt oder schlägt vor.
 */
import { expect, test } from '@playwright/test';
import { IDS, byTestId, closeSheet, demoAction, failNextRequest, loginAs, nav, openDemoPanel, visibleText } from './helpers';

test.describe('Klickweg F: Termin', () => {
  test('Termin anfragen → "Angefragt, noch nicht bestätigt" → Werkstatt bestätigt → Bestätigt', async ({ page }) => {
    await loginAs(page, 'customer');
    await nav(page, 'termine');
    await byTestId(page, 'termin-anfragen').click();
    await expect(byTestId(page, 'termin-anfrage-formular')).toBeVisible();
    await byTestId(page, 'termin-fahrzeug').click();
    await page.getByRole('radio', { name: 'Volkswagen Golf' }).click();
    await byTestId(page, 'termin-anliegen').fill('Bremsen quietschen beim Anfahren.');
    await byTestId(page, 'anfrage-senden').click();
    await expect(byTestId(page, 'termin-angefragt')).toBeVisible();
    await expect(visibleText(page, 'Angefragt, noch nicht bestätigt')).toBeVisible();
    await page.getByRole('button', { name: 'Anfrage ansehen' }).click();
    await expect(byTestId(page, 'termin-status')).toContainText('Angefragt, noch nicht bestätigt');
    const appointmentId = /\/kunde\/termine\/([0-9a-f-]+)/.exec(page.url())?.[1];
    expect(appointmentId).toBeTruthy();

    await openDemoPanel(page);
    await byTestId(page, `werkstatt-termin-bestaetigen-${appointmentId}`).click();
    await closeSheet(page);
    await expect(byTestId(page, 'termin-status')).toContainText('Bestätigt');
  });

  test('Alternative der Werkstatt annehmen → Bestätigt', async ({ page }) => {
    await loginAs(page, 'customer', `/kunde/termine/${IDS.appointments.octaviaTimingBelt}`);
    await expect(byTestId(page, 'terminvorschlag')).toBeVisible();
    await byTestId(page, 'vorschlag-annehmen').click();
    await byTestId(page, 'annehmen-dialog-bestaetigen').click();
    await expect(byTestId(page, 'termin-status')).toContainText('Bestätigt');
  });

  test('Alternative ablehnen → Anfrage bleibt offen; Werkstatt schlägt erneut vor', async ({ page }) => {
    await loginAs(page, 'customer', `/kunde/termine/${IDS.appointments.octaviaTimingBelt}`);
    await byTestId(page, 'vorschlag-ablehnen').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Ablehnen' }).click();
    await expect(byTestId(page, 'termin-status')).toContainText('Angefragt, noch nicht bestätigt');
    await demoAction(page, `werkstatt-termin-alternative-${IDS.appointments.octaviaTimingBelt}`);
    await expect(byTestId(page, 'termin-status')).toContainText('Alternative vorgeschlagen');
  });

  test('Abbruch: Absage-Dialog abbrechen lässt den Termin bestehen', async ({ page }) => {
    await loginAs(page, 'customer', `/kunde/termine/${IDS.appointments.golfCheck}`);
    await byTestId(page, 'termin-absagen').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Abbrechen' }).click();
    await expect(byTestId(page, 'termin-status')).toContainText('Angefragt, noch nicht bestätigt');
  });

  test('Verbindungsfehler beim Senden → Hinweis, Eingaben bleiben, erneut senden gelingt', async ({ page }) => {
    await loginAs(page, 'customer', '/kunde/termine/anfragen');
    await expect(byTestId(page, 'termin-anfrage-formular')).toBeVisible();
    await byTestId(page, 'termin-fahrzeug').click();
    await page.getByRole('radio', { name: 'Škoda Octavia Combi' }).click();
    await byTestId(page, 'termin-anliegen').fill('Klimaanlage riecht muffig.');
    await failNextRequest(page);
    await byTestId(page, 'anfrage-senden').click();
    await expect(byTestId(page, 'anfrage-fehler')).toBeVisible();
    await expect(byTestId(page, 'termin-anliegen')).toHaveValue('Klimaanlage riecht muffig.');
    await byTestId(page, 'anfrage-senden').click();
    await expect(byTestId(page, 'termin-angefragt')).toBeVisible();
  });
});
