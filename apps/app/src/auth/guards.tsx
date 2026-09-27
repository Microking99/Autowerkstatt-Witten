/**
 * Bereichsschutz der Oberfläche (docs/ansichten-und-routen.md):
 * - nicht angemeldet → /anmelden?weiter=<aktueller Pfad>
 * - fremder Rollenbereich → Startseite der eigenen Rolle
 * Das ist keine Rechteprüfung; die API verweigert Fremdes ohnehin (404/403).
 */
import { homeForRole, routes, type SessionUser } from '@werkstatt/contracts';
import { Redirect, useGlobalSearchParams, usePathname, useSegments } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { LoadingState } from '../ui';
import { useTheme } from '../theme';
import { useSession } from './session';

export type Area = 'customer' | 'mechanic' | 'workshop';

export function canEnterArea(user: SessionUser, area: Area): boolean {
  switch (area) {
    case 'customer':
      return user.role === 'customer';
    case 'workshop':
      return user.role === 'admin' || user.role === 'service';
    case 'mechanic':
      return user.role === 'mechanic' || ((user.role === 'admin' || user.role === 'service') && user.permissions.includes('workItems.execute'));
  }
}

/** Aktueller Pfad inkl. Query (für das Rückkehrziel nach der Anmeldung). */
export function useCurrentHref(): string {
  const pathname = usePathname();
  const params = useGlobalSearchParams<Record<string, string | string[]>>();
  const segments = useSegments() as string[];
  const dynamic = new Set(segments.filter((s) => s.startsWith('[')).map((s) => s.replace(/^\[\.{0,3}|\]$/g, '')));
  const query = Object.entries(params)
    .filter(([k]) => !dynamic.has(k))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : v)}`);
  return query.length ? `${pathname}?${query.join('&')}` : pathname;
}

export function FullPageLoading() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg, padding: 24 }}>
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <LoadingState variant="detail" label="Anmeldung wird geprüft" />
      </View>
    </View>
  );
}

export function AreaGuard({ area, children }: { area: Area; children: ReactNode }) {
  const { status, user } = useSession();
  const href = useCurrentHref();
  if (status === 'loading') return <FullPageLoading />;
  if (status === 'signedOut' || !user) return <Redirect href={routes.login(href)} />;
  if (!canEnterArea(user, area)) return <Redirect href={homeForRole(user.role)} />;
  return <>{children}</>;
}
