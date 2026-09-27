/**
 * Mechaniker, Heute: zugewiesene Aufträge und Positionen mit Arbeitsstatus, Termin und
 * Hebebühne. Keine Preise. Nicht freigegebene Positionen sind als "Wartet auf
 * Kundenfreigabe" gesperrt. Nicht übertragene Einträge tragen "Nicht synchronisiert".
 */
import { routes, workItemExecutionLabels } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../../src/auth/session';
import { useCachedQuery } from '../../src/offline/useCachedQuery';
import { formatDate, formatTime, keepPlates } from '../../src/lib/format';
import { useOfflineQueue } from '../../src/offline/OfflineQueueProvider';
import { QueryView } from '../../src/screens/common';
import { expectedExecution, PendingChip } from '../../src/screens/mechanic/pending';
import { useTheme } from '../../src/theme';
import { AppText, Banner, Button, Card, EmptyState, Page, PageHeader, Row, StatusChip } from '../../src/ui';

export default function MechanicToday() {
  const t = useTheme();
  const { user } = useSession();
  const { entries, summary } = useOfflineQueue();
  const query = useCachedQuery(`mechaniker:heute:${user?.id}`, async (api) => {
    const list = (await api.listWorkOrders({ assigneeId: user?.id, work: 'active' })).items;
    const details = await Promise.all(list.map((w) => api.getWorkOrder(w.id)));
    const [appointments, resources] = await Promise.all([api.listAppointments(), api.listResources().catch(() => [])]);
    return details.map((d) => {
      const appointment = appointments.find((a) => a.workOrderId === d.id && a.status === 'confirmed');
      return { order: d, appointment, lift: resources.find((r) => r.id === appointment?.resourceId)?.name ?? null };
    });
  });
  return (
    <Page maxWidth={840} testID="mechaniker-heute">
      <PageHeader title="Heute" subtitle={`${user?.displayName ?? ''}, ${formatDate(new Date())}`} />
      {summary.total > 0 ? (
        <Banner
          tone={summary.conflicts > 0 ? 'danger' : 'warning'}
          title={summary.conflicts > 0 ? `${summary.conflicts} ${summary.conflicts === 1 ? 'Eintrag wurde' : 'Einträge wurden'} vom Server abgelehnt` : `${summary.pending} ${summary.pending === 1 ? 'Eintrag ist' : 'Einträge sind'} noch nicht übertragen`}
          message={summary.conflicts > 0 ? 'Bitte in der Synchronisierung ansehen und erneut senden oder verwerfen.' : 'Sie werden automatisch übertragen, sobald eine Verbindung besteht.'}
          action={<Button label="Synchronisierung öffnen" icon="ArrowsClockwise" onPress={() => router.push(routes.mechanic.sync() as Href)} />}
        />
      ) : null}
      {query.cachedAt ? <Banner tone="info" title="Ohne Verbindung" message={`Angezeigt wird der Stand vom ${formatDate(query.cachedAt)}, ${formatTime(query.cachedAt)} Uhr.`} /> : null}
      <QueryView query={query} loading="cards">
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon="Wrench" title="Keine Aufträge zugewiesen" message="Sobald Ihnen der Service einen Auftrag zuweist, erscheint er hier." />
          ) : (
            list.map(({ order, appointment, lift }) => {
              const mine = order.items.filter((i) => i.assignedTo?.userId === user?.id || !i.assignedTo);
              const orderPending = entries.filter((e) => e.workOrderId === order.id);
              return (
                <Card key={order.id} testID={`mechaniker-auftrag-${order.orderNumber}`}>
                  <Row wrap style={styles.between}>
                    <AppText variant="bodyStrong" code>
                      {keepPlates(order.licensePlate)}
                    </AppText>
                    <AppText variant="small" tone="subtle" numeric>
                      {order.orderNumber}
                      {appointment ? `, ${formatTime(appointment.startsAt)} Uhr` : ''}
                      {lift ? `, ${lift}` : ''}
                    </AppText>
                  </Row>
                  <AppText variant="heading">{keepPlates(order.vehicleLabel)}</AppText>
                  <AppText tone="muted">{order.title}</AppText>
                  <PendingChip entries={orderPending} />
                  <View style={[styles.items, { borderTopColor: t.colors.border }]}>
                    {mine.map((i) => {
                      const locked = i.authorization === 'pending_approval';
                      const blocked = i.authorization === 'rejected' || i.authorization === 'withdrawn';
                      const pending = orderPending.filter((e) => e.scope === `item:${i.id}`);
                      return (
                        <View key={i.id} style={styles.item}>
                          <AppText style={[styles.flex, blocked ? { textDecorationLine: 'line-through', color: t.colors.textMuted } : null]}>{i.title}</AppText>
                          {locked ? (
                            <StatusChip status={{ label: 'Wartet auf Kundenfreigabe', tone: 'warning', icon: 'Lock' }} />
                          ) : blocked ? (
                            <StatusChip status={{ label: i.authorization === 'rejected' ? 'Abgelehnt, nicht ausführen' : 'Zurückgezogen, nicht ausführen', tone: 'neutral', icon: 'Prohibit' }} />
                          ) : (
                            <StatusChip status={workItemExecutionLabels[expectedExecution(i, pending)]} />
                          )}
                        </View>
                      );
                    })}
                  </View>
                  <Button label="Auftrag öffnen" size="lg" variant="primary" fullWidth icon="Wrench" onPress={() => router.push(routes.mechanic.workOrder(order.id) as Href)} testID={`oeffnen-${order.orderNumber}`} />
                </Card>
              );
            })
          )
        }
      </QueryView>
    </Page>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  items: { borderTopWidth: 1, paddingTop: 8, gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 160 },
});
