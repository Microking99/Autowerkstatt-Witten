/**
 * HttpApi: WerkstattApi gegen die echte API (apps/api).
 *
 * - Basis: EXPO_PUBLIC_API_URL + /api/v1 (API_PREFIX aus @werkstatt/contracts)
 * - Anmeldung: Authorization: Bearer <token>
 * - Schreibende Anfragen tragen einen Idempotency-Key (Schutz bei Verbindungsabbruch).
 * - In der Entwicklung werden Antworten mit den zod-Schemas aus contracts geprüft;
 *   Abweichungen fallen so früh als RESPONSE_INVALID auf.
 *
 * Diese Datei importiert bewusst nichts aus React Native, damit sie in Unit-Tests läuft.
 */
import {
  API_PREFIX,
  ApiErrorSchema,
  AppointmentSchema,
  ApprovalRequestSchema,
  AssignableStaffSchema,
  AuditEntrySchema,
  ConversationSchema,
  CustomerDetailSchema,
  CustomerSummarySchema,
  DashboardTileSchema,
  DocumentSchema,
  FileRefSchema,
  FindingSchema,
  IntakeSchema,
  InternalNoteSchema,
  InvoiceSchema,
  LoginResponseSchema,
  MaintenanceDueSchema,
  MaintenanceTypeSchema,
  MessageSchema,
  NotificationSchema,
  OdometerReadingSchema,
  OwnershipSchema,
  PageSchema,
  PhotoSchema,
  PublicVehicleViewSchema,
  QrResolutionSchema,
  ResourceSchema,
  SchedulingConflictSchema,
  ServiceEntrySchema,
  SessionUserSchema,
  StaffUserSchema,
  StartCheckoutResponseSchema,
  TimelineEntrySchema,
  VehicleDetailSchema,
  VehicleShareSchema,
  VehicleSummarySchema,
  WorkItemSchema,
  WorkOrderDetailSchema,
  WorkOrderSummarySchema,
  WorkshopSettingsSchema,
  buildPath,
  endpoints,
  type EndpointName,
} from '@werkstatt/contracts';
import { z, type ZodType } from 'zod';
import type { WerkstattApi, ImageSourceSpec, DownloadResult, NotificationPreference, WriteOptions } from './api';
import { ApiError, ERROR_CODES } from './errors';

type Query = Record<string, string | number | boolean | undefined | null>;

interface CallOptions {
  params?: Record<string, string>;
  query?: Query;
  body?: unknown;
  schema?: ZodType;
  /** Stabiler Schlüssel für Wiederholungen derselben Aktion; sonst je Aufruf neu */
  idempotencyKey?: string;
}

export interface HttpApiOptions {
  /** z. B. https://api.autowerkstatt-witten.de (ohne /api/v1) */
  baseUrl: string;
  /** Antworten mit zod prüfen (Entwicklung) */
  validateResponses?: boolean;
  /** UUID-Erzeugung (nativ: expo-crypto) */
  newId?: () => string;
  fetchImpl?: typeof fetch;
  /**
   * Nativ (iOS/Android): Datei mit Anmelde-Header herunterladen und lokal ablegen
   * (expo-file-system). Fehlt die Funktion, wird die Antwort als Blob bzw. Daten-URI geliefert
   * (Browser, Tests).
   */
  downloadFile?: (url: string, headers: Record<string, string>, fallbackName: string) => Promise<DownloadResult>;
}

/** Listen: API-Standard sind 50 Einträge je Seite; die Oberflächen laden bis 200. */
const LIST_LIMIT = 200;

const NotificationPreferencesSchema = z.array(
  z.object({ eventType: z.string(), channel: z.enum(['push', 'email']), enabled: z.boolean() }),
);

