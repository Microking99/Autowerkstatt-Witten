/**
 * Klickweg A: Angebot (Freigabe an Version und Inhalts-Hash gebunden).
 */
import { expect, test } from '@playwright/test';
import { IDS, byTestId, demoAction, failNextRequest, loginAs, visibleText } from './helpers';

const offerPath = `/kunde/auftraege/${IDS.workOrders.octaviaTimingBelt}/freigaben/${IDS.approvals.timingBeltOffer}`;

test.describe('Klickweg A: Angebot', () => {
  test('Start → Angebot (Version 2) → Freigeben mit Betrag im Dialog → Ergebnisansicht', async ({ page }) => {
    await loginAs(page, 'customer');
    await byTestId(page, `start-freigabe-${IDS.approvals.timingBeltOffer}`).click();
    await expect(page).toHaveURL(new RegExp(offerPath));
    await expect(visibleText(page, 'Geänderte Anfrage (Version 2)')).toBeVisible();
    await expect(byTestId(page, 'freigabe-gesamt')).toHaveText(/843,12/);
    await byTestId(page, 'freigeben').click();
    await expect(page.getByRole('alertdialog', { name: /Angebot für 843,12.*freigeben\?/ })).toBeVisible();
    await byTestId(page, 'freigeben-dialog-bestaetigen').click();
    await expect(byTestId(page, 'freigabe-ergebnis')).toBeVisible();
    await expect(visibleText(page, 'Freigabe erteilt')).toBeVisible();
    await byTestId(page, 'zum-auftrag').click();
    await expect(visibleText(page, 'Freigabe: Entschieden')).toBeVisible();
  });

  test('Abbruch: Dialog abbrechen ändert nichts', async ({ page }) => {
    await loginAs(page, 'customer', offerPath);
    await byTestId(page, 'freigeben').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(byTestId(page, 'freigabe-status')).toContainText('Wartet auf Ihre Entscheidung');
  });

  test('Angebot wird während der Ansicht geändert → 409 "Das Angebot wurde geändert" → neue Version laden', async ({ page }) => {
    await loginAs(page, 'customer', offerPath);
    await expect(byTestId(page, 'freigabe-gesamt')).toHaveText(/843,12/);
    await demoAction(page, `werkstatt-neue-version-${IDS.approvals.timingBeltOffer}`);
    await byTestId(page, 'freigeben').click();
    await byTestId(page, 'freigeben-dialog-bestaetigen').click();
    await expect(byTestId(page, 'angebot-geaendert')).toBeVisible();
    await page.getByRole('button', { name: 'Neue Version laden' }).click();
    await expect(visibleText(page, /Version 3 vom/)).toBeVisible();
    await expect(byTestId(page, 'freigabe-gesamt')).not.toHaveText(/843,12/);
  });

  test('Verbindungsfehler bei der Entscheidung → Hinweis, erneut versuchen gelingt', async ({ page }) => {
    await loginAs(page, 'customer', offerPath);
    await expect(byTestId(page, 'freigeben')).toBeVisible();
    await failNextRequest(page);
    await byTestId(page, 'ablehnen').click();
    await byTestId(page, 'ablehnen-dialog-bestaetigen').click();
    await expect(byTestId(page, 'entscheidung-fehler')).toContainText('nicht übertragen');
    await byTestId(page, 'ablehnen').click();
    await byTestId(page, 'ablehnen-dialog-bestaetigen').click();
    await expect(visibleText(page, 'Abgelehnt')).toBeVisible();
  });

  test('Fehlende Berechtigung: Auftrag des Vorbesitzers per URL → Nicht verfügbar', async ({ page }) => {
    await loginAs(page, 'customer', `/kunde/auftraege/${IDS.workOrders.rohde2025}`);
    await expect(byTestId(page, 'nicht-verfuegbar')).toBeVisible();
    await expect(page.getByText('Ölwechsel')).toHaveCount(0);
  });
});
