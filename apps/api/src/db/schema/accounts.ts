/** 1. Zugang und Konten (docs/datenmodell.md) */
import { boolean, index, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import {
  citext,
  createdAt,
  devicePlatformEnum,
  invitationPurposeEnum,
  notificationChannelEnum,
  permissionEnum,
  pk,
  roleEnum,
  tstz,
  updatedAt,
  userStatusEnum,
} from './common';
import { customers } from './customers';

export const users = pgTable('users', {
  id: pk(),
  email: citext('email').notNull().unique(),
  /** argon2id; null, solange die Einladung nicht angenommen wurde */
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  role: roleEnum('role').notNull(),
  status: userStatusEnum('status').notNull().default('invited'),
  lastLoginAt: tstz('last_login_at'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: tstz('locked_until'),
  passwordChangedAt: tstz('password_changed_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userPermissionOverrides = pgTable(
  'user_permission_overrides',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    permission: permissionEnum('permission').notNull(),
    granted: boolean('granted').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permission] })],
);

export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** SHA-256 (hex) des undurchsichtigen Tokens; das Token selbst wird nie gespeichert */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    lastUsedAt: tstz('last_used_at'),
    revokedAt: tstz('revoked_at'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const invitations = pgTable(
  'invitations',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    purpose: invitationPurposeEnum('purpose').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    revokedAt: tstz('revoked_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('invitations_user_idx').on(t.userId)],
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('password_resets_user_idx').on(t.userId)],
);

export const customerAccounts = pgTable('customer_accounts', {
  id: pk(),
  customerId: uuid('customer_id')
    .notNull()
    .unique()
    .references(() => customers.id),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  createdAt: createdAt(),
});

export const devices = pgTable(
  'devices',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    platform: devicePlatformEnum('platform').notNull(),
    pushToken: text('push_token').notNull().unique(),
    lastSeenAt: tstz('last_seen_at'),
    disabledAt: tstz('disabled_at'),
    createdAt: createdAt(),
  },
  (t) => [index('devices_user_idx').on(t.userId)],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    eventType: text('event_type').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventType, t.channel] })],
);
