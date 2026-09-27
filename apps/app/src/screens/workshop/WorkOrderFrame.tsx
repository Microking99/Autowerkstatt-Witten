/**
 * Rahmen der Auftragsansicht (Werkstatt): Kopf mit Auftragsnummer, Kunde und Fahrzeug, die
 * drei getrennten Status und die Register als eigene Routen (/werkstatt/auftraege/[id]/…).
 */
import { routes, type WorkOrderDetail, type WorkOrderTab } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { useApiQuery, type QueryResult } from '../../data/hooks';
import { keepPlates } from '../../lib/format';
import { Page, PageHeader, StatusTriple, Tabs, type TabItem } from '../../ui';
import { QueryView } from '../common';
import { useCan } from './shared';

export type OrderTab = 'uebersicht' | WorkOrderTab;

const TAB_LABELS: Record<OrderTab, string> = {
  uebersicht: 'Übersicht',
  annahme: 'Annahme',
  arbeiten: 'Arbeiten',
  fotos: 'Fotos',
  dokumente: 'Dokumente',
  chat: 'Chat',
  freigaben: 'Freigaben',
  rechnung: 'Rechnung',
  verlauf: 'Verlauf',
};

export function orderTabHref(id: string, tab: OrderTab): Href {
  return (tab === 'uebersicht' ? routes.workshop.workOrder(id) : routes.workshop.workOrderTab(id, tab)) as Href;
}

export function useWorkOrder(id: string): QueryResult<WorkOrderDetail> {
  return useApiQuery(`werkstatt:auftrag:${id}`, (api) => api.getWorkOrder(id));
}

export function WorkOrderFrame({
  id,
  tab,
  children,
  maxWidth = 1120,
  crumbExtra,
  actions,
  testID,
}: {
  id: string;
  tab: OrderTab;
  children: (order: WorkOrderDetail, query: QueryResult<WorkOrderDetail>) => ReactNode;
  maxWidth?: number;
  /** zusätzliche Brotkrume (z. B. einzelne Freigabeanfrage) */
  crumbExtra?: string;
  actions?: (order: WorkOrderDetail) => ReactNode;
  testID?: string;
}) {
  const can = useCan();
  const query = useWorkOrder(id);
  const order = query.data;
  const items: TabItem<OrderTab>[] = (Object.keys(TAB_LABELS) as OrderTab[])
    .filter((k) => (k === 'rechnung' ? can('invoices.read') : k === 'freigaben' ? can('approvals.request') || can('workOrders.read') : true))
    .map((k) => ({ value: k, label: TAB_LABELS[k], count: k === 'freigaben' && order && order.status.pendingApprovalCount > 0 ? order.status.pendingApprovalCount : undefined }));
  const title = order ? `${order.orderNumber}: ${order.title}` : 'Auftrag';
  return (
    <Page maxWidth={maxWidth} testID={testID ?? `werkstatt-auftrag-${tab}`}>
      <PageHeader
        title={title}
        subtitle={order ? `${order.customerDisplayName}, ${keepPlates(order.vehicleLabel)}, ${keepPlates(order.licensePlate)}` : undefined}
        backHref={tab === 'uebersicht' ? (routes.workshop.workOrders() as Href) : crumbExtra ? orderTabHref(id, tab) : orderTabHref(id, 'uebersicht')}
        backLabel={tab === 'uebersicht' ? 'Aufträge' : crumbExtra ? TAB_LABELS[tab] : 'Auftrag'}
        crumbs={[
          { label: 'Aufträge', href: routes.workshop.workOrders() as Href },
          { label: order?.orderNumber ?? 'Auftrag', href: tab === 'uebersicht' && !crumbExtra ? undefined : orderTabHref(id, 'uebersicht') },
          ...(tab !== 'uebersicht' ? [{ label: TAB_LABELS[tab], href: crumbExtra ? orderTabHref(id, tab) : undefined }] : []),
          ...(crumbExtra ? [{ label: crumbExtra }] : []),
        ]}
        meta={order ? <StatusTriple status={order.status} /> : null}
        actions={order && actions ? actions(order) : undefined}
      />
      <Tabs label="Bereiche des Auftrags" items={items} value={tab} onChange={(v) => router.replace(orderTabHref(id, v))} />
      <QueryView query={query} loading="detail" notAvailableTitle="Auftrag nicht verfügbar">
        {(o) => children(o, query)}
      </QueryView>
    </Page>
  );
}
