/**
 * Grunddaten anlegen (idempotent):
 *   pnpm --filter @werkstatt/api db:seed           # Werkstatt, Wartungsarten, Hebebühnen, Admin-Einladung
 *   pnpm --filter @werkstatt/api db:seed --demo    # zusätzlich klar gekennzeichnete Testdaten ([TEST])
 *
 * Es wird KEIN Admin mit Standardpasswort angelegt: Für ADMIN_EMAIL entsteht eine Einladung,
 * deren Link einmalig auf der Konsole ausgegeben wird (7 Tage gültig, einmal verwendbar).
 */
import { and, eq } from 'drizzle-orm';
import { createDatabase } from '../src/db/index';
import {
  appointments,
  customers,
  maintenanceTypes,
  odometerReadings,
  resources,
  users,
  vehicleOwnerships,
  vehicles,
  workItems,
  workOrderAssignees,
  workOrders,
  workshopSettings,
  type IntervalOption,
} from '../src/db/schema/index';
import { createInvitation, invitationLink } from '../src/auth/invitations';
import { randomToken } from '../src/lib/crypto';
import { nextCustomerNumber, nextOrderNumber } from '../src/services/customers';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL fehlt (siehe apps/api/.env.example).');
  process.exit(1);
}
const demo = process.argv.includes('--demo');
const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:8081';
const adminEmail = process.env.ADMIN_EMAIL;

const km = (value: number): IntervalOption => ({ km: value, months: null, label: `alle ${value.toLocaleString('de-DE')} km` });
const months = (value: number): IntervalOption => ({ km: null, months: value, label: value === 12 ? 'jährlich (12 Monate)' : `alle ${value} Monate` });

/** Standard-Wartungsarten (R-SERV-3); Werte sind Voreinstellungen und in den Einstellungen änderbar. */
const MAINTENANCE_TYPES = [
  { key: 'oil_change', name: 'Ölwechsel', defaultIntervalKm: 15000, defaultIntervalMonths: 12, intervalOptions: [km(10000), km(15000), months(12), months(24)], sortOrder: 10 },
  { key: 'inspection', name: 'Inspektion', defaultIntervalKm: 30000, defaultIntervalMonths: 24, intervalOptions: [km(15000), km(30000), months(12), months(24)], sortOrder: 20 },
  { key: 'timing_belt', name: 'Zahnriemen', defaultIntervalKm: 120000, defaultIntervalMonths: 72, intervalOptions: [km(90000), km(120000), months(60), months(72)], sortOrder: 30 },
  { key: 'brakes_front', name: 'Bremsen vorne', defaultIntervalKm: null, defaultIntervalMonths: null, intervalOptions: [km(30000), km(50000)], sortOrder: 40 },
  { key: 'brakes_rear', name: 'Bremsen hinten', defaultIntervalKm: null, defaultIntervalMonths: null, intervalOptions: [km(40000), km(60000)], sortOrder: 50 },
  { key: 'brake_fluid', name: 'Bremsflüssigkeit', defaultIntervalKm: null, defaultIntervalMonths: 24, intervalOptions: [months(12), months(24)], sortOrder: 60 },
  { key: 'hu', name: 'Hauptuntersuchung (HU)', defaultIntervalKm: null, defaultIntervalMonths: 24, intervalOptions: [months(12), months(24)], sortOrder: 70 },
] as const;

const handle = createDatabase(url, { max: 2 });
const db = handle.db;

