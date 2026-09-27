/**
 * Mechaniker und Werkstatt zusammen (APP-2), mit Rollenwechsel im selben Browser:
 * - Feststellung → Service erstellt Freigabeanfrage mit Vorschau → Kundin entscheidet →
 *   Mechaniker kann nur die freigegebene Position ausführen (andere bleibt gesperrt).
 * - Mechaniker schließt Wartungspositionen mit km-Stand ab → Service prüft den Abschluss →
 *   Serviceeinträge entstehen genau einmal.
 * - Offline erfasste Feststellung: "Nicht synchronisiert", nach Verbindung übertragen.
 */
import { expect, test, type Page } from '@playwright/test';
import { IDS, byTestId, closeSheet, isPhone, loginAs, openDemoPanel, switchTo, visibleText } from './helpers';

const octavia = IDS.workOrders.octaviaInspection;
const yaris = IDS.workOrders.yaris;

function positionRow(page: Page, title: string | RegExp) {
  return page.getByTestId(/^position-\d+$/).filter({ visible: true }).filter({ hasText: title }).first();
}

/** Warten, bis nichts mehr in der Warteschlange des Geräts steht (sonst bricht der Seitenwechsel die Übertragung ab). */
async function expectSynced(page: Page) {
  await expect(page.getByTestId(/^(nicht-synchronisiert|wird-uebertragen)$/).filter({ visible: true })).toHaveCount(0, { timeout: 15_000 });
}

async function toggleOffline(page: Page) {
  await openDemoPanel(page);
  await byTestId(page, 'demo-offline').click();
  await closeSheet(page);
}

