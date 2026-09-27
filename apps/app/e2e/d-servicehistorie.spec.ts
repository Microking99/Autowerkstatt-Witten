/**
 * Klickweg D: Servicehistorie und Freigabe für Kaufinteressenten.
 */
import { expect, test } from '@playwright/test';
import { IDS, byTestId, failNextRequest, loginAs, logout, nav, visibleText } from './helpers';

test.describe('Klickweg D: Servicehistorie', () => {
  test('Fahrzeuge → Golf → Fälligkeiten (Schätzung gekennzeichnet) → Servicehistorie → Eintrag', async ({ page }) => {
    await loginAs(page, 'customer');
    await nav(page, 'fahrzeuge');
    await byTestId(page, 'fahrzeug-EN-MK 2147').click();
    await expect(byTestId(page, 'faelligkeiten')).toBeVisible();
    await expect(page.getByText('km geschätzt').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/Kilometerstand geschätzt: etwa/).filter({ visible: true }).first()).toBeVisible();
    await byTestId(page, 'zur-servicehistorie').click();
    await expect(byTestId(page, 'kunde-servicehistorie')).toBeVisible();
    await visibleText(page, 'Hauptuntersuchung (HU/AU)').click();
    await expect(byTestId(page, 'kunde-serviceeintrag')).toBeVisible();
    await expect(visibleText(page, 'Ohne Mängel, Plakette erteilt.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zugehörigen Auftrag öffnen' }).filter({ visible: true })).toBeVisible();
  });

  test('Octavia: Einträge des Vorbesitzers ohne Auftragsbezug, Korrektur nachvollziehbar', async ({ page }) => {
    await loginAs(page, 'customer', `/kunde/fahrzeuge/${IDS.vehicles.octavia}/servicehistorie`);
    await visibleText(page, 'Ölwechsel mit Filter').click();
    await expect(byTestId(page, 'auftrag-ausgeblendet')).toBeVisible();
    await expect(visibleText(page, 'Dieser Eintrag wurde korrigiert')).toBeVisible();
  });

  test('Vorbesitzer: verkauftes Fahrzeug nicht mehr sichtbar, eigene alte Aufträge schon', async ({ page }) => {
    await loginAs(page, 'previousOwner', `/kunde/fahrzeuge/${IDS.vehicles.octavia}`);
    await expect(byTestId(page, 'nicht-verfuegbar')).toBeVisible();
    await page.goto('/kunde/auftraege?register=abgeschlossen');
    await expect(byTestId(page, 'auftrag-A-2025-0402')).toBeVisible();
  });

  test('Freigabe für Kaufinteressenten anlegen, Link öffnen ohne Anmeldung, widerrufen', async ({ page }) => {
    await loginAs(page, 'customer', `/kunde/fahrzeuge/${IDS.vehicles.golf}/teilen`);
    await byTestId(page, 'freigabe-bezeichnung').fill('Interessentin Probefahrt');
    await byTestId(page, 'freigabe-erstellen').click();
    await expect(page.getByRole('alertdialog', { name: /Einträge bis .* freigeben\?/ })).toBeVisible();
    await byTestId(page, 'freigabe-dialog-bestaetigen').click();
    const banner = byTestId(page, 'freigabe-link');
    await expect(banner).toBeVisible();
    const text = (await banner.textContent()) ?? '';
    const token = /\/f\/([A-Za-z0-9]{24})/.exec(text)?.[1];
    expect(token).toBeTruthy();

    // Kaufinteressent ohne Konto: abmelden und Link öffnen. Der Demo-Zustand liegt im Tab
    // (sessionStorage), daher im selben Tab ohne Anmeldung prüfen.
    const path = `/f/${token}`;
    await logout(page);
    await page.goto(path);
    await expect(byTestId(page, 'freigabe-ansicht')).toBeVisible();
    await expect(page.getByTestId('oeffentlicher-eintrag').filter({ visible: true })).toHaveCount(4);
    await expect(page.getByText(/Kowalczyk|EN.MK/)).toHaveCount(0);

    await loginAs(page, 'customer', `/kunde/fahrzeuge/${IDS.vehicles.golf}/teilen`);
    await page.getByRole('button', { name: 'Widerrufen' }).filter({ visible: true }).first().click();
    await byTestId(page, 'widerruf-dialog-bestaetigen').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Freigabe widerrufen.' }).first()).toBeVisible();
    await logout(page);
    await page.goto(path);
    await expect(byTestId(page, 'freigabe-ungueltig')).toContainText('Freigabe widerrufen');
  });

  test('Verbindungsfehler beim Laden → Fehlerzustand mit "Erneut versuchen"', async ({ page }) => {
    await loginAs(page, 'customer', `/kunde/fahrzeuge/${IDS.vehicles.golf}`);
    await expect(byTestId(page, 'faelligkeiten')).toBeVisible();
    await failNextRequest(page);
    await byTestId(page, 'zur-servicehistorie').click();
    await expect(byTestId(page, 'fehlerzustand')).toBeVisible();
    await page.getByRole('button', { name: 'Erneut versuchen' }).filter({ visible: true }).click();
    await expect(visibleText(page, 'Hauptuntersuchung (HU/AU)')).toBeVisible();
  });
});
