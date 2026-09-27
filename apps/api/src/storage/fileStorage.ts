/**
 * Dateispeicher (R-ARCH-2). Binärdaten liegen nie öffentlich; Abruf ausschließlich über
 * rechtegeprüfte API-Routen (/documents/:id/download, /photos/:id/content).
 *
 * Implementierungen: lokal (`LocalFileStorage`) und später S3-kompatibel (EU-Rechenzentrum),
 * beide hinter demselben Interface.
 */
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { randomToken } from '../lib/crypto';

export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  /** Liefert einen Lesestrom; wirft, wenn der Schlüssel fehlt. */
  read(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

/** Nur erzeugte Schlüssel der Form `yyyy/mm/<zufall>` sind gültig (kein Pfad-Traversal). */
const KEY_PATTERN = /^[0-9]{4}\/[0-9]{2}\/[A-Za-z0-9_-]{20,64}$/;

export function newStorageKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear().toString();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}/${m}/${randomToken(24)}`;
}

export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Ungültiger Speicherschlüssel');
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Ungültiger Speicherschlüssel');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const tmp = `${target}.${randomToken(8)}.tmp`;
    await writeFile(tmp, data, { mode: 0o600, flag: 'wx' });
    await rename(tmp, target);
  }

  async read(key: string): Promise<Readable> {
    const target = this.resolve(key);
    await stat(target);
    return createReadStream(target);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch {
      // bereits entfernt
    }
  }
}
