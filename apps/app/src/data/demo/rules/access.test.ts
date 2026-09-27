import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_CODES } from '../../errors';
import { DEMO_TOKENS } from '../constants';
import { IDS, createSeed } from '../seed';
import {
  customerCanSeeDocument,
  customerCanSeeInvoice,
  customerCanSeeServiceEntry,
  customerCanSeeVehicle,
  customerCanSeeWorkOrder,
  mechanicCanSeeWorkOrder,
  serviceEntryWorkOrderRefForCustomer,
} from './access';
import { effectivePermissions } from './permissions';
import { createShare, openShare, resolveQr, revokeShare } from './publicAccess';

const NOW_DATE = new Date('2026-09-26T10:00:00.000Z');
const NOW = NOW_DATE.toISOString();
const s = createSeed(NOW_DATE);
const miriam = IDS.customers.miriam;
const guenter = IDS.customers.guenter;

describe('Objektregeln Kunde (docs/rollen-und-rechte.md)', () => {
  it('Kundin sieht nur aktuell eigene Fahrzeuge', () => {
    const visible = s.vehicles.filter((v) => customerCanSeeVehicle(miriam, v.id, s.ownerships)).map((v) => v.licensePlate);
    expect(visible.sort()).toEqual(['EN-MK 2147', 'EN-MK 3308']);
  });

  it('Vorbesitzer verliert das verkaufte Fahrzeug, behält aber seine Aufträge, Rechnungen und Dokumente (Regel 3)', () => {
    expect(customerCanSeeVehicle(guenter, IDS.vehicles.octavia, s.ownerships)).toBe(false);
    const oldOrder = s.workOrders.find((w) => w.id === IDS.workOrders.rohde2025)!;
    expect(customerCanSeeWorkOrder(guenter, oldOrder)).toBe(true);
    expect(customerCanSeeWorkOrder(miriam, oldOrder)).toBe(false);
    const oldInvoice = s.invoices.find((i) => i.id === IDS.invoices.rohde2025)!;
    expect(customerCanSeeInvoice(guenter, oldInvoice)).toBe(true);
    expect(customerCanSeeInvoice(miriam, oldInvoice)).toBe(false);
    const oldDocs = s.documents.filter((d) => d.vehicleId === IDS.vehicles.octavia && d.customerId === guenter);
    expect(oldDocs.length).toBeGreaterThan(0);
    for (const d of oldDocs) expect(customerCanSeeDocument(miriam, d)).toBe(false);
  });

  it('neue Halterin sieht die technische Historie ohne Auftragsbezug des Vorbesitzers', () => {
    const octaviaEntries = s.serviceEntries.filter((e) => e.vehicleId === IDS.vehicles.octavia && e.status === 'valid');
    expect(octaviaEntries.length).toBeGreaterThan(0);
    for (const e of octaviaEntries) {
      expect(customerCanSeeServiceEntry(miriam, e, s.ownerships)).toBe(true);
      expect(customerCanSeeServiceEntry(guenter, e, s.ownerships)).toBe(false);
      expect(serviceEntryWorkOrderRefForCustomer(miriam, e, s.workOrders)).toBeNull();
    }
    const golfEntry = s.serviceEntries.find((e) => e.vehicleId === IDS.vehicles.golf)!;
    expect(serviceEntryWorkOrderRefForCustomer(miriam, golfEntry, s.workOrders)).toBe(golfEntry.workOrderId);
  });

  it('interne Dokumente sind für Kunden nie sichtbar', () => {
    const internal = s.documents.filter((d) => d.visibility === 'internal');
    expect(internal.length).toBeGreaterThan(0);
    for (const d of internal) expect(customerCanSeeDocument(miriam, d)).toBe(false);
  });

  it('Mechaniker sieht nur zugewiesene Aufträge', () => {
    const items = s.workItems;
    const emre = IDS.users.emre;
    const perms = effectivePermissions('mechanic', []);
    const visible = s.workOrders.filter((w) => mechanicCanSeeWorkOrder(emre, w, items, perms.includes('workOrders.read')));
    expect(visible.map((w) => w.orderNumber)).toContain('A-2026-0192');
    expect(visible.map((w) => w.orderNumber)).not.toContain('A-2026-0191');
  });
});

