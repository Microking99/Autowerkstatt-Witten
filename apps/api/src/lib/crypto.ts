import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';

/** Undurchsichtiges Token mit 256 Bit Zufall (base64url, 43 Zeichen). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** argon2id nach OWASP-Mindestempfehlung (19 MiB, 2 Durchläufe, 1 Thread). */
const ARGON2_OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Prüft gegen einen Platzhalter-Hash, damit unbekannte E-Mail-Adressen und falsche Passwörter
 * gleich lange dauern (keine Preisgabe über die Antwortzeit).
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomToken());
  await verifyPassword(await dummyHash, password);
}
