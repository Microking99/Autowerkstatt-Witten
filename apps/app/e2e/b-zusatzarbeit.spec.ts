/**
 * Klickweg B: Zusatzreparatur mit Foto. Ablehnung betrifft nur diese Positionen; abgelehnte
 * Arbeiten erscheinen nie in der Servicehistorie.
 */
import { expect, test } from '@playwright/test';
import { IDS, byTestId, demoAction, loginAs, visibleText } from './helpers';

const brakesPath = `/kunde/auftraege/${IDS.workOrders.octaviaInspection}/freigaben/${IDS.approvals.brakes}`;

test.describe('Klickweg B: Zusatzreparatur', () => {
  test('Auftrag → Zusatzarbeit mit Fotos → Freigeben', async ({ page }) => {
    await loginAs(page, 'customer', `/kunde/auftraege/${IDS.workOrders.octaviaInspection}`);
    await byTestId(page, `zur-freigabe-${IDS.approvals.brakes}`).click();
    await expect(page).toHaveURL(new RegExp(brakesPath));
    await expect(page.getByRole('img', { name: /Bremsscheibe vorne links/ }).filter({ visible: true }).first()).toBeVisible();
    await expect(visibleText(page, 'Die Fertigstellung verschiebt sich um einen Tag.')).toBeVisible();
    await byTestId(page, 'freigeben').click();
    await expect(page.getByRole('alertdialog', { name: /Zusatzarbeit für 329,51.*freigeben\?/ })).toBeVisible();
    await byTestId(page, 'freigeben-dialog-bestaetigen').click();
    await expect(visibleText(page, 'Freigabe erteilt')).toBeVisible();
  });

  test('Ablehnen → nur diese Positionen abgelehnt; nach Abschluss keine Bremsen in der Servicehistorie', async ({ page }) => {
    await loginAs(page, 'customer', brakesPath);
    await byTestId(page, 'ablehnen').click();
    await expect(page.getByRole('alertdialog', { name: /ablehnen\?/ })).toBeVisible();
    await page.getByLabel('Anmerkung für die Werkstatt (freiwillig)').fill('Mache ich im Frühjahr.');
    await byTestId(page, 'ablehnen-dialog-bestaetigen').click();
    await expect(visibleText(page, 'Abgelehnt')).toBeVisible();
    await byTestId(page, 'zum-auftrag').click();
    await expect(visibleText(page, 'Von Ihnen abgelehnt.')).toBeVisible();
    await expect(visibleText(page, 'Vereinbart und freigegeben')).toBeVisible();

    // Werkstatt schließt ab: Serviceeinträge nur für ausgeführte Wartung
    await demoAction(page, `werkstatt-abschliessen-${IDS.workOrders.octaviaInspection}`);
    await page.goto(`/kunde/fahrzeuge/${IDS.vehicles.octavia}/servicehistorie`);
    await expect(visibleText(page, 'Servicehistorie')).toBeVisible();
    await expect(page.getByText(/Inspektion/).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/Brems/).filter({ visible: true })).toHaveCount(0);
  });

  test('Chat: ein "Ja" gilt nicht als Freigabe (Hinweis sichtbar), Anfrage bleibt offen', async ({ page }) => {
    await loginAs(page, 'customer', `/kunde/auftraege/${IDS.workOrders.octaviaInspection}/chat`);
    await expect(visibleText(page, 'Ja, machen Sie das bitte.')).toBeVisible();
    await expect(visibleText(page, /Eine Zusage im Chat gilt nicht als Freigabe/)).toBeVisible();
    await page.goto(brakesPath);
    await expect(byTestId(page, 'freigabe-status')).toContainText('Wartet auf Ihre Entscheidung');
  });
});
