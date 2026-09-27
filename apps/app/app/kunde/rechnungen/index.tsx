/** Rechnungen mit Zahlungsstatus. Offene zuerst. */
import { overdueLabel, paymentStatusLabels, routes } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useApiQuery } from '../../../src/data/hooks';
import { formatDate } from '../../../src/lib/format';
import { QueryView } from '../../../src/screens/common';
import { AppText, DataTable, EmptyState, FilterChips, MoneyText, Page, PageHeader, Row, StatusChip } from '../../../src/ui';

type Filter = 'alle' | 'offen' | 'bezahlt';

export default function InvoicesScreen() {
  const [filter, setFilter] = useState<Filter>('alle');
  const query = useApiQuery('kunde:rechnungen', (api) => api.listInvoices());
  return (
    <Page testID="kunde-rechnungen">
      <PageHeader title="Rechnungen" crumbs={[{ label: 'Start', href: routes.customer.home() as Href }, { label: 'Rechnungen' }]} />
      <FilterChips
        label="Status"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'alle', label: 'Alle' },
          { value: 'offen', label: 'Offen' },
          { value: 'bezahlt', label: 'Bezahlt' },
        ]}
      />
      <QueryView query={query} loading="list">
        {(list) => {
          const sorted = [...list].sort((a, b) => Number(b.openCents > 0) - Number(a.openCents > 0) || ((a.issuedAt ?? '') < (b.issuedAt ?? '') ? 1 : -1));
          const shown = sorted.filter((i) => (filter === 'alle' ? true : filter === 'offen' ? i.openCents > 0 && i.status === 'issued' : i.paymentStatus === 'paid'));
          if (shown.length === 0) {
            return <EmptyState icon="Receipt" title={list.length === 0 ? 'Noch keine Rechnungen' : 'Keine Rechnungen für diesen Filter'} message={list.length === 0 ? 'Rechnungen erscheinen hier, sobald die Werkstatt sie bereitstellt.' : undefined} />;
          }
          return (
            <DataTable
              label="Rechnungen"
              rows={shown}
              rowKey={(i) => i.id}
              onRowPress={(i) => router.push(routes.customer.invoice(i.id) as Href)}
              mobileTitle={(i) => `Rechnung ${i.invoiceNumber}`}
              mobileSubtitle={(i) => `${i.orderNumber ?? 'ohne Auftrag'}, vom ${formatDate(i.issuedAt)}`}
              mobileMeta={(i) => (i.openCents > 0 ? `Offen, fällig am ${formatDate(i.dueDate)}` : paymentStatusLabels[i.paymentStatus].label)}
              mobileRight={(i) => (
                <Row gap={6} style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
                  <MoneyText cents={i.totalGrossCents} strong />
                  {i.overdue ? <StatusChip status={overdueLabel} /> : <StatusChip status={paymentStatusLabels[i.paymentStatus]} />}
                </Row>
              )}
              columns={[
                { key: 'nr', header: 'Rechnung', render: (i) => <AppText variant="bodyStrong" numeric>{i.invoiceNumber}</AppText>, sortValue: (i) => i.invoiceNumber ?? '', flex: 1.2 },
                { key: 'auftrag', header: 'Auftrag', render: (i) => <AppText numeric>{i.orderNumber ?? '-'}</AppText>, flex: 1.2 },
                { key: 'datum', header: 'Datum', render: (i) => <AppText numeric>{formatDate(i.issuedAt)}</AppText>, sortValue: (i) => i.issuedAt ?? '', flex: 1 },
                { key: 'faellig', header: 'Fällig', render: (i) => <AppText numeric tone={i.overdue ? 'danger' : 'default'}>{formatDate(i.dueDate)}</AppText>, sortValue: (i) => i.dueDate ?? '', flex: 1 },
                { key: 'betrag', header: 'Betrag', render: (i) => <MoneyText cents={i.totalGrossCents} />, sortValue: (i) => i.totalGrossCents, flex: 1, align: 'right' },
                {
                  key: 'status',
                  header: 'Zahlung',
                  render: (i) => (
                    <Row wrap gap={6}>
                      <StatusChip status={paymentStatusLabels[i.paymentStatus]} />
                      {i.overdue ? <StatusChip status={overdueLabel} /> : null}
                    </Row>
                  ),
                  flex: 2,
                },
              ]}
            />
          );
        }}
      </QueryView>
    </Page>
  );
}
