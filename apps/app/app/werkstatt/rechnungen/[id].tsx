/**
 * Werkstatt, Rechnungsdetail: wie im Auftrag (Register Rechnung), mit Verweis zum Auftrag.
 */
import { routes } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useApiQuery } from '../../../src/data/hooks';
import { QueryView } from '../../../src/screens/common';
import { InvoicePanel } from '../../../src/screens/workshop/InvoicePanel';
import { Button, Page, PageHeader } from '../../../src/ui';

export default function InvoiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useApiQuery(`werkstatt:rechnung:${id}`, (api) => api.getInvoice(String(id)));
  const inv = query.data;
  return (
    <Page maxWidth={960} testID="werkstatt-rechnungsdetail">
      <PageHeader
        title={inv ? (inv.invoiceNumber ? `Rechnung ${inv.invoiceNumber}` : 'Rechnungsentwurf') : 'Rechnung'}
        subtitle={inv ? `${inv.customerDisplayName}${inv.orderNumber ? `, Auftrag ${inv.orderNumber}` : ''}` : undefined}
        backHref={routes.workshop.invoices() as Href}
        backLabel="Rechnungen"
        crumbs={[{ label: 'Rechnungen', href: routes.workshop.invoices() as Href }, { label: inv?.invoiceNumber ?? 'Rechnung' }]}
        actions={inv?.workOrderId ? <Button label="Zum Auftrag" icon="ClipboardText" onPress={() => router.push(routes.workshop.workOrder(inv.workOrderId!) as Href)} /> : undefined}
      />
      <QueryView query={query} loading="detail" notAvailableTitle="Rechnung nicht verfügbar">
        {(invoice) => <InvoicePanel invoice={invoice} />}
      </QueryView>
    </Page>
  );
}
