/**
 * Abbildung des internen Demo-Zustands auf die DTOs aus @werkstatt/contracts.
 * Felder werden je Rolle gefiltert wie in der echten API: keine internen Notizen für Kunden,
 * keine Preise und Kontaktdaten für Mechaniker, Auftragsbezug bei fremden Aufträgen ausgeblendet.
 */
import type {
  Appointment,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalVersion,
  AuditEntry,
  Checkout,
  Conversation,
  CustomerDetail,
  CustomerSummary,
  DocumentDto,
  Finding,
  Intake,
  Invoice,
  Message,
  NotificationDto,
  OdometerReading,
  Ownership,
  Payment,
  Permission,
  Photo,
  Role,
  ServiceEntry,
  SessionUser,
  StaffUser,
  VehicleDetail,
  VehicleShare,
  VehicleSummary,
  WorkItem,
  WorkOrderDetail,
  WorkOrderSummary,
  WorkshopSettings,
} from '@werkstatt/contracts';
import { API_PREFIX } from '@werkstatt/contracts';
import type {
  DAppointment,
  DApprovalDecision,
  DApprovalRequest,
  DApprovalVersion,
  DAudit,
  DCustomer,
  DDocument,
  DemoState,
  DFinding,
  DIntake,
  DInvoice,
  DMessage,
  DNotification,
  DOdometer,
  DOwnership,
  DPhoto,
  DServiceEntry,
  DUser,
  DVehicle,
  DVehicleShare,
  DWorkItem,
  DWorkOrder,
} from './model';
import { currentOwnerId, serviceEntryWorkOrderRefForCustomer } from './rules/access';
import { summarizeInvoice } from './rules/payments';
import { effectivePermissions } from './rules/permissions';
import { statusTriple } from './rules/workOrders';

export interface Viewer {
  user: DUser;
  role: Role;
  customerId: string | null;
  permissions: ReadonlySet<Permission>;
}

export const isStaff = (v: Viewer) => v.role !== 'customer';
export const can = (v: Viewer, p: Permission) => v.permissions.has(p);

