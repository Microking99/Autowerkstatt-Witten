/**
 * Abläufe über die Oberfläche gegen die echte API (frische Testdatenbank, [TEST]-Daten).
 * Reihenfolge ist fest (serial): jeder Schritt baut auf dem vorherigen auf.
 *
 *   1. Kundin gibt die gesendete Zusatzarbeit frei (Version mit Prüfsumme), Werkstatt sieht es
 *   2. Andere Kundin sieht weder Auftrag noch Rechnung (404 → "nicht verfügbar")
 *   3. Zahlung: "Jetzt bezahlen" ändert nichts; erst die Anbieterbestätigung (Webhook + Abfrage
 *      beim Anbieter) setzt "Bezahlt"; Werkstatt sieht genau eine Online-Zahlung
 *   4. Mechaniker führt beide Positionen aus (Wartung nur mit km-Stand) und erfasst ein Teil,
 *      Service sieht das Teil in der Werkstattansicht und prüft den Abschluss, Servicehistorie
 *      der Kundin enthält genau einen Eintrag mit diesem km-Stand (Teile sieht sie nicht)
 *   5. QR-Code ohne Anmeldung zeigt keine Kundendaten; fremde Kundin kommt nicht an die Akte
 *   6. Mechaniker ohne Zuweisung sieht den fremden Auftrag nicht
 */
import { expect, test, type Page } from '@playwright/test';
import { byTestId, fixture, login, providerConfirmsLatestCheckout, switchTo, visibleText, watch } from './helpers';

test.describe.configure({ mode: 'serial' });

const KM = '61234';
const PART = 'Ölfilter [TEST]';

async function expectNotAvailable(page: Page) {
  await expect(byTestId(page, 'nicht-verfuegbar')).toBeVisible();
}

test('1. Kundin gibt die Zusatzarbeit frei, Werkstatt sieht die Entscheidung', async ({ page }) => {
  const f = fixture();
  const w = watch(page);
  await login(page, 'customer', `/kunde/auftraege/${f.workOrderId}`);
  await byTestId(page, `zur-freigabe-${f.approvalId}`).click();
  await expect(byTestId(page, 'freigabe-status')).toContainText('Wartet auf Ihre Entscheidung');
  await expect(visibleText(page, /Prüfsumme [0-9a-f]{8}/)).toBeVisible();
  await byTestId(page, 'freigeben').click();
  await expect(page.getByRole('alertdialog', { name: /189,90.*freigeben\?/ })).toBeVisible();
  await byTestId(page, 'freigeben-dialog-bestaetigen').click();
  await expect(visibleText(page, 'Freigabe erteilt')).toBeVisible();
  // Neu geladen: Entscheidung kommt vom Server, nicht aus dem Zustand der Oberfläche
  await page.reload();
  await expect(byTestId(page, 'freigabe-status')).toContainText(/Freigegeben/);
  await expect(page.getByTestId('freigeben').filter({ visible: true })).toHaveCount(0);

  await switchTo(page, 'service', `/werkstatt/auftraege/${f.workOrderId}/freigaben/${f.approvalId}`);
  await expect(byTestId(page, 'anfrage-status')).toContainText(/Freigegeben/);
  w.expectClean('Freigabe');
});

test('2. Andere Kundin: fremder Auftrag, fremde Freigabe und fremde Rechnung nicht verfügbar', async ({ page }) => {
  const f = fixture();
  const w = watch(page);
  await login(page, 'foreignCustomer');
  for (const url of [`/kunde/auftraege/${f.workOrderId}`, `/kunde/auftraege/${f.workOrderId}/freigaben/${f.approvalId}`, `/kunde/rechnungen/${f.invoiceId}`, `/kunde/fahrzeuge/${f.vehicles.golf}`]) {
    await page.goto(url);
    await expectNotAvailable(page);
    await expect(page.getByText(/Anna Beispiel|Bremsbeläge|R-E2E-0001/).filter({ visible: true })).toHaveCount(0);
  }
  // Eigene Liste enthält nur den eigenen Auftrag
  await page.goto('/kunde/auftraege');
  await expect(visibleText(page, /Fremder Auftrag/)).toBeVisible();
  await expect(page.getByText(/Inspektion mit Ölwechsel/).filter({ visible: true })).toHaveCount(0);
  w.expectClean('Fremdzugriff');
});

