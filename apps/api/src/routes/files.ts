/**
 * Datei-Upload (multipart). Größenlimit (Standard 15 MB), erlaubt nur JPEG, PNG, WebP,
 * HEIC/HEIF und PDF, geprüft an der Dateisignatur; SHA-256 wird gespeichert. Hochgeladene
 * Dateien sind erst über rechtegeprüfte Zuordnungen (Dokument, Foto, Chat) abrufbar.
 */
import { eq } from 'drizzle-orm';
import { FileRefSchema, type FileRef, API_ERROR_CODES } from '@werkstatt/contracts';
import type { DbOrTx } from '../db/index';
import { files } from '../db/schema/index';
import { sha256Hex } from '../lib/crypto';
import { HttpError, badRequest, notFound } from '../lib/errors';
import { requireActor } from '../lib/http';
import { detectMimeType, sanitizeFileName } from '../storage/fileSignature';
import { newStorageKey } from '../storage/fileStorage';
import type { App } from '../types';
import type { Actor } from '@werkstatt/domain';

type FileRow = typeof files.$inferSelect;

export function toFileRef(row: FileRow): FileRef {
  return { id: row.id, originalName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, sha256: row.sha256 };
}

/**
 * Datei für eine Zuordnung laden. Kunden dürfen nur eigene Uploads verwenden (sonst könnten
 * sie interne Dateien über eine eigene Nachricht abrufbar machen); Mitarbeiter jede Datei.
 */
export async function loadAttachableFile(db: DbOrTx, actor: Actor, fileId: string): Promise<FileRow> {
  const [row] = await db.select().from(files).where(eq(files.id, fileId));
  if (!row) throw notFound('Datei nicht gefunden.');
  if (actor.role === 'customer' && row.uploadedBy !== actor.userId) throw notFound('Datei nicht gefunden.');
  return row;
}

export async function fileRoutes(app: App): Promise<void> {
  app.post(
    '/files',
    {
      schema: { response: { 201: FileRefSchema } },
      // Schutz vor Speicherfüllung: höchstens 120 Uploads je Konto und Stunde (Review 5.2)
      config: { rateLimit: { max: 120, timeWindow: '1 hour', hook: 'preHandler' as const, keyGenerator: (req: { actor?: { userId: string } | null; ip: string }) => req.actor?.userId ?? req.ip } },
    },
    async (request, reply) => {
    const actor = requireActor(request);
    if (!request.isMultipart()) throw new HttpError(415, API_ERROR_CODES.unsupportedMediaType, 'Bitte als multipart/form-data hochladen.');
    const part = await request.file();
    if (!part) throw badRequest('Keine Datei übermittelt.');
    const data = await part.toBuffer();
    if (part.file.truncated) throw new HttpError(413, API_ERROR_CODES.payloadTooLarge, 'Die Datei ist zu groß.');
    if (data.length === 0) throw badRequest('Die Datei ist leer.');
    const mimeType = detectMimeType(data);
    if (!mimeType) {
      throw new HttpError(415, API_ERROR_CODES.unsupportedFileType, 'Nur JPEG, PNG, WebP, HEIC und PDF sind erlaubt.');
    }
    const { db, storage, now } = app.deps;
    const storageKey = newStorageKey(now());
    await storage.put(storageKey, data);
    const [row] = await db
      .insert(files)
      .values({
        storageKey,
        originalName: sanitizeFileName(part.filename || 'datei'),
        mimeType,
        sizeBytes: data.length,
        sha256: sha256Hex(data),
        uploadedBy: actor.userId,
      })
      .returning();
    return reply.code(201).send(toFileRef(row!));
    },
  );
}
