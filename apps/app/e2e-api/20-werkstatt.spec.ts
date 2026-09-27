/**
 * Schreibende Werkstattabläufe über die Oberfläche gegen die echte API (HttpApi statt DemoApi).
 * Reihenfolge fest (serial); läuft nach 10-ablaeufe und legt eigene Daten an.
 *
 *   1. Auftrag mit neuem Kunden und neuem Fahrzeug im Assistenten anlegen
 *   2. Annahme vor Ort erfassen und bestätigen
 *   3. Freigabeanfrage erstellen und senden; Position im Auftrag wartet auf Freigabe
 *   4. Rechnung anlegen und stellen (Service); Teilzahlung manuell nur mit Recht (Inhaber)
 *   5. Chat an die Kundin kommt an, interne Notiz bleibt für sie unsichtbar
 */
import { expect, test, type Page } from '@playwright/test';
import { byTestId, fixture, login, switchTo, visibleText, watch } from './helpers';

test.describe.configure({ mode: 'serial' });

let orderPath = '';

async function orderIdFromUrl(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/werkstatt\/auftraege\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  return new URL(page.url()).pathname;
}

test('1. Auftrag mit neuem Kunden und neuem Fahrzeug anlegen', async ({ page }) => {
  const w = watch(page);
  await login(page, 'service', '/werkstatt/auftraege/neu');
  await expect(byTestId(page, 'werkstatt-auftrag-neu')).toBeVisible();

  await byTestId(page, 'neuer-kunde').click();
  await byTestId(page, 'kunde-vorname').fill('Jana');
  await byTestId(page, 'kunde-nachname').fill('Neukundin [TEST]');
  await byTestId(page, 'kunde-telefon').fill('02302 000 111');
  await byTestId(page, 'kunde-speichern').click();

  await expect(visibleText(page, /2\. Fahrzeug von Jana Neukundin/)).toBeVisible();
  await byTestId(page, 'neues-fahrzeug-leer').click();
  await byTestId(page, 'fahrzeug-kennzeichen').fill('EN-TE 842');
  await byTestId(page, 'fahrzeug-hersteller').fill('Opel');
  await byTestId(page, 'fahrzeug-modell').fill('Corsa [TEST]');
  await byTestId(page, 'fahrzeug-speichern').click();

  await expect(byTestId(page, 'auftrag-titel')).toBeVisible();
  await byTestId(page, 'auftrag-titel').fill('[TEST] Klimaservice');
  if ((await page.getByTestId('wizard-position-0-titel').filter({ visible: true }).count()) === 0) await byTestId(page, 'wizard-position').click();
  await byTestId(page, 'wizard-position-0-titel').fill('Klimaanlage warten');
  await byTestId(page, 'wizard-position-0-preis').fill('119,00');
  await byTestId(page, 'wizard-weiter').click();
  await expect(visibleText(page, 'Jana Neukundin [TEST]')).toBeVisible();
  await byTestId(page, 'wizard-anlegen').click();
  orderPath = await orderIdFromUrl(page);
  await expect(visibleText(page, /\[TEST\] Klimaservice/)).toBeVisible();

  // Vom Server neu geladen: Kunde, Fahrzeug und Position sind gespeichert
  await page.reload();
  await expect(visibleText(page, /Jana Neukundin/)).toBeVisible();
  await expect(visibleText(page, /EN.TE.842/)).toBeVisible();
  await expect(visibleText(page, 'Klimaanlage warten')).toBeVisible();
  w.expectClean('Auftrag anlegen');
});

test('2. Annahme vor Ort erfassen und bestätigen', async ({ page }) => {
  const w = watch(page);
  await login(page, 'service', `${orderPath}/annahme`);
  await expect(byTestId(page, 'werkstatt-annahme')).toBeVisible();
  await byTestId(page, 'annahme-km').fill('88100');
  await byTestId(page, 'annahme-beanstandung').fill('Klimaanlage kühlt kaum [TEST]');
  await byTestId(page, 'annahme-speichern').click();
  await expect(byTestId(page, 'annahme-vor-ort')).toBeEnabled();
  await byTestId(page, 'annahme-vor-ort').click();
  await expect(byTestId(page, 'annahme-bestaetigen-dialog')).toBeVisible();
  await byTestId(page, 'annahme-bestaetigen-dialog-bestaetigen').click();
  await expect(byTestId(page, 'annahme-bestaetigt')).toBeVisible();
  await page.reload();
  await expect(byTestId(page, 'annahme-bestaetigt')).toBeVisible();
  w.expectClean('Annahme');
});

