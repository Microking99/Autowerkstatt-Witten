/**
 * Hilfen für die E2E-Tests gegen den Demo-Export. Alle Daten sind Beispieldaten
 * (src/data/demo/seed.ts); jeder Test startet mit frischem Browserkontext und damit mit
 * frischen Beispieldaten.
 */
import { expect, type Locator, type Page } from '@playwright/test';

const id = (group: number, n: number) => `${group.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString().padStart(12, '0')}`;

export const IDS = {
  vehicles: { golf: id(3, 1), octavia: id(3, 2), corsa: id(3, 6) },
  workOrders: { octaviaInspection: id(10, 1), octaviaTimingBelt: id(10, 2), golfAc: id(10, 4), rohde2025: id(10, 8) },
  approvals: { timingBeltOffer: id(16, 1), brakes: id(16, 2), wipers: id(16, 3) },
  appointments: { golfCheck: id(8, 1), octaviaTimingBelt: id(8, 2) },
  invoices: { golfAc: id(22, 3), golfWheels: id(22, 4), rohde2025: id(22, 6), transit: id(22, 9) },
};

export const TOKENS = {
  qrGolf: 'qr-golf-M4k8Tz2Wp7',
  qrOctavia: 'qr-octavia-R3n9Xb5Lq1',
  shareValid: 'fzg-golf-verkauf-8Kd3Rt6Wm1Qx',
  shareExpired: 'fzg-abgelaufen-4Pn7Vc2Ls9Hj',
  shareRevoked: 'fzg-widerrufen-6Yb1Gt8Mz3Kd',
  invitationValid: 'einladung-brinkhoff-7Qm2Xr9Kd4Lp',
  invitationExpired: 'einladung-abgelaufen-3Hn8Vt2Wq6Zc',
};

/** Sichtbares Element (der Stack hält frühere Ansichten verborgen im DOM). */
export function byTestId(page: Page, testId: string): Locator {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

export function visibleText(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).filter({ visible: true }).first();
}

export async function loginAs(page: Page, account: 'customer' | 'previousOwner' | 'owner' | 'service' | 'mechanic', next?: string) {
  await page.goto(next ? `/anmelden?weiter=${encodeURIComponent(next)}` : '/anmelden');
  await byTestId(page, `demo-zugang-${account}`).click();
  await expect(byTestId(page, 'anmeldung')).toBeHidden({ timeout: 15_000 });
}

/** Abmelden ohne Oberfläche (Sitzung im sessionStorage des Tabs entfernen). */
export async function logout(page: Page) {
  await page.evaluate(() => {
    sessionStorage.removeItem('werkstatt.sitzung');
    sessionStorage.removeItem('werkstatt.konto');
  });
}

export async function openDemoPanel(page: Page) {
  await byTestId(page, 'demo-steuerung-oeffnen').click();
  await expect(byTestId(page, 'demo-steuerung')).toBeVisible();
}

export async function closeSheet(page: Page) {
  await page.getByRole('button', { name: 'Schließen', exact: true }).filter({ visible: true }).last().click();
  await expect(page.getByTestId('demo-steuerung').filter({ visible: true })).toHaveCount(0);
}

/** Nächste Anfrage schlägt fehl (Verbindungsfehler), über die Demo-Steuerung. */
export async function failNextRequest(page: Page) {
  // Hintergrundabfragen (Aktualisierung nach dem Laden) abwarten, damit der simulierte
  // Fehler die nächste Aktion des Tests trifft.
  await page.waitForTimeout(1500);
  await openDemoPanel(page);
  await byTestId(page, 'demo-fehler').click();
  await closeSheet(page);
}

export async function demoAction(page: Page, testId: string) {
  await openDemoPanel(page);
  await byTestId(page, testId).click();
  await closeSheet(page);
}

export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 768;
}

/** Hauptnavigation: Telefon unten (Reiter bzw. "Mehr"), PC Kopfleiste. */
export async function nav(page: Page, key: 'start' | 'fahrzeuge' | 'auftraege' | 'nachrichten' | 'termine' | 'dokumente' | 'rechnungen' | 'konto') {
  if (isPhone(page)) {
    if (['termine', 'dokumente', 'rechnungen', 'konto'].includes(key)) {
      await byTestId(page, 'reiter-mehr').click();
      await byTestId(page, `mehr-${key}`).click();
    } else {
      await byTestId(page, `reiter-${key}`).click();
    }
  } else {
    await byTestId(page, `nav-${key}`).click();
  }
}
