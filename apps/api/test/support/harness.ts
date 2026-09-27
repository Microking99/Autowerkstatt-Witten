/**
 * Test-Umgebung: App-Instanz (ohne Port) gegen eine eigene PostgreSQL-Datenbank, mit
 * Fake-Zahlungsanbieter, Log-Mailer/-Push und steuerbarer Uhr. Nur gekennzeichnete
 * Testdaten ([TEST]).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import type { z } from 'zod';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Permission, Role } from '@werkstatt/contracts';
import { buildApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { createDatabase, type DatabaseHandle, type Db } from '../../src/db/index';
import { customerAccounts, customers, userPermissionOverrides, users, vehicleOwnerships, vehicles, workshopSettings } from '../../src/db/schema/index';
import { hashPassword, randomToken } from '../../src/lib/crypto';
import { LogMailer, LogPushSender } from '../../src/notifications/channels';
import { FakePaymentProvider } from '../../src/payments/fakeProvider';
import type { App } from '../../src/types';
import { createTestDatabase, dropTestDatabase } from './database';

export const TEST_PASSWORD = 'Test-Passwort-123';
let passwordHashCache: Promise<string> | null = null;
export function testPasswordHash(): Promise<string> {
  passwordHashCache ??= hashPassword(TEST_PASSWORD);
  return passwordHashCache;
}

/** Uhr der App: läuft mit der Echtzeit, lässt sich für Tests vorstellen. */
export interface Clock {
  offsetMs: number;
  now(): Date;
  advance(ms: number): void;
}

