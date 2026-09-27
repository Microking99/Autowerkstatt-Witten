/**
 * DemoApi: In-Memory-Implementierung von WerkstattApi für den klickbaren Entwurf.
 *
 * - Enthält nur BEISPIELDATEN (seed.ts). Keine Netzwerkaufrufe, keine echten Zahlungen,
 *   keine echten Nachrichten.
 * - Rechte und Geschäftsregeln kommen aus @werkstatt/domain wie in der API (apps/api); die
 *   Dateien unter rules/ übersetzen nur zwischen Demo-Zustand und Domain. Fehler tragen
 *   dieselben Codes wie die API (packages/contracts/src/errors.ts).
 * - Verbindlich bleibt die API; der Demo-Modus zeigt das Verhalten im Entwurf.
 * - Zustand optional im sessionStorage (Web), damit ein Neuladen nichts verliert.
 */
import {
  API_ERROR_CODES,
  AppointmentInputSchema,
  AppointmentRequestInputSchema,
  CustomerInputSchema,
  PasswordSchema,
  SendMessageRequestSchema,
  VehicleInputSchema,
  apiCodeFromDomain,
  paymentMethodLabels,
  paymentStatusLabels,
  type DashboardTile,
  type LoginRequest,
  type LoginResponse,
  type MaintenanceDue,
  type NotificationEvent,
  type Permission,
  type QrResolution,
  type Role,
  type SchedulingConflict,
  type Visibility,
} from '@werkstatt/contracts';
import {
  berlinDateOf,
  canExecuteWorkItem,
  canTransitionWorkOrder,
  checkOdometerPlausibility,
  computeIntakeHash,
  createActor,
  finishItem,
  markNotDone,
  pauseItem,
  planOwnershipTransfer,
  startItem,
  type Actor,
  type WorkItemTransitionResult,
} from '@werkstatt/domain';
import type {
  AcceptInvitationInput,
  AppointmentInput,
  AppointmentRequestInput,
  ApprovalDecisionInput,
  ApprovalDraft,
  AttachPhotoInput,
  CancelInput,
  ChangePasswordInput,
  CompleteReviewInput,
  ConfirmIntakeInput,
  ConflictCheckInput,
  CreateDocumentInput,
  CreateInvoiceInput,
  CreateVehicleShareInput,
  CreateWorkOrderInput,
  CustomerInputData,
  DownloadResult,
  FindingInput,
  FinishWorkItemInput,
  ImageSourceSpec,
  IntakeInputData,
  InviteStaffInput,
  IssueInvoiceInput,
  ListAppointmentsQuery,
  ListAuditQuery,
  ListCustomersQuery,
  ListDocumentsQuery,
  ListInvoicesQuery,
  ListVehiclesQuery,
  ListWorkOrdersQuery,
  ManualPaymentInput,
  NotDoneWorkItemInput,
  NotificationPreference,
  OdometerInput,
  OwnershipTransferInput,
  Page,
  PartUsedInput,
  ProposeAlternativeInput,
  RefundInput,
  RegisterDeviceInput,
  SendMessageInput,
  ServiceEntryCorrectionInput,
  UpdateStaffInput,
  UpdateWorkOrderInput,
  UploadInput,
  VehicleInputData,
  WerkstattApi,
  WorkItemInputData,
  WorkOrderTransitionInput,
} from '../api';
import { ApiError, ERROR_CODES } from '../errors';
import { DEMO_EMAILS, DEMO_MERCHANT_CODE, DEMO_PUBLIC_BASE } from './constants';
import { Mapper, can, customerName, isStaff, todayLocal, vehicleLabel, type Viewer } from './mappers';
import { DEMO_SCHEMA_VERSION, type DAppointment, type DCheckout, type DemoState, type DIntake, type DUser, type DWorkItem, type DWorkOrder } from './model';
import { makeDemoPdf, toBase64 } from './pdf';
import {
  currentOwnerId,
  customerCanSeeDocument,
  customerCanSeeInvoice,
  customerCanSeeVehicle,
  customerCanSeeWorkOrder,
  itemIsExecutable,
  mechanicCanSeeWorkOrder,
} from './rules/access';
import * as approvalRules from './rules/approvals';
import * as appointmentRules from './rules/appointments';
import { sha256Hex } from './rules/hash';
import { computeMaintenanceDue } from './rules/maintenanceDue';
import { planRefund, reconcileCheckout, registerProviderEvent, startCheckout, summarizeInvoice, validateManualPayment } from './rules/payments';
import { canDisableUser, effectivePermissions, validatePermissionChange } from './rules/permissions';
import { createShare, openShare, resolveQr, revokeShare, type QrViewer } from './rules/publicAccess';
import { completeReview, correctEntry, visibleEntries } from './rules/serviceHistory';
import { recomputeWorkStatus } from './rules/workOrders';
import { IDS, createSeed } from './seed';

export interface DemoStorage {
  load(): string | null;
  save(value: string): void;
  clear(): void;
}

export interface DemoApiOptions {
  /** künstliche Antwortzeit, damit Ladezustände sichtbar werden */
  latencyMs?: number;
  storage?: DemoStorage | null;
  now?: () => Date;
  publicBaseUrl?: string;
}

export type ProviderOutcome = 'paid' | 'duplicate' | 'failed' | 'cancelled' | 'mismatch';

export interface DemoCheckoutInfo {
  checkoutId: string;
  invoiceId: string;
  invoiceNumber: string;
  customerDisplayName: string;
  amountCents: number;
  createdAt: string;
  customerSubmitted: boolean;
}

export interface DemoAccount {
  key: 'owner' | 'service' | 'service2' | 'mechanic' | 'customer' | 'previousOwner';
  label: string;
  description: string;
  email: string;
  userId: string;
  displayName: string;
}

