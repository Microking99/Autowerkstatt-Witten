/**
 * Datenexport für Betroffene (DSGVO Art. 15 Auskunft, Art. 20 Datenübertragbarkeit).
 *
 * Zwei Umfänge:
 * - `self`: Selbstauskunft des Kunden in der App. Enthält alles, was der Kunde auch in der App
 *   sehen darf (keine internen Notizen, keine internen Dokumente/Fotos, keine Entwürfe).
 * - `full`: Export durch die Werkstatt für eine vollständige Auskunft. Enthält zusätzlich
 *   interne Notizen und interne Dokumente über den Kunden. Die Werkstatt prüft diesen Export
 *   vor der Herausgabe (Rechte Dritter, Geschäftsgeheimnisse), siehe
 *   docs/pruefpunkte-recht-und-betrieb.md.
 *
 * Nie enthalten: Passwort-Hashes, Token-Hashes, QR-Token, Push-Token, Daten anderer Kunden
 * (z. B. Aufträge eines Vorbesitzers). Dateien werden vollständig in den Speicher gelesen;
 * für sehr große Bestände ist später ein Streaming-ZIP nötig.
 */
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { Readable } from 'node:stream';
import {
  appointmentProposals,
  appointments,
  approvalDecisions,
  approvalRequests,
  approvalVersions,
  auditLog,
  checkouts,
  customerAccounts,
  customers,
  devices,
  documentVersions,
  documents,
  files,
  intakes,
  internalNotes,
  invoices,
  messageAttachments,
  messages,
  notificationPreferences,
  notifications,
  odometerReadings,
  payments,
  photos,
  refunds,
  serviceEntries,
  users,
  vehicleOwnerships,
  vehicleShares,
  vehicles,
  workItems,
  workOrders,
} from '../db/schema/index';
import type { Db } from '../db/index';
import type { FileStorage } from '../storage/fileStorage';

export type ExportScope = 'self' | 'full';

/** Felder, die nie exportiert werden (Zugangsgeheimnisse, technische Schlüssel). */
const NEVER_EXPORTED = new Set(['passwordHash', 'tokenHash', 'qrToken', 'pushToken', 'storageKey', 'hostedUrl']);
/** Felder, die nur im vollständigen Export enthalten sind. */
const FULL_ONLY = new Set(['notesInternal', 'internalNote']);

function clean<T extends Record<string, unknown>>(row: T, scope: ExportScope): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (NEVER_EXPORTED.has(key)) continue;
    if (scope === 'self' && FULL_ONLY.has(key)) continue;
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

const cleanAll = <T extends Record<string, unknown>>(rows: T[], scope: ExportScope) => rows.map((r) => clean(r, scope));

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

function safeName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : 'datei';
}

export interface DataExportResult {
  zip: Uint8Array;
  fileName: string;
  counts: Record<string, number>;
}

const README = (scope: ExportScope, createdAt: string) => `Datenexport der Autowerkstatt Witten
Erstellt: ${createdAt}
Umfang: ${scope === 'self' ? 'Selbstauskunft (alle in der App sichtbaren Daten)' : 'Vollständiger Export durch die Werkstatt (inkl. interner Notizen und Dokumente, vor Herausgabe prüfen)'}

Inhalt:
- daten.json: alle Datensätze im JSON-Format (maschinenlesbar, DSGVO Art. 20)
- dokumente/: Dokumente in der jeweils aktuellen Version
- fotos/: Fotos zu Ihren Aufträgen

Zeitangaben in UTC (ISO 8601), Beträge in Cent (EUR).
Nicht enthalten: Zugangsgeheimnisse (Passwort- und Token-Prüfwerte) sowie Daten anderer Personen.
`;

