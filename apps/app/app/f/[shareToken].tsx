/**
 * Freigegebene Fahrzeughistorie für Kaufinteressenten (ohne Konto). Nur ausgewählte
 * Einträge; abgelaufen oder widerrufen → Hinweis.
 */
import { useLocalSearchParams } from 'expo-router';
import { ERROR_CODES } from '../../src/data/errors';
import { useApiQuery } from '../../src/data/hooks';
import { PublicPage } from '../../src/screens/common';
import { PublicVehicleHistory } from '../../src/screens/PublicVehicleView';
import { EmptyState, ErrorState, LoadingState } from '../../src/ui';

export default function ShareScreen() {
  const { shareToken } = useLocalSearchParams<{ shareToken: string }>();
  const token = String(shareToken ?? '');
  const query = useApiQuery(`freigabe:${token}`, (api) => api.publicShare(token));

  if (query.status === 'loading') {
    return (
      <PublicPage>
        <LoadingState variant="detail" label="Freigabe wird geladen" />
      </PublicPage>
    );
  }
  if (query.status === 'error' && !query.data) {
    const e = query.error;
    if (e?.code === ERROR_CODES.shareExpired || e?.code === ERROR_CODES.shareRevoked || e?.status === 404) {
      const title = e.code === ERROR_CODES.shareExpired ? 'Freigabe abgelaufen' : e.code === ERROR_CODES.shareRevoked ? 'Freigabe widerrufen' : 'Link ungültig';
      const message =
        e.code === ERROR_CODES.shareExpired
          ? 'Diese Freigabe war befristet und ist abgelaufen. Bitten Sie den Halter um einen neuen Link.'
          : e.code === ERROR_CODES.shareRevoked
            ? 'Der Halter hat diese Freigabe zurückgenommen. Bitten Sie ihn bei Bedarf um einen neuen Link.'
            : 'Dieser Link ist ungültig oder unvollständig. Bitte prüfen Sie, ob Sie ihn vollständig kopiert haben.';
      return (
        <PublicPage testID="freigabe-ungueltig">
          <EmptyState icon="LinkSimple" title={title} message={message} />
        </PublicPage>
      );
    }
    return (
      <PublicPage>
        <ErrorState error={e} onRetry={() => void query.refetch()} retrying={query.isRefreshing} />
      </PublicPage>
    );
  }
  return (
    <PublicPage width={680} testID="freigabe-ansicht">
      <PublicVehicleHistory view={query.data!} />
    </PublicPage>
  );
}
