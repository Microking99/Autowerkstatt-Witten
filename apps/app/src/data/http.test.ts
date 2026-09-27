import { describe, expect, it, vi } from 'vitest';
import { ApiError, ERROR_CODES } from './errors';
import { HttpApi } from './http';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

const user = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  email: 'm.kowalczyk@kunden.example',
  displayName: 'Miriam Kowalczyk',
  role: 'customer',
  status: 'active',
  permissions: [],
  customerId: '1f8fad5b-d9cb-469f-a165-70867728950e',
};

describe('HttpApi', () => {
  it('setzt Präfix, Bearer-Token und prüft Antworten gegen den Vertrag', async () => {
    const fetchImpl = mockFetch(200, user);
    const api = new HttpApi({ baseUrl: 'https://api.example/', validateResponses: true, fetchImpl });
    api.setToken('abc');
    const me = await api.me();
    expect(me.displayName).toBe('Miriam Kowalczyk');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.example/api/v1/auth/me');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer abc');
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined();
  });

  it('sendet bei schreibenden Anfragen einen Idempotency-Key (stabil bei Nachrichten)', async () => {
    const fetchImpl = mockFetch(204, undefined);
    const api = new HttpApi({ baseUrl: 'https://api.example', fetchImpl, newId: () => 'fest-123' });
    await api.markRead('wo-1');
    expect((fetchImpl.mock.calls[0]![1]?.headers as Record<string, string>)['Idempotency-Key']).toBe('fest-123');
    const fetch2 = mockFetch(200, {});
    const api2 = new HttpApi({ baseUrl: 'https://api.example', fetchImpl: fetch2 });
    await api2.sendMessage('wo-1', { clientMessageId: 'client-xyz-1', body: 'Hallo' });
    expect((fetch2.mock.calls[0]![1]?.headers as Record<string, string>)['Idempotency-Key']).toBe('message:client-xyz-1');
  });

  it('übersetzt Fehlerantworten in ApiError (404, 409 mit Code)', async () => {
    const api404 = new HttpApi({ baseUrl: 'https://api.example', fetchImpl: mockFetch(404, { error: { code: 'not_found', message: 'Nicht gefunden' } }) });
    await expect(api404.getWorkOrder('x')).rejects.toMatchObject({ status: 404, code: 'not_found' });
    const api409 = new HttpApi({ baseUrl: 'https://api.example', fetchImpl: mockFetch(409, { error: { code: ERROR_CODES.versionSuperseded, message: 'Das Angebot wurde geändert.' } }) });
    await expect(
      api409.decideApproval('a', { versionId: '0f8fad5b-d9cb-469f-a165-70867728950e', contentHash: 'a'.repeat(64), decision: 'approved', channel: 'web' }),
    ).rejects.toMatchObject({ status: 409, code: ERROR_CODES.versionSuperseded, message: 'Das Angebot wurde geändert.' });
  });

  it('meldet Netzwerkfehler als code NETWORK', async () => {
    const api = new HttpApi({ baseUrl: 'https://api.example', fetchImpl: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) });
    const err = await api.listInvoices().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(ERROR_CODES.network);
    expect((err as ApiError).status).toBe(0);
  });

  it('zuweisbare Mitarbeiter: GET /staff/assignable, Antwort gegen den Vertrag geprüft', async () => {
    const staff = [{ userId: '2f8fad5b-d9cb-469f-a165-70867728950e', displayName: 'Beispiel Mechaniker', role: 'mechanic' }];
    const fetchImpl = mockFetch(200, staff);
    const api = new HttpApi({ baseUrl: 'https://api.example', validateResponses: true, fetchImpl });
    expect(await api.listAssignableStaff()).toEqual(staff);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.example/api/v1/staff/assignable');
    expect(fetchImpl.mock.calls[0]![1]?.method).toBe('GET');
    const bad = new HttpApi({ baseUrl: 'https://api.example', validateResponses: true, fetchImpl: mockFetch(200, [{ ...staff[0], role: 'customer' }]) });
    await expect(bad.listAssignableStaff()).rejects.toMatchObject({ code: ERROR_CODES.responseInvalid });
  });

  it('Start und Pause: ohne Gerätezeit kein Körper, mit Gerätezeit { occurredAt }; Abschluss mit occurredAt im Körper', async () => {
    const item = {
      id: '3f8fad5b-d9cb-469f-a165-70867728950e',
      workOrderId: '4f8fad5b-d9cb-469f-a165-70867728950e',
      position: 1,
      kind: 'labor',
      title: 'Beispiel',
      description: null,
      maintenanceTypeId: null,
      intervalKm: null,
      intervalMonths: null,
      quantity: 1,
      unit: 'Std.',
      origin: 'intake',
      authorization: 'agreed',
      executionStatus: 'in_progress',
      approvalRequestId: null,
      assignedTo: null,
      doneAt: null,
      doneOdometerKm: null,
      resultNotes: null,
      trackedMinutes: 0,
      runningSince: '2026-09-27T08:00:00.000Z',
      parts: [{ id: '5f8fad5b-d9cb-469f-a165-70867728950e', partNumber: null, description: 'Teil', quantity: 1, recordedAt: '2026-09-27T08:10:00.000Z' }],
    };
    const fetchImpl = mockFetch(200, item);
    const api = new HttpApi({ baseUrl: 'https://api.example', validateResponses: true, fetchImpl });
    await api.startWorkItem(item.id, undefined, { idempotencyKey: 'eintrag-0001' });
    await api.pauseWorkItem(item.id, { occurredAt: '2026-09-27T08:30:00.000Z' }, { idempotencyKey: 'eintrag-0002.r1' });
    await api.finishWorkItem(item.id, { odometerKm: null, occurredAt: '2026-09-27T08:40:00.000Z' });
    const [start, pause, finish] = fetchImpl.mock.calls;
    expect(start![0]).toBe(`https://api.example/api/v1/work-items/${item.id}/start`);
    expect(start![1]?.body).toBeUndefined();
    expect((start![1]?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((start![1]?.headers as Record<string, string>)['Idempotency-Key']).toBe('eintrag-0001');
    expect(JSON.parse(String(pause![1]?.body))).toEqual({ occurredAt: '2026-09-27T08:30:00.000Z' });
    expect((pause![1]?.headers as Record<string, string>)['Idempotency-Key']).toBe('eintrag-0002.r1');
    expect(JSON.parse(String(finish![1]?.body))).toEqual({ odometerKm: null, occurredAt: '2026-09-27T08:40:00.000Z' });
  });

  it('meldet 422 invalid_occurred_at mit Code und Meldung', async () => {
    const api = new HttpApi({
      baseUrl: 'https://api.example',
      fetchImpl: mockFetch(422, { error: { code: ERROR_CODES.invalidOccurredAt, message: 'Der erfasste Zeitpunkt liegt mehr als 72 Stunden zurück.', details: { reason: 'too_old' } } }),
    });
    await expect(api.startWorkItem('x', { occurredAt: '2026-09-20T08:00:00.000Z' })).rejects.toMatchObject({ status: 422, code: 'invalid_occurred_at', details: { reason: 'too_old' } });
  });

  it('erkennt Vertragsabweichungen in der Entwicklung', async () => {
    const api = new HttpApi({ baseUrl: 'https://api.example', validateResponses: true, fetchImpl: mockFetch(200, { ...user, role: 'hacker' }) });
    await expect(api.me()).rejects.toMatchObject({ code: ERROR_CODES.responseInvalid });
  });
});
