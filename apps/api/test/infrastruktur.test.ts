import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type WebSocket from 'ws';
import { CustomerDetailSchema, FileRefSchema, MessageSchema, WorkOrderDetailSchema } from '@werkstatt/contracts';
import { maskUrlForLog } from '../src/app';
import { ConfigError, loadConfig } from '../src/config';
import { auditLog, customers, devices, idempotencyKeys, notifications } from '../src/db/schema/index';
import { sha256Hex } from '../src/lib/crypto';
import { LogPushSender, type Mailer } from '../src/notifications/channels';
import { MAX_DELIVERY_ATTEMPTS, backoffDelayMs, deliverPendingNotifications } from '../src/notifications/delivery';
import { SAMPLE_PDF, SAMPLE_PNG, call, createCustomer, createHarness, createStaff, expectOk, expectStatus, uploadFile, type Harness } from './support/harness';
import { createWorkOrder, customerWithVehicle, issueInvoice, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

describe('Idempotency-Key', () => {
  it('wiederholte Anfrage liefert dieselbe Antwort und wird nicht doppelt ausgeführt', async () => {
    const body = { kind: 'private', lastName: '[TEST] Idempotent', isTestData: true };
    const headers = { 'idempotency-key': 'offline-queue-0001' };
    const first = expectOk(await call(h, 'POST', '/customers', { token: w.service.token, body, headers }), CustomerDetailSchema, 201);
    const again = await call(h, 'POST', '/customers', { token: w.service.token, body, headers });
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json().id).toBe(first.id);
    const rows = await h.db.select().from(customers).where(eq(customers.lastName, '[TEST] Idempotent'));
    expect(rows).toHaveLength(1);
    // gleicher Schlüssel, anderer Inhalt → 422
    expectStatus(await call(h, 'POST', '/customers', { token: w.service.token, body: { ...body, lastName: 'Anders' }, headers }), 422, 'idempotency_key_reused');
    // pro Benutzer: ein anderer Benutzer mit gleichem Schlüssel wird normal ausgeführt
    const other = await call(h, 'POST', '/customers', { token: w.admin.token, body, headers });
    expect(other.statusCode).toBe(201);
    expect(other.json().id).not.toBe(first.id);
    // ungültiger Schlüssel
    expectStatus(await call(h, 'POST', '/customers', { token: w.service.token, body, headers: { 'idempotency-key': 'x' } }), 400, 'invalid_idempotency_key');
  });

  it('Antworten mit Geheimnissen (Freigabelink, Sitzungstoken) werden nicht gespeichert', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Geheim');
    const res = await call(h, 'POST', `/vehicles/${vehicleId}/shares`, {
      token: customer.token,
      headers: { 'idempotency-key': 'share-geheim-0001' },
      body: { label: 'x', serviceEntryIds: [randomUUID()], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(res.statusCode).toBe(422);
    const login = await call(h, 'POST', '/auth/login', { token: customer.token, headers: { 'idempotency-key': 'login-geheim-0001' }, body: { email: customer.email, password: 'Test-Passwort-123' } });
    expect(login.statusCode).toBe(200);
    const stored = await h.db.select().from(idempotencyKeys).where(eq(idempotencyKeys.userId, customer.id));
    expect(stored).toHaveLength(0);
    expect(JSON.stringify(await h.db.select().from(idempotencyKeys))).not.toContain(login.json().token);
  });

  it('auch Fehlerantworten (4xx) werden wiederholt geliefert, Nachricht über clientMessageId nur einmal', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Offline');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId });
    const body = { clientMessageId: 'offline-msg-0001', body: 'Offline geschrieben' };
    const a = expectOk(await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, body }), MessageSchema, 201);
    const b = expectOk(await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, body }), MessageSchema, 200);
    expect(b.id).toBe(a.id);
    const headers = { 'idempotency-key': 'offline-transition-01' };
    const r1 = await call(h, 'POST', `/work-orders/${wo.id}/transition`, { token: w.service.token, body: { to: 'in_progress' }, headers });
    const r2 = await call(h, 'POST', `/work-orders/${wo.id}/transition`, { token: w.service.token, body: { to: 'in_progress' }, headers });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r2.headers['idempotent-replay']).toBe('true');
    const detail = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    expect(detail.status.work).toBe('in_progress');
  });
});

