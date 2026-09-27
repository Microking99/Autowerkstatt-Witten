/**
 * Werkstatt, Rechnungsübersicht: offene Posten, überfällig, Filter nach Zahlungs- und
 * Rechnungsstatus (in der URL). Export als CSV (Buchhaltung). Rechnung → Detail.
 */
import { overdueLabel, paymentStatusLabels, routes, type InvoiceStatus, type PaymentStatus } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useApi } from '../../../src/data/ApiProvider';
import type { ListInvoicesQuery } from '../../../src/data/api';
import { useApiQuery } from '../../../src/data/hooks';
import { formatDate, formatMoney } from '../../../src/lib/format';
import { saveTextFile } from '../../../src/lib/openFile';
import { QueryView } from '../../../src/screens/common';
import { invoiceStatusLabels, useCan } from '../../../src/screens/workshop/shared';
import { AppText, Button, DataTable, EmptyState, FilterChips, Page, PageHeader, Row, StatusChip, useToast } from '../../../src/ui';

const PAYMENT_ALIAS: Record<string, PaymentStatus> = { offen: 'open', teilweise: 'partially_paid', bezahlt: 'paid' };

export default function InvoiceList() {
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const params = useLocalSearchParams<{ zahlung?: string; status?: string; ueberfaellig?: string }>();
  const payment = params.zahlung ? (PAYMENT_ALIAS[params.zahlung] ?? (params.zahlung in paymentStatusLabels ? (params.zahlung as PaymentStatus) : undefined)) : undefined;
  const status = (['draft', 'issued', 'cancelled'] as const).includes(params.status as InvoiceStatus) ? (params.status as InvoiceStatus) : undefined;
  const overdue = params.ueberfaellig === 'ja';
  const query: ListInvoicesQuery = { paymentStatus: payment, status, overdue: overdue || undefined };
  const list = useApiQuery(`werkstatt:rechnungen:${JSON.stringify(query)}`, (a) => a.listInvoices(query));
  const [exporting, setExporting] = useState(false);
  const paymentKey = payment === 'open' ? 'offen' : payment === 'partially_paid' ? 'teilweise' : payment === 'paid' ? 'bezahlt' : 'alle';
  const openSum = (list.data ?? []).filter((i) => i.status === 'issued').reduce((s, i) => s + i.openCents, 0);

  return (
    <Page maxWidth={1200} testID="werkstatt-rechnungen">
      <PageHeader
        title="Rechnungen"
        subtitle={list.data ? `${list.data.length} Rechnungen, offen ${formatMoney(openSum)}` : undefined}
        crumbs={[{ label: 'Übersicht', href: routes.workshop.home() as Href }, { label: 'Rechnungen' }]}
        actions={
          can('reports.export') || can('invoices.read') ? (
            <Button
              label="CSV exportieren"
              icon="DownloadSimple"
              loading={exporting}
              onPress={async () => {
                setExporting(true);
                try {
                  const csv = await api.exportInvoicesCsv(query);
                  await saveTextFile(csv, `rechnungen-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
                  toast.show('CSV-Datei erstellt.');
                } catch {
                  toast.show('Der Export ist fehlgeschlagen.', 'danger');
                } finally {
                  setExporting(false);
                }
              }}
              testID="rechnungen-csv"
            />
          ) : undefined
        }
      />
      <View style={{ gap: 12 }}>
        <FilterChips
          label="Zahlung"
          showLabel
          value={overdue ? 'ueberfaellig' : paymentKey}
          onChange={(v) => router.setParams(v === 'ueberfaellig' ? { ueberfaellig: 'ja', zahlung: undefined } : { zahlung: v === 'alle' ? undefined : v, ueberfaellig: undefined })}
          options={[
            { value: 'alle', label: 'Alle' },
            { value: 'offen', label: 'Offen' },
            { value: 'teilweise', label: 'Teilweise bezahlt' },
            { value: 'ueberfaellig', label: 'Überfällig' },
            { value: 'bezahlt', label: 'Bezahlt' },
          ]}
        />
        <FilterChips
          label="Rechnungsstatus"
          showLabel
          value={status ?? 'alle'}
          onChange={(v) => router.setParams({ status: v === 'alle' ? undefined : v })}
          options={[
            { value: 'alle', label: 'Alle' },
            { value: 'draft', label: 'Entwürfe' },
            { value: 'issued', label: 'Gestellt' },
            { value: 'cancelled', label: 'Storniert' },
          ]}
        />
      </View>
      <QueryView query={list}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState icon="Receipt" title="Keine Rechnungen für diese Filter" />
          ) : (
            <DataTable
              label="Rechnungen"
              keyboardNav
              rows={items}
              rowKey={(i) => i.id}
              rowTestID={(i) => `rechnung-zeile-${i.invoiceNumber ?? i.id}`}
              onRowPress={(i) => router.push(routes.workshop.invoice(i.id) as Href)}
              mobileTitle={(i) => `${i.invoiceNumber ?? 'Entwurf'}, ${i.customerDisplayName}`}
              mobileSubtitle={(i) => `${formatMoney(i.totalGrossCents)}, offen ${formatMoney(i.openCents)}`}
              mobileMeta={(i) => (i.dueDate ? `Fällig ${formatDate(i.dueDate)}` : null)}
              mobileRight={(i) => <StatusChip status={i.overdue ? overdueLabel : paymentStatusLabels[i.paymentStatus]} />}
              columns={[
                { key: 'nr', header: 'Rechnung', render: (i) => <AppText variant="bodyStrong" numeric numberOfLines={1}>{i.invoiceNumber ?? 'Entwurf'}</AppText>, sortValue: (i) => i.invoiceNumber ?? '', width: 158 },
                { key: 'kunde', header: 'Kunde, Auftrag', render: (i) => <View><AppText>{i.customerDisplayName}</AppText><AppText variant="small" tone="muted">{i.orderNumber ?? 'ohne Auftrag'}</AppText></View>, sortValue: (i) => i.customerDisplayName, flex: 1.6 },
                { key: 'betrag', header: 'Betrag', align: 'right', render: (i) => <AppText numeric>{formatMoney(i.totalGrossCents)}</AppText>, sortValue: (i) => i.totalGrossCents, flex: 0.9 },
                { key: 'offen', header: 'Offen', align: 'right', render: (i) => <AppText numeric tone={i.openCents > 0 ? 'warning' : 'muted'}>{formatMoney(i.openCents)}</AppText>, sortValue: (i) => i.openCents, flex: 0.9 },
                { key: 'faellig', header: 'Fällig', render: (i) => <AppText numeric>{i.dueDate ? formatDate(i.dueDate) : 'ohne'}</AppText>, sortValue: (i) => i.dueDate ?? '9999', flex: 0.9 },
                {
                  key: 'status',
                  header: 'Status',
                  render: (i) => (
                    <Row wrap gap={6}>
                      <StatusChip status={invoiceStatusLabels[i.status]} />
                      <StatusChip status={paymentStatusLabels[i.paymentStatus]} />
                      {i.overdue ? <StatusChip status={overdueLabel} /> : null}
                    </Row>
                  ),
                  flex: 2.2,
                },
              ]}
            />
          )
        }
      </QueryView>
    </Page>
  );
}
