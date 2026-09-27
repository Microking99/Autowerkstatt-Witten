import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoginResponseSchema, SessionUserSchema } from '@werkstatt/contracts';
import { call, createHarness, createStaff, expectOk, type Harness } from './support/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.close();
});

describe('Grundgerüst', () => {
  it('meldet Betriebsbereitschaft unter /api/v1/health', async () => {
    const res = await call(h, 'GET', '/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'ok' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('liefert Fehler im ApiError-Format und 404 für unbekannte Pfade', async () => {
    const res = await call(h, 'GET', '/gibt-es-nicht');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });

  it('meldet einen Mitarbeiter an und liefert me', async () => {
    const admin = await createStaff(h, 'admin');
    const me = expectOk(await call(h, 'GET', '/auth/me', { token: admin.token }), SessionUserSchema);
    expect(me.role).toBe('admin');
    expect(me.permissions).toContain('users.manage');
    const login = await call(h, 'POST', '/auth/login', { body: { email: admin.email, password: 'Test-Passwort-123' } });
    expectOk(login, LoginResponseSchema);
  });
});
