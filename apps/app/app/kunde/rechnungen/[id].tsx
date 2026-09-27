/**
 * Rechnung: Betrag, Fälligkeit, PDF, Zahlungen. "Jetzt bezahlen" → Anbieterseite
 * (SFSafariViewController / Custom Tabs bzw. Browser), danach Rückkehr mit Statusabfrage.
 * Der Status bleibt offen, bis der Server die Anbieterbestätigung geprüft hat.
 */
import { checkoutStatusLabels, overdueLabel, paymentMethodLabels, paymentStatusLabels, routes } from '@werkstatt/contracts';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { IS_DEMO } from '../../../src/config';
import { useApi } from '../../../src/data/ApiProvider';
import { useApiMutation, useApiQuery } from '../../../src/data/hooks';
import { useIsOffline } from '../../../src/data/network';
import { useDemo } from '../../../src/demo/DemoPanel';
import { DemoProviderPage } from '../../../src/demo/DemoProviderPage';
import { formatDate, formatDateTime, formatMoney } from '../../../src/lib/format';
import { QueryView, openDownload } from '../../../src/screens/common';
import { useTheme } from '../../../src/theme';
import {
  AppText,
  Banner,
  Button,
  Columns,
  ConfirmDialog,
  IconButton,
  KeyValueList,
  ListGroup,
  ListRow,
  MoneyText,
  Page,
  PageHeader,
  Row,
  Section,
  StatusChip,
  useToast,
} from '../../../src/ui';

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoiceId = String(id);
  const api = useApi();
  const t = useTheme();
  const toast = useToast();
  const offline = useIsOffline();
  const { demo } = useDemo();
  const [confirmPay, setConfirmPay] = useState(false);
  const [demoCheckout, setDemoCheckout] = useState<{ id: string; reference: string; amount: number } | null>(null);
  const query = useApiQuery(`kunde:rechnung:${invoiceId}`, (a) => a.getInvoice(invoiceId));
  const start = useApiMutation((a) => a.startCheckout(invoiceId));

  const returnPath = routes.paymentReturn(invoiceId);
  const pay = async () => {
    try {
      const res = await start.mutate();
      setConfirmPay(false);
      if (IS_DEMO && demo) {
        const checkout = demo.controls.pendingCheckouts().find((c) => c.checkoutId === res.checkoutId);
        setDemoCheckout({ id: res.checkoutId, reference: checkout?.invoiceNumber ?? '', amount: checkout?.amountCents ?? query.data?.openCents ?? 0 });
        return;
      }
      // Gehosteter Checkout des Anbieters im In-App-Browser; danach Status beim Server prüfen.
      await WebBrowser.openBrowserAsync(res.hostedUrl, { dismissButtonStyle: 'close', readerMode: false });
      router.push(returnPath as Href);
    } catch {
      setConfirmPay(false);
    }
  };

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    toast.show(`${label} kopiert.`);
  };

  return (
    <Page testID="kunde-rechnung">
      <PageHeader
        title={query.data ? `Rechnung ${query.data.invoiceNumber}` : 'Rechnung'}
        subtitle={query.data?.orderNumber ? `Auftrag ${query.data.orderNumber}` : undefined}
        backHref={routes.customer.invoices() as Href}
        backLabel="Rechnungen"
        crumbs={[{ label: 'Start', href: routes.customer.home() as Href }, { label: 'Rechnungen', href: routes.customer.invoices() as Href }, { label: query.data?.invoiceNumber ?? 'Rechnung' }]}
      />
      <QueryView query={query} loading="detail">
        {(inv) => {
          const payable = inv.onlinePaymentAvailable && inv.openCents > 0 && inv.status === 'issued';
          return (
            <>
              <Row wrap>
                <StatusChip status={paymentStatusLabels[inv.paymentStatus]} testID="rechnung-status" />
                {inv.overdue ? <StatusChip status={overdueLabel} /> : null}
              </Row>
              {start.error ? (
                <Banner tone="danger" title="Zahlung konnte nicht gestartet werden" message={start.error.isNetwork ? 'Keine Verbindung. Bitte versuchen Sie es erneut. Es wurde nichts abgebucht.' : start.error.message} testID="zahlung-start-fehler" />
              ) : null}

              <Columns ratio={[3, 2]}>
                <>
                  <View style={[styles.amount, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radius.panel }]}>
                    <AppText tone="muted">{inv.openCents > 0 ? 'Offener Betrag' : 'Rechnungsbetrag'}</AppText>
                    <MoneyText cents={inv.openCents > 0 ? inv.openCents : inv.totalGrossCents} variant="display" testID="rechnung-offen" />
                    {inv.openCents > 0 ? (
                      <AppText tone={inv.overdue ? 'danger' : 'muted'} numeric>
                        {inv.overdue ? `Überfällig seit ${formatDate(inv.dueDate)}` : `Fällig am ${formatDate(inv.dueDate)}`}
                      </AppText>
                    ) : null}
                    {payable ? (
                      <>
                        <Button label="Jetzt bezahlen" variant="primary" icon="CreditCard" onPress={() => setConfirmPay(true)} disabled={offline} loading={start.pending} testID="jetzt-bezahlen" />
                        <AppText variant="small" tone="subtle">
                          Online über den Zahlungsanbieter der Werkstatt (SumUp), je nach Gerät auch mit Apple Pay oder Google Pay. Kartendaten speichern wir nicht.
                        </AppText>
                      </>
                    ) : null}
                    {offline && payable ? <AppText variant="small" tone="muted">Ohne Verbindung ist keine Zahlung möglich.</AppText> : null}
                  </View>

                  <KeyValueList
                    items={[
                      { label: 'Rechnungsdatum', value: formatDate(inv.issuedAt), numeric: true },
                      { label: 'Fällig am', value: formatDate(inv.dueDate), numeric: true },
                      { label: 'Gesamtbetrag', value: <MoneyText cents={inv.totalGrossCents} /> },
                      { label: 'Bereits bezahlt', value: <MoneyText cents={inv.paidCents} /> },
                    ]}
                  />

                  {inv.payments.length > 0 ? (
                    <Section title="Zahlungen">
                      <ListGroup>
                        {inv.payments.map((p, i) => (
                          <ListRow key={p.id} first={i === 0} icon="CheckCircle" title={formatMoney(p.amountCents)} subtitle={paymentMethodLabels[p.method]} meta={`${formatDateTime(p.receivedAt)}${p.referenceText ? `, ${p.referenceText}` : ''}`} />
                        ))}
                      </ListGroup>
                    </Section>
                  ) : null}

                  {inv.openCents > 0 && inv.onlinePaymentAvailable ? (
                    <AppText variant="small" tone="subtle">
                      Haben Sie gerade online bezahlt? Die Rechnung gilt erst als bezahlt, wenn der Zahlungsanbieter die Zahlung bestätigt hat. Das kann einen Moment dauern.
                    </AppText>
                  ) : null}
                </>
                <>
                  {inv.documentId ? (
                    <Button
                      label="Rechnung als PDF öffnen"
                      icon="FileText"
                      onPress={async () => {
                        try {
                          const res = await openDownload(await api.downloadDocument(inv.documentId!));
                          if (res === 'unsupported') toast.show('Auf diesem Gerät gibt es keine App zum Öffnen der Datei. Bitte im Browser öffnen.', 'info');
                        } catch {
                          toast.show('Das Dokument konnte nicht geladen werden.', 'danger');
                        }
                      }}
                    />
                  ) : null}
                  {inv.bankTransfer && inv.openCents > 0 ? (
                    <Section title="Per Überweisung bezahlen">
                      <View style={[styles.bank, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radius.panel }]}>
                        <BankRow label="Empfänger" value={inv.bankTransfer.recipient} />
                        <BankRow label="IBAN" value={inv.bankTransfer.iban} code onCopy={() => void copy('IBAN', inv.bankTransfer!.iban.replace(/\s/g, ''))} />
                        {inv.bankTransfer.bic ? <BankRow label="BIC" value={inv.bankTransfer.bic} code /> : null}
                        <BankRow label="Verwendungszweck" value={inv.bankTransfer.reference} code onCopy={() => void copy('Verwendungszweck', inv.bankTransfer!.reference)} />
                        <BankRow label="Betrag" value={formatMoney(inv.openCents)} />
                      </View>
                      <AppText variant="small" tone="subtle">
                        Überweisungen ordnen wir nach dem Eingang auf unserem Konto zu. Das kann einige Werktage dauern.
                      </AppText>
                    </Section>
                  ) : null}
                </>
              </Columns>

              <ConfirmDialog
                visible={confirmPay}
                title={`Zahlung über ${formatMoney(inv.openCents)} starten?`}
                message="Sie werden zur gesicherten Zahlungsseite unseres Anbieters weitergeleitet. Die Rechnung gilt erst als bezahlt, wenn der Anbieter die Zahlung bestätigt hat."
                confirmLabel="Weiter zur Zahlung"
                icon="CreditCard"
                loading={start.pending}
                onCancel={() => setConfirmPay(false)}
                onConfirm={() => void pay()}
                testID="bezahlen-dialog"
              />
              {demoCheckout ? (
                <DemoProviderPage
                  visible
                  amountCents={demoCheckout.amount}
                  reference={`${demoCheckout.reference}`}
                  merchant="Autowerkstatt Witten"
                  onCancel={() => {
                    demo?.controls.providerPage(demoCheckout.id, 'cancel');
                    setDemoCheckout(null);
                    router.push(`${returnPath}&abgebrochen=1` as Href);
                  }}
                  onSubmit={() => {
                    demo?.controls.providerPage(demoCheckout.id, 'submit');
                    setDemoCheckout(null);
                    router.push(returnPath as Href);
                  }}
                />
              ) : null}
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}

function BankRow({ label, value, code, onCopy }: { label: string; value: string; code?: boolean; onCopy?: () => void }) {
  return (
    <View style={styles.bankRow}>
      <View style={styles.flex}>
        <AppText variant="caption" tone="subtle">
          {label}
        </AppText>
        <AppText code={code} selectable>
          {value}
        </AppText>
      </View>
      {onCopy ? <IconButton icon="Copy" accessibilityLabel={`${label} kopieren`} onPress={onCopy} size={44} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  amount: { borderWidth: 1, padding: 20, gap: 8 },
  bank: { borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
  bankRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingVertical: 4 },
  flex: { flex: 1, minWidth: 0 },
});
