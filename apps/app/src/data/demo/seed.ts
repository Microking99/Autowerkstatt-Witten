/**
 * BEISPIELDATEN für den Demo-Modus (isTestData: true).
 *
 * Alle Personen, Firmen, Anschriften, Kennzeichen, FIN, Telefonnummern und Bankdaten sind
 * frei erfunden. Telefonnummern beginnen nach der Vorwahl mit 0 und sind damit nicht
 * vergeben; die IBAN hat eine gültige Prüfziffer, aber eine nicht vergebene Bankleitzahl.
 * E-Mail-Adressen nutzen die reservierte Endung ".example". Fotos sind neutrale
 * Platzhalter mit der Beschriftung "Beispielfoto", keine Aufnahmen echter Personen.
 *
 * Alle Zeitangaben werden relativ zum Startzeitpunkt erzeugt, damit "heute", "fällig" und
 * "überfällig" beim Ausprobieren stimmen.
 */
import type { ApprovalLine } from '@werkstatt/contracts';
import { computeIntakeHash } from '@werkstatt/domain';
import { buildVersion, lineTotals } from './rules/approvals';
import { sha256Hex } from './rules/hash';
import { hashShareToken } from './rules/publicAccess';
import { addMonths } from './rules/serviceHistory';
import { DEMO_EMAILS, DEMO_MERCHANT_CODE, DEMO_PASSWORD, DEMO_TOKENS } from './constants';
import {
  DEMO_SCHEMA_VERSION,
  type DAppointment,
  type DApprovalRequest,
  type DCustomer,
  type DDocument,
  type DemoState,
  type DFile,
  type DIntake,
  type DInvoice,
  type DMessage,
  type DOdometer,
  type DPartDemand,
  type DServiceEntry,
  type DWorkingHours,
  type DUser,
  type DVehicle,
  type DWorkItem,
  type DWorkOrder,
} from './model';

/** Feste, gültige UUIDs (Version 4, Variante 8), damit Links stabil bleiben. */
export function seedId(group: number, n: number): string {
  return `${group.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString().padStart(12, '0')}`;
}

export const IDS = {
  users: {
    owner: seedId(1, 1),
    service: seedId(1, 2),
    emre: seedId(1, 3),
    lukas: seedId(1, 4),
    jonas: seedId(1, 5),
    nadine: seedId(1, 6),
    miriam: seedId(1, 10),
    guenter: seedId(1, 11),
    tobias: seedId(1, 12),
  },
  customers: {
    miriam: seedId(2, 1),
    brinkhoff: seedId(2, 2),
    guenter: seedId(2, 3),
    horst: seedId(2, 4),
  },
  vehicles: {
    golf: seedId(3, 1),
    octavia: seedId(3, 2),
    transit: seedId(3, 3),
    sprinter: seedId(3, 4),
    yaris: seedId(3, 5),
    corsa: seedId(3, 6),
  },
  maintenance: {
    inspection: seedId(6, 1),
    oil: seedId(6, 2),
    hu: seedId(6, 3),
    brakeFluid: seedId(6, 4),
    ac: seedId(6, 5),
    timingBelt: seedId(6, 6),
  },
  resources: { lift1: seedId(7, 1), lift2: seedId(7, 2), diagnosis: seedId(7, 3) },
  workOrders: {
    octaviaInspection: seedId(10, 1),
    octaviaTimingBelt: seedId(10, 2),
    golf2025: seedId(10, 3),
    golfAc: seedId(10, 4),
    golfWheels: seedId(10, 5),
    golf2024: seedId(10, 6),
    rohde2024: seedId(10, 7),
    rohde2025: seedId(10, 8),
    rohdeCorsa: seedId(10, 9),
    transit: seedId(10, 10),
    sprinter: seedId(10, 11),
    sprinterDoor: seedId(10, 12),
    yaris: seedId(10, 13),
    golfService: seedId(10, 14),
    corsaAc: seedId(10, 15),
  },
  approvals: {
    timingBeltOffer: seedId(16, 1),
    brakes: seedId(16, 2),
    wipers: seedId(16, 3),
  },
  appointments: {
    golfCheck: seedId(8, 1),
    octaviaTimingBelt: seedId(8, 2),
    golfService: seedId(8, 3),
    octaviaDropOff: seedId(8, 4),
    corsaHu: seedId(8, 5),
    sprinterToday: seedId(8, 6),
    transitPickup: seedId(8, 7),
    yarisToday: seedId(8, 8),
    yarisTires: seedId(8, 9),
    golfTpmsToday: seedId(8, 10),
  },
  invoices: {
    golf2024: seedId(22, 1),
    golf2025: seedId(22, 2),
    golfAc: seedId(22, 3),
    golfWheels: seedId(22, 4),
    rohde2024: seedId(22, 5),
    rohde2025: seedId(22, 6),
    rohdeCorsa: seedId(22, 7),
    sprinterDoor: seedId(22, 8),
    transit: seedId(22, 9),
  },
  shares: { valid: seedId(26, 1), expired: seedId(26, 2), revoked: seedId(26, 3) },
} as const;

const WORKSHOP = 'Autowerkstatt Witten';

