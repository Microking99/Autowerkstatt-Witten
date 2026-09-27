import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../common/hash';
import { IDS, tid } from '../testing/fixtures';
import { hashToken, isShareActive, publicViewFromQr, publicViewFromShare, type PublicEntrySource, type PublicVehicleSource, type ShareState } from './shares';

const now = new Date('2026-09-26T10:00:00Z');
const vehicle: PublicVehicleSource = { id: IDS.vehicle1, make: 'Volkswagen', model: 'Golf', variant: 'VII', vin: 'WVWZZZ1KZAW000001', qrPublicViewEnabled: false };

function entry(n: number, over: Partial<PublicEntrySource> = {}): PublicEntrySource {
  return {
    id: tid(9500 + n),
    vehicleId: IDS.vehicle1,
    status: 'valid',
    revisionOfId: null,
    performedOn: `2026-0${n}-01`,
    odometerKm: 80_000 + n * 1000,
    title: `Wartung ${n}`,
    details: null,
    workshopName: 'Autowerkstatt Witten',
    nextDueDate: null,
    nextDueKm: null,
    maintenanceTypeName: '[TEST] Ölwechsel',
    revisionNo: 1,
    ...over,
  };
}

// Einträge mit zusätzlichen privaten Feldern, wie sie aus der Datenbank kommen könnten
const entries = [
  { ...entry(1), workOrderId: IDS.workOrderA, priceCents: 12_345, customerName: '[TEST] Kunde A' },
  entry(2, { status: 'superseded' }),
  entry(3, { revisionOfId: tid(9502), revisionNo: 2, title: 'Wartung 2 (korrigiert)' }),
  entry(4),
  entry(5, { status: 'voided' }),
  entry(6, { vehicleId: IDS.vehicle2 }),
] as PublicEntrySource[];

describe('Freigaben für Dritte', () => {
  const share: ShareState = { includeVin: false, serviceEntryIds: [tid(9501), tid(9502), tid(9505), tid(9506)], expiresAt: '2026-10-26T10:00:00Z', revokedAt: null };

  it('aktiv nur bis zum Ablauf und ohne Widerruf', () => {
    expect(isShareActive(share, now)).toBe(true);
    expect(isShareActive({ ...share, expiresAt: '2026-09-26T10:00:00Z' }, now)).toBe(false);
    expect(isShareActive({ ...share, revokedAt: '2026-09-20T10:00:00Z' }, now)).toBe(false);
  });

  it('zeigt nur ausgewählte, gültige Einträge dieses Fahrzeugs (korrigierte in ihrer gültigen Revision)', () => {
    const view = publicViewFromShare(vehicle, entries, share, { now, workshopName: 'Autowerkstatt Witten' });
    expect(view?.entries.map((e) => e.title)).toEqual(['Wartung 2 (korrigiert)', 'Wartung 1']);
    expect(view).toMatchObject({ make: 'Volkswagen', model: 'Golf', vin: null, source: 'share', expiresAt: '2026-10-26T10:00:00.000Z' });
  });

  it('enthält keine Preise, Kundendaten oder Auftrags-IDs; FIN nur mit includeVin', () => {
    const view = publicViewFromShare(vehicle, entries, share, { now, workshopName: 'Autowerkstatt Witten' });
    const json = JSON.stringify(view);
    expect(json).not.toContain(IDS.workOrderA);
    expect(json).not.toContain('12345');
    expect(json).not.toContain('Kunde A');
    expect(json).not.toContain('WVWZZZ1KZAW000001');
    expect(Object.keys(view!.entries[0]!).sort()).toEqual(
      ['details', 'maintenanceTypeName', 'nextDueDate', 'nextDueKm', 'odometerKm', 'performedOn', 'revisionNo', 'title', 'workshopName'].sort(),
    );
    const withVin = publicViewFromShare(vehicle, entries, { ...share, includeVin: true }, { now, workshopName: 'Autowerkstatt Witten' });
    expect(withVin?.vin).toBe('WVWZZZ1KZAW000001');
  });

  it('abgelaufene oder widerrufene Freigaben zeigen nichts', () => {
    expect(publicViewFromShare(vehicle, entries, { ...share, revokedAt: '2026-09-20T10:00:00Z' }, { now, workshopName: 'x' })).toBeNull();
    expect(publicViewFromShare(vehicle, entries, { ...share, expiresAt: '2026-09-01T10:00:00Z' }, { now, workshopName: 'x' })).toBeNull();
  });
});

describe('QR-Code', () => {
  it('ohne eingeschaltete Kurzansicht nichts (nur Hinweis und Anmeldung)', () => {
    expect(publicViewFromQr(vehicle, entries, { workshopName: 'Autowerkstatt Witten' })).toBeNull();
  });

  it('Kurzansicht: gültige Einträge, nie FIN, nie Kennzeichen', () => {
    const withPlate = { ...vehicle, qrPublicViewEnabled: true, licensePlate: 'EN-XX 1' } as PublicVehicleSource;
    const view = publicViewFromQr(withPlate, entries, { workshopName: 'Autowerkstatt Witten' });
    expect(view?.vin).toBeNull();
    expect(view?.source).toBe('qr_public_view');
    expect(view?.expiresAt).toBeNull();
    expect(view?.entries.map((e) => e.title)).toEqual(['Wartung 4', 'Wartung 2 (korrigiert)', 'Wartung 1']);
    const json = JSON.stringify(view);
    expect(json).not.toContain('EN-XX 1');
    expect(json).not.toContain('WVWZZZ1KZAW000001');
    expect(json).not.toContain(IDS.workOrderA);
  });
});

describe('Token-Hash', () => {
  it('speichert nur SHA-256-Hex des Tokens', () => {
    const token = 'test-token-nur-fuer-unit-tests';
    expect(hashToken(token)).toBe(sha256Hex(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toBe(hashToken(`${token}x`));
  });
});
