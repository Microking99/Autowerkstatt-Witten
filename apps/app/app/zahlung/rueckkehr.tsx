/**
 * Rückkehr vom Zahlungsanbieter. Zeigt "Zahlung wird geprüft" und fragt den Status beim
 * Server ab (refreshPaymentStatus), bis dieser die Zahlung bestätigt. Die Rückkehr selbst
 * und eine Erfolgsseite des Anbieters ändern nichts am Rechnungsstatus (R-ZAHL-4).
 * Maßgeblich sind nur paymentStatus und openCents der Rechnung (Kunden sehen keine
 * Zahlungsversuche). Bleibt die Bestätigung aus, sagt die Seite genau das.
 */
import { routes } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AreaGuard } from '../../src/auth/guards';
import { IS_DEMO } from '../../src/config';
import { useApiQuery } from '../../src/data/hooks';
import { useDemo } from '../../src/demo/DemoPanel';
import { formatDateTime, formatMoney } from '../../src/lib/format';
import { NotAvailableView, PublicPage, PublicPanel } from '../../src/screens/common';
import { useTheme } from '../../src/theme';
import { AppText, Banner, Button, ErrorState, Icon, iconSize, LoadingState, Skeleton } from '../../src/ui';

export default function PaymentReturnScreen() {
  return (
    <AreaGuard area="customer">
      <PaymentReturn />
    </AreaGuard>
  );
}