export function createSeed(nowDate: Date = new Date()): DemoState {
  const now = nowDate.getTime();

  /** Zeitpunkt relativ zu heute (Tage), Ortszeit hh:mm */
  const at = (days: number, h = 9, m = 0): string => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  /** Wie at(), aber auf den nächsten Werktag (Mo-Fr) verschoben: Termine liegen in den Öffnungszeiten. */
  const wd = (days: number, h = 9, m = 0): string => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + (days >= 0 ? 1 : -1));
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  /** Kalenderdatum relativ zu heute (YYYY-MM-DD, Ortszeit) */
  const day = (days: number): string => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const seededAt = new Date(now).toISOString();
  const pw = sha256Hex(`demo:${DEMO_PASSWORD}`);

  // -------------------------------------------------------------------------
  // Mitarbeiter und Konten
  // -------------------------------------------------------------------------
  const users: DUser[] = [
    { id: IDS.users.owner, email: DEMO_EMAILS.owner, displayName: 'Ralf Lindemann', role: 'admin', status: 'active', passwordHash: pw, permissionOverrides: [], lastLoginAt: at(-1, 7, 42), createdAt: at(-900) },
    { id: IDS.users.service, email: DEMO_EMAILS.service, displayName: 'Petra Wiesmann', role: 'service', status: 'active', passwordHash: pw, permissionOverrides: [{ permission: 'payments.recordManual', granted: true }], lastLoginAt: at(0, 7, 15), createdAt: at(-880) },
    { id: IDS.users.emre, email: DEMO_EMAILS.mechanic, displayName: 'Emre Aydın', role: 'mechanic', status: 'active', passwordHash: pw, permissionOverrides: [{ permission: 'serviceHistory.read', granted: true }], lastLoginAt: at(0, 7, 5), createdAt: at(-700) },
    { id: IDS.users.lukas, email: DEMO_EMAILS.mechanic2, displayName: 'Lukas Brettschneider', role: 'mechanic', status: 'active', passwordHash: pw, permissionOverrides: [], lastLoginAt: at(0, 7, 2), createdAt: at(-400) },
    { id: IDS.users.nadine, email: DEMO_EMAILS.service2, displayName: 'Nadine Kurz', role: 'service', status: 'active', passwordHash: pw, permissionOverrides: [{ permission: 'invoices.write', granted: false }], lastLoginAt: at(-2, 8, 5), createdAt: at(-90) },
    { id: IDS.users.jonas, email: DEMO_EMAILS.disabled, displayName: 'Jonas Feldhaus', role: 'mechanic', status: 'disabled', passwordHash: pw, permissionOverrides: [], lastLoginAt: at(-120), createdAt: at(-500) },
    { id: IDS.users.miriam, email: DEMO_EMAILS.customer, displayName: 'Miriam Kowalczyk', role: 'customer', status: 'active', passwordHash: pw, permissionOverrides: [], lastLoginAt: at(-1, 20, 10), createdAt: at(-720) },
    { id: IDS.users.guenter, email: DEMO_EMAILS.previousOwner, displayName: 'Günter Rohde', role: 'customer', status: 'active', passwordHash: pw, permissionOverrides: [], lastLoginAt: at(-30), createdAt: at(-950) },
    { id: IDS.users.tobias, email: DEMO_EMAILS.business, displayName: 'Tobias Brinkhoff', role: 'customer', status: 'invited', passwordHash: null, permissionOverrides: [], lastLoginAt: null, createdAt: at(-2) },
  ];

  const customers: DCustomer[] = [
    { id: IDS.customers.miriam, customerNumber: 'K-10231', kind: 'private', salutation: 'Frau', firstName: 'Miriam', lastName: 'Kowalczyk', companyName: null, email: DEMO_EMAILS.customer, phone: null, mobile: '0157 0482 3316', street: 'Lindenweg 14', postalCode: '58453', city: 'Witten', country: 'DE', notesInternal: 'Bevorzugt Rückruf nach 17 Uhr.', createdAt: at(-720), archivedAt: null, isTestData: true },
    { id: IDS.customers.brinkhoff, customerNumber: 'K-10198', kind: 'business', salutation: null, firstName: 'Tobias', lastName: 'Brinkhoff', companyName: 'Brinkhoff Haustechnik GmbH', email: DEMO_EMAILS.business, phone: '02302 0 58 41 70', mobile: null, street: 'Gewerbestraße 8', postalCode: '58454', city: 'Witten', country: 'DE', notesInternal: 'Zwei Transporter, Rechnung an Buchhaltung, Zahlungsziel 14 Tage.', createdAt: at(-610), archivedAt: null, isTestData: true },
    { id: IDS.customers.guenter, customerNumber: 'K-10087', kind: 'private', salutation: 'Herr', firstName: 'Günter', lastName: 'Rohde', companyName: null, email: DEMO_EMAILS.previousOwner, phone: '02302 0 91 27 44', mobile: null, street: 'Am Hang 3', postalCode: '58456', city: 'Witten', country: 'DE', notesInternal: null, createdAt: at(-950), archivedAt: null, isTestData: true },
    { id: IDS.customers.horst, customerNumber: 'K-10245', kind: 'private', salutation: 'Herr', firstName: 'Horst', lastName: 'Wegener', companyName: null, email: null, phone: '02302 0 33 18 02', mobile: null, street: 'Kirchplatz 2', postalCode: '58452', city: 'Witten', country: 'DE', notesInternal: 'Kein App-Zugang gewünscht, Kontakt telefonisch.', createdAt: at(-60), archivedAt: null, isTestData: true },
  ];

  // -------------------------------------------------------------------------
  // Fahrzeuge, Halterzeiträume, Kilometerstände
  // -------------------------------------------------------------------------
  const vehicles: DVehicle[] = [
    { id: IDS.vehicles.golf, licensePlate: 'EN-MK 2147', vin: 'WVWZZZCDZMW047193', hsn: '0603', tsn: 'BJH', make: 'Volkswagen', model: 'Golf', variant: 'VIII 1.5 eTSI', firstRegistration: '2021-03-18', fuelType: 'Benzin', color: 'Grau metallic', notesInternal: null, qrToken: DEMO_TOKENS.qrGolf, qrPublicViewEnabled: true, createdAt: at(-720), archivedAt: null, isTestData: true },
    { id: IDS.vehicles.octavia, licensePlate: 'EN-MK 3308', vin: 'TMBJJ7NE5K0271846', hsn: '8004', tsn: 'ANV', make: 'Škoda', model: 'Octavia Combi', variant: '2.0 TDI', firstRegistration: '2019-06-04', fuelType: 'Diesel', color: 'Blau', notesInternal: 'Vorher EN-GR 815 (Vorbesitzer).', qrToken: DEMO_TOKENS.qrOctavia, qrPublicViewEnabled: false, createdAt: at(-950), archivedAt: null, isTestData: true },
    { id: IDS.vehicles.transit, licensePlate: 'EN-BH 412', vin: 'WF0YXXTTGYKJ52817', hsn: '8566', tsn: 'BKZ', make: 'Ford', model: 'Transit Custom', variant: '2.0 EcoBlue', firstRegistration: '2019-11-12', fuelType: 'Diesel', color: 'Weiß', notesInternal: 'Regaleinbau hinten, Hebebühne 2 nutzen.', qrToken: DEMO_TOKENS.qrTransit, qrPublicViewEnabled: false, createdAt: at(-610), archivedAt: null, isTestData: true },
    { id: IDS.vehicles.sprinter, licensePlate: 'EN-BH 977', vin: 'WDB9066331S462718', hsn: '0710', tsn: 'BAV', make: 'Mercedes-Benz', model: 'Sprinter', variant: '316 CDI', firstRegistration: '2018-02-20', fuelType: 'Diesel', color: 'Weiß', notesInternal: null, qrToken: DEMO_TOKENS.qrSprinter, qrPublicViewEnabled: false, createdAt: at(-610), archivedAt: null, isTestData: true },
    { id: IDS.vehicles.yaris, licensePlate: 'EN-HW 64', vin: 'VNKKBAC3X0A024871', hsn: '5013', tsn: 'AKM', make: 'Toyota', model: 'Yaris', variant: '1.5 Hybrid', firstRegistration: '2020-08-27', fuelType: 'Hybrid', color: 'Rot', notesInternal: null, qrToken: DEMO_TOKENS.qrYaris, qrPublicViewEnabled: false, createdAt: at(-60), archivedAt: null, isTestData: true },
    { id: IDS.vehicles.corsa, licensePlate: 'EN-GR 1590', vin: 'W0VPC2ZZ7LV039582', hsn: '0035', tsn: 'BMX', make: 'Opel', model: 'Corsa', variant: '1.2 Edition', firstRegistration: '2020-02-14', fuelType: 'Benzin', color: 'Silber', notesInternal: null, qrToken: DEMO_TOKENS.qrCorsa, qrPublicViewEnabled: false, createdAt: at(-165), archivedAt: null, isTestData: true },
  ];

  const ownerships = [
    { id: seedId(4, 1), vehicleId: IDS.vehicles.golf, customerId: IDS.customers.miriam, startedAt: at(-720), endedAt: null, note: null },
    { id: seedId(4, 2), vehicleId: IDS.vehicles.octavia, customerId: IDS.customers.guenter, startedAt: at(-950), endedAt: at(-164, 12), note: 'Verkauf an Frau Kowalczyk' },
    { id: seedId(4, 3), vehicleId: IDS.vehicles.octavia, customerId: IDS.customers.miriam, startedAt: at(-164, 12), endedAt: null, note: 'Kauf von Herrn Rohde, neues Kennzeichen' },
    { id: seedId(4, 4), vehicleId: IDS.vehicles.transit, customerId: IDS.customers.brinkhoff, startedAt: at(-610), endedAt: null, note: null },
    { id: seedId(4, 5), vehicleId: IDS.vehicles.sprinter, customerId: IDS.customers.brinkhoff, startedAt: at(-610), endedAt: null, note: null },
    { id: seedId(4, 6), vehicleId: IDS.vehicles.yaris, customerId: IDS.customers.horst, startedAt: at(-60), endedAt: null, note: null },
    { id: seedId(4, 7), vehicleId: IDS.vehicles.corsa, customerId: IDS.customers.guenter, startedAt: at(-165), endedAt: null, note: null },
  ];

  let odoN = 0;
  const odo = (vehicleId: string, valueKm: number, recordedAt: string, source: DOdometer['source'], workOrderId: string | null = null): DOdometer => ({
    id: seedId(5, ++odoN),
    vehicleId,
    valueKm,
    recordedAt,
    source,
    workOrderId,
    plausibility: 'ok',
  });
  const W = IDS.workOrders;
  const odometer: DOdometer[] = [
    odo(IDS.vehicles.golf, 38_214, at(-700, 8), 'intake', W.golf2024),
    odo(IDS.vehicles.golf, 51_870, at(-345, 8), 'intake', W.golf2025),
    odo(IDS.vehicles.golf, 63_947, at(-30, 8), 'intake', W.golfAc),
    odo(IDS.vehicles.octavia, 71_350, at(-900, 8), 'intake', W.rohde2024),
    odo(IDS.vehicles.octavia, 84_020, at(-300, 8), 'intake', W.rohde2025),
    odo(IDS.vehicles.octavia, 88_905, at(-164, 12), 'staff'),
    odo(IDS.vehicles.octavia, 91_480, at(-2, 7, 40), 'intake', W.octaviaInspection),
    odo(IDS.vehicles.corsa, 21_960, at(-165, 10), 'staff'),
    odo(IDS.vehicles.corsa, 23_410, at(-100, 8), 'intake', W.rohdeCorsa),
    odo(IDS.vehicles.transit, 142_305, at(-2, 7, 30), 'intake', W.transit),
    odo(IDS.vehicles.sprinter, 187_644, at(0, 7, 35), 'intake', W.sprinter),
    odo(IDS.vehicles.yaris, 58_120, at(0, 9, 5), 'intake', W.yaris),
  ];

  const M = IDS.maintenance;
  const maintenanceTypes = [
    { id: M.inspection, key: 'inspection', name: 'Inspektion', defaultIntervalKm: 30_000, defaultIntervalMonths: 24, intervalOptions: [{ km: 15_000, months: 12, label: '15.000 km / 1 Jahr' }, { km: 30_000, months: 24, label: '30.000 km / 2 Jahre' }], active: true },
    { id: M.oil, key: 'oil', name: 'Ölwechsel mit Filter', defaultIntervalKm: 15_000, defaultIntervalMonths: 12, intervalOptions: [{ km: 10_000, months: 12, label: '10.000 km / 1 Jahr' }, { km: 15_000, months: 12, label: '15.000 km / 1 Jahr' }, { km: 30_000, months: 24, label: '30.000 km / 2 Jahre (Longlife)' }], active: true },
    { id: M.hu, key: 'hu', name: 'Hauptuntersuchung (HU/AU)', defaultIntervalKm: null, defaultIntervalMonths: 24, intervalOptions: [{ km: null, months: 24, label: '2 Jahre' }], active: true },
    { id: M.brakeFluid, key: 'brake_fluid', name: 'Bremsflüssigkeit wechseln', defaultIntervalKm: null, defaultIntervalMonths: 24, intervalOptions: [{ km: null, months: 24, label: '2 Jahre' }], active: true },
    { id: M.ac, key: 'ac', name: 'Klimaanlagen-Service', defaultIntervalKm: null, defaultIntervalMonths: 24, intervalOptions: [{ km: null, months: 12, label: '1 Jahr' }, { km: null, months: 24, label: '2 Jahre' }], active: true },
    { id: M.timingBelt, key: 'timing_belt', name: 'Zahnriemen mit Wasserpumpe', defaultIntervalKm: 180_000, defaultIntervalMonths: 120, intervalOptions: [{ km: 180_000, months: 120, label: '180.000 km / 10 Jahre' }], active: true },
  ];

  const resources = [
    { id: IDS.resources.lift1, name: 'Hebebühne 1', kind: 'lift' as const, active: true },
    { id: IDS.resources.lift2, name: 'Hebebühne 2', kind: 'lift' as const, active: true },
    { id: IDS.resources.diagnosis, name: 'Diagnoseplatz', kind: 'diagnosis' as const, active: true },
  ];

  // -------------------------------------------------------------------------
  // Dateien und Fotos (neutrale Platzhalter)
  // -------------------------------------------------------------------------
  let fileN = 0;
  const files: DFile[] = [];
  const file = (name: string, mimeType: string, placeholderLabel: string | null, sizeBytes = 184_000): string => {
    const id = seedId(14, ++fileN);
    files.push({ id, originalName: name, mimeType, sizeBytes, sha256: sha256Hex(`datei:${id}`), localUri: null, placeholderLabel });
    return id;
  };
  const fBrakeDisc = file('bremsscheibe-vorne-links.jpg', 'image/jpeg', 'Beispielfoto: Bremsscheibe vorne links mit Rand');
  const fBrakePad = file('bremsbelag-vorne-rechts.jpg', 'image/jpeg', 'Beispielfoto: Bremsbelag vorne rechts, Rest unter 3 mm');
  const fDash = file('annahme-kilometerstand.jpg', 'image/jpeg', 'Beispielfoto: Kilometerstand bei Annahme');
  const fWiper = file('wischerblatt-hinten.jpg', 'image/jpeg', 'Beispielfoto: Wischerblatt hinten, rissig');
  const fDoor = file('schiebetuer-fuehrung.jpg', 'image/jpeg', 'Beispielfoto: Führungsschiene Schiebetür');
  const pdf = (name: string) => file(name, 'application/pdf', null, 96_000);

  const P = { disc: seedId(15, 1), pad: seedId(15, 2), dash: seedId(15, 3), wiper: seedId(15, 4), door: seedId(15, 5), chatDisc: seedId(15, 6) };
  const photos = [
    { id: P.disc, workOrderId: W.octaviaInspection, fileId: fBrakeDisc, context: 'finding' as const, findingId: seedId(13, 1), visibility: 'customer' as const, caption: 'Bremsscheibe vorne links: deutlicher Rand, Oberfläche riefig', takenAt: at(-1, 11, 12) },
    { id: P.pad, workOrderId: W.octaviaInspection, fileId: fBrakePad, context: 'finding' as const, findingId: seedId(13, 1), visibility: 'customer' as const, caption: 'Bremsbelag vorne rechts: Restbelag unter 3 mm', takenAt: at(-1, 11, 14) },
    { id: P.dash, workOrderId: W.octaviaInspection, fileId: fDash, context: 'intake' as const, findingId: null, visibility: 'internal' as const, caption: 'Kilometerstand und Tankanzeige bei Annahme', takenAt: at(-2, 7, 41) },
    { id: P.wiper, workOrderId: W.golfAc, fileId: fWiper, context: 'approval' as const, findingId: null, visibility: 'customer' as const, caption: 'Wischerblatt hinten: Gummi rissig', takenAt: at(-31, 10) },
    { id: P.door, workOrderId: W.sprinterDoor, fileId: fDoor, context: 'work' as const, findingId: null, visibility: 'internal' as const, caption: 'Führungsschiene nach Austausch', takenAt: at(-21, 14) },
    { id: P.chatDisc, workOrderId: W.octaviaInspection, fileId: fBrakeDisc, context: 'chat' as const, findingId: null, visibility: 'customer' as const, caption: null, takenAt: at(-1, 14, 22) },
  ];

  // -------------------------------------------------------------------------
  // Aufträge und Positionen
  // -------------------------------------------------------------------------
  let itemN = 0;
  const item = (p: Partial<DWorkItem> & Pick<DWorkItem, 'workOrderId' | 'title' | 'unitPriceCents'>): DWorkItem => ({
    id: seedId(11, ++itemN),
    position: 0,
    kind: 'labor',
    description: null,
    maintenanceTypeId: null,
    intervalKm: null,
    intervalMonths: null,
    quantity: 1,
    unit: 'Pausch.',
    vatRateBp: 1900,
    origin: 'intake',
    authorization: 'agreed',
    executionStatus: 'planned',
    approvalRequestId: null,
    approvedVersionId: null,
    assignedTo: null,
    doneAt: null,
    doneBy: null,
    doneOdometerKm: null,
    resultNotes: null,
    trackedMinutes: 0,
    runningSince: null,
    parts: [],
    ...p,
  });
  const done = (by: string, when: string, km: number | null, notes: string | null = null): Partial<DWorkItem> => ({
    executionStatus: 'done',
    doneAt: when,
    doneBy: by,
    doneOdometerKm: km,
    resultNotes: notes,
    assignedTo: by,
  });
  const U = IDS.users;
  const C = IDS.customers;
  const V = IDS.vehicles;
  const A = IDS.approvals;

  const wo = (p: Partial<DWorkOrder> & Pick<DWorkOrder, 'id' | 'orderNumber' | 'customerId' | 'vehicleId' | 'status' | 'title' | 'createdAt'>): DWorkOrder => ({
    descriptionCustomer: null,
    notesInternal: null,
    costLimitCents: null,
    plannedStart: null,
    plannedEnd: null,
    readyForPickupAt: null,
    pickedUpAt: null,
    completionReviewedAt: null,
    completionReviewedBy: null,
    cancelledAt: null,
    cancelReason: null,
    assigneeIds: [],
    updatedAt: p.createdAt,
    ...p,
  });

  const workOrders: DWorkOrder[] = [
    wo({ id: W.octaviaInspection, orderNumber: 'A-2026-0187', customerId: C.miriam, vehicleId: V.octavia, status: 'in_progress', title: 'Inspektion und Ölwechsel', descriptionCustomer: 'Inspektion nach Herstellervorgabe mit Ölwechsel. Schleifgeräusch beim Bremsen prüfen.', notesInternal: 'Kundin wartet nicht, Rückruf vor 17 Uhr. Inspektion war beim Vorbesitzer überfällig.', costLimitCents: 45_000, plannedStart: at(-2, 7, 30), plannedEnd: at(1, 16), assigneeIds: [U.emre], createdAt: at(-5, 10), updatedAt: at(-1, 14, 20) }),
    wo({ id: W.octaviaTimingBelt, orderNumber: 'A-2026-0190', customerId: C.miriam, vehicleId: V.octavia, status: 'open', title: 'Zahnriemen und Wasserpumpe', descriptionCustomer: 'Zahnriemenwechsel nach Alter (Erstzulassung 2019). Termin nach Freigabe des Angebots.', notesInternal: 'Teile erst nach Freigabe bestellen.', plannedStart: wd(9, 7, 30), plannedEnd: wd(9, 16), assigneeIds: [U.lukas], createdAt: at(-6, 9), updatedAt: at(-3, 11) }),
    wo({ id: W.golf2024, orderNumber: 'A-2024-0388', customerId: C.miriam, vehicleId: V.golf, status: 'picked_up', title: 'Inspektion', createdAt: at(-702), completionReviewedAt: at(-700, 15), completionReviewedBy: U.service, readyForPickupAt: at(-700, 15), pickedUpAt: at(-700, 17), updatedAt: at(-700, 17) }),
    wo({ id: W.golf2025, orderNumber: 'A-2025-0412', customerId: C.miriam, vehicleId: V.golf, status: 'picked_up', title: 'Ölwechsel und Hauptuntersuchung', createdAt: at(-347), completionReviewedAt: at(-345, 15), completionReviewedBy: U.service, readyForPickupAt: at(-345, 15), pickedUpAt: at(-345, 17, 30), updatedAt: at(-345, 17, 30) }),
    wo({ id: W.golfAc, orderNumber: 'A-2026-0164', customerId: C.miriam, vehicleId: V.golf, status: 'picked_up', title: 'Klimaservice', descriptionCustomer: 'Klimaanlage kühlt schwach. Klimaservice mit Desinfektion.', createdAt: at(-32), completionReviewedAt: at(-30, 15), completionReviewedBy: U.service, readyForPickupAt: at(-30, 15, 10), pickedUpAt: at(-29, 8, 10), assigneeIds: [U.lukas], updatedAt: at(-29, 8, 10) }),
    wo({ id: W.golfWheels, orderNumber: 'A-2026-0189', customerId: C.miriam, vehicleId: V.golf, status: 'picked_up', title: 'Räderwechsel auf Winterräder', createdAt: at(-4), completionReviewedAt: at(-3, 11), completionReviewedBy: U.service, readyForPickupAt: at(-3, 11), pickedUpAt: at(-3, 12), assigneeIds: [U.lukas], updatedAt: at(-3, 12) }),
    wo({ id: W.rohde2024, orderNumber: 'A-2024-0133', customerId: C.guenter, vehicleId: V.octavia, status: 'picked_up', title: 'Inspektion', createdAt: at(-902), completionReviewedAt: at(-900, 15), completionReviewedBy: U.owner, readyForPickupAt: at(-900, 15), pickedUpAt: at(-900, 17), updatedAt: at(-900, 17) }),
    wo({ id: W.rohde2025, orderNumber: 'A-2025-0402', customerId: C.guenter, vehicleId: V.octavia, status: 'picked_up', title: 'Ölwechsel', createdAt: at(-301), completionReviewedAt: at(-300, 14), completionReviewedBy: U.service, readyForPickupAt: at(-300, 14), pickedUpAt: at(-300, 16), updatedAt: at(-300, 16) }),
    wo({ id: W.rohdeCorsa, orderNumber: 'A-2026-0098', customerId: C.guenter, vehicleId: V.corsa, status: 'picked_up', title: 'Durchsicht nach Fahrzeugkauf', createdAt: at(-101), completionReviewedAt: at(-100, 15), completionReviewedBy: U.service, readyForPickupAt: at(-100, 15), pickedUpAt: at(-100, 17), assigneeIds: [U.emre], updatedAt: at(-100, 17) }),
    wo({ id: W.transit, orderNumber: 'A-2026-0185', customerId: C.brinkhoff, vehicleId: V.transit, status: 'completed', title: 'Inspektion und Bremsflüssigkeit', createdAt: at(-3), plannedStart: at(-2, 7, 30), plannedEnd: at(-1, 16), completionReviewedAt: at(-1, 15, 30), completionReviewedBy: U.service, readyForPickupAt: at(-1, 15, 40), assigneeIds: [U.lukas], updatedAt: at(-1, 15, 40) }),
    wo({ id: W.sprinter, orderNumber: 'A-2026-0191', customerId: C.brinkhoff, vehicleId: V.sprinter, status: 'in_progress', title: 'Geräusch beim Anfahren prüfen', descriptionCustomer: 'Klackern beim Anfahren, vermutlich Kupplung oder Antriebswelle.', plannedStart: at(0, 7, 30), plannedEnd: at(0, 12), assigneeIds: [U.lukas], createdAt: at(-1, 16), updatedAt: at(0, 8) }),
    wo({ id: W.sprinterDoor, orderNumber: 'A-2026-0151', customerId: C.brinkhoff, vehicleId: V.sprinter, status: 'picked_up', title: 'Schiebetür schließt nicht', createdAt: at(-23), completionReviewedAt: at(-21, 16), completionReviewedBy: U.service, readyForPickupAt: at(-21, 16), pickedUpAt: at(-20, 8), assigneeIds: [U.emre], updatedAt: at(-20, 8) }),
    wo({ id: W.golfService, orderNumber: 'A-2026-0193', customerId: C.miriam, vehicleId: V.golf, status: 'open', title: 'Service mit Ölwechsel', descriptionCustomer: 'Ölwechsel laut Anzeige fällig, Innenraumfilter erneuern.', notesInternal: 'Innenraumfilter mit Aktivkohle ist bestellt.', plannedStart: wd(6, 8), plannedEnd: wd(6, 16), assigneeIds: [U.emre], createdAt: at(-5, 10, 30), updatedAt: at(-5, 10, 30) }),
    wo({ id: W.corsaAc, orderNumber: 'A-2026-0188', customerId: C.guenter, vehicleId: V.corsa, status: 'completed', title: 'Klimaanlage prüfen', descriptionCustomer: 'Klimaanlage kühlt nicht mehr richtig.', plannedStart: at(-2, 8), plannedEnd: at(-1, 15), completionReviewedAt: at(-1, 16), completionReviewedBy: U.service, readyForPickupAt: at(-1, 16, 10), assigneeIds: [U.lukas], createdAt: at(-3, 9), updatedAt: at(-1, 16, 10) }),
    wo({ id: W.yaris, orderNumber: 'A-2026-0192', customerId: C.horst, vehicleId: V.yaris, status: 'in_progress', title: 'Jahresinspektion Hybrid', descriptionCustomer: 'Inspektion mit Hybrid-Check. Kunde holt gegen 15 Uhr ab.', notesInternal: 'Kunde ohne App, Rückruf unter Festnetz.', plannedStart: at(0, 9), plannedEnd: at(0, 15), assigneeIds: [U.emre], createdAt: at(-7, 10), updatedAt: at(0, 9, 10) }),
  ];

  // Positionen: Octavia Inspektion (laufend, Zusatzarbeit Bremsen wartet auf Freigabe)
  const workItems: DWorkItem[] = [
    item({ workOrderId: W.octaviaInspection, position: 1, title: 'Inspektion nach Herstellervorgabe', unitPriceCents: 18_900, maintenanceTypeId: M.inspection, intervalKm: 30_000, intervalMonths: 24, ...done(U.emre, at(-1, 10, 40), 91_480, 'Inspektion ohne weitere Auffälligkeiten, Bremsen siehe Feststellung.'), trackedMinutes: 95 }),
    item({ workOrderId: W.octaviaInspection, position: 2, title: 'Ölwechsel inkl. Ölfilter', kind: 'flat_rate', unitPriceCents: 8_950, maintenanceTypeId: M.oil, intervalKm: 15_000, intervalMonths: 12, ...done(U.emre, at(-1, 11), 91_480), trackedMinutes: 25 }),
    // Octavia 2024 (Vorbesitzer)
    item({ workOrderId: W.rohde2024, position: 1, title: 'Inspektion nach Herstellervorgabe', unitPriceCents: 17_900, maintenanceTypeId: M.inspection, intervalKm: 30_000, intervalMonths: 24, ...done(U.owner, at(-900, 13), 71_350) }),
    item({ workOrderId: W.rohde2024, position: 2, title: 'Pollenfilter erneuern', kind: 'part', unitPriceCents: 3_490, ...done(U.owner, at(-900, 13, 20), 71_350) }),
    item({ workOrderId: W.rohde2025, position: 1, title: 'Ölwechsel inkl. Ölfilter', kind: 'flat_rate', unitPriceCents: 8_450, maintenanceTypeId: M.oil, intervalKm: 15_000, intervalMonths: 12, ...done(U.service, at(-300, 11), 84_020) }),
    // Golf 2024 und 2025
    item({ workOrderId: W.golf2024, position: 1, title: 'Inspektion nach Herstellervorgabe', unitPriceCents: 17_900, maintenanceTypeId: M.inspection, intervalKm: 30_000, intervalMonths: 24, ...done(U.owner, at(-700, 12), 38_214) }),
    item({ workOrderId: W.golf2025, position: 1, title: 'Ölwechsel inkl. Ölfilter', kind: 'flat_rate', unitPriceCents: 8_450, maintenanceTypeId: M.oil, intervalKm: 15_000, intervalMonths: 12, ...done(U.emre, at(-345, 10), 51_870) }),
    item({ workOrderId: W.golf2025, position: 2, title: 'Hauptuntersuchung mit Abgasuntersuchung', kind: 'flat_rate', unitPriceCents: 13_900, maintenanceTypeId: M.hu, intervalMonths: 24, ...done(U.owner, at(-345, 12), 51_870, 'Ohne Mängel, Plakette erteilt.') }),
    item({ workOrderId: W.golf2025, position: 3, title: 'Wischerblätter vorne', kind: 'part', unitPriceCents: 3_490, ...done(U.emre, at(-345, 10, 30), 51_870) }),
    // Golf Klimaservice mit abgelehnter Zusatzarbeit
    item({ workOrderId: W.golfAc, position: 1, title: 'Klimaanlagen-Service mit Desinfektion', kind: 'flat_rate', unitPriceCents: 11_900, maintenanceTypeId: M.ac, intervalMonths: 24, ...done(U.lukas, at(-30, 12), 63_947, 'Kältemittel ergänzt, Anlage dicht.') }),
    item({ workOrderId: W.golfAc, position: 2, title: 'Innenraumfilter erneuern', kind: 'part', unitPriceCents: 2_890, ...done(U.lukas, at(-30, 12, 20), 63_947) }),
    item({ workOrderId: W.golfAc, position: 3, title: 'Wischerblatt hinten erneuern', kind: 'part', unitPriceCents: 2_190, origin: 'additional', authorization: 'rejected', executionStatus: 'not_done', approvalRequestId: A.wipers }),
    // Golf Räderwechsel
    item({ workOrderId: W.golfWheels, position: 1, title: 'Räderwechsel auf Winterräder inkl. Luftdruck', kind: 'flat_rate', unitPriceCents: 3_900, ...done(U.lukas, at(-3, 10, 30), null) }),
    item({ workOrderId: W.golfWheels, position: 2, title: 'Einlagerung Sommerräder, Saison 2026/27', kind: 'flat_rate', unitPriceCents: 4_500, ...done(U.lukas, at(-3, 10, 45), null) }),
    // Corsa (Vorbesitzer, neues Fahrzeug)
    item({ workOrderId: W.rohdeCorsa, position: 1, title: 'Ölwechsel inkl. Ölfilter', kind: 'flat_rate', unitPriceCents: 7_950, maintenanceTypeId: M.oil, intervalKm: 15_000, intervalMonths: 12, ...done(U.emre, at(-100, 11), 23_410) }),
    item({ workOrderId: W.rohdeCorsa, position: 2, title: 'Durchsicht nach Checkliste', unitPriceCents: 6_900, ...done(U.emre, at(-100, 12), 23_410) }),
    // Transit (abholbereit)
    item({ workOrderId: W.transit, position: 1, title: 'Inspektion nach Herstellervorgabe', unitPriceCents: 24_900, maintenanceTypeId: M.inspection, intervalKm: 30_000, intervalMonths: 24, ...done(U.lukas, at(-1, 11), 142_305) }),
    item({ workOrderId: W.transit, position: 2, title: 'Bremsflüssigkeit wechseln', kind: 'flat_rate', unitPriceCents: 6_900, maintenanceTypeId: M.brakeFluid, intervalMonths: 24, ...done(U.lukas, at(-1, 13), 142_305) }),
    // Sprinter heute
    item({ workOrderId: W.sprinter, position: 1, title: 'Fehlersuche Geräusch beim Anfahren', unitPriceCents: 7_800, quantity: 1, unit: 'Std.', assignedTo: U.lukas, executionStatus: 'in_progress', runningSince: at(0, 8), trackedMinutes: 0 }),
    item({ workOrderId: W.sprinterDoor, position: 1, title: 'Führungsschiene Schiebetür erneuern', unitPriceCents: 58_000, ...done(U.emre, at(-21, 14), 186_990) }),
    item({ workOrderId: W.sprinterDoor, position: 2, title: 'Arbeitszeit Schiebetür', unitPriceCents: 7_800, quantity: 5.5, unit: 'Std.', ...done(U.emre, at(-21, 15), 186_990) }),
    // Golf Service (geplant, Teil noch nicht da)
    item({ workOrderId: W.golfService, position: 1, title: 'Ölwechsel inkl. Ölfilter', kind: 'flat_rate', unitPriceCents: 8_450, maintenanceTypeId: M.oil, intervalKm: 15_000, intervalMonths: 12, assignedTo: U.emre }),
    item({ workOrderId: W.golfService, position: 2, title: 'Innenraumfilter mit Aktivkohle erneuern', kind: 'part', unitPriceCents: 3_490, assignedTo: U.emre }),
    // Corsa Klimaanlage (fachlich abgeschlossen, noch ohne Rechnung)
    item({ workOrderId: W.corsaAc, position: 1, title: 'Klimaanlage Dichtheitsprüfung', unitPriceCents: 7_800, quantity: 1, unit: 'Std.', ...done(U.lukas, at(-1, 11), null, 'Anlage dicht, Druck in Ordnung.'), trackedMinutes: 55 }),
    item({ workOrderId: W.corsaAc, position: 2, title: 'Kältemittel R1234yf ergänzen', kind: 'part', unitPriceCents: 4_500, ...done(U.lukas, at(-1, 12), null), trackedMinutes: 20 }),
    // Yaris heute
    item({ workOrderId: W.yaris, position: 1, title: 'Inspektion mit Hybrid-Check', unitPriceCents: 21_900, maintenanceTypeId: M.inspection, intervalKm: 15_000, intervalMonths: 12, assignedTo: U.emre, executionStatus: 'planned' }),
    item({ workOrderId: W.yaris, position: 2, title: 'Bremsflüssigkeit wechseln', kind: 'flat_rate', unitPriceCents: 6_900, maintenanceTypeId: M.brakeFluid, intervalMonths: 24, assignedTo: U.emre, executionStatus: 'planned' }),
  ];

  // -------------------------------------------------------------------------
  // Freigabeanfragen (versioniert, mit Inhalts-Hash)
  // -------------------------------------------------------------------------
  const labor = (hours: number, title = 'Arbeitszeit'): ApprovalLine => ({ title, description: null, quantity: hours, unit: 'Std.', unitPriceCents: 7_800, vatRateBp: 1900, maintenanceTypeId: null });
  const part = (title: string, cents: number, description: string | null = null, quantity = 1, unit = 'Stk', maintenanceTypeId: string | null = null): ApprovalLine => ({ title, description, quantity, unit, unitPriceCents: cents, vatRateBp: 1900, maintenanceTypeId });

  // Angebot Zahnriemen: Version 1 (ersetzt) und Version 2 (wartet auf Kundin)
  const offerV1 = buildVersion({
    id: seedId(17, 1),
    requestId: A.timingBeltOffer,
    versionNo: 1,
    createdBy: U.service,
    sentAt: at(-6, 11, 5),
    content: {
      kind: 'offer',
      title: 'Angebot Zahnriemenwechsel',
      summaryCustomer: 'Der Zahnriemen Ihres Octavia sollte altersbedingt erneuert werden. Das Angebot umfasst den Zahnriemensatz mit Spannrolle und die Arbeitszeit.',
      lines: [part('Zahnriemensatz mit Spannrolle', 28_900, 'Markenteil in Erstausrüsterqualität', 1, 'Satz', M.timingBelt), labor(3.5)],
      scheduleChange: null,
      newReadyAt: null,
      photoIds: [],
      documentVersionId: seedId(20, 3),
    },
  });
  const offerV2 = buildVersion({
    id: seedId(17, 2),
    requestId: A.timingBeltOffer,
    versionNo: 2,
    createdBy: U.service,
    sentAt: at(-3, 11, 20),
    content: {
      kind: 'offer',
      title: 'Angebot Zahnriemenwechsel',
      summaryCustomer:
        'Wir empfehlen, die Wasserpumpe beim Zahnriemenwechsel gleich mit zu erneuern. Sie wird vom Zahnriemen angetrieben; ein späterer Tausch würde die Arbeitszeit ein zweites Mal kosten. Gegenüber Version 1 kommen Wasserpumpe und Kühlmittel hinzu, die Arbeitszeit steigt um 0,3 Stunden.',
      lines: [
        part('Zahnriemensatz mit Spannrolle', 28_900, 'Markenteil in Erstausrüsterqualität', 1, 'Satz', M.timingBelt),
        part('Wasserpumpe', 9_640, 'Wird zusammen mit dem Zahnriemen gewechselt'),
        part('Kühlmittel G13', 890, null, 3, 'Liter'),
        labor(3.8),
      ],
      scheduleChange: 'Termin laut Vorschlag der Werkstatt, Dauer ein Arbeitstag.',
      newReadyAt: wd(9, 16),
      photoIds: [],
      documentVersionId: seedId(20, 4),
    },
  });

  const brakesV1 = buildVersion({
    id: seedId(17, 3),
    requestId: A.brakes,
    versionNo: 1,
    createdBy: U.service,
    sentAt: at(-1, 14, 20),
    content: {
      kind: 'additional_work',
      title: 'Bremsen vorne: Scheiben und Beläge',
      summaryCustomer:
        'Bei der Inspektion haben wir festgestellt, dass die Bremsbeläge vorne fast abgefahren sind (Restbelag unter 3 mm). Die Bremsscheiben haben einen deutlichen Rand. Wir empfehlen, Scheiben und Beläge vorne gemeinsam zu erneuern. Ohne Ihre Freigabe führen wir nur die vereinbarten Arbeiten aus.',
      lines: [
        part('Bremsscheiben vorne (Paar)', 12_840),
        part('Bremsbeläge vorne (Satz)', 5_490, null, 1, 'Satz'),
        labor(1.2),
      ],
      scheduleChange: 'Die Fertigstellung verschiebt sich um einen Tag.',
      newReadyAt: wd(2, 15),
      photoIds: [P.disc, P.pad],
      documentVersionId: null,
    },
  });

  const wipersV1 = buildVersion({
    id: seedId(17, 4),
    requestId: A.wipers,
    versionNo: 1,
    createdBy: U.service,
    sentAt: at(-31, 10, 30),
    content: {
      kind: 'additional_work',
      title: 'Wischerblatt hinten erneuern',
      summaryCustomer: 'Das Wischerblatt der Heckscheibe ist rissig und wischt streifig.',
      lines: [part('Wischerblatt hinten', 2_190)],
      scheduleChange: null,
      newReadyAt: null,
      photoIds: [P.wiper],
      documentVersionId: null,
    },
  });
  wipersV1.decision = {
    id: seedId(18, 1),
    versionId: wipersV1.id,
    decision: 'rejected',
    decidedByUserId: U.miriam,
    decidedByDisplayName: 'Miriam Kowalczyk',
    customerId: C.miriam,
    decidedAt: at(-31, 12, 4),
    contentHash: wipersV1.contentHash,
    channel: 'ios',
    comment: 'Das mache ich selbst.',
  };

  const approvals: DApprovalRequest[] = [
    { id: A.timingBeltOffer, workOrderId: W.octaviaTimingBelt, kind: 'offer', title: 'Angebot Zahnriemenwechsel', status: 'pending_customer', findingId: null, createdBy: U.service, createdAt: at(-6, 11), versions: [{ ...offerV1, supersededAt: at(-3, 11, 20) }, offerV2] },
    { id: A.brakes, workOrderId: W.octaviaInspection, kind: 'additional_work', title: 'Bremsen vorne: Scheiben und Beläge', status: 'pending_customer', findingId: seedId(13, 1), createdBy: U.service, createdAt: at(-1, 14), versions: [brakesV1] },
    { id: A.wipers, workOrderId: W.golfAc, kind: 'additional_work', title: 'Wischerblatt hinten erneuern', status: 'rejected', findingId: null, createdBy: U.service, createdAt: at(-31, 10, 25), versions: [wipersV1] },
  ];

  // Positionen zu den offenen Anfragen (warten auf Freigabe, Mechaniker gesperrt)
  let pos = 3;
  for (const line of brakesV1.lines) {
    workItems.push(item({ workOrderId: W.octaviaInspection, position: pos++, title: line.title, kind: 'flat_rate', unitPriceCents: line.unitPriceCents, quantity: line.quantity, unit: line.unit, origin: 'additional', authorization: 'pending_approval', approvalRequestId: A.brakes, assignedTo: U.emre }));
  }
  pos = 1;
  for (const line of offerV2.lines) {
    workItems.push(item({ workOrderId: W.octaviaTimingBelt, position: pos++, title: line.title, kind: 'flat_rate', unitPriceCents: line.unitPriceCents, quantity: line.quantity, unit: line.unit, origin: 'offer', authorization: 'pending_approval', approvalRequestId: A.timingBeltOffer, maintenanceTypeId: line.maintenanceTypeId, intervalKm: line.maintenanceTypeId ? 180_000 : null, intervalMonths: line.maintenanceTypeId ? 120 : null, assignedTo: U.lukas }));
  }

  const intakes: DIntake[] = [
    { id: seedId(12, 1), workOrderId: W.octaviaInspection, odometerKm: 91_480, fuelLevel: '1/2', customerComplaint: 'Inspektion fällig. Beim Bremsen leichtes Schleifgeräusch vorne.', damages: [{ area: 'Stoßfänger hinten links', description: 'Kratzer ca. 5 cm, vorhanden bei Annahme', photoId: null }], agreedServices: 'Inspektion nach Herstellervorgabe, Ölwechsel mit Filter', costLimitCents: 45_000, notesInternal: 'Schlüssel am Brett Platz 7.', notesCustomer: 'Bitte vor weiteren Arbeiten anrufen.', confirmedAt: at(-2, 7, 50), confirmationMethod: 'on_site_signature' as const, contentHash: '' },
    { id: seedId(12, 2), workOrderId: W.sprinter, odometerKm: 187_644, fuelLevel: '3/4', customerComplaint: 'Klackern beim Anfahren, vor allem im ersten Gang.', damages: [], agreedServices: 'Fehlersuche bis 2 Stunden', costLimitCents: 20_000, notesInternal: null, notesCustomer: null, confirmedAt: at(0, 7, 40), confirmationMethod: 'on_site_signature' as const, contentHash: '' },
    { id: seedId(12, 3), workOrderId: W.yaris, odometerKm: 58_120, fuelLevel: '1/4', customerComplaint: 'Jahresinspektion.', damages: [], agreedServices: 'Inspektion mit Hybrid-Check, Bremsflüssigkeit', costLimitCents: null, notesInternal: 'Kunde ohne App.', notesCustomer: null, confirmedAt: at(0, 9, 8), confirmationMethod: 'on_site_signature' as const, contentHash: '' },
  ];
  // Inhalts-Hash der bestätigten Annahme wie in der API (Domain `computeIntakeHash`)
  for (const intake of intakes) {
    intake.contentHash = computeIntakeHash({ ...intake, items: workItems.filter((i) => i.workOrderId === intake.workOrderId) });
  }

  const findings = [
    { id: seedId(13, 1), workOrderId: W.octaviaInspection, workItemId: null, description: 'Bremsbeläge vorne unter 3 mm, Bremsscheiben mit deutlichem Rand. Austausch empfohlen.', severity: 'urgent' as const, status: 'converted' as const, reportedBy: U.emre, dictated: false, photoIds: [P.disc, P.pad], createdAt: at(-1, 11, 15) },
    { id: seedId(13, 2), workOrderId: W.sprinter, workItemId: null, description: 'Leichtes Spiel an der Antriebswelle rechts, weiter prüfen.', severity: 'recommended' as const, status: 'new' as const, reportedBy: U.lukas, dictated: true, photoIds: [], createdAt: at(0, 8, 40) },
  ];

  // -------------------------------------------------------------------------
  // Servicehistorie (nur aus fachlich abgeschlossenen Aufträgen)
  // -------------------------------------------------------------------------
  let seN = 0;
  const entry = (p: Omit<DServiceEntry, 'id' | 'status' | 'revisionOfId' | 'revisionNo' | 'correctionReason' | 'source' | 'workshopName' | 'nextDueDate' | 'nextDueKm'> & Partial<DServiceEntry>): DServiceEntry => {
    const merged: DServiceEntry = { id: seedId(25, ++seN), status: 'valid', revisionOfId: null, revisionNo: 1, correctionReason: null, source: 'work_completion', workshopName: WORKSHOP, nextDueDate: null, nextDueKm: null, ...p };
    // Fälligkeit immer aus den endgültigen Werten (auch bei Korrektur-Revisionen)
    merged.nextDueDate = merged.intervalMonths ? addMonths(merged.performedOn, merged.intervalMonths) : null;
    merged.nextDueKm = merged.intervalKm && merged.odometerKm !== null ? merged.odometerKm + merged.intervalKm : null;
    return merged;
  };
  const itemOf = (workOrderId: string, title: string) => workItems.find((i) => i.workOrderId === workOrderId && i.title === title)?.id ?? null;

  const rohdeOilOriginal = entry({ vehicleId: V.octavia, workOrderId: W.rohde2025, workItemId: itemOf(W.rohde2025, 'Ölwechsel inkl. Ölfilter'), maintenanceTypeId: M.oil, performedOn: day(-300), odometerKm: 8_402, title: 'Ölwechsel mit Filter', details: 'Motoröl 5W-30 nach VW 507.00, Ölfilter erneuert.', intervalKm: 15_000, intervalMonths: 12, createdBy: U.service, createdAt: at(-300, 14), status: 'superseded' });
  const rohdeOilCorrected = entry({ ...rohdeOilOriginal, id: seedId(25, 90), odometerKm: 84_020, revisionOfId: rohdeOilOriginal.id, revisionNo: 2, correctionReason: 'Kilometerstand bei der Erfassung vertippt (8.402 statt 84.020 km).', createdBy: U.owner, createdAt: at(-296, 9), status: 'valid' });

  const serviceEntries: DServiceEntry[] = [
    entry({ vehicleId: V.golf, workOrderId: W.golf2024, workItemId: itemOf(W.golf2024, 'Inspektion nach Herstellervorgabe'), maintenanceTypeId: M.inspection, performedOn: day(-700), odometerKm: 38_214, title: 'Inspektion', details: 'Inspektion nach Herstellervorgabe ohne Mängel.', intervalKm: 30_000, intervalMonths: 24, createdBy: U.service, createdAt: at(-700, 15) }),
    entry({ vehicleId: V.golf, workOrderId: W.golf2025, workItemId: itemOf(W.golf2025, 'Ölwechsel inkl. Ölfilter'), maintenanceTypeId: M.oil, performedOn: day(-345), odometerKm: 51_870, title: 'Ölwechsel mit Filter', details: 'Motoröl 0W-20, Ölfilter erneuert.', intervalKm: 15_000, intervalMonths: 12, createdBy: U.service, createdAt: at(-345, 15) }),
    entry({ vehicleId: V.golf, workOrderId: W.golf2025, workItemId: itemOf(W.golf2025, 'Hauptuntersuchung mit Abgasuntersuchung'), maintenanceTypeId: M.hu, performedOn: day(-345), odometerKm: 51_870, title: 'Hauptuntersuchung (HU/AU)', details: 'Ohne Mängel, Plakette erteilt.', intervalKm: null, intervalMonths: 24, createdBy: U.service, createdAt: at(-345, 15) }),
    entry({ vehicleId: V.golf, workOrderId: W.golfAc, workItemId: itemOf(W.golfAc, 'Klimaanlagen-Service mit Desinfektion'), maintenanceTypeId: M.ac, performedOn: day(-30), odometerKm: 63_947, title: 'Klimaanlagen-Service', details: 'Kältemittel ergänzt, Anlage dicht, Desinfektion durchgeführt.', intervalKm: null, intervalMonths: 24, createdBy: U.service, createdAt: at(-30, 15) }),
    entry({ vehicleId: V.octavia, workOrderId: W.rohde2024, workItemId: itemOf(W.rohde2024, 'Inspektion nach Herstellervorgabe'), maintenanceTypeId: M.inspection, performedOn: day(-900), odometerKm: 71_350, title: 'Inspektion', details: 'Inspektion nach Herstellervorgabe, Pollenfilter erneuert.', intervalKm: 30_000, intervalMonths: 24, createdBy: U.owner, createdAt: at(-900, 15) }),
    rohdeOilOriginal,
    rohdeOilCorrected,
    entry({ vehicleId: V.corsa, workOrderId: W.rohdeCorsa, workItemId: itemOf(W.rohdeCorsa, 'Ölwechsel inkl. Ölfilter'), maintenanceTypeId: M.oil, performedOn: day(-100), odometerKm: 23_410, title: 'Ölwechsel mit Filter', details: 'Motoröl 0W-30, Ölfilter erneuert.', intervalKm: 15_000, intervalMonths: 12, createdBy: U.service, createdAt: at(-100, 15) }),
    entry({ vehicleId: V.transit, workOrderId: W.transit, workItemId: itemOf(W.transit, 'Inspektion nach Herstellervorgabe'), maintenanceTypeId: M.inspection, performedOn: day(-1), odometerKm: 142_305, title: 'Inspektion', details: null, intervalKm: 30_000, intervalMonths: 24, createdBy: U.service, createdAt: at(-1, 15, 30) }),
    entry({ vehicleId: V.transit, workOrderId: W.transit, workItemId: itemOf(W.transit, 'Bremsflüssigkeit wechseln'), maintenanceTypeId: M.brakeFluid, performedOn: day(-1), odometerKm: 142_305, title: 'Bremsflüssigkeit wechseln', details: null, intervalKm: null, intervalMonths: 24, createdBy: U.service, createdAt: at(-1, 15, 30) }),
  ];

  // -------------------------------------------------------------------------
  // Rechnungen und Zahlungen (Beträge aus den ausgeführten Positionen)
  // -------------------------------------------------------------------------
  const grossFor = (workOrderId: string): number =>
    workItems
      .filter((i) => i.workOrderId === workOrderId && i.executionStatus === 'done' && (i.authorization === 'agreed' || i.authorization === 'approved'))
      .reduce((sum, i) => sum + lineTotals({ quantity: i.quantity, unitPriceCents: i.unitPriceCents ?? 0, vatRateBp: i.vatRateBp }).grossCents, 0);
  const netFor = (workOrderId: string): number =>
    workItems
      .filter((i) => i.workOrderId === workOrderId && i.executionStatus === 'done' && (i.authorization === 'agreed' || i.authorization === 'approved'))
      .reduce((sum, i) => sum + lineTotals({ quantity: i.quantity, unitPriceCents: i.unitPriceCents ?? 0, vatRateBp: i.vatRateBp }).netCents, 0);
  const invoice = (p: Pick<DInvoice, 'id' | 'invoiceNumber' | 'workOrderId' | 'customerId' | 'issuedAt' | 'dueDate' | 'documentId'>): DInvoice => {
    const total = grossFor(p.workOrderId!);
    const net = netFor(p.workOrderId!);
    return { ...p, status: 'issued', totalGrossCents: total, currency: 'EUR', vatBreakdown: [{ vatRateBp: 1900, netCents: net, vatCents: total - net }], createdAt: p.issuedAt!, cancelledAt: null };
  };
  const I = IDS.invoices;
  const D = {
    intake: seedId(19, 1),
    offer: seedId(19, 2),
    invGolfWheels: seedId(19, 3),
    invGolfAc: seedId(19, 4),
    invGolf2025: seedId(19, 5),
    huReport: seedId(19, 6),
    internalCalc: seedId(19, 7),
    invRohde2024: seedId(19, 8),
    invRohde2025: seedId(19, 9),
    invGolf2024: seedId(19, 10),
    invSprinterDoor: seedId(19, 11),
    invTransit: seedId(19, 12),
    invRohdeCorsa: seedId(19, 13),
  };
  const invoices: DInvoice[] = [
    invoice({ id: I.golf2024, invoiceNumber: 'R-2024-0921', workOrderId: W.golf2024, customerId: C.miriam, issuedAt: at(-700, 16), dueDate: day(-686), documentId: D.invGolf2024 }),
    invoice({ id: I.golf2025, invoiceNumber: 'R-2025-0655', workOrderId: W.golf2025, customerId: C.miriam, issuedAt: at(-345, 16), dueDate: day(-331), documentId: D.invGolf2025 }),
    invoice({ id: I.golfAc, invoiceNumber: 'R-2026-0287', workOrderId: W.golfAc, customerId: C.miriam, issuedAt: at(-29, 9), dueDate: day(-15), documentId: D.invGolfAc }),
    invoice({ id: I.golfWheels, invoiceNumber: 'R-2026-0311', workOrderId: W.golfWheels, customerId: C.miriam, issuedAt: at(-3, 12, 5), dueDate: day(11), documentId: D.invGolfWheels }),
    invoice({ id: I.rohde2024, invoiceNumber: 'R-2024-0133', workOrderId: W.rohde2024, customerId: C.guenter, issuedAt: at(-900, 16), dueDate: day(-886), documentId: D.invRohde2024 }),
    invoice({ id: I.rohde2025, invoiceNumber: 'R-2025-0802', workOrderId: W.rohde2025, customerId: C.guenter, issuedAt: at(-300, 15), dueDate: day(-286), documentId: D.invRohde2025 }),
    invoice({ id: I.rohdeCorsa, invoiceNumber: 'R-2026-0104', workOrderId: W.rohdeCorsa, customerId: C.guenter, issuedAt: at(-100, 16), dueDate: day(-86), documentId: D.invRohdeCorsa }),
    invoice({ id: I.sprinterDoor, invoiceNumber: 'R-2026-0270', workOrderId: W.sprinterDoor, customerId: C.brinkhoff, issuedAt: at(-20, 9), dueDate: day(-6), documentId: D.invSprinterDoor }),
    invoice({ id: I.transit, invoiceNumber: 'R-2026-0316', workOrderId: W.transit, customerId: C.brinkhoff, issuedAt: at(-1, 16), dueDate: day(13), documentId: D.invTransit }),
  ];
  const totalOf = (id: string) => invoices.find((i) => i.id === id)!.totalGrossCents;

  let payN = 0;
  const payment = (invoiceId: string, method: 'sumup_online' | 'bank_transfer' | 'cash' | 'card_terminal', amountCents: number, receivedAt: string, recordedBy: string | null, referenceText: string | null) => ({
    id: seedId(24, ++payN),
    invoiceId,
    method,
    amountCents,
    currency: 'EUR' as const,
    provider: method === 'sumup_online' ? ('sumup' as const) : null,
    providerTransactionId: method === 'sumup_online' ? `TX-DEMO-${payN.toString().padStart(4, '0')}` : null,
    checkoutId: null,
    receivedAt,
    recordedBy,
    referenceText,
  });
  const payments = [
    payment(I.golf2024, 'bank_transfer', totalOf(I.golf2024), at(-690, 10), U.service, 'R-2024-0921 Kowalczyk'),
    payment(I.golf2025, 'sumup_online', totalOf(I.golf2025), at(-344, 19, 12), null, 'R-2025-0655-1'),
    payment(I.rohde2024, 'card_terminal', totalOf(I.rohde2024), at(-900, 17), U.owner, 'Kartenzahlung vor Ort'),
    payment(I.rohde2025, 'cash', totalOf(I.rohde2025), at(-300, 16), U.service, 'Barzahlung bei Abholung'),
    payment(I.rohdeCorsa, 'bank_transfer', totalOf(I.rohdeCorsa), at(-95, 9), U.service, 'R-2026-0104'),
    payment(I.sprinterDoor, 'bank_transfer', 60_000, at(-12, 9, 30), U.service, 'Abschlag R-2026-0270'),
  ];

  // -------------------------------------------------------------------------
  // Dokumente (veröffentlicht = für den Kunden sichtbar; intern nie)
  // -------------------------------------------------------------------------
  let dvN = 0;
  const docVersion = (fileId: string, createdAt: string, note: string | null = null, id?: string) => ({ id: id ?? seedId(20, 100 + ++dvN), versionNo: 1, fileId, note, createdAt });
  const doc = (p: Omit<DDocument, 'deletedAt'>): DDocument => ({ deletedAt: null, ...p });
  const documents: DDocument[] = [
    doc({ id: D.intake, kind: 'intake_protocol', title: 'Annahmeprotokoll A-2026-0187', customerId: C.miriam, vehicleId: V.octavia, workOrderId: W.octaviaInspection, visibility: 'customer', publishedAt: at(-2, 7, 55), createdAt: at(-2, 7, 52), versions: [docVersion(pdf('annahmeprotokoll-A-2026-0187.pdf'), at(-2, 7, 52))] }),
    doc({ id: D.offer, kind: 'offer', title: 'Angebot Zahnriemenwechsel A-2026-0190', customerId: C.miriam, vehicleId: V.octavia, workOrderId: W.octaviaTimingBelt, visibility: 'customer', publishedAt: at(-6, 11), createdAt: at(-6, 11), versions: [
      { id: seedId(20, 3), versionNo: 1, fileId: pdf('angebot-A-2026-0190-v1.pdf'), note: 'Version 1', createdAt: at(-6, 11) },
      { id: seedId(20, 4), versionNo: 2, fileId: pdf('angebot-A-2026-0190-v2.pdf'), note: 'Version 2 mit Wasserpumpe', createdAt: at(-3, 11, 15) },
    ] }),
    doc({ id: D.invGolfWheels, kind: 'invoice', title: 'Rechnung R-2026-0311', customerId: C.miriam, vehicleId: V.golf, workOrderId: W.golfWheels, visibility: 'customer', publishedAt: at(-3, 12, 5), createdAt: at(-3, 12), versions: [docVersion(pdf('rechnung-R-2026-0311.pdf'), at(-3, 12))] }),
    doc({ id: D.invGolfAc, kind: 'invoice', title: 'Rechnung R-2026-0287', customerId: C.miriam, vehicleId: V.golf, workOrderId: W.golfAc, visibility: 'customer', publishedAt: at(-29, 9), createdAt: at(-29, 9), versions: [docVersion(pdf('rechnung-R-2026-0287.pdf'), at(-29, 9))] }),
    doc({ id: D.invGolf2025, kind: 'invoice', title: 'Rechnung R-2025-0655', customerId: C.miriam, vehicleId: V.golf, workOrderId: W.golf2025, visibility: 'customer', publishedAt: at(-345, 16), createdAt: at(-345, 16), versions: [docVersion(pdf('rechnung-R-2025-0655.pdf'), at(-345, 16))] }),
    doc({ id: D.huReport, kind: 'report', title: 'Prüfbericht Hauptuntersuchung', customerId: C.miriam, vehicleId: V.golf, workOrderId: W.golf2025, visibility: 'customer', publishedAt: at(-345, 16), createdAt: at(-345, 15), versions: [docVersion(pdf('pruefbericht-hu-golf.pdf'), at(-345, 15))] }),
    doc({ id: D.invGolf2024, kind: 'invoice', title: 'Rechnung R-2024-0921', customerId: C.miriam, vehicleId: V.golf, workOrderId: W.golf2024, visibility: 'customer', publishedAt: at(-700, 16), createdAt: at(-700, 16), versions: [docVersion(pdf('rechnung-R-2024-0921.pdf'), at(-700, 16))] }),
    doc({ id: D.internalCalc, kind: 'other', title: 'Kalkulation Zahnriemen (intern)', customerId: C.miriam, vehicleId: V.octavia, workOrderId: W.octaviaTimingBelt, visibility: 'internal', publishedAt: null, createdAt: at(-6, 10), versions: [docVersion(pdf('kalkulation-intern.pdf'), at(-6, 10))] }),
    doc({ id: D.invRohde2024, kind: 'invoice', title: 'Rechnung R-2024-0133', customerId: C.guenter, vehicleId: V.octavia, workOrderId: W.rohde2024, visibility: 'customer', publishedAt: at(-900, 16), createdAt: at(-900, 16), versions: [docVersion(pdf('rechnung-R-2024-0133.pdf'), at(-900, 16))] }),
    doc({ id: D.invRohde2025, kind: 'invoice', title: 'Rechnung R-2025-0802', customerId: C.guenter, vehicleId: V.octavia, workOrderId: W.rohde2025, visibility: 'customer', publishedAt: at(-300, 15), createdAt: at(-300, 15), versions: [docVersion(pdf('rechnung-R-2025-0802.pdf'), at(-300, 15))] }),
    doc({ id: D.invRohdeCorsa, kind: 'invoice', title: 'Rechnung R-2026-0104', customerId: C.guenter, vehicleId: V.corsa, workOrderId: W.rohdeCorsa, visibility: 'customer', publishedAt: at(-100, 16), createdAt: at(-100, 16), versions: [docVersion(pdf('rechnung-R-2026-0104.pdf'), at(-100, 16))] }),
    doc({ id: D.invSprinterDoor, kind: 'invoice', title: 'Rechnung R-2026-0270', customerId: C.brinkhoff, vehicleId: V.sprinter, workOrderId: W.sprinterDoor, visibility: 'customer', publishedAt: at(-20, 9), createdAt: at(-20, 9), versions: [docVersion(pdf('rechnung-R-2026-0270.pdf'), at(-20, 9))] }),
    doc({ id: D.invTransit, kind: 'invoice', title: 'Rechnung R-2026-0316', customerId: C.brinkhoff, vehicleId: V.transit, workOrderId: W.transit, visibility: 'customer', publishedAt: at(-1, 16), createdAt: at(-1, 16), versions: [docVersion(pdf('rechnung-R-2026-0316.pdf'), at(-1, 16))] }),
  ];
  // Angebotsversion der Freigabe verweist auf die Dokumentversion 2
  // (documentVersionId in offerV2 = seedId(20, 4)).

  // -------------------------------------------------------------------------
  // Chat (auftragsbezogen). Ein "Ja" im Chat ist keine Freigabe.
  // -------------------------------------------------------------------------
  let msgN = 0;
  const msg = (workOrderId: string, authorUserId: string, body: string, createdAt: string, photoIds: string[] = []): DMessage => ({
    id: seedId(21, ++msgN),
    workOrderId,
    authorUserId,
    body,
    photoIds,
    clientMessageId: null,
    createdAt,
  });
  const messages: DMessage[] = [
    msg(W.octaviaInspection, U.service, 'Guten Morgen Frau Kowalczyk, Ihr Octavia ist bei uns angekommen. Wir melden uns, sobald die Inspektion durch ist.', at(-2, 8, 12)),
    msg(W.octaviaInspection, U.service, 'Wir haben an den Bremsen vorne etwas gefunden. Das Foto zeigt die Bremsscheibe vorne links. Die Freigabeanfrage mit allen Kosten finden Sie im Auftrag.', at(-1, 14, 22), [P.chatDisc]),
    msg(W.octaviaInspection, U.miriam, 'Ja, machen Sie das bitte.', at(-1, 17, 5)),
    msg(W.octaviaInspection, U.service, 'Danke, Frau Kowalczyk. Bitte bestätigen Sie die Zusatzarbeit noch über „Freigeben“ im Auftrag. Eine Zusage im Chat können wir nicht als Freigabe werten.', at(-1, 17, 31)),
    msg(W.octaviaTimingBelt, U.service, 'Wir haben das Angebot um die Wasserpumpe ergänzt (Version 2). Die Begründung steht im Angebot.', at(-3, 11, 25)),
    msg(W.golfAc, U.service, 'Ihr Golf ist fertig und kann ab 15:30 Uhr abgeholt werden.', at(-30, 15, 12)),
    msg(W.golfAc, U.miriam, 'Danke, ich komme morgen früh vorbei.', at(-30, 16, 2)),
    msg(W.rohde2025, U.service, 'Herr Rohde, Ihr Octavia ist fertig. Der Ölwechsel ist erledigt.', at(-300, 14, 5)),
    msg(W.rohde2025, U.guenter, 'Vielen Dank, ich hole ihn um 16 Uhr ab.', at(-300, 14, 30)),
    msg(W.transit, U.service, 'Der Transit ist fertig und abholbereit. Die Rechnung liegt im Kundenzugang.', at(-1, 15, 45)),
    msg(W.rohdeCorsa, U.guenter, 'Guten Morgen, ist bei der HU die Abgasuntersuchung dabei, oder muss ich die extra anmelden?', at(0, 8, 5)),
  ];
  const reads = [
    { workOrderId: W.octaviaInspection, userId: U.miriam, lastReadAt: at(-1, 17, 6) },
    { workOrderId: W.octaviaTimingBelt, userId: U.miriam, lastReadAt: at(-3, 18) },
    { workOrderId: W.golfAc, userId: U.miriam, lastReadAt: at(-30, 16, 3) },
    { workOrderId: W.rohde2025, userId: U.guenter, lastReadAt: at(-300, 14, 31) },
    { workOrderId: W.octaviaInspection, userId: U.service, lastReadAt: at(-1, 17, 30) },
    { workOrderId: W.golfAc, userId: U.service, lastReadAt: at(-30, 17) },
    { workOrderId: W.rohde2025, userId: U.service, lastReadAt: at(-300, 15) },
  ];
  const internalNotes = [
    { id: seedId(28, 1), workOrderId: W.octaviaInspection, authorUserId: U.emre, body: 'Scheiben vorne liegen auf Lager (2 Stück), Beläge müssten bestellt werden.', createdAt: at(-1, 11, 30) },
  ];

  // -------------------------------------------------------------------------
  // Termine
  // -------------------------------------------------------------------------
  const AP = IDS.appointments;
  const appt = (p: Partial<DAppointment> & Pick<DAppointment, 'id' | 'kind' | 'status' | 'customerId' | 'vehicleId' | 'startsAt' | 'endsAt'>): DAppointment => ({
    workOrderId: null,
    resourceId: null,
    assigneeIds: [],
    requestedBy: 'staff',
    customerNote: null,
    internalNote: null,
    proposals: [],
    confirmedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: at(-7),
    ...p,
  });
  const appointments: DAppointment[] = [
    appt({ id: AP.golfCheck, kind: 'other', status: 'requested', customerId: C.miriam, vehicleId: V.golf, startsAt: wd(14, 8), endsAt: wd(14, 10), requestedBy: 'customer', customerNote: 'Ich möchte den Golf verkaufen. Bitte einmal durchsehen, ob etwas zu machen ist.', createdAt: at(-1, 20, 15) }),
    appt({ id: AP.octaviaTimingBelt, kind: 'repair', status: 'proposed', customerId: C.miriam, vehicleId: V.octavia, workOrderId: W.octaviaTimingBelt, startsAt: wd(7, 8), endsAt: wd(7, 17), requestedBy: 'customer', customerNote: 'Am liebsten an einem Montag.', createdAt: at(-5, 19), proposals: [{ id: seedId(9, 1), startsAt: wd(9, 7, 30), endsAt: wd(9, 16), status: 'open', createdAt: at(-2, 9, 10), respondedAt: null }] }),
    appt({ id: AP.golfService, kind: 'service', status: 'confirmed', customerId: C.miriam, vehicleId: V.golf, workOrderId: W.golfService, startsAt: wd(6, 8), endsAt: wd(6, 16), resourceId: IDS.resources.lift1, assigneeIds: [U.emre], requestedBy: 'customer', customerNote: 'Ölwechsel laut Anzeige bald fällig.', confirmedAt: at(-5, 10), createdAt: at(-6, 18) }),
    appt({ id: AP.octaviaDropOff, kind: 'service', status: 'completed', customerId: C.miriam, vehicleId: V.octavia, workOrderId: W.octaviaInspection, startsAt: at(-2, 7, 30), endsAt: at(-2, 8), resourceId: IDS.resources.lift1, assigneeIds: [U.emre], confirmedAt: at(-8, 11), createdAt: at(-9) }),
    appt({ id: AP.corsaHu, kind: 'inspection_hu', status: 'confirmed', customerId: C.guenter, vehicleId: V.corsa, startsAt: wd(12, 10), endsAt: wd(12, 11), resourceId: IDS.resources.lift2, confirmedAt: at(-4, 9), createdAt: at(-5) }),
    appt({ id: AP.sprinterToday, kind: 'repair', status: 'confirmed', customerId: C.brinkhoff, vehicleId: V.sprinter, workOrderId: W.sprinter, startsAt: at(0, 7, 30), endsAt: at(0, 12), resourceId: IDS.resources.lift2, assigneeIds: [U.lukas], confirmedAt: at(-1, 16), createdAt: at(-1, 16) }),
    appt({ id: AP.transitPickup, kind: 'other', status: 'confirmed', customerId: C.brinkhoff, vehicleId: V.transit, workOrderId: W.transit, startsAt: at(0, 16), endsAt: at(0, 16, 30), assigneeIds: [U.lukas], internalNote: 'Abholung durch Mitarbeiter der Firma, Übergabe durch Lukas', confirmedAt: at(-1, 16), createdAt: at(-1, 16) }),
    // Bewusst doppelt belegt (Hebebühne 2 und Lukas), damit der Kalender den Konflikt zeigt
    appt({ id: AP.golfTpmsToday, kind: 'repair', status: 'confirmed', customerId: C.miriam, vehicleId: V.golf, startsAt: at(0, 10), endsAt: at(0, 11), resourceId: IDS.resources.lift2, assigneeIds: [U.lukas], customerNote: 'Reifendruck-Warnleuchte leuchtet seit gestern.', internalNote: 'Kurzfristig eingeschoben', confirmedAt: at(-1, 17), createdAt: at(-1, 17) }),
    appt({ id: AP.yarisToday, kind: 'service', status: 'confirmed', customerId: C.horst, vehicleId: V.yaris, workOrderId: W.yaris, startsAt: at(0, 9), endsAt: at(0, 15), resourceId: IDS.resources.lift1, assigneeIds: [U.emre], confirmedAt: at(-7, 10), createdAt: at(-7, 10) }),
    appt({ id: AP.yarisTires, kind: 'tire_change', status: 'requested', customerId: C.horst, vehicleId: V.yaris, startsAt: wd(18, 8), endsAt: wd(18, 9), requestedBy: 'staff', internalNote: 'Telefonisch angefragt, Rückruf zur Bestätigung.', createdAt: at(0, 9, 12) }),
  ];

  // -------------------------------------------------------------------------
  // Tokens, Freigaben für Dritte, Mitteilungen
  // -------------------------------------------------------------------------
  const tokens = [
    { tokenHash: sha256Hex(`token:${DEMO_TOKENS.invitationValid}`), userId: U.tobias, purpose: 'customer' as const, expiresAt: at(5), usedAt: null },
    { tokenHash: sha256Hex(`token:${DEMO_TOKENS.invitationExpired}`), userId: U.tobias, purpose: 'customer' as const, expiresAt: at(-3), usedAt: null },
    { tokenHash: sha256Hex(`token:${DEMO_TOKENS.invitationUsed}`), userId: U.miriam, purpose: 'customer' as const, expiresAt: at(-713), usedAt: at(-719) },
    { tokenHash: sha256Hex(`token:${DEMO_TOKENS.resetValid}`), userId: U.miriam, purpose: 'password_reset' as const, expiresAt: new Date(now + 60 * 60_000).toISOString(), usedAt: null },
    { tokenHash: sha256Hex(`token:${DEMO_TOKENS.resetExpired}`), userId: U.miriam, purpose: 'password_reset' as const, expiresAt: at(-1), usedAt: null },
  ];

  const golfEntries = serviceEntries.filter((e) => e.vehicleId === V.golf && e.status === 'valid').map((e) => e.id);
  const shares = [
    { id: IDS.shares.valid, vehicleId: V.golf, customerId: C.miriam, createdByUserId: U.miriam, tokenHash: hashShareToken(DEMO_TOKENS.shareValid), label: 'Verkauf Golf, Interessent aus Bochum', includeVin: true, serviceEntryIds: golfEntries.slice(0, 3), expiresAt: at(14, 23, 59), revokedAt: null, accessCount: 3, lastAccessedAt: at(-1, 19, 40), createdAt: at(-4, 21) },
    { id: IDS.shares.expired, vehicleId: V.golf, customerId: C.miriam, createdByUserId: U.miriam, tokenHash: hashShareToken(DEMO_TOKENS.shareExpired), label: 'Anfrage über Kleinanzeige', includeVin: false, serviceEntryIds: golfEntries.slice(0, 2), expiresAt: at(-2, 23, 59), revokedAt: null, accessCount: 1, lastAccessedAt: at(-6), createdAt: at(-9) },
    { id: IDS.shares.revoked, vehicleId: V.golf, customerId: C.miriam, createdByUserId: U.miriam, tokenHash: hashShareToken(DEMO_TOKENS.shareRevoked), label: 'Händler Ankauf', includeVin: true, serviceEntryIds: golfEntries, expiresAt: at(20), revokedAt: at(-3, 18), accessCount: 2, lastAccessedAt: at(-3, 17), createdAt: at(-8) },
  ];

  let nN = 0;
  const note = (userId: string, eventType: DemoState['notifications'][number]['eventType'], title: string, body: string, targetPath: string, createdAt: string, readAt: string | null = null) => ({
    id: seedId(27, ++nN),
    userId,
    eventType,
    title,
    body,
    targetPath,
    createdAt,
    readAt,
  });
  const notifications = [
    note(U.miriam, 'approval.requested', 'Freigabe erbeten: Bremsen vorne', 'Auftrag A-2026-0187, Octavia. Bitte prüfen Sie die Zusatzarbeit.', `/kunde/auftraege/${W.octaviaInspection}/freigaben/${A.brakes}`, at(-1, 14, 21)),
    note(U.miriam, 'message.received', 'Neue Nachricht zu A-2026-0187', 'Autowerkstatt Witten hat Ihnen geschrieben.', `/kunde/auftraege/${W.octaviaInspection}/chat`, at(-1, 17, 31)),
    note(U.miriam, 'approval.requested', 'Neue Angebotsversion: Zahnriemen', 'Auftrag A-2026-0190. Das Angebot wurde geändert (Version 2).', `/kunde/auftraege/${W.octaviaTimingBelt}/freigaben/${A.timingBeltOffer}`, at(-3, 11, 21), at(-3, 18)),
    note(U.miriam, 'invoice.issued', 'Rechnung R-2026-0311 bereitgestellt', 'Räderwechsel auf Winterräder.', `/kunde/rechnungen/${I.golfWheels}`, at(-3, 12, 6)),
    note(U.miriam, 'appointment.proposed', 'Terminvorschlag der Werkstatt', 'Für den Zahnriemenwechsel schlagen wir einen anderen Termin vor.', `/kunde/termine/${AP.octaviaTimingBelt}`, at(-2, 9, 11)),
    note(U.guenter, 'appointment.confirmed', 'Termin bestätigt: HU/AU', 'Opel Corsa, Termin bestätigt.', `/kunde/termine/${AP.corsaHu}`, at(-4, 9, 1), at(-4, 12)),
    note(U.service, 'approval.decided', 'Kundin hat entschieden', 'Wischerblatt hinten wurde abgelehnt.', `/werkstatt/auftraege/${W.golfAc}/freigaben/${A.wipers}`, at(-31, 12, 5), at(-31, 13)),
    note(U.service, 'appointment.requested', 'Neue Terminanfrage', 'Miriam Kowalczyk, Golf.', `/werkstatt/termine/${AP.golfCheck}`, at(-1, 20, 16)),
    note(U.service, 'finding.reported', 'Zusatzarbeit gemeldet', 'Sprinter EN-BH 977: Spiel an der Antriebswelle.', `/werkstatt/auftraege/${W.sprinter}/arbeiten`, at(0, 8, 41)),
  ];

  const audit = [
    { id: seedId(29, 1), occurredAt: at(-31, 12, 4), actorUserId: U.miriam, actorRole: 'customer' as const, action: 'approval.decided', entityType: 'approval_version', entityId: wipersV1.id, data: { decision: 'rejected', contentHash: wipersV1.contentHash, channel: 'ios' } },
    { id: seedId(29, 2), occurredAt: at(-164, 12), actorUserId: U.service, actorRole: 'service' as const, action: 'vehicle.ownership_transferred', entityType: 'vehicle', entityId: V.octavia, data: { from: C.guenter, to: C.miriam } },
    { id: seedId(29, 3), occurredAt: at(-296, 9), actorUserId: U.owner, actorRole: 'admin' as const, action: 'service_entry.corrected', entityType: 'service_entry', entityId: rohdeOilCorrected.id, data: { reason: rohdeOilCorrected.correctionReason } },
  ];

  const partDemands: DPartDemand[] = [
    { id: seedId(30, 1), workOrderId: W.octaviaTimingBelt, description: 'Zahnriemensatz mit Spannrolle', status: 'ordered', expectedAt: wd(8, 10) },
    { id: seedId(30, 2), workOrderId: W.octaviaTimingBelt, description: 'Wasserpumpe', status: 'needed', expectedAt: null },
    { id: seedId(30, 3), workOrderId: W.golfService, description: 'Innenraumfilter mit Aktivkohle', status: 'ordered', expectedAt: wd(8, 10) },
  ];
  const workingHours: DWorkingHours[] = [
    ...[1, 2, 3, 4, 5].map((weekday) => ({ userId: U.emre, weekday, startTime: '07:30', endTime: '16:30' })),
    ...[1, 2, 3, 4, 5].map((weekday) => ({ userId: U.lukas, weekday, startTime: '07:00', endTime: '15:30' })),
  ];

  return {
    schemaVersion: DEMO_SCHEMA_VERSION,
    seededAt,
    settings: {
      name: WORKSHOP,
      legalName: 'Autowerkstatt Witten (Beispielbetrieb)',
      street: 'Am Beispielhof 3',
      postalCode: '58452',
      city: 'Witten',
      phone: '02302 0 47 11 20',
      email: 'service@autowerkstatt-witten.example',
      website: null,
      vatId: 'DE000000000',
      iban: 'DE32 9991 2345 0004 7112 08',
      bic: null,
      bankName: 'Beispielbank (Demo)',
      openingHours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: '07:30', closes: '17:00' })),
      paymentTermDays: 14,
      paymentProvider: 'sumup',
      sumupMerchantCode: DEMO_MERCHANT_CODE,
      paymentProviderConfigured: true,
    },
    users,
    customers,
    customerAccounts: [
      { customerId: C.miriam, userId: U.miriam },
      { customerId: C.guenter, userId: U.guenter },
      { customerId: C.brinkhoff, userId: U.tobias },
    ],
    tokens,
    vehicles,
    ownerships,
    odometer,
    maintenanceTypes,
    resources,
    appointments,
    workOrders,
    workItems,
    intakes,
    findings,
    files,
    photos,
    approvals,
    documents,
    messages,
    reads,
    internalNotes,
    invoices,
    checkouts: [],
    payments,
    refunds: [],
    providerCheckouts: [],
    providerEvents: [],
    serviceEntries,
    shares,
    notifications,
    notificationPreferences: [],
    audit,
    partDemands,
    workingHours,
    counters: { workOrder: 193, invoice: 316, customer: 10245 },
  };
}
