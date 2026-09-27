/**
 * Anmeldung, Rückkehrziel, Bereichsschutz, Einladung, Benachrichtigung → Anmeldung → Vorgang.
 */
import { expect, test } from '@playwright/test';
import { IDS, TOKENS, byTestId, loginAs, logout, openDemoPanel, visibleText } from './helpers';

test.describe('Zugang und Navigation', () => {
  test('Falsche Anmeldedaten verraten nicht, ob die E-Mail existiert', async ({ page }) => {
    await page.goto('/anmelden');
    await byTestId(page, 'email').fill('m.kowalczyk@kunden.example');
    await byTestId(page, 'passwort').fill('falsch');
    await byTestId(page, 'anmelden').click();
    await expect(byTestId(page, 'anmeldung-fehler')).toContainText('E-Mail-Adresse oder Passwort ist nicht korrekt.');
    await byTestId(page, 'email').fill('niemand@kunden.example');
    await byTestId(page, 'anmelden').click();
    await expect(byTestId(page, 'anmeldung-fehler')).toContainText('E-Mail-Adresse oder Passwort ist nicht korrekt.');
  });

  test('Deep Link ohne Anmeldung → /anmelden?weiter=… → nach Anmeldung direkt zum Vorgang', async ({ page }) => {
    await page.goto(`/kunde/rechnungen/${IDS.invoices.golfAc}`);
    await expect(page).toHaveURL(/\/anmelden\?weiter=%2Fkunde%2Frechnungen%2F/);
    await byTestId(page, 'email').fill('m.kowalczyk@kunden.example');
    await byTestId(page, 'passwort').fill('Beispiel2026');
    await byTestId(page, 'anmelden').click();
    await expect(page).toHaveURL(new RegExp(`/kunde/rechnungen/${IDS.invoices.golfAc}`));
    await expect(byTestId(page, 'rechnung-status')).toContainText('Offen');
  });

  test('Mitteilung (simulierte Push-Benachrichtigung) → Anmeldung → Vorgang', async ({ page }) => {
    await page.goto('/anmelden');
    await openDemoPanel(page);
    await visibleText(page, /Freigabe erbeten: Bremsen vorne/).click();
    await expect(page).toHaveURL(/\/anmelden\?weiter=/);
    await byTestId(page, 'demo-zugang-customer').click();
    await expect(page).toHaveURL(new RegExp(`/freigaben/${IDS.approvals.brakes}`));
    await expect(byTestId(page, 'kunde-freigabe')).toBeVisible();
  });

  test('Offene Weiterleitung nach außen wird verhindert', async ({ page }) => {
    await page.goto(`/anmelden?weiter=${encodeURIComponent('https://boese.example/')}`);
    await byTestId(page, 'demo-zugang-customer').click();
    await expect(page).toHaveURL(/\/kunde$/);
  });

  test('Fremder Rollenbereich → eigene Startseite', async ({ page }) => {
    await loginAs(page, 'customer', '/werkstatt');
    await expect(page).toHaveURL(/\/kunde$/);
    await logout(page);
    await loginAs(page, 'mechanic', '/kunde/rechnungen');
    await expect(page).toHaveURL(/\/mechaniker$/);
  });

  test('Einladung: abgelaufen → Hinweis; gültig → Passwort festlegen und angemeldet', async ({ page }) => {
    await page.goto(`/einladung/${TOKENS.invitationExpired}`);
    await byTestId(page, 'neues-passwort').fill('ein sicheres Passwort');
    await byTestId(page, 'passwort-wiederholen').fill('ein sicheres Passwort');
    await byTestId(page, 'passwort-speichern').click();
    await expect(visibleText(page, 'Einladung nicht nutzbar')).toBeVisible();
    await page.goto(`/einladung/${TOKENS.invitationValid}`);
    await byTestId(page, 'neues-passwort').fill('kurz');
    await byTestId(page, 'passwort-speichern').click();
    await expect(visibleText(page, 'Das Passwort muss mindestens 10 Zeichen haben.')).toBeVisible();
    await byTestId(page, 'neues-passwort').fill('Haustechnik seit 1998');
    await byTestId(page, 'passwort-wiederholen').fill('Haustechnik seit 1998');
    await byTestId(page, 'passwort-speichern').click();
    await expect(page).toHaveURL(/\/kunde$/);
  });

  test('Werkstatt-Übersicht und Mechaniker-Heute laden', async ({ page }) => {
    await loginAs(page, 'owner');
    await expect(byTestId(page, 'werkstatt-uebersicht')).toBeVisible();
    await expect(byTestId(page, 'kachel-pending_approvals')).toContainText('2');
    await byTestId(page, 'kachel-pending_approvals').click();
    // Kachel führt zur gefilterten Auftragsliste (Filter in der URL)
    await expect(page).toHaveURL(/\/werkstatt\/auftraege\?freigabe=pending/);
    await expect(byTestId(page, 'werkstatt-auftraege')).toBeVisible();
    await expect(byTestId(page, 'auftrag-A-2026-0187')).toBeVisible();
    await logout(page);
    await loginAs(page, 'mechanic');
    await expect(byTestId(page, 'mechaniker-heute')).toBeVisible();
    await expect(visibleText(page, 'Wartet auf Kundenfreigabe')).toBeVisible();
  });
});
