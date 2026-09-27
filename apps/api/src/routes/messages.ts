/**
 * Auftragsbezogener Chat (R-CHAT-1): idempotent über clientMessageId, Ungelesen-Zähler,
 * Anhänge als rechtegeprüfte Fotos. Interne Notizen sind getrennt und nie für Kunden.
 */
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  API_PREFIX,
  ConversationSchema,
  InternalNoteInputSchema,
  InternalNoteSchema,
  IsoDateTimeSchema,
  MessageSchema,
  SendMessageRequestSchema,
  type Conversation,
  type Message,
} from '@werkstatt/contracts';
import { canSendMessage, canViewInternalNotes, canViewMessages, type Actor } from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { conversationReads, customers, files, internalNotes, messageAttachments, messages, photos, users, workOrders } from '../db/schema/index';
import { conflict } from '../lib/errors';
import { IdParamsSchema, ensure, requireActor } from '../lib/http';
import { enqueueNotification, notificationTargets, serviceRecipientIds } from '../notifications/outbox';
import { loadWorkOrder, workOrderAccessInput, workOrderListCondition } from '../services/access';
import { customerDisplayName } from '../services/customers';
import { customerUserId } from '../services/recipients';
import { ensureFound } from '../lib/http';
import { loadAttachableFile } from './files';
import type { App } from '../types';

type MessageRow = typeof messages.$inferSelect;

