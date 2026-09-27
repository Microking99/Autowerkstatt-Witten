/**
 * Klickweg G: Rückfrage im Auftrags-Chat, inklusive "Nicht gesendet, erneut senden".
 */
import { expect, test } from '@playwright/test';
import { IDS, byTestId, closeSheet, failNextRequest, loginAs, nav, openDemoPanel, visibleText } from './helpers';

test.describe('Klickweg G: Rückfrage', () => {
  test('Auftrag → Nachricht schreiben → senden → Antwort der Werkstatt erscheint', async ({ page }) => {
    await loginAs(page, 'customer');
    await nav(page, 'auftraege');
    await byTestId(page, 'auftrag-A-2026-0187').click();
    await byTestId(page, 'zum-chat').click();
    await expect(byTestId(page, 'chat-verlauf')).toBeVisible();
    await byTestId(page, 'nachricht-eingabe').fill('Wann ist der Wagen voraussichtlich fertig?');
    await byTestId(page, 'nachricht-senden').click();
    await expect(visibleText(page, 'Wann ist der Wagen voraussichtlich fertig?')).toBeVisible();
    await expect(page.getByTestId('nachricht-fehlgeschlagen')).toHaveCount(0);

    await openDemoPanel(page);
    await byTestId(page, `werkstatt-antwort-${IDS.workOrders.octaviaInspection}`).click();
    await closeSheet(page);
    await expect(visibleText(page, 'Danke für Ihre Nachricht. Wir melden uns in Kürze bei Ihnen.')).toBeVisible();
  });

  test('Verbindungsfehler → "Nicht gesendet" → erneut senden ohne Dublette', async ({ page }) => {
    await loginAs(page, 'customer', `/kunde/auftraege/${IDS.workOrders.octaviaInspection}/chat`);
    await expect(byTestId(page, 'chat-verlauf')).toBeVisible();
    await expect(visibleText(page, 'Ja, machen Sie das bitte.')).toBeVisible();
    await failNextRequest(page);
    await byTestId(page, 'nachricht-eingabe').fill('Bitte rufen Sie mich kurz an.');
    await byTestId(page, 'nachricht-senden').click();
    await expect(byTestId(page, 'nachricht-fehlgeschlagen')).toContainText('Nicht gesendet');
    await page.getByRole('button', { name: 'Erneut senden' }).filter({ visible: true }).click();
    await expect(page.getByTestId('nachricht-fehlgeschlagen')).toHaveCount(0);
    await expect(page.getByText('Bitte rufen Sie mich kurz an.').filter({ visible: true })).toHaveCount(1);
  });

  test('Nachrichtenliste zeigt Gespräche, fremde Chats sind nicht erreichbar', async ({ page }) => {
    await loginAs(page, 'customer');
    await nav(page, 'nachrichten');
    await expect(byTestId(page, 'gespraech-A-2026-0187')).toBeVisible();
    await expect(page.getByTestId('gespraech-A-2025-0402')).toHaveCount(0);
    await page.goto(`/kunde/auftraege/${IDS.workOrders.rohde2025}/chat`);
    await expect(byTestId(page, 'nicht-verfuegbar')).toBeVisible();
  });
});
