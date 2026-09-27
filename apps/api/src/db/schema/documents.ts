/** 7. Dokumente, Fotos (siehe workOrders.ts), Chat */
import { bigint, index, integer, pgTable, primaryKey, text, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, documentKindEnum, pk, tstz, updatedAt, visibilityEnum } from './common';
import { users } from './accounts';
import { customers, vehicles } from './customers';
import { workOrders } from './workOrders';

export const files = pgTable('files', {
  id: pk(),
  /** Schlüssel im Dateispeicher (lokal / S3-kompatibel); nie öffentlich erreichbar */
  storageKey: text('storage_key').notNull().unique(),
  originalName: text('original_name').notNull(),
  /** aus der Dateisignatur ermittelt, nicht aus der Angabe des Clients */
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: createdAt(),
});

export const documents = pgTable(
  'documents',
  {
    id: pk(),
    kind: documentKindEnum('kind').notNull(),
    title: text('title').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),
    workOrderId: uuid('work_order_id').references(() => workOrders.id),
    /** Standard intern; kundensichtbar nur mit customer_id */
    visibility: visibilityEnum('visibility').notNull().default('internal'),
    publishedAt: tstz('published_at'),
    publishedBy: uuid('published_by').references(() => users.id),
    currentVersionId: uuid('current_version_id').references((): AnyPgColumn => documentVersions.id),
    deletedAt: tstz('deleted_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('documents_customer_idx').on(t.customerId),
    index('documents_work_order_idx').on(t.workOrderId),
    index('documents_vehicle_idx').on(t.vehicleId),
  ],
);

export const documentVersions = pgTable(
  'document_versions',
  {
    id: pk(),
    documentId: uuid('document_id')
      .notNull()
      .references((): AnyPgColumn => documents.id),
    versionNo: integer('version_no').notNull(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [unique('document_versions_doc_no_uq').on(t.documentId, t.versionNo)],
);

export const messages = pgTable(
  'messages',
  {
    id: pk(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull().default(''),
    clientMessageId: text('client_message_id'),
    createdAt: createdAt(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    /** wiederholtes Senden nach Verbindungsabbruch erzeugt keine Dubletten */
    unique('messages_author_client_id_uq').on(t.authorUserId, t.clientMessageId),
    index('messages_work_order_idx').on(t.workOrderId, t.createdAt),
  ],
);

export const messageAttachments = pgTable(
  'message_attachments',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    /** Foto-Datensatz (Kontext chat), über den der Inhalt rechtegeprüft abgerufen wird */
    photoId: uuid('photo_id'),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.fileId] })],
);

export const conversationReads = pgTable(
  'conversation_reads',
  {
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    lastReadAt: tstz('last_read_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workOrderId, t.userId] })],
);

export const internalNotes = pgTable(
  'internal_notes',
  {
    id: pk(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('internal_notes_work_order_idx').on(t.workOrderId)],
);