async function toMessageDtos(db: DbOrTx, rows: MessageRow[]): Promise<Message[]> {
  if (rows.length === 0) return [];
  const authorIds = [...new Set(rows.map((r) => r.authorUserId))];
  const authors = await db.select({ id: users.id, displayName: users.displayName, role: users.role }).from(users).where(inArray(users.id, authorIds));
  const attachments = await db
    .select({ messageId: messageAttachments.messageId, fileId: messageAttachments.fileId, photoId: messageAttachments.photoId, mimeType: files.mimeType })
    .from(messageAttachments)
    .innerJoin(files, eq(files.id, messageAttachments.fileId))
    .where(inArray(messageAttachments.messageId, rows.map((r) => r.id)));
  return rows.map((r) => {
    const a = authors.find((x) => x.id === r.authorUserId);
    return {
      id: r.id,
      workOrderId: r.workOrderId,
      author: { userId: r.authorUserId, displayName: a?.displayName ?? '', role: a?.role ?? 'customer' },
      body: r.body,
      attachments: attachments
        .filter((x) => x.messageId === r.id)
        .map((x) => ({ fileId: x.fileId, contentUrl: `${API_PREFIX}/photos/${x.photoId}/content`, mimeType: x.mimeType })),
      clientMessageId: r.clientMessageId,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

async function loadForChat(db: DbOrTx, actor: Actor, workOrderId: string) {
  const loaded = ensureFound(await loadWorkOrder(db, workOrderId));
  ensure(canViewMessages(actor, loaded.access));
  return loaded;
}

export async function messageRoutes(app: App): Promise<void> {
  app.get('/conversations', { schema: { response: { 200: z.array(ConversationSchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    if (actor.role !== 'customer' && !actor.permissions.has('messages.customerChat')) return [];
    const woRows = await db
      .select()
      .from(workOrders)
      .where(and(workOrderListCondition(actor), sql`EXISTS (SELECT 1 FROM ${messages} m WHERE m.work_order_id = ${workOrders.id} AND m.deleted_at IS NULL)`));
    const result: Conversation[] = [];
    for (const wo of woRows) {
      const access = await workOrderAccessInput(db, wo);
      if (!canViewMessages(actor, access).allowed) continue;
      const [last] = await db
        .select()
        .from(messages)
        .where(and(eq(messages.workOrderId, wo.id), isNull(messages.deletedAt)))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      const [read] = await db
        .select()
        .from(conversationReads)
        .where(and(eq(conversationReads.workOrderId, wo.id), eq(conversationReads.userId, actor.userId)));
      const [unread] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          and(
            eq(messages.workOrderId, wo.id),
            isNull(messages.deletedAt),
            sql`${messages.authorUserId} <> ${actor.userId}`,
            read ? gt(messages.createdAt, read.lastReadAt) : undefined,
          ),
        );
      const [customer] = await db.select().from(customers).where(eq(customers.id, wo.customerId));
      const [lastDto] = last ? await toMessageDtos(db, [last]) : [];
      result.push({
        workOrderId: wo.id,
        orderNumber: wo.orderNumber,
        title: wo.title,
        counterpartDisplayName: actor.role === 'customer' ? 'Autowerkstatt Witten' : customer ? customerDisplayName(customer) : '',
        lastMessage: lastDto ?? null,
        unreadCount: unread?.n ?? 0,
      });
    }
    return result.sort(
      (a, b) =>
        (b.unreadCount > 0 ? 1 : 0) - (a.unreadCount > 0 ? 1 : 0) ||
        (b.lastMessage?.createdAt ?? '').localeCompare(a.lastMessage?.createdAt ?? ''),
    );
  });

  app.get(
    '/work-orders/:id/messages',
    { schema: { params: IdParamsSchema, querystring: z.object({ after: IsoDateTimeSchema.optional() }), response: { 200: z.array(MessageSchema) } } },
    async (request) => {
      const actor = requireActor(request);
      const { db } = app.deps;
      const { wo } = await loadForChat(db, actor, request.params.id);
      const rows = await db
        .select()
        .from(messages)
        .where(and(eq(messages.workOrderId, wo.id), isNull(messages.deletedAt), request.query.after ? gt(messages.createdAt, new Date(request.query.after)) : undefined))
        .orderBy(asc(messages.createdAt))
        .limit(1000);
      return toMessageDtos(db, rows);
    },
  );

  app.post(
    '/work-orders/:id/messages',
    { schema: { params: IdParamsSchema, body: SendMessageRequestSchema, response: { 201: MessageSchema, 200: MessageSchema } } },
    async (request, reply) => {
      const actor = requireActor(request);
      const { db, now: clock, realtime } = app.deps;
      const now = clock();
      const body = request.body;
      const loaded = ensureFound(await loadWorkOrder(db, request.params.id));
      ensure(canSendMessage(actor, loaded.access));
      const { row, created } = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(messages)
          .values({ workOrderId: loaded.wo.id, authorUserId: actor.userId, body: body.body, clientMessageId: body.clientMessageId, createdAt: now })
          .onConflictDoNothing({ target: [messages.authorUserId, messages.clientMessageId] })
          .returning();
        if (!inserted[0]) {
          // Wiederholtes Senden (Verbindungsabbruch): vorhandene Nachricht liefern
          const [existing] = await tx
            .select()
            .from(messages)
            .where(and(eq(messages.authorUserId, actor.userId), eq(messages.clientMessageId, body.clientMessageId)));
          if (!existing || existing.workOrderId !== loaded.wo.id) throw conflict('client_message_id_in_use', 'Diese Nachrichten-ID wurde bereits verwendet.');
          return { row: existing, created: false };
        }
        const message = inserted[0];
        for (const fileId of [...new Set(body.fileIds)]) {
          const file = await loadAttachableFile(tx, actor, fileId);
          const [photo] = await tx
            .insert(photos)
            .values({ fileId: file.id, workOrderId: loaded.wo.id, context: 'chat', visibility: 'customer', takenBy: actor.userId, takenAt: now })
            .returning();
          await tx.insert(messageAttachments).values({ messageId: message.id, fileId: file.id, photoId: photo!.id });
        }
        // eigene Nachricht gilt als gelesen
        await tx
          .insert(conversationReads)
          .values({ workOrderId: loaded.wo.id, userId: actor.userId, lastReadAt: now })
          .onConflictDoUpdate({ target: [conversationReads.workOrderId, conversationReads.userId], set: { lastReadAt: now } });
        const recipients =
          actor.role === 'customer'
            ? (await serviceRecipientIds(tx)).map((userId) => ({ userId, targetPath: notificationTargets.messageForStaff(loaded.wo.id) }))
            : await customerUserId(tx, loaded.wo.customerId).then((uid) => (uid ? [{ userId: uid, targetPath: notificationTargets.messageForCustomer(loaded.wo.id) }] : []));
        await enqueueNotification(
          tx,
          {
            eventType: 'message.received',
            title: 'Neue Nachricht',
            body: `Neue Nachricht zu Auftrag ${loaded.wo.orderNumber}.`,
            recipients: recipients.filter((r) => r.userId !== actor.userId),
            dedupeKey: `message.received:${message.id}`,
          },
          now,
        );
        return { row: message, created: true };
      });
      if (created) realtime.publish({ type: 'message.created', workOrderId: loaded.wo.id, messageId: row.id });
      const [dto] = await toMessageDtos(db, [row]);
      return reply.code(created ? 201 : 200).send(dto!);
    },
  );

  app.post('/work-orders/:id/messages/read', { schema: { params: IdParamsSchema } }, async (request, reply) => {
    const actor = requireActor(request);
    const { db, now: clock } = app.deps;
    const now = clock();
    const { wo } = await loadForChat(db, actor, request.params.id);
    await db
      .insert(conversationReads)
      .values({ workOrderId: wo.id, userId: actor.userId, lastReadAt: now })
      .onConflictDoUpdate({ target: [conversationReads.workOrderId, conversationReads.userId], set: { lastReadAt: now } });
    return reply.code(204).send();
  });

  app.get('/work-orders/:id/internal-notes', { schema: { params: IdParamsSchema, response: { 200: z.array(InternalNoteSchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    const loaded = ensureFound(await loadWorkOrder(db, request.params.id));
    ensure(canViewInternalNotes(actor, loaded.access));
    const rows = await db
      .select({ n: internalNotes, name: users.displayName })
      .from(internalNotes)
      .innerJoin(users, eq(users.id, internalNotes.authorUserId))
      .where(eq(internalNotes.workOrderId, loaded.wo.id))
      .orderBy(asc(internalNotes.createdAt));
    return rows.map(({ n, name }) => ({ id: n.id, workOrderId: n.workOrderId, author: { userId: n.authorUserId, displayName: name }, body: n.body, createdAt: n.createdAt.toISOString() }));
  });

  app.post(
    '/work-orders/:id/internal-notes',
    { schema: { params: IdParamsSchema, body: InternalNoteInputSchema, response: { 201: InternalNoteSchema } } },
    async (request, reply) => {
      const actor = requireActor(request);
      const { db } = app.deps;
      const loaded = ensureFound(await loadWorkOrder(db, request.params.id));
      ensure(canViewInternalNotes(actor, loaded.access));
      const [n] = await db.insert(internalNotes).values({ workOrderId: loaded.wo.id, authorUserId: actor.userId, body: request.body.body }).returning();
      const [author] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, actor.userId));
      return reply
        .code(201)
        .send({ id: n!.id, workOrderId: n!.workOrderId, author: { userId: actor.userId, displayName: author?.displayName ?? '' }, body: n!.body, createdAt: n!.createdAt.toISOString() });
    },
  );
}
