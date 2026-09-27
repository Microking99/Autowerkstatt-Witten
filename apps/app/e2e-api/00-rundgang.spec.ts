/**
 * Rundgang: jede Ansicht je Rolle einmal gegen die echte API öffnen. Schlägt fehl bei
 * Vertragsabweichungen (Antwort passt nicht zu packages/contracts), Serverfehlern (5xx),
 * Seitenfehlern oder einem Fehlerzustand in einer Ansicht, die für die Rolle erlaubt ist.
 * Nur lesend; ändert keine Daten.
 */
import { expect, test } from '@playwright/test';
import { byTestId, fixture, login, openView, watch, type Role } from './helpers';

function views(role: Role): string[] {
  const f = fixture();
  const wo = f.workOrderId;
  switch (role) {
    case 'customer':
      return [
        '/kunde',
        '/kunde/auftraege',
        `/kunde/auftraege/${wo}`,
        `/kunde/auftraege/${wo}/chat`,
        `/kunde/auftraege/${wo}/freigaben/${f.approvalId}`,
        '/kunde/fahrzeuge',
        `/kunde/fahrzeuge/${f.vehicles.golf}`,
        `/kunde/fahrzeuge/${f.vehicles.golf}/servicehistorie`,
        `/kunde/fahrzeuge/${f.vehicles.golf}/teilen`,
        '/kunde/rechnungen',
        `/kunde/rechnungen/${f.invoiceId}`,
        '/kunde/dokumente',
        '/kunde/nachrichten',
        '/kunde/termine',
        '/kunde/termine/anfragen',
        '/kunde/konto',
        '/kunde/konto/datenexport',
      ];
    case 'mechanic':
      return ['/mechaniker', `/mechaniker/auftraege/${wo}`, `/mechaniker/auftraege/${wo}/positionen/${f.oilItemId}`, `/mechaniker/auftraege/${wo}/feststellung`, '/mechaniker/sync', '/mechaniker/konto'];
    case 'service':
    case 'admin':
      return [
        '/werkstatt',
        '/werkstatt/kalender',
        '/werkstatt/kalender/anfragen',
        '/werkstatt/termine/neu',
        '/werkstatt/kunden',
        `/werkstatt/kunden/${f.customerId}`,
        '/werkstatt/kunden/neu',
        '/werkstatt/fahrzeuge',
        `/werkstatt/fahrzeuge/${f.vehicles.golf}`,
        '/werkstatt/fahrzeuge/neu',
        '/werkstatt/auftraege',
        '/werkstatt/auftraege/neu',
        `/werkstatt/auftraege/${wo}`,
        `/werkstatt/auftraege/${wo}/annahme`,
        `/werkstatt/auftraege/${wo}/arbeiten`,
        `/werkstatt/auftraege/${wo}/fotos`,
        `/werkstatt/auftraege/${wo}/dokumente`,
        `/werkstatt/auftraege/${wo}/chat`,
        `/werkstatt/auftraege/${wo}/verlauf`,
        `/werkstatt/auftraege/${wo}/freigaben`,
        `/werkstatt/auftraege/${wo}/freigaben/neu`,
        `/werkstatt/auftraege/${wo}/freigaben/${f.approvalId}`,
        `/werkstatt/auftraege/${wo}/rechnung`,
        '/werkstatt/nachrichten',
        '/werkstatt/rechnungen',
        `/werkstatt/rechnungen/${f.invoiceId}`,
        '/werkstatt/wartungen',
        '/werkstatt/konto',
        ...(role === 'admin' ? ['/werkstatt/benutzer', '/werkstatt/einstellungen', '/werkstatt/protokoll'] : []),
      ];
    default:
      return [];
  }
}

for (const role of ['customer', 'mechanic', 'service', 'admin'] as const) {
  test(`Rundgang ${role}: alle Ansichten ohne Vertragsabweichung und Fehlerzustand`, async ({ page }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    await login(page, role);
    const failures: string[] = [];
    for (const url of views(role)) {
      const before = w.problems.length;
      await openView(page, url);
      // Kein Umleiten auf Anmeldung oder "nicht gefunden"
      if (await byTestId(page, 'anmeldung').isVisible().catch(() => false)) failures.push(`${url}: Anmeldung verlangt`);
      if (await page.getByTestId('fehlerzustand').filter({ visible: true }).count()) {
        const text = await byTestId(page, 'fehlerzustand').innerText();
        failures.push(`${url}: Fehlerzustand "${text.replace(/\s+/g, ' ').slice(0, 160)}"`);
      }
      for (const p of w.problems.slice(before)) failures.push(`${url}: ${p}`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
}
