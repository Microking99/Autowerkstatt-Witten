/** Änderungsprotokoll (Recht audit.read), nur lesend. */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AuditEntrySchema, IdSchema } from '@werkstatt/contracts';
import { hasPermission } from '@werkstatt/domain';
import { auditLog, users } from '../db/schema/index';
import { ensure, requireActor } from '../lib/http';
import type { App } from '../types';

const QuerySchema = z.object({
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(80).optional(),
  actorId: IdSchema.optional(),
  action: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export async function auditRoutes(app: App): Promise<void> {
  app.get('/audit', { schema: { querystring: QuerySchema, response: { 200: z.array(AuditEntrySchema) } } }, async (request) => {
    ensure(hasPermission(requireActor(request), 'audit.read'));
    const { db } = app.deps;
    const q = request.query;
    const rows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          q.entityType ? eq(auditLog.entityType, q.entityType) : undefined,
          q.entityId ? eq(auditLog.entityId, q.entityId) : undefined,
          q.actorId ? eq(auditLog.actorUserId, q.actorId) : undefined,
          q.action ? eq(auditLog.action, q.action) : undefined,
        ),
      )
      .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
      .limit(q.limit);
    const ids = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
    const names = ids.length > 0 ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, ids)) : [];
    return rows.map((r) => ({
      id: String(r.id),
      occurredAt: r.occurredAt.toISOString(),
      actorDisplayName: r.actorUserId ? (names.find((n) => n.id === r.actorUserId)?.displayName ?? null) : null,
      actorRole: r.actorRole,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      data: r.data,
    }));
  });
}
