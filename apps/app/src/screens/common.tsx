/**
 * Gemeinsame Bausteine der Ansichten: Abfrage-Zustände, "Nicht verfügbar", Rahmen für
 * öffentliche Seiten, Öffnen von Dokumenten.
 */
import { homeForRole } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../auth/session';
import type { DownloadResult } from '../data/api';
import { openFile } from '../lib/openFile';
import type { QueryResult } from '../data/hooks';
import { useBreakpoint, useTheme } from '../theme';
import { AppText, Banner, Button, EmptyState, ErrorState, Icon, iconSize, LoadingState, Page } from '../ui';

/** Zeigt Laden, "Nicht verfügbar", Fehler (mit Erneut versuchen) oder den Inhalt. */
export function QueryView<T>({
  query,
  loading = 'list',
  children,
  notAvailableTitle,
}: {
  query: QueryResult<T>;
  loading?: 'list' | 'detail' | 'cards';
  children: (data: T) => ReactNode;
  notAvailableTitle?: string;
}) {
  if (query.status === 'loading') return <LoadingState variant={loading} />;
  if (query.status === 'error' && query.data === undefined) {
    if (query.error?.isNotAvailable) return <NotAvailableView title={notAvailableTitle} />;
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefreshing} />;
  }
  return (
    <>
      {query.status === 'error' && query.error ? (
        <Banner
          tone="warning"
          title="Aktualisierung fehlgeschlagen"
          message="Es werden die zuletzt geladenen Daten angezeigt."
          action={<Button label="Erneut versuchen" icon="ArrowsClockwise" onPress={() => void query.refetch()} loading={query.isRefreshing} />}
        />
      ) : null}
      {children(query.data as T)}
    </>
  );
}

export function NotAvailableView({ title }: { title?: string }) {
  const { user } = useSession();
  const home = user ? homeForRole(user.role) : '/';
  return (
    <View testID="nicht-verfuegbar">
      <EmptyState
        icon="Prohibit"
        title={title ?? 'Nicht verfügbar'}
        message="Dieser Inhalt ist nicht vorhanden oder für Ihr Konto nicht freigegeben. Aufträge, Rechnungen und Nachrichten sehen nur die Personen, denen sie gehören."
        action={<Button label="Zur Startseite" variant="primary" icon="House" onPress={() => router.replace(home as Href)} />}
      />
    </View>
  );
}

/** Rahmen für öffentliche Seiten (Anmeldung, QR, Freigabelink, Zahlungsrückkehr). */
export function PublicPage({ children, width = 520, testID }: { children: ReactNode; width?: number; testID?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { device } = useBreakpoint();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.bg }} contentContainerStyle={[styles.publicScroll, { paddingTop: device === 'phone' ? 24 : 56, paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" testID={testID}>
      <View style={[styles.publicInner, { maxWidth: width }]}>
        <View style={styles.brand}>
          <View style={[styles.brandMark, { backgroundColor: t.colors.accent, borderRadius: t.radius.control }]}>
            <Icon name="Wrench" size={iconSize.lg} color={t.colors.accentText} />
          </View>
          <View>
            <AppText variant="heading">Autowerkstatt Witten</AppText>
            <AppText variant="small" tone="subtle">
              Kundenzugang und Serviceheft
            </AppText>
          </View>
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

/** Panel für öffentliche Seiten (echte Einheit, daher Fläche mit Rahmen). */
export function PublicPanel({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radius.panel }]}>{children}</View>;
}

export { Page };

/**
 * Dokument öffnen. Browser: PDF/Bilder in neuem Tab, sonst Download (Blob-URL wird wieder
 * freigegeben). Nativ: Datei wurde mit Anmelde-Header in den Cache geladen
 * (expo-file-system) und wird über das Teilen-Menü geöffnet (expo-sharing).
 */
export async function openDownload(result: DownloadResult, title?: string): Promise<'opened' | 'unsupported'> {
  return openFile(result, title);
}

const styles = StyleSheet.create({
  publicScroll: { paddingHorizontal: 16 },
  publicInner: { width: '100%', alignSelf: 'center', gap: 20 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandMark: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  panel: { borderWidth: 1, padding: 20, gap: 16 },
});
