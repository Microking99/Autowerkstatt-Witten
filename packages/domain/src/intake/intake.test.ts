import { describe, expect, it } from 'vitest';
import { IDS } from '../testing/fixtures';
import { canonicalIntakeContent, computeIntakeHash, type IntakeHashInput } from './intake';

const intake: IntakeHashInput = {
  workOrderId: IDS.workOrderA,
  odometerKm: 88_000,
  fuelLevel: '1/2',
  customerComplaint: 'Quietschen beim Bremsen',
  damages: [{ area: 'Stoßstange hinten', description: 'Kratzer', photoId: null }],
  agreedServices: 'Inspektion, Bremsen prüfen',
  costLimitCents: 50_000,
  notesCustomer: 'Bitte vorher anrufen',
  notesInternal: 'Stammkunde',
  items: [
    { origin: 'intake', title: 'Inspektion', quantity: 1, unit: 'Pauschale', unitPriceCents: 19_900 },
    { origin: 'additional', title: 'Bremsscheiben', quantity: 2, unit: 'Stk', unitPriceCents: 6_500 },
  ],
};

describe('Annahme-Hash', () => {
  it('liefert SHA-256 hex', () => {
    expect(computeIntakeHash(intake)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('interne Hinweise ändern den Hash nicht', () => {
    expect(computeIntakeHash({ ...intake, notesInternal: 'anderer interner Hinweis' })).toBe(computeIntakeHash(intake));
  });

  it('Bestätigung deckt nur vereinbarte Leistungen: spätere Zusatzarbeiten ändern den Hash nicht', () => {
    const withMoreAdditional: IntakeHashInput = {
      ...intake,
      items: [...intake.items!, { origin: 'offer', title: 'Klimaservice', quantity: 1, unit: 'Pauschale', unitPriceCents: 9_900 }],
    };
    expect(computeIntakeHash(withMoreAdditional)).toBe(computeIntakeHash(intake));
    expect(canonicalIntakeContent(intake).agreedItems.map((i) => i.title)).toEqual(['Inspektion']);
  });

  it('Änderungen am kundenbezogenen Inhalt ändern den Hash', () => {
    const base = computeIntakeHash(intake);
    const changed: IntakeHashInput[] = [
      { ...intake, odometerKm: 88_001 },
      { ...intake, customerComplaint: 'Klappern' },
      { ...intake, agreedServices: 'Inspektion' },
      { ...intake, costLimitCents: 60_000 },
      { ...intake, damages: [] },
      { ...intake, items: [{ origin: 'intake', title: 'Inspektion', quantity: 1, unit: 'Pauschale', unitPriceCents: 21_900 }] },
      // USt-Satz und Art bestimmen den Bruttobetrag bzw. die Leistung (Review F05b)
      { ...intake, items: [{ origin: 'intake', title: 'Inspektion', quantity: 1, unit: 'Pauschale', unitPriceCents: 19_900, vatRateBp: 700 }] },
      { ...intake, items: [{ origin: 'intake', title: 'Inspektion', quantity: 1, unit: 'Pauschale', unitPriceCents: 19_900, kind: 'part' }] },
    ];
    for (const c of changed) expect(computeIntakeHash(c)).not.toBe(base);
  });

  it('Schreibweise (Leerraum, Zeilenenden) ändert den Hash nicht', () => {
    expect(computeIntakeHash({ ...intake, customerComplaint: '  Quietschen beim Bremsen\r\n', workOrderId: IDS.workOrderA.toUpperCase() })).toBe(computeIntakeHash(intake));
  });
});
