/**
 * Nur für automatisierte Oberflächentests der App gegen die echte API (apps/app/e2e-api).
 *
 * Startet die API mit einer FRISCHEN Testdatenbank (`werkstatt_e2e`), dem Test-Zahlungsanbieter
 * und klar gekennzeichneten Testdaten ([TEST]). Zusätzlich lauscht ein Steuerport nur auf
 * 127.0.0.1, über den ein Test eine Anbieterbestätigung simulieren kann; die API prüft diese
 * dann wie im Betrieb über den Webhook und die Abfrage beim Anbieter (kein Sonderweg).
 *
 * Sicherheitsriegel: läuft nur mit NODE_ENV=test, gesetztem E2E_PASSWORD (zufällig je Lauf,
 * wird nirgends gespeichert) und einer Datenbank, deren Name "e2e" enthält.
 *
 *   E2E_PASSWORD=… E2E_FIXTURE_FILE=… tsx scripts/e2e-server.ts
 */
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDatabase, runMigrations } from '../src/db/index';
import { customerAccounts, customers, maintenanceTypes, users, vehicleOwnerships, vehicles, workshopSettings } from '../src/db/schema/index';
import { hashPassword } from '../src/lib/crypto';
import { LogMailer, LogPushSender } from '../src/notifications/channels';
import { FakePaymentProvider } from '../src/payments/fakeProvider';

const password = process.env.E2E_PASSWORD;
const baseUrl = process.env.E2E_ADMIN_DATABASE_URL ?? 'postgres://werkstatt@127.0.0.1:54329/postgres';
const dbName = process.env.E2E_DATABASE_NAME ?? 'werkstatt_e2e';
const port = Number(process.env.E2E_API_PORT ?? 3100);
const controlPort = Number(process.env.E2E_CONTROL_PORT ?? 3101);
const appOrigin = process.env.E2E_APP_ORIGIN ?? 'http://127.0.0.1:4174';
const fixtureFile = process.env.E2E_FIXTURE_FILE;

if (process.env.NODE_ENV !== 'test' || !password || password.length < 12 || !/e2e/.test(dbName) || !/^[a-z0-9_]+$/.test(dbName)) {
  console.error('e2e-server: nur mit NODE_ENV=test, E2E_PASSWORD (mind. 12 Zeichen) und Datenbanknamen mit "e2e".');
  process.exit(1);
}

async function admin(sqlText: string): Promise<void> {
  const client = new pg.Client({ connectionString: baseUrl });
  await client.connect();
  try {
    await client.query(sqlText);
  } finally {
    await client.end();
  }
}