describe('Datei-Upload', () => {
  it('prüft Dateisignatur, speichert SHA-256, lehnt falsche Typen ab', async () => {
    const png = expectOk(await uploadFile(h, w.service.token, 'bild.png', 'image/png', SAMPLE_PNG), FileRefSchema, 201);
    expect(png).toMatchObject({ mimeType: 'image/png', sizeBytes: SAMPLE_PNG.length, sha256: sha256Hex(SAMPLE_PNG), originalName: 'bild.png' });
    // Typ kommt aus der Signatur, nicht aus der Angabe des Clients
    const pdf = expectOk(await uploadFile(h, w.service.token, 'dokument.png', 'image/png', SAMPLE_PDF), FileRefSchema, 201);
    expect(pdf.mimeType).toBe('application/pdf');
    const exe = await uploadFile(h, w.service.token, 'rechnung.pdf', 'application/pdf', Buffer.from('MZ\x90\x00 ausführbar', 'binary'));
    expectStatus(exe, 415, 'unsupported_file_type');
    const html = await uploadFile(h, w.service.token, 'x.jpg', 'image/jpeg', Buffer.from('<html><script>alert(1)</script></html>'));
    expectStatus(html, 415);
    // ohne Anmeldung
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/files', payload: 'x', headers: { 'content-type': 'text/plain' } });
    expect(res.statusCode).toBe(401);
    // Pfadangaben im Dateinamen werden entfernt
    const traversal = expectOk(await uploadFile(h, w.service.token, '../../etc/passwd.png', 'image/png', SAMPLE_PNG), FileRefSchema, 201);
    expect(traversal.originalName).toBe('passwd.png');
  });

  it('begrenzt die Größe auf 15 MB', async () => {
    const big = Buffer.concat([SAMPLE_PNG, Buffer.alloc(15 * 1024 * 1024 + 1, 0)]);
    const res = await uploadFile(h, w.service.token, 'gross.png', 'image/png', big);
    expectStatus(res, 413, 'payload_too_large');
  });

  it('Kunden können keine fremden Dateien an eigene Nachrichten hängen', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Anhang');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId });
    const internal = expectOk(await uploadFile(h, w.service.token, 'intern.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
    expectStatus(
      await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, body: { clientMessageId: 'anhang-0001', body: 'x', fileIds: [internal.id] } }),
      404,
    );
    const own = expectOk(await uploadFile(h, customer.token, 'foto.png', 'image/png', SAMPLE_PNG), FileRefSchema, 201);
    const msg = expectOk(
      await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, body: { clientMessageId: 'anhang-0002', body: 'Foto', fileIds: [own.id] } }),
      MessageSchema,
      201,
    );
    const content = await call(h, 'GET', msg.attachments[0]!.contentUrl, { token: w.service.token });
    expect(content.statusCode).toBe(200);
    expect(content.rawPayload.equals(SAMPLE_PNG)).toBe(true);
  });
});

describe('Audit-Protokoll', () => {
  it('UPDATE und DELETE auf audit_log schlagen fehl (Trigger)', async () => {
    const [row] = await h.db.select().from(auditLog).limit(1);
    expect(row).toBeDefined();
    await expect(h.db.execute(sql`UPDATE audit_log SET action = 'manipuliert' WHERE id = ${row!.id}`)).rejects.toThrow();
    await expect(h.db.execute(sql`DELETE FROM audit_log WHERE id = ${row!.id}`)).rejects.toThrow();
    await expect(h.db.execute(sql`TRUNCATE audit_log`)).rejects.toThrow();
    const [still] = await h.db.select().from(auditLog).where(eq(auditLog.id, row!.id));
    expect(still!.action).toBe(row!.action);
  });
});