function defaultNewId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function toQueryString(query?: Query): string {
  if (!query) return '';
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

function defaultCode(status: number): string {
  if (status === 401) return ERROR_CODES.unauthorized;
  if (status === 403) return ERROR_CODES.forbidden;
  if (status === 404) return ERROR_CODES.notFound;
  if (status === 409) return ERROR_CODES.conflict;
  if (status === 400) return ERROR_CODES.badRequest;
  if (status === 422) return ERROR_CODES.validationFailed;
  if (status === 429) return ERROR_CODES.tooManyRequests;
  return ERROR_CODES.internalError;
}

export class HttpApi implements WerkstattApi {
  readonly mode = 'http' as const;
  private token: string | null = null;
  private readonly baseUrl: string;
  private readonly validate: boolean;
  private readonly newId: () => string;
  private readonly fetchImpl: typeof fetch;
  private readonly downloadFileImpl: HttpApiOptions['downloadFile'];

  constructor(options: HttpApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.validate = options.validateResponses ?? false;
    this.newId = options.newId ?? defaultNewId;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.downloadFileImpl = options.downloadFile;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  private url(path: string, query?: Query): string {
    return `${this.baseUrl}${API_PREFIX}${path}${toQueryString(query)}`;
  }

  private async request<T>(method: string, path: string, opts: CallOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...this.authHeaders() };
    let body: BodyInit | undefined;
    if (opts.body instanceof FormData) body = opts.body;
    else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    if (method !== 'GET') headers['Idempotency-Key'] = opts.idempotencyKey ?? this.newId();

    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path, opts.query), { method, headers, body });
    } catch {
      throw ApiError.network();
    }

    const text = res.status === 204 ? '' : await res.text().catch(() => '');
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (res.ok) throw new ApiError(res.status, ERROR_CODES.responseInvalid, 'Antwort des Servers ist kein JSON.');
      }
    }

    if (!res.ok) {
      const parsed = ApiErrorSchema.safeParse(json);
      if (parsed.success) throw new ApiError(res.status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.details);
      throw new ApiError(res.status, defaultCode(res.status), res.statusText || 'Fehler');
    }

    if (opts.schema && this.validate && json !== undefined) {
      const result = opts.schema.safeParse(json);
      if (!result.success) {
        // Nur bei eingeschalteter Prüfung (Entwicklung, Tests): Abweichung sichtbar protokollieren
        console.error(`Vertragsabweichung ${method} ${path}`, JSON.stringify(result.error.issues.slice(0, 5)));
        throw new ApiError(500, ERROR_CODES.responseInvalid, `Antwort passt nicht zum Vertrag (${method} ${path}).`, result.error.issues);
      }
      return result.data as T;
    }
    return json as T;
  }

  /** Binärdatei (Dokument, Export, QR-Aufkleber) mit Anmeldung laden. */
  private async download(path: string, fallbackName: string, failureMessage: string): Promise<DownloadResult> {
    const url = this.url(path);
    if (this.downloadFileImpl) return this.downloadFileImpl(url, this.authHeaders(), fallbackName);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: this.authHeaders() });
    } catch {
      throw ApiError.network();
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let parsed: ReturnType<typeof ApiErrorSchema.safeParse> | null = null;
      try {
        parsed = ApiErrorSchema.safeParse(JSON.parse(text));
      } catch {
        parsed = null;
      }
      if (parsed?.success) throw new ApiError(res.status, parsed.data.error.code, parsed.data.error.message);
      throw new ApiError(res.status, defaultCode(res.status), failureMessage);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') ?? '';
    const fileName = decodeURIComponent(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1] ?? fallbackName);
    const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream';
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    if (g.URL?.createObjectURL) return { uri: g.URL.createObjectURL(blob), fileName, mimeType };
    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(ApiError.network());
      reader.readAsDataURL(blob);
    });
    return { uri: dataUri, fileName, mimeType };
  }

  private call<T>(name: EndpointName, opts: CallOptions = {}): Promise<T> {
    const def = endpoints[name];
    return this.request<T>(def.method, buildPath(def.path, opts.params), opts);
  }

  // Anmeldung und Konto -------------------------------------------------------
  login: WerkstattApi['login'] = (input) => this.call('login', { body: input, schema: LoginResponseSchema });
  logout: WerkstattApi['logout'] = () => this.call('logout');
  me: WerkstattApi['me'] = () => this.call('me', { schema: SessionUserSchema });
  acceptInvitation: WerkstattApi['acceptInvitation'] = (input) => this.call('acceptInvitation', { body: input, schema: LoginResponseSchema });
  forgotPassword: WerkstattApi['forgotPassword'] = (input) => this.call('forgotPassword', { body: input });
  resetPassword: WerkstattApi['resetPassword'] = (input) => this.call('resetPassword', { body: input });
  changePassword: WerkstattApi['changePassword'] = (input) => this.call('changePassword', { body: input });

  // Mitarbeiter ----------------------------------------------------------------
  listUsers: WerkstattApi['listUsers'] = () => this.call('listUsers', { schema: z.array(StaffUserSchema) });
  listAssignableStaff: WerkstattApi['listAssignableStaff'] = () => this.call('listAssignableStaff', { schema: z.array(AssignableStaffSchema) });
  inviteUser: WerkstattApi['inviteUser'] = (input) => this.call('inviteUser', { body: input, schema: StaffUserSchema });
  getUser: WerkstattApi['getUser'] = (id) => this.call('getUser', { params: { id }, schema: StaffUserSchema });
  updateUser: WerkstattApi['updateUser'] = (id, input) => this.call('updateUser', { params: { id }, body: input, schema: StaffUserSchema });
  disableUser: WerkstattApi['disableUser'] = (id) => this.call('disableUser', { params: { id }, schema: StaffUserSchema });
  enableUser: WerkstattApi['enableUser'] = (id) => this.call('enableUser', { params: { id }, schema: StaffUserSchema });

  dashboard: WerkstattApi['dashboard'] = () => this.call('dashboard', { schema: z.array(DashboardTileSchema) });

  // Kunden ---------------------------------------------------------------------
  listCustomers: WerkstattApi['listCustomers'] = (q = {}) =>
    this.call('listCustomers', { query: { q: q.q, access: q.access, openItems: q.openItems, cursor: q.cursor, limit: LIST_LIMIT }, schema: PageSchema(CustomerSummarySchema) });
  createCustomer: WerkstattApi['createCustomer'] = (input) => this.call('createCustomer', { body: input, schema: CustomerDetailSchema });
  getCustomer: WerkstattApi['getCustomer'] = (id) => this.call('getCustomer', { params: { id }, schema: CustomerDetailSchema });
  updateCustomer: WerkstattApi['updateCustomer'] = (id, input) => this.call('updateCustomer', { params: { id }, body: input, schema: CustomerDetailSchema });
  archiveCustomer: WerkstattApi['archiveCustomer'] = (id) => this.call('archiveCustomer', { params: { id }, schema: CustomerDetailSchema });
  inviteCustomer: WerkstattApi['inviteCustomer'] = (id, input) => this.call('inviteCustomer', { params: { id }, body: input, schema: CustomerDetailSchema });
  disableCustomerAccount: WerkstattApi['disableCustomerAccount'] = (id) => this.call('disableCustomerAccount', { params: { id }, schema: CustomerDetailSchema });
  enableCustomerAccount: WerkstattApi['enableCustomerAccount'] = (id) => this.call('enableCustomerAccount', { params: { id }, schema: CustomerDetailSchema });
  exportCustomerData: WerkstattApi['exportCustomerData'] = (id) =>
    this.download(buildPath(endpoints.exportCustomerData.path, { id }), 'kundendaten.zip', 'Der Export konnte nicht erstellt werden.');

  // Fahrzeuge ------------------------------------------------------------------
  listVehicles: WerkstattApi['listVehicles'] = (q = {}) =>
    this.call('listVehicles', { query: { q: q.q, customerId: q.customerId, cursor: q.cursor, limit: LIST_LIMIT }, schema: PageSchema(VehicleSummarySchema) });
  createVehicle: WerkstattApi['createVehicle'] = (input) => this.call('createVehicle', { body: input, schema: VehicleDetailSchema });
  getVehicle: WerkstattApi['getVehicle'] = (id) => this.call('getVehicle', { params: { id }, schema: VehicleDetailSchema });
  updateVehicle: WerkstattApi['updateVehicle'] = (id, input) => this.call('updateVehicle', { params: { id }, body: input, schema: VehicleDetailSchema });
  listOdometer: WerkstattApi['listOdometer'] = (id) => this.call('listOdometer', { params: { id }, schema: z.array(OdometerReadingSchema) });
  addOdometer: WerkstattApi['addOdometer'] = (id, input) => this.call('addOdometer', { params: { id }, body: input, schema: OdometerReadingSchema });
  listOwnerships: WerkstattApi['listOwnerships'] = (id) => this.call('listOwnerships', { params: { id }, schema: z.array(OwnershipSchema) });
  transferOwnership: WerkstattApi['transferOwnership'] = (id, input) => this.call('transferOwnership', { params: { id }, body: input, schema: VehicleDetailSchema });
  setQrPublicView: WerkstattApi['setQrPublicView'] = (id, enabled) => this.call('setQrPublicView', { params: { id }, body: { enabled }, schema: VehicleDetailSchema });
  rotateQr: WerkstattApi['rotateQr'] = (id) => this.call('rotateQr', { params: { id }, schema: VehicleDetailSchema });
  qrStickerSource = (id: string): ImageSourceSpec => ({ uri: this.url(buildPath(endpoints.qrSticker.path, { id })), headers: this.authHeaders() });
  listServiceEntries: WerkstattApi['listServiceEntries'] = (id) => this.call('listServiceEntries', { params: { id }, schema: z.array(ServiceEntrySchema) });
  getServiceEntry: WerkstattApi['getServiceEntry'] = (id) => this.call('getServiceEntry', { params: { id }, schema: ServiceEntrySchema });
  correctServiceEntry: WerkstattApi['correctServiceEntry'] = (id, input) => this.call('correctServiceEntry', { params: { id }, body: input, schema: ServiceEntrySchema });
  maintenanceDue: WerkstattApi['maintenanceDue'] = (id) => this.call('maintenanceDue', { params: { id }, schema: z.array(MaintenanceDueSchema) });
  maintenanceDueAll: WerkstattApi['maintenanceDueAll'] = (options = {}) =>
    this.call('maintenanceDueAll', { query: { all: options.all ? 'true' : undefined }, schema: z.array(MaintenanceDueSchema) });
  listShares: WerkstattApi['listShares'] = (id) => this.call('listShares', { params: { id }, schema: z.array(VehicleShareSchema) });
  createShare: WerkstattApi['createShare'] = (id, input) => this.call('createShare', { params: { id }, body: input, schema: VehicleShareSchema });
  revokeShare: WerkstattApi['revokeShare'] = (id) => this.call('revokeShare', { params: { id }, schema: VehicleShareSchema });

  // Termine --------------------------------------------------------------------
  listAppointments: WerkstattApi['listAppointments'] = (q = {}) =>
    this.call('listAppointments', { query: { from: q.from, to: q.to, status: q.status, resourceId: q.resourceId, assigneeId: q.assigneeId }, schema: z.array(AppointmentSchema) });
  createAppointment: WerkstattApi['createAppointment'] = (input) => this.call('createAppointment', { body: input, schema: AppointmentSchema });
  requestAppointment: WerkstattApi['requestAppointment'] = (input) => this.call('requestAppointment', { body: input, schema: AppointmentSchema });
  getAppointment: WerkstattApi['getAppointment'] = (id) => this.call('getAppointment', { params: { id }, schema: AppointmentSchema });
  checkConflicts: WerkstattApi['checkConflicts'] = (input) =>
    this.call('checkConflicts', {
      body: { id: input.id ?? null, startsAt: input.startsAt, endsAt: input.endsAt, resourceId: input.resourceId ?? null, assigneeIds: input.assigneeIds ?? [], workOrderId: input.workOrderId ?? null },
      schema: z.array(SchedulingConflictSchema),
    });
  confirmAppointment: WerkstattApi['confirmAppointment'] = (id, input = {}) => this.call('confirmAppointment', { params: { id }, body: input, schema: AppointmentSchema });
  proposeAlternative: WerkstattApi['proposeAlternative'] = (id, input) => this.call('proposeAlternative', { params: { id }, body: input, schema: AppointmentSchema });
  acceptProposal: WerkstattApi['acceptProposal'] = (id, proposalId) => this.call('acceptProposal', { params: { id, proposalId }, schema: AppointmentSchema });
  declineProposal: WerkstattApi['declineProposal'] = (id, proposalId, input = {}) =>
    this.call('declineProposal', { params: { id, proposalId }, body: { cancel: input.cancel ?? false }, schema: AppointmentSchema });
  cancelAppointment: WerkstattApi['cancelAppointment'] = (id, input) => this.call('cancelAppointment', { params: { id }, body: input, schema: AppointmentSchema });
  listResources: WerkstattApi['listResources'] = () => this.call('listResources', { schema: z.array(ResourceSchema) });

  // Aufträge -------------------------------------------------------------------
  listWorkOrders: WerkstattApi['listWorkOrders'] = (q = {}) =>
    this.call('listWorkOrders', {
      query: { work: q.work, q: q.q, approval: q.approval, payment: q.payment, assigneeId: q.assigneeId, readyForPickup: q.readyForPickup, customerId: q.customerId, vehicleId: q.vehicleId, cursor: q.cursor, limit: LIST_LIMIT },
      schema: PageSchema(WorkOrderSummarySchema),
    });
  createWorkOrder: WerkstattApi['createWorkOrder'] = (input, options = {}) =>
    this.call('createWorkOrder', { body: input, query: { draft: options.draft ? 'true' : undefined }, schema: WorkOrderDetailSchema });
  getWorkOrder: WerkstattApi['getWorkOrder'] = (id) => this.call('getWorkOrder', { params: { id }, schema: WorkOrderDetailSchema });
  updateWorkOrder: WerkstattApi['updateWorkOrder'] = (id, input) => this.call('updateWorkOrder', { params: { id }, body: input, schema: WorkOrderDetailSchema });
  transitionWorkOrder: WerkstattApi['transitionWorkOrder'] = (id, input) => this.call('transitionWorkOrder', { params: { id }, body: input, schema: WorkOrderDetailSchema });
  completeReview: WerkstattApi['completeReview'] = (id, input) => this.call('completeReview', { params: { id }, body: input, schema: WorkOrderDetailSchema });
  readyForPickup: WerkstattApi['readyForPickup'] = (id) => this.call('readyForPickup', { params: { id }, schema: WorkOrderDetailSchema });
  pickedUp: WerkstattApi['pickedUp'] = (id) => this.call('pickedUp', { params: { id }, schema: WorkOrderDetailSchema });
  // Vertragsergänzung der API: Körper { assigneeIds }
  setAssignees: WerkstattApi['setAssignees'] = (id, userIds) => this.call('setAssignees', { params: { id }, body: { assigneeIds: userIds }, schema: WorkOrderDetailSchema });
  getIntake: WerkstattApi['getIntake'] = (id) => this.call('getIntake', { params: { id }, schema: IntakeSchema });
  saveIntake: WerkstattApi['saveIntake'] = (id, input) => this.call('saveIntake', { params: { id }, body: input, schema: IntakeSchema });
  confirmIntake: WerkstattApi['confirmIntake'] = (id, input) => this.call('confirmIntake', { params: { id }, body: input, schema: IntakeSchema });
  addWorkItem: WerkstattApi['addWorkItem'] = (id, input) => this.call('addWorkItem', { params: { id }, body: input, schema: WorkItemSchema });
  updateWorkItem: WerkstattApi['updateWorkItem'] = (id, input) => this.call('updateWorkItem', { params: { id }, body: input, schema: WorkItemSchema });
  // Ohne Gerätezeit kein Körper (wie bisher); mit Gerätezeit { occurredAt }
  startWorkItem: WerkstattApi['startWorkItem'] = (id, input = {}, o: WriteOptions = {}) =>
    this.call('startWorkItem', { params: { id }, body: input.occurredAt ? { occurredAt: input.occurredAt } : undefined, schema: WorkItemSchema, idempotencyKey: o.idempotencyKey });
  pauseWorkItem: WerkstattApi['pauseWorkItem'] = (id, input = {}, o: WriteOptions = {}) =>
    this.call('pauseWorkItem', { params: { id }, body: input.occurredAt ? { occurredAt: input.occurredAt } : undefined, schema: WorkItemSchema, idempotencyKey: o.idempotencyKey });
  // `odometerKm: null` wird mitgesendet (= km unbekannt); fehlt das Feld, verlangt die API den km-Stand.
  finishWorkItem: WerkstattApi['finishWorkItem'] = (id, input, o: WriteOptions = {}) =>
    this.call('finishWorkItem', { params: { id }, body: input, schema: WorkItemSchema, idempotencyKey: o.idempotencyKey });
  notDoneWorkItem: WerkstattApi['notDoneWorkItem'] = (id, input, o: WriteOptions = {}) =>
    this.call('notDoneWorkItem', { params: { id }, body: input, schema: WorkItemSchema, idempotencyKey: o.idempotencyKey });
  addPart: WerkstattApi['addPart'] = (id, input, o: WriteOptions = {}) =>
    this.call('addPart', { params: { id }, body: input, schema: WorkItemSchema, idempotencyKey: o.idempotencyKey });
  listFindings: WerkstattApi['listFindings'] = (id) => this.call('listFindings', { params: { id }, schema: z.array(FindingSchema) });
  createFinding: WerkstattApi['createFinding'] = (id, input, options) =>
    this.call('createFinding', { params: { id }, body: input, schema: FindingSchema, idempotencyKey: options?.idempotencyKey ?? input.id ?? undefined });
  reportFinding: WerkstattApi['reportFinding'] = (id, o: WriteOptions = {}) =>
    this.call('reportFinding', { params: { id }, schema: FindingSchema, idempotencyKey: o.idempotencyKey });
  dismissFinding: WerkstattApi['dismissFinding'] = (id) => this.call('dismissFinding', { params: { id }, schema: FindingSchema });
  listPhotos: WerkstattApi['listPhotos'] = (id) => this.call('listPhotos', { params: { id }, schema: z.array(PhotoSchema) });
  attachPhoto: WerkstattApi['attachPhoto'] = (id, input, options) =>
    this.call('attachPhoto', { params: { id }, body: input, schema: PhotoSchema, idempotencyKey: options?.idempotencyKey ?? input.id ?? undefined });
  setPhotoVisibility: WerkstattApi['setPhotoVisibility'] = (id, visibility) => this.call('setPhotoVisibility', { params: { id }, body: { visibility }, schema: PhotoSchema });
  timeline: WerkstattApi['timeline'] = (id) => this.call('timeline', { params: { id }, schema: z.array(TimelineEntrySchema) });

  // Freigaben ------------------------------------------------------------------
  listApprovals: WerkstattApi['listApprovals'] = (id) => this.call('listApprovals', { params: { id }, schema: z.array(ApprovalRequestSchema) });
  createApproval: WerkstattApi['createApproval'] = (id, input) => this.call('createApproval', { params: { id }, body: input, schema: ApprovalRequestSchema });
  getApproval: WerkstattApi['getApproval'] = (id) => this.call('getApproval', { params: { id }, schema: ApprovalRequestSchema });
  reviseApproval: WerkstattApi['reviseApproval'] = (id, input) => this.call('reviseApproval', { params: { id }, body: input, schema: ApprovalRequestSchema });
  sendApproval: WerkstattApi['sendApproval'] = (id) => this.call('sendApproval', { params: { id }, schema: ApprovalRequestSchema });
  withdrawApproval: WerkstattApi['withdrawApproval'] = (id) => this.call('withdrawApproval', { params: { id }, schema: ApprovalRequestSchema });
  decideApproval: WerkstattApi['decideApproval'] = (id, input) =>
    this.call('decideApproval', { params: { id }, body: input, schema: ApprovalRequestSchema, idempotencyKey: `decision:${input.versionId}:${input.decision}` });

  // Dateien und Dokumente --------------------------------------------------------
  uploadFile: WerkstattApi['uploadFile'] = async (input, o: WriteOptions = {}) => {
    const form = new FormData();
    if (input.uri.startsWith('blob:') || input.uri.startsWith('data:')) {
      const blob = await (await this.fetchImpl(input.uri)).blob();
      form.append('file', blob, input.name);
    } else {
      // React Native: Dateiobjekt mit uri/name/type
      form.append('file', { uri: input.uri, name: input.name, type: input.mimeType } as unknown as Blob);
    }
    return this.call('uploadFile', { body: form, schema: FileRefSchema, idempotencyKey: o.idempotencyKey });
  };
  listDocuments: WerkstattApi['listDocuments'] = (q = {}) =>
    this.call('listDocuments', { query: { workOrderId: q.workOrderId, vehicleId: q.vehicleId, customerId: q.customerId, kind: q.kind }, schema: z.array(DocumentSchema) });
  createDocument: WerkstattApi['createDocument'] = (input) => this.call('createDocument', { body: input, schema: DocumentSchema });
  addDocumentVersion: WerkstattApi['addDocumentVersion'] = (id, input) => this.call('addDocumentVersion', { params: { id }, body: input, schema: DocumentSchema });
  publishDocument: WerkstattApi['publishDocument'] = (id) => this.call('publishDocument', { params: { id }, schema: DocumentSchema });
  unpublishDocument: WerkstattApi['unpublishDocument'] = (id) => this.call('unpublishDocument', { params: { id }, schema: DocumentSchema });
  downloadDocument: WerkstattApi['downloadDocument'] = (id) =>
    this.download(buildPath(endpoints.downloadDocument.path, { id }), 'dokument.pdf', 'Das Dokument konnte nicht geladen werden.');
  imageSource = (contentUrl: string): ImageSourceSpec => ({
    uri: contentUrl.startsWith('http') ? contentUrl : `${this.baseUrl}${contentUrl}`,
    headers: this.authHeaders(),
  });

  // Chat -----------------------------------------------------------------------
  listConversations: WerkstattApi['listConversations'] = () => this.call('listConversations', { schema: z.array(ConversationSchema) });
  listMessages: WerkstattApi['listMessages'] = (id, after) => this.call('listMessages', { params: { id }, query: { after }, schema: z.array(MessageSchema) });
  sendMessage: WerkstattApi['sendMessage'] = (id, input, options) =>
    this.call('sendMessage', { params: { id }, body: input, schema: MessageSchema, idempotencyKey: options?.idempotencyKey ?? `message:${input.clientMessageId}` });
  markRead: WerkstattApi['markRead'] = (id) => this.call('markRead', { params: { id } });
  listInternalNotes: WerkstattApi['listInternalNotes'] = (id) => this.call('listInternalNotes', { params: { id }, schema: z.array(InternalNoteSchema) });
  addInternalNote: WerkstattApi['addInternalNote'] = (id, input, o: WriteOptions = {}) =>
    this.call('addInternalNote', { params: { id }, body: input, schema: InternalNoteSchema, idempotencyKey: o.idempotencyKey });

  // Rechnungen und Zahlungen -----------------------------------------------------
  listInvoices: WerkstattApi['listInvoices'] = (q = {}) =>
    this.call('listInvoices', { query: { status: q.status, paymentStatus: q.paymentStatus, overdue: q.overdue, customerId: q.customerId }, schema: z.array(InvoiceSchema) });
  createInvoice: WerkstattApi['createInvoice'] = (input) => this.call('createInvoice', { body: input, schema: InvoiceSchema });
  getInvoice: WerkstattApi['getInvoice'] = (id) => this.call('getInvoice', { params: { id }, schema: InvoiceSchema });
  issueInvoice: WerkstattApi['issueInvoice'] = (id, input) => this.call('issueInvoice', { params: { id }, body: input, schema: InvoiceSchema });
  cancelInvoice: WerkstattApi['cancelInvoice'] = (id, input = {}) => this.call('cancelInvoice', { params: { id }, body: input, schema: InvoiceSchema });
  startCheckout: WerkstattApi['startCheckout'] = (id) => this.call('startCheckout', { params: { id }, schema: StartCheckoutResponseSchema });
  refreshPaymentStatus: WerkstattApi['refreshPaymentStatus'] = (id) => this.call('refreshPaymentStatus', { params: { id }, schema: InvoiceSchema });
  recordManualPayment: WerkstattApi['recordManualPayment'] = (id, input) => this.call('recordManualPayment', { params: { id }, body: input, schema: InvoiceSchema });
  refundPayment: WerkstattApi['refundPayment'] = (id, input) =>
    this.call('refundPayment', { params: { id }, body: input, schema: InvoiceSchema, idempotencyKey: input.idempotencyKey });
  exportInvoicesCsv = async (q: Parameters<WerkstattApi['exportInvoicesCsv']>[0] = {}): Promise<string> => {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(endpoints.exportInvoicesCsv.path, { paymentStatus: q.paymentStatus, overdue: q.overdue, customerId: q.customerId }), {
        headers: { Accept: 'text/csv', ...this.authHeaders() },
      });
    } catch {
      throw ApiError.network();
    }
    if (!res.ok) throw new ApiError(res.status, defaultCode(res.status), 'Export fehlgeschlagen.');
    return res.text();
  };

  // Benachrichtigungen -----------------------------------------------------------
  listNotifications: WerkstattApi['listNotifications'] = (options = {}) =>
    this.call('listNotifications', { query: { unread: options.unread ? 'true' : undefined }, schema: z.array(NotificationSchema) });
  readNotification: WerkstattApi['readNotification'] = (id) => this.call('readNotification', { params: { id } });
  registerDevice: WerkstattApi['registerDevice'] = (input) => this.call('registerDevice', { body: input, idempotencyKey: `device:${input.pushToken}` });
  getNotificationPreferences = async (): Promise<NotificationPreference[]> =>
    this.call('getNotificationPreferences', { schema: z.object({ preferences: NotificationPreferencesSchema }) }).then(
      (r) => (r as { preferences: NotificationPreference[] }).preferences,
    );
  setNotificationPreferences = async (preferences: NotificationPreference[]): Promise<NotificationPreference[]> =>
    this.call('setNotificationPreferences', { body: { preferences }, schema: z.object({ preferences: NotificationPreferencesSchema }) }).then(
      (r) => (r as { preferences: NotificationPreference[] }).preferences,
    );

  // Einstellungen ------------------------------------------------------------------
  getSettings: WerkstattApi['getSettings'] = () => this.call('getSettings', { schema: WorkshopSettingsSchema });
  updateSettings: WerkstattApi['updateSettings'] = (input) => this.call('updateSettings', { body: input, schema: WorkshopSettingsSchema });
  listMaintenanceTypes: WerkstattApi['listMaintenanceTypes'] = () => this.call('listMaintenanceTypes', { schema: z.array(MaintenanceTypeSchema) });
  upsertMaintenanceType: WerkstattApi['upsertMaintenanceType'] = (id, input) => this.call('upsertMaintenanceType', { params: { id }, body: input, schema: MaintenanceTypeSchema });
  upsertResource: WerkstattApi['upsertResource'] = (id, input) => this.call('upsertResource', { params: { id }, body: input, schema: ResourceSchema });

  // Öffentlich -------------------------------------------------------------------
  resolveQr: WerkstattApi['resolveQr'] = (token) => this.call('resolveQr', { params: { token }, schema: QrResolutionSchema });
  publicShare: WerkstattApi['publicShare'] = (token) => this.call('publicShare', { params: { token }, schema: PublicVehicleViewSchema });
  health: WerkstattApi['health'] = () => this.call('health');

  exportOwnData: WerkstattApi['exportOwnData'] = () => this.download(endpoints.exportOwnData.path, 'meine-daten.zip', 'Der Export konnte nicht erstellt werden.');

  listAudit: WerkstattApi['listAudit'] = (q = {}) =>
    this.call('listAudit', { query: { entityType: q.entityType, entityId: q.entityId, actorId: q.actorId, action: q.action, limit: q.limit }, schema: z.array(AuditEntrySchema) });
}