function PaymentReturn() {
  const t = useTheme();
  const params = useLocalSearchParams<{ rechnung?: string; abgebrochen?: string }>();
  const invoiceId = String(params.rechnung ?? '');
  const cancelledHint = params.abgebrochen === '1';
  const { openPanel } = useDemo();
  const query = useApiQuery(invoiceId ? `zahlung:${invoiceId}` : null, (api) => api.refreshPaymentStatus(invoiceId), { pollMs: 3000 });
  const announced = useRef(false);

  const invoice = query.data;
  const paid = invoice ? invoice.paymentStatus === 'paid' || invoice.openCents === 0 : false;
  const notCompleted = !paid && cancelledHint;
  // Anzahl der Statusabfragen ohne Bestätigung; danach ehrlich "noch nicht bestätigt"
  const [polls, setPolls] = useState(0);
  useEffect(() => {
    if (invoice) setPolls((n) => n + 1);
  }, [invoice]);
  const unconfirmed = !paid && !notCompleted && polls > 4;

  useEffect(() => {
    if (paid) announced.current = true;
  }, [paid]);

  if (!invoiceId) {
    return (
      <PublicPage>
        <NotAvailableView />
      </PublicPage>
    );
  }
  if (query.status === 'loading') {
    return (
      <PublicPage>
        <LoadingState variant="detail" label="Zahlungsstatus wird abgefragt" />
      </PublicPage>
    );
  }
  if (query.status === 'error' && !invoice) {
    return (
      <PublicPage>
        {query.error?.isNotAvailable ? <NotAvailableView /> : <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefreshing} title="Status konnte nicht abgefragt werden" />}
      </PublicPage>
    );
  }
  const inv = invoice!;
  const backToInvoice = () => router.replace(routes.customer.invoice(inv.id) as Href);

  if (paid) {
    return (
      <PublicPage testID="zahlung-bestaetigt">
        <PublicPanel>
          <View style={[styles.icon, { backgroundColor: t.colors.successSoft, borderRadius: t.radius.pill }]}>
            <Icon name="CheckCircle" size={iconSize.xl} color={t.colors.success} />
          </View>
          <AppText variant="display" role="alert">
            Zahlung bestätigt
          </AppText>
          <AppText tone="muted">
            Der Zahlungsanbieter hat die Zahlung für Rechnung {inv.invoiceNumber} bestätigt und wir haben sie geprüft. Vielen Dank.
          </AppText>
          <AppText variant="heading" numeric>
            {formatMoney(inv.paidCents)}
          </AppText>
          {inv.payments[0] ? (
            <AppText variant="small" tone="subtle" numeric>
              Eingegangen am {formatDateTime(inv.payments[inv.payments.length - 1]!.receivedAt)}
            </AppText>
          ) : null}
          <Button label="Zur Rechnung" variant="primary" onPress={backToInvoice} />
        </PublicPanel>
      </PublicPage>
    );
  }

  if (notCompleted) {
    return (
      <PublicPage testID="zahlung-abgebrochen">
        <PublicPanel>
          <View style={[styles.icon, { backgroundColor: t.colors.warningSoft, borderRadius: t.radius.pill }]}>
            <Icon name="XCircle" size={iconSize.xl} color={t.colors.warning} />
          </View>
          <AppText variant="display">Zahlung nicht abgeschlossen</AppText>
          <AppText tone="muted">
            {cancelledHint ? 'Sie haben die Zahlung abgebrochen.' : 'Der Zahlungsanbieter meldet, dass die Zahlung nicht abgeschlossen wurde.'} Es wurde nichts abgebucht. Die Rechnung ist weiterhin offen.
          </AppText>
          <AppText variant="heading" numeric>
            Offen: {formatMoney(inv.openCents)}
          </AppText>
          <View style={styles.actions}>
            <Button label="Zur Rechnung" variant="primary" onPress={backToInvoice} testID="zur-rechnung" />
          </View>
        </PublicPanel>
      </PublicPage>
    );
  }

  if (unconfirmed) {
    return (
      <PublicPage testID="zahlung-unbestaetigt">
        <PublicPanel>
          <View style={[styles.icon, { backgroundColor: t.colors.warningSoft, borderRadius: t.radius.pill }]}>
            <Icon name="HourglassMedium" size={iconSize.xl} color={t.colors.warning} />
          </View>
          <AppText variant="display" role="status">
            Noch keine Bestätigung
          </AppText>
          <AppText tone="muted">
            Der Zahlungsanbieter hat bisher keine Zahlung bestätigt. Ist die Zahlung dort fehlgeschlagen oder abgebrochen, wurde nichts abgebucht und die Rechnung ist weiterhin offen. Kommt die Bestätigung später, zeigt die Rechnung sie automatisch an.
          </AppText>
          <AppText variant="heading" numeric>
            Offen: {formatMoney(inv.openCents)}
          </AppText>
          {IS_DEMO ? <Banner tone="info" title="Demo" message="Die Bestätigung simuliert die Demo-Steuerung." action={<Button label="Demo-Steuerung" icon="Gear" onPress={openPanel} />} /> : null}
          <View style={styles.actions}>
            <Button label="Zur Rechnung" variant="primary" onPress={backToInvoice} testID="zur-rechnung" />
            <Button label="Status erneut prüfen" icon="ArrowsClockwise" onPress={() => void query.refetch()} loading={query.isRefreshing} />
          </View>
        </PublicPanel>
      </PublicPage>
    );
  }

  return (
    <PublicPage testID="zahlung-wird-geprueft">
      <PublicPanel>
        <View style={[styles.icon, { backgroundColor: t.colors.warningSoft, borderRadius: t.radius.pill }]}>
          <Icon name="HourglassMedium" size={iconSize.xl} color={t.colors.warning} />
        </View>
        <AppText variant="display" role="status">
          Zahlung wird geprüft
        </AppText>
        <AppText tone="muted">
          Wir warten auf die Bestätigung des Zahlungsanbieters. Erst danach gilt Rechnung {inv.invoiceNumber} als bezahlt. Das dauert meist wenige Sekunden, manchmal einige Minuten. Sie können diese Seite schließen; der Status erscheint dann in der Rechnung.
        </AppText>
        <View style={styles.skel}>
          <Skeleton width="70%" height={14} />
        </View>
        <AppText variant="small" tone="subtle">
          Status der Rechnung: offen, {formatMoney(inv.openCents)}. Wird automatisch alle 3 Sekunden neu abgefragt.
        </AppText>
        {query.status === 'error' ? <Banner tone="warning" title="Abfrage fehlgeschlagen" message="Die letzte Statusabfrage ist fehlgeschlagen. Wir versuchen es weiter." /> : null}
        {IS_DEMO ? (
          <Banner
            tone="info"
            title="Demo"
            message="Die Bestätigung kommt hier nicht von einem echten Anbieter. Öffnen Sie die Demo-Steuerung und wählen Sie beim Zahlungsversuch zum Beispiel „Bezahlt bestätigen“."
            action={<Button label="Demo-Steuerung" icon="Gear" onPress={openPanel} />}
          />
        ) : null}
        <View style={styles.actions}>
          <Button label="Status jetzt prüfen" icon="ArrowsClockwise" onPress={() => void query.refetch()} loading={query.isRefreshing} testID="status-pruefen" />
          <Button label="Zur Rechnung" variant="quiet" onPress={backToInvoice} />
        </View>
      </PublicPanel>
    </PublicPage>
  );
}

const styles = StyleSheet.create({
  icon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  skel: { paddingVertical: 4 },
});