describe('WebSocket /api/v1/realtime', () => {
  const next = (ws: WebSocket): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Keine Nachricht erhalten')), 3000);
      ws.once('message', (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(String(data)) as Record<string, unknown>);
      });
    });

  it('Abo ohne Recht wird abgelehnt; mit Recht kommen Ereignisse an', async () => {
    const { customer: owner, vehicleId } = await customerWithVehicle(h, 'Echtzeit');
    const stranger = await createCustomer(h, 'Fremdabo');
    const wo = await createWorkOrder(h, w.service.token, { customerId: owner.customerId!, vehicleId });

    const bad = await h.app.injectWS('/api/v1/realtime');
    bad.send(JSON.stringify({ type: 'subscribe', workOrderId: wo.id }));
    const closed = await new Promise<number>((resolve) => bad.once('close', (code) => resolve(code)));
    expect(closed).toBe(4401);

    const foreign = await h.app.injectWS('/api/v1/realtime');
    foreign.send(JSON.stringify({ type: 'auth', token: stranger.token }));
    expect(await next(foreign)).toEqual({ type: 'auth_ok' });
    foreign.send(JSON.stringify({ type: 'subscribe', workOrderId: wo.id }));
    expect(await next(foreign)).toMatchObject({ type: 'error', code: 'not_found', workOrderId: wo.id });
    expect(h.app.deps.realtime.subscriberCount(wo.id)).toBe(0);

    const unassigned = await createStaff(h, 'mechanic');
    const mech = await h.app.injectWS('/api/v1/realtime');
    mech.send(JSON.stringify({ type: 'auth', token: unassigned.token }));
    await next(mech);
    mech.send(JSON.stringify({ type: 'subscribe', workOrderId: wo.id }));
    expect(await next(mech)).toMatchObject({ type: 'error', code: 'forbidden' });

    const ws = await h.app.injectWS('/api/v1/realtime');
    ws.send(JSON.stringify({ type: 'auth', token: owner.token }));
    await next(ws);
    ws.send(JSON.stringify({ type: 'subscribe', workOrderId: wo.id }));
    expect(await next(ws)).toEqual({ type: 'subscribed', workOrderId: wo.id });
    const eventPromise = next(ws);
    await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: w.service.token, body: { clientMessageId: 'echtzeit-0001', body: 'Neu' } });
    const event = await eventPromise;
    expect(event).toMatchObject({ type: 'event', event: { type: 'message.created', workOrderId: wo.id } });
    for (const s of [foreign, mech, ws]) s.terminate();
  });
});

describe('Konfiguration', () => {
  const base = { DATABASE_URL: 'postgres://x@127.0.0.1:1/x' };
  it('verlangt SumUp-Zugangsdaten und lehnt Live-Schlüssel ohne Freigabe ab', () => {
    expect(() => loadConfig({ ...base, PAYMENT_PROVIDER: 'sumup' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, PAYMENT_PROVIDER: 'sumup', SUMUP_API_KEY: 'sup_sk_live_abc', SUMUP_MERCHANT_CODE: 'M1' })).toThrow(/Live-Schlüssel/);
    expect(loadConfig({ ...base, PAYMENT_PROVIDER: 'sumup', SUMUP_API_KEY: 'sup_sk_test_abc', SUMUP_MERCHANT_CODE: 'M1' }).PAYMENT_PROVIDER).toBe('sumup');
    expect(
      loadConfig({ ...base, PAYMENT_PROVIDER: 'sumup', SUMUP_API_KEY: 'sup_sk_live_abc', SUMUP_MERCHANT_CODE: 'M1', ALLOW_LIVE_PAYMENTS: 'true' }).ALLOW_LIVE_PAYMENTS,
    ).toBe(true);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', PAYMENT_PROVIDER: 'fake' })).toThrow(ConfigError);
    // Fehlermeldungen nennen keine Werte
    try {
      loadConfig({ ...base, PAYMENT_PROVIDER: 'sumup', SUMUP_API_KEY: 'sup_sk_live_GEHEIM', SUMUP_MERCHANT_CODE: 'M1' });
    } catch (err) {
      expect(String(err)).not.toContain('GEHEIM');
    }
  });

  it('maskiert Tokens in geloggten Pfaden', () => {
    expect(maskUrlForLog('/api/v1/public/qr/AbC123xyz?x=1')).toBe('/api/v1/public/qr/[token]?x=1');
    expect(maskUrlForLog('/api/v1/public/shares/geheim-token')).toBe('/api/v1/public/shares/[token]');
  });
});

