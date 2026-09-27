/**
 * Werkstatt (APP-2): Auftrag mit neuem Kunden und Fahrzeug anlegen, ohne dass der Entwurf
 * verloren geht; Fahrzeugannahme (vor Ort und in der Kunden-App); Rechnung stellen und
 * Zahlung manuell erfassen (nur mit Recht); Halterwechsel; Kalenderkonflikt nur mit
 * Begründung. Läuft am Telefon (390 x 844) und am PC (1440 x 900).
 */
import { expect, test } from '@playwright/test';
import { IDS, byTestId, isPhone, loginAs, switchTo, visibleText } from './helpers';

test.describe('Werkstatt: Auftrag anlegen', () => {
  test('Neuer Kunde und neues Fahrzeug im Seitendialog; Entwurf übersteht Neuladen', async ({ page }) => {
    await loginAs(page, 'service', '/werkstatt/auftraege/neu');
    await expect(byTestId(page, 'werkstatt-auftrag-neu')).toBeVisible();

    // Schritt 1: Kunde neu anlegen, ohne den Assistenten zu verlassen
    await byTestId(page, 'neuer-kunde').click();
    await expect(byTestId(page, 'neuer-kunde-blatt')).toBeVisible();
    await byTestId(page, 'kunde-vorname').fill('Jana');
    await byTestId(page, 'kunde-nachname').fill('Beispiel [TEST]');
    await byTestId(page, 'kunde-telefon').fill('02302 000 111');
    await byTestId(page, 'kunde-speichern').click();

    // Schritt 2: Fahrzeug für den neuen Kunden (noch keines vorhanden)
    await expect(visibleText(page, /2\. Fahrzeug von Jana Beispiel/)).toBeVisible();
    await byTestId(page, 'neues-fahrzeug-leer').click();
    await expect(byTestId(page, 'neues-fahrzeug-blatt')).toBeVisible();
    await byTestId(page, 'fahrzeug-kennzeichen').fill('EN-TE 42');
    await byTestId(page, 'fahrzeug-hersteller').fill('Opel');
    await byTestId(page, 'fahrzeug-modell').fill('Astra');
    await byTestId(page, 'fahrzeug-speichern').click();

    // Schritt 3: Leistungen
    await expect(byTestId(page, 'auftrag-titel')).toBeVisible();
    await byTestId(page, 'auftrag-titel').fill('Inspektion und Bremsen prüfen');
    if ((await page.getByTestId('wizard-position-0-titel').filter({ visible: true }).count()) === 0) await byTestId(page, 'wizard-position').click();
    await byTestId(page, 'wizard-position-0-titel').fill('Inspektion nach Herstellervorgabe');
    await byTestId(page, 'wizard-position-0-preis').fill('189,00');

    // Neuladen: Entwurf ist lokal gespeichert und wird wiederhergestellt
    await page.waitForTimeout(800);
    await page.reload();
    await expect(byTestId(page, 'entwurf-wiederhergestellt')).toBeVisible({ timeout: 15_000 });
    await expect(byTestId(page, 'auftrag-titel')).toHaveValue('Inspektion und Bremsen prüfen');
    await expect(byTestId(page, 'wizard-position-0-titel')).toHaveValue('Inspektion nach Herstellervorgabe');

    // Schritt 4: prüfen und anlegen
    await byTestId(page, 'wizard-weiter').click();
    await expect(visibleText(page, 'Jana Beispiel [TEST]')).toBeVisible();
    await expect(visibleText(page, /EN.TE.42/)).toBeVisible();
    await byTestId(page, 'wizard-anlegen').click();
    await expect(page).toHaveURL(/\/werkstatt\/auftraege\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(visibleText(page, /Inspektion und Bremsen prüfen/)).toBeVisible();

    // Der Entwurf ist nach dem Anlegen verbraucht
    await page.goto('/werkstatt/auftraege/neu');
    await expect(byTestId(page, 'werkstatt-auftrag-neu')).toBeVisible();
    await expect(page.getByTestId('entwurf-wiederhergestellt').filter({ visible: true })).toHaveCount(0);
  });
});

test.describe('Werkstatt: Fahrzeugannahme', () => {
  test('Vor Ort: km erfassen, speichern und bestätigen lassen', async ({ page }) => {
    await loginAs(page, 'service', `/werkstatt/auftraege/${IDS.workOrders.golfService}/annahme`);
    await expect(byTestId(page, 'werkstatt-annahme')).toBeVisible();
    await byTestId(page, 'annahme-km').fill('64210');
    await byTestId(page, 'annahme-speichern').click();
    await expect(byTestId(page, 'annahme-vor-ort')).toBeEnabled();
    await byTestId(page, 'annahme-vor-ort').click();
    await expect(byTestId(page, 'annahme-bestaetigen-dialog')).toBeVisible();
    await byTestId(page, 'annahme-bestaetigen-dialog-bestaetigen').click();
    await expect(byTestId(page, 'annahme-bestaetigt')).toBeVisible();
  });

  test('In der Kunden-App: Kundin bestätigt die Annahme', async ({ page }) => {
    await loginAs(page, 'customer', `/kunde/auftraege/${IDS.workOrders.golfService}/annahme`);
    await expect(byTestId(page, 'annahme-status')).toContainText('Noch nicht bestätigt');
    await byTestId(page, 'annahme-bestaetigen').click();
    await byTestId(page, 'annahme-dialog-bestaetigen').click();
    await expect(byTestId(page, 'annahme-status')).toContainText('Bestätigt am');

    // Die Werkstatt sieht die Bestätigung
    await switchTo(page, 'service', `/werkstatt/auftraege/${IDS.workOrders.golfService}/annahme`);
    await expect(byTestId(page, 'annahme-bestaetigt')).toBeVisible();
  });
});

test.describe('Werkstatt: Rechnung und Zahlung', () => {
  test('Rechnung anlegen, stellen und Teilzahlung manuell erfassen (mit Recht)', async ({ page }) => {
    await loginAs(page, 'service', `/werkstatt/auftraege/${IDS.workOrders.corsaAc}/rechnung`);
    await byTestId(page, 'rechnung-anlegen').click();
    await expect(byTestId(page, 'rechnung-anlegen-blatt')).toBeVisible();
    await byTestId(page, 'rechnung-betrag').fill('250,00');
    await byTestId(page, 'rechnung-entwurf-anlegen').click();
    await expect(byTestId(page, 'rechnung-entwurf')).toBeVisible();

    await byTestId(page, 'rechnung-stellen').click();
    await byTestId(page, 'rechnungsnummer').fill('R-2026-0450');
    await byTestId(page, 'stellen-dialog-bestaetigen').click();
    await expect(byTestId(page, 'rechnung-R-2026-0450')).toBeVisible();
    await expect(byTestId(page, 'rechnung-zahlstatus')).toContainText('Offen');

    await byTestId(page, 'zahlung-erfassen').click();
    await byTestId(page, 'zahlung-betrag').fill('100,00');
    await byTestId(page, 'zahlung-referenz').fill('Kasse Beleg 17 [TEST]');
    await byTestId(page, 'zahlung-weiter').click();
    await byTestId(page, 'zahlung-dialog-bestaetigen').click();
    await expect(byTestId(page, 'rechnung-zahlstatus')).toContainText('Teilweise bezahlt');
  });

  test('Ohne Recht: keine manuelle Zahlung und kein Stellen', async ({ page }) => {
    await loginAs(page, 'service2', `/werkstatt/auftraege/${IDS.workOrders.transit}/rechnung`);
    await expect(byTestId(page, 'kein-zahlungsrecht')).toBeVisible();
    await expect(page.getByTestId('zahlung-erfassen').filter({ visible: true })).toHaveCount(0);
    await expect(page.getByTestId('rechnung-stellen').filter({ visible: true })).toHaveCount(0);
  });
});

test.describe('Werkstatt: Halterwechsel', () => {
  test('Neuer Halter mit Hinweis auf Datentrennung; alter Halter wird früherer Halter', async ({ page }) => {
    await loginAs(page, 'service', `/werkstatt/fahrzeuge/${IDS.vehicles.corsa}?register=halter`);
    await byTestId(page, 'halterwechsel').click();
    await expect(byTestId(page, 'halterwechsel-blatt')).toBeVisible();
    await expect(byTestId(page, 'datentrennung-hinweis')).toBeVisible();
    await byTestId(page, 'neuer-halter-K-10245').click();
    await byTestId(page, 'halterwechsel-weiter').click();
    await byTestId(page, 'halterwechsel-dialog-bestaetigen').click();
    await expect(visibleText(page, 'Halter: Horst Wegener, Beispieldaten')).toBeVisible();
    await expect(page.getByText('Früherer Halter').filter({ visible: true }).first()).toBeVisible();
  });
});

test.describe('Werkstatt: Kalender', () => {
  test('Doppelbelegung der Hebebühne: Speichern nur mit Begründung', async ({ page }) => {
    await loginAs(page, 'service', '/werkstatt/kalender');
    // heute 10:00 Uhr Ortszeit des Browsers (Europe/Berlin); Hebebühne 2 ist von 07:30 bis 12:00 belegt
    const start = await page.evaluate(() => {
      const d = new Date();
      d.setHours(10, 0, 0, 0);
      return d.toISOString();
    });
    await page.goto(`/werkstatt/termine/neu?start=${encodeURIComponent(start)}&buehne=${IDS.resources.lift2}`);
    await byTestId(page, 'termin-kunde-K-10231').click();
    await byTestId(page, 'termin-fahrzeug').click();
    await page.getByRole('radio', { name: /Volkswagen Golf/ }).filter({ visible: true }).first().click();
    await expect(byTestId(page, 'termin-konflikte')).toContainText('Hebebühne doppelt belegt', { timeout: 15_000 });

    await byTestId(page, 'termin-speichern').click();
    await expect(visibleText(page, 'Es gibt Konflikte. Speichern nur mit Begründung.')).toBeVisible();
    await byTestId(page, 'konflikt-begruendung').fill('Kurzer Reifendruck-Check, Bühne 2 ab 10 Uhr kurz frei [TEST]');
    await byTestId(page, 'termin-speichern').click();
    await expect(page).toHaveURL(/\/werkstatt\/termine\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(byTestId(page, 'termin-konflikte')).toContainText('Hebebühne doppelt belegt');
  });

  test('Tagesansicht markiert die Doppelbelegung', async ({ page }) => {
    await loginAs(page, 'service', '/werkstatt/kalender');
    const block = byTestId(page, `termin-${IDS.appointments.sprinterToday}`);
    await expect(block).toBeVisible({ timeout: 15_000 });
    if (isPhone(page)) await expect(block).toContainText('Hebebühne doppelt belegt');
    else await expect(block).toHaveAttribute('aria-label', /Konflikt: .*Hebebühne doppelt belegt/);
  });
});