export async function buildCustomerExport(
  deps: { db: Db; storage: FileStorage; now: () => Date },
  customerId: string,
  scope: ExportScope,
): Promise<DataExportResult> {
  const { db, storage } = deps;
  const createdAt = deps.now().toISOString();

  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
  if (!customer) throw new Error('Kunde nicht gefunden');

  const accountRows = await db
    .select({ user: users })
    .from(customerAccounts)
    .innerJoin(users, eq(users.id, customerAccounts.userId))
    .where(eq(customerAccounts.customerId, customerId));
  const account = accountRows[0]?.user ?? null;

  const ownerships = await db.select().from(vehicleOwnerships).where(eq(vehicleOwnerships.customerId, customerId));
  const vehicleIds = [...new Set(ownerships.map((o) => o.vehicleId))];
  const currentVehicleIds = ownerships.filter((o) => o.endedAt === null).map((o) => o.vehicleId);
  const vehicleRows = vehicleIds.length ? await db.select().from(vehicles).where(inArray(vehicles.id, vehicleIds)) : [];

  // Kilometerstände nur aus den eigenen Halterzeiträumen
  const readings = vehicleIds.length ? await db.select().from(odometerReadings).where(inArray(odometerReadings.vehicleId, vehicleIds)) : [];
  const ownReadings = readings.filter((r) =>
    ownerships.some(
      (o) => o.vehicleId === r.vehicleId && r.recordedAt >= o.startedAt && (o.endedAt === null || r.recordedAt <= o.endedAt),
    ),
  );

  const orderRows = await db
    .select()
    .from(workOrders)
    .where(scope === 'self' ? and(eq(workOrders.customerId, customerId), ne(workOrders.status, 'draft')) : eq(workOrders.customerId, customerId));
  const orderIds = orderRows.map((o) => o.id);
  const byOrder = <T>(q: () => Promise<T[]>): Promise<T[]> => (orderIds.length ? q() : Promise.resolve([]));

  const itemRows = await byOrder(() => db.select().from(workItems).where(inArray(workItems.workOrderId, orderIds)));
  const intakeRows = await byOrder(() => db.select().from(intakes).where(inArray(intakes.workOrderId, orderIds)));
  const requestRows = await byOrder(() =>
    db
      .select()
      .from(approvalRequests)
      .where(
        scope === 'self'
          ? and(inArray(approvalRequests.workOrderId, orderIds), ne(approvalRequests.status, 'draft'))
          : inArray(approvalRequests.workOrderId, orderIds),
      ),
  );
  const requestIds = requestRows.map((r) => r.id);
  const versionRows = requestIds.length
    ? await db
        .select()
        .from(approvalVersions)
        .where(scope === 'self' ? and(inArray(approvalVersions.requestId, requestIds), isNotNull(approvalVersions.sentAt)) : inArray(approvalVersions.requestId, requestIds))
    : [];
  const versionIds = versionRows.map((v) => v.id);
  const decisionRows = versionIds.length ? await db.select().from(approvalDecisions).where(inArray(approvalDecisions.versionId, versionIds)) : [];

  const messageRows = await byOrder(() => db.select().from(messages).where(and(inArray(messages.workOrderId, orderIds), isNull(messages.deletedAt))));
  const messageIds = messageRows.map((m) => m.id);
  const attachmentRows = messageIds.length ? await db.select().from(messageAttachments).where(inArray(messageAttachments.messageId, messageIds)) : [];
  const noteRows = scope === 'full' ? await byOrder(() => db.select().from(internalNotes).where(inArray(internalNotes.workOrderId, orderIds))) : [];

  const photoRows = await byOrder(() =>
    db
      .select({ photo: photos, file: files })
      .from(photos)
      .innerJoin(files, eq(files.id, photos.fileId))
      .where(scope === 'self' ? and(inArray(photos.workOrderId, orderIds), eq(photos.visibility, 'customer')) : inArray(photos.workOrderId, orderIds)),
  );

  const appointmentRows = await db.select().from(appointments).where(eq(appointments.customerId, customerId));
  const appointmentIds = appointmentRows.map((a) => a.id);
  const proposalRows = appointmentIds.length ? await db.select().from(appointmentProposals).where(inArray(appointmentProposals.appointmentId, appointmentIds)) : [];

  const invoiceRows = await db
    .select()
    .from(invoices)
    .where(scope === 'self' ? and(eq(invoices.customerId, customerId), ne(invoices.status, 'draft')) : eq(invoices.customerId, customerId));
  const invoiceIds = invoiceRows.map((i) => i.id);
  const paymentRows = invoiceIds.length ? await db.select().from(payments).where(inArray(payments.invoiceId, invoiceIds)) : [];
  const paymentIds = paymentRows.map((p) => p.id);
  const refundRows = paymentIds.length ? await db.select().from(refunds).where(inArray(refunds.paymentId, paymentIds)) : [];
  const checkoutRows = invoiceIds.length ? await db.select().from(checkouts).where(inArray(checkouts.invoiceId, invoiceIds)) : [];

  const documentRows = await db
    .select({ doc: documents, file: files })
    .from(documents)
    .innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
    .innerJoin(files, eq(files.id, documentVersions.fileId))
    .where(
      scope === 'self'
        ? and(eq(documents.customerId, customerId), eq(documents.visibility, 'customer'), isNotNull(documents.publishedAt), isNull(documents.deletedAt))
        : and(eq(documents.customerId, customerId), isNull(documents.deletedAt)),
    );

  // Servicehistorie der aktuell gehaltenen Fahrzeuge; Auftragsbezug nur bei eigenen Aufträgen
  const entryRows = currentVehicleIds.length ? await db.select().from(serviceEntries).where(inArray(serviceEntries.vehicleId, currentVehicleIds)) : [];
  const ownOrderIds = new Set(orderIds);
  const entries = entryRows.map((e) => ({ ...e, workOrderId: e.workOrderId && ownOrderIds.has(e.workOrderId) ? e.workOrderId : null, workItemId: e.workOrderId && ownOrderIds.has(e.workOrderId) ? e.workItemId : null }));

  const shareRows = await db.select().from(vehicleShares).where(eq(vehicleShares.customerId, customerId));

  const userId = account?.id ?? null;
  const notificationRows = userId ? await db.select().from(notifications).where(eq(notifications.userId, userId)) : [];
  const preferenceRows = userId ? await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)) : [];
  const deviceRows = userId ? await db.select().from(devices).where(eq(devices.userId, userId)) : [];
  const auditRows = userId
    ? await db
        .select()
        .from(auditLog)
        .where(or(eq(auditLog.actorUserId, userId), and(eq(auditLog.entityType, 'customer'), eq(auditLog.entityId, customerId))))
        .orderBy(sql`${auditLog.occurredAt} asc`)
    : [];

  const data = {
    export: { createdAt, scope, workshop: 'Autowerkstatt Witten', format: 'autowerkstatt-witten-export/1' },
    customer: clean(customer, scope),
    account: account
      ? { email: account.email, displayName: account.displayName, status: account.status, createdAt: account.createdAt.toISOString(), lastLoginAt: account.lastLoginAt?.toISOString() ?? null }
      : null,
    vehicleOwnerships: cleanAll(ownerships, scope),
    vehicles: cleanAll(vehicleRows, scope),
    odometerReadings: cleanAll(ownReadings, scope),
    workOrders: cleanAll(orderRows, scope),
    workItems: cleanAll(itemRows, scope),
    intakes: cleanAll(intakeRows, scope),
    approvalRequests: cleanAll(requestRows, scope),
    approvalVersions: cleanAll(versionRows, scope),
    approvalDecisions: cleanAll(decisionRows, scope),
    messages: cleanAll(messageRows, scope),
    messageAttachments: cleanAll(attachmentRows, scope),
    internalNotes: cleanAll(noteRows, scope),
    photos: photoRows.map((r) => clean(r.photo, scope)),
    appointments: cleanAll(appointmentRows, scope),
    appointmentProposals: cleanAll(proposalRows, scope),
    invoices: cleanAll(invoiceRows, scope),
    payments: cleanAll(paymentRows, scope),
    refunds: cleanAll(refundRows, scope),
    paymentAttempts: cleanAll(checkoutRows, scope),
    documents: documentRows.map((r) => clean(r.doc, scope)),
    serviceEntries: cleanAll(entries, scope),
    vehicleShares: cleanAll(shareRows, scope),
    notifications: cleanAll(notificationRows, scope),
    notificationPreferences: cleanAll(preferenceRows, scope),
    devices: deviceRows.map((d) => ({ platform: d.platform, lastSeenAt: d.lastSeenAt?.toISOString() ?? null, disabledAt: d.disabledAt?.toISOString() ?? null })),
    activityLog: cleanAll(auditRows, scope),
  };

  const zip: Zippable = {
    'LIESMICH.txt': strToU8(README(scope, createdAt)),
    'daten.json': strToU8(JSON.stringify(data, null, 2)),
  };
  const used = new Set<string>();
  const addFile = async (folder: string, baseName: string, storageKey: string) => {
    let name = `${folder}/${safeName(baseName)}`;
    let i = 2;
    while (used.has(name)) name = `${folder}/${i++}-${safeName(baseName)}`;
    used.add(name);
    zip[name] = new Uint8Array(await streamToBuffer(await storage.read(storageKey)));
  };
  for (const r of documentRows) await addFile('dokumente', `${r.doc.title}-${r.file.originalName}`, r.file.storageKey);
  for (const r of photoRows) await addFile('fotos', r.file.originalName, r.file.storageKey);

  const counts = Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => Array.isArray(v))
      .map(([k, v]) => [k, (v as unknown[]).length]),
  );
  return {
    zip: zipSync(zip, { level: 6 }),
    fileName: `datenexport-${customer.customerNumber}-${createdAt.slice(0, 10)}.zip`,
    counts,
  };
}