const dbUrl = (() => {
  const u = new URL(baseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
await admin(`CREATE DATABASE ${dbName}`);
const database = createDatabase(dbUrl, { max: 10 });
await runMigrations(database.db);

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
  HOST: '127.0.0.1',
  PORT: String(port),
  DATABASE_URL: dbUrl,
  FILE_STORAGE_DIR: mkdtempSync(path.join(tmpdir(), 'werkstatt-e2e-files-')),
  APP_ORIGINS: appOrigin,
  APP_BASE_URL: appOrigin,
  API_PUBLIC_URL: `http://127.0.0.1:${port}`,
  AUTH_RATE_LIMIT_MAX: '1000',
  PAYMENT_PROVIDER: 'fake',
  PAYMENT_REFRESH_MIN_SECONDS: '0',
  BACKGROUND_JOBS: 'false',
});
const fake = new FakePaymentProvider();
const app = await buildApp({ config, database, overrides: { payments: fake, mailer: new LogMailer(null), push: new LogPushSender(null) } });
await app.ready();
const db = database.db;

// Grunddaten -------------------------------------------------------------------------------
await db.insert(workshopSettings).values({
  id: 1,
  name: 'Autowerkstatt Witten [TEST]',
  legalName: 'Autowerkstatt Witten [TEST]',
  iban: 'DE02120300000000202051',
  bic: 'BYLADEM1001',
  paymentProvider: 'sumup',
  paymentTermDays: 14,
});
const [oil] = await db
  .insert(maintenanceTypes)
  .values({ key: 'oil_change', name: 'Ölwechsel', defaultIntervalKm: 15000, defaultIntervalMonths: 12, intervalOptions: [], sortOrder: 10 })
  .returning();

const hash = await hashPassword(password);
async function user(email: string, displayName: string, role: 'admin' | 'service' | 'mechanic' | 'customer') {
  const [u] = await db.insert(users).values({ email, displayName, role, status: 'active', passwordHash: hash }).returning();
  return u!;
}
const adminUser = await user('inhaber.e2e@beispiel.test', '[TEST] Inhaber', 'admin');
const serviceUser = await user('service.e2e@beispiel.test', '[TEST] Service', 'service');
const mechanicUser = await user('mechaniker.e2e@beispiel.test', '[TEST] Mechaniker', 'mechanic');

let customerNo = 90000;
async function customer(firstName: string, lastName: string, email: string) {
  customerNo += 1;
  const [c] = await db
    .insert(customers)
    .values({ customerNumber: `K-E2E${customerNo}`, kind: 'private', firstName, lastName, email, isTestData: true })
    .returning();
  const u = await user(email, `[TEST] ${firstName} ${lastName}`, 'customer');
  await db.insert(customerAccounts).values({ customerId: c!.id, userId: u.id });
  return { customer: c!, user: u };
}
let plate = 700;
async function vehicle(ownerId: string, make: string, model: string) {
  plate += 1;
  const [v] = await db
    .insert(vehicles)
    .values({
      licensePlate: `EN-TE ${plate}`,
      licensePlateNormalized: `ENTE${plate}`,
      make,
      model,
      qrToken: `qr_e2e_${plate}_${Math.random().toString(36).slice(2, 14)}`,
      isTestData: true,
    })
    .returning();
  await db.insert(vehicleOwnerships).values({ vehicleId: v!.id, customerId: ownerId, startedAt: new Date(Date.now() - 400 * 86_400_000) });
  return v!;
}

const a = await customer('Anna', 'Beispiel', 'kundin.e2e@beispiel.test');
const b = await customer('Bernd', 'Fremd', 'fremd.e2e@beispiel.test');
const golf = await vehicle(a.customer.id, 'Volkswagen', 'Golf [TEST]');
const octavia = await vehicle(a.customer.id, 'Škoda', 'Octavia [TEST]');
const foreignVehicle = await vehicle(b.customer.id, 'Opel', 'Astra [TEST]');

// Abläufe über die echte API (gleiche Regeln wie im Betrieb) ---------------------------------
async function login(email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`Anmeldung ${email} fehlgeschlagen: ${res.body}`);
  return res.json().token as string;
}
async function api<T = Record<string, unknown>>(token: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown, query?: Record<string, string>): Promise<T> {
  const res = await app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` }, payload: payload as never, query });
  if (res.statusCode >= 300) throw new Error(`${method} ${url} → ${res.statusCode}: ${res.body}`);
  return res.json() as T;
}
const serviceToken = await login(serviceUser.email);

const orderA = await api<{ id: string; items: { id: string }[] }>(serviceToken, 'POST', '/work-orders', {
  customerId: a.customer.id,
  vehicleId: golf.id,
  title: '[TEST] Inspektion mit Ölwechsel',
  assigneeIds: [mechanicUser.id],
  items: [{ kind: 'labor', title: 'Ölwechsel inkl. Filter', maintenanceTypeId: oil!.id, quantity: 1, unit: 'Pauschale', unitPriceCents: 8900, vatRateBp: 1900 }],
});
const approvalDraft = await api<{ id: string }>(serviceToken, 'POST', `/work-orders/${orderA.id}/approvals`, {
  kind: 'additional_work',
  title: '[TEST] Bremsbeläge vorne',
  summaryCustomer: 'Die Bremsbeläge vorne sind fast abgefahren. Wir empfehlen den Austausch.',
  lines: [{ title: 'Bremsbeläge vorne erneuern', description: null, quantity: 1, unit: 'Satz', unitPriceCents: 15958, vatRateBp: 1900, maintenanceTypeId: null }],
  photoIds: [],
});
await api(serviceToken, 'POST', `/approvals/${approvalDraft.id}/send`);

const orderB = await api<{ id: string }>(serviceToken, 'POST', '/work-orders', {
  customerId: b.customer.id,
  vehicleId: foreignVehicle.id,
  title: '[TEST] Fremder Auftrag',
  assigneeIds: [],
  items: [],
});

const invoice = await api<{ id: string }>(serviceToken, 'POST', '/invoices', { customerId: a.customer.id, workOrderId: orderA.id, totalGrossCents: 12990 });
await api(serviceToken, 'POST', `/invoices/${invoice.id}/issue`, { invoiceNumber: 'R-E2E-0001' });

const fixture = {
  appOrigin,
  apiUrl: `http://127.0.0.1:${port}`,
  controlUrl: `http://127.0.0.1:${controlPort}`,
  users: {
    admin: adminUser.email,
    service: serviceUser.email,
    mechanic: mechanicUser.email,
    customer: a.user.email,
    foreignCustomer: b.user.email,
  },
  customerId: a.customer.id,
  vehicles: { golf: golf.id, octavia: octavia.id, foreign: foreignVehicle.id },
  qrTokenGolf: golf.qrToken,
  workOrderId: orderA.id,
  oilItemId: orderA.items[0]!.id,
  approvalId: approvalDraft.id,
  foreignWorkOrderId: orderB.id,
  invoiceId: invoice.id,
};
if (fixtureFile) writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2));

// Steuerport (nur localhost): Anbieterbestätigung simulieren ---------------------------------
const control = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${controlPort}`);
  const done = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST' || url.pathname !== '/fake-provider/pay-latest') return done(404, { error: 'unbekannt' });
  void (async () => {
    const last = fake.lastCheckout();
    if (!last) return done(409, { error: 'kein Zahlungsversuch' });
    fake.markPaid(last.id);
    // Webhook wie vom Anbieter: nur Ereignistyp und ID; die API fragt den Status selbst ab
    const hook = await app.inject({ method: 'POST', url: '/api/v1/webhooks/sumup', payload: { event_type: 'CHECKOUT_STATUS_CHANGED', id: last.id } });
    done(200, { checkoutId: last.id, webhookStatus: hook.statusCode });
  })().catch((err: unknown) => done(500, { error: err instanceof Error ? err.message : String(err) }));
});
control.listen(controlPort, '127.0.0.1');

await app.listen({ host: '127.0.0.1', port });
console.log(`e2e-server bereit: API ${fixture.apiUrl}, Steuerung ${fixture.controlUrl}`);

const shutdown = async () => {
  control.close();
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