try {
  await db
    .insert(workshopSettings)
    .values({
      id: 1,
      name: 'Autowerkstatt Witten',
      city: 'Witten',
      openingHours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: '07:30', closes: '18:00' })).concat([{ weekday: 6, opens: '08:00', closes: '12:00' }]),
      paymentTermDays: 14,
      paymentProvider: 'none',
    })
    .onConflictDoNothing();
  console.log('Werkstatt-Einstellungen: vorhanden.');

  for (const t of MAINTENANCE_TYPES) {
    await db
      .insert(maintenanceTypes)
      .values({ ...t, intervalOptions: [...t.intervalOptions] })
      .onConflictDoNothing({ target: maintenanceTypes.key });
  }
  console.log(`Wartungsarten: ${MAINTENANCE_TYPES.length} Standardarten vorhanden.`);

  const existingResources = await db.select({ id: resources.id }).from(resources);
  if (existingResources.length === 0) {
    await db.insert(resources).values([
      { name: 'Hebebühne 1', kind: 'lift' },
      { name: 'Hebebühne 2', kind: 'lift' },
      { name: 'Diagnoseplatz', kind: 'diagnosis' },
    ]);
    console.log('Hebebühnen/Arbeitsplätze angelegt.');
  }

  if (adminEmail) {
    const [existing] = await db.select().from(users).where(eq(users.email, adminEmail));
    if (existing && existing.status === 'active') {
      console.log('Admin-Konto für ADMIN_EMAIL ist bereits aktiv; keine neue Einladung.');
    } else {
      const user =
        existing ??
        (await db.insert(users).values({ email: adminEmail, displayName: 'Inhaber', role: 'admin', status: 'invited' }).returning())[0]!;
      if (user.role !== 'admin') {
        console.error('Für ADMIN_EMAIL existiert bereits ein Konto mit anderer Rolle. Abbruch.');
        process.exitCode = 1;
      } else {
        const invitation = await createInvitation(db, { userId: user.id, purpose: 'staff', createdBy: null, ttlDays: 7, now: new Date() });
        console.log('\nEinladung für den Admin (einmalig angezeigt, 7 Tage gültig, nur einmal verwendbar):');
        console.log(`  ${invitationLink(appBaseUrl, invitation.token)}`);
        console.log(`  Token für POST /api/v1/auth/invitations/accept: ${invitation.token}\n`);
      }
    }
  } else {
    console.log('Hinweis: ADMIN_EMAIL ist nicht gesetzt, daher keine Admin-Einladung erzeugt.');
  }

  if (demo) {
    const [marker] = await db.select({ id: customers.id }).from(customers).where(eq(customers.companyName, '[TEST] Beispielkunde GmbH'));
    if (marker) {
      console.log('Demo-Testdaten sind bereits vorhanden.');
    } else {
      const now = new Date();
      const [privateCustomer] = await db
        .insert(customers)
        .values({ customerNumber: await nextCustomerNumber(db), kind: 'private', firstName: '[TEST] Anna', lastName: 'Beispiel', email: 'anna.beispiel@beispiel.test', phone: '02302 000000', city: 'Witten', isTestData: true })
        .returning();
      const [businessCustomer] = await db
        .insert(customers)
        .values({ customerNumber: await nextCustomerNumber(db), kind: 'business', companyName: '[TEST] Beispielkunde GmbH', email: 'firma@beispiel.test', city: 'Witten', isTestData: true })
        .returning();
      const mkVehicle = async (plate: string, make: string, model: string, ownerId: string) => {
        const [v] = await db
          .insert(vehicles)
          .values({ licensePlate: plate, licensePlateNormalized: plate.replace(/[^A-Z0-9]/g, ''), make, model, qrToken: randomToken(24), isTestData: true })
          .returning();
        await db.insert(vehicleOwnerships).values({ vehicleId: v!.id, customerId: ownerId, startedAt: new Date(now.getTime() - 400 * 86_400_000) });
        await db.insert(odometerReadings).values({ vehicleId: v!.id, valueKm: 48210, recordedAt: new Date(now.getTime() - 200 * 86_400_000), source: 'staff' });
        return v!;
      };
      const golf = await mkVehicle('EN-TE 101', 'Volkswagen', 'Golf [TEST]', privateCustomer!.id);
      await mkVehicle('EN-TE 102', 'Opel', 'Corsa [TEST]', privateCustomer!.id);
      await mkVehicle('EN-TE 201', 'Ford', 'Transit [TEST]', businessCustomer!.id);
      const [mechanic] = await db
        .insert(users)
        .values({ email: 'mechaniker@beispiel.test', displayName: '[TEST] Mechaniker', role: 'mechanic', status: 'invited' })
        .onConflictDoNothing()
        .returning();
      const [oil] = await db.select().from(maintenanceTypes).where(eq(maintenanceTypes.key, 'oil_change'));
      const [wo] = await db
        .insert(workOrders)
        .values({
          orderNumber: await nextOrderNumber(db, now.getUTCFullYear()),
          customerId: privateCustomer!.id,
          vehicleId: golf.id,
          status: 'open',
          title: '[TEST] Inspektion mit Ölwechsel',
          descriptionCustomer: 'Beispielauftrag (Testdaten).',
        })
        .returning();
      if (mechanic) await db.insert(workOrderAssignees).values({ workOrderId: wo!.id, userId: mechanic.id });
      await db.insert(workItems).values([
        { workOrderId: wo!.id, position: 1, kind: 'labor', title: 'Ölwechsel', maintenanceTypeId: oil?.id ?? null, quantity: 1, unit: 'Std', unitPriceCents: 8900, origin: 'intake', authorization: 'agreed' },
        { workOrderId: wo!.id, position: 2, kind: 'part', title: 'Motoröl 5W-30', quantity: 5, unit: 'l', unitPriceCents: 1450, origin: 'intake', authorization: 'agreed' },
      ]);
      await db.insert(appointments).values({
        kind: 'service',
        status: 'requested',
        customerId: businessCustomer!.id,
        vehicleId: (await db.select().from(vehicles).where(and(eq(vehicles.licensePlate, 'EN-TE 201'))))[0]!.id,
        startsAt: new Date(now.getTime() + 3 * 86_400_000),
        endsAt: new Date(now.getTime() + 3 * 86_400_000 + 2 * 3600_000),
        requestedBy: 'customer',
        customerNote: '[TEST] Bitte Service durchführen.',
      });
      console.log('Demo-Testdaten angelegt (alle mit [TEST] bzw. is_test_data gekennzeichnet).');
    }
  }
} catch (err) {
  console.error('Seed fehlgeschlagen:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await handle.close();
}
