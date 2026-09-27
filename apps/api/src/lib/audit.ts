/**
 * Audit-Protokoll (nur anfügbar, per Trigger abgesichert). Protokolliert werden die Aktionen
 * aus docs/rollen-und-rechte.md Abschnitt 5. `data` enthält nie Passwörter, Tokens oder
 * Kartendaten.
 */
import type { FastifyRequest } from 'fastify';
import type { Role } from '@werkstatt/contracts';
import type { DbOrTx } from '../db/index';
import { auditLog } from '../db/schema/index';

export interface AuditContext {
  actorUserId: string | null;
  actorRole: Role | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface AuditEntryInput {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  data?: Record<string, unknown>;
}

/** Protokollierte Aktionen (Schlüssel, englisch; Anzeige deutsch im Client). */
export type AuditAction =
  | 'auth.login_succeeded'
  | 'auth.login_failed'
  | 'auth.account_locked'
  | 'auth.logout'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.password_changed'
  | 'user.invited'
  | 'user.activated'
  | 'user.updated'
  | 'user.role_changed'
  | 'user.permissions_changed'
  | 'user.disabled'
  | 'user.enabled'
  | 'customer.created'
  | 'customer.updated'
  | 'customer.archived'
  | 'customer_account.invited'
  | 'customer_account.disabled'
  | 'vehicle.created'
  | 'vehicle.updated'
  | 'vehicle.odometer_recorded'
  | 'vehicle.ownership_transferred'
  | 'vehicle.qr_public_view_changed'
  | 'vehicle.qr_rotated'
  | 'appointment.created'
  | 'appointment.requested'
  | 'appointment.confirmed'
  | 'appointment.proposed'
  | 'appointment.proposal_accepted'
  | 'appointment.proposal_declined'
  | 'appointment.cancelled'
  | 'work_order.created'
  | 'work_order.updated'
  | 'work_order.status_changed'
  | 'work_order.completion_reviewed'
  | 'work_order.ready_for_pickup'
  | 'work_order.picked_up'
  | 'work_order.assignees_changed'
  | 'intake.saved'
  | 'intake.confirmed'
  | 'work_item.added'
  | 'work_item.updated'
  | 'work_item.started'
  | 'work_item.paused'
  | 'work_item.finished'
  | 'work_item.not_done'
  | 'work_item.part_added'
  | 'finding.created'
  | 'finding.reported'
  | 'finding.dismissed'
  | 'photo.attached'
  | 'photo.visibility_changed'
  | 'approval.created'
  | 'approval.revised'
  | 'approval.sent'
  | 'approval.version_sent'
  | 'approval.withdrawn'
  | 'approval.decided'
  | 'document.created'
  | 'document.version_added'
  | 'document.published'
  | 'document.unpublished'
  | 'invoice.created'
  | 'invoice.issued'
  | 'invoice.cancelled'
  | 'checkout.created'
  | 'checkout.deactivated'
  | 'payment.recorded'
  | 'payment.manual_recorded'
  | 'payment.mismatch'
  | 'refund.requested'
  | 'refund.succeeded'
  | 'refund.failed'
  | 'service_entry.created'
  | 'service_entry.corrected'
  | 'vehicle_share.created'
  | 'vehicle_share.revoked'
  | 'vehicle_share.accessed'
  | 'settings.updated'
  | 'maintenance_type.saved'
  | 'resource.saved'
  | 'export.invoices_csv'
  | 'export.customer_data';

export type AuditEntityType =
  | 'auth'
  | 'user'
  | 'customer'
  | 'vehicle'
  | 'appointment'
  | 'work_order'
  | 'work_item'
  | 'finding'
  | 'photo'
  | 'approval_request'
  | 'document'
  | 'invoice'
  | 'checkout'
  | 'payment'
  | 'refund'
  | 'service_entry'
  | 'vehicle_share'
  | 'settings'
  | 'maintenance_type'
  | 'resource'
  | 'export';

export const SYSTEM_AUDIT_CONTEXT: AuditContext = { actorUserId: null, actorRole: null, ip: null, userAgent: null, requestId: null };

export function auditContextFrom(request: FastifyRequest): AuditContext {
  const ua = request.headers['user-agent'];
  return {
    actorUserId: request.actor?.userId ?? null,
    actorRole: request.actor?.role ?? null,
    ip: request.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null,
    requestId: request.id ?? null,
  };
}

export async function audit(tx: DbOrTx, ctx: AuditContext, entry: AuditEntryInput): Promise<void> {
  await tx.insert(auditLog).values({
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    data: entry.data ?? {},
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  });
}
