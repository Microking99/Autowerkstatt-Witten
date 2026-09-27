/**
 * Erkennt den Dateityp anhand der Dateisignatur ("magic bytes"), nicht anhand der Angabe
 * des Clients. Erlaubt: JPEG, PNG, WebP, HEIC/HEIF, PDF.
 */
export type AllowedMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'application/pdf';

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

export function detectMimeType(buf: Buffer): AllowedMimeType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const major = buf.toString('ascii', 8, 12);
    if (HEIF_BRANDS.has(major)) return 'image/heic';
    // kompatible Marken im ftyp-Kasten prüfen
    const boxSize = buf.readUInt32BE(0);
    const end = Math.min(boxSize, buf.length, 64);
    for (let off = 16; off + 4 <= end; off += 4) {
      if (HEIF_BRANDS.has(buf.toString('ascii', off, off + 4))) return 'image/heic';
    }
  }
  return null;
}

export const EXTENSION_BY_MIME: Record<AllowedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

/** Dateiname für Content-Disposition: nur unkritische Zeichen, Länge begrenzt. */
export function sanitizeFileName(name: string, fallback = 'datei'): string {
  const base = path_basename(name)
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, '_')
    .trim()
    .slice(0, 150);
  return base.length > 0 ? base : fallback;
}

function path_basename(name: string): string {
  const parts = name.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

/** Content-Disposition mit ASCII-Ersatz und RFC-5987-Kodierung. */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const safe = sanitizeFileName(fileName);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
