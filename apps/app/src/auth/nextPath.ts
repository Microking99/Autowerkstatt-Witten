import { areaForPath, homeForRole, safeNextPath, type SessionUser } from '@werkstatt/contracts';
import { canEnterArea } from './guards';

/**
 * Ziel nach der Anmeldung: nur interne Pfade (safeNextPath) und nur, wenn der Bereich zur
 * Rolle passt; sonst die Startseite der Rolle.
 */
export function targetAfterLogin(user: SessionUser, next: string | string[] | undefined): string {
  const raw = Array.isArray(next) ? next[0] : next;
  const safe = safeNextPath(raw ?? null);
  if (!safe) return homeForRole(user.role);
  const area = areaForPath(safe);
  if (area === 'public') return safe.startsWith('/anmelden') ? homeForRole(user.role) : safe;
  return canEnterArea(user, area) ? safe : homeForRole(user.role);
}