test('3. Freigabeanfrage erstellen und senden', async ({ page }) => {
  const w = watch(page);
  await login(page, 'service', `${orderPath}/freigaben/neu`);
  await expect(byTestId(page, 'werkstatt-freigabe-neu')).toBeVisible();
  await byTestId(page, 'anfrage-titel').fill('[TEST] Klimakompressor undicht');
  await byTestId(page, 'zeile-0-titel').fill('Dichtsatz Kompressor erneuern');
  await byTestId(page, 'zeile-0-preis').fill('84,00');
  await expect(byTestId(page, 'anfrage-summen')).toContainText('99,96');
  // Leiste zeigt dieselbe Summe wie der Editor, auch solange die Beschreibung noch fehlt
  await expect(visibleText(page, /Gesamt 99,96\s€ brutto/)).toBeVisible();
  await byTestId(page, 'anfrage-beschreibung').fill('Der Kompressor verliert Kältemittel. Wir empfehlen, den Dichtsatz zu erneuern.');
  await byTestId(page, 'anfrage-senden').click();
  await expect(page.getByRole('alertdialog', { name: /99,96.*senden\?/ })).toBeVisible();
  await byTestId(page, 'senden-dialog-bestaetigen').click();
  await expect(byTestId(page, 'anfrage-status')).toContainText('Wartet auf Kunde');

  await page.goto(orderPath);
  await expect(visibleText(page, 'Dichtsatz Kompressor erneuern')).toBeVisible();
  await expect(visibleText(page, /Freigabe: Wartet auf Kunde/)).toBeVisible();
  w.expectClean('Freigabeanfrage');
});

test('4. Rechnung stellen (Service), Teilzahlung manuell nur mit Recht (Inhaber)', async ({ page }) => {
  const w = watch(page);
  await login(page, 'service', `${orderPath}/rechnung`);
  await byTestId(page, 'rechnung-anlegen').click();
  await expect(byTestId(page, 'rechnung-anlegen-blatt')).toBeVisible();
  await byTestId(page, 'rechnung-betrag').fill('141,61');
  await byTestId(page, 'rechnung-entwurf-anlegen').click();
  await expect(byTestId(page, 'rechnung-entwurf')).toBeVisible();

  await byTestId(page, 'rechnung-stellen').click();
  await byTestId(page, 'rechnungsnummer').fill('R-E2E-0002');
  await byTestId(page, 'stellen-dialog-bestaetigen').click();
  await expect(byTestId(page, 'rechnung-R-E2E-0002')).toBeVisible();
  await expect(byTestId(page, 'rechnung-zahlstatus')).toContainText('Offen');

  // Service hat "Zahlungen manuell zuordnen" nicht als Standardrecht (docs/rollen-und-rechte.md)
  await expect(byTestId(page, 'kein-zahlungsrecht')).toBeVisible();
  await expect(page.getByTestId('zahlung-erfassen').filter({ visible: true })).toHaveCount(0);

  // Inhaber erfasst die Barzahlung
  await switchTo(page, 'admin', `${orderPath}/rechnung`);
  await byTestId(page, 'zahlung-erfassen').click();
  await byTestId(page, 'zahlung-betrag').fill('100,00');
  await byTestId(page, 'zahlung-referenz').fill('Kasse Beleg 17 [TEST]');
  await byTestId(page, 'zahlung-weiter').click();
  await byTestId(page, 'zahlung-dialog-bestaetigen').click();
  await expect(byTestId(page, 'rechnung-zahlstatus')).toContainText('Teilweise bezahlt');
  await page.reload();
  await expect(byTestId(page, 'rechnung-zahlstatus')).toContainText('Teilweise bezahlt');
  await expect(visibleText(page, /erfasst von \[TEST\] Inhaber/)).toBeVisible();
  w.expectClean('Rechnung');
});

test('5. Chat erreicht die Kundin, interne Notiz nicht', async ({ page }) => {
  const f = fixture();
  const w = watch(page);
  await login(page, 'service', `/werkstatt/auftraege/${f.workOrderId}/chat`);
  await byTestId(page, 'chat-eingabe').fill('Ihr Golf ist fertig und kann abgeholt werden. [TEST]');
  await byTestId(page, 'chat-senden').click();
  await expect(visibleText(page, 'Ihr Golf ist fertig und kann abgeholt werden. [TEST]')).toBeVisible();
  await byTestId(page, 'notiz-eingabe').fill('Interne Notiz: Kundin zahlt bar [TEST]');
  await byTestId(page, 'notiz-speichern').click();
  await expect(visibleText(page, 'Interne Notiz: Kundin zahlt bar [TEST]')).toBeVisible();

  await switchTo(page, 'customer', `/kunde/auftraege/${f.workOrderId}/chat`);
  await expect(byTestId(page, 'chat-verlauf')).toContainText('Ihr Golf ist fertig und kann abgeholt werden.');
  await expect(page.getByText(/Interne Notiz/).filter({ visible: true })).toHaveCount(0);
  await byTestId(page, 'nachricht-eingabe').fill('Danke, ich komme um 17 Uhr. [TEST]');
  await byTestId(page, 'nachricht-senden').click();
  await expect(byTestId(page, 'chat-verlauf')).toContainText('Danke, ich komme um 17 Uhr.');

  await switchTo(page, 'service', `/werkstatt/auftraege/${f.workOrderId}/chat`);
  await expect(byTestId(page, 'kunden-chat')).toContainText('Danke, ich komme um 17 Uhr.');
  w.expectClean('Chat');
});
