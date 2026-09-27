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
    const api404 = new HttpApi({ baseUrl: 'https://api.example', fetchImpl: mockFetch(404, { error: { code: 'NOT_FOUND', message: 'Nicht gefunden' } }) });
    await expect(api404.getWorkOrder('x')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    const api409 = new HttpApi({ baseUrl: 'https://api.example', fetchImpl: mockFetch(409, { error: { code: ERROR_CODES.approvalVersionOutdated, message: 'Das Angebot wurde geändert.' } }) });
    await expect(
      api409.decideApproval('a', { versionId: '0f8fad5b-d9cb-469f-a165-70867728950e', contentHash: 'a'.repeat(64), decision: 'approved', channel: 'web' }),
    ).rejects.toMatchObject({ status: 409, code: ERROR_CODES.approvalVersionOutdated, message: 'Das Angebot wurde geändert.' });
  });

  it('meldet Netzwerkfehler als code NETWORK', async () => {
    const api = new HttpApi({ baseUrl: 'https://api.example', fetchImpl: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) });
    const err = await api.listInvoices().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(ERROR_CODES.network);
    expect((err as ApiError).status).toBe(0);
  });

  it('erkennt Vertragsabweichungen in der Entwicklung', async () => {
    const api = new HttpApi({ baseUrl: 'https://api.example', validateResponses: true, fetchImpl: mockFetch(200, { ...user, role: 'hacker' }) });
    await expect(api.me()).rejects.toMatchObject({ code: ERROR_CODES.responseInvalid });
  });
});