describe('QR-Code ist kein Generalschlüssel (Regel 9)', () => {
  const base = { vehicles: s.vehicles, ownerships: s.ownerships, entries: s.serviceEntries, workshopName: 'Autowerkstatt Witten' };

  it('zeigt ohne Anmeldung nur Hinweis und Anmeldung, wenn keine Kurzansicht freigegeben ist', () => {
    expect(resolveQr({ ...base, token: DEMO_TOKENS.qrOctavia, viewer: { kind: 'anonymous' } })).toEqual({ mode: 'login_required', workshopName: 'Autowerkstatt Witten' });
  });

  it('zeigt die freigegebene Kurzansicht ohne Kennzeichen, FIN, Namen oder Preise', () => {
    const r = resolveQr({ ...base, token: DEMO_TOKENS.qrGolf, viewer: { kind: 'anonymous' } });
    expect(r.mode).toBe('public');
    if (r.mode !== 'public') return;
    expect(r.view.vin).toBeNull();
    const text = JSON.stringify(r.view);
    expect(text).not.toContain('EN-MK');
    expect(text).not.toContain('Kowalczyk');
    expect(text).not.toContain('Cents');
  });

  it('leitet die berechtigte Halterin zur vollständigen Fahrzeugansicht', () => {
    expect(resolveQr({ ...base, token: DEMO_TOKENS.qrOctavia, viewer: { kind: 'customer', customerId: miriam } })).toMatchObject({
      mode: 'authorized',
      targetPath: `/kunde/fahrzeuge/${IDS.vehicles.octavia}`,
    });
  });

  it('gibt dem Vorbesitzer nach dem Verkauf keinen Zugriff', () => {
    expect(resolveQr({ ...base, token: DEMO_TOKENS.qrOctavia, viewer: { kind: 'customer', customerId: guenter } }).mode).toBe('login_required');
  });

  it('meldet unbekannte Codes mit 404', () => {
    expect(() => resolveQr({ ...base, token: 'gibt-es-nicht', viewer: { kind: 'anonymous' } })).toThrow(ApiError);
  });
});

describe('Fahrzeugfreigabe für Kaufinteressenten (R-QR-4)', () => {
  const common = { shares: s.shares, vehicles: s.vehicles, ownerships: s.ownerships, entries: s.serviceEntries, now: NOW, workshopName: 'Autowerkstatt Witten' };

  it('zeigt nur die ausgewählten Einträge und zählt den Abruf', () => {
    const { share, view } = openShare({ ...common, token: DEMO_TOKENS.shareValid });
    const selected = s.shares.find((x) => x.id === IDS.shares.valid)!;
    expect(view.entries).toHaveLength(selected.serviceEntryIds.length);
    expect(view.vin).toBe('WVWZZZCDZMW047193');
    expect(share.accessCount).toBe(selected.accessCount + 1);
    expect(JSON.stringify(view)).not.toContain('Klimaanlagen-Service');
  });

  it('meldet abgelaufene und widerrufene Freigaben', () => {
    expect(() => openShare({ ...common, token: DEMO_TOKENS.shareExpired })).toThrowError(expect.objectContaining({ code: ERROR_CODES.shareExpired }));
    expect(() => openShare({ ...common, token: DEMO_TOKENS.shareRevoked })).toThrowError(expect.objectContaining({ code: ERROR_CODES.shareRevoked }));
    expect(() => openShare({ ...common, token: 'unbekannt' })).toThrowError(expect.objectContaining({ status: 404 }));
  });

  it('darf nur vom aktuellen Halter angelegt und widerrufen werden', () => {
    const vehicle = s.vehicles.find((v) => v.id === IDS.vehicles.octavia)!;
    const entryId = s.serviceEntries.find((e) => e.vehicleId === vehicle.id && e.status === 'valid')!.id;
    const input = { label: 'Test', serviceEntryIds: [entryId], expiresAt: '2026-10-10T00:00:00.000Z' };
    expect(() => createShare({ id: 'x', token: 't', vehicle, customerId: guenter, userId: 'u', ownerships: s.ownerships, entries: s.serviceEntries, input, now: NOW, baseUrl: 'https://a' })).toThrow(ApiError);
    const { share, shareUrl } = createShare({ id: 'x', token: 'geheim-123', vehicle, customerId: miriam, userId: 'u', ownerships: s.ownerships, entries: s.serviceEntries, input, now: NOW, baseUrl: 'https://a' });
    expect(shareUrl).toBe('https://a/f/geheim-123');
    expect(share.tokenHash).not.toContain('geheim');
    const revoked = revokeShare(share, miriam, s.ownerships, NOW);
    expect(revoked.revokedAt).toBe(NOW);
    expect(() => openShare({ ...common, shares: [revoked], token: 'geheim-123' })).toThrowError(expect.objectContaining({ code: ERROR_CODES.shareRevoked }));
  });

  it('lehnt zu lange Laufzeiten und fremde Einträge ab', () => {
    const vehicle = s.vehicles.find((v) => v.id === IDS.vehicles.golf)!;
    const foreign = s.serviceEntries.find((e) => e.vehicleId === IDS.vehicles.corsa)!.id;
    expect(() => createShare({ id: 'x', token: 't', vehicle, customerId: miriam, userId: 'u', ownerships: s.ownerships, entries: s.serviceEntries, input: { label: 'x', serviceEntryIds: [foreign], expiresAt: '2026-10-10T00:00:00.000Z' }, now: NOW, baseUrl: 'https://a' })).toThrow(ApiError);
    const own = s.serviceEntries.find((e) => e.vehicleId === IDS.vehicles.golf)!.id;
    expect(() => createShare({ id: 'x', token: 't', vehicle, customerId: miriam, userId: 'u', ownerships: s.ownerships, entries: s.serviceEntries, input: { label: 'x', serviceEntryIds: [own], expiresAt: '2027-12-31T00:00:00.000Z' }, now: NOW, baseUrl: 'https://a' })).toThrow(ApiError);
  });
});
