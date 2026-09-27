/** 10. Benachrichtigungen, Idempotenz, Audit */
import { bigint, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, notificationChannelEnum, notificationStatusEnum, pk, roleEnum, tstz } from './common';
import { users } from './accounts';

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    eventType: text('event_type').notNull(),
    /** nur Titel/Kurztext ohne sensible Inhalte */
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** nur Pfad mit IDs (docs/ansichten-und-routen.md Abschnitt 6) */
    targetPath: text('target_path').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    status: notificationStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: tstz('next_attempt_at').notNull().defaultNow(),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key').notNull().unique(),
    sentAt: tstz('sent_at'),
    readAt: tstz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.channel, t.createdAt),
    index('notifications_pending_idx').on(t.status, t.nextAttemptAt),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: pk(),
    key: text('key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Methode + konkreter Pfad */
    route: text('route').notNull(),
    /** SHA-256 des Anfragekörpers, um Wiederverwendung mit anderem Inhalt zu erkennen */
    requestHash: text('request_hash').notNull(),
    /** null, solange die erste Anfrage noch läuft */
    statusCode: integer('status_code'),
    response: jsonb('response').$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => [unique('idempotency_keys_uq').on(t.userId, t.route, t.key), index('idempotency_keys_created_idx').on(t.createdAt)],
);

/** Nur anfügbar; UPDATE/DELETE verhindert ein Trigger (Migration 0002). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorRole: roleEnum('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_actor_idx').on(t.actorUserId),
    index('audit_log_occurred_idx').on(t.occurredAt),
  ],
);