export interface Harness {
  app: App;
  db: Db;
  database: DatabaseHandle;
  dbName: string;
  dbUrl: string;
  config: AppConfig;
  fake: FakePaymentProvider;
  mailer: LogMailer;
  push: LogPushSender;
  clock: Clock;
  storageDir: string;
  /** App neu starten (gleiche Datenbank), z. B. für T-12 */
  restart(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(env: Record<string, string> = {}): Promise<Harness> {
  const { name, url } = await createTestDatabase();
  const storageDir = await mkdtemp(path.join(tmpdir(), 'werkstatt-files-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: url,
    DATABASE_POOL_MAX: '5',
    FILE_STORAGE_DIR: storageDir,
    APP_BASE_URL: 'https://app.werkstatt.test',
    API_PUBLIC_URL: 'https://api.werkstatt.test',
    AUTH_RATE_LIMIT_MAX: '1000',
    PAYMENT_PROVIDER: 'fake',
    PAYMENT_REFRESH_MIN_SECONDS: '0',
    ...env,
  });
  const clock: Clock = {
    offsetMs: 0,
    now() {
      return new Date(Date.now() + this.offsetMs);
    },
    advance(ms: number) {
      this.offsetMs += ms;
    },
  };
  const fake = new FakePaymentProvider();
  const mailer = new LogMailer(null);
  const push = new LogPushSender(null);
  let database = createDatabase(url, { max: 5 });
  const make = () => buildApp({ config, database, overrides: { payments: fake, mailer, push, now: () => clock.now() } });
  const harness: Harness = {
    app: await make(),
    db: database.db,
    database,
    dbName: name,
    dbUrl: url,
    config,
    fake,
    mailer,
    push,
    clock,
    storageDir,
    async restart() {
      await harness.app.close();
      await database.close();
      database = createDatabase(url, { max: 5 });
      harness.database = database;
      harness.db = database.db;
      harness.app = await make();
      await harness.app.ready();
    },
    async close() {
      await harness.app.close();
      await database.close();
      await dropTestDatabase(name);
      await rm(storageDir, { recursive: true, force: true });
    },
  };
  await harness.app.ready();
  await harness.db
    .insert(workshopSettings)
    .values({
      id: 1,
      name: 'Autowerkstatt Witten [TEST]',
      legalName: 'Autowerkstatt Witten [TEST]',
      iban: 'DE02120300000000202051',
      bic: 'BYLADEM1001',
      paymentProvider: 'sumup',
      paymentTermDays: 14,
    })
    .onConflictDoNothing();
  return harness;
}

// Aufrufe ------------------------------------------------------------------------------------

export interface CallOptions {
  token?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export async function call(h: Harness, method: InjectOptions['method'], url: string, opts: CallOptions = {}): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return h.app.inject({
    method,
    url: url.startsWith('/api/') ? url : `/api/v1${url}`,
    headers,
    query: opts.query,
    ...(opts.body !== undefined ? { payload: opts.body as InjectOptions['payload'] } : {}),
  });
}

/** Prüft Status und validiert den Körper gegen das Vertrags-Schema. */
export function expectOk<S extends z.ZodTypeAny>(res: LightMyRequestResponse, schema: S, status = 200): z.infer<S> {
  if (res.statusCode !== status) {
    throw new Error(`Erwartet ${status}, erhalten ${res.statusCode}: ${res.body}`);
  }
  const parsed = schema.safeParse(res.json());
  if (!parsed.success) throw new Error(`Antwort entspricht nicht dem Vertrag: ${JSON.stringify(parsed.error.issues)}\n${res.body}`);
  return parsed.data;
}

export function expectStatus(res: LightMyRequestResponse, status: number, code?: string): void {
  if (res.statusCode !== status) throw new Error(`Erwartet ${status}, erhalten ${res.statusCode}: ${res.body}`);
  if (code) expect(res.json().error.code).toBe(code);
}

// Testdaten ------------------------------------------------------------------------------------

export interface TestUser {
  id: string;
  email: string;
  token: string;
  role: Role;
  customerId: string | null;
}

let counter = 0;
function uniq(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}${randomToken(3)}`.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function login(h: Harness, email: string, password = TEST_PASSWORD): Promise<string> {
  const res = await call(h, 'POST', '/auth/login', { body: { email, password } });
  if (res.statusCode !== 200) throw new Error(`Anmeldung fehlgeschlagen: ${res.body}`);
  return res.json().token as string;
}

export async function createStaff(
  h: Harness,
  role: 'admin' | 'service' | 'mechanic',
  opts: { overrides?: { permission: Permission; granted: boolean }[]; name?: string } = {},
): Promise<TestUser> {
  const email = `${role}.${uniq()}@beispiel.test`;
  const [user] = await h.db
    .insert(users)
    .values({ email, displayName: opts.name ?? `[TEST] ${role}`, role, status: 'active', passwordHash: await testPasswordHash() })
    .returning();
  if (opts.overrides?.length) {
    await h.db.insert(userPermissionOverrides).values(opts.overrides.map((o) => ({ userId: user!.id, permission: o.permission, granted: o.granted })));
  }
  return { id: user!.id, email, token: await login(h, email), role, customerId: null };
}

export async function createCustomerRecord(h: Harness, lastName = 'Kunde'): Promise<string> {
  const [c] = await h.db
    .insert(customers)
    .values({ customerNumber: `K-T${uniq()}`, kind: 'private', firstName: '[TEST]', lastName, isTestData: true })
    .returning();
  return c!.id;
}

/** Kundendatensatz mit aktivem Kundenkonto. */
export async function createCustomer(h: Harness, lastName = 'Kunde'): Promise<TestUser> {
  const customerId = await createCustomerRecord(h, lastName);
  const email = `kunde.${uniq()}@beispiel.test`;
  const [user] = await h.db
    .insert(users)
    .values({ email, displayName: `[TEST] ${lastName}`, role: 'customer', status: 'active', passwordHash: await testPasswordHash() })
    .returning();
  await h.db.insert(customerAccounts).values({ customerId, userId: user!.id });
  return { id: user!.id, email, token: await login(h, email), role: 'customer', customerId };
}

let plateCounter = 100;
export async function createVehicle(h: Harness, ownerCustomerId: string, opts: { make?: string; model?: string; vin?: string | null } = {}): Promise<string> {
  plateCounter += 1;
  const plate = `EN-T ${plateCounter}`;
  const [v] = await h.db
    .insert(vehicles)
    .values({
      licensePlate: plate,
      licensePlateNormalized: plate.replace(/[^A-Z0-9]/g, ''),
      vin: opts.vin === undefined ? null : opts.vin,
      make: opts.make ?? 'Volkswagen',
      model: opts.model ?? 'Golf',
      qrToken: randomToken(24),
      isTestData: true,
    })
    .returning();
  await h.db.insert(vehicleOwnerships).values({ vehicleId: v!.id, customerId: ownerCustomerId, startedAt: new Date(Date.now() - 86_400_000 * 400) });
  return v!.id;
}

export async function userById(h: Harness, id: string) {
  const [u] = await h.db.select().from(users).where(eq(users.id, id));
  return u!;
}

/** Minimale gültige Dateien für Upload-Tests */
export const SAMPLE_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201ffa1f1d1b20000000049454e44ae426082',
  'hex',
);
export const SAMPLE_PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'utf8');

export function multipartBody(fileName: string, contentType: string, data: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----werkstatt${randomToken(8)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { payload: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export async function uploadFile(h: Harness, token: string, fileName: string, contentType: string, data: Buffer): Promise<LightMyRequestResponse> {
  const { payload, headers } = multipartBody(fileName, contentType, data);
  return h.app.inject({ method: 'POST', url: '/api/v1/files', headers: { ...headers, authorization: `Bearer ${token}` }, payload });
}