export function todayLocal(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function customerName(c: DCustomer | undefined): string {
  if (!c) return 'Unbekannt';
  if (c.kind === 'business' && c.companyName) return c.companyName;
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName || c.customerNumber;
}

export function vehicleLabel(v: DVehicle | undefined): string {
  if (!v) return 'Unbekanntes Fahrzeug';
  return `${v.make} ${v.model}, ${v.licensePlate}`;
}

export class Mapper {
  constructor(
    private readonly s: DemoState,
    private readonly now: Date,
    private readonly publicBase: string,
  ) {}

  private customer(id: string) {
    return this.s.customers.find((c) => c.id === id);
  }
  private vehicle(id: string) {
    return this.s.vehicles.find((v) => v.id === id);
  }
  private user(id: string | null) {
    return id ? this.s.users.find((u) => u.id === id) : undefined;
  }
  private userRef(id: string | null) {
    const u = this.user(id);
    return u ? { userId: u.id, displayName: u.displayName } : null;
  }
  private file(id: string) {
    return this.s.files.find((f) => f.id === id);
  }

  sessionUser(u: DUser): SessionUser {
    const account = this.s.customerAccounts.find((a) => a.userId === u.id);
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      status: u.status,
      permissions: effectivePermissions(u.role, u.permissionOverrides),
      customerId: u.role === 'customer' ? (account?.customerId ?? null) : null,
    };
  }

  staffUser(u: DUser): StaffUser {
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      status: u.status,
      permissionOverrides: u.permissionOverrides,
      effectivePermissions: effectivePermissions(u.role, u.permissionOverrides),
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    };
  }

  accessStatus(customerId: string): CustomerSummary['accessStatus'] {
    const account = this.s.customerAccounts.find((a) => a.customerId === customerId);
    const u = account ? this.user(account.userId) : undefined;
    return u ? u.status : 'none';
  }

  customerSummary(c: DCustomer): CustomerSummary {
    const today = todayLocal(this.now);
    const openInvoiceCount = this.s.invoices
      .filter((i) => i.customerId === c.id && i.status === 'issued')
      .filter((i) => summarizeInvoice(i, this.s.payments, this.s.refunds, today).openCents > 0).length;
    return {
      id: c.id,
      customerNumber: c.customerNumber,
      kind: c.kind,
      displayName: customerName(c),
      email: c.email,
      phone: c.phone ?? c.mobile,
      vehicleCount: this.s.ownerships.filter((o) => o.customerId === c.id && o.endedAt === null).length,
      accessStatus: this.accessStatus(c.id),
      openInvoiceCount,
      isTestData: c.isTestData,
    };
  }

  customerDetail(c: DCustomer, viewer: Viewer): CustomerDetail {
    return {
      ...this.customerSummary(c),
      salutation: c.salutation,
      firstName: c.firstName,
      lastName: c.lastName,
      companyName: c.companyName,
      mobile: c.mobile,
      street: c.street,
      postalCode: c.postalCode,
      city: c.city,
      country: c.country,
      ...(isStaff(viewer) ? { notesInternal: c.notesInternal } : {}),
      createdAt: c.createdAt,
      archivedAt: c.archivedAt,
    };
  }

  private lastReading(vehicleId: string): DOdometer | undefined {
    return this.s.odometer
      .filter((r) => r.vehicleId === vehicleId)
      .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))[0];
  }

  vehicleSummary(v: DVehicle, viewer: Viewer): VehicleSummary {
    const ownerId = currentOwnerId(this.s.ownerships, v.id);
    const owner = ownerId ? this.customer(ownerId) : undefined;
    const last = this.lastReading(v.id);
    return {
      id: v.id,
      licensePlate: v.licensePlate,
      make: v.make,
      model: v.model,
      variant: v.variant,
      vin: v.vin,
      ...(isStaff(viewer) ? { currentOwner: owner ? { customerId: owner.id, displayName: customerName(owner) } : null } : {}),
      lastOdometerKm: last?.valueKm ?? null,
      lastOdometerAt: last?.recordedAt ?? null,
      isTestData: v.isTestData,
    };
  }

  vehicleDetail(v: DVehicle, viewer: Viewer): VehicleDetail {
    const isOwner = viewer.customerId !== null && currentOwnerId(this.s.ownerships, v.id) === viewer.customerId;
    const staffCanSeeQr = isStaff(viewer) && can(viewer, 'vehicles.read');
    return {
      ...this.vehicleSummary(v, viewer),
      hsn: v.hsn,
      tsn: v.tsn,
      firstRegistration: v.firstRegistration,
      fuelType: v.fuelType,
      color: v.color,
      ...(isStaff(viewer) ? { notesInternal: v.notesInternal } : {}),
      qrPublicViewEnabled: v.qrPublicViewEnabled,
      qrUrl: isOwner || staffCanSeeQr ? `${this.publicBase}/q/${v.qrToken}` : null,
      createdAt: v.createdAt,
    };
  }

  ownership(o: DOwnership): Ownership {
    return { ...o, customerDisplayName: customerName(this.customer(o.customerId)) };
  }

  odometer(r: DOdometer): OdometerReading {
    return { id: r.id, vehicleId: r.vehicleId, valueKm: r.valueKm, recordedAt: r.recordedAt, source: r.source, workOrderId: r.workOrderId, plausibility: r.plausibility };
  }

  appointment(a: DAppointment, viewer: Viewer): Appointment {
    return {
      id: a.id,
      kind: a.kind,
      status: a.status,
      customerId: a.customerId,
      customerDisplayName: customerName(this.customer(a.customerId)),
      vehicleId: a.vehicleId,
      vehicleLabel: vehicleLabel(this.vehicle(a.vehicleId)),
      workOrderId: a.workOrderId,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      ...(isStaff(viewer) ? { resourceId: a.resourceId, assigneeIds: a.assigneeIds, internalNote: a.internalNote } : {}),
      requestedBy: a.requestedBy,
      customerNote: a.customerNote,
      proposals: a.proposals.map((p) => ({ id: p.id, startsAt: p.startsAt, endsAt: p.endsAt, status: p.status, createdAt: p.createdAt })),
      confirmedAt: a.confirmedAt,
      cancelledAt: a.cancelledAt,
      cancelReason: a.cancelReason,
    };
  }

  /**
   * Position wie die API: Mechaniker ohne Positions- und Teilepreise, Kunden ohne erfasste
   * Zeit, laufende Zeit und Teile.
   */
  workItem(i: DWorkItem, viewer: Viewer): WorkItem {
    const showPrices = viewer.role !== 'mechanic';
    const running = i.runningSince ? Math.max(0, Math.round((this.now.getTime() - Date.parse(i.runningSince)) / 60_000)) : 0;
    const parts = i.parts.map((p) => ({
      id: p.id,
      partNumber: p.partNumber,
      description: p.description,
      quantity: p.quantity,
      ...(showPrices ? { unitPriceCents: p.unitPriceCents } : {}),
      recordedAt: p.recordedAt,
    }));
    return {
      id: i.id,
      workOrderId: i.workOrderId,
      position: i.position,
      kind: i.kind,
      title: i.title,
      description: i.description,
      maintenanceTypeId: i.maintenanceTypeId,
      intervalKm: i.intervalKm,
      intervalMonths: i.intervalMonths,
      quantity: i.quantity,
      unit: i.unit,
      ...(showPrices ? { unitPriceCents: i.unitPriceCents, vatRateBp: i.vatRateBp } : {}),
      origin: i.origin,
      authorization: i.authorization,
      executionStatus: i.executionStatus,
      approvalRequestId: i.approvalRequestId,
      assignedTo: this.userRef(i.assignedTo),
      doneAt: i.doneAt,
      doneOdometerKm: i.doneOdometerKm,
      resultNotes: i.resultNotes,
      ...(isStaff(viewer) ? { trackedMinutes: i.trackedMinutes + running, runningSince: i.runningSince, parts } : {}),
    };
  }


  /**
   * Ungelesen: Kunden zählen Nachrichten der Werkstatt seit ihrem letzten Lesen. Für die
   * Werkstatt ist das Postfach gemeinsam: Kundennachrichten nach dem letzten Lesen durch
   * irgendeinen Mitarbeiter.
   */
  unreadFor(workOrderId: string, viewer: Viewer): number {
    if (isStaff(viewer)) {
      const staff = new Set(this.s.users.filter((u) => u.role !== 'customer').map((u) => u.id));
      const read = this.s.reads.filter((r) => r.workOrderId === workOrderId && staff.has(r.userId)).reduce((max, r) => (r.lastReadAt > max ? r.lastReadAt : max), '');
      return this.s.messages.filter((m) => m.workOrderId === workOrderId && !staff.has(m.authorUserId) && m.createdAt > read).length;
    }
    const read = this.s.reads.find((r) => r.workOrderId === workOrderId && r.userId === viewer.user.id)?.lastReadAt ?? '';
    return this.s.messages.filter((m) => m.workOrderId === workOrderId && m.authorUserId !== viewer.user.id && m.createdAt > read).length;
  }

  workOrderSummary(w: DWorkOrder, viewer: Viewer): WorkOrderSummary {
    const v = this.vehicle(w.vehicleId);
    const approvals = this.s.approvals.filter((a) => a.workOrderId === w.id);
    return {
      id: w.id,
      orderNumber: w.orderNumber,
      title: w.title,
      customerId: w.customerId,
      customerDisplayName: customerName(this.customer(w.customerId)),
      vehicleId: w.vehicleId,
      vehicleLabel: v ? `${v.make} ${v.model}` : 'Fahrzeug',
      licensePlate: v?.licensePlate ?? '',
      status: statusTriple(w, approvals, this.s.invoices, this.s.payments, this.s.refunds, todayLocal(this.now)),
      plannedStart: w.plannedStart,
      plannedEnd: w.plannedEnd,
      assignees: w.assigneeIds.map((id) => this.userRef(id)).filter((x): x is NonNullable<typeof x> => x !== null),
      unreadMessages: this.unreadFor(w.id, viewer),
      updatedAt: w.updatedAt,
    };
  }

  intake(i: DIntake, viewer: Viewer): Intake {
    return {
      id: i.id,
      workOrderId: i.workOrderId,
      odometerKm: i.odometerKm,
      fuelLevel: i.fuelLevel,
      customerComplaint: i.customerComplaint,
      damages: i.damages,
      agreedServices: i.agreedServices,
      ...(viewer.role !== 'mechanic' ? { costLimitCents: i.costLimitCents } : {}),
      ...(isStaff(viewer) ? { notesInternal: i.notesInternal } : {}),
      notesCustomer: i.notesCustomer,
      confirmedAt: i.confirmedAt,
      confirmationMethod: i.confirmationMethod,
      contentHash: i.contentHash,
    };
  }

  workOrderDetail(w: DWorkOrder, viewer: Viewer): WorkOrderDetail {
    const intake = this.s.intakes.find((i) => i.workOrderId === w.id);
    const items = this.s.workItems
      .filter((i) => i.workOrderId === w.id)
      .filter((i) => isStaff(viewer) || i.authorization !== 'withdrawn')
      .sort((a, b) => a.position - b.position);
    return {
      ...this.workOrderSummary(w, viewer),
      descriptionCustomer: w.descriptionCustomer,
      ...(isStaff(viewer) ? { notesInternal: w.notesInternal } : {}),
      ...(viewer.role !== 'mechanic' ? { costLimitCents: w.costLimitCents } : {}),
      items: items.map((i) => this.workItem(i, viewer)),
      intake: intake ? this.intake(intake, viewer) : null,
      appointmentIds: this.s.appointments.filter((a) => a.workOrderId === w.id).map((a) => a.id),
      readyForPickupAt: w.readyForPickupAt,
      pickedUpAt: w.pickedUpAt,
      completionReviewedAt: w.completionReviewedAt,
      createdAt: w.createdAt,
    };
  }

  photo(p: DPhoto): Photo {
    return {
      id: p.id,
      workOrderId: p.workOrderId,
      fileId: p.fileId,
      context: p.context,
      findingId: p.findingId,
      visibility: p.visibility,
      caption: p.caption,
      takenAt: p.takenAt,
      contentUrl: `${API_PREFIX}/photos/${p.id}/content`,
    };
  }

  finding(f: DFinding): Finding {
    return {
      id: f.id,
      workOrderId: f.workOrderId,
      workItemId: f.workItemId,
      description: f.description,
      severity: f.severity,
      status: f.status,
      reportedBy: this.userRef(f.reportedBy) ?? { userId: f.reportedBy, displayName: 'Unbekannt' },
      dictated: f.dictated,
      photoIds: f.photoIds,
      createdAt: f.createdAt,
    };
  }

  decision(d: DApprovalDecision): ApprovalDecision {
    return {
      id: d.id,
      versionId: d.versionId,
      decision: d.decision,
      decidedByDisplayName: d.decidedByDisplayName,
      decidedAt: d.decidedAt,
      contentHash: d.contentHash,
      channel: d.channel,
      comment: d.comment,
    };
  }

  approvalVersion(v: DApprovalVersion): ApprovalVersion {
    return {
      id: v.id,
      versionNo: v.versionNo,
      summaryCustomer: v.summaryCustomer,
      lines: v.lines,
      totalNetCents: v.totalNetCents,
      totalGrossCents: v.totalGrossCents,
      currency: 'EUR',
      scheduleChange: v.scheduleChange,
      newReadyAt: v.newReadyAt,
      photoIds: v.photoIds,
      documentVersionId: v.documentVersionId,
      contentHash: v.contentHash,
      sentAt: v.sentAt,
      supersededAt: v.supersededAt,
      decision: v.decision ? this.decision(v.decision) : null,
    };
  }

  approval(r: DApprovalRequest, viewer: Viewer): ApprovalRequest {
    const versions = r.versions
      .filter((v) => isStaff(viewer) || v.sentAt !== null)
      .sort((a, b) => a.versionNo - b.versionNo)
      .map((v) => this.approvalVersion(v));
    const current = versions.at(-1);
    if (!current) throw new Error('Freigabe ohne sichtbare Version');
    return { id: r.id, workOrderId: r.workOrderId, kind: r.kind, title: r.title, status: r.status, currentVersion: current, versions, findingId: r.findingId, createdAt: r.createdAt };
  }

  document(d: DDocument): DocumentDto {
    const current = d.versions.reduce((acc, v) => (v.versionNo > acc.versionNo ? v : acc), d.versions[0]!);
    const f = this.file(current.fileId);
    return {
      id: d.id,
      kind: d.kind,
      title: d.title,
      customerId: d.customerId,
      vehicleId: d.vehicleId,
      workOrderId: d.workOrderId,
      visibility: d.visibility,
      publishedAt: d.publishedAt,
      currentVersion: {
        id: current.id,
        versionNo: current.versionNo,
        file: { id: current.fileId, originalName: f?.originalName ?? 'dokument.pdf', mimeType: f?.mimeType ?? 'application/pdf', sizeBytes: f?.sizeBytes ?? 0, sha256: f?.sha256 ?? '' },
        createdAt: current.createdAt,
      },
      versionCount: d.versions.length,
      downloadUrl: `${API_PREFIX}/documents/${d.id}/download`,
      createdAt: d.createdAt,
    };
  }

  message(m: DMessage): Message {
    const author = this.user(m.authorUserId);
    return {
      id: m.id,
      workOrderId: m.workOrderId,
      author: { userId: m.authorUserId, displayName: author?.displayName ?? 'Unbekannt', role: author?.role ?? 'service' },
      body: m.body,
      // Chat-Anhänge sind Fotos (wie in der API): Inhalt über die rechtegeprüfte Foto-Route
      attachments: m.photoIds
        .map((photoId) => this.s.photos.find((p) => p.id === photoId))
        .filter((p): p is DPhoto => p !== undefined)
        .map((p) => ({ fileId: p.fileId, contentUrl: `${API_PREFIX}/photos/${p.id}/content`, mimeType: this.file(p.fileId)?.mimeType ?? 'image/jpeg' })),
      clientMessageId: m.clientMessageId,
      createdAt: m.createdAt,
    };
  }

  conversation(w: DWorkOrder, viewer: Viewer): Conversation {
    const msgs = this.s.messages.filter((m) => m.workOrderId === w.id).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const last = msgs.at(-1);
    return {
      workOrderId: w.id,
      orderNumber: w.orderNumber,
      title: w.title,
      counterpartDisplayName: isStaff(viewer) ? customerName(this.customer(w.customerId)) : this.s.settings.name,
      lastMessage: last ? this.message(last) : null,
      unreadCount: this.unreadFor(w.id, viewer),
    };
  }

  payment(p: DemoState['payments'][number]): Payment {
    const refunded = this.s.refunds.filter((r) => r.paymentId === p.id && r.status === 'succeeded').reduce((s, r) => s + r.amountCents, 0);
    return {
      id: p.id,
      method: p.method,
      amountCents: p.amountCents,
      currency: 'EUR',
      receivedAt: p.receivedAt,
      providerTransactionId: p.providerTransactionId,
      referenceText: p.referenceText,
      recordedByDisplayName: this.user(p.recordedBy)?.displayName ?? null,
      refundedCents: refunded,
    };
  }

  invoice(i: DInvoice, viewer: Viewer): Invoice {
    const today = todayLocal(this.now);
    const summary = summarizeInvoice(i, this.s.payments, this.s.refunds, today);
    const wo = i.workOrderId ? this.s.workOrders.find((w) => w.id === i.workOrderId) : undefined;
    const checkouts: Checkout[] = this.s.checkouts
      .filter((c) => c.invoiceId === i.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((c) => ({ id: c.id, status: c.status, amountCents: c.amountCents, createdAt: c.createdAt, lastCheckedAt: c.lastCheckedAt }));
    const settings = this.s.settings;
    return {
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      workOrderId: i.workOrderId,
      orderNumber: wo?.orderNumber ?? null,
      customerId: i.customerId,
      customerDisplayName: customerName(this.customer(i.customerId)),
      status: i.status,
      paymentStatus: summary.paymentStatus,
      overdue: summary.overdue,
      totalGrossCents: i.totalGrossCents,
      paidCents: summary.paidCents,
      refundedCents: summary.refundedCents,
      openCents: summary.openCents,
      currency: 'EUR',
      issuedAt: i.issuedAt,
      dueDate: i.dueDate,
      documentId: i.documentId,
      payments: this.s.payments.filter((p) => p.invoiceId === i.id).map((p) => this.payment(p)),
      // Zahlungsversuche und Erstattungsvorgänge nur für Mitarbeiter (wie die API,
      // redactInvoiceForActor); Kunden sehen Zahlungsstatus und offenen Betrag.
      ...(isStaff(viewer)
        ? {
            checkouts,
            refunds: this.s.refunds
              .filter((r) => this.s.payments.some((p) => p.id === r.paymentId && p.invoiceId === i.id))
              .map((r) => ({ id: r.id, paymentId: r.paymentId, amountCents: r.amountCents, status: r.status, requestedAt: r.requestedAt, completedAt: r.completedAt, failureReason: r.failureReason })),
          }
        : {}),
      bankTransfer:
        settings.iban && i.status === 'issued'
          ? { recipient: settings.legalName ?? settings.name, iban: settings.iban, bic: settings.bic, reference: i.invoiceNumber ?? i.id }
          : null,
      onlinePaymentAvailable: settings.paymentProvider === 'sumup' && settings.paymentProviderConfigured && i.status === 'issued' && summary.openCents > 0,
    };
  }

  serviceEntry(e: DServiceEntry, viewer: Viewer): ServiceEntry {
    const type = e.maintenanceTypeId ? this.s.maintenanceTypes.find((t) => t.id === e.maintenanceTypeId) : undefined;
    const workOrderId =
      viewer.role === 'customer' && viewer.customerId
        ? serviceEntryWorkOrderRefForCustomer(viewer.customerId, e, this.s.workOrders)
        : e.workOrderId;
    return {
      id: e.id,
      vehicleId: e.vehicleId,
      workOrderId,
      maintenanceTypeId: e.maintenanceTypeId,
      maintenanceTypeName: type?.name ?? null,
      performedOn: e.performedOn,
      odometerKm: e.odometerKm,
      title: e.title,
      details: e.details,
      workshopName: e.workshopName,
      intervalKm: e.intervalKm,
      intervalMonths: e.intervalMonths,
      nextDueDate: e.nextDueDate,
      nextDueKm: e.nextDueKm,
      status: e.status,
      revisionNo: e.revisionNo,
      revisionOfId: e.revisionOfId,
      correctionReason: e.correctionReason,
      createdAt: e.createdAt,
    };
  }

  share(sh: DVehicleShare, shareUrl: string | null = null): VehicleShare {
    return {
      id: sh.id,
      vehicleId: sh.vehicleId,
      label: sh.label,
      includeVin: sh.includeVin,
      serviceEntryIds: sh.serviceEntryIds,
      expiresAt: sh.expiresAt,
      revokedAt: sh.revokedAt,
      accessCount: sh.accessCount,
      lastAccessedAt: sh.lastAccessedAt,
      createdAt: sh.createdAt,
      shareUrl,
    };
  }

  notification(n: DNotification): NotificationDto {
    return { id: n.id, eventType: n.eventType, title: n.title, body: n.body, targetPath: n.targetPath, createdAt: n.createdAt, readAt: n.readAt };
  }

  settings(): WorkshopSettings {
    return { ...this.s.settings };
  }

  audit(a: DAudit): AuditEntry {
    const u = this.user(a.actorUserId);
    return { id: a.id, occurredAt: a.occurredAt, actorDisplayName: u?.displayName ?? null, actorRole: a.actorRole, action: a.action, entityType: a.entityType, entityId: a.entityId, data: a.data };
  }
}
