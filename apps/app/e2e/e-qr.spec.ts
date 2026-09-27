/**
 * Klickweg E: QR-Code. Ohne Anmeldung nur, was der Halter freigegeben hat; kein Generalschlüssel.
 */
import { expect, test } from '@playwright/test';
import { IDS, TOKENS, byTestId, visibleText } from './helpers';

test.describe('Klickweg E: QR-Serviceheft', () => {
  test('Ohne Anmeldung, Kurzansicht freigegeben: Marke, Modell, Wartungen, keine persönlichen Daten', async ({ page }) => {
    await page.goto(`/q/${TOKENS.qrGolf}`);
    await expect(byTestId(page, 'qr-kurzansicht')).toBeVisible();
    await expect(visibleText(page, 'Volkswagen Golf')).toBeVisible();
    await expect(page.getByTestId('oeffentlicher-eintrag').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/Kowalczyk|EN.MK|WVW|€/)).toHaveCount(0);
  });

  test('Ohne Anmeldung, nicht freigegeben: nur Hinweis → Anmeldung → Fahrzeugakte', async ({ page }) => {
    await page.goto(`/q/${TOKENS.qrOctavia}`);
    await expect(byTestId(page, 'qr-anmeldung-noetig')).toBeVisible();
    await expect(page.getByText(/Octavia|Inspektion/)).toHaveCount(0);
    await byTestId(page, 'qr-anmelden').click();
    await expect(page).toHaveURL(/\/anmelden\?weiter=/);
    await byTestId(page, 'demo-zugang-customer').click();
    await expect(page).toHaveURL(new RegExp(`/kunde/fahrzeuge/${IDS.vehicles.octavia}`));
    await expect(byTestId(page, 'kunde-fahrzeug')).toBeVisible();
  });

  test('Vorbesitzer scannt den Code des verkauften Fahrzeugs: kein Zugriff', async ({ page }) => {
    await page.goto(`/anmelden?weiter=${encodeURIComponent(`/q/${TOKENS.qrOctavia}`)}`);
    await byTestId(page, 'demo-zugang-previousOwner').click();
    await expect(byTestId(page, 'qr-anmeldung-noetig')).toBeVisible();
    await expect(visibleText(page, 'Mit Ihrem aktuellen Zugang haben Sie keinen Zugriff auf dieses Fahrzeug.')).toBeVisible();
  });

  test('Unbekannter Code → "Code nicht gefunden"', async ({ page }) => {
    await page.goto('/q/qr-gibt-es-nicht-123');
    await expect(byTestId(page, 'qr-unbekannt')).toContainText('Code nicht gefunden');
  });

  test('Freigabelink: gültig, abgelaufen, widerrufen', async ({ page }) => {
    await page.goto(`/f/${TOKENS.shareValid}`);
    await expect(byTestId(page, 'freigabe-ansicht')).toBeVisible();
    await expect(visibleText(page, 'Freigegebene Servicehistorie')).toBeVisible();
    await page.goto(`/f/${TOKENS.shareExpired}`);
    await expect(byTestId(page, 'freigabe-ungueltig')).toContainText('Freigabe abgelaufen');
    await page.goto(`/f/${TOKENS.shareRevoked}`);
    await expect(byTestId(page, 'freigabe-ungueltig')).toContainText('Freigabe widerrufen');
    await page.goto('/f/unvollstaendig');
    await expect(byTestId(page, 'freigabe-ungueltig')).toContainText('Link ungültig');
  });
});