test.describe('Mechaniker: Feststellung bis zur ausführbaren Position', () => {
  test('Feststellung → Freigabeanfrage mit Vorschau → Kundin gibt frei → nur freigegebene Position startbar', async ({ page }) => {
    // Mechaniker meldet eine Feststellung (ohne Freigabeknopf)
    await loginAs(page, 'mechanic', `/mechaniker/auftraege/${octavia}`);
    await byTestId(page, 'feststellung-erfassen').click();
    await expect(byTestId(page, 'mechaniker-feststellung')).toBeVisible();
    await expect(page.getByRole('button', { name: /freigeben/i }).filter({ visible: true })).toHaveCount(0);
    await byTestId(page, 'feststellung-text').fill('Keilrippenriemen rissig [TEST]');
    await byTestId(page, 'dringlichkeit-urgent').click();
    await byTestId(page, 'an-service-melden').click();
    await expect(byTestId(page, 'mechaniker-auftrag')).toBeVisible();
    await expectSynced(page);

    // Service: Anfrage aus der Feststellung, Preise ergänzen, Vorschau wie beim Kunden, senden
    await switchTo(page, 'service', `/werkstatt/auftraege/${octavia}/arbeiten`);
    const finding = page.getByTestId(/^feststellung-/).filter({ visible: true }).filter({ hasText: 'Keilrippenriemen rissig' }).first();
    await expect(finding).toBeVisible();
    await finding.getByTestId('aus-feststellung-anfrage').click();
    await expect(byTestId(page, 'anfrage-titel')).toHaveValue(/Keilrippenriemen rissig/);
    await byTestId(page, 'zeile-0-titel').fill('Keilrippenriemen erneuern');
    await byTestId(page, 'zeile-0-preis').fill('48,00');
    await byTestId(page, 'zeile-1-preis').fill('45,00');
    await page.getByRole('radio', { name: 'Vorschau wie beim Kunden' }).filter({ visible: true }).first().click();
    await expect(byTestId(page, 'vorschau-kunde')).toContainText('Keilrippenriemen erneuern');
    await byTestId(page, 'anfrage-senden').click();
    await byTestId(page, 'senden-dialog-bestaetigen').click();
    await expect(page).toHaveURL(/\/freigaben\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const approvalId = /\/freigaben\/([0-9a-f-]{36})$/.exec(page.url())![1];
    await expect(byTestId(page, 'anfrage-status')).toContainText('Wartet auf Kunde');

    // Mechaniker: neue Position ist bis zur Entscheidung gesperrt
    await switchTo(page, 'mechanic', `/mechaniker/auftraege/${octavia}`);
    await positionRow(page, 'Keilrippenriemen erneuern').click();
    await expect(byTestId(page, 'position-gesperrt')).toBeVisible();
    await expect(page.getByTestId('position-starten').filter({ visible: true })).toHaveCount(0);

    // Kundin gibt frei
    await switchTo(page, 'customer', `/kunde/auftraege/${octavia}/freigaben/${approvalId}`);
    await byTestId(page, 'freigeben').click();
    await byTestId(page, 'freigeben-dialog-bestaetigen').click();
    await expect(visibleText(page, 'Freigabe erteilt')).toBeVisible();

    // Mechaniker: freigegebene Position startbar, noch offene Bremsenanfrage weiter gesperrt
    await switchTo(page, 'mechanic', `/mechaniker/auftraege/${octavia}`);
    await positionRow(page, 'Keilrippenriemen erneuern').click();
    await expect(byTestId(page, 'position-starten')).toBeVisible();
    await byTestId(page, 'position-starten').click();
    await expect(byTestId(page, 'position-status')).toContainText('In Arbeit');
    await expectSynced(page);
    await page.goto(`/mechaniker/auftraege/${octavia}`);
    await positionRow(page, /Bremsscheiben/).click();
    await expect(byTestId(page, 'position-gesperrt')).toBeVisible();
    await expect(page.getByTestId('position-starten').filter({ visible: true })).toHaveCount(0);
  });
});

test.describe('Mechaniker: Wartung abschließen und fachlicher Abschluss', () => {
  test('km-Stand beim Abschluss, Abschlussprüfung erzeugt Serviceeinträge genau einmal', async ({ page }) => {
    await loginAs(page, 'mechanic', `/mechaniker/auftraege/${yaris}`);
    for (const title of [/Inspektion mit Hybrid/, /Bremsflüssigkeit/]) {
      await page.goto(`/mechaniker/auftraege/${yaris}`);
      await positionRow(page, title).click();
      await byTestId(page, 'position-starten').click();
      await expect(byTestId(page, 'position-status')).toContainText('In Arbeit');
      await byTestId(page, 'position-abschliessen').click();
      await expect(byTestId(page, 'abschluss-blatt')).toBeVisible();
      // ohne km-Stand kein Abschluss einer Wartungsposition
      await byTestId(page, 'abschluss-bestaetigen').click();
      await expect(visibleText(page, 'km-Stand eintragen oder "km-Stand unbekannt" wählen.')).toBeVisible();
      await byTestId(page, 'abschluss-km').fill('58950');
      await byTestId(page, 'abschluss-bestaetigen').click();
      await expect(byTestId(page, 'position-status')).toContainText('Erledigt');
      await expectSynced(page);
    }

    // Service prüft den Abschluss
    await switchTo(page, 'service', `/werkstatt/auftraege/${yaris}`);
    await byTestId(page, 'abschluss-pruefen').click();
    await expect(byTestId(page, 'abschluss-dialog')).toContainText('2 Serviceeinträge');
    await byTestId(page, 'abschluss-dialog-bestaetigen').click();
    await expect(page.getByTestId('abschluss-pruefen').filter({ visible: true })).toHaveCount(0);
    await expect(byTestId(page, 'abholbereit-melden')).toBeVisible();

    // Servicehistorie: je Wartungsposition genau ein neuer Eintrag mit dem km-Stand
    await page.goto(`/werkstatt/fahrzeuge/${IDS.vehicles.yaris}?register=servicehistorie`);
    const entries = page.getByTestId(/^serviceeintrag-/).filter({ visible: true });
    await expect(entries.filter({ hasText: '58.950 km' })).toHaveCount(2);
    await page.reload();
    await expect(page.getByTestId(/^serviceeintrag-/).filter({ visible: true }).filter({ hasText: '58.950 km' })).toHaveCount(2);
  });
});

test.describe('Mechaniker: offline', () => {
  test('Feststellung offline → "Nicht synchronisiert" → wieder online → übertragen', async ({ page }) => {
    await loginAs(page, 'mechanic', `/mechaniker/auftraege/${octavia}`);
    await expect(byTestId(page, 'mechaniker-auftrag')).toBeVisible();
    await page.waitForTimeout(1000);
    await toggleOffline(page);

    await byTestId(page, 'feststellung-erfassen').click();
    await byTestId(page, 'feststellung-text').fill('Scheibenwischer vorne schmiert [TEST]');
    await byTestId(page, 'an-service-melden').click();
    await expect(byTestId(page, 'mechaniker-auftrag')).toBeVisible();
    await expect(byTestId(page, 'feststellung-offline')).toContainText('Scheibenwischer vorne schmiert');
    await expect(byTestId(page, 'nicht-synchronisiert')).toBeVisible();

    // Synchronisierung in der App öffnen (ohne Neuladen, die Demo bleibt offline)
    await byTestId(page, 'reiter-sync').click();
    await expect(byTestId(page, 'mechaniker-sync')).toBeVisible();
    await expect(byTestId(page, 'sync-status')).not.toContainText('Alles übertragen');
    await expect(byTestId(page, 'wartend-0')).toBeVisible();

    // Wieder online: die Warteschlange überträgt von selbst
    await toggleOffline(page);
    await expect(byTestId(page, 'sync-status')).toContainText('Alles übertragen', { timeout: 30_000 });

    await switchTo(page, 'service', `/werkstatt/auftraege/${octavia}/arbeiten`);
    await expect(page.getByTestId(/^feststellung-/).filter({ visible: true }).filter({ hasText: 'Scheibenwischer vorne schmiert' })).toHaveCount(1);
  });
});
