/**
 * SHA-256 und kanonisches JSON für den Demo-Modus: dieselben Funktionen wie in API und
 * Geschäftslogik (@werkstatt/domain, plattformneutral über @noble/hashes).
 */
import { canonicalJson, sha256Hex } from '@werkstatt/domain';

export { canonicalJson, sha256Hex };

export function contentHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
