/**
 * DemoApi: In-Memory-Implementierung von WerkstattApi für den klickbaren Entwurf.
 *
 * - Enthält nur BEISPIELDATEN (seed.ts). Keine Netzwerkaufrufe, keine echten Zahlungen,
 *   keine echten Nachrichten.
 * - Rechte und Geschäftsregeln werden hier wie auf einem Server geprüft (rules/*), damit der
 *   Entwurf die Regeln sichtbar macht. Verbindlich bleibt die spätere API (apps/api) mit
 *   @werkstatt/domain.
 * - Zustand optional im sessionStorage (Web), damit ein Neuladen nichts verliert.
 */
import {
  AppointmentRequestInputSchema,
  CustomerInputSchema,
  PasswordSchema,
  SendMessageRequestSchema,
  VehicleInputSchema,
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
import { DEMO_SCHEMA_VERSION, type DAppointment, type DCheckout, type DemoState, type DUser, type DWorkItem, type DWorkOrder } from './model';
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
import { reconcileCheckout, registerProviderEvent, startCheckout, summarizeInvoice, validateManualPayment } from './rules/payments';
import { effectivePermissions, isAssignable } from './rules/permissions';
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
  key: 'owner' | 'service' | 'mechanic' | 'customer' | 'previousOwner';
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

export class DemoApi implements WerkstattApi {
  readonly mode = 'demo' as const;
  private state: DemoState;
  private token: string | null = null;
  private listeners = new Set<() => void>();
  private failNextFlag = false;
  private offlineFlag = false;
  private submittedCheckouts = new Set<string>();
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

  private approvalFor(v: Viewer, id: string) {
    const r = this.state.approvals.find((x) => x.id === id);
    if (!r) throw ApiError.notFound();
    this.workOrderFor(v, r.workOrderId);
    if (v.role === 'customer' && r.status === 'draft') throw ApiError.notFound();
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
    if (wo) this.replaceWorkOrder(recomputeWorkStatus(wo, this.state.workItems, this.nowIso()));
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

  private consumeToken(token: string, purposes: string[]) {
    const entry = this.state.tokens.find((t) => t.tokenHash === tokenHash(token) && purposes.includes(t.purpose));
    if (!entry) throw new ApiError(404, ERROR_CODES.tokenInvalid, 'Dieser Link ist ungültig.');
    if (entry.usedAt) throw new ApiError(410, ERROR_CODES.tokenUsed, 'Dieser Link wurde bereits verwendet.');
    if (Date.parse(entry.expiresAt) <= this.clock().getTime()) throw new ApiError(410, ERROR_CODES.tokenExpired, 'Dieser Link ist abgelaufen.');
    return entry;
  }

  async acceptInvitation(input: AcceptInvitationInput): Promise<LoginResponse> {
    await this.gate();
    const entry = this.consumeToken(input.token, ['staff', 'customer']);
    const pw = PasswordSchema.safeParse(input.password);
    if (!pw.success) throw ApiError.validation('Das Passwort muss mindestens 10 Zeichen haben.');
    const user = this.userById(entry.userId);
    if (!user || user.status === 'disabled') throw new ApiError(404, ERROR_CODES.tokenInvalid, 'Dieser Link ist ungültig.');
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
    const entry = this.consumeToken(input.token, ['password_reset']);
    const pw = PasswordSchema.safeParse(input.password);
    if (!pw.success) throw ApiError.validation('Das Passwort muss mindestens 10 Zeichen haben.');
    const user = this.userById(entry.userId);
    if (!user) throw new ApiError(404, ERROR_CODES.tokenInvalid, 'Dieser Link ist ungültig.');
    user.passwordHash = pwHash(input.password);
    entry.usedAt = this.nowIso();
    this.audit(null, 'auth.password_reset', 'user', user.id);
    this.changed();
  }

  async changePassword(input: ChangePasswordInput): Promise<void> {
    await this.gate();
    const v = this.viewer();
    if (v.user.passwordHash !== pwHash(input.currentPassword)) throw ApiError.validation('Das aktuelle Passwort ist nicht korrekt.');
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
    return this.state.users.filter((u) => u.role !== 'customer').map((u) => this.map.staffUser(u));
  }

  async inviteUser(input: InviteStaffInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'users.manage');
    if (this.state.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
      throw ApiError.conflict(ERROR_CODES.conflict, 'Für diese E-Mail-Adresse gibt es bereits einen Zugang.');
    }
    const user: DUser = { id: uuid(), email: input.email.trim(), displayName: input.displayName.trim(), role: input.role, status: 'invited', passwordHash: null, permissionOverrides: [], lastLoginAt: null, createdAt: this.nowIso() };
    this.state.users.push(user);
    this.state.tokens.push({ tokenHash: tokenHash(base62(24)), userId: user.id, purpose: 'staff', expiresAt: new Date(this.clock().getTime() + 7 * 86_400_000).toISOString(), usedAt: null });
    this.audit(v, 'user.invited', 'user', user.id, { role: user.role });
    this.changed();
    return this.map.staffUser(user);
  }

  async getUser(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'users.manage');
    const u = this.state.users.find((x) => x.id === id && x.role !== 'customer');
    if (!u) throw ApiError.notFound();
    return this.map.staffUser(u);
  }

  private activeAdmins() {
    return this.state.users.filter((u) => u.role === 'admin' && u.status === 'active');
  }

  async updateUser(id: string, input: UpdateStaffInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'users.manage');
    const u = this.state.users.find((x) => x.id === id && x.role !== 'customer');
    if (!u) throw ApiError.notFound();
    if (input.role && input.role !== 'admin' && u.role === 'admin' && this.activeAdmins().length <= 1) {
      throw ApiError.conflict(ERROR_CODES.conflict, 'Der letzte aktive Inhaber-Zugang kann seine Rolle nicht verlieren.');
    }
    const role = input.role ?? u.role;
    const overrides = input.permissionOverrides ?? u.permissionOverrides;
    for (const o of overrides) {
      if (!isAssignable(role, o.permission)) throw ApiError.validation(`Das Recht "${o.permission}" ist für diese Rolle nicht zuweisbar.`);
    }
    Object.assign(u, { role, displayName: input.displayName?.trim() ?? u.displayName, permissionOverrides: overrides });
    this.audit(v, 'user.updated', 'user', u.id, { role, overrides });
    this.changed();
    return this.map.staffUser(u);
  }

  async disableUser(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'users.manage');
    const u = this.state.users.find((x) => x.id === id && x.role !== 'customer');
    if (!u) throw ApiError.notFound();
    if (u.role === 'admin' && u.status === 'active' && this.activeAdmins().length <= 1) {
      throw ApiError.conflict(ERROR_CODES.conflict, 'Der letzte aktive Inhaber-Zugang kann nicht deaktiviert werden.');
    }
    u.status = 'disabled';
    this.audit(v, 'user.disabled', 'user', u.id);
    this.changed();
  }

  async enableUser(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'users.manage');
    const u = this.state.users.find((x) => x.id === id && x.role !== 'customer');
    if (!u) throw ApiError.notFound();
    u.status = u.passwordHash ? 'active' : 'invited';
    this.audit(v, 'user.enabled', 'user', u.id);
    this.changed();
  }

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  async dashboard(): Promise<DashboardTile[]> {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'dashboard.view');
    const today = this.today();
    const isToday = (iso: string) => todayLocal(new Date(iso)) === today;
    if (v.role === 'mechanic') {
      const mine = this.visibleWorkOrders(v).filter((w) => w.status === 'open' || w.status === 'in_progress');
      const items = this.state.workItems.filter((i) => i.assignedTo === v.user.id && mine.some((w) => w.id === i.workOrderId) && i.executionStatus !== 'done' && i.executionStatus !== 'not_done');
      return [
        { key: 'my_assigned_items', label: 'Meine offenen Positionen', count: items.length, targetPath: '/mechaniker' },
        { key: 'appointments_today', label: 'Meine Termine heute', count: this.state.appointments.filter((a) => a.assigneeIds.includes(v.user.id) && a.status === 'confirmed' && isToday(a.startsAt)).length, targetPath: '/mechaniker' },
      ];
    }
    const orders = this.state.workOrders;
    const map = this.map;
    const summaries = orders.map((w) => map.workOrderSummary(w, v));
    const tiles: DashboardTile[] = [
      { key: 'appointments_today', label: 'Termine heute', count: this.state.appointments.filter((a) => a.status === 'confirmed' && isToday(a.startsAt)).length, targetPath: '/werkstatt/kalender?tag=heute' },
      { key: 'appointment_requests', label: 'Offene Terminanfragen', count: this.state.appointments.filter((a) => a.status === 'requested').length, targetPath: '/werkstatt/kalender/anfragen' },
      { key: 'open_work_orders', label: 'Offene Aufträge', count: orders.filter((w) => ['open', 'in_progress', 'work_completed'].includes(w.status)).length, targetPath: '/werkstatt/auftraege?arbeit=offen' },
      { key: 'pending_approvals', label: 'Ausstehende Kundenfreigaben', count: summaries.reduce((s, w) => s + w.status.pendingApprovalCount, 0), targetPath: '/werkstatt/auftraege?freigabe=pending' },
      { key: 'unread_messages', label: 'Ungelesene Nachrichten', count: summaries.reduce((s, w) => s + w.unreadMessages, 0), targetPath: '/werkstatt/nachrichten' },
      { key: 'ready_for_pickup', label: 'Abholbereit', count: summaries.filter((w) => w.status.readyForPickup).length, targetPath: '/werkstatt/auftraege?abholbereit=ja' },
      { key: 'maintenance_due', label: 'Fällige Wartungen', count: this.allDue().filter((d) => d.state === 'overdue' || d.state === 'due_soon').length, targetPath: '/werkstatt/wartungen' },
    ];
    if (can(v, 'invoices.read')) {
      const open = this.state.invoices.filter((i) => i.status === 'issued' && summarizeInvoice(i, this.state.payments, this.state.refunds, today).openCents > 0);
      tiles.push({ key: 'open_invoices', label: 'Offene Rechnungen', count: open.length, targetPath: '/werkstatt/rechnungen?status=offen' });
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
      items = items.filter((c) => {
        const plates = this.state.ownerships
          .filter((o) => o.customerId === c.id && o.endedAt === null)
          .map((o) => this.state.vehicles.find((x) => x.id === o.vehicleId)?.licensePlate.toLowerCase().replace(/[\s-]/g, '') ?? '');
        return [c.displayName, c.email ?? '', c.phone ?? '', c.customerNumber].some((f) => f.toLowerCase().includes(q)) || plates.some((p) => p.includes(q.replace(/[\s-]/g, '')));
      });
    }
    if (query.access === 'yes') items = items.filter((c) => c.accessStatus === 'active');
    if (query.access === 'no') items = items.filter((c) => c.accessStatus !== 'active');
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
    const merged = { ...c, ...input };
    const parsed = CustomerInputSchema.safeParse({ ...merged, country: merged.country ?? 'DE' });
    if (!parsed.success) throw ApiError.validation(parsed.error.issues[0]?.message ?? 'Eingaben prüfen', parsed.error.issues);
    Object.assign(c, parsed.data, { isTestData: c.isTestData });
    this.audit(v, 'customer.updated', 'customer', c.id);
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
  }

  async inviteCustomer(id: string, input: { email: string }) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'customerAccounts.manage');
    const c = this.state.customers.find((x) => x.id === id);
    if (!c) throw ApiError.notFound();
    let account = this.state.customerAccounts.find((a) => a.customerId === id);
    if (account && this.userById(account.userId)?.status === 'active') {
      throw ApiError.conflict(ERROR_CODES.conflict, 'Dieser Kunde hat bereits einen aktiven Zugang.');
    }
    if (!account) {
      const user: DUser = { id: uuid(), email: input.email.trim(), displayName: customerName(c), role: 'customer', status: 'invited', passwordHash: null, permissionOverrides: [], lastLoginAt: null, createdAt: this.nowIso() };
      this.state.users.push(user);
      account = { customerId: id, userId: user.id };
      this.state.customerAccounts.push(account);
    }
    this.state.tokens.push({ tokenHash: tokenHash(base62(24)), userId: account.userId, purpose: 'customer', expiresAt: new Date(this.clock().getTime() + 7 * 86_400_000).toISOString(), usedAt: null });
    this.audit(v, 'customer.invited', 'customer', id);
    this.changed();
  }

  async disableCustomerAccount(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'customerAccounts.manage');
    const account = this.state.customerAccounts.find((a) => a.customerId === id);
    const user = account ? this.userById(account.userId) : undefined;
    if (!user) throw ApiError.notFound();
    user.status = 'disabled';
    this.audit(v, 'customer.account_disabled', 'customer', id);
    this.changed();
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
    if (q) vehicles = vehicles.filter((x) => [x.licensePlate, x.vin ?? '', x.make, x.model].some((f) => f.toLowerCase().replace(/[\s-]/g, '').includes(q)));
    const map = this.map;
    return { items: vehicles.map((x) => map.vehicleSummary(x, v)), nextCursor: null };
  }

  async createVehicle(input: VehicleInputData) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'vehicles.write');
    const parsed = VehicleInputSchema.safeParse(input);
    if (!parsed.success) throw ApiError.validation(parsed.error.issues[0]?.message ?? 'Eingaben prüfen', parsed.error.issues);
    const d = parsed.data;
    if (!this.state.customers.some((c) => c.id === d.ownerCustomerId)) throw ApiError.validation('Halter nicht gefunden.');
    if (d.vin && this.state.vehicles.some((x) => x.vin === d.vin)) throw ApiError.conflict(ERROR_CODES.conflict, 'Ein Fahrzeug mit dieser FIN ist bereits angelegt.');
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
    this.audit(v, 'vehicle.created', 'vehicle', vehicle.id);
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
    Object.assign(vehicle, Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)));
    this.audit(v, 'vehicle.updated', 'vehicle', id);
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

  async addOdometer(vehicleId: string, input: OdometerInput) {
    await this.gate();
    const v = this.viewer();
    if (v.role === 'customer') this.vehicleFor(v, vehicleId);
    else this.require(v, 'vehicles.write');
    const last = this.state.odometer.filter((r) => r.vehicleId === vehicleId).sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))[0];
    const reading = {
      id: uuid(),
      vehicleId,
      valueKm: input.valueKm,
      recordedAt: input.recordedAt ?? this.nowIso(),
      source: v.role === 'customer' ? ('customer' as const) : ('staff' as const),
      workOrderId: null,
      plausibility: last && input.valueKm < last.valueKm ? ('lower_than_previous' as const) : ('ok' as const),
    };
    this.state.odometer.push(reading);
    this.audit(v, 'vehicle.odometer_added', 'vehicle', vehicleId, { valueKm: input.valueKm });
    this.changed();
    return this.map.odometer(reading);
  }

  async listOwnerships(vehicleId: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'vehicles.read');
    const map = this.map;
    return this.state.ownerships.filter((o) => o.vehicleId === vehicleId).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).map((o) => map.ownership(o));
  }

  async transferOwnership(vehicleId: string, input: OwnershipTransferInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'vehicles.transferOwnership');
    const current = this.state.ownerships.find((o) => o.vehicleId === vehicleId && o.endedAt === null);
    if (!current) throw ApiError.notFound();
    if (current.customerId === input.newCustomerId) throw ApiError.validation('Der neue Halter ist bereits eingetragen.');
    if (!this.state.customers.some((c) => c.id === input.newCustomerId)) throw ApiError.validation('Kunde nicht gefunden.');
    current.endedAt = input.effectiveAt;
    this.state.ownerships.push({ id: uuid(), vehicleId, customerId: input.newCustomerId, startedAt: input.effectiveAt, endedAt: null, note: input.note ?? null });
    // Freigaben des bisherigen Halters enden mit dem Halterwechsel.
    for (const share of this.state.shares) if (share.vehicleId === vehicleId && !share.revokedAt) share.revokedAt = this.nowIso();
    const vehicle = this.state.vehicles.find((x) => x.id === vehicleId);
    if (vehicle) vehicle.qrPublicViewEnabled = false;
    this.audit(v, 'vehicle.ownership_transferred', 'vehicle', vehicleId, { from: current.customerId, to: input.newCustomerId });
    this.changed();
  }

  async setQrPublicView(vehicleId: string, enabled: boolean) {
    await this.gate();
    const v = this.viewer();
    const customerId = this.requireCustomer(v);
    const vehicle = this.vehicleFor(v, vehicleId);
    if (currentOwnerId(this.state.ownerships, vehicleId) !== customerId) throw ApiError.notFound();
    vehicle.qrPublicViewEnabled = enabled;
    this.audit(v, enabled ? 'vehicle.qr_public_enabled' : 'vehicle.qr_public_disabled', 'vehicle', vehicleId);
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
    const { previous, revision } = correctEntry(entry, { ...input, void: input.void ?? false }, { newId: uuid(), userId: v.user.id, now: this.nowIso() });
    this.state.serviceEntries = this.state.serviceEntries.map((e) => (e.id === id ? previous : e));
    this.state.serviceEntries.push(revision);
    this.audit(v, 'service_entry.corrected', 'service_entry', revision.id, { previous: id, reason: input.reason });
    this.changed();
    return this.map.serviceEntry(revision, v);
  }

  private dueFor(vehicleId: string): MaintenanceDue[] {
    return computeMaintenanceDue(this.state.serviceEntries, this.state.odometer, vehicleId, this.today());
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

  async maintenanceDueAll() {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'vehicles.read');
    return this.allDue();
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

  private conflictsFor(input: AppointmentInput, ignoreId?: string): SchedulingConflict[] {
    const conflicts: SchedulingConflict[] = [];
    const overlaps = (a: DAppointment) => a.id !== ignoreId && ['confirmed', 'requested', 'proposed'].includes(a.status) && a.startsAt < input.endsAt && a.endsAt > input.startsAt;
    for (const a of this.state.appointments.filter(overlaps)) {
      if (input.resourceId && a.resourceId === input.resourceId) {
        conflicts.push({ kind: 'resource_double_booked', message: `${this.state.resources.find((r) => r.id === a.resourceId)?.name ?? 'Arbeitsplatz'} ist bereits belegt (${customerName(this.state.customers.find((c) => c.id === a.customerId))}).`, relatedAppointmentId: a.id });
      }
      const shared = (input.assigneeIds ?? []).filter((id) => a.assigneeIds.includes(id));
      for (const id of shared) conflicts.push({ kind: 'assignee_double_booked', message: `${this.userById(id)?.displayName ?? 'Mitarbeiter'} ist zu dieser Zeit schon eingeplant.`, relatedAppointmentId: a.id });
    }
    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    const weekday = ((start.getDay() + 6) % 7) + 1;
    const hours = this.state.settings.openingHours.find((h) => h.weekday === weekday);
    const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (!hours || hhmm(start) < hours.opens || hhmm(end) > hours.closes) {
      conflicts.push({ kind: 'outside_opening_hours', message: 'Der Termin liegt außerhalb der Öffnungszeiten.', relatedAppointmentId: null });
    }
    return conflicts;
  }

  async createAppointment(input: AppointmentInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'appointments.write');
    if (currentOwnerId(this.state.ownerships, input.vehicleId) !== input.customerId) throw ApiError.validation('Das Fahrzeug gehört nicht zu diesem Kunden.');
    const conflicts = this.conflictsFor(input);
    if (conflicts.length > 0 && !input.overrideConflictsReason?.trim()) {
      throw ApiError.conflict(ERROR_CODES.conflict, 'Der Termin hat Konflikte. Speichern nur mit Begründung.', conflicts);
    }
    const a: DAppointment = {
      id: uuid(),
      kind: input.kind,
      status: 'confirmed',
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      workOrderId: input.workOrderId ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      resourceId: input.resourceId ?? null,
      assigneeIds: input.assigneeIds ?? [],
      requestedBy: 'staff',
      customerNote: input.customerNote ?? null,
      internalNote: [input.internalNote, input.overrideConflictsReason ? `Konflikt bewusst übergangen: ${input.overrideConflictsReason}` : null].filter(Boolean).join('\n') || null,
      proposals: [],
      confirmedAt: this.nowIso(),
      cancelledAt: null,
      cancelReason: null,
      createdAt: this.nowIso(),
    };
    this.state.appointments.push(a);
    this.notify(this.customerUserIds(a.customerId), 'appointment.confirmed', 'Termin bestätigt', `${vehicleLabel(this.state.vehicles.find((x) => x.id === a.vehicleId))}`, `/kunde/termine/${a.id}`);
    this.audit(v, 'appointment.created', 'appointment', a.id);
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

  async checkConflicts(input: AppointmentInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'appointments.read');
    return this.conflictsFor(input);
  }

  private replaceAppointment(a: DAppointment) {
    this.state.appointments = this.state.appointments.map((x) => (x.id === a.id ? a : x));
  }

  async confirmAppointment(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'appointments.write');
    const a = appointmentRules.confirm(this.appointmentFor(v, id), this.nowIso());
    this.replaceAppointment(a);
    this.notify(this.customerUserIds(a.customerId), 'appointment.confirmed', 'Termin bestätigt', vehicleLabel(this.state.vehicles.find((x) => x.id === a.vehicleId)), `/kunde/termine/${a.id}`);
    this.audit(v, 'appointment.confirmed', 'appointment', id);
    this.changed();
    return this.map.appointment(a, v);
  }

  async proposeAlternative(id: string, input: ProposeAlternativeInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'appointments.write');
    const a = appointmentRules.proposeAlternative(this.appointmentFor(v, id), { id: uuid(), startsAt: input.startsAt, endsAt: input.endsAt }, this.nowIso());
    this.replaceAppointment(a);
    this.notify(this.customerUserIds(a.customerId), 'appointment.proposed', 'Terminvorschlag der Werkstatt', input.message ?? 'Die Werkstatt schlägt einen anderen Termin vor.', `/kunde/termine/${a.id}`);
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

  async declineProposal(appointmentId: string, proposalId: string) {
    await this.gate();
    const v = this.viewer();
    this.requireCustomer(v);
    const a = appointmentRules.declineProposal(this.appointmentFor(v, appointmentId), proposalId, this.nowIso());
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
    if (query.work) list = list.filter((w) => w.status.work === query.work);
    if (query.approval) list = list.filter((w) => w.status.approval === query.approval);
    if (query.payment) list = list.filter((w) => w.status.payment === query.payment);
    if (query.assigneeId) list = list.filter((w) => w.assignees.some((a) => a.userId === query.assigneeId));
    if (query.readyForPickup !== undefined) list = list.filter((w) => w.status.readyForPickup === query.readyForPickup);
    if (query.customerId) list = list.filter((w) => w.customerId === query.customerId);
    if (query.vehicleId) list = list.filter((w) => w.vehicleId === query.vehicleId);
    return { items: list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)), nextCursor: null };
  }

  async createWorkOrder(input: CreateWorkOrderInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    if (currentOwnerId(this.state.ownerships, input.vehicleId) !== input.customerId) throw ApiError.validation('Das Fahrzeug gehört nicht zu diesem Kunden.');
    const year = this.clock().getFullYear();
    const wo: DWorkOrder = {
      id: uuid(),
      orderNumber: `A-${year}-${String(++this.state.counters.workOrder).padStart(4, '0')}`,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      status: 'open',
      title: input.title.trim(),
      descriptionCustomer: input.descriptionCustomer ?? null,
      notesInternal: input.notesInternal ?? null,
      costLimitCents: input.costLimitCents ?? null,
      plannedStart: input.plannedStart ?? null,
      plannedEnd: input.plannedEnd ?? null,
      readyForPickupAt: null,
      pickedUpAt: null,
      completionReviewedAt: null,
      completionReviewedBy: null,
      cancelledAt: null,
      cancelReason: null,
      assigneeIds: input.assigneeIds ?? [],
      createdAt: this.nowIso(),
      updatedAt: this.nowIso(),
    };
    this.state.workOrders.push(wo);
    (input.items ?? []).forEach((it, index) => this.state.workItems.push(this.newItem(wo.id, index + 1, it, 'agreed', 'intake')));
    this.audit(v, 'work_order.created', 'work_order', wo.id);
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
    const { assigneeIds, ...rest } = input;
    const next: DWorkOrder = { ...wo, ...Object.fromEntries(Object.entries(rest).filter(([, x]) => x !== undefined)), ...(assigneeIds ? { assigneeIds } : {}), updatedAt: this.nowIso() };
    this.replaceWorkOrder(next);
    this.audit(v, 'work_order.updated', 'work_order', id);
    this.changed();
    return this.map.workOrderDetail(next, v);
  }

  async transitionWorkOrder(id: string, input: WorkOrderTransitionInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    const wo = this.workOrderFor(v, id);
    const allowed: Record<string, string[]> = { draft: ['open', 'cancelled'], open: ['in_progress', 'cancelled'], in_progress: ['open', 'cancelled'], work_completed: ['in_progress', 'cancelled'] };
    if (!allowed[wo.status]?.includes(input.to)) throw ApiError.conflict(ERROR_CODES.conflict, 'Dieser Statuswechsel ist nicht möglich.');
    const next: DWorkOrder = { ...wo, status: input.to, updatedAt: this.nowIso(), ...(input.to === 'cancelled' ? { cancelledAt: this.nowIso(), cancelReason: input.reason ?? null } : {}) };
    this.replaceWorkOrder(next);
    this.audit(v, 'work_order.transition', 'work_order', id, { to: input.to });
    this.changed();
    return this.map.workOrderDetail(next, v);
  }

  async completeReview(id: string, input: CompleteReviewInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.completeReview');
    return this.map.workOrderDetail(this.doCompleteReview(v, id, input.odometerKm ?? null), v);
  }

  private doCompleteReview(v: Viewer, id: string, odometerKm: number | null): DWorkOrder {
    const wo = this.workOrderFor(v, id);
    const { workOrder, entries } = completeReview({
      workOrder: wo,
      items: this.state.workItems,
      existingEntries: this.state.serviceEntries,
      maintenanceTypes: this.state.maintenanceTypes,
      workshopName: this.state.settings.name,
      reviewerId: v.user.id,
      now: this.nowIso(),
      odometerKm,
      newId: uuid,
    });
    this.replaceWorkOrder(workOrder);
    this.state.serviceEntries.push(...entries);
    this.audit(v, 'work_order.completion_reviewed', 'work_order', id, { serviceEntries: entries.map((e) => e.id) });
    for (const e of entries) this.audit(v, 'service_entry.created', 'service_entry', e.id, { workOrderId: id, workItemId: e.workItemId });
    this.changed();
    return workOrder;
  }

  async readyForPickup(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    const wo = this.workOrderFor(v, id);
    if (!['work_completed', 'completed'].includes(wo.status)) throw ApiError.conflict(ERROR_CODES.conflict, 'Erst wenn die Arbeiten erledigt sind, kann das Fahrzeug abholbereit gemeldet werden.');
    const next = { ...wo, readyForPickupAt: this.nowIso(), updatedAt: this.nowIso() };
    this.replaceWorkOrder(next);
    this.notify(this.customerUserIds(wo.customerId), 'work_order.ready_for_pickup', 'Ihr Fahrzeug ist abholbereit', `${wo.orderNumber}: ${wo.title}`, `/kunde/auftraege/${wo.id}`);
    this.audit(v, 'work_order.ready_for_pickup', 'work_order', id);
    this.changed();
    return this.map.workOrderDetail(next, v);
  }

  async pickedUp(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    const wo = this.workOrderFor(v, id);
    if (wo.status !== 'completed') throw ApiError.conflict(ERROR_CODES.conflict, 'Vor der Abholung muss der fachliche Abschluss bestätigt sein.');
    const next: DWorkOrder = { ...wo, status: 'picked_up', pickedUpAt: this.nowIso(), updatedAt: this.nowIso() };
    this.replaceWorkOrder(next);
    this.audit(v, 'work_order.picked_up', 'work_order', id);
    this.changed();
    return this.map.workOrderDetail(next, v);
  }

  async setAssignees(id: string, userIds: string[]) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    const wo = this.workOrderFor(v, id);
    const next = { ...wo, assigneeIds: userIds, updatedAt: this.nowIso() };
    this.replaceWorkOrder(next);
    this.audit(v, 'work_order.assignees', 'work_order', id, { userIds });
    this.changed();
    return this.map.workOrderDetail(next, v);
  }

  async getIntake(workOrderId: string) {
    await this.gate();
    const v = this.viewer();
    this.workOrderFor(v, workOrderId);
    const intake = this.state.intakes.find((i) => i.workOrderId === workOrderId);
    if (!intake) throw ApiError.notFound();
    return this.map.intake(intake, v);
  }

  async saveIntake(workOrderId: string, input: IntakeInputData) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'intake.write');
    const wo = this.workOrderFor(v, workOrderId);
    let intake = this.state.intakes.find((i) => i.workOrderId === workOrderId);
    const data = {
      odometerKm: input.odometerKm,
      fuelLevel: input.fuelLevel ?? null,
      customerComplaint: input.customerComplaint,
      damages: (input.damages ?? []).map((d) => ({ ...d, photoId: d.photoId ?? null })),
      agreedServices: input.agreedServices,
      costLimitCents: input.costLimitCents ?? null,
      notesInternal: input.notesInternal ?? null,
      notesCustomer: input.notesCustomer ?? null,
    };
    if (intake?.confirmedAt) throw ApiError.conflict(ERROR_CODES.conflict, 'Die Annahme ist bereits bestätigt und kann nicht mehr geändert werden.');
    if (intake) Object.assign(intake, data);
    else {
      intake = { id: uuid(), workOrderId, ...data, confirmedAt: null, confirmationMethod: 'none', contentHash: null };
      this.state.intakes.push(intake);
    }
    intake.contentHash = sha256Hex(JSON.stringify({ workOrderId, ...data, customerId: wo.customerId }));
    if (input.odometerKm !== null) {
      this.state.odometer.push({ id: uuid(), vehicleId: wo.vehicleId, valueKm: input.odometerKm, recordedAt: this.nowIso(), source: 'intake', workOrderId, plausibility: 'ok' });
    }
    this.audit(v, 'intake.saved', 'work_order', workOrderId);
    this.changed();
    return this.map.intake(intake, v);
  }

  async confirmIntake(workOrderId: string, input: ConfirmIntakeInput) {
    await this.gate();
    const v = this.viewer();
    const intake = this.state.intakes.find((i) => i.workOrderId === workOrderId);
    this.workOrderFor(v, workOrderId);
    if (!intake) throw ApiError.notFound();
    if (intake.contentHash !== input.contentHash) throw ApiError.conflict(ERROR_CODES.conflict, 'Die Annahme wurde inzwischen geändert.');
    if (input.method === 'app' && v.role !== 'customer') throw ApiError.forbidden('Die Bestätigung in der App erfolgt durch den Kunden.');
    if (input.method === 'on_site_signature') this.require(v, 'intake.write');
    Object.assign(intake, { confirmedAt: this.nowIso(), confirmationMethod: input.method });
    this.audit(v, 'intake.confirmed', 'work_order', workOrderId, { method: input.method, contentHash: input.contentHash });
    this.changed();
    return this.map.intake(intake, v);
  }

  async addWorkItem(workOrderId: string, input: WorkItemInputData) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    this.workOrderFor(v, workOrderId);
    const position = this.state.workItems.filter((i) => i.workOrderId === workOrderId).reduce((m, i) => Math.max(m, i.position), 0) + 1;
    const item = this.newItem(workOrderId, position, input, 'agreed', 'intake');
    this.state.workItems.push(item);
    this.audit(v, 'work_item.added', 'work_order', workOrderId, { itemId: item.id });
    this.changed();
    return this.map.workItem(item, v);
  }

  async updateWorkItem(itemId: string, input: Partial<WorkItemInputData>) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    const item = this.itemFor(v, itemId);
    if (item.approvalRequestId) throw ApiError.conflict(ERROR_CODES.conflict, 'Positionen aus Freigabeanfragen werden über eine neue Version geändert.');
    const next = { ...item, ...Object.fromEntries(Object.entries(input).filter(([, x]) => x !== undefined)) } as DWorkItem;
    this.replaceItem(next);
    this.audit(v, 'work_item.updated', 'work_order', item.workOrderId, { itemId });
    this.changed();
    return this.map.workItem(next, v);
  }

  private executableItem(v: Viewer, itemId: string): DWorkItem {
    this.require(v, 'workItems.execute');
    const item = this.itemFor(v, itemId);
    if (v.role === 'mechanic' && item.assignedTo !== v.user.id && !this.state.workOrders.find((w) => w.id === item.workOrderId)?.assigneeIds.includes(v.user.id)) {
      throw ApiError.forbidden('Diese Position ist Ihnen nicht zugewiesen.');
    }
    if (!itemIsExecutable(item)) throw ApiError.conflict(ERROR_CODES.conflict, item.authorization === 'pending_approval' ? 'Wartet auf Kundenfreigabe.' : 'Diese Position darf nicht ausgeführt werden.');
    return item;
  }

  private minutesSince(iso: string | null): number {
    return iso ? Math.max(0, Math.round((this.clock().getTime() - Date.parse(iso)) / 60_000)) : 0;
  }

  async startWorkItem(itemId: string) {
    await this.gate();
    const v = this.viewer();
    const item = this.executableItem(v, itemId);
    if (item.executionStatus === 'done' || item.executionStatus === 'not_done') throw ApiError.conflict(ERROR_CODES.conflict, 'Die Position ist bereits abgeschlossen.');
    const next: DWorkItem = { ...item, executionStatus: 'in_progress', runningSince: item.runningSince ?? this.nowIso(), assignedTo: item.assignedTo ?? v.user.id };
    this.replaceItem(next);
    this.refreshWorkStatus(item.workOrderId);
    this.audit(v, 'work_item.started', 'work_order', item.workOrderId, { itemId });
    this.changed();
    return this.map.workItem(next, v);
  }

  async pauseWorkItem(itemId: string) {
    await this.gate();
    const v = this.viewer();
    const item = this.executableItem(v, itemId);
    const next: DWorkItem = { ...item, executionStatus: 'paused', trackedMinutes: item.trackedMinutes + this.minutesSince(item.runningSince), runningSince: null };
    this.replaceItem(next);
    this.audit(v, 'work_item.paused', 'work_order', item.workOrderId, { itemId });
    this.changed();
    return this.map.workItem(next, v);
  }

  async finishWorkItem(itemId: string, input: FinishWorkItemInput) {
    await this.gate();
    const v = this.viewer();
    const item = this.executableItem(v, itemId);
    if (item.maintenanceTypeId && (input.odometerKm === undefined || input.odometerKm === null)) {
      throw ApiError.validation('Für Wartungsarbeiten ist der Kilometerstand beim Abschluss Pflicht.');
    }
    const wo = this.state.workOrders.find((w) => w.id === item.workOrderId)!;
    const next: DWorkItem = {
      ...item,
      executionStatus: 'done',
      doneAt: this.nowIso(),
      doneBy: v.user.id,
      doneOdometerKm: input.odometerKm ?? null,
      resultNotes: input.resultNotes ?? item.resultNotes,
      intervalKm: input.intervalKm ?? item.intervalKm,
      intervalMonths: input.intervalMonths ?? item.intervalMonths,
      trackedMinutes: item.trackedMinutes + this.minutesSince(item.runningSince),
      runningSince: null,
    };
    this.replaceItem(next);
    if (input.odometerKm !== undefined && input.odometerKm !== null) {
      this.state.odometer.push({ id: uuid(), vehicleId: wo.vehicleId, valueKm: input.odometerKm, recordedAt: this.nowIso(), source: 'work_completion', workOrderId: wo.id, plausibility: 'ok' });
    }
    this.refreshWorkStatus(item.workOrderId);
    this.audit(v, 'work_item.finished', 'work_order', item.workOrderId, { itemId });
    this.changed();
    return this.map.workItem(next, v);
  }

  async notDoneWorkItem(itemId: string, input: NotDoneWorkItemInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workItems.execute');
    const item = this.itemFor(v, itemId);
    const next: DWorkItem = { ...item, executionStatus: 'not_done', resultNotes: input.reason, runningSince: null };
    this.replaceItem(next);
    this.refreshWorkStatus(item.workOrderId);
    this.audit(v, 'work_item.not_done', 'work_order', item.workOrderId, { itemId, reason: input.reason });
    this.changed();
    return this.map.workItem(next, v);
  }

  async addPart(itemId: string, input: PartUsedInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workItems.execute');
    const item = this.itemFor(v, itemId);
    this.replaceItem({ ...item, parts: [...item.parts, { partNumber: input.partNumber ?? null, description: input.description, quantity: input.quantity, unitPriceCents: input.unitPriceCents ?? null }] });
    this.audit(v, 'work_item.part_added', 'work_order', item.workOrderId, { itemId });
    this.changed();
  }

  async listFindings(workOrderId: string) {
    await this.gate();
    const v = this.viewer();
    if (!isStaff(v)) throw ApiError.notFound();
    this.workOrderFor(v, workOrderId);
    const map = this.map;
    return this.state.findings.filter((f) => f.workOrderId === workOrderId).map((f) => map.finding(f));
  }

  async createFinding(workOrderId: string, input: FindingInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'findings.write');
    this.workOrderFor(v, workOrderId);
    const existing = input.id ? this.state.findings.find((f) => f.id === input.id) : undefined;
    if (existing) return this.map.finding(existing); // Offline-Wiederholung: keine Dublette
    const f = { id: input.id ?? uuid(), workOrderId, workItemId: input.workItemId ?? null, description: input.description, severity: input.severity, status: 'new' as const, reportedBy: v.user.id, dictated: input.dictated ?? false, photoIds: input.photoIds ?? [], createdAt: this.nowIso() };
    this.state.findings.push(f);
    this.audit(v, 'finding.created', 'work_order', workOrderId, { findingId: f.id });
    this.changed();
    return this.map.finding(f);
  }

  async reportFinding(findingId: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'findings.write');
    const f = this.state.findings.find((x) => x.id === findingId);
    if (!f) throw ApiError.notFound();
    this.workOrderFor(v, f.workOrderId);
    f.status = 'reported';
    const wo = this.state.workOrders.find((w) => w.id === f.workOrderId)!;
    this.notify(this.staffUserIds(), 'finding.reported', 'Zusatzarbeit gemeldet', `${wo.orderNumber}: ${f.description.slice(0, 80)}`, `/werkstatt/auftraege/${wo.id}/arbeiten`);
    this.audit(v, 'finding.reported', 'work_order', f.workOrderId, { findingId });
    this.changed();
    return this.map.finding(f);
  }

  async dismissFinding(findingId: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'workOrders.write');
    const f = this.state.findings.find((x) => x.id === findingId);
    if (!f) throw ApiError.notFound();
    f.status = 'dismissed';
    this.audit(v, 'finding.dismissed', 'work_order', f.workOrderId, { findingId });
    this.changed();
    return this.map.finding(f);
  }

  async listPhotos(workOrderId: string) {
    await this.gate();
    const v = this.viewer();
    this.workOrderFor(v, workOrderId);
    const map = this.map;
    return this.state.photos.filter((p) => p.workOrderId === workOrderId && (isStaff(v) || p.visibility === 'customer')).map((p) => map.photo(p));
  }

  async attachPhoto(workOrderId: string, input: AttachPhotoInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'findings.write');
    this.workOrderFor(v, workOrderId);
    if (input.id) {
      const existing = this.state.photos.find((p) => p.id === input.id);
      if (existing) return this.map.photo(existing);
    }
    const photo = { id: input.id ?? uuid(), workOrderId, fileId: input.fileId, context: input.context, findingId: input.findingId ?? null, visibility: 'internal' as Visibility, caption: input.caption ?? null, takenAt: input.takenAt ?? this.nowIso() };
    this.state.photos.push(photo);
    if (photo.findingId) {
      const f = this.state.findings.find((x) => x.id === photo.findingId);
      if (f && !f.photoIds.includes(photo.id)) f.photoIds.push(photo.id);
    }
    this.audit(v, 'photo.attached', 'work_order', workOrderId, { photoId: photo.id });
    this.changed();
    return this.map.photo(photo);
  }

  async setPhotoVisibility(photoId: string, visibility: Visibility) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'documents.publish');
    const photo = this.state.photos.find((p) => p.id === photoId);
    if (!photo) throw ApiError.notFound();
    photo.visibility = visibility;
    this.audit(v, 'photo.visibility', 'work_order', photo.workOrderId, { photoId, visibility });
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
      'intake.saved': 'Annahme gespeichert',
      'intake.confirmed': 'Annahme bestätigt',
      'approval.sent': 'Freigabeanfrage gesendet',
      'approval.revised': 'Neue Version der Freigabeanfrage',
      'approval.withdrawn': 'Freigabeanfrage zurückgezogen',
      'approval.decided': 'Kundenentscheidung',
      'work_item.started': 'Arbeit gestartet',
      'work_item.paused': 'Arbeit pausiert',
      'work_item.finished': 'Arbeit abgeschlossen',
      'work_order.completion_reviewed': 'Fachlicher Abschluss bestätigt',
      'service_entry.created': 'Serviceeintrag erzeugt',
      'work_order.ready_for_pickup': 'Abholbereit gemeldet',
      'work_order.picked_up': 'Abgeholt',
      'invoice.issued': 'Rechnung gestellt',
      'payment.booked': 'Zahlung gebucht',
    };
    const map = this.map;
    const fromAudit = this.state.audit
      .filter((a) => a.entityId === workOrderId || a.data.workOrderId === workOrderId)
      .map((a) => {
        const entry = map.audit(a);
        return { id: a.id, occurredAt: a.occurredAt, actorDisplayName: entry.actorDisplayName, action: a.action, summary: labels[a.action] ?? a.action };
      });
    const base = [{ id: `created-${wo.id}`, occurredAt: wo.createdAt, actorDisplayName: null, action: 'work_order.created', summary: 'Auftrag angelegt' }];
    return [...base, ...fromAudit].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  }

  // ---------------------------------------------------------------------------
  // Freigaben
  // ---------------------------------------------------------------------------

  async listApprovals(workOrderId: string) {
    await this.gate();
    const v = this.viewer();
    this.workOrderFor(v, workOrderId);
    const map = this.map;
    return this.state.approvals
      .filter((r) => r.workOrderId === workOrderId && (isStaff(v) || r.status !== 'draft'))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((r) => map.approval(r, v));
  }

  async createApproval(workOrderId: string, input: ApprovalDraft) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'approvals.request');
    this.workOrderFor(v, workOrderId);
    const req = approvalRules.createDraft({ id: uuid(), versionId: uuid(), workOrderId, draft: input, createdBy: v.user.id, now: this.nowIso() });
    this.state.approvals.push(req);
    if (input.findingId) {
      const f = this.state.findings.find((x) => x.id === input.findingId);
      if (f) f.status = 'converted';
    }
    this.audit(v, 'approval.created', 'approval_request', req.id, { workOrderId });
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

  private doRevise(v: Viewer, id: string, input: ApprovalDraft) {
    const r = this.approvalFor(v, id);
    const wasSent = r.status !== 'draft';
    const next = approvalRules.reviseRequest(r, input, { versionId: uuid(), createdBy: v.user.id, now: this.nowIso() });
    this.replaceApproval(next);
    if (wasSent) {
      this.state.workItems = approvalRules.syncItemsWithVersion(this.state.workItems, next, uuid);
      this.refreshWorkStatus(next.workOrderId);
      this.notifyApproval(next, true);
      this.audit(v, 'approval.revised', 'approval_request', id, { workOrderId: next.workOrderId, versionNo: approvalRules.currentVersion(next).versionNo, contentHash: approvalRules.currentVersion(next).contentHash });
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
    this.state.workItems = approvalRules.syncItemsWithVersion(this.state.workItems, r, uuid);
    this.refreshWorkStatus(r.workOrderId);
    this.notifyApproval(r, false);
    this.audit(v, 'approval.sent', 'approval_request', id, { workOrderId: r.workOrderId, contentHash: approvalRules.currentVersion(r).contentHash });
    this.changed();
    return this.map.approval(r, v);
  }

  async withdrawApproval(id: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'approvals.request');
    const r = approvalRules.withdrawRequest(this.approvalFor(v, id), this.nowIso());
    this.replaceApproval(r);
    this.state.workItems = approvalRules.withdrawItems(this.state.workItems, id);
    this.refreshWorkStatus(r.workOrderId);
    this.audit(v, 'approval.withdrawn', 'approval_request', id, { workOrderId: r.workOrderId });
    this.changed();
    return this.map.approval(r, v);
  }

  async decideApproval(id: string, input: ApprovalDecisionInput) {
    await this.gate();
    const v = this.viewer();
    const r = this.approvalFor(v, id);
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
    this.refreshWorkStatus(wo.id);
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

  async uploadFile(input: UploadInput) {
    await this.gate();
    const v = this.viewer();
    if (!input.mimeType.startsWith('image/') && input.mimeType !== 'application/pdf') throw ApiError.validation('Nur Fotos und PDF-Dateien sind erlaubt.');
    if ((input.sizeBytes ?? 0) > 15 * 1024 * 1024) throw ApiError.validation('Die Datei ist größer als 15 MB.');
    const f = { id: uuid(), originalName: input.name, mimeType: input.mimeType, sizeBytes: input.sizeBytes ?? 0, sha256: sha256Hex(`${input.uri}:${this.nowIso()}`), localUri: input.uri, placeholderLabel: null };
    this.state.files.push(f);
    this.audit(v, 'file.uploaded', 'file', f.id);
    this.changed();
    return { id: f.id, originalName: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, sha256: f.sha256 };
  }

  private documentsVisibleTo(v: Viewer) {
    const docs = this.state.documents.filter((d) => d.deletedAt === null);
    if (v.role === 'customer') return docs.filter((d) => customerCanSeeDocument(v.customerId ?? '', d));
    if (can(v, 'documents.readInternal')) return docs;
    const orders = new Set(this.visibleWorkOrders(v).map((w) => w.id));
    return docs.filter((d) => d.visibility === 'customer' && d.publishedAt && d.workOrderId && orders.has(d.workOrderId));
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

  async createDocument(input: CreateDocumentInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'documents.write');
    const wo = input.workOrderId ? this.state.workOrders.find((w) => w.id === input.workOrderId) : undefined;
    const d = {
      id: uuid(),
      kind: input.kind,
      title: input.title,
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
    this.audit(v, 'document.created', 'document', d.id, { workOrderId: d.workOrderId });
    this.changed();
    return this.map.document(d);
  }

  async addDocumentVersion(documentId: string, input: { fileId: string; note?: string | null }) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'documents.write');
    const d = this.state.documents.find((x) => x.id === documentId);
    if (!d) throw ApiError.notFound();
    d.versions.push({ id: uuid(), versionNo: d.versions.length + 1, fileId: input.fileId, note: input.note ?? null, createdAt: this.nowIso() });
    this.audit(v, 'document.version_added', 'document', documentId);
    this.changed();
    return this.map.document(d);
  }

  async publishDocument(documentId: string) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'documents.publish');
    const d = this.state.documents.find((x) => x.id === documentId);
    if (!d) throw ApiError.notFound();
    if (!d.customerId) throw ApiError.validation('Nur Dokumente mit Kundenbezug können veröffentlicht werden.');
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
    const pdf = makeDemoPdf([
      'Beispieldokument (Demo)',
      d.title,
      `Version ${dto.currentVersion.versionNo}`,
      'Autowerkstatt Witten, Entwurf mit Beispieldaten.',
      'Kein echtes Dokument.',
    ]);
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
    if (existing) return this.map.message(existing); // Wiederholung nach Verbindungsabbruch: keine Dublette
    const m = { id: uuid(), workOrderId, authorUserId: v.user.id, body: parsed.data.body, fileIds: parsed.data.fileIds, clientMessageId: parsed.data.clientMessageId, createdAt: this.nowIso() };
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
      .map((n) => ({ id: n.id, workOrderId: n.workOrderId, author: { userId: n.authorUserId, displayName: this.userById(n.authorUserId)?.displayName ?? 'Unbekannt' }, body: n.body, createdAt: n.createdAt }));
  }

  async addInternalNote(workOrderId: string, input: { body: string }) {
    await this.gate();
    const v = this.viewer();
    if (!isStaff(v)) throw ApiError.notFound();
    this.workOrderFor(v, workOrderId);
    if (!input.body.trim()) throw ApiError.validation('Die Notiz ist leer.');
    const n = { id: uuid(), workOrderId, authorUserId: v.user.id, body: input.body.trim(), createdAt: this.nowIso() };
    this.state.internalNotes.push(n);
    this.changed();
    return { id: n.id, workOrderId, author: { userId: v.user.id, displayName: v.user.displayName }, body: n.body, createdAt: n.createdAt };
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
    const map = this.map;
    let dtos = list.map((i) => map.invoice(i, v));
    if (query.paymentStatus) dtos = dtos.filter((i) => i.paymentStatus === query.paymentStatus);
    if (query.overdue !== undefined) dtos = dtos.filter((i) => i.overdue === query.overdue);
    if (query.customerId) dtos = dtos.filter((i) => i.customerId === query.customerId);
    return dtos.sort((a, b) => ((a.issuedAt ?? '') < (b.issuedAt ?? '') ? 1 : -1));
  }

  async createInvoice(input: CreateInvoiceInput) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'invoices.write');
    const inv = { id: uuid(), invoiceNumber: null, workOrderId: input.workOrderId ?? null, customerId: input.customerId, status: 'draft' as const, issuedAt: null, dueDate: input.dueDate ?? null, totalGrossCents: input.totalGrossCents, currency: 'EUR' as const, vatBreakdown: input.vatBreakdown ?? [], documentId: null, createdAt: this.nowIso(), cancelledAt: null };
    this.state.invoices.push(inv);
    this.audit(v, 'invoice.created', 'invoice', inv.id, { workOrderId: inv.workOrderId });
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
    if (inv.status !== 'draft') throw ApiError.conflict(ERROR_CODES.conflict, 'Nur Entwürfe können gestellt werden.');
    const due = new Date(this.clock().getTime() + this.state.settings.paymentTermDays * 86_400_000);
    Object.assign(inv, { status: 'issued', invoiceNumber, issuedAt: this.nowIso(), dueDate: inv.dueDate ?? todayLocal(due) });
    this.notify(this.customerUserIds(inv.customerId), 'invoice.issued', `Rechnung ${invoiceNumber} bereitgestellt`, 'Sie können die Rechnung in der App ansehen und bezahlen.', `/kunde/rechnungen/${inv.id}`);
    this.audit(v, 'invoice.issued', 'invoice', id, { workOrderId: inv.workOrderId, invoiceNumber });
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

  async cancelInvoice(id: string, input: { reason: string }) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'invoices.write');
    const inv = this.invoiceFor(v, id);
    if (this.state.payments.some((p) => p.invoiceId === id)) throw ApiError.conflict(ERROR_CODES.conflict, 'Rechnungen mit Zahlungen können nicht storniert werden.');
    Object.assign(inv, { status: 'cancelled', cancelledAt: this.nowIso() });
    for (const c of this.state.checkouts) if (c.invoiceId === id && (c.status === 'pending' || c.status === 'created')) c.status = 'deactivated';
    this.audit(v, 'invoice.cancelled', 'invoice', id, { reason: input.reason });
    this.changed();
    return this.map.invoice(inv, v);
  }

  async startCheckout(invoiceId: string) {
    await this.gate();
    const v = this.viewer();
    this.requireCustomer(v);
    const inv = this.invoiceFor(v, invoiceId);
    const summary = summarizeInvoice(inv, this.state.payments, this.state.refunds, this.today());
    const providerCheckoutId = `demo-chk-${base62(10)}`;
    const { checkout, deactivatedIds } = startCheckout({
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
    this.state.checkouts.push(checkout);
    this.state.providerCheckouts.push({ providerCheckoutId, checkoutReference: checkout.checkoutReference, merchantCode: DEMO_MERCHANT_CODE, amountCents: checkout.amountCents, currency: 'EUR', status: 'PENDING', transactionId: null });
    this.audit(v, 'checkout.created', 'invoice', invoiceId, { checkoutId: checkout.id, amountCents: checkout.amountCents });
    this.changed();
    // Der Rechnungsstatus bleibt unverändert (R-ZAHL-4).
    return { checkoutId: checkout.id, hostedUrl: checkout.hostedUrl, invoicePaymentStatus: summary.paymentStatus };
  }

  /** Gleicht offene Zahlungsversuche mit dem (simulierten) Anbieter ab. */
  private reconcileInvoice(invoiceId: string, actor: Viewer | null) {
    let booked = 0;
    for (const checkout of this.state.checkouts.filter((c) => c.invoiceId === invoiceId && (c.status === 'pending' || c.status === 'created'))) {
      const provider = this.state.providerCheckouts.find((p) => p.providerCheckoutId === checkout.providerCheckoutId);
      const result = reconcileCheckout({ checkout, provider, payments: this.state.payments, merchantCode: this.state.settings.sumupMerchantCode ?? '', paymentId: uuid(), now: this.nowIso() });
      this.state.checkouts = this.state.checkouts.map((c) => (c.id === checkout.id ? result.checkout : c));
      if (result.payment) {
        this.state.payments.push(result.payment);
        booked++;
        const inv = this.state.invoices.find((i) => i.id === invoiceId)!;
        this.audit(actor, 'payment.booked', 'invoice', invoiceId, { workOrderId: inv.workOrderId, amountCents: result.payment.amountCents, providerTransactionId: result.payment.providerTransactionId });
        this.notify(this.customerUserIds(inv.customerId), 'payment.confirmed', `Zahlung bestätigt: ${inv.invoiceNumber}`, 'Vielen Dank, Ihre Zahlung ist eingegangen.', `/kunde/rechnungen/${inv.id}`);
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
    validateManualPayment(summarizeInvoice(inv, this.state.payments, this.state.refunds, this.today()), input.amountCents);
    if (!input.referenceText.trim()) throw ApiError.validation('Verwendungszweck bzw. Beleg ist Pflicht.');
    this.state.payments.push({ id: uuid(), invoiceId, method: input.method, amountCents: input.amountCents, currency: 'EUR', provider: null, providerTransactionId: null, checkoutId: null, receivedAt: input.receivedAt, recordedBy: v.user.id, referenceText: input.referenceText.trim() });
    this.audit(v, 'payment.recorded_manual', 'invoice', invoiceId, { workOrderId: inv.workOrderId, amountCents: input.amountCents, method: input.method, note: input.note ?? null });
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
    const existing = this.state.refunds.find((r) => r.idempotencyKey === input.idempotencyKey);
    if (!existing) {
      const refunded = this.state.refunds.filter((r) => r.paymentId === paymentId && r.status === 'succeeded').reduce((s, r) => s + r.amountCents, 0);
      if (input.amountCents > payment.amountCents - refunded) throw ApiError.validation('Der Betrag übersteigt die erstattbare Summe.');
      this.state.refunds.push({ id: uuid(), paymentId, amountCents: input.amountCents, status: 'succeeded', idempotencyKey: input.idempotencyKey, requestedBy: v.user.id, requestedAt: this.nowIso(), completedAt: this.nowIso(), failureReason: null });
      this.audit(v, 'payment.refunded', 'invoice', inv.id, { amountCents: input.amountCents, reason: input.reason });
      this.changed();
    }
    return this.map.invoice(inv, v);
  }

  async exportInvoicesCsv(query: ListInvoicesQuery = {}) {
    const list = await this.listInvoices(query);
    const v = this.viewer();
    this.require(v, 'reports.export');
    const rows = [['Rechnungsnummer', 'Kunde', 'Auftrag', 'Datum', 'Fällig', 'Betrag', 'Bezahlt', 'Offen', 'Status'].join(';')];
    for (const i of list) {
      rows.push([i.invoiceNumber ?? '', i.customerDisplayName, i.orderNumber ?? '', i.issuedAt?.slice(0, 10) ?? '', i.dueDate ?? '', (i.totalGrossCents / 100).toFixed(2).replace('.', ','), (i.paidCents / 100).toFixed(2).replace('.', ','), (i.openCents / 100).toFixed(2).replace('.', ','), i.paymentStatus].join(';'));
    }
    this.audit(v, 'report.exported', 'invoice', null, { rows: list.length });
    this.changed();
    return rows.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Benachrichtigungen
  // ---------------------------------------------------------------------------

  async listNotifications() {
    await this.gate();
    const v = this.viewer();
    const map = this.map;
    return this.state.notifications.filter((n) => n.userId === v.user.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((n) => map.notification(n));
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
    this.state.notificationPreferences = [
      ...this.state.notificationPreferences.filter((p) => p.userId !== v.user.id),
      ...preferences.map((p) => ({ userId: v.user.id, ...p })),
    ];
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
    if (!isStaff(v)) throw ApiError.notFound();
    return this.map.settings();
  }

  async updateSettings(input: Partial<DemoState['settings']>) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'settings.manage');
    const { paymentProviderConfigured: _ignored, ...rest } = input;
    Object.assign(this.state.settings, rest);
    this.audit(v, 'settings.updated', 'settings', null, { fields: Object.keys(rest) });
    this.changed();
    return this.map.settings();
  }

  async listMaintenanceTypes() {
    await this.gate();
    const v = this.viewer();
    if (!isStaff(v)) throw ApiError.notFound();
    return this.state.maintenanceTypes;
  }

  async upsertMaintenanceType(id: string, input: Omit<DemoState['maintenanceTypes'][number], 'id'>) {
    await this.gate();
    const v = this.viewer();
    this.require(v, 'settings.manage');
    const existing = this.state.maintenanceTypes.find((t) => t.id === id);
    const next = { id, ...input };
    if (existing) Object.assign(existing, next);
    else this.state.maintenanceTypes.push(next);
    this.audit(v, 'settings.maintenance_type', 'maintenance_type', id);
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
    this.audit(v, 'settings.resource', 'resource', id);
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
    return resolveQr({ token, vehicles: this.state.vehicles, ownerships: this.state.ownerships, entries: this.state.serviceEntries, viewer, workshopName: this.state.settings.name });
  }

  async publicShare(token: string) {
    await this.gate();
    const { share, view } = openShare({ token, shares: this.state.shares, vehicles: this.state.vehicles, ownerships: this.state.ownerships, entries: this.state.serviceEntries, now: this.nowIso(), workshopName: this.state.settings.name });
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
      .filter((a) => (!query.entityType || a.entityType === query.entityType) && (!query.entityId || a.entityId === query.entityId) && (!query.actorId || a.actorUserId === query.actorId))
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
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
      this.changed();
    },
    accounts: (): DemoAccount[] => {
      const def: [DemoAccount['key'], string, string, string][] = [
        ['customer', 'Kundin', 'Zwei Fahrzeuge, offene Freigaben und Rechnungen', IDS.users.miriam],
        ['previousOwner', 'Vorbesitzer', 'Hat den Octavia an die Kundin verkauft', IDS.users.guenter],
        ['owner', 'Inhaber', 'Alle Rechte', IDS.users.owner],
        ['service', 'Service', 'Sekretariat und Service', IDS.users.service],
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
      this.state.messages.push({ id: uuid(), workOrderId, authorUserId: service.id, body: 'Danke für Ihre Nachricht. Wir melden uns in Kürze bei Ihnen.', fileIds: [], clientMessageId: null, createdAt: this.nowIso() });
      this.notify(this.customerUserIds(wo.customerId), 'message.received', `Neue Nachricht zu ${wo.orderNumber}`, `${this.state.settings.name} hat Ihnen geschrieben.`, `/kunde/auftraege/${wo.id}/chat`);
      this.changed();
      return 'Die Werkstatt hat im Chat geantwortet.';
    },
    /**
     * Werkstatt schließt einen Auftrag ab: offene freigegebene/vereinbarte Positionen werden
     * erledigt, der fachliche Abschluss erzeugt die Serviceeinträge, das Fahrzeug wird
     * abholbereit gemeldet und die Rechnung gestellt. Abgelehnte Positionen bleiben außen vor.
     */
    workshopCompleteOrder: (workOrderId: string): string => {
      const service = this.viewerFor(this.userById(IDS.users.service)!);
      const wo = this.workOrderFor(service, workOrderId);
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
      this.notify(this.customerUserIds(wo.customerId), 'work_order.ready_for_pickup', 'Ihr Fahrzeug ist abholbereit', `${wo.orderNumber}: ${wo.title}`, `/kunde/auftraege/${wo.id}`);
      const done = this.state.workItems.filter((i) => i.workOrderId === workOrderId && i.executionStatus === 'done' && itemIsExecutable(i));
      const net = done.reduce((s, i) => s + Math.round(i.quantity * (i.unitPriceCents ?? 0)), 0);
      const gross = done.reduce((s, i) => {
        const n = Math.round(i.quantity * (i.unitPriceCents ?? 0));
        return s + n + Math.round((n * i.vatRateBp) / 10_000);
      }, 0);
      const inv = { id: uuid(), invoiceNumber: null, workOrderId, customerId: wo.customerId, status: 'draft' as const, issuedAt: null, dueDate: null, totalGrossCents: gross, currency: 'EUR' as const, vatBreakdown: [{ vatRateBp: 1900, netCents: net, vatCents: gross - net }], documentId: null, createdAt: this.nowIso(), cancelledAt: null };
      this.state.invoices.push(inv);
      const number = `R-${this.clock().getFullYear()}-${String(++this.state.counters.invoice).padStart(4, '0')}`;
      this.doIssueInvoice(service, inv.id, number);
      const entries = this.state.serviceEntries.filter((e) => e.workOrderId === workOrderId).length;
      this.changed();
      return `Auftrag abgeschlossen: ${entries} ${entries === 1 ? 'Serviceeintrag' : 'Serviceeinträge'} erzeugt, abholbereit gemeldet, Rechnung ${number} gestellt.`;
    },
    customerEmail: () => DEMO_EMAILS.customer,
  };
}

export type DemoControls = DemoApi['controls'];