describe('Zustellung der Benachrichtigungen', () => {
  it('versendet E-Mail/Push, wiederholt mit Backoff und gibt nach Höchstzahl auf', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Zustellung');
    await h.db.insert(devices).values({ userId: customer.id, platform: 'ios', pushToken: 'ExponentPushToken[test-0001]' });
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId });
    await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: w.service.token, body: { clientMessageId: 'zustellung-0001', body: 'Hallo' } });
    const pending = await h.db.select().from(notifications).where(eq(notifications.userId, customer.id));
    expect(pending.map((n) => `${n.channel}:${n.status}`).sort()).toEqual(['email:pending', 'in_app:sent', 'push:pending']);

    // E-Mail-Dienst fällt aus
    let failing = true;
    const sent: string[] = [];
    const mailer: Mailer = {
      async send(m) {
        if (failing) throw new Error('SMTP nicht erreichbar');
        sent.push(m.to);
      },
    };
    const push = new LogPushSender(null);
    let now = new Date();
    const deps = { db: h.db, mailer, push, appBaseUrl: 'https://app.werkstatt.test', now: () => now };
    const first = await deliverPendingNotifications(deps);
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect(push.sent.some((p) => p.message.path === `/kunde/auftraege/${wo.id}/chat`)).toBe(true);
    const [emailRow] = await h.db.select().from(notifications).where(eq(notifications.dedupeKey, pending.find((n) => n.channel === 'email')!.dedupeKey));
    expect(emailRow).toMatchObject({ status: 'pending', attempts: 1, lastError: 'SMTP nicht erreichbar' });
    expect(emailRow!.nextAttemptAt.getTime() - now.getTime()).toBe(backoffDelayMs(1));
    // vor Ablauf des Backoffs kein neuer Versuch
    expect((await deliverPendingNotifications(deps)).retried).toBe(0);
    // Dienst wieder da → zugestellt, Link enthält nur den Pfad
    failing = false;
    now = new Date(now.getTime() + backoffDelayMs(1) + 1000);
    await deliverPendingNotifications(deps);
    const [delivered] = await h.db.select().from(notifications).where(eq(notifications.id, emailRow!.id));
    expect(delivered!.status).toBe('sent');
    expect(sent).toContain(customer.email);

    // dauerhafter Ausfall → nach Höchstzahl "failed"
    await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: w.service.token, body: { clientMessageId: 'zustellung-0002', body: 'Nochmal' } });
    failing = true;
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      await deliverPendingNotifications(deps);
      now = new Date(now.getTime() + 2 * 3600_000);
    }
    const failed = await h.db.select().from(notifications).where(eq(notifications.status, 'failed'));
    expect(failed.some((n) => n.userId === customer.id && n.channel === 'email' && n.attempts === MAX_DELIVERY_ATTEMPTS)).toBe(true);
  });
});

describe('CSV-Export', () => {
  it('Semikolon, UTF-8 mit BOM, Schutz vor Formeln; protokolliert', async () => {
    const { customer } = await customerWithVehicle(h, '=HYPERLINK("x")');
    await h.db.update(customers).set({ firstName: null }).where(eq(customers.id, customer.customerId!));
    await issueInvoice(h, w.service.token, { customerId: customer.customerId!, totalGrossCents: 12345, number: 'R-CSV-1' });
    const res = await call(h, 'GET', '/exports/invoices.csv', { token: w.service.token });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.rawPayload.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    const text = res.rawPayload.subarray(3).toString('utf8');
    const [header, ...lines] = text.trim().split('\r\n');
    expect(header!.split(';')[0]).toBe('Rechnungsnummer');
    const row = lines.find((l) => l.startsWith('R-CSV-1'))!;
    expect(row).toContain(';123,45;');
    expect(row).not.toMatch(/;=HYPERLINK/);
    expect(row).toContain("'=HYPERLINK");
    const audit = await h.db.select().from(auditLog).where(eq(auditLog.action, 'export.invoices_csv'));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });
});