const TOKEN_PREFIX = 'demo-token:';
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function randomHex(bytes: number): string {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  const arr = new Uint8Array(bytes);
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(arr);
  else for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function uuid(): string {
  const h = randomHex(16).split('');
  h[12] = '4';
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function base62(bytes: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return randomHex(bytes)
    .match(/.{2}/g)!
    .map((b) => alphabet[parseInt(b, 16) % alphabet.length])
    .join('');
}

const pwHash = (password: string) => sha256Hex(`demo:${password}`);
const tokenHash = (token: string) => sha256Hex(`token:${token}`);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

export class DemoApi implements WerkstattApi {
  readonly mode = 'demo' as const;
  private state: DemoState;
  private token: string | null = null;
  private listeners = new Set<() => void>();
  private failNextFlag = false;
  private offlineFlag = false;
  private submittedCheckouts = new Set<string>();
  /** Antworten zu bereits verarbeiteten Idempotency-Keys (Wiederholung aus der Warteschlange) */
  private idempotent = new Map<string, unknown>();
  private readonly latencyMs: number;
  private readonly storage: DemoStorage | null;
  private readonly clock: () => Date;
  private readonly publicBase: string;

  constructor(options: DemoApiOptions = {}) {
    this.latencyMs = options.latencyMs ?? 250;
    this.storage = options.storage ?? null;
    this.clock = options.now ?? (() => new Date());
    this.publicBase = options.publicBaseUrl ?? DEMO_PUBLIC_BASE;
    this.state = this.loadState();
  }

  // ---------------------------------------------------------------------------
  // Infrastruktur
  // ---------------------------------------------------------------------------

  private loadState(): DemoState {
    try {
      const raw = this.storage?.load();
      if (raw) {
        const parsed = JSON.parse(raw) as DemoState;
        if (parsed.schemaVersion === DEMO_SCHEMA_VERSION) return parsed;
      }
    } catch {
      // defekter Speicherstand: neu beginnen
    }
    return createSeed(this.clock());
  }

  private persist() {
    try {
      this.storage?.save(JSON.stringify(this.state));
    } catch {
      // Speicher voll oder nicht verfügbar: Demo läuft im Speicher weiter
    }
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private changed() {
    this.persist();
    this.emit();
  }

  private nowIso() {
    return this.clock().toISOString();
  }

  private today() {
    return todayLocal(this.clock());
  }

  private get map() {
    return new Mapper(this.state, this.clock(), this.publicBase);
  }

  /** Simulierte Netzwerkstrecke: Antwortzeit, "Offline", "nächste Anfrage schlägt fehl". */
  private async gate(): Promise<void> {
    if (this.latencyMs > 0) await delay(this.latencyMs);
    if (this.offlineFlag) throw ApiError.network();
    if (this.failNextFlag) {
      this.failNextFlag = false;
      this.emit();
      throw ApiError.network();
    }
  }

  /** Wiederholung mit gleichem Idempotency-Key liefert die erste Antwort (wie die API). */
  private async once<T>(key: string | undefined, userId: string, run: () => T): Promise<T> {
    if (!key) return run();
    const k = `${userId}:${key}`;
    if (this.idempotent.has(k)) return this.idempotent.get(k) as T;
    const result = run();
    this.idempotent.set(k, result);
    return result;
  }

  private userById(id: string): DUser | undefined {
    return this.state.users.find((u) => u.id === id);
  }

  private viewerFor(user: DUser): Viewer {
    const account = this.state.customerAccounts.find((a) => a.userId === user.id);
    return {
      user,
      role: user.role,
      customerId: user.role === 'customer' ? (account?.customerId ?? null) : null,
      permissions: new Set(effectivePermissions(user.role, user.permissionOverrides)),
    };
  }

  /** Actor für die Domain-Regeln (wie in der API). */
  private actorOf(v: Viewer): Actor {
    return createActor({ userId: v.user.id, role: v.role, status: v.user.status, customerId: v.customerId, overrides: v.role === 'customer' ? [] : v.user.permissionOverrides });
  }

  private optionalViewer(): Viewer | null {
    if (!this.token?.startsWith(TOKEN_PREFIX)) return null;
    const user = this.userById(this.token.slice(TOKEN_PREFIX.length));
    if (!user || user.status !== 'active') return null;
    return this.viewerFor(user);
  }

  private viewer(): Viewer {
    const v = this.optionalViewer();
    if (!v) throw ApiError.unauthorized('Bitte melden Sie sich an.');
    return v;
  }

  private require(v: Viewer, permission: Permission) {
    if (!isStaff(v)) throw ApiError.notFound();
    if (!can(v, permission)) throw ApiError.forbidden('Für diese Aktion fehlt Ihnen die Berechtigung.');
  }

  private requireCustomer(v: Viewer): string {
    if (v.role !== 'customer' || !v.customerId) throw ApiError.forbidden('Diese Aktion ist nur für Kunden vorgesehen.');
    return v.customerId;
  }

  private audit(v: Viewer | null, action: string, entityType: string, entityId: string | null, data: Record<string, unknown> = {}) {
    this.state.audit.push({ id: uuid(), occurredAt: this.nowIso(), actorUserId: v?.user.id ?? null, actorRole: v?.role ?? null, action, entityType, entityId, data });
  }

  private notify(userIds: string[], eventType: NotificationEvent, title: string, body: string, targetPath: string) {
    for (const userId of new Set(userIds)) {
      this.state.notifications.push({ id: uuid(), userId, eventType, title, body, targetPath, createdAt: this.nowIso(), readAt: null });
    }
  }

  private customerUserIds(customerId: string): string[] {
    return this.state.customerAccounts
      .filter((a) => a.customerId === customerId)
      .map((a) => this.userById(a.userId))
      .filter((u): u is DUser => !!u && u.status === 'active')
      .map((u) => u.id);
  }

  private staffUserIds(roles: Role[] = ['admin', 'service']): string[] {
    return this.state.users.filter((u) => roles.includes(u.role) && u.status === 'active').map((u) => u.id);
  }

  // --- Zugriff auf Einzelobjekte (fremd = 404 für Kunden) -------------------------

  private visibleWorkOrders(v: Viewer): DWorkOrder[] {
    if (v.role === 'customer') return this.state.workOrders.filter((w) => customerCanSeeWorkOrder(v.customerId ?? '', w));
    if (can(v, 'workOrders.read')) return this.state.workOrders;
    return this.state.workOrders.filter((w) => mechanicCanSeeWorkOrder(v.user.id, w, this.state.workItems, false));
  }

  private workOrderFor(v: Viewer, id: string): DWorkOrder {
    const wo = this.visibleWorkOrders(v).find((w) => w.id === id);
    if (!wo) throw ApiError.notFound();
    return wo;
  }

  private vehicleFor(v: Viewer, id: string) {
    const vehicle = this.state.vehicles.find((x) => x.id === id);
    if (!vehicle) throw ApiError.notFound();
    if (v.role === 'customer') {
      if (!customerCanSeeVehicle(v.customerId ?? '', id, this.state.ownerships)) throw ApiError.notFound();
      return vehicle;
    }
    if (can(v, 'vehicles.read')) return vehicle;
    if (this.visibleWorkOrders(v).some((w) => w.vehicleId === id)) return vehicle;
    throw ApiError.forbidden();
  }

  private invoiceFor(v: Viewer, id: string) {
    const inv = this.state.invoices.find((i) => i.id === id);
    if (!inv) throw ApiError.notFound();
    if (v.role === 'customer') {
      if (!customerCanSeeInvoice(v.customerId ?? '', inv)) throw ApiError.notFound();
      return inv;
    }
    this.require(v, 'invoices.read');
    return inv;
  }

  private appointmentFor(v: Viewer, id: string): DAppointment {
    const a = this.state.appointments.find((x) => x.id === id);
    if (!a) throw ApiError.notFound();
    if (v.role === 'customer') {
      if (a.customerId !== v.customerId) throw ApiError.notFound();
      return a;
    }
    if (can(v, 'appointments.read') || a.assigneeIds.includes(v.user.id)) return a;
    throw ApiError.forbidden();
  }

  /** Freigabeanfragen sehen Kunden (ohne Entwürfe) und Mitarbeiter mit Freigaberecht; Mechaniker nie (Preise). */
  private approvalFor(v: Viewer, id: string) {
    const r = this.state.approvals.find((x) => x.id === id);
    if (!r) throw ApiError.notFound();
    this.workOrderFor(v, r.workOrderId);
    if (v.role === 'customer' && r.status === 'draft') throw ApiError.notFound();
    if (v.role === 'mechanic') throw ApiError.forbidden('Freigabeanfragen enthalten Preise und sind für Mechaniker nicht sichtbar.');
    return r;
  }

  private itemFor(v: Viewer, id: string): DWorkItem {
    const item = this.state.workItems.find((i) => i.id === id);
    if (!item) throw ApiError.notFound();
    this.workOrderFor(v, item.workOrderId);
    return item;
  }

  private replaceItem(item: DWorkItem) {
    this.state.workItems = this.state.workItems.map((i) => (i.id === item.id ? item : i));
  }

  private replaceWorkOrder(wo: DWorkOrder) {
    this.state.workOrders = this.state.workOrders.map((w) => (w.id === wo.id ? wo : w));
  }

  private refreshWorkStatus(workOrderId: string) {
    const wo = this.state.workOrders.find((w) => w.id === workOrderId);
    if (!wo) return;
    const next = recomputeWorkStatus(wo, this.state.workItems, this.nowIso());
    if (next !== wo) {
      this.replaceWorkOrder(next);
      this.audit(null, 'work_order.status_changed', 'work_order', wo.id, { workOrderId: wo.id, from: wo.status, to: next.status });
    }
  }

  private loginResponse(user: DUser): LoginResponse {
    return {
      token: `${TOKEN_PREFIX}${user.id}`,
      expiresAt: new Date(this.clock().getTime() + 12 * 3_600_000).toISOString(),
      user: this.map.sessionUser(user),
    };
  }

  // ---------------------------------------------------------------------------
  // Anmeldung und Konto
  // ---------------------------------------------------------------------------

  setToken(token: string | null): void {
    this.token = token;
  }

  async login(input: LoginRequest): Promise<LoginResponse> {
    await this.gate();
    const email = input.email.trim().toLowerCase();
    const user = this.state.users.find((u) => u.email.toLowerCase() === email);
    if (!user || !user.passwordHash || user.passwordHash !== pwHash(input.password)) {
      this.audit(null, 'auth.login_failed', 'user', null, { email: email.replace(/^(.).*@/, '$1…@') });
      this.persist();
      throw new ApiError(401, ERROR_CODES.invalidCredentials, 'E-Mail-Adresse oder Passwort ist nicht korrekt.');
    }
    if (user.status === 'disabled') {
      throw new ApiError(403, ERROR_CODES.accountDisabled, 'Dieser Zugang ist gesperrt. Bitte wenden Sie sich an die Werkstatt.');
    }
    if (user.status !== 'active') {
      throw new ApiError(401, ERROR_CODES.invalidCredentials, 'E-Mail-Adresse oder Passwort ist nicht korrekt.');
    }
    user.lastLoginAt = this.nowIso();
    this.audit(this.viewerFor(user), 'auth.login', 'user', user.id);
    this.changed();
    return this.loginResponse(user);
  }

  async logout(): Promise<void> {
    await delay(Math.min(this.latencyMs, 100));
  }

  async me() {
    await this.gate();
    return this.map.sessionUser(this.viewer().user);
  }

  /**
   * Einladung bzw. Rücksetzlink prüfen. Die API meldet ungültig, abgelaufen und benutzt
   * einheitlich (400 invitation_invalid bzw. reset_invalid); der Grund steht nur im Text.
   */
  private consumeToken(token: string, purposes: string[], code: string, kind: 'Einladung' | 'Link') {
    const entry = this.state.tokens.find((t) => t.tokenHash === tokenHash(token) && purposes.includes(t.purpose));
    const article = kind === 'Einladung' ? 'Diese Einladung' : 'Dieser Link';
    if (!entry) throw new ApiError(400, code, `${article} ist ungültig oder unvollständig.`);
    if (entry.usedAt) throw new ApiError(400, code, `${article} wurde bereits verwendet.${kind === 'Einladung' ? ' Melden Sie sich mit Ihrem Passwort an.' : ''}`);
    if (Date.parse(entry.expiresAt) <= this.clock().getTime()) {
      throw new ApiError(400, code, kind === 'Einladung' ? 'Diese Einladung ist abgelaufen. Einladungen gelten 7 Tage.' : 'Dieser Link ist abgelaufen (Links gelten eine Stunde).');
    }
    return entry;
  }

  async acceptInvitation(input: AcceptInvitationInput): Promise<LoginResponse> {
    await this.gate();
    const pw = PasswordSchema.safeParse(input.password);
    if (!pw.success) throw ApiError.validation('Das Passwort muss mindestens 10 Zeichen haben.');
    const entry = this.consumeToken(input.token, ['staff', 'customer'], API_ERROR_CODES.invitationInvalid, 'Einladung');
    const user = this.userById(entry.userId);
    if (!user || user.status === 'disabled') throw new ApiError(400, API_ERROR_CODES.invitationInvalid, 'Diese Einladung ist ungültig.');
    user.passwordHash = pwHash(input.password);
    user.status = 'active';
    user.lastLoginAt = this.nowIso();
    entry.usedAt = this.nowIso();
    this.audit(this.viewerFor(user), 'auth.invitation_accepted', 'user', user.id);
    this.changed();
    return this.loginResponse(user);
  }

  async forgotPassword(_input: { email: string }): Promise<void> {
    await this.gate();
    // Antwort immer gleich, unabhängig davon, ob die Adresse existiert.
  }

  async resetPassword(input: { token: string; password: string }): Promise<void> {
    await this.gate();
    const pw = PasswordSchema.safeParse(input.password);
    if (!pw.success) throw ApiError.validation('Das Passwort muss mindestens 10 Zeichen haben.');
    const entry = this.consumeToken(input.token, ['password_reset'], API_ERROR_CODES.resetInvalid, 'Link');
    const user = this.userById(entry.userId);
    if (!user) throw new ApiError(400, API_ERROR_CODES.resetInvalid, 'Dieser Link ist ungültig.');
    user.passwordHash = pwHash(input.password);
    entry.usedAt = this.nowIso();
    this.audit(null, 'auth.password_reset', 'user', user.id);
    this.changed();
  }

  async changePassword(input: ChangePasswordInput): Promise<void> {
    await this.gate();
    const v = this.viewer();
    if (v.user.passwordHash !== pwHash(input.currentPassword)) throw new ApiError(400, API_ERROR_CODES.invalidCurrentPassword, 'Das aktuelle Passwort ist falsch.');
    if (!PasswordSchema.safeParse(input.newPassword).success) throw ApiError.validation('Das neue Passwort muss mindestens 10 Zeichen haben.');
    v.user.passwordHash = pwHash(input.newPassword);
    this.audit(v, 'auth.password_changed', 'user', v.user.id);
    this.changed();
  }

  // ---------------------------------------------------------------------------
  // Mitarbeiter
  // ---------------------------------------------------------------------------

  async listUsers() {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'users.manage');
    const map = this.map;
    return this.state.users
      .filter((u) => u.role !== 'customer')
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'))
      .map((u) => map.staffUser(u));
  }

  async inviteUser(input: InviteStaffInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'users.manage');
    if (this.state.users.some((u) => u.email.toLowerCase() === input.email.trim().toLowerCase())) {
      throw ApiError.conflict(API_ERROR_CODES.emailTaken, 'Für diese E-Mail-Adresse gibt es bereits ein Konto.');
    }
    const user: DUser = { id: uuid(), email: input.email.trim(), displayName: input.displayName.trim(), role: input.role, status: 'invited', passwordHash: null, permissionOverrides: [], lastLoginAt: null, createdAt: this.nowIso() };
    this.state.users.push(user);
    this.state.tokens.push({ tokenHash: tokenHash(base62(24)), userId: user.id, purpose: 'staff', expiresAt: new Date(this.clock().getTime() + 7 * 86_400_000).toISOString(), usedAt: null });
    this.audit(v, 'user.invited', 'user', user.id, { role: user.role });
    this.changed();
    return this.map.staffUser(user);
  }

  private staffById(id: string): DUser {
    const u = this.state.users.find((x) => x.id === id && x.role !== 'customer');
    if (!u) throw ApiError.notFound();
    return u;
  }

  async getUser(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'users.manage');
    return this.map.staffUser(this.staffById(id));
  }

  /** Aktive Admins mit wirksamem users.manage (Schutz des letzten Admins, Domain). */
  private activeAdminCount(): number {
    return this.state.users.filter((u) => u.role === 'admin' && u.status === 'active' && effectivePermissions(u.role, u.permissionOverrides).includes('users.manage')).length;
  }

  async updateUser(id: string, input: UpdateStaffInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'users.manage');
    const u = this.staffById(id);
    const change = validatePermissionChange({
      targetUser: { id: u.id, role: u.role, status: u.status, overrides: u.permissionOverrides },
      newRole: input.role,
      newOverrides: input.permissionOverrides,
      activeAdminCount: this.activeAdminCount(),
    });
    if (!change.ok) throw ApiError.unprocessable(API_ERROR_CODES.permissionChangeRejected, change.issues.map((i) => i.message).join(' '), change.issues);
    const before = u.permissionOverrides;
    if (input.displayName !== undefined) u.displayName = input.displayName.trim();
    if (change.role !== u.role) this.audit(v, 'user.role_changed', 'user', u.id, { from: u.role, to: change.role });
    u.role = change.role;
    u.permissionOverrides = change.overrides;
    this.audit(v, 'user.permissions_changed', 'user', u.id, { before, after: change.overrides });
    this.changed();
    return this.map.staffUser(u);
  }

  async disableUser(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'users.manage');
    const u = this.staffById(id);
    const check = canDisableUser({ targetUser: { id: u.id, role: u.role, status: u.status, overrides: u.permissionOverrides }, activeAdminCount: this.activeAdminCount() });
    if (!check.ok) throw ApiError.unprocessable(apiCodeFromDomain(check.issue.code), check.issue.message);
    u.status = 'disabled';
    this.audit(v, 'user.disabled', 'user', u.id);
    this.changed();
    return this.map.staffUser(u);
  }

  async enableUser(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'users.manage');
    const u = this.staffById(id);
    u.status = u.passwordHash ? 'active' : 'invited';
    this.audit(v, 'user.enabled', 'user', u.id, { status: u.status });
    this.changed();
    return this.map.staffUser(u);
  }

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  async dashboard(): Promise<DashboardTile[]> {
    await this.gate();
    const v = this.viewer();
    const today = this.today();
    const isToday = (iso: string) => todayLocal(new Date(iso)) === today;
    if (v.role === 'customer') throw ApiError.notFound();
    this.require(v, 'dashboard.view');
    if (v.role === 'mechanic') {
      const mine = this.visibleWorkOrders(v).filter((w) => w.status === 'open' || w.status === 'in_progress');
      const items = this.state.workItems.filter((i) => mine.some((w) => w.id === i.workOrderId) && (i.assignedTo === v.user.id || i.assignedTo === null) && i.executionStatus !== 'done' && i.executionStatus !== 'not_done');
      return [
        { key: 'my_assigned_items', label: 'Meine offenen Positionen', count: items.length, targetPath: '/mechaniker' },
        { key: 'open_work_orders', label: 'Meine Aufträge', count: mine.length, targetPath: '/mechaniker' },
      ];
    }
    const orders = this.state.workOrders;
    const map = this.map;
    const summaries = orders.map((w) => map.workOrderSummary(w, v));
    const tiles: DashboardTile[] = [];
    if (can(v, 'appointments.read')) {
      tiles.push({ key: 'appointments_today', label: 'Termine heute', count: this.state.appointments.filter((a) => a.status === 'confirmed' && isToday(a.startsAt)).length, targetPath: '/werkstatt/kalender' });
      tiles.push({ key: 'appointment_requests', label: 'Terminanfragen', count: this.state.appointments.filter((a) => a.status === 'requested').length, targetPath: '/werkstatt/kalender/anfragen' });
    }
    tiles.push(
      { key: 'open_work_orders', label: 'Offene Aufträge', count: orders.filter((w) => ['open', 'in_progress', 'work_completed'].includes(w.status)).length, targetPath: '/werkstatt/auftraege?arbeit=offen' },
      { key: 'pending_approvals', label: 'Ausstehende Kundenfreigaben', count: summaries.reduce((s, w) => s + w.status.pendingApprovalCount, 0), targetPath: '/werkstatt/auftraege?freigabe=pending' },
      { key: 'unread_messages', label: 'Ungelesene Nachrichten', count: summaries.reduce((s, w) => s + w.unreadMessages, 0), targetPath: '/werkstatt/nachrichten' },
      { key: 'ready_for_pickup', label: 'Abholbereit', count: summaries.filter((w) => w.status.readyForPickup).length, targetPath: '/werkstatt/auftraege?abholbereit=ja' },
    );
    if (can(v, 'serviceHistory.read')) {
      tiles.push({ key: 'maintenance_due', label: 'Fällige Wartungen', count: this.allDue().filter((d) => d.state === 'overdue' || d.state === 'due_soon').length, targetPath: '/werkstatt/wartungen' });
    }
    if (can(v, 'invoices.read')) {
      const open = this.state.invoices.filter((i) => i.status === 'issued' && summarizeInvoice(i, this.state.payments, this.state.refunds, today).openCents > 0);
      tiles.push({ key: 'open_invoices', label: 'Offene Rechnungen', count: open.length, targetPath: '/werkstatt/rechnungen?zahlung=offen' });
    }
    return tiles;
  }

  // ---------------------------------------------------------------------------
  // Kunden
  // ---------------------------------------------------------------------------

  async listCustomers(query: ListCustomersQuery = {}) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'customers.read');
    const q = query.q?.trim().toLowerCase();
    const map = this.map;
    let items = this.state.customers.filter((c) => c.archivedAt === null).map((c) => map.customerSummary(c));
    if (q) {
      const qKey = q.replace(/[\s-]/g, '');
      items = items.filter((c) => {
        const plates = this.state.ownerships
          .filter((o) => o.customerId === c.id && o.endedAt === null)
          .map((o) => this.state.vehicles.find((x) => x.id === o.vehicleId)?.licensePlate.toLowerCase().replace(/[\s-]/g, '') ?? '');
        const raw = this.state.customers.find((x) => x.id === c.id);
        const phones = [c.phone ?? '', raw?.mobile ?? '', raw?.phone ?? ''].map((p) => p.replace(/[\s/-]/g, ''));
        return [c.displayName, c.email ?? '', c.customerNumber].some((f) => f.toLowerCase().includes(q)) || phones.some((p) => p.includes(qKey)) || plates.some((p) => p.includes(qKey));
      });
    }
    if (query.access) items = items.filter((c) => c.accessStatus === query.access);
    if (query.openItems) items = items.filter((c) => (c.openInvoiceCount ?? 0) > 0);
    return { items: items.sort((a, b) => a.displayName.localeCompare(b.displayName, 'de')), nextCursor: null };
  }

  async createCustomer(input: CustomerInputData) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'customers.write');
    const parsed = CustomerInputSchema.safeParse(input);
    if (!parsed.success) throw ApiError.validation(parsed.error.issues[0]?.message ?? 'Eingaben prüfen', parsed.error.issues);
    const d = parsed.data;
    const c = {
      id: uuid(),
      customerNumber: `K-${++this.state.counters.customer}`,
      kind: d.kind,
      salutation: d.salutation ?? null,
      firstName: d.firstName ?? null,
      lastName: d.lastName ?? null,
      companyName: d.companyName ?? null,
      email: d.email ?? null,
      phone: d.phone ?? null,
      mobile: d.mobile ?? null,
      street: d.street ?? null,
      postalCode: d.postalCode ?? null,
      city: d.city ?? null,
      country: d.country,
      notesInternal: d.notesInternal ?? null,
      createdAt: this.nowIso(),
      archivedAt: null,
      isTestData: true,
    };
    this.state.customers.push(c);
    this.audit(v, 'customer.created', 'customer', c.id);
    this.changed();
    return this.map.customerDetail(c, v);
  }

  async getCustomer(id: string) {
    await this.gate();
    const v = this.viewer();
    if (v.role === 'customer') {
      if (v.customerId !== id) throw ApiError.notFound();
    } else this.require(v, 'customers.read');
    const c = this.state.customers.find((x) => x.id === id);
    if (!c) throw ApiError.notFound();
    return this.map.customerDetail(c, v);
  }

  async updateCustomer(id: string, input: Partial<CustomerInputData>) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'customers.write');
    const c = this.state.customers.find((x) => x.id === id);
    if (!c) throw ApiError.notFound();
    const patch = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const merged = { ...c, ...patch };
    const parsed = CustomerInputSchema.safeParse({ ...merged, country: merged.country ?? 'DE' });
    if (!parsed.success) throw ApiError.validation(parsed.error.issues[0]?.message ?? 'Eingaben prüfen', parsed.error.issues);
    Object.assign(c, parsed.data, { isTestData: c.isTestData });
    this.audit(v, 'customer.updated', 'customer', c.id, { fields: Object.keys(patch) });
    this.changed();
    return this.map.customerDetail(c, v);
  }

  async archiveCustomer(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'customers.write');
    const c = this.state.customers.find((x) => x.id === id);
    if (!c) throw ApiError.notFound();
    c.archivedAt = this.nowIso();
    this.audit(v, 'customer.archived', 'customer', c.id);
    this.changed();
    return this.map.customerDetail(c, v);
  }

  async inviteCustomer(id: string, input: { email: string }) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'customerAccounts.manage');
    const c = this.state.customers.find((x) => x.id === id);
    if (!c) throw ApiError.notFound();
    let account = this.state.customerAccounts.find((a) => a.customerId === id);
    const linked = account ? this.userById(account.userId) : undefined;
    if (linked && linked.status !== 'invited') {
      throw ApiError.conflict(API_ERROR_CODES.accountExists, 'Der Kunde hat bereits einen Zugang. Gesperrte Zugänge bitte über "Zugang sperren" verwalten.');
    }
    const email = input.email.trim();
    const taken = this.state.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (taken && taken.id !== linked?.id) throw ApiError.conflict(API_ERROR_CODES.emailTaken, 'Für diese E-Mail-Adresse gibt es bereits ein Konto.');
    if (!account) {
      const user: DUser = { id: uuid(), email, displayName: customerName(c), role: 'customer', status: 'invited', passwordHash: null, permissionOverrides: [], lastLoginAt: null, createdAt: this.nowIso() };
      this.state.users.push(user);
      account = { customerId: id, userId: user.id };
      this.state.customerAccounts.push(account);
    } else if (linked) linked.email = email;
    this.state.tokens.push({ tokenHash: tokenHash(base62(24)), userId: account.userId, purpose: 'customer', expiresAt: new Date(this.clock().getTime() + 7 * 86_400_000).toISOString(), usedAt: null });
    this.audit(v, 'customer_account.invited', 'customer', id, { userId: account.userId });
    this.changed();
    return this.map.customerDetail(c, v);
  }

  async disableCustomerAccount(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'customerAccounts.manage');
    const c = this.state.customers.find((x) => x.id === id);
    if (!c) throw ApiError.notFound();
    const account = this.state.customerAccounts.find((a) => a.customerId === id);
    const user = account ? this.userById(account.userId) : undefined;
    if (!user) throw ApiError.unprocessable(API_ERROR_CODES.noAccount, 'Dieser Kunde hat keinen App-Zugang.');
    user.status = 'disabled';
    this.audit(v, 'customer_account.disabled', 'customer', id);
    this.changed();
    return this.map.customerDetail(c, v);
  }

  /** Datenexport (Demo: JSON statt ZIP, gekennzeichnet). */
  private buildExport(customerId: string, scope: 'self' | 'full'): DownloadResult {
    const map = this.map;
    const c = this.state.customers.find((x) => x.id === customerId)!;
    const viewer: Viewer = scope === 'self' ? this.viewer() : this.viewer();
    const orders = this.state.workOrders.filter((w) => w.customerId === customerId && w.status !== 'draft');
    const payload = {
      hinweis: 'Beispieldaten (Demo-Modus). Die echte API liefert ein ZIP mit JSON und freigegebenen Dokumenten.',
      erstelltAm: this.nowIso(),
      umfang: scope === 'self' ? 'Eigene Daten' : 'Vollständiger Export für die Werkstatt',
      kunde: map.customerDetail(c, viewer),
      fahrzeuge: this.state.ownerships.filter((o) => o.customerId === customerId).map((o) => ({ ...map.ownership(o), fahrzeug: this.state.vehicles.find((x) => x.id === o.vehicleId)?.licensePlate })),
      auftraege: orders.map((w) => map.workOrderSummary(w, viewer)),
      rechnungen: this.state.invoices.filter((i) => i.customerId === customerId && i.status !== 'draft').map((i) => map.invoice(i, viewer)),
      nachrichten: this.state.messages.filter((m) => orders.some((w) => w.id === m.workOrderId)).map((m) => map.message(m)),
      dokumente: this.state.documents.filter((d) => customerCanSeeDocument(customerId, d) || (scope === 'full' && d.customerId === customerId)).map((d) => map.document(d)),
    };
    const json = JSON.stringify(payload, null, 2);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const b64 = typeof btoa === 'function' ? btoa(binary) : toBase64(bytes);
    return { uri: `data:application/json;base64,${b64}`, fileName: `datenexport-${c.customerNumber}-${this.today()}.json`, mimeType: 'application/json' };
  }

  async exportCustomerData(customerId: string): Promise<DownloadResult> {
    await this.gate();
    const v = this.viewer();
    if (v.role === 'customer') throw ApiError.forbidden('Bitte den Selbstexport unter Konto verwenden.');
    this.require(v, 'customers.read');
    this.require(v, 'reports.export');
    if (!this.state.customers.some((c) => c.id === customerId)) throw ApiError.notFound();
    const result = this.buildExport(customerId, 'full');
    this.audit(v, 'export.customer_data', 'customer', customerId, { scope: 'full' });
    this.changed();
    return result;
  }

  async exportOwnData(): Promise<DownloadResult> {
    await this.gate();
    const v = this.viewer();
    if (v.role !== 'customer' || !v.customerId) throw ApiError.forbidden('Der Selbstexport ist für Kundenkonten vorgesehen. Mitarbeiterdaten stellt der Inhaber bereit.');
    const result = this.buildExport(v.customerId, 'self');
    this.audit(v, 'export.customer_data', 'customer', v.customerId, { scope: 'self' });
    this.changed();
    return result;
  }

  // ---------------------------------------------------------------------------
  // Fahrzeuge
  // ---------------------------------------------------------------------------

  async listVehicles(query: ListVehiclesQuery = {}) {
    await this.gate();
    const v = this.viewer();
    let vehicles = this.state.vehicles.filter((x) => x.archivedAt === null);
    if (v.role === 'customer') vehicles = vehicles.filter((x) => customerCanSeeVehicle(v.customerId ?? '', x.id, this.state.ownerships));
    else if (!can(v, 'vehicles.read')) {
      const ids = new Set(this.visibleWorkOrders(v).map((w) => w.vehicleId));
      vehicles = vehicles.filter((x) => ids.has(x.id));
    }
    if (query.customerId) vehicles = vehicles.filter((x) => currentOwnerId(this.state.ownerships, x.id) === query.customerId);
    const q = query.q?.trim().toLowerCase().replace(/[\s-]/g, '');
    if (q) {
      vehicles = vehicles.filter((x) => {
        const owner = currentOwnerId(this.state.ownerships, x.id);
        const ownerName = owner ? customerName(this.state.customers.find((c) => c.id === owner)).toLowerCase().replace(/[\s-]/g, '') : '';
        return [x.licensePlate, x.vin ?? '', x.make, x.model].some((f) => f.toLowerCase().replace(/[\s-]/g, '').includes(q)) || (isStaff(v) && ownerName.includes(q));
      });
    }
    const map = this.map;
    return { items: vehicles.map((x) => map.vehicleSummary(x, v)).sort((a, b) => a.licensePlate.localeCompare(b.licensePlate, 'de')), nextCursor: null };
  }

  async createVehicle(input: VehicleInputData) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'vehicles.write');
    const parsed = VehicleInputSchema.safeParse(input);
    if (!parsed.success) throw ApiError.validation(parsed.error.issues[0]?.message ?? 'Eingaben prüfen', parsed.error.issues);
    const d = parsed.data;
    const owner = this.state.customers.find((c) => c.id === d.ownerCustomerId);
    if (!owner || owner.archivedAt) throw ApiError.unprocessable(API_ERROR_CODES.ownerInvalid, 'Der Halter wurde nicht gefunden oder ist archiviert.');
    if (d.vin && this.state.vehicles.some((x) => x.vin === d.vin)) throw ApiError.conflict(API_ERROR_CODES.vinTaken, 'Ein Fahrzeug mit dieser FIN ist bereits angelegt.');
    const vehicle = {
      id: uuid(),
      licensePlate: d.licensePlate.toUpperCase(),
      vin: d.vin ?? null,
      hsn: d.hsn ?? null,
      tsn: d.tsn ?? null,
      make: d.make,
      model: d.model,
      variant: d.variant ?? null,
      firstRegistration: d.firstRegistration ?? null,
      fuelType: d.fuelType ?? null,
      color: d.color ?? null,
      notesInternal: d.notesInternal ?? null,
      qrToken: `qr-${base62(12)}`,
      qrPublicViewEnabled: false,
      createdAt: this.nowIso(),
      archivedAt: null,
      isTestData: true,
    };
    this.state.vehicles.push(vehicle);
    this.state.ownerships.push({ id: uuid(), vehicleId: vehicle.id, customerId: d.ownerCustomerId, startedAt: this.nowIso(), endedAt: null, note: null });
    this.audit(v, 'vehicle.created', 'vehicle', vehicle.id, { ownerCustomerId: d.ownerCustomerId });
    this.changed();
    return this.map.vehicleDetail(vehicle, v);
  }

  async getVehicle(id: string) {
    await this.gate();
    const v = this.viewer();
    return this.map.vehicleDetail(this.vehicleFor(v, id), v);
  }

  async updateVehicle(id: string, input: Partial<VehicleInputData>) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'vehicles.write');
    const vehicle = this.state.vehicles.find((x) => x.id === id);
    if (!vehicle) throw ApiError.notFound();
    const { ownerCustomerId: _ignored, isTestData: _t, ...rest } = input;
    const patch = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
    if (typeof patch.vin === 'string' && this.state.vehicles.some((x) => x.id !== id && x.vin === patch.vin)) {
      throw ApiError.conflict(API_ERROR_CODES.vinTaken, 'Ein Fahrzeug mit dieser FIN ist bereits angelegt.');
    }
    Object.assign(vehicle, patch);
    this.audit(v, 'vehicle.updated', 'vehicle', id, { fields: Object.keys(patch) });
    this.changed();
    return this.map.vehicleDetail(vehicle, v);
  }

  async listOdometer(vehicleId: string) {
    await this.gate();
    const v = this.viewer();
    this.vehicleFor(v, vehicleId);
    const map = this.map;
    return this.state.odometer
      .filter((r) => r.vehicleId === vehicleId)
      .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))
      .map((r) => map.odometer(r));
  }

  /** km-Stand speichern (nie überschreiben); Plausibilität nach Domain-Regel. */
  private recordOdometer(vehicleId: string, valueKm: number, recordedAt: string, source: DemoState['odometer'][number]['source'], workOrderId: string | null) {
    const previous = this.state.odometer.filter((r) => r.vehicleId === vehicleId);
    const reading = { id: uuid(), vehicleId, valueKm, recordedAt, source, workOrderId, plausibility: checkOdometerPlausibility(previous, valueKm, recordedAt) };
    this.state.odometer.push(reading);
    return reading;
  }

  async addOdometer(vehicleId: string, input: OdometerInput) {
    await this.gate();
    const v = this.viewer();
    this.vehicleFor(v, vehicleId);
    if (v.role === 'customer') {
      if (currentOwnerId(this.state.ownerships, vehicleId) !== v.customerId) throw ApiError.notFound();
    } else this.require(v, 'vehicles.write');
    const recordedAt = input.recordedAt ?? this.nowIso();
    if (Date.parse(recordedAt) > this.clock().getTime() + 5 * 60_000) throw ApiError.unprocessable(API_ERROR_CODES.recordedInFuture, 'Der Zeitpunkt liegt in der Zukunft.');
    const reading = this.recordOdometer(vehicleId, input.valueKm, recordedAt, v.role === 'customer' ? 'customer' : 'staff', null);
    this.audit(v, 'vehicle.odometer_recorded', 'vehicle', vehicleId, { valueKm: input.valueKm, plausibility: reading.plausibility });
    this.changed();
    return this.map.odometer(reading);
  }

  async listOwnerships(vehicleId: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'vehicles.read');
    if (!this.state.vehicles.some((x) => x.id === vehicleId)) throw ApiError.notFound();
    const map = this.map;
    return this.state.ownerships.filter((o) => o.vehicleId === vehicleId).sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1)).map((o) => map.ownership(o));
  }

  /**
   * Halterwechsel (Domain `planOwnershipTransfer`): bisheriger Zeitraum endet, neuer beginnt;
   * Freigaben für Dritte des Vorbesitzers werden widerrufen, die QR-Kurzansicht aus.
   * Aufträge, Rechnungen, Dokumente und Nachrichten bleiben beim bisherigen Kunden.
   */
  async transferOwnership(vehicleId: string, input: OwnershipTransferInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'vehicles.transferOwnership');
    const vehicle = this.state.vehicles.find((x) => x.id === vehicleId);
    if (!vehicle) throw ApiError.notFound();
    const newOwner = this.state.customers.find((c) => c.id === input.newCustomerId);
    if (!newOwner || newOwner.archivedAt) throw ApiError.unprocessable(API_ERROR_CODES.ownerInvalid, 'Der neue Halter wurde nicht gefunden oder ist archiviert.');
    const current = this.state.ownerships.find((o) => o.vehicleId === vehicleId && o.endedAt === null);
    let startedAt = input.effectiveAt;
    let previous: string | null = null;
    if (current) {
      const plan = planOwnershipTransfer({ current: { id: current.id, customerId: current.customerId, startedAt: current.startedAt, endedAt: null }, newCustomerId: newOwner.id, effectiveAt: input.effectiveAt, now: this.clock() });
      if (!plan.ok) throw ApiError.unprocessable(apiCodeFromDomain(plan.error.code), plan.error.message);
      previous = current.customerId;
      startedAt = plan.value.startNew.startedAt;
      current.endedAt = plan.value.endCurrent.endedAt;
      for (const share of this.state.shares) if (share.vehicleId === vehicleId && !share.revokedAt) share.revokedAt = this.nowIso();
      vehicle.qrPublicViewEnabled = false;
    }
    this.state.ownerships.push({ id: uuid(), vehicleId, customerId: newOwner.id, startedAt, endedAt: null, note: input.note?.trim() || null });
    this.audit(v, 'vehicle.ownership_transferred', 'vehicle', vehicleId, { fromCustomerId: previous, toCustomerId: newOwner.id, effectiveAt: startedAt });
    this.changed();
    return this.map.vehicleDetail(vehicle, v);
  }

  async setQrPublicView(vehicleId: string, enabled: boolean) {
    await this.gate();
    const v = this.viewer();
    const customerId = this.requireCustomer(v);
    const vehicle = this.vehicleFor(v, vehicleId);
    if (currentOwnerId(this.state.ownerships, vehicleId) !== customerId) throw ApiError.notFound();
    vehicle.qrPublicViewEnabled = enabled;
    this.audit(v, 'vehicle.qr_public_view_changed', 'vehicle', vehicleId, { enabled });
    this.changed();
    return this.map.vehicleDetail(vehicle, v);
  }

  async rotateQr(vehicleId: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'vehicles.write');
    const vehicle = this.state.vehicles.find((x) => x.id === vehicleId);
    if (!vehicle) throw ApiError.notFound();
    vehicle.qrToken = `qr-${base62(12)}`;
    this.audit(v, 'vehicle.qr_rotated', 'vehicle', vehicleId);
    this.changed();
    return this.map.vehicleDetail(vehicle, v);
  }

  qrStickerSource(_vehicleId: string): ImageSourceSpec {
    return { uri: '', placeholderLabel: 'QR-Aufkleber (im Demo-Modus nicht erzeugt)' };
  }

  private entriesVisibleTo(v: Viewer, vehicleId: string) {
    this.vehicleFor(v, vehicleId);
    if (v.role === 'customer') return visibleEntries(this.state.serviceEntries, vehicleId);
    if (!can(v, 'serviceHistory.read') && !this.visibleWorkOrders(v).some((w) => w.vehicleId === vehicleId)) throw ApiError.forbidden();
    return this.state.serviceEntries
      .filter((e) => e.vehicleId === vehicleId)
      .sort((a, b) => (a.performedOn < b.performedOn ? 1 : a.performedOn > b.performedOn ? -1 : b.revisionNo - a.revisionNo));
  }

  async listServiceEntries(vehicleId: string) {
    await this.gate();
    const v = this.viewer();
    const map = this.map;
    return this.entriesVisibleTo(v, vehicleId).map((e) => map.serviceEntry(e, v));
  }

  async getServiceEntry(id: string) {
    await this.gate();
    const v = this.viewer();
    const entry = this.state.serviceEntries.find((e) => e.id === id);
    if (!entry) throw ApiError.notFound();
    const visible = this.entriesVisibleTo(v, entry.vehicleId);
    if (!visible.some((e) => e.id === id)) throw ApiError.notFound();
    return this.map.serviceEntry(entry, v);
  }

  async correctServiceEntry(id: string, input: ServiceEntryCorrectionInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'serviceHistory.correct');
    const entry = this.state.serviceEntries.find((e) => e.id === id);
    if (!entry) throw ApiError.notFound();
    const typeName = entry.maintenanceTypeId ? (this.state.maintenanceTypes.find((t) => t.id === entry.maintenanceTypeId)?.name ?? null) : null;
    const { previous, revision } = correctEntry(entry, { ...input, void: input.void ?? false }, { newId: uuid(), actor: this.actorOf(v), maintenanceTypeName: typeName, now: this.nowIso() });
    this.state.serviceEntries = this.state.serviceEntries.map((e) => (e.id === id ? previous : e));
    this.state.serviceEntries.push(revision);
    this.audit(v, 'service_entry.corrected', 'service_entry', revision.id, { revisionOfId: id, revisionNo: revision.revisionNo, reason: input.reason, voided: revision.status === 'voided', vehicleId: entry.vehicleId, workOrderId: entry.workOrderId });
    this.changed();
    return this.map.serviceEntry(revision, v);
  }

  private dueFor(vehicleId: string): MaintenanceDue[] {
    return computeMaintenanceDue(this.state.serviceEntries, this.state.odometer, vehicleId, this.today(), this.state.maintenanceTypes);
  }

  private allDue(): MaintenanceDue[] {
    return this.state.vehicles.filter((x) => x.archivedAt === null).flatMap((x) => this.dueFor(x.id));
  }

  async maintenanceDue(vehicleId: string) {
    await this.gate();
    const v = this.viewer();
    this.vehicleFor(v, vehicleId);
    return this.dueFor(vehicleId);
  }

  async maintenanceDueAll(options: { all?: boolean } = {}) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'serviceHistory.read');
    const rank = { overdue: 0, due_soon: 1, unknown: 2, ok: 3 } as const;
    return this.allDue()
      .filter((d) => options.all || d.state === 'overdue' || d.state === 'due_soon')
      .sort((a, b) => rank[a.state] - rank[b.state] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  }

  async listShares(vehicleId: string) {
    await this.gate();
    const v = this.viewer();
    this.vehicleFor(v, vehicleId);
    const map = this.map;
    return this.state.shares
      .filter((s) => s.vehicleId === vehicleId && (v.role !== 'customer' || s.customerId === v.customerId))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((s) => map.share(s));
  }

  async createShare(vehicleId: string, input: CreateVehicleShareInput) {
    await this.gate();
    const v = this.viewer();
    const customerId = this.requireCustomer(v);
    const vehicle = this.vehicleFor(v, vehicleId);
    const token = base62(24);
    const { share, shareUrl } = createShare({
      id: uuid(),
      token,
      vehicle,
      customerId,
      userId: v.user.id,
      ownerships: this.state.ownerships,
      entries: this.state.serviceEntries,
      input: { label: input.label, serviceEntryIds: input.serviceEntryIds, includeVin: input.includeVin ?? false, expiresAt: input.expiresAt },
      now: this.nowIso(),
      baseUrl: this.publicBase,
    });
    this.state.shares.push(share);
    this.audit(v, 'vehicle_share.created', 'vehicle_share', share.id, { entries: share.serviceEntryIds.length, expiresAt: share.expiresAt });
    this.changed();
    return this.map.share(share, shareUrl);
  }

  async revokeShare(shareId: string) {
    await this.gate();
    const v = this.viewer();
    const customerId = this.requireCustomer(v);
    const share = this.state.shares.find((s) => s.id === shareId);
    if (!share) throw ApiError.notFound();
    const revoked = revokeShare(share, customerId, this.state.ownerships, this.nowIso());
    this.state.shares = this.state.shares.map((s) => (s.id === shareId ? revoked : s));
    this.audit(v, 'vehicle_share.revoked', 'vehicle_share', shareId);
    this.changed();
    return this.map.share(revoked);
  }

  // ---------------------------------------------------------------------------
  // Termine
  // ---------------------------------------------------------------------------

  async listAppointments(query: ListAppointmentsQuery = {}) {
    await this.gate();
    const v = this.viewer();
    let list = this.state.appointments;
    if (v.role === 'customer') list = list.filter((a) => a.customerId === v.customerId);
    else if (!can(v, 'appointments.read')) list = list.filter((a) => a.assigneeIds.includes(v.user.id));
    if (query.from) list = list.filter((a) => a.endsAt >= query.from!);
    if (query.to) list = list.filter((a) => a.startsAt <= query.to!);
    if (query.status) list = list.filter((a) => a.status === query.status);
    if (query.resourceId) list = list.filter((a) => a.resourceId === query.resourceId);
    if (query.assigneeId) list = list.filter((a) => a.assigneeIds.includes(query.assigneeId!));
    const map = this.map;
    return [...list].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1)).map((a) => map.appointment(a, v));
  }

  private conflictsFor(candidate: ConflictCheckInput): SchedulingConflict[] {
    return appointmentRules.conflictsFor({
      candidate: { id: candidate.id ?? null, startsAt: new Date(candidate.startsAt).toISOString(), endsAt: new Date(candidate.endsAt).toISOString(), resourceId: candidate.resourceId ?? null, assigneeIds: candidate.assigneeIds ?? [], workOrderId: candidate.workOrderId ?? null },
      appointments: this.state.appointments,
      workingHours: this.state.workingHours,
      openingHours: this.state.settings.openingHours,
      partDemands: this.state.partDemands,
      resourceNames: Object.fromEntries(this.state.resources.map((r) => [r.id, r.name])),
      staffNames: Object.fromEntries(this.state.users.map((u) => [u.id, u.displayName])),
    });
  }

  async createAppointment(input: AppointmentInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'appointments.write');
    const parsed = AppointmentInputSchema.safeParse(input);
    if (!parsed.success) throw ApiError.validation(parsed.error.issues[0]?.message ?? 'Eingaben prüfen', parsed.error.issues);
    if (currentOwnerId(this.state.ownerships, input.vehicleId) !== input.customerId) {
      throw ApiError.unprocessable(API_ERROR_CODES.vehicleNotOwnedByCustomer, 'Das Fahrzeug gehört nicht (mehr) zu diesem Kunden.');
    }
    const conflicts = this.conflictsFor({ startsAt: input.startsAt, endsAt: input.endsAt, resourceId: input.resourceId, assigneeIds: input.assigneeIds, workOrderId: input.workOrderId });
    const reason = input.overrideConflictsReason?.trim() || null;
    if (conflicts.length > 0 && !reason) {
      throw ApiError.conflict(API_ERROR_CODES.schedulingConflicts, 'Es gibt Planungskonflikte. Speichern ist nur mit Begründung möglich.', conflicts);
    }
    const a: DAppointment = {
      id: uuid(),
      kind: input.kind,
      status: 'confirmed',
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      workOrderId: input.workOrderId ?? null,
      startsAt: new Date(input.startsAt).toISOString(),
      endsAt: new Date(input.endsAt).toISOString(),
      resourceId: input.resourceId ?? null,
      assigneeIds: input.assigneeIds ?? [],
      requestedBy: 'staff',
      customerNote: input.customerNote?.trim() || null,
      internalNote: [input.internalNote?.trim(), reason && conflicts.length > 0 ? `Konflikt bewusst übergangen: ${reason}` : null].filter(Boolean).join('\n') || null,
      proposals: [],
      confirmedAt: this.nowIso(),
      cancelledAt: null,
      cancelReason: null,
      createdAt: this.nowIso(),
    };
    this.state.appointments.push(a);
    this.notify(this.customerUserIds(a.customerId), 'appointment.confirmed', 'Termin bestätigt', `${vehicleLabel(this.state.vehicles.find((x) => x.id === a.vehicleId))}`, `/kunde/termine/${a.id}`);
    this.audit(v, 'appointment.created', 'appointment', a.id, { conflicts: conflicts.map((c) => c.kind), overrideReason: conflicts.length > 0 ? reason : null });
    this.changed();
    return this.map.appointment(a, v);
  }

  async requestAppointment(input: AppointmentRequestInput) {
    await this.gate();
    const v = this.viewer();
    const customerId = this.requireCustomer(v);
    const parsed = AppointmentRequestInputSchema.safeParse(input);
    if (!parsed.success) throw ApiError.validation(parsed.error.issues[0]?.message ?? 'Eingaben prüfen', parsed.error.issues);
    this.vehicleFor(v, input.vehicleId);
    const a = appointmentRules.createRequest({
      id: uuid(),
      customerId,
      vehicleId: input.vehicleId,
      kind: input.kind,
      preferredStart: input.preferredStart,
      preferredEnd: input.preferredEnd,
      customerNote: input.customerNote?.trim() || null,
      now: this.nowIso(),
    });
    this.state.appointments.push(a);
    this.notify(this.staffUserIds(), 'appointment.requested', 'Neue Terminanfrage', `${customerName(this.state.customers.find((c) => c.id === customerId))}, ${vehicleLabel(this.state.vehicles.find((x) => x.id === a.vehicleId))}`, `/werkstatt/termine/${a.id}`);
    this.audit(v, 'appointment.requested', 'appointment', a.id);
    this.changed();
    return this.map.appointment(a, v);
  }

  async getAppointment(id: string) {
    await this.gate();
    const v = this.viewer();
    return this.map.appointment(this.appointmentFor(v, id), v);
  }

  async checkConflicts(input: ConflictCheckInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'appointments.write');
    return this.conflictsFor(input);
  }

  private replaceAppointment(a: DAppointment) {
    this.state.appointments = this.state.appointments.map((x) => (x.id === a.id ? a : x));
  }

  async confirmAppointment(id: string, input: { overrideConflictsReason?: string | null } = {}) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'appointments.write');
    const current = this.appointmentFor(v, id);
    const conflicts = this.conflictsFor({ id: current.id, startsAt: current.startsAt, endsAt: current.endsAt, resourceId: current.resourceId, assigneeIds: current.assigneeIds, workOrderId: current.workOrderId });
    const reason = input.overrideConflictsReason?.trim() || null;
    if (conflicts.length > 0 && !reason) {
      throw ApiError.conflict(API_ERROR_CODES.schedulingConflicts, 'Es gibt Planungskonflikte. Speichern ist nur mit Begründung möglich.', conflicts);
    }
    const a = appointmentRules.confirm(current, this.nowIso(), conflicts.length > 0 ? { internalNote: [current.internalNote, `Konflikt bewusst übergangen: ${reason}`].filter(Boolean).join('\n') } : {});
    this.replaceAppointment(a);
    this.notify(this.customerUserIds(a.customerId), 'appointment.confirmed', 'Termin bestätigt', vehicleLabel(this.state.vehicles.find((x) => x.id === a.vehicleId)), `/kunde/termine/${a.id}`);
    this.audit(v, 'appointment.confirmed', 'appointment', id, { conflicts: conflicts.map((c) => c.kind) });
    this.changed();
    return this.map.appointment(a, v);
  }

  async proposeAlternative(id: string, input: ProposeAlternativeInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'appointments.write');
    const a = appointmentRules.proposeAlternative(this.appointmentFor(v, id), { id: uuid(), startsAt: input.startsAt, endsAt: input.endsAt }, this.nowIso());
    this.replaceAppointment(a);
    this.notify(this.customerUserIds(a.customerId), 'appointment.proposed', 'Terminvorschlag der Werkstatt', input.message?.trim() || 'Die Werkstatt schlägt einen anderen Termin vor.', `/kunde/termine/${a.id}`);
    this.audit(v, 'appointment.proposed', 'appointment', id);
    this.changed();
    return this.map.appointment(a, v);
  }

  async acceptProposal(appointmentId: string, proposalId: string) {
    await this.gate();
    const v = this.viewer();
    this.requireCustomer(v);
    const a = appointmentRules.acceptProposal(this.appointmentFor(v, appointmentId), proposalId, this.nowIso());
    this.replaceAppointment(a);
    this.notify(this.staffUserIds(), 'appointment.confirmed', 'Kunde hat Terminvorschlag angenommen', customerName(this.state.customers.find((c) => c.id === a.customerId)), `/werkstatt/termine/${a.id}`);
    this.audit(v, 'appointment.proposal_accepted', 'appointment', appointmentId);
    this.changed();
    return this.map.appointment(a, v);
  }

  async declineProposal(appointmentId: string, proposalId: string, input: { cancel?: boolean } = {}) {
    await this.gate();
    const v = this.viewer();
    this.requireCustomer(v);
    const a = appointmentRules.declineProposal(this.appointmentFor(v, appointmentId), proposalId, this.nowIso(), input);
    this.replaceAppointment(a);
    this.notify(this.staffUserIds(), 'appointment.requested', 'Terminvorschlag abgelehnt', `${customerName(this.state.customers.find((c) => c.id === a.customerId))} bittet um einen anderen Termin.`, `/werkstatt/termine/${a.id}`);
    this.audit(v, 'appointment.proposal_declined', 'appointment', appointmentId);
    this.changed();
    return this.map.appointment(a, v);
  }

  async cancelAppointment(id: string, input: CancelInput) {
    await this.gate();
    const v = this.viewer();
    if (v.role !== 'customer') this.require(v, 'appointments.write');
    const a = appointmentRules.cancel(this.appointmentFor(v, id), input.reason, this.nowIso());
    this.replaceAppointment(a);
    if (v.role === 'customer') this.notify(this.staffUserIds(), 'appointment.requested', 'Termin abgesagt', `${customerName(this.state.customers.find((c) => c.id === a.customerId))}: ${input.reason}`, `/werkstatt/termine/${a.id}`);
    else this.notify(this.customerUserIds(a.customerId), 'appointment.confirmed', 'Termin abgesagt', input.reason, `/kunde/termine/${a.id}`);
    this.audit(v, 'appointment.cancelled', 'appointment', id, { reason: input.reason });
    this.changed();
    return this.map.appointment(a, v);
  }

  async listResources() {
    await this.gate();
    const v = this.viewer();
    if (!isStaff(v)) throw ApiError.notFound();
    return this.state.resources;
  }

  // ---------------------------------------------------------------------------
  // Aufträge
  // ---------------------------------------------------------------------------

  async listWorkOrders(query: ListWorkOrdersQuery = {}): Promise<Page<ReturnType<Mapper['workOrderSummary']>>> {
    await this.gate();
    const v = this.viewer();
    const map = this.map;
    let list = this.visibleWorkOrders(v).map((w) => map.workOrderSummary(w, v));
    if (query.work === 'active') list = list.filter((w) => ['open', 'in_progress', 'work_completed'].includes(w.status.work));
    else if (query.work) list = list.filter((w) => w.status.work === query.work);
    if (query.q?.trim()) {
      const q = query.q.trim().toLowerCase();
      list = list.filter((w) => w.orderNumber.toLowerCase().includes(q) || w.title.toLowerCase().includes(q));
    }
    if (query.approval) list = list.filter((w) => w.status.approval === query.approval);
    if (query.payment) list = list.filter((w) => w.status.payment === query.payment);
    if (query.assigneeId) {
      const id = query.assigneeId;
      list = list.filter((w) => w.assignees.some((a) => a.userId === id) || this.state.workItems.some((i) => i.workOrderId === w.id && i.assignedTo === id));
    }
    if (query.readyForPickup !== undefined) list = list.filter((w) => w.status.readyForPickup === query.readyForPickup);
    if (query.customerId) list = list.filter((w) => w.customerId === query.customerId);
    if (query.vehicleId) list = list.filter((w) => w.vehicleId === query.vehicleId);
    return { items: list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)), nextCursor: null };
  }

  private assertAssignable(ids: readonly (string | null | undefined)[]) {
    for (const id of ids) {
      if (!id) continue;
      const u = this.userById(id);
      if (!u || u.role === 'customer' || u.status === 'disabled') throw ApiError.unprocessable(API_ERROR_CODES.invalidAssignee, 'Mindestens ein zugewiesener Mitarbeiter ist unbekannt oder deaktiviert.');
    }
  }

  async createWorkOrder(input: CreateWorkOrderInput, options: { draft?: boolean } = {}) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    const customer = this.state.customers.find((c) => c.id === input.customerId);
    if (!customer || customer.archivedAt) throw ApiError.unprocessable(API_ERROR_CODES.customerInvalid, 'Der Kunde wurde nicht gefunden oder ist archiviert.');
    if (currentOwnerId(this.state.ownerships, input.vehicleId) !== input.customerId) {
      throw ApiError.unprocessable(API_ERROR_CODES.vehicleNotOwnedByCustomer, 'Das Fahrzeug gehört nicht (mehr) zu diesem Kunden. Bitte ein Fahrzeug des Kunden wählen.');
    }
    if (!input.title?.trim()) throw ApiError.validation('Bitte einen Titel angeben.');
    this.assertAssignable([...(input.assigneeIds ?? []), ...(input.items ?? []).map((i) => i.assignedTo)]);
    const year = this.clock().getFullYear();
    const wo: DWorkOrder = {
      id: uuid(),
      orderNumber: `A-${year}-${String(++this.state.counters.workOrder).padStart(4, '0')}`,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      status: options.draft ? 'draft' : 'open',
      title: input.title.trim(),
      descriptionCustomer: input.descriptionCustomer?.trim() || null,
      notesInternal: input.notesInternal?.trim() || null,
      costLimitCents: input.costLimitCents ?? null,
      plannedStart: input.plannedStart ?? null,
      plannedEnd: input.plannedEnd ?? null,
      readyForPickupAt: null,
      pickedUpAt: null,
      completionReviewedAt: null,
      completionReviewedBy: null,
      cancelledAt: null,
      cancelReason: null,
      assigneeIds: [...new Set(input.assigneeIds ?? [])],
      createdAt: this.nowIso(),
      updatedAt: this.nowIso(),
    };
    this.state.workOrders.push(wo);
    (input.items ?? []).forEach((it, index) => this.state.workItems.push(this.newItem(wo.id, index + 1, it, 'agreed', 'intake')));
    this.audit(v, 'work_order.created', 'work_order', wo.id, { workOrderId: wo.id, customerId: wo.customerId, vehicleId: wo.vehicleId, itemCount: input.items?.length ?? 0 });
    this.changed();
    return this.map.workOrderDetail(wo, v);
  }

  private newItem(workOrderId: string, position: number, it: WorkItemInputData, authorization: DWorkItem['authorization'], origin: DWorkItem['origin']): DWorkItem {
    return {
      id: uuid(),
      workOrderId,
      position,
      kind: it.kind,
      title: it.title.trim(),
      description: it.description ?? null,
      maintenanceTypeId: it.maintenanceTypeId ?? null,
      intervalKm: it.intervalKm ?? null,
      intervalMonths: it.intervalMonths ?? null,
      quantity: it.quantity ?? 1,
      unit: it.unit ?? 'Stk',
      unitPriceCents: it.unitPriceCents ?? null,
      vatRateBp: it.vatRateBp ?? 1900,
      origin,
      authorization,
      executionStatus: 'planned',
      approvalRequestId: null,
      approvedVersionId: null,
      assignedTo: it.assignedTo ?? null,
      doneAt: null,
      doneBy: null,
      doneOdometerKm: null,
      resultNotes: null,
      trackedMinutes: 0,
      runningSince: null,
      parts: [],
    };
  }

  async getWorkOrder(id: string) {
    await this.gate();
    const v = this.viewer();
    return this.map.workOrderDetail(this.workOrderFor(v, id), v);
  }

  async updateWorkOrder(id: string, input: UpdateWorkOrderInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    const wo = this.workOrderFor(v, id);
    if (wo.status === 'cancelled' || wo.status === 'picked_up') throw ApiError.conflict(API_ERROR_CODES.workOrderClosed, 'Der Auftrag ist abgeschlossen und kann nicht mehr geändert werden.');
    const { assigneeIds, ...rest } = input;
    if (assigneeIds) this.assertAssignable(assigneeIds);
    const next: DWorkOrder = { ...wo, ...Object.fromEntries(Object.entries(rest).filter(([, x]) => x !== undefined)), ...(assigneeIds ? { assigneeIds: [...new Set(assigneeIds)] } : {}), updatedAt: this.nowIso() };
    this.replaceWorkOrder(next);
    this.audit(v, 'work_order.updated', 'work_order', id, { workOrderId: id, fields: Object.keys(input) });
    this.changed();
    return this.map.workOrderDetail(next, v);
  }

  /** Arbeitsstatus weiterschalten (Domain `canTransitionWorkOrder`). */
  async transitionWorkOrder(id: string, input: WorkOrderTransitionInput) {
    await this.gate();
    const v = this.viewer();
    const wo = this.workOrderFor(v, id);
    if (!isStaff(v)) throw ApiError.notFound();
    const items = this.state.workItems.filter((i) => i.workOrderId === id);
    const check = canTransitionWorkOrder(wo.status, input.to, { items, permissions: v.permissions });
    if (!check.allowed) {
      if (check.code === 'MISSING_PERMISSION') throw ApiError.forbidden(check.message);
      throw ApiError.conflict(apiCodeFromDomain(check.code), check.message);
    }
    const next: DWorkOrder = { ...wo, status: input.to, updatedAt: this.nowIso(), ...(input.to === 'cancelled' ? { cancelledAt: this.nowIso(), cancelReason: input.reason ?? null } : {}) };
    this.replaceWorkOrder(next);
    this.audit(v, 'work_order.status_changed', 'work_order', id, { workOrderId: id, from: wo.status, to: input.to, reason: input.reason ?? null });
    this.changed();
    return this.map.workOrderDetail(next, v);
  }

  async completeReview(id: string, input: CompleteReviewInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.completeReview');
    return this.map.workOrderDetail(this.doCompleteReview(v, id, input.odometerKm ?? null), v);
  }

  /**
   * Fachlicher Abschluss wie in der API: Serviceeinträge nur hier und genau einmal je
   * erledigter, autorisierter Wartungsposition; ein wiederholter Aufruf erzeugt nichts Neues.
   */
  private doCompleteReview(v: Viewer, id: string, odometerKm: number | null): DWorkOrder {
    const wo = this.workOrderFor(v, id);
    const already = wo.status === 'completed' || wo.status === 'picked_up';
    const { workOrder, entries } = completeReview({
      workOrder: wo,
      items: this.state.workItems,
      existingEntries: this.state.serviceEntries,
      maintenanceTypes: this.state.maintenanceTypes,
      workshopName: this.state.settings.name,
      reviewerId: v.user.id,
      permissions: v.permissions,
      now: this.nowIso(),
      odometerKm,
      newId: uuid,
    });
    if (!already && odometerKm !== null) this.recordOdometer(wo.vehicleId, odometerKm, this.nowIso(), 'work_completion', wo.id);
    this.replaceWorkOrder(workOrder);
    this.state.serviceEntries.push(...entries);
    if (!already) this.audit(v, 'work_order.completion_reviewed', 'work_order', id, { workOrderId: id });
    for (const e of entries) this.audit(v, 'service_entry.created', 'service_entry', e.id, { workOrderId: id, workItemId: e.workItemId, vehicleId: e.vehicleId });
    this.changed();
    return workOrder;
  }

  async readyForPickup(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    const wo = this.workOrderFor(v, id);
    if (wo.status !== 'work_completed' && wo.status !== 'completed') throw ApiError.conflict(API_ERROR_CODES.notReady, 'Abholbereit erst, wenn die Arbeiten erledigt sind.');
    if (wo.readyForPickupAt) return this.map.workOrderDetail(wo, v);
    const next = { ...wo, readyForPickupAt: this.nowIso(), updatedAt: this.nowIso() };
    this.replaceWorkOrder(next);
    this.notify(this.customerUserIds(wo.customerId), 'work_order.ready_for_pickup', 'Fahrzeug abholbereit', 'Ihr Fahrzeug ist abholbereit.', `/kunde/auftraege/${wo.id}`);
    this.audit(v, 'work_order.ready_for_pickup', 'work_order', id, { workOrderId: id });
    this.changed();
    return this.map.workOrderDetail(next, v);
  }

  async pickedUp(id: string) {
    await this.gate();
    const v = this.viewer();
    const wo = this.workOrderFor(v, id);
    if (!isStaff(v)) throw ApiError.notFound();
    const items = this.state.workItems.filter((i) => i.workOrderId === id);
    const check = canTransitionWorkOrder(wo.status, 'picked_up', { items, permissions: v.permissions });
    if (!check.allowed) {
      if (check.code === 'MISSING_PERMISSION') throw ApiError.forbidden(check.message);
      throw ApiError.conflict(apiCodeFromDomain(check.code), check.message);
    }
    const next: DWorkOrder = { ...wo, status: 'picked_up', pickedUpAt: this.nowIso(), updatedAt: this.nowIso() };
    this.replaceWorkOrder(next);
    this.audit(v, 'work_order.picked_up', 'work_order', id, { workOrderId: id });
    this.changed();
    return this.map.workOrderDetail(next, v);
  }

  async setAssignees(id: string, userIds: string[]) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    const wo = this.workOrderFor(v, id);
    this.assertAssignable(userIds);
    const next = { ...wo, assigneeIds: [...new Set(userIds)], updatedAt: this.nowIso() };
    this.replaceWorkOrder(next);
    this.audit(v, 'work_order.assignees_changed', 'work_order', id, { workOrderId: id, assigneeIds: next.assigneeIds });
    this.changed();
    return this.map.workOrderDetail(next, v);
  }

  /** Inhalts-Hash der Annahme wie in der API (Domain `computeIntakeHash`, nur kundenbezogener Inhalt). */
  private intakeHash(intake: DIntake): string {
    return computeIntakeHash({ ...intake, items: this.state.workItems.filter((i) => i.workOrderId === intake.workOrderId) });
  }

  /** Ändert sich der bestätigte Inhalt, gilt die frühere Bestätigung nicht mehr (Audit). */
  private invalidateIntakeIfChanged(workOrderId: string, v: Viewer) {
    const intake = this.state.intakes.find((i) => i.workOrderId === workOrderId);
    if (!intake?.confirmedAt) return;
    if (this.intakeHash(intake) !== intake.contentHash) {
      Object.assign(intake, { confirmedAt: null, confirmationMethod: 'none' });
      this.audit(v, 'intake.confirmation_invalidated', 'work_order', workOrderId, { workOrderId });
    }
  }

  async getIntake(workOrderId: string) {
    await this.gate();
    const v = this.viewer();
    this.workOrderFor(v, workOrderId);
    const intake = this.state.intakes.find((i) => i.workOrderId === workOrderId);
    if (!intake) throw ApiError.notFound();
    return this.map.intake({ ...intake, contentHash: intake.confirmedAt ? intake.contentHash : this.intakeHash(intake) }, v);
  }

  async saveIntake(workOrderId: string, input: IntakeInputData) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'intake.write');
    const wo = this.workOrderFor(v, workOrderId);
    if (wo.status === 'cancelled' || wo.status === 'picked_up') throw ApiError.conflict(API_ERROR_CODES.workOrderClosed, 'Der Auftrag ist abgeschlossen.');
    if (!input.customerComplaint?.trim()) throw ApiError.validation('Bitte die Beanstandung des Kunden angeben.');
    let intake = this.state.intakes.find((i) => i.workOrderId === workOrderId);
    const data = {
      odometerKm: input.odometerKm,
      fuelLevel: input.fuelLevel?.trim() || null,
      customerComplaint: input.customerComplaint.trim(),
      damages: (input.damages ?? []).map((d) => ({ area: d.area.trim(), description: d.description.trim(), photoId: d.photoId ?? null })),
      agreedServices: input.agreedServices ?? '',
      costLimitCents: input.costLimitCents ?? null,
      notesInternal: input.notesInternal?.trim() || null,
      notesCustomer: input.notesCustomer?.trim() || null,
    };
    const previousKm = intake?.odometerKm ?? null;
    if (intake) Object.assign(intake, data);
    else {
      intake = { id: uuid(), workOrderId, ...data, confirmedAt: null, confirmationMethod: 'none', contentHash: null };
      this.state.intakes.push(intake);
    }
    if (input.odometerKm !== null && input.odometerKm !== previousKm) this.recordOdometer(wo.vehicleId, input.odometerKm, this.nowIso(), 'intake', workOrderId);
    this.audit(v, 'intake.saved', 'work_order', workOrderId, { workOrderId });
    this.invalidateIntakeIfChanged(workOrderId, v);
    if (!intake.confirmedAt) intake.contentHash = this.intakeHash(intake);
    this.changed();
    return this.map.intake(intake, v);
  }

  /**
   * Annahme bestätigen lassen (vor Ort durch die Werkstatt oder in der App durch den Kunden),
   * gebunden an den Inhalts-Hash. Deckt nur die dort vereinbarten Leistungen (R-ANN-3).
   */
  async confirmIntake(workOrderId: string, input: ConfirmIntakeInput) {
    await this.gate();
    const v = this.viewer();
    this.workOrderFor(v, workOrderId);
    if (input.method === 'app') {
      if (v.role !== 'customer') throw ApiError.forbidden('Die Bestätigung in der App erfolgt durch den Kunden.');
    } else this.require(v, 'intake.write');
    const intake = this.state.intakes.find((i) => i.workOrderId === workOrderId);
    if (!intake) throw ApiError.notFound();
    const current = this.intakeHash(intake);
    if (current !== input.contentHash.toLowerCase()) throw ApiError.conflict(API_ERROR_CODES.intakeChanged, 'Die Annahme wurde inzwischen geändert. Bitte die aktuelle Fassung prüfen.');
    if (!(intake.confirmedAt && intake.contentHash === current)) {
      Object.assign(intake, { confirmedAt: this.nowIso(), confirmationMethod: input.method, contentHash: current });
      this.audit(v, 'intake.confirmed', 'work_order', workOrderId, { workOrderId, method: input.method, contentHash: current });
      if (v.role === 'customer') {
        const wo = this.state.workOrders.find((w) => w.id === workOrderId)!;
        this.notify(this.staffUserIds(), 'approval.decided', `Annahme bestätigt: ${wo.orderNumber}`, `${customerName(this.state.customers.find((c) => c.id === wo.customerId))} hat die Fahrzeugannahme in der App bestätigt.`, `/werkstatt/auftraege/${wo.id}/annahme`);
      }
      this.changed();
    }
    return this.map.intake(intake, v);
  }

  async addWorkItem(workOrderId: string, input: WorkItemInputData) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    const wo = this.workOrderFor(v, workOrderId);
    if (!['draft', 'open', 'in_progress', 'work_completed'].includes(wo.status)) {
      throw ApiError.conflict(API_ERROR_CODES.workOrderClosed, 'Zu einem abgeschlossenen Auftrag können keine Positionen hinzugefügt werden.');
    }
    const intake = this.state.intakes.find((i) => i.workOrderId === workOrderId);
    if (intake?.confirmedAt) {
      // R-ANN-3: Die bestätigte Annahme deckt keine späteren Zusatzarbeiten
      throw ApiError.conflict(API_ERROR_CODES.approvalRequired, 'Die Annahme ist bestätigt. Weitere Arbeiten bitte als Freigabeanfrage an den Kunden senden.');
    }
    if (!input.title?.trim()) throw ApiError.validation('Bitte einen Titel angeben.');
    this.assertAssignable([input.assignedTo]);
    const position = this.state.workItems.filter((i) => i.workOrderId === workOrderId).reduce((m, i) => Math.max(m, i.position), 0) + 1;
    const item = this.newItem(workOrderId, position, input, 'agreed', 'intake');
    this.state.workItems.push(item);
    this.audit(v, 'work_item.added', 'work_item', item.id, { workOrderId });
    this.refreshWorkStatus(workOrderId);
    this.changed();
    return this.map.workItem(item, v);
  }

  async updateWorkItem(itemId: string, input: Partial<WorkItemInputData>) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    const item = this.itemFor(v, itemId);
    if (item.approvalRequestId) throw ApiError.conflict(API_ERROR_CODES.approvalBound, 'Diese Position gehört zu einer Freigabeanfrage. Änderungen bitte als neue Fassung der Anfrage senden.');
    if (item.executionStatus === 'done' || item.executionStatus === 'not_done') throw ApiError.conflict(API_ERROR_CODES.itemFinished, 'Abgeschlossene Positionen können nicht mehr geändert werden.');
    this.assertAssignable([input.assignedTo]);
    const next = { ...item, ...Object.fromEntries(Object.entries(input).filter(([, x]) => x !== undefined)) } as DWorkItem;
    this.replaceItem(next);
    this.audit(v, 'work_item.updated', 'work_item', itemId, { workOrderId: item.workOrderId, fields: Object.keys(input) });
    this.invalidateIntakeIfChanged(item.workOrderId, v);
    this.changed();
    return this.map.workItem(next, v);
  }

  /** Ausführung wie in der API: Recht und Zuweisung (Domain `canExecuteWorkItem`), dann Übergang. */
  private executeItem(v: Viewer, itemId: string, run: (state: { authorization: DWorkItem['authorization']; executionStatus: DWorkItem['executionStatus']; maintenanceTypeId: string | null }) => WorkItemTransitionResult) {
    const item = this.itemFor(v, itemId);
    const wo = this.state.workOrders.find((w) => w.id === item.workOrderId)!;
    const decision = canExecuteWorkItem(this.actorOf(v), {
      assignedToUserId: item.assignedTo,
      workOrderAssigneeUserIds: wo.assigneeIds,
      authorization: item.authorization,
      workOrderStatus: wo.status,
    });
    if (!decision.allowed) {
      if (decision.notFound) throw ApiError.notFound();
      if (decision.reason === 'ITEM_NOT_AUTHORIZED') {
        const reason = item.authorization === 'pending_approval' ? 'Die Position wartet auf Kundenfreigabe.' : 'Die Position wurde vom Kunden abgelehnt oder zurückgezogen und wird nicht ausgeführt.';
        throw ApiError.conflict(API_ERROR_CODES.notAuthorized, reason);
      }
      throw ApiError.forbidden(decision.reason === 'NOT_ASSIGNED' ? 'Diese Position ist Ihnen nicht zugewiesen.' : decision.reason === 'WORK_ORDER_NOT_ACTIVE' ? 'Im aktuellen Auftragsstatus können keine Arbeiten ausgeführt werden.' : 'Dafür fehlt die Berechtigung.');
    }
    const result = run({ authorization: item.authorization, executionStatus: item.executionStatus, maintenanceTypeId: item.maintenanceTypeId });
    if (!result.ok) throw ApiError.conflict(apiCodeFromDomain(result.error.code), result.error.message);
    return { item, wo, t: result.value };
  }

  private minutesSince(iso: string | null): number {
    return iso ? Math.max(0, Math.round((this.clock().getTime() - Date.parse(iso)) / 60_000)) : 0;
  }

  private applyTimeEntry(item: DWorkItem, t: { timeEntry: { action: 'open' | 'close' | 'none' } }): Pick<DWorkItem, 'runningSince' | 'trackedMinutes'> {
    if (t.timeEntry.action === 'open') return { runningSince: this.nowIso(), trackedMinutes: item.trackedMinutes };
    if (t.timeEntry.action === 'close') return { runningSince: null, trackedMinutes: item.trackedMinutes + this.minutesSince(item.runningSince) };
    return { runningSince: item.runningSince, trackedMinutes: item.trackedMinutes };
  }

  async startWorkItem(itemId: string, options: { idempotencyKey?: string } = {}) {
    await this.gate();
    const v = this.viewer();
    return this.once(options.idempotencyKey, v.user.id, () => {
      const { item, t } = this.executeItem(v, itemId, (s) => startItem(s, { now: this.clock() }));
      const next: DWorkItem = { ...item, executionStatus: t.executionStatus, ...this.applyTimeEntry(item, t), assignedTo: item.assignedTo ?? v.user.id };
      this.replaceItem(next);
      this.audit(v, 'work_item.started', 'work_item', itemId, { workOrderId: item.workOrderId });
      this.refreshWorkStatus(item.workOrderId);
      this.changed();
      return this.map.workItem(next, v);
    });
  }

  async pauseWorkItem(itemId: string, options: { idempotencyKey?: string } = {}) {
    await this.gate();
    const v = this.viewer();
    return this.once(options.idempotencyKey, v.user.id, () => {
      const { item, t } = this.executeItem(v, itemId, (s) => pauseItem(s, { now: this.clock() }));
      const next: DWorkItem = { ...item, executionStatus: t.executionStatus, ...this.applyTimeEntry(item, t) };
      this.replaceItem(next);
      this.audit(v, 'work_item.paused', 'work_item', itemId, { workOrderId: item.workOrderId });
      this.changed();
      return this.map.workItem(next, v);
    });
  }

  /**
   * Abschluss (Domain `finishItem`): Wartungsposition verlangt km-Stand; ausdrücklich
   * `odometerKm: null` heißt "km unbekannt". Fehlt das Feld: 409 `odometer_required`.
   * Erzeugt nie selbst einen Serviceeintrag (erst der fachliche Abschluss).
   */
  async finishWorkItem(itemId: string, input: FinishWorkItemInput, options: { idempotencyKey?: string } = {}) {
    await this.gate();
    const v = this.viewer();
    return this.once(options.idempotencyKey, v.user.id, () => {
      const hasKmKey = Object.prototype.hasOwnProperty.call(input, 'odometerKm');
      const { item, wo, t } = this.executeItem(v, itemId, (s) =>
        finishItem(s, { now: this.clock(), odometerKm: input.odometerKm ?? null, odometerUnknown: hasKmKey && input.odometerKm === null, resultNotes: input.resultNotes ?? null }),
      );
      const next: DWorkItem = {
        ...item,
        executionStatus: t.executionStatus,
        doneAt: t.doneAt ?? this.nowIso(),
        doneBy: v.user.id,
        doneOdometerKm: t.doneOdometerKm,
        resultNotes: t.resultNotes,
        intervalKm: input.intervalKm !== undefined ? input.intervalKm : item.intervalKm,
        intervalMonths: input.intervalMonths !== undefined ? input.intervalMonths : item.intervalMonths,
        ...this.applyTimeEntry(item, t),
      };
      this.replaceItem(next);
      if (t.doneOdometerKm !== null) this.recordOdometer(wo.vehicleId, t.doneOdometerKm, this.nowIso(), 'work_completion', wo.id);
      this.audit(v, 'work_item.finished', 'work_item', itemId, { workOrderId: item.workOrderId, odometerUnknown: t.odometerUnknown });
      this.refreshWorkStatus(item.workOrderId);
      this.changed();
      return this.map.workItem(next, v);
    });
  }

  async notDoneWorkItem(itemId: string, input: NotDoneWorkItemInput, options: { idempotencyKey?: string } = {}) {
    await this.gate();
    const v = this.viewer();
    return this.once(options.idempotencyKey, v.user.id, () => {
      const { item, t } = this.executeItem(v, itemId, (s) => markNotDone(s, { now: this.clock(), reason: input.reason }));
      const next: DWorkItem = { ...item, executionStatus: t.executionStatus, resultNotes: t.resultNotes, ...this.applyTimeEntry(item, t) };
      this.replaceItem(next);
      this.audit(v, 'work_item.not_done', 'work_item', itemId, { workOrderId: item.workOrderId, reason: input.reason });
      this.refreshWorkStatus(item.workOrderId);
      this.changed();
      return this.map.workItem(next, v);
    });
  }

  async addPart(itemId: string, input: PartUsedInput, options: { idempotencyKey?: string } = {}) {
    await this.gate();
    const v = this.viewer();
    return this.once(options.idempotencyKey, v.user.id, () => {
      const { item } = this.executeItem(v, itemId, (s) => ({ ok: true, value: { executionStatus: s.executionStatus, doneAt: null, doneOdometerKm: null, odometerUnknown: false, resultNotes: null, timeEntry: { action: 'none' } } }));
      if (!input.description?.trim()) throw ApiError.validation('Bitte das Teil beschreiben.');
      const next = { ...item, parts: [...item.parts, { partNumber: input.partNumber?.trim() || null, description: input.description.trim(), quantity: input.quantity, unitPriceCents: v.role === 'mechanic' ? null : (input.unitPriceCents ?? null) }] };
      this.replaceItem(next);
      this.audit(v, 'work_item.part_added', 'work_item', itemId, { workOrderId: item.workOrderId });
      this.changed();
      return this.map.workItem(next, v);
    });
  }

  async listFindings(workOrderId: string) {
    await this.gate();
    const v = this.viewer();
    if (!isStaff(v)) throw ApiError.notFound();
    this.workOrderFor(v, workOrderId);
    const map = this.map;
    return this.state.findings
      .filter((f) => f.workOrderId === workOrderId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map((f) => map.finding(f));
  }

  async createFinding(workOrderId: string, input: FindingInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'findings.write');
    this.workOrderFor(v, workOrderId);
    if (input.id) {
      const existing = this.state.findings.find((f) => f.id === input.id);
      if (existing) {
        if (existing.workOrderId !== workOrderId || existing.reportedBy !== v.user.id) throw ApiError.conflict(API_ERROR_CODES.idInUse, 'Diese ID ist bereits vergeben.');
        return this.map.finding(existing); // Offline-Wiederholung: keine Dublette
      }
    }
    if (!input.description?.trim()) throw ApiError.validation('Bitte die Feststellung beschreiben.');
    if (input.workItemId && !this.state.workItems.some((i) => i.id === input.workItemId && i.workOrderId === workOrderId)) {
      throw ApiError.unprocessable(API_ERROR_CODES.invalidWorkItem, 'Die Position gehört nicht zu diesem Auftrag.');
    }
    const f = { id: input.id ?? uuid(), workOrderId, workItemId: input.workItemId ?? null, description: input.description.trim(), severity: input.severity, status: 'new' as const, reportedBy: v.user.id, dictated: input.dictated ?? false, photoIds: [] as string[], createdAt: this.nowIso() };
    for (const photoId of input.photoIds ?? []) {
      const photo = this.state.photos.find((p) => p.id === photoId && p.workOrderId === workOrderId);
      if (photo) {
        photo.findingId = f.id;
        f.photoIds.push(photo.id);
      }
    }
    this.state.findings.push(f);
    this.audit(v, 'finding.created', 'finding', f.id, { workOrderId, severity: f.severity });
    this.changed();
    return this.map.finding(f);
  }

  private changeFinding(v: Viewer, findingId: string, to: 'reported' | 'dismissed') {
    const f = this.state.findings.find((x) => x.id === findingId);
    if (!f) throw ApiError.notFound();
    const wo = this.workOrderFor(v, f.workOrderId);
    if (f.status === 'converted' || f.status === 'dismissed') throw ApiError.conflict(API_ERROR_CODES.findingClosed, 'Die Feststellung ist bereits erledigt.');
    if (f.status === to) return f;
    f.status = to;
    this.audit(v, to === 'reported' ? 'finding.reported' : 'finding.dismissed', 'finding', f.id, { workOrderId: wo.id });
    if (to === 'reported') this.notify(this.staffUserIds(), 'finding.reported', 'Zusatzarbeit gemeldet', `Zu Auftrag ${wo.orderNumber} wurde eine Zusatzarbeit gemeldet.`, `/werkstatt/auftraege/${wo.id}/arbeiten`);
    this.changed();
    return f;
  }

  async reportFinding(findingId: string, options: { idempotencyKey?: string } = {}) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'findings.write');
    return this.once(options.idempotencyKey, v.user.id, () => this.map.finding(this.changeFinding(v, findingId, 'reported')));
  }

  async dismissFinding(findingId: string) {
    await this.gate();
    const v = this.viewer();
    if (!isStaff(v)) throw ApiError.notFound();
    if (!(can(v, 'approvals.request') || can(v, 'workOrders.write'))) throw ApiError.forbidden();
    return this.map.finding(this.changeFinding(v, findingId, 'dismissed'));
  }

  async listPhotos(workOrderId: string) {
    await this.gate();
    const v = this.viewer();
    this.workOrderFor(v, workOrderId);
    const map = this.map;
    return this.state.photos
      .filter((p) => p.workOrderId === workOrderId && (isStaff(v) || p.visibility === 'customer'))
      .sort((a, b) => (a.takenAt < b.takenAt ? -1 : 1))
      .map((p) => map.photo(p));
  }

  async attachPhoto(workOrderId: string, input: AttachPhotoInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'findings.write');
    this.workOrderFor(v, workOrderId);
    if (input.id) {
      const existing = this.state.photos.find((p) => p.id === input.id);
      if (existing) {
        if (existing.workOrderId !== workOrderId || existing.fileId !== input.fileId) throw ApiError.conflict(API_ERROR_CODES.idInUse, 'Diese ID ist bereits vergeben.');
        return this.map.photo(existing);
      }
    }
    const file = this.state.files.find((f) => f.id === input.fileId);
    if (!file) throw ApiError.unprocessable(API_ERROR_CODES.invalidPhotos, 'Die Datei wurde nicht gefunden.');
    if (!IMAGE_TYPES.has(file.mimeType)) throw ApiError.unprocessable(API_ERROR_CODES.notAnImage, 'Fotos müssen Bilddateien sein (JPEG, PNG, WebP, HEIC).');
    if (input.findingId && !this.state.findings.some((f) => f.id === input.findingId && f.workOrderId === workOrderId)) {
      throw ApiError.unprocessable(API_ERROR_CODES.invalidFinding, 'Die Feststellung gehört nicht zu diesem Auftrag.');
    }
    const photo = { id: input.id ?? uuid(), workOrderId, fileId: input.fileId, context: input.context, findingId: input.findingId ?? null, visibility: 'internal' as Visibility, caption: input.caption?.trim() || null, takenAt: input.takenAt ?? this.nowIso() };
    this.state.photos.push(photo);
    if (photo.findingId) {
      const f = this.state.findings.find((x) => x.id === photo.findingId);
      if (f && !f.photoIds.includes(photo.id)) f.photoIds.push(photo.id);
    }
    this.audit(v, 'photo.attached', 'photo', photo.id, { workOrderId, context: photo.context });
    this.changed();
    return this.map.photo(photo);
  }

  async setPhotoVisibility(photoId: string, visibility: Visibility) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'documents.publish');
    const photo = this.state.photos.find((p) => p.id === photoId);
    if (!photo) throw ApiError.notFound();
    this.workOrderFor(v, photo.workOrderId);
    photo.visibility = visibility;
    this.audit(v, 'photo.visibility_changed', 'photo', photoId, { workOrderId: photo.workOrderId, visibility });
    this.changed();
    return this.map.photo(photo);
  }

  async timeline(workOrderId: string) {
    await this.gate();
    const v = this.viewer();
    if (!isStaff(v)) throw ApiError.notFound();
    const wo = this.workOrderFor(v, workOrderId);
    const labels: Record<string, string> = {
      'work_order.created': 'Auftrag angelegt',
      'work_order.updated': 'Auftrag geändert',
      'work_order.status_changed': 'Arbeitsstatus geändert',
      'work_order.assignees_changed': 'Mitarbeiter zugewiesen',
      'intake.saved': 'Annahme gespeichert',
      'intake.confirmed': 'Annahme bestätigt',
      'intake.confirmation_invalidated': 'Annahme geändert, Bestätigung ungültig',
      'work_item.added': 'Position hinzugefügt',
      'work_item.updated': 'Position geändert',
      'approval.created': 'Freigabeanfrage angelegt (Entwurf)',
      'approval.sent': 'Freigabeanfrage gesendet',
      'approval.version_sent': 'Neue Version der Freigabeanfrage gesendet',
      'approval.withdrawn': 'Freigabeanfrage zurückgezogen',
      'approval.decided': 'Kundenentscheidung',
      'finding.created': 'Feststellung erfasst',
      'finding.reported': 'Zusatzarbeit an Service gemeldet',
      'finding.dismissed': 'Feststellung verworfen',
      'photo.attached': 'Foto hinzugefügt',
      'photo.visibility_changed': 'Sichtbarkeit eines Fotos geändert',
      'work_item.started': 'Arbeit gestartet',
      'work_item.paused': 'Arbeit pausiert',
      'work_item.finished': 'Arbeit abgeschlossen',
      'work_item.not_done': 'Position nicht durchgeführt',
      'work_item.part_added': 'Teil erfasst',
      'work_order.completion_reviewed': 'Fachlicher Abschluss bestätigt',
      'service_entry.created': 'Serviceeintrag erzeugt',
      'work_order.ready_for_pickup': 'Abholbereit gemeldet',
      'work_order.picked_up': 'Abgeholt',
      'document.created': 'Dokument hochgeladen',
      'document.version_added': 'Neue Dokumentversion',
      'document.published': 'Dokument veröffentlicht',
      'document.unpublished': 'Veröffentlichung zurückgezogen',
      'invoice.created': 'Rechnung angelegt (Entwurf)',
      'invoice.issued': 'Rechnung gestellt',
      'invoice.cancelled': 'Rechnung storniert',
      'payment.booked': 'Zahlung gebucht (Anbieter bestätigt)',
      'payment.manual_recorded': 'Zahlung manuell zugeordnet',
      'refund.requested': 'Erstattung ausgelöst',
    };
    const map = this.map;
    const fromAudit = this.state.audit
      .filter((a) => a.entityId === workOrderId || a.data.workOrderId === workOrderId)
      .filter((a, i, all) => !(a.action === 'work_order.created' && all.findIndex((x) => x.action === 'work_order.created') !== i))
      .map((a) => {
        const entry = map.audit(a);
        return { id: a.id, occurredAt: a.occurredAt, actorDisplayName: entry.actorDisplayName, action: a.action, summary: labels[a.action] ?? a.action };
      });
    const hasCreated = fromAudit.some((e) => e.action === 'work_order.created');
    const base = hasCreated ? [] : [{ id: `created-${wo.id}`, occurredAt: wo.createdAt, actorDisplayName: null, action: 'work_order.created', summary: 'Auftrag angelegt' }];
    return [...base, ...fromAudit].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  }

  // ---------------------------------------------------------------------------
  // Freigaben
  // ---------------------------------------------------------------------------

  async listApprovals(workOrderId: string) {
    await this.gate();
    const v = this.viewer();
    this.workOrderFor(v, workOrderId);
    if (v.role === 'mechanic') throw ApiError.forbidden('Freigabeanfragen enthalten Preise und sind für Mechaniker nicht sichtbar.');
    const map = this.map;
    return this.state.approvals
      .filter((r) => r.workOrderId === workOrderId && (isStaff(v) || r.status !== 'draft'))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((r) => map.approval(r, v));
  }

  private validateApprovalReferences(workOrderId: string, input: ApprovalDraft) {
    for (const id of input.photoIds ?? []) {
      if (!this.state.photos.some((p) => p.id === id && p.workOrderId === workOrderId)) throw ApiError.unprocessable(API_ERROR_CODES.invalidPhotos, 'Ein Foto gehört nicht zu diesem Auftrag.');
    }
    if (input.findingId && !this.state.findings.some((f) => f.id === input.findingId && f.workOrderId === workOrderId)) {
      throw ApiError.unprocessable(API_ERROR_CODES.invalidFinding, 'Die Feststellung gehört nicht zu diesem Auftrag.');
    }
  }

  async createApproval(workOrderId: string, input: ApprovalDraft) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'approvals.request');
    const wo = this.workOrderFor(v, workOrderId);
    if (!['draft', 'open', 'in_progress', 'work_completed'].includes(wo.status)) {
      throw ApiError.conflict(API_ERROR_CODES.workOrderClosed, 'Zu einem abgeschlossenen Auftrag können keine Freigaben angefragt werden.');
    }
    this.validateApprovalReferences(workOrderId, input);
    const req = approvalRules.createDraft({ id: uuid(), versionId: uuid(), workOrderId, draft: input, createdBy: v.user.id, now: this.nowIso() });
    this.state.approvals.push(req);
    if (input.findingId) {
      const f = this.state.findings.find((x) => x.id === input.findingId);
      if (f) f.status = 'converted';
    }
    this.audit(v, 'approval.created', 'approval_request', req.id, { workOrderId, versionNo: 1, contentHash: approvalRules.currentVersion(req).contentHash });
    this.changed();
    return this.map.approval(req, v);
  }

  async getApproval(id: string) {
    await this.gate();
    const v = this.viewer();
    return this.map.approval(this.approvalFor(v, id), v);
  }

  private replaceApproval(r: DemoState['approvals'][number]) {
    this.state.approvals = this.state.approvals.map((x) => (x.id === r.id ? r : x));
  }

  private notifyApproval(r: DemoState['approvals'][number], isNewVersion: boolean) {
    const wo = this.state.workOrders.find((w) => w.id === r.workOrderId)!;
    this.notify(
      this.customerUserIds(wo.customerId),
      'approval.requested',
      isNewVersion ? `Neue Version: ${r.title}` : `Freigabe erbeten: ${r.title}`,
      `Auftrag ${wo.orderNumber}. ${isNewVersion ? 'Das Angebot wurde geändert.' : 'Bitte prüfen Sie die Anfrage.'}`,
      `/kunde/auftraege/${wo.id}/freigaben/${r.id}`,
    );
  }

  /** Beim Senden werden die in der Version genannten Fotos für den Kunden sichtbar (R-FRG-2, wie die API). */
  private shareVersionPhotos(r: DemoState['approvals'][number], v: Viewer) {
    for (const photoId of approvalRules.currentVersion(r).photoIds) {
      const photo = this.state.photos.find((p) => p.id === photoId);
      if (photo && photo.visibility !== 'customer') {
        photo.visibility = 'customer';
        this.audit(v, 'photo.visibility_changed', 'photo', photo.id, { workOrderId: r.workOrderId, visibility: 'customer', reason: 'approval_sent' });
      }
    }
  }

  /** Status-Rückkehr nach Freigabe einer Zusatzarbeit (Arbeiten erledigt → in Arbeit). */
  private reopenIfNeeded(workOrderId: string) {
    this.refreshWorkStatus(workOrderId);
  }

  private doRevise(v: Viewer, id: string, input: ApprovalDraft) {
    const r = this.approvalFor(v, id);
    this.validateApprovalReferences(r.workOrderId, input);
    const before = approvalRules.currentVersion(r);
    const next = approvalRules.reviseRequest(r, input, { versionId: uuid(), createdBy: v.user.id, now: this.nowIso() });
    this.replaceApproval(next);
    const after = approvalRules.currentVersion(next);
    if (after.id !== before.id) {
      this.state.workItems = approvalRules.syncItemsWithVersion(this.state.workItems, next, uuid, { newVersion: true });
      this.shareVersionPhotos(next, v);
      this.refreshWorkStatus(next.workOrderId);
      this.notifyApproval(next, true);
      this.audit(v, 'approval.version_sent', 'approval_request', id, { workOrderId: next.workOrderId, versionNo: after.versionNo, contentHash: after.contentHash, supersededVersionId: before.id, totalGrossCents: after.totalGrossCents });
    } else if (r.status === 'draft') {
      this.audit(v, 'approval.revised', 'approval_request', id, { workOrderId: next.workOrderId, draft: true, contentHash: after.contentHash });
    }
    this.changed();
    return next;
  }

  async reviseApproval(id: string, input: ApprovalDraft) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'approvals.request');
    return this.map.approval(this.doRevise(v, id, input), v);
  }

  async sendApproval(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'approvals.request');
    const r = approvalRules.sendRequest(this.approvalFor(v, id), this.nowIso());
    this.replaceApproval(r);
    // Positionen entstehen erst beim Senden (keine Preise vor dem Senden im Auftrag)
    this.state.workItems = approvalRules.syncItemsWithVersion(this.state.workItems, r, uuid);
    this.shareVersionPhotos(r, v);
    this.refreshWorkStatus(r.workOrderId);
    this.notifyApproval(r, false);
    const cv = approvalRules.currentVersion(r);
    this.audit(v, 'approval.sent', 'approval_request', id, { workOrderId: r.workOrderId, versionNo: cv.versionNo, contentHash: cv.contentHash, totalGrossCents: cv.totalGrossCents });
    this.changed();
    return this.map.approval(r, v);
  }

  async withdrawApproval(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'approvals.request');
    const { request, items } = approvalRules.withdrawRequest(this.approvalFor(v, id), this.nowIso(), this.state.workItems);
    this.replaceApproval(request);
    this.state.workItems = items;
    this.refreshWorkStatus(request.workOrderId);
    this.audit(v, 'approval.withdrawn', 'approval_request', id, { workOrderId: request.workOrderId });
    this.changed();
    return this.map.approval(request, v);
  }

  async decideApproval(id: string, input: ApprovalDecisionInput) {
    await this.gate();
    const v = this.viewer();
    const r = this.state.approvals.find((x) => x.id === id);
    if (!r) throw ApiError.notFound();
    // Mitarbeiter (auch Admin und Mechaniker) entscheiden nie für den Kunden
    if (isStaff(v)) throw new ApiError(403, API_ERROR_CODES.notCustomer, 'Nur der Kunde selbst kann Freigaben erteilen oder ablehnen.');
    this.workOrderFor(v, r.workOrderId);
    const wo = this.state.workOrders.find((w) => w.id === r.workOrderId)!;
    const next = approvalRules.decide(
      r,
      { versionId: input.versionId, contentHash: input.contentHash, decision: input.decision, comment: input.comment ?? null, channel: input.channel },
      { userId: v.user.id, displayName: v.user.displayName, role: v.role, customerId: v.customerId, accountActive: v.user.status === 'active' },
      wo.customerId,
      { decisionId: uuid(), now: this.nowIso() },
    );
    this.replaceApproval(next);
    this.state.workItems = approvalRules.applyDecisionToItems(this.state.workItems, id, input.decision, input.versionId);
    this.reopenIfNeeded(wo.id);
    const label = input.decision === 'approved' ? 'freigegeben' : 'abgelehnt';
    this.notify(this.staffUserIds(), 'approval.decided', `Kunde hat ${label}: ${r.title}`, `${wo.orderNumber}, ${customerName(this.state.customers.find((c) => c.id === wo.customerId))}`, `/werkstatt/auftraege/${wo.id}/freigaben/${id}`);
    this.notify(wo.assigneeIds, 'approval.decided', `Kunde hat ${label}: ${r.title}`, wo.orderNumber, `/mechaniker/auftraege/${wo.id}`);
    this.audit(v, 'approval.decided', 'approval_request', id, { workOrderId: wo.id, versionId: input.versionId, decision: input.decision, contentHash: input.contentHash, channel: input.channel });
    this.changed();
    return this.map.approval(next, v);
  }

  // ---------------------------------------------------------------------------
  // Dateien und Dokumente
  // ---------------------------------------------------------------------------

  async uploadFile(input: UploadInput, options: { idempotencyKey?: string } = {}) {
    await this.gate();
    const v = this.viewer();
    return this.once(options.idempotencyKey, v.user.id, () => {
      if (!IMAGE_TYPES.has(input.mimeType) && input.mimeType !== 'application/pdf') {
        throw new ApiError(415, API_ERROR_CODES.unsupportedFileType, 'Nur JPEG, PNG, WebP, HEIC und PDF sind erlaubt.');
      }
      if ((input.sizeBytes ?? 0) > 15 * 1024 * 1024) throw new ApiError(413, API_ERROR_CODES.payloadTooLarge, 'Die Datei ist größer als 15 MB.');
      const f = { id: uuid(), originalName: input.name, mimeType: input.mimeType, sizeBytes: input.sizeBytes ?? 0, sha256: sha256Hex(`${input.uri}:${this.nowIso()}`), localUri: input.uri, placeholderLabel: null };
      this.state.files.push(f);
      this.audit(v, 'file.uploaded', 'file', f.id);
      this.changed();
      return { id: f.id, originalName: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, sha256: f.sha256 };
    });
  }

  private documentsVisibleTo(v: Viewer) {
    const docs = this.state.documents.filter((d) => d.deletedAt === null);
    if (v.role === 'customer') return docs.filter((d) => customerCanSeeDocument(v.customerId ?? '', d));
    if (v.role === 'mechanic') {
      // Mechaniker: nie Angebote und Rechnungen (Preise), sonst nur zu eigenen Aufträgen
      const orders = new Set(this.visibleWorkOrders(v).map((w) => w.id));
      return docs.filter((d) => d.kind !== 'offer' && d.kind !== 'invoice' && d.workOrderId && orders.has(d.workOrderId) && (d.visibility === 'customer' || can(v, 'documents.readInternal')));
    }
    if (can(v, 'documents.readInternal')) return docs;
    return docs.filter((d) => d.visibility === 'customer');
  }

  async listDocuments(query: ListDocumentsQuery = {}) {
    await this.gate();
    const v = this.viewer();
    let docs = this.documentsVisibleTo(v);
    if (query.workOrderId) docs = docs.filter((d) => d.workOrderId === query.workOrderId);
    if (query.vehicleId) docs = docs.filter((d) => d.vehicleId === query.vehicleId);
    if (query.customerId) docs = docs.filter((d) => d.customerId === query.customerId);
    if (query.kind) docs = docs.filter((d) => d.kind === query.kind);
    const map = this.map;
    return docs.sort((a, b) => ((a.publishedAt ?? a.createdAt) < (b.publishedAt ?? b.createdAt) ? 1 : -1)).map((d) => map.document(d));
  }

  private createDocumentInternal(v: Viewer, input: CreateDocumentInput) {
    const file = this.state.files.find((f) => f.id === input.fileId);
    if (!file) throw ApiError.unprocessable(API_ERROR_CODES.invalidDocument, 'Die Datei wurde nicht gefunden.');
    const wo = input.workOrderId ? this.state.workOrders.find((w) => w.id === input.workOrderId) : undefined;
    if (input.workOrderId && !wo) throw ApiError.unprocessable(API_ERROR_CODES.invalidWorkOrder, 'Der Auftrag wurde nicht gefunden.');
    const d = {
      id: uuid(),
      kind: input.kind,
      title: input.title.trim(),
      customerId: input.customerId ?? wo?.customerId ?? null,
      vehicleId: input.vehicleId ?? wo?.vehicleId ?? null,
      workOrderId: input.workOrderId ?? null,
      visibility: 'internal' as Visibility,
      publishedAt: null,
      createdAt: this.nowIso(),
      deletedAt: null,
      versions: [{ id: uuid(), versionNo: 1, fileId: input.fileId, note: null, createdAt: this.nowIso() }],
    };
    this.state.documents.push(d);
    this.audit(v, 'document.created', 'document', d.id, { workOrderId: d.workOrderId, kind: d.kind });
    return d;
  }

  async createDocument(input: CreateDocumentInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'documents.write');
    if (!input.title?.trim()) throw ApiError.validation('Bitte einen Titel angeben.');
    if (!input.customerId && !input.vehicleId && !input.workOrderId) throw ApiError.validation('Dokument muss zugeordnet sein.');
    const d = this.createDocumentInternal(v, input);
    this.changed();
    return this.map.document(d);
  }

  async addDocumentVersion(documentId: string, input: { fileId: string; note?: string | null }) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'documents.write');
    const d = this.state.documents.find((x) => x.id === documentId);
    if (!d) throw ApiError.notFound();
    if (!this.state.files.some((f) => f.id === input.fileId)) throw ApiError.unprocessable(API_ERROR_CODES.invalidDocument, 'Die Datei wurde nicht gefunden.');
    d.versions.push({ id: uuid(), versionNo: d.versions.length + 1, fileId: input.fileId, note: input.note?.trim() || null, createdAt: this.nowIso() });
    this.audit(v, 'document.version_added', 'document', documentId, { workOrderId: d.workOrderId, versionNo: d.versions.length });
    this.changed();
    return this.map.document(d);
  }

  async publishDocument(documentId: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'documents.publish');
    const d = this.state.documents.find((x) => x.id === documentId);
    if (!d) throw ApiError.notFound();
    if (!d.customerId) throw ApiError.unprocessable(API_ERROR_CODES.customerRequired, 'Nur Dokumente mit Kundenbezug können veröffentlicht werden.');
    Object.assign(d, { visibility: 'customer', publishedAt: this.nowIso() });
    this.audit(v, 'document.published', 'document', documentId, { workOrderId: d.workOrderId });
    this.changed();
    return this.map.document(d);
  }

  async unpublishDocument(documentId: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'documents.publish');
    const d = this.state.documents.find((x) => x.id === documentId);
    if (!d) throw ApiError.notFound();
    Object.assign(d, { visibility: 'internal', publishedAt: null });
    this.audit(v, 'document.unpublished', 'document', documentId, { workOrderId: d.workOrderId });
    this.changed();
    return this.map.document(d);
  }

  async downloadDocument(documentId: string): Promise<DownloadResult> {
    await this.gate();
    const v = this.viewer();
    const d = this.documentsVisibleTo(v).find((x) => x.id === documentId);
    if (!d) throw ApiError.notFound();
    const dto = this.map.document(d);
    const current = d.versions.reduce((acc, x) => (x.versionNo > acc.versionNo ? x : acc), d.versions[0]!);
    const file = this.state.files.find((f) => f.id === current.fileId);
    // Im Demo-Modus hochgeladene Datei (blob:) direkt öffnen, sonst ein Beispiel-PDF erzeugen
    if (file?.localUri) return { uri: file.localUri, fileName: file.originalName, mimeType: file.mimeType };
    const pdf = makeDemoPdf(['Beispieldokument (Demo)', d.title, `Version ${dto.currentVersion.versionNo}`, 'Autowerkstatt Witten, Entwurf mit Beispieldaten.', 'Kein echtes Dokument.']);
    return { uri: `data:application/pdf;base64,${toBase64(pdf)}`, fileName: dto.currentVersion.file.originalName, mimeType: 'application/pdf' };
  }

  imageSource(contentUrl: string): ImageSourceSpec {
    const photoMatch = /\/photos\/([^/]+)\/content/.exec(contentUrl);
    const fileMatch = /\/files\/([^/]+)\/content/.exec(contentUrl);
    const fileId = photoMatch ? this.state.photos.find((p) => p.id === photoMatch[1])?.fileId : fileMatch?.[1];
    const f = fileId ? this.state.files.find((x) => x.id === fileId) : undefined;
    if (f?.localUri) return { uri: f.localUri };
    return { uri: '', placeholderLabel: f?.placeholderLabel ?? 'Beispielfoto' };
  }

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  async listConversations() {
    await this.gate();
    const v = this.viewer();
    if (isStaff(v)) this.require(v, 'messages.customerChat');
    const map = this.map;
    const withMessages = new Set(this.state.messages.map((m) => m.workOrderId));
    return this.visibleWorkOrders(v)
      .filter((w) => withMessages.has(w.id))
      .map((w) => map.conversation(w, v))
      .sort((a, b) => b.unreadCount - a.unreadCount || ((a.lastMessage?.createdAt ?? '') < (b.lastMessage?.createdAt ?? '') ? 1 : -1));
  }

  async listMessages(workOrderId: string, after?: string) {
    await this.gate();
    const v = this.viewer();
    if (isStaff(v)) this.require(v, 'messages.customerChat');
    this.workOrderFor(v, workOrderId);
    const map = this.map;
    return this.state.messages
      .filter((m) => m.workOrderId === workOrderId && (!after || m.createdAt > after))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map((m) => map.message(m));
  }

  async sendMessage(workOrderId: string, input: SendMessageInput) {
    await this.gate();
    const v = this.viewer();
    if (isStaff(v)) this.require(v, 'messages.customerChat');
    const wo = this.workOrderFor(v, workOrderId);
    const parsed = SendMessageRequestSchema.safeParse(input);
    if (!parsed.success) throw ApiError.validation(parsed.error.issues[0]?.message ?? 'Nachricht ist leer');
    const existing = this.state.messages.find((m) => m.authorUserId === v.user.id && m.clientMessageId === parsed.data.clientMessageId);
    if (existing) {
      if (existing.workOrderId !== workOrderId) throw ApiError.conflict(API_ERROR_CODES.clientMessageIdInUse, 'Diese Nachrichten-ID wurde bereits verwendet.');
      return this.map.message(existing); // Wiederholung nach Verbindungsabbruch: keine Dublette
    }
    // Anhänge werden Fotos (Kontext chat, für den Kunden sichtbar), wie in der API
    const photoIds: string[] = [];
    for (const fileId of parsed.data.fileIds) {
      const file = this.state.files.find((f) => f.id === fileId);
      if (!file || !IMAGE_TYPES.has(file.mimeType)) throw ApiError.unprocessable(API_ERROR_CODES.notAnImage, 'Im Chat können nur Fotos angehängt werden.');
      const photo = { id: uuid(), workOrderId, fileId, context: 'chat' as const, findingId: null, visibility: 'customer' as Visibility, caption: null, takenAt: this.nowIso() };
      this.state.photos.push(photo);
      photoIds.push(photo.id);
    }
    const m = { id: uuid(), workOrderId, authorUserId: v.user.id, body: parsed.data.body, photoIds, clientMessageId: parsed.data.clientMessageId, createdAt: this.nowIso() };
    this.state.messages.push(m);
    this.markReadInternal(workOrderId, v.user.id);
    if (v.role === 'customer') {
      this.notify(this.staffUserIds(), 'message.received', `Neue Nachricht zu ${wo.orderNumber}`, customerName(this.state.customers.find((c) => c.id === wo.customerId)), `/werkstatt/auftraege/${wo.id}/chat`);
    } else {
      this.notify(this.customerUserIds(wo.customerId), 'message.received', `Neue Nachricht zu ${wo.orderNumber}`, `${this.state.settings.name} hat Ihnen geschrieben.`, `/kunde/auftraege/${wo.id}/chat`);
    }
    this.changed();
    return this.map.message(m);
  }

  private markReadInternal(workOrderId: string, userId: string) {
    const existing = this.state.reads.find((r) => r.workOrderId === workOrderId && r.userId === userId);
    if (existing) existing.lastReadAt = this.nowIso();
    else this.state.reads.push({ workOrderId, userId, lastReadAt: this.nowIso() });
  }

  async markRead(workOrderId: string) {
    await this.gate();
    const v = this.viewer();
    this.workOrderFor(v, workOrderId);
    this.markReadInternal(workOrderId, v.user.id);
    this.changed();
  }

  async listInternalNotes(workOrderId: string) {
    await this.gate();
    const v = this.viewer();
    if (!isStaff(v)) throw ApiError.notFound();
    this.workOrderFor(v, workOrderId);
    return this.state.internalNotes
      .filter((n) => n.workOrderId === workOrderId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map((n) => ({ id: n.id, workOrderId: n.workOrderId, author: { userId: n.authorUserId, displayName: this.userById(n.authorUserId)?.displayName ?? 'Unbekannt' }, body: n.body, createdAt: n.createdAt }));
  }

  async addInternalNote(workOrderId: string, input: { body: string }, options: { idempotencyKey?: string } = {}) {
    await this.gate();
    const v = this.viewer();
    if (!isStaff(v)) throw ApiError.notFound();
    return this.once(options.idempotencyKey, v.user.id, () => {
      this.workOrderFor(v, workOrderId);
      if (!input.body.trim()) throw ApiError.validation('Die Notiz ist leer.');
      const n = { id: uuid(), workOrderId, authorUserId: v.user.id, body: input.body.trim(), createdAt: this.nowIso() };
      this.state.internalNotes.push(n);
      this.audit(v, 'internal_note.created', 'work_order', workOrderId, { workOrderId });
      this.changed();
      return { id: n.id, workOrderId, author: { userId: v.user.id, displayName: v.user.displayName }, body: n.body, createdAt: n.createdAt };
    });
  }

  // ---------------------------------------------------------------------------
  // Rechnungen und Zahlungen
  // ---------------------------------------------------------------------------

  async listInvoices(query: ListInvoicesQuery = {}) {
    await this.gate();
    const v = this.viewer();
    let list = this.state.invoices;
    if (v.role === 'customer') list = list.filter((i) => customerCanSeeInvoice(v.customerId ?? '', i));
    else this.require(v, 'invoices.read');
    if (query.status) list = list.filter((i) => i.status === query.status);
    const map = this.map;
    let dtos = list.map((i) => map.invoice(i, v));
    if (query.paymentStatus) dtos = dtos.filter((i) => i.paymentStatus === query.paymentStatus);
    if (query.overdue !== undefined) dtos = dtos.filter((i) => i.overdue === query.overdue);
    if (query.customerId) dtos = dtos.filter((i) => i.customerId === query.customerId);
    return dtos.sort((a, b) => ((a.issuedAt ?? a.id) < (b.issuedAt ?? b.id) ? 1 : -1));
  }

  async createInvoice(input: CreateInvoiceInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'invoices.write');
    if (!this.state.customers.some((c) => c.id === input.customerId)) throw ApiError.unprocessable(API_ERROR_CODES.invalidCustomer, 'Kunde nicht gefunden.');
    const wo = input.workOrderId ? this.state.workOrders.find((w) => w.id === input.workOrderId) : undefined;
    if (input.workOrderId && (!wo || wo.customerId !== input.customerId)) throw ApiError.unprocessable(API_ERROR_CODES.workOrderMismatch, 'Auftrag und Kunde passen nicht zusammen.');
    if (!Number.isInteger(input.totalGrossCents) || input.totalGrossCents <= 0) throw ApiError.validation('Der Rechnungsbetrag muss größer als 0 sein.');
    let documentId: string | null = null;
    if (input.documentFileId) {
      const file = this.state.files.find((f) => f.id === input.documentFileId);
      if (!file) throw ApiError.unprocessable(API_ERROR_CODES.invalidDocument, 'Die Datei wurde nicht gefunden.');
      if (file.mimeType !== 'application/pdf') throw ApiError.unprocessable(API_ERROR_CODES.pdfRequired, 'Die Rechnung muss als PDF hochgeladen werden.');
      documentId = this.createDocumentInternal(v, { kind: 'invoice', title: 'Rechnung', fileId: file.id, customerId: input.customerId, vehicleId: wo?.vehicleId ?? null, workOrderId: input.workOrderId ?? null }).id;
    }
    const inv = { id: uuid(), invoiceNumber: null, workOrderId: input.workOrderId ?? null, customerId: input.customerId, status: 'draft' as const, issuedAt: null, dueDate: input.dueDate ?? null, totalGrossCents: input.totalGrossCents, currency: 'EUR' as const, vatBreakdown: input.vatBreakdown ?? [], documentId, createdAt: this.nowIso(), cancelledAt: null };
    this.state.invoices.push(inv);
    this.audit(v, 'invoice.created', 'invoice', inv.id, { workOrderId: inv.workOrderId, totalGrossCents: inv.totalGrossCents });
    this.changed();
    return this.map.invoice(inv, v);
  }

  async getInvoice(id: string) {
    await this.gate();
    const v = this.viewer();
    return this.map.invoice(this.invoiceFor(v, id), v);
  }

  private doIssueInvoice(v: Viewer | null, id: string, invoiceNumber: string) {
    const inv = this.state.invoices.find((i) => i.id === id);
    if (!inv) throw ApiError.notFound();
    if (inv.status !== 'draft') throw ApiError.conflict(API_ERROR_CODES.notDraft, 'Nur Entwürfe können gestellt werden.');
    const number = invoiceNumber.trim();
    if (!number) throw ApiError.validation('Die Rechnungsnummer ist Pflicht.');
    if (this.state.invoices.some((i) => i.invoiceNumber === number)) throw ApiError.conflict(API_ERROR_CODES.invoiceNumberTaken, 'Diese Rechnungsnummer ist bereits vergeben.');
    const due = new Date(this.clock().getTime() + this.state.settings.paymentTermDays * 86_400_000);
    Object.assign(inv, { status: 'issued', invoiceNumber: number, issuedAt: this.nowIso(), dueDate: inv.dueDate ?? todayLocal(due) });
    if (inv.documentId) {
      // Rechnungs-PDF wird mit dem Stellen für den Kunden bereitgestellt (wie die API)
      const doc = this.state.documents.find((d) => d.id === inv.documentId);
      if (doc) Object.assign(doc, { visibility: 'customer', publishedAt: this.nowIso(), title: `Rechnung ${number}` });
    }
    this.notify(this.customerUserIds(inv.customerId), 'invoice.issued', 'Rechnung bereitgestellt', `Ihre Rechnung ${number} liegt bereit.`, `/kunde/rechnungen/${inv.id}`);
    this.audit(v, 'invoice.issued', 'invoice', id, { workOrderId: inv.workOrderId, invoiceNumber: number, totalGrossCents: inv.totalGrossCents, dueDate: inv.dueDate });
    return inv;
  }

  async issueInvoice(id: string, input: IssueInvoiceInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'invoices.write');
    const inv = this.doIssueInvoice(v, id, input.invoiceNumber);
    this.changed();
    return this.map.invoice(inv, v);
  }

  /** Storno wie in der API: offene Zahlungsversuche werden deaktiviert; Zahlungen bleiben (Überzahlung). */
  async cancelInvoice(id: string, input: { reason?: string | null } = {}) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'invoices.write');
    const inv = this.invoiceFor(v, id);
    if (inv.status === 'cancelled') throw ApiError.conflict(API_ERROR_CODES.alreadyCancelled, 'Die Rechnung ist bereits storniert.');
    Object.assign(inv, { status: 'cancelled', cancelledAt: this.nowIso() });
    for (const c of this.state.checkouts) if (c.invoiceId === id && (c.status === 'pending' || c.status === 'created')) c.status = 'deactivated';
    this.audit(v, 'invoice.cancelled', 'invoice', id, { workOrderId: inv.workOrderId, reason: input.reason ?? null });
    this.changed();
    return this.map.invoice(inv, v);
  }

  async startCheckout(invoiceId: string) {
    await this.gate();
    const v = this.viewer();
    this.requireCustomer(v);
    const inv = this.invoiceFor(v, invoiceId);
    const settings = this.state.settings;
    if (settings.paymentProvider !== 'sumup' || !settings.paymentProviderConfigured) {
      throw ApiError.conflict(API_ERROR_CODES.onlinePaymentUnavailable, 'Online-Zahlung ist derzeit nicht verfügbar. Bitte überweisen Sie den Betrag.');
    }
    const summary = summarizeInvoice(inv, this.state.payments, this.state.refunds, this.today());
    const providerCheckoutId = `demo-chk-${base62(10)}`;
    const { checkout, deactivatedIds, reused } = startCheckout({
      invoice: inv,
      summary,
      existing: this.state.checkouts,
      checkoutId: uuid(),
      providerCheckoutId,
      userId: v.user.id,
      now: this.nowIso(),
      hostedUrl: `${this.publicBase}/demo-anbieter/checkout/${providerCheckoutId}`,
    });
    for (const c of this.state.checkouts) if (deactivatedIds.includes(c.id)) c.status = 'deactivated';
    for (const p of this.state.providerCheckouts) {
      const own = this.state.checkouts.find((c) => c.providerCheckoutId === p.providerCheckoutId);
      if (own && deactivatedIds.includes(own.id) && p.status === 'PENDING') p.status = 'EXPIRED';
    }
    if (!reused) {
      this.state.checkouts.push(checkout);
      this.state.providerCheckouts.push({ providerCheckoutId, checkoutReference: checkout.checkoutReference, merchantCode: DEMO_MERCHANT_CODE, amountCents: checkout.amountCents, currency: 'EUR', status: 'PENDING', transactionId: null });
      this.audit(v, 'checkout.created', 'invoice', invoiceId, { checkoutId: checkout.id, amountCents: checkout.amountCents });
    }
    this.changed();
    // Der Rechnungsstatus bleibt unverändert (R-ZAHL-4).
    return { checkoutId: checkout.id, hostedUrl: checkout.hostedUrl, invoicePaymentStatus: summary.paymentStatus };
  }

  /** Gleicht offene Zahlungsversuche mit dem (simulierten) Anbieter ab. */
  private reconcileInvoice(invoiceId: string, actor: Viewer | null) {
    let booked = 0;
    for (const checkout of this.state.checkouts.filter((c) => c.invoiceId === invoiceId && (c.status === 'pending' || c.status === 'created' || c.status === 'failed'))) {
      const provider = this.state.providerCheckouts.find((p) => p.providerCheckoutId === checkout.providerCheckoutId);
      const result = reconcileCheckout({ checkout, provider, payments: this.state.payments, merchantCode: this.state.settings.sumupMerchantCode ?? '', paymentId: uuid(), now: this.nowIso() });
      this.state.checkouts = this.state.checkouts.map((c) => (c.id === checkout.id ? result.checkout : c));
      if (result.payment) {
        this.state.payments.push(result.payment);
        booked++;
        const inv = this.state.invoices.find((i) => i.id === invoiceId)!;
        this.audit(actor, 'payment.booked', 'invoice', invoiceId, { workOrderId: inv.workOrderId, amountCents: result.payment.amountCents, providerTransactionId: result.payment.providerTransactionId });
        this.notify(this.customerUserIds(inv.customerId), 'payment.confirmed', 'Zahlung bestätigt', `Zahlung für Rechnung ${inv.invoiceNumber} ist eingegangen.`, `/kunde/rechnungen/${inv.id}`);
        this.notify(this.staffUserIds(), 'payment.confirmed', `Zahlung bestätigt: ${inv.invoiceNumber}`, customerName(this.state.customers.find((c) => c.id === inv.customerId)), `/werkstatt/rechnungen/${inv.id}`);
      } else if (result.outcome === 'rejected') {
        this.audit(actor, 'payment.verification_failed', 'invoice', invoiceId, { checkoutId: checkout.id, reason: result.reason });
      }
    }
    return booked;
  }

  async refreshPaymentStatus(invoiceId: string) {
    await this.gate();
    const v = this.viewer();
    const inv = this.invoiceFor(v, invoiceId);
    this.reconcileInvoice(invoiceId, v);
    this.changed();
    return this.map.invoice(inv, v);
  }

  async recordManualPayment(invoiceId: string, input: ManualPaymentInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'payments.recordManual');
    const inv = this.invoiceFor(v, invoiceId);
    validateManualPayment({
      actor: this.actorOf(v),
      invoice: inv,
      summary: summarizeInvoice(inv, this.state.payments, this.state.refunds, this.today()),
      payment: { method: input.method, amountCents: input.amountCents, receivedAt: input.receivedAt, referenceText: input.referenceText },
      now: this.nowIso(),
    });
    const payment = { id: uuid(), invoiceId, method: input.method, amountCents: input.amountCents, currency: 'EUR' as const, provider: null, providerTransactionId: null, checkoutId: null, receivedAt: new Date(input.receivedAt).toISOString(), recordedBy: v.user.id, referenceText: input.referenceText.trim() };
    this.state.payments.push(payment);
    this.audit(v, 'payment.manual_recorded', 'payment', payment.id, { invoiceId, workOrderId: inv.workOrderId, method: input.method, amountCents: input.amountCents, referenceText: payment.referenceText, receivedAt: payment.receivedAt, note: input.note ?? null });
    this.notify(this.customerUserIds(inv.customerId), 'payment.confirmed', 'Zahlung bestätigt', `Zahlung für Rechnung ${inv.invoiceNumber} ist eingegangen.`, `/kunde/rechnungen/${inv.id}`);
    this.changed();
    return this.map.invoice(inv, v);
  }

  async refundPayment(paymentId: string, input: RefundInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'payments.refund');
    const payment = this.state.payments.find((p) => p.id === paymentId);
    if (!payment) throw ApiError.notFound();
    const inv = this.invoiceFor(v, payment.invoiceId);
    if (!input.reason?.trim()) throw ApiError.validation('Bitte einen Grund angeben.');
    const plan = planRefund({ actor: this.actorOf(v), payment, refunds: this.state.refunds, amountCents: input.amountCents, idempotencyKey: input.idempotencyKey });
    if (plan.action === 'create') {
      const refund = { id: uuid(), paymentId, amountCents: input.amountCents, status: 'succeeded' as const, idempotencyKey: input.idempotencyKey, requestedBy: v.user.id, requestedAt: this.nowIso(), completedAt: this.nowIso(), failureReason: null };
      this.state.refunds.push(refund);
      this.audit(v, 'refund.requested', 'refund', refund.id, { invoiceId: inv.id, workOrderId: inv.workOrderId, paymentId, amountCents: input.amountCents, reason: input.reason, method: payment.method });
      this.changed();
    }
    return this.map.invoice(inv, v);
  }

  async exportInvoicesCsv(_query: ListInvoicesQuery = {}) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'reports.export');
    this.require(v, 'invoices.read');
    const map = this.map;
    const list = this.state.invoices.filter((i) => i.status !== 'draft').sort((a, b) => ((a.issuedAt ?? '') < (b.issuedAt ?? '') ? -1 : 1));
    const euro = (c: number) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)},${String(Math.abs(c) % 100).padStart(2, '0')}`;
    const cell = (value: string | number | null | undefined) => {
      if (value === null || value === undefined) return '';
      let s = String(value);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      if (/[;"\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = ['Rechnungsnummer', 'Rechnungsdatum', 'Fällig am', 'Kundennummer', 'Kunde', 'Auftrag', 'Status', 'Zahlungsstatus', 'Überfällig', 'Betrag brutto (EUR)', 'Bezahlt (EUR)', 'Erstattet (EUR)', 'Offen (EUR)'];
    const lines = [header.join(';')];
    for (const i of list) {
      const dto = map.invoice(i, v);
      const c = this.state.customers.find((x) => x.id === i.customerId);
      lines.push(
        [dto.invoiceNumber, dto.issuedAt ? berlinDateOf(dto.issuedAt) : '', dto.dueDate, c?.customerNumber, dto.customerDisplayName, dto.orderNumber ?? '', i.status === 'issued' ? 'gestellt' : 'storniert', paymentStatusLabels[dto.paymentStatus].label, dto.overdue ? 'ja' : 'nein', euro(dto.totalGrossCents), euro(dto.paidCents), euro(dto.refundedCents), euro(dto.openCents)]
          .map(cell)
          .join(';'),
      );
    }
    this.audit(v, 'export.invoices_csv', 'export', null, { rows: list.length });
    this.changed();
    return `﻿${lines.join('\r\n')}\r\n`;
  }

  // ---------------------------------------------------------------------------
  // Benachrichtigungen
  // ---------------------------------------------------------------------------

  async listNotifications(options: { unread?: boolean } = {}) {
    await this.gate();
    const v = this.viewer();
    const map = this.map;
    return this.state.notifications
      .filter((n) => n.userId === v.user.id && (!options.unread || n.readAt === null))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((n) => map.notification(n));
  }

  async readNotification(id: string) {
    await this.gate();
    const v = this.viewer();
    const n = this.state.notifications.find((x) => x.id === id && x.userId === v.user.id);
    if (!n) throw ApiError.notFound();
    n.readAt = this.nowIso();
    this.changed();
  }

  async registerDevice(_input: RegisterDeviceInput) {
    await this.gate();
    this.viewer();
    // Im Demo-Modus werden keine Geräte registriert und keine Push-Nachrichten versendet.
  }

  private defaultPreferences(v: Viewer): NotificationPreference[] {
    const events: NotificationEvent[] =
      v.role === 'customer'
        ? ['approval.requested', 'message.received', 'invoice.issued', 'payment.confirmed', 'appointment.confirmed', 'appointment.proposed', 'work_order.ready_for_pickup', 'maintenance.due_soon']
        : v.role === 'mechanic'
          ? ['approval.decided', 'message.received']
          : ['approval.decided', 'message.received', 'appointment.requested', 'finding.reported', 'payment.confirmed'];
    return events.flatMap((eventType) => (['push', 'email'] as const).map((channel) => ({ eventType, channel, enabled: channel === 'push' || eventType !== 'message.received' })));
  }

  async getNotificationPreferences() {
    await this.gate();
    const v = this.viewer();
    return this.defaultPreferences(v).map((p) => {
      const saved = this.state.notificationPreferences.find((x) => x.userId === v.user.id && x.eventType === p.eventType && x.channel === p.channel);
      return saved ? { ...p, enabled: saved.enabled } : p;
    });
  }

  async setNotificationPreferences(preferences: NotificationPreference[]) {
    await this.gate();
    const v = this.viewer();
    this.state.notificationPreferences = [...this.state.notificationPreferences.filter((p) => p.userId !== v.user.id), ...preferences.map((p) => ({ userId: v.user.id, ...p }))];
    this.changed();
    const map = new Map(preferences.map((p) => [`${p.eventType}:${p.channel}`, p.enabled]));
    return this.defaultPreferences(v).map((p) => ({ ...p, enabled: map.get(`${p.eventType}:${p.channel}`) ?? p.enabled }));
  }

  // ---------------------------------------------------------------------------
  // Einstellungen
  // ---------------------------------------------------------------------------

  async getSettings() {
    await this.gate();
    const v = this.viewer();
    if (!isStaff(v)) throw ApiError.forbidden();
    return this.map.settings();
  }

  async updateSettings(input: Partial<DemoState['settings']>) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'settings.manage');
    // Der Anbieterstatus ("konfiguriert") kommt aus der Serverkonfiguration, nie aus dem Formular
    const { paymentProviderConfigured: _ignored, ...rest } = input;
    Object.assign(this.state.settings, rest);
    this.audit(v, 'settings.updated', 'settings', null, { fields: Object.keys(rest) });
    this.changed();
    return this.map.settings();
  }

  async listMaintenanceTypes() {
    await this.gate();
    const v = this.viewer();
    if (!isStaff(v)) throw ApiError.forbidden();
    return this.state.maintenanceTypes;
  }

  async upsertMaintenanceType(id: string, input: Omit<DemoState['maintenanceTypes'][number], 'id'>) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'settings.manage');
    if (this.state.maintenanceTypes.some((t) => t.id !== id && t.key === input.key)) throw ApiError.conflict(API_ERROR_CODES.keyTaken, 'Dieser Schlüssel ist bereits vergeben.');
    const existing = this.state.maintenanceTypes.find((t) => t.id === id);
    const next = { id, ...input };
    if (existing) Object.assign(existing, next);
    else this.state.maintenanceTypes.push(next);
    this.audit(v, 'settings.maintenance_type_saved', 'maintenance_type', id, { name: input.name });
    this.changed();
    return next;
  }

  async upsertResource(id: string, input: Omit<DemoState['resources'][number], 'id'>) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'settings.manage');
    const existing = this.state.resources.find((r) => r.id === id);
    const next = { id, ...input };
    if (existing) Object.assign(existing, next);
    else this.state.resources.push(next);
    this.audit(v, 'settings.resource_saved', 'resource', id, { name: input.name });
    this.changed();
    return next;
  }

  // ---------------------------------------------------------------------------
  // Öffentlich
  // ---------------------------------------------------------------------------

  async resolveQr(token: string): Promise<QrResolution> {
    await this.gate();
    const v = this.optionalViewer();
    const viewer: QrViewer = !v
      ? { kind: 'anonymous' }
      : v.role === 'customer'
        ? { kind: 'customer', customerId: v.customerId ?? '' }
        : { kind: 'staff', canReadVehicles: can(v, 'vehicles.read'), homePath: '/werkstatt' };
    if (v?.role === 'mechanic' && !can(v, 'vehicles.read')) {
      // QR-Scan eines Mechanikers: zugewiesener aktiver Auftrag des Fahrzeugs (wie die API)
      const vehicle = this.state.vehicles.find((x) => x.qrToken === token && x.archivedAt === null);
      const wo = vehicle ? this.visibleWorkOrders(v).filter((w) => w.vehicleId === vehicle.id && (w.status === 'open' || w.status === 'in_progress')).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] : undefined;
      if (vehicle && wo) return { mode: 'authorized', vehicleId: vehicle.id, targetPath: `/mechaniker/auftraege/${wo.id}` };
    }
    return resolveQr({ token, vehicles: this.state.vehicles, ownerships: this.state.ownerships, entries: this.state.serviceEntries, maintenanceTypes: this.state.maintenanceTypes, viewer, workshopName: this.state.settings.name });
  }

  async publicShare(token: string) {
    await this.gate();
    const { share, view } = openShare({ token, shares: this.state.shares, vehicles: this.state.vehicles, ownerships: this.state.ownerships, entries: this.state.serviceEntries, maintenanceTypes: this.state.maintenanceTypes, now: this.nowIso(), workshopName: this.state.settings.name });
    this.state.shares = this.state.shares.map((s) => (s.id === share.id ? share : s));
    this.audit(null, 'vehicle_share.accessed', 'vehicle_share', share.id);
    this.changed();
    return view;
  }

  async health() {
    await this.gate();
    return { ok: true };
  }

  async listAudit(query: ListAuditQuery = {}) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'audit.read');
    const map = this.map;
    return this.state.audit
      .filter(
        (a) =>
          (!query.entityType || a.entityType === query.entityType) &&
          (!query.entityId || a.entityId === query.entityId) &&
          (!query.actorId || a.actorUserId === query.actorId) &&
          (!query.action || a.action.startsWith(query.action)),
      )
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
      .slice(0, query.limit ?? 200)
      .map((a) => map.audit(a));
  }

  // ---------------------------------------------------------------------------
  // Demo-Steuerung (nur im Demo-Modus sichtbar; kein Teil von WerkstattApi)
  // ---------------------------------------------------------------------------

  readonly controls = {
    subscribe: (listener: () => void) => {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    },
    isFailNext: () => this.failNextFlag,
    isOffline: () => this.offlineFlag,
    setFailNext: (value: boolean) => {
      this.failNextFlag = value;
      this.emit();
    },
    setOffline: (value: boolean) => {
      this.offlineFlag = value;
      this.emit();
    },
    reset: () => {
      this.storage?.clear();
      this.state = createSeed(this.clock());
      this.failNextFlag = false;
      this.offlineFlag = false;
      this.submittedCheckouts.clear();
      this.idempotent.clear();
      this.changed();
    },
    accounts: (): DemoAccount[] => {
      const def: [DemoAccount['key'], string, string, string][] = [
        ['customer', 'Kundin', 'Zwei Fahrzeuge, offene Freigaben und Rechnungen', IDS.users.miriam],
        ['previousOwner', 'Vorbesitzer', 'Hat den Octavia an die Kundin verkauft', IDS.users.guenter],
        ['owner', 'Inhaber', 'Alle Rechte', IDS.users.owner],
        ['service', 'Service', 'Sekretariat und Service, darf Zahlungen manuell zuordnen', IDS.users.service],
        ['service2', 'Service (Aushilfe)', 'Ohne Rechnungsrecht und ohne manuelle Zahlungen', IDS.users.nadine],
        ['mechanic', 'Mechaniker', 'Nur zugewiesene Aufträge', IDS.users.emre],
      ];
      return def.map(([key, label, description, userId]) => {
        const u = this.userById(userId)!;
        return { key, label, description, email: u.email, userId, displayName: u.displayName };
      });
    },
    loginAs: (userId: string): LoginResponse => {
      const user = this.userById(userId);
      if (!user || user.status !== 'active') throw ApiError.notFound();
      user.lastLoginAt = this.nowIso();
      this.changed();
      return this.loginResponse(user);
    },
    notificationsFor: (userId: string | null) => {
      const target = userId ?? IDS.users.miriam;
      const map = this.map;
      return {
        recipient: this.userById(target)?.displayName ?? '',
        items: this.state.notifications
          .filter((n) => n.userId === target)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .slice(0, 12)
          .map((n) => map.notification(n)),
      };
    },
    pendingCheckouts: (): DemoCheckoutInfo[] =>
      this.state.checkouts
        .filter((c) => c.status === 'pending' || c.status === 'created')
        .map((c) => {
          const inv = this.state.invoices.find((i) => i.id === c.invoiceId);
          return {
            checkoutId: c.id,
            invoiceId: c.invoiceId,
            invoiceNumber: inv?.invoiceNumber ?? '',
            customerDisplayName: customerName(this.state.customers.find((x) => x.id === inv?.customerId)),
            amountCents: c.amountCents,
            createdAt: c.createdAt,
            customerSubmitted: this.submittedCheckouts.has(c.id),
          };
        }),
    /** Simulierte Anbieterseite: Kunde schließt ab oder bricht ab. Ändert nichts an der Rechnung. */
    providerPage: (checkoutId: string, action: 'submit' | 'cancel') => {
      const checkout = this.state.checkouts.find((c) => c.id === checkoutId || c.providerCheckoutId === checkoutId);
      if (!checkout) throw ApiError.notFound();
      if (action === 'submit') this.submittedCheckouts.add(checkout.id);
      else {
        const p = this.state.providerCheckouts.find((x) => x.providerCheckoutId === checkout.providerCheckoutId);
        if (p && p.status === 'PENDING') p.status = 'EXPIRED';
      }
      this.changed();
      return checkout;
    },
    checkoutByProviderId: (providerCheckoutId: string): DCheckout | undefined => this.state.checkouts.find((c) => c.providerCheckoutId === providerCheckoutId),
    /** Serverseitige Anbieterbestätigung simulieren (Webhook + Statusabfrage). */
    simulateProvider: (checkoutId: string, outcome: ProviderOutcome): string => {
      const checkout = this.state.checkouts.find((c) => c.id === checkoutId);
      if (!checkout) throw ApiError.notFound();
      const p = this.state.providerCheckouts.find((x) => x.providerCheckoutId === checkout.providerCheckoutId);
      if (!p) throw ApiError.notFound();
      if (outcome === 'paid' || outcome === 'duplicate') Object.assign(p, { status: 'PAID', transactionId: p.transactionId ?? `TX-DEMO-${base62(8)}` });
      if (outcome === 'mismatch') Object.assign(p, { status: 'PAID', transactionId: p.transactionId ?? `TX-DEMO-${base62(8)}`, amountCents: p.amountCents - 1000 });
      if (outcome === 'failed') p.status = 'FAILED';
      if (outcome === 'cancelled') p.status = 'EXPIRED';
      const deliveries = outcome === 'duplicate' ? 2 : 1;
      let booked = 0;
      let duplicates = 0;
      for (let i = 0; i < deliveries; i++) {
        const reg = registerProviderEvent(this.state.providerEvents, { dedupeKey: `sumup:${p.providerCheckoutId}:${p.status}`, eventType: 'CHECKOUT_STATUS_CHANGED', providerObjectId: p.providerCheckoutId }, this.nowIso());
        this.state.providerEvents = reg.events;
        if (reg.duplicate) {
          duplicates++;
          continue;
        }
        booked += this.reconcileInvoice(checkout.invoiceId, null);
      }
      this.changed();
      if (outcome === 'mismatch') return 'Bestätigung mit abweichendem Betrag empfangen. Die Prüfung schlägt fehl, es wird nichts gebucht.';
      if (outcome === 'failed') return 'Anbieter meldet: fehlgeschlagen. Die Rechnung bleibt offen.';
      if (outcome === 'cancelled') return 'Anbieter meldet: abgebrochen. Die Rechnung bleibt offen.';
      if (outcome === 'duplicate') return `Ereignis ${deliveries}-mal empfangen, ${duplicates} Wiederholung erkannt. Gebuchte Zahlungen: ${booked}.`;
      return booked > 0 ? 'Zahlung vom Anbieter bestätigt und nach Prüfung gebucht.' : 'Bestätigung empfangen, es wurde nichts gebucht.';
    },
    openAppointmentRequests: () =>
      this.state.appointments
        .filter((a) => a.status === 'requested')
        .map((a) => ({ id: a.id, label: `${customerName(this.state.customers.find((c) => c.id === a.customerId))}, ${vehicleLabel(this.state.vehicles.find((x) => x.id === a.vehicleId))}`, startsAt: a.startsAt })),
    workshopConfirmAppointment: (id: string): string => {
      const service = this.viewerFor(this.userById(IDS.users.service)!);
      const a = appointmentRules.confirm(this.appointmentFor(service, id), this.nowIso());
      this.replaceAppointment(a);
      this.notify(this.customerUserIds(a.customerId), 'appointment.confirmed', 'Termin bestätigt', vehicleLabel(this.state.vehicles.find((x) => x.id === a.vehicleId)), `/kunde/termine/${a.id}`);
      this.audit(service, 'appointment.confirmed', 'appointment', id);
      this.changed();
      return 'Die Werkstatt hat den Termin bestätigt.';
    },
    workshopProposeAlternative: (id: string): string => {
      const service = this.viewerFor(this.userById(IDS.users.service)!);
      const current = this.appointmentFor(service, id);
      const start = new Date(Date.parse(current.startsAt) + 2 * 86_400_000);
      start.setHours(8, 0, 0, 0);
      const end = new Date(start.getTime() + (Date.parse(current.endsAt) - Date.parse(current.startsAt)));
      const a = appointmentRules.proposeAlternative(current, { id: uuid(), startsAt: start.toISOString(), endsAt: end.toISOString() }, this.nowIso());
      this.replaceAppointment(a);
      this.notify(this.customerUserIds(a.customerId), 'appointment.proposed', 'Terminvorschlag der Werkstatt', 'Die Werkstatt schlägt einen anderen Termin vor.', `/kunde/termine/${a.id}`);
      this.audit(service, 'appointment.proposed', 'appointment', id);
      this.changed();
      return 'Die Werkstatt hat eine Alternative vorgeschlagen.';
    },
    pendingApprovals: () =>
      this.state.approvals
        .filter((r) => r.status === 'pending_customer')
        .map((r) => {
          const wo = this.state.workOrders.find((w) => w.id === r.workOrderId)!;
          return { id: r.id, workOrderId: r.workOrderId, label: `${wo.orderNumber}: ${r.title}`, versionNo: approvalRules.currentVersion(r).versionNo };
        }),
    /** Werkstatt ändert eine offene Anfrage (Preis +5 %) und erzeugt damit eine neue Version. */
    workshopReviseApproval: (requestId: string): string => {
      const service = this.viewerFor(this.userById(IDS.users.service)!);
      const r = this.approvalFor(service, requestId);
      const current = approvalRules.currentVersion(r);
      const lines = current.lines.map((l, index) => (index === 0 ? { ...l, unitPriceCents: Math.round(l.unitPriceCents * 1.05) } : l));
      this.doRevise(service, requestId, {
        kind: r.kind,
        title: r.title,
        summaryCustomer: `${current.summaryCustomer} Aktualisiert: Der Teilepreis hat sich beim Lieferanten erhöht.`,
        lines,
        scheduleChange: current.scheduleChange,
        newReadyAt: current.newReadyAt,
        photoIds: current.photoIds,
        documentVersionId: current.documentVersionId,
      });
      return `Neue Version ${current.versionNo + 1} erzeugt. Eine Entscheidung zur alten Version gilt nicht mehr.`;
    },
    activeWorkOrders: () =>
      this.state.workOrders
        .filter((w) => ['open', 'in_progress', 'work_completed'].includes(w.status))
        .map((w) => ({ id: w.id, label: `${w.orderNumber}: ${w.title}`, customer: customerName(this.state.customers.find((c) => c.id === w.customerId)) })),
    workshopReply: (workOrderId: string): string => {
      const service = this.userById(IDS.users.service)!;
      const wo = this.state.workOrders.find((w) => w.id === workOrderId);
      if (!wo) throw ApiError.notFound();
      this.state.messages.push({ id: uuid(), workOrderId, authorUserId: service.id, body: 'Danke für Ihre Nachricht. Wir melden uns in Kürze bei Ihnen.', photoIds: [], clientMessageId: null, createdAt: this.nowIso() });
      this.notify(this.customerUserIds(wo.customerId), 'message.received', `Neue Nachricht zu ${wo.orderNumber}`, `${this.state.settings.name} hat Ihnen geschrieben.`, `/kunde/auftraege/${wo.id}/chat`);
      this.changed();
      return 'Die Werkstatt hat im Chat geantwortet.';
    },
    /**
     * Werkstatt schließt einen Auftrag ab: offene vereinbarte/freigegebene Positionen werden
     * erledigt, der fachliche Abschluss erzeugt die Serviceeinträge, das Fahrzeug wird
     * abholbereit gemeldet und die Rechnung gestellt. Abgelehnte Positionen bleiben außen vor.
     */
    workshopCompleteOrder: (workOrderId: string): string => {
      const service = this.viewerFor(this.userById(IDS.users.service)!);
      const wo = this.workOrderFor(service, workOrderId);
      if (wo.status === 'completed' || wo.status === 'picked_up') return 'Der Auftrag ist bereits fachlich abgeschlossen. Es entstehen keine weiteren Serviceeinträge.';
      const items = this.state.workItems.filter((i) => i.workOrderId === workOrderId);
      if (items.some((i) => i.authorization === 'pending_approval')) return 'Es gibt noch offene Freigabeanfragen. Zuerst muss der Kunde entscheiden.';
      const km = this.state.odometer.filter((r) => r.vehicleId === wo.vehicleId).sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))[0]?.valueKm ?? null;
      const mechanic = wo.assigneeIds[0] ?? IDS.users.emre;
      this.state.workItems = this.state.workItems.map((i) =>
        i.workOrderId === workOrderId && itemIsExecutable(i) && i.executionStatus !== 'done' && i.executionStatus !== 'not_done'
          ? { ...i, executionStatus: 'done', doneAt: this.nowIso(), doneBy: mechanic, doneOdometerKm: i.maintenanceTypeId ? km : null, runningSince: null, assignedTo: i.assignedTo ?? mechanic }
          : i,
      );
      this.replaceWorkOrder({ ...wo, status: wo.status === 'open' ? 'in_progress' : wo.status });
      this.refreshWorkStatus(workOrderId);
      const reviewed = this.doCompleteReview(service, workOrderId, km);
      this.replaceWorkOrder({ ...reviewed, readyForPickupAt: this.nowIso() });
      this.notify(this.customerUserIds(wo.customerId), 'work_order.ready_for_pickup', 'Fahrzeug abholbereit', 'Ihr Fahrzeug ist abholbereit.', `/kunde/auftraege/${wo.id}`);
      const done = this.state.workItems.filter((i) => i.workOrderId === workOrderId && i.executionStatus === 'done' && itemIsExecutable(i));
      const totals = approvalRules.computeTotals(done.map((i) => ({ title: i.title, description: null, quantity: i.quantity, unit: i.unit, unitPriceCents: i.unitPriceCents ?? 0, vatRateBp: i.vatRateBp, maintenanceTypeId: null })));
      const inv = { id: uuid(), invoiceNumber: null, workOrderId, customerId: wo.customerId, status: 'draft' as const, issuedAt: null, dueDate: null, totalGrossCents: totals.grossCents, currency: 'EUR' as const, vatBreakdown: [{ vatRateBp: 1900, netCents: totals.netCents, vatCents: totals.grossCents - totals.netCents }], documentId: null, createdAt: this.nowIso(), cancelledAt: null };
      this.state.invoices.push(inv);
      const number = `R-${this.clock().getFullYear()}-${String(++this.state.counters.invoice).padStart(4, '0')}`;
      this.doIssueInvoice(service, inv.id, number);
      const entries = this.state.serviceEntries.filter((e) => e.workOrderId === workOrderId).length;
      this.changed();
      return `Auftrag abgeschlossen: ${entries} ${entries === 1 ? 'Serviceeintrag' : 'Serviceeinträge'} erzeugt, abholbereit gemeldet, Rechnung ${number} gestellt.`;
    },
    customerEmail: () => DEMO_EMAILS.customer,
    paymentMethodLabel: (m: keyof typeof paymentMethodLabels) => paymentMethodLabels[m],
  };
}

export type DemoControls = DemoApi['controls'];
