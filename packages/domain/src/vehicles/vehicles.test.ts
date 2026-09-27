import { describe, expect, it } from 'vitest';
import { IDS, tid } from '../testing/fixtures';
import {
  checkOdometerPlausibility,
  currentOwnerCustomerId,
  isGermanLicensePlate,
  licensePlateSearchKey,
  normalizeLicensePlate,
  planOwnershipTransfer,
  validateVin,
  type OwnershipPeriod,
} from './vehicles';

describe('Kilometerstände', () => {
  const readings = [
    { valueKm: 80_000, recordedAt: '2026-01-10T10:00:00Z' },
    { valueKm: 88_000, recordedAt: '2026-05-02T10:00:00Z' },
  ];

  it('höherer oder gleicher Wert ist plausibel', () => {
    expect(checkOdometerPlausibility(readings, 90_000, '2026-09-26T10:00:00Z')).toBe('ok');
    expect(checkOdometerPlausibility(readings, 88_000, '2026-09-26T10:00:00Z')).toBe('ok');
    expect(checkOdometerPlausibility([], 1, '2026-09-26T10:00:00Z')).toBe('ok');
  });

  it('niedrigerer Wert als zuvor wird markiert', () => {
    expect(checkOdometerPlausibility(readings, 87_999, '2026-09-26T10:00:00Z')).toBe('lower_than_previous');
  });

  it('vergleicht nachträglich erfasste Stände nur mit früheren', () => {
    expect(checkOdometerPlausibility(readings, 85_000, '2026-03-01T10:00:00Z')).toBe('ok');
    expect(checkOdometerPlausibility(readings, 79_000, '2026-03-01T10:00:00Z')).toBe('lower_than_previous');
  });
});

describe('Halterwechsel', () => {
  const current: OwnershipPeriod = { id: tid(9001), customerId: IDS.customerA, startedAt: '2023-05-01T08:00:00Z', endedAt: null };
  const now = new Date('2026-09-26T10:00:00Z');

  it('beendet den alten Zeitraum und beginnt den neuen zum selben Zeitpunkt', () => {
    const r = planOwnershipTransfer({ current, newCustomerId: IDS.customerB, effectiveAt: '2026-09-01T12:00:00+02:00', now });
    expect(r).toEqual({
      ok: true,
      value: {
        endCurrent: { ownershipId: tid(9001), endedAt: '2026-09-01T10:00:00.000Z' },
        startNew: { customerId: IDS.customerB, startedAt: '2026-09-01T10:00:00.000Z', endedAt: null },
        revokeSharesOfPreviousOwner: true,
        disableQrPublicView: true,
      },
    });
  });

  it('nicht an denselben Kunden', () => {
    expect(planOwnershipTransfer({ current, newCustomerId: IDS.customerA, effectiveAt: '2026-09-01T10:00:00Z' })).toMatchObject({ ok: false, error: { code: 'SAME_CUSTOMER' } });
  });

  it('nicht vor Beginn des aktuellen Zeitraums und nicht in der Zukunft', () => {
    expect(planOwnershipTransfer({ current, newCustomerId: IDS.customerB, effectiveAt: '2023-04-30T10:00:00Z' })).toMatchObject({ ok: false, error: { code: 'BEFORE_CURRENT_START' } });
    expect(planOwnershipTransfer({ current, newCustomerId: IDS.customerB, effectiveAt: current.startedAt })).toMatchObject({ ok: false, error: { code: 'BEFORE_CURRENT_START' } });
    expect(planOwnershipTransfer({ current, newCustomerId: IDS.customerB, effectiveAt: '2026-10-01T10:00:00Z', now })).toMatchObject({ ok: false, error: { code: 'IN_FUTURE' } });
  });

  it('nur vom aktuellen Zeitraum aus', () => {
    expect(planOwnershipTransfer({ current: { ...current, endedAt: '2026-01-01T00:00:00Z' }, newCustomerId: IDS.customerB, effectiveAt: '2026-09-01T10:00:00Z' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_CURRENT' },
    });
  });

  it('ermittelt den aktuellen Halter', () => {
    expect(currentOwnerCustomerId([{ customerId: IDS.customerA, endedAt: '2026-09-01T10:00:00Z' }, { customerId: IDS.customerB, endedAt: null }])).toBe(IDS.customerB);
    expect(currentOwnerCustomerId([{ customerId: IDS.customerA, endedAt: '2026-09-01T10:00:00Z' }])).toBeNull();
  });
});

describe('Kennzeichen und FIN', () => {
  it('normalisiert Kennzeichen', () => {
    expect(normalizeLicensePlate('en-ab 123')).toBe('EN-AB 123');
    expect(normalizeLicensePlate('EN AB 123')).toBe('EN-AB 123');
    expect(normalizeLicensePlate(' en-ab-123 ')).toBe('EN-AB 123');
    expect(normalizeLicensePlate('EN – AB  123')).toBe('EN-AB 123');
    expect(normalizeLicensePlate('en-ab123e')).toBe('EN-AB 123E');
    expect(normalizeLicensePlate('b-x 1')).toBe('B-X 1');
    expect(normalizeLicensePlate('lö-ab 12')).toBe('LÖ-AB 12');
    expect(normalizeLicensePlate('enab123')).toBe('ENAB123');
  });

  it('erkennt den üblichen deutschen Aufbau', () => {
    expect(isGermanLicensePlate('EN-AB 123')).toBe(true);
    expect(isGermanLicensePlate('EN-AB 123H')).toBe(true);
    expect(isGermanLicensePlate('ENAB123')).toBe(false);
    expect(isGermanLicensePlate('EN-AB 0123')).toBe(false);
  });

  it('bildet Suchschlüssel unabhängig von Trennzeichen', () => {
    expect(licensePlateSearchKey('EN-AB 123')).toBe(licensePlateSearchKey('en ab123'));
  });

  it('prüft FIN über das Schema aus contracts', () => {
    expect(validateVin(' wvwzzz1kzaw000001 ')).toEqual({ ok: true, value: 'WVWZZZ1KZAW000001' });
    expect(validateVin('WVWZZZ1KZAW00000O')).toMatchObject({ ok: false, error: { code: 'INVALID_VIN' } });
    expect(validateVin('KURZ').ok).toBe(false);
  });
});
