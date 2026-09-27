/** Meine Aufträge (laufend/abgeschlossen) mit drei getrennten Status. Register in der URL. */
import { routes } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { useApiQuery } from '../../../src/data/hooks';
import { keepPlates, formatDate } from '../../../src/lib/format';
import { QueryView } from '../../../src/screens/common';
import { AppText, Card, EmptyState, Page, PageHeader, StatusTriple, Tabs, useTabParam } from '../../../src/ui';

const TABS = ['laufend', 'abgeschlossen'] as const;
const DONE = ['picked_up', 'cancelled', 'completed'];

export default function WorkOrdersScreen() {
  const [tab, setTab] = useTabParam(TABS, 'laufend');
  const query = useApiQuery('kunde:auftraege', async (api) => (await api.listWorkOrders()).items);
  const list = query.data ?? [];
  const isDone = (w: (typeof list)[number]) => DONE.includes(w.status.work) && !w.status.readyForPickup;
  const running = list.filter((w) => !isDone(w));
  const done = list.filter(isDone);
  return (
    <Page testID="kunde-auftraege">
      <PageHeader title="Meine Aufträge" crumbs={[{ label: 'Start', href: routes.customer.home() as Href }, { label: 'Aufträge' }]} />
      <Tabs
        label="Aufträge"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'laufend', label: 'Laufend', count: query.data ? running.length : undefined },
          { value: 'abgeschlossen', label: 'Abgeschlossen', count: query.data ? done.length : undefined },
        ]}
      />
      <QueryView query={query} loading="cards">
        {() => {
          const shown = tab === 'laufend' ? running : done;
          if (shown.length === 0) {
            return tab === 'laufend' ? (
              <EmptyState icon="ClipboardText" title="Keine laufenden Aufträge" message="Wenn Sie Ihr Fahrzeug bei uns abgeben, erscheint der Auftrag hier." />
            ) : (
              <EmptyState icon="ClipboardText" title="Noch keine abgeschlossenen Aufträge" />
            );
          }
          return shown.map((w) => (
            <Card key={w.id} onPress={() => router.push(routes.customer.workOrder(w.id) as Href)} accessibilityLabel={`${w.title}, ${w.orderNumber}`} tone={w.status.pendingApprovalCount > 0 ? 'attention' : 'default'} testID={`auftrag-${w.orderNumber}`}>
              <AppText variant="heading">{w.title}</AppText>
              <AppText tone="muted">
                {w.orderNumber}, {keepPlates(w.vehicleLabel)} {keepPlates(w.licensePlate)}
              </AppText>
              <StatusTriple status={w.status} audience="customer" compact />
              <AppText variant="small" tone="subtle" numeric>
                {w.plannedEnd && !DONE.includes(w.status.work) ? `Voraussichtlich fertig am ${formatDate(w.plannedEnd)}` : `Zuletzt geändert am ${formatDate(w.updatedAt)}`}
                {w.unreadMessages > 0 ? `, ${w.unreadMessages} neue Nachricht${w.unreadMessages === 1 ? '' : 'en'}` : ''}
              </AppText>
            </Card>
          ));
        }}
      </QueryView>
    </Page>
  );
}
