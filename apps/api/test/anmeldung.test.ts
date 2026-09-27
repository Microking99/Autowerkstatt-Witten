import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuditEntrySchema, LoginResponseSchema, SessionUserSchema, StaffUserSchema } from '@werkstatt/contracts';
import { sessions } from '../src/db/schema/index';
import { TEST_PASSWORD, call, createCustomer, createHarness, createStaff, expectOk, expectStatus, login, type Harness } from './support/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());

const tokenFromMail = (to: string, kind: 'einladung' | 'passwort-neu') => {
  const mail = [...h.mailer.sent].reverse().find((m) => m.to === to);
  if (!mail) throw new Error(`Keine Mail an ${to}`);
  return new RegExp(`${kind}/([A-Za-z0-9_-]+)`).exec(mail.text)![1]!;
};

describe('Anmeldung', () => {
  it('gleiche Fehlermeldung bei unbekannter E-Mail und falschem Passwort; Audit', async () => {
    const staff = await createStaff(h, 'service');
    const unknown = await call(h, 'POST', '/auth/login', { body: { email: 'niemand@beispiel.test', password: 'irgendwas-123' } });
    const wrong = await call(h, 'POST', '/auth/login', { body: { email: staff.email, password: 'falsches-Passwort' } });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
    const admin = await createStaff(h, 'admin');
    const audit = expectOk(await call(h, 'GET', '/audit', { token: admin.token, query: { action: 'auth.login_failed' } }), z.array(AuditEntrySchema));
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audit)).not.toContain('falsches-Passwort');
    const ok = expectOk(await call(h, 'GET', '/audit', { token: admin.token, query: { action: 'auth.login_succeeded', entityId: staff.id } }), z.array(AuditEntrySchema));
    expect(ok.length).toBeGreaterThanOrEqual(1);
  });

  it('Sperre nach wiederholten Fehlversuchen, auch für das richtige Passwort, bis die Sperrzeit abläuft', async () => {
    const staff = await createStaff(h, 'mechanic');
    for (let i = 0; i < 5; i++) {
      expectStatus(await call(h, 'POST', '/auth/login', { body: { email: staff.email, password: `falsch-${i}-xxxx` } }), 401);
    }
    // Gesperrt: gleiche Antwort wie bei falschen Daten (keine Auskunft über die Existenz des Kontos)
    expectStatus(await call(h, 'POST', '/auth/login', { body: { email: staff.email, password: TEST_PASSWORD } }), 401, 'invalid_credentials');
    h.clock.advance(16 * 60_000);
    expectOk(await call(h, 'POST', '/auth/login', { body: { email: staff.email, password: TEST_PASSWORD } }), LoginResponseSchema);
    h.clock.advance(-16 * 60_000);
  });

  it('Mitarbeiter-Einladung: 7 Tage, einmalig, danach Anmeldung', async () => {
    const admin = await createStaff(h, 'admin');
    const invited = expectOk(
      await call(h, 'POST', '/users/invite', { token: admin.token, body: { email: 'neu.mechaniker@beispiel.test', displayName: '[TEST] Neu', role: 'mechanic' } }),
      StaffUserSchema,
      201,
    );
    expect(invited.status).toBe('invited');
    // noch keine Anmeldung möglich
    expectStatus(await call(h, 'POST', '/auth/login', { body: { email: 'neu.mechaniker@beispiel.test', password: 'Neues-Passwort-1' } }), 401);
    const token = tokenFromMail('neu.mechaniker@beispiel.test', 'einladung');
    expectStatus(await call(h, 'POST', '/auth/invitations/accept', { body: { token, password: 'kurz' } }), 400, 'validation_failed');
    const accepted = expectOk(await call(h, 'POST', '/auth/invitations/accept', { body: { token, password: 'Neues-Passwort-1' } }), LoginResponseSchema);
    expect(accepted.user).toMatchObject({ role: 'mechanic', status: 'active' });
    expect(accepted.user.permissions).toContain('workItems.execute');
    expectStatus(await call(h, 'POST', '/auth/invitations/accept', { body: { token, password: 'Anderes-Passwort-2' } }), 400, 'invitation_invalid');
    await login(h, 'neu.mechaniker@beispiel.test', 'Neues-Passwort-1');
    // doppelte E-Mail
    expectStatus(
      await call(h, 'POST', '/users/invite', { token: admin.token, body: { email: 'NEU.mechaniker@beispiel.test', displayName: 'x', role: 'service' } }),
      409,
      'email_taken',
    );

    // abgelaufene Einladung
    expectOk(
      await call(h, 'POST', '/users/invite', { token: admin.token, body: { email: 'spaet@beispiel.test', displayName: '[TEST] Spät', role: 'service' } }),
      StaffUserSchema,
      201,
    );
    const late = tokenFromMail('spaet@beispiel.test', 'einladung');
    h.clock.advance(8 * 86_400_000);
    const expired = await call(h, 'POST', '/auth/invitations/accept', { body: { token: late, password: 'Neues-Passwort-1' } });
    h.clock.advance(-8 * 86_400_000);
    expectStatus(expired, 400, 'invitation_invalid');
  });

  it('Passwort vergessen: Antwort immer 204; Zurücksetzen beendet alle Sitzungen', async () => {
    const customer = await createCustomer(h, 'Reset');
    const second = await login(h, customer.email);
    const before = h.mailer.sent.length;
    expectStatus(await call(h, 'POST', '/auth/password/forgot', { body: { email: 'unbekannt@beispiel.test' } }), 204);
    expect(h.mailer.sent.length).toBe(before);
    expectStatus(await call(h, 'POST', '/auth/password/forgot', { body: { email: customer.email } }), 204);
    await new Promise((r) => setTimeout(r, 20));
    const token = tokenFromMail(customer.email, 'passwort-neu');
    expectStatus(await call(h, 'POST', '/auth/password/reset', { body: { token, password: 'Ganz-Neues-Passwort-9' } }), 204);
    expectStatus(await call(h, 'GET', '/auth/me', { token: customer.token }), 401);
    expectStatus(await call(h, 'GET', '/auth/me', { token: second }), 401);
    expectStatus(await call(h, 'POST', '/auth/password/reset', { body: { token, password: 'Nochmal-Passwort-9' } }), 400, 'reset_invalid');
    expectStatus(await call(h, 'POST', '/auth/login', { body: { email: customer.email, password: TEST_PASSWORD } }), 401);
    const fresh = await login(h, customer.email, 'Ganz-Neues-Passwort-9');
    const me = expectOk(await call(h, 'GET', '/auth/me', { token: fresh }), SessionUserSchema);
    expect(me.customerId).toBe(customer.customerId);
    expect(me.permissions).toEqual([]);
  });

  it('Passwort ändern beendet andere Sitzungen; Abmelden beendet die eigene', async () => {
    const staff = await createStaff(h, 'service');
    const other = await login(h, staff.email);
    expectStatus(
      await call(h, 'POST', '/auth/password/change', { token: staff.token, body: { currentPassword: 'falsch', newPassword: 'Ein-Neues-Passwort-1' } }),
      400,
      'invalid_current_password',
    );
    expectStatus(
      await call(h, 'POST', '/auth/password/change', { token: staff.token, body: { currentPassword: TEST_PASSWORD, newPassword: 'Ein-Neues-Passwort-1' } }),
      204,
    );
    expectStatus(await call(h, 'GET', '/auth/me', { token: staff.token }), 200);
    expectStatus(await call(h, 'GET', '/auth/me', { token: other }), 401);
    expectStatus(await call(h, 'POST', '/auth/logout', { token: staff.token }), 204);
    expectStatus(await call(h, 'GET', '/auth/me', { token: staff.token }), 401);
    // Tokens nur als Hash gespeichert
    const rows = await h.db.select().from(sessions).where(eq(sessions.userId, staff.id));
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash) && r.tokenHash !== staff.token)).toBe(true);
  });

  it('ohne Sitzung: 401 auf geschützten Routen', async () => {
    expectStatus(await call(h, 'GET', '/auth/me'), 401, 'unauthorized');
    expectStatus(await call(h, 'GET', '/work-orders'), 401);
    expectStatus(await call(h, 'GET', '/work-orders', { token: 'x'.repeat(43) }), 401);
  });
});

describe('Rate-Limit für Anmeldung', () => {
  it('begrenzt Anmeldeversuche je Adresse und E-Mail', async () => {
    const limited = await createHarness({ AUTH_RATE_LIMIT_MAX: '3' });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) {
        codes.push((await call(limited, 'POST', '/auth/login', { body: { email: 'begrenzt@beispiel.test', password: 'falsch-falsch' } })).statusCode);
      }
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes.slice(3)).toEqual([429, 429]);
      const res = await call(limited, 'POST', '/auth/login', { body: { email: 'begrenzt@beispiel.test', password: 'falsch-falsch' } });
      expect(res.json().error.code).toBe('too_many_requests');
    } finally {
      await limited.close();
    }
  });
});
