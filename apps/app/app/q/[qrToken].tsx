/**
 * QR-Einstieg. Angemeldet und berechtigt → Fahrzeugakte der Rolle. Öffentliche Kurzansicht
 * nur, wenn der Halter sie eingeschaltet hat. Sonst Hinweis und Anmeldung.
 * Unbekannter Code → "Code nicht gefunden". Der QR-Code ist kein Generalschlüssel.
 */
import { routes } from '@werkstatt/contracts';
import { Redirect, router, useLocalSearchParams, type Href } from 'expo-router';
import { useSession } from '../../src/auth/session';
import { useApiQuery } from '../../src/data/hooks';
import { PublicPage, PublicPanel } from '../../src/screens/common';
import { PublicVehicleHistory } from '../../src/screens/PublicVehicleView';
import { AppText, Button, EmptyState, ErrorState, LoadingState } from '../../src/ui';

export default function QrScreen() {
  const { qrToken } = useLocalSearchParams<{ qrToken: string }>();
  const session = useSession();
  const token = String(qrToken ?? '');
  // Abfrage erst, wenn die Sitzung geklärt ist (angemeldete Halter werden weitergeleitet).
  const query = useApiQuery(session.status === 'loading' ? null : `qr:${token}:${session.user?.id ?? 'anonym'}`, (api) => api.resolveQr(token));
  const loginHref = routes.login(routes.qr(token)) as Href;

  if (session.status === 'loading' || query.status === 'loading') {
    return (
      <PublicPage>
        <LoadingState variant="detail" label="Code wird geprüft" />
      </PublicPage>
    );
  }
  if (query.status === 'error' && !query.data) {
    if (query.error?.status === 404) {
      return (
        <PublicPage testID="qr-unbekannt">
          <EmptyState
            icon="QrCode"
            title="Code nicht gefunden"
            message="Dieser QR-Code ist der Autowerkstatt Witten nicht bekannt oder wurde ersetzt. Bitte sprechen Sie uns an."
            action={<Button label="Zur Anmeldung" onPress={() => router.replace(routes.login() as Href)} />}
          />
        </PublicPage>
      );
    }
    return (
      <PublicPage>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefreshing} />
      </PublicPage>
    );
  }
  const r = query.data!;
  if (r.mode === 'authorized') return <Redirect href={r.targetPath as Href} />;
  if (r.mode === 'public') {
    return (
      <PublicPage width={680} testID="qr-kurzansicht">
        <PublicVehicleHistory view={r.view} />
        {!session.user ? (
          <PublicPanel>
            <AppText tone="muted">Sind Sie Halter dieses Fahrzeugs? Nach der Anmeldung sehen Sie Ihre vollständige Fahrzeugakte.</AppText>
            <Button label="Als Halter anmelden" icon="Lock" onPress={() => router.push(loginHref)} />
          </PublicPanel>
        ) : null}
      </PublicPage>
    );
  }
  return (
    <PublicPage testID="qr-anmeldung-noetig">
      <PublicPanel>
        <AppText variant="display">Serviceheft der {r.workshopName}</AppText>
        <AppText tone="muted">
          Dieses Fahrzeug hat ein digitales Serviceheft. Die Einträge sind nur für den Halter sichtbar. Bitte melden Sie sich an, um die Fahrzeugakte zu öffnen.
        </AppText>
        {session.user ? (
          <AppText tone="muted">Mit Ihrem aktuellen Zugang haben Sie keinen Zugriff auf dieses Fahrzeug.</AppText>
        ) : (
          <Button label="Anmelden" variant="primary" icon="Lock" onPress={() => router.push(loginHref)} testID="qr-anmelden" />
        )}
      </PublicPanel>
    </PublicPage>
  );
}