test('3. Zahlung: offen bis zur geprüften Anbieterbestätigung, dann genau einmal bezahlt', async ({ page, context }) => {
  const f = fixture();
  const w = watch(page);
  await login(page, 'customer', `/kunde/rechnungen/${f.invoiceId}`);
  await expect(byTestId(page, 'rechnung-status')).toContainText('Offen');
  await expect(byTestId(page, 'rechnung-offen')).toContainText('129,90');

  // "Jetzt bezahlen" öffnet die Anbieterseite in neuem Fenster (Test-Anbieter: Adresse .invalid,
  // hier durch eine leere Seite ersetzt; es wird nichts bezahlt)
  await context.route('https://checkout.fake-provider.invalid/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Anbieterseite [TEST]</p>' }));
  const popupPromise = context.waitForEvent('page');
  await byTestId(page, 'jetzt-bezahlen').click();
  await expect(page.getByRole('alertdialog', { name: /Zahlung über 129,90.*starten\?/ })).toBeVisible();
  await byTestId(page, 'bezahlen-dialog-bestaetigen').click();
  const popup = await popupPromise;
  expect(popup.url()).toContain('checkout.fake-provider.invalid');
  await popup.close();

  // Rückkehr ohne Bestätigung: Rechnung bleibt offen
  await expect(page).toHaveURL(/\/zahlung\/rueckkehr/);
  await expect(byTestId(page, 'zahlung-wird-geprueft')).toBeVisible();
  await page.goto(`/kunde/rechnungen/${f.invoiceId}`);
  await expect(byTestId(page, 'rechnung-status')).toContainText('Offen');

  // Anbieter bestätigt (Webhook; die API fragt den Status selbst beim Anbieter ab)
  const confirmed = await providerConfirmsLatestCheckout();
  expect(confirmed.webhookStatus).toBeLessThan(300);
  await page.goto(`/zahlung/rueckkehr?rechnung=${f.invoiceId}`);
  await expect(byTestId(page, 'zahlung-bestaetigt')).toBeVisible({ timeout: 20_000 });
  await page.goto(`/kunde/rechnungen/${f.invoiceId}`);
  await expect(byTestId(page, 'rechnung-status')).toContainText('Bezahlt');
  await expect(page.getByTestId('jetzt-bezahlen').filter({ visible: true })).toHaveCount(0);

  // Doppelt gemeldete Bestätigung bucht nicht doppelt
  const again = await fetch(`${f.apiUrl}/api/v1/webhooks/sumup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_type: 'CHECKOUT_STATUS_CHANGED', id: confirmed.checkoutId }),
  });
  expect(again.status).toBeLessThan(300);

  await switchTo(page, 'service', `/werkstatt/rechnungen/${f.invoiceId}`);
  await expect(byTestId(page, 'rechnung-zahlstatus')).toContainText('Bezahlt');
  await expect(page.getByText(/vom Anbieter bestätigt/).filter({ visible: true })).toHaveCount(1);
  w.expectClean('Zahlung');
});

test('4. Mechaniker führt aus, Service prüft den Abschluss, Servicehistorie genau einmal', async ({ page }) => {
  const f = fixture();
  const w = watch(page);
  await login(page, 'mechanic', `/mechaniker/auftraege/${f.workOrderId}`);
  await expect(byTestId(page, 'mechaniker-auftrag')).toBeVisible();
  // Preise sind für Mechaniker nicht sichtbar
  await expect(page.getByText(/€/).filter({ visible: true })).toHaveCount(0);

  // Wartungsposition: nur mit km-Stand abschließbar
  await page.goto(`/mechaniker/auftraege/${f.workOrderId}/positionen/${f.oilItemId}`);
  await byTestId(page, 'position-starten').click();
  await expect(byTestId(page, 'position-status')).toContainText('In Arbeit');
  // Laufende Zeit kommt vom Server (runningSince), nicht aus einem Zähler auf dem Gerät
  await expect(byTestId(page, 'position-zeit-hinweis')).toContainText('Läuft seit');
  await expect(page.getByTestId(/^(nicht-synchronisiert|wird-uebertragen)$/).filter({ visible: true })).toHaveCount(0, { timeout: 15_000 });

  // Verbautes Teil erfassen (ohne Preis); die Liste kommt nach dem Neuladen vom Server
  await byTestId(page, 'teil-erfassen').click();
  await byTestId(page, 'teil-bezeichnung').fill(PART);
  await byTestId(page, 'teil-nummer').fill('OF-E2E-1');
  await byTestId(page, 'teil-speichern').click();
  await expect(page.getByTestId('teil').filter({ visible: true }).filter({ hasText: PART })).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('teil').filter({ visible: true }).filter({ hasText: `1 × ${PART} (OF-E2E-1)` })).toHaveCount(1);
  await expect(byTestId(page, 'position-zeit-hinweis')).toContainText('Läuft seit');
  await expect(page.getByText(/€/).filter({ visible: true })).toHaveCount(0);

  await byTestId(page, 'position-abschliessen').click();
  await expect(byTestId(page, 'abschluss-blatt')).toBeVisible();
  await byTestId(page, 'abschluss-bestaetigen').click();
  await expect(visibleText(page, 'km-Stand eintragen oder "km-Stand unbekannt" wählen.')).toBeVisible();
  await byTestId(page, 'abschluss-km').fill(KM);
  await byTestId(page, 'abschluss-bestaetigen').click();
  await expect(byTestId(page, 'position-status')).toContainText('Erledigt');

  // Freigegebene Zusatzarbeit (Schritt 1) ist jetzt startbar
  await page.goto(`/mechaniker/auftraege/${f.workOrderId}`);
  await page.getByText('Bremsbeläge vorne erneuern').filter({ visible: true }).first().click();
  await expect(page.getByTestId('position-gesperrt').filter({ visible: true })).toHaveCount(0);
  await byTestId(page, 'position-starten').click();
  await expect(byTestId(page, 'position-status')).toContainText('In Arbeit');
  await byTestId(page, 'position-abschliessen').click();
  await expect(byTestId(page, 'abschluss-blatt')).toBeVisible();
  await byTestId(page, 'abschluss-bestaetigen').click();
  await expect(byTestId(page, 'position-status')).toContainText('Erledigt');

  // Service sieht das vom Mechaniker erfasste Teil in der Werkstattansicht (ohne Preis erfasst)
  await switchTo(page, 'service', `/werkstatt/auftraege/${f.workOrderId}/arbeiten`);
  const parts = page.getByTestId(/^teile-position-/).filter({ visible: true }).filter({ hasText: PART });
  await expect(parts).toHaveCount(1);
  await expect(parts).toContainText('OF-E2E-1');
  await expect(parts).toContainText('ohne Preis');

  // Service: fachlicher Abschluss erzeugt den Serviceeintrag (nur für die Wartungsposition)
  await page.goto(`/werkstatt/auftraege/${f.workOrderId}`);
  await byTestId(page, 'abschluss-pruefen').click();
  await expect(byTestId(page, 'abschluss-dialog')).toContainText('1 Serviceeintrag');
  await byTestId(page, 'abschluss-dialog-bestaetigen').click();
  await expect(page.getByTestId('abschluss-pruefen').filter({ visible: true })).toHaveCount(0);
  await expect(byTestId(page, 'abholbereit-melden')).toBeVisible();

  await page.goto(`/werkstatt/fahrzeuge/${f.vehicles.golf}?register=servicehistorie`);
  const entries = page.getByTestId(/^serviceeintrag-/).filter({ visible: true });
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText('61.234 km');

  // Kundin sieht genau diesen Eintrag, keine Bremsen (keine Wartungsart)
  await switchTo(page, 'customer', `/kunde/fahrzeuge/${f.vehicles.golf}/servicehistorie`);
  await expect(visibleText(page, /Ölwechsel/)).toBeVisible();
  await expect(visibleText(page, /61\.234\skm/)).toBeVisible();
  await expect(page.getByText(/Brems/).filter({ visible: true })).toHaveCount(0);
  // Verbaute Teile sind Werkstattinterna: nicht in der Kundenansicht des Auftrags
  await page.goto(`/kunde/auftraege/${f.workOrderId}`);
  await expect(visibleText(page, /Ölwechsel/)).toBeVisible();
  await expect(page.getByText(new RegExp(PART.replace(/[[\]]/g, '\\$&'))).filter({ visible: true })).toHaveCount(0);
  w.expectClean('Abschluss');
});

test('5. QR-Code: ohne Anmeldung keine Kundendaten, fremde Kundin ohne Zugriff', async ({ page }) => {
  const f = fixture();
  const w = watch(page);
  await page.goto(`/q/${f.qrTokenGolf}`);
  await expect(page.getByTestId(/^qr-(kurzansicht|anmeldung-noetig)$/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/Anna|Beispiel|kundin\.e2e|Ölwechsel|61\.234/).filter({ visible: true })).toHaveCount(0);

  await login(page, 'foreignCustomer', `/q/${f.qrTokenGolf}`);
  await expect(page.getByText(/Anna Beispiel|61\.234\skm/).filter({ visible: true })).toHaveCount(0);
  await page.goto(`/kunde/fahrzeuge/${f.vehicles.golf}/servicehistorie`);
  await expectNotAvailable(page);
  w.expectClean('QR');
});

test('6. Mechaniker ohne Zuweisung sieht den fremden Auftrag nicht', async ({ page }) => {
  const f = fixture();
  const w = watch(page);
  await login(page, 'mechanic', `/mechaniker/auftraege/${f.foreignWorkOrderId}`);
  await expectNotAvailable(page);
  await expect(page.getByText(/Fremder Auftrag/).filter({ visible: true })).toHaveCount(0);
  w.expectClean('Mechaniker fremd');
});
