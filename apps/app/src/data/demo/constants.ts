/**
 * Feste Werte des Demo-Modus. Alles hier ist öffentlich und gehört zu den Beispieldaten:
 * Es gibt kein echtes Konto und keinen echten Server dahinter.
 */

/** Kennwort aller Beispielzugänge (wird in der Anmeldung im Demo-Modus angezeigt). */
export const DEMO_PASSWORD = 'Beispiel2026';

export const DEMO_EMAILS = {
  owner: 'ralf.lindemann@autowerkstatt-witten.example',
  service: 'petra.wiesmann@autowerkstatt-witten.example',
  service2: 'nadine.kurz@autowerkstatt-witten.example',
  mechanic: 'emre.aydin@autowerkstatt-witten.example',
  mechanic2: 'lukas.brettschneider@autowerkstatt-witten.example',
  disabled: 'jonas.feldhaus@autowerkstatt-witten.example',
  customer: 'm.kowalczyk@kunden.example',
  previousOwner: 'g.rohde@kunden.example',
  business: 't.brinkhoff@brinkhoff-haustechnik.example',
} as const;

/** Links für die Klickwege (Einladung, Passwort, QR, Freigabe für Kaufinteressenten). */
export const DEMO_TOKENS = {
  invitationValid: 'einladung-brinkhoff-7Qm2Xr9Kd4Lp',
  invitationExpired: 'einladung-abgelaufen-3Hn8Vt2Wq6Zc',
  invitationUsed: 'einladung-benutzt-9Rb4Ks7Mf2Yd',
  resetValid: 'neues-passwort-kowalczyk-5Tg8Wp3Nv',
  resetExpired: 'neues-passwort-abgelaufen-2Lx7Qh9Bz',
  qrGolf: 'qr-golf-M4k8Tz2Wp7',
  qrOctavia: 'qr-octavia-R3n9Xb5Lq1',
  qrTransit: 'qr-transit-B7v2Nc4Hs8',
  qrSprinter: 'qr-sprinter-K1w6Ty3Dm9',
  qrYaris: 'qr-yaris-P5j9Rf2Gx4',
  qrCorsa: 'qr-corsa-T8q3Lz6Vn2',
  shareValid: 'fzg-golf-verkauf-8Kd3Rt6Wm1Qx',
  shareExpired: 'fzg-abgelaufen-4Pn7Vc2Ls9Hj',
  shareRevoked: 'fzg-widerrufen-6Yb1Gt8Mz3Kd',
} as const;

export const DEMO_MERCHANT_CODE = 'MDEMOWITTEN';

/** Basisadresse für Links, die im Demo-Modus erzeugt werden (Freigabelinks, Zahlungsseite). */
export const DEMO_PUBLIC_BASE = 'https://app.autowerkstatt-witten.example';
