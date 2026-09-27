/**
 * Werkstatt am PC (APP-2): Tastaturbedienung. Strg+K öffnet die Schnellsuche, Esc schließt
 * sie; Alt+Ziffer wechselt den Hauptbereich; J/K/Enter in Listen. Nur im Projekt "pc".
 */
import { expect, test } from '@playwright/test';
import { byTestId, isPhone, loginAs } from './helpers';

test.describe('Werkstatt: Tastatur (PC)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isPhone(page), 'Tastaturkürzel nur am PC');
  });

  test('Strg+K Schnellsuche → Treffer → Esc schließt', async ({ page }) => {
    await loginAs(page, 'service', '/werkstatt');
    await expect(byTestId(page, 'schnellsuche-oeffnen')).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(byTestId(page, 'schnellsuche')).toBeVisible();
    await expect(byTestId(page, 'schnellsuche-eingabe')).toBeFocused();
    await byTestId(page, 'schnellsuche-eingabe').pressSequentially('A-2026-0187', { delay: 20 });
    await expect(byTestId(page, 'treffer-auftrag-A-2026-0187')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('schnellsuche').filter({ visible: true })).toHaveCount(0);

    // Wieder öffnen und mit Enter zum Treffer
    await page.keyboard.press('Control+k');
    await expect(byTestId(page, 'schnellsuche-eingabe')).toBeFocused();
    await byTestId(page, 'schnellsuche-eingabe').pressSequentially('A-2026-0187', { delay: 20 });
    await expect(byTestId(page, 'treffer-auftrag-A-2026-0187')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/werkstatt\/auftraege\/[0-9a-f-]{36}/);
  });

  test('Alt+2 öffnet den Kalender, J und Enter öffnen einen Auftrag', async ({ page }) => {
    await loginAs(page, 'service', '/werkstatt');
    await expect(byTestId(page, 'schnellsuche-oeffnen')).toBeVisible();
    await page.keyboard.press('Alt+2');
    await expect(page).toHaveURL(/\/werkstatt\/kalender/);
    await page.keyboard.press('Alt+3');
    await expect(page).toHaveURL(/\/werkstatt\/auftraege/);
    await expect(byTestId(page, 'auftrag-A-2026-0187')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/werkstatt\/auftraege\/[0-9a-f-]{36}/);
  });
});
