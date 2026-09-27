import { describe, expect, it } from 'vitest';
import {
  ApprovalDecisionRequestSchema,
  CustomerInputSchema,
  PERMISSIONS,
  VinSchema,
  buildPath,
  endpoints,
  homeForRole,
  permissionLabels,
  routes,
  safeNextPath,
} from './index';

describe('Routen', () => {
  it('liefert Startseiten je Rolle', () => {
    expect(homeForRole('customer')).toBe('/kunde');
    expect(homeForRole('mechanic')).toBe('/mechaniker');
    expect(homeForRole('service')).toBe('/werkstatt');
    expect(homeForRole('admin')).toBe('/werkstatt');
  });

  it('baut Deep-Link-Ziele ohne Inhalte', () => {
    expect(routes.customer.approval('a', 'b')).toBe('/kunde/auftraege/a/freigaben/b');
    expect(routes.workshop.workOrders({ freigabe: 'pending' })).toBe('/werkstatt/auftraege?freigabe=pending');
  });

  it('lässt nach der Anmeldung nur interne Ziele zu', () => {
    expect(safeNextPath('/kunde/rechnungen/1')).toBe('/kunde/rechnungen/1');
    expect(safeNextPath('https://boese.example')).toBeNull();
    expect(safeNextPath('//boese.example')).toBeNull();
    expect(safeNextPath('/\\boese')).toBeNull();
    expect(safeNextPath('/\t/boese.example')).toBeNull();
    expect(safeNextPath('/\n/boese.example')).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });
});

describe('API-Vertrag', () => {
  it('ersetzt Pfadparameter und verlangt alle', () => {
    expect(buildPath(endpoints.getWorkOrder.path, { id: 'x1' })).toBe('/work-orders/x1');
    expect(() => buildPath(endpoints.getWorkOrder.path)).toThrow();
  });

  it('hat nur wenige öffentliche Endpunkte', () => {
    const publicOnes = Object.entries(endpoints)
      .filter(([, def]) => def.auth === 'public')
      .map(([name]) => name)
      .sort();
    expect(publicOnes).toEqual(
      ['acceptInvitation', 'forgotPassword', 'health', 'login', 'publicShare', 'resetPassword', 'resolveQr', 'sumupWebhook'].sort(),
    );
  });
});

describe('Schemas', () => {
  it('prüft FIN', () => {
    expect(VinSchema.parse('wvwzzz1kzaw000001')).toBe('WVWZZZ1KZAW000001');
    expect(() => VinSchema.parse('WVWZZZ1KZAW00000O')).toThrow();
    expect(() => VinSchema.parse('KURZ')).toThrow();
  });

  it('verlangt Nachname bei Privatkunden und Firma bei Geschäftskunden', () => {
    expect(CustomerInputSchema.safeParse({ kind: 'private', lastName: 'Kowalski' }).success).toBe(true);
    expect(CustomerInputSchema.safeParse({ kind: 'private' }).success).toBe(false);
    expect(CustomerInputSchema.safeParse({ kind: 'business', companyName: 'Dachdeckerei Brandt GmbH' }).success).toBe(true);
    expect(CustomerInputSchema.safeParse({ kind: 'business', lastName: 'Brandt' }).success).toBe(false);
  });

  it('verlangt für Entscheidungen einen 64-stelligen Inhalts-Hash', () => {
    const base = { versionId: '0f8fad5b-d9cb-469f-a165-70867728950e', decision: 'approved', channel: 'ios' } as const;
    expect(ApprovalDecisionRequestSchema.safeParse({ ...base, contentHash: 'a'.repeat(64) }).success).toBe(true);
    expect(ApprovalDecisionRequestSchema.safeParse({ ...base, contentHash: 'ja' }).success).toBe(false);
  });

  it('hat für jedes Recht eine deutsche Bezeichnung', () => {
    for (const p of PERMISSIONS) expect(permissionLabels[p]).toBeTruthy();
  });
});
