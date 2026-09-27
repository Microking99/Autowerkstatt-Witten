/**
 * Mechaniker, Heute: zugewiesene Aufträge und Positionen mit Arbeitsstatus. Keine Preise.
 * Nicht freigegebene Positionen sind als "Wartet auf Kundenfreigabe" gesperrt.
 * Auftragsdetail, Positionen und Feststellungen folgen mit Paket APP-2.
 */
import { routes, workItemExecutionLabels } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../../src/auth/session';
import { useApiQuery } from '../../src/data/hooks';
import { keepPlates, formatDate, formatTime } from '../../src/lib/format';
import { QueryView } from '../../src/screens/common';
import { useTheme } from '../../src/theme';
import { AppText, Button, Card, EmptyState, Page, PageHeader, Row, StatusChip } from '../../src/ui';

export default function MechanicToday() {
  const t = useTheme();
  const { user } = useSession();
  const query = useApiQuery(`mechaniker:heute:${user?.id}`, async (api) => {
    const list = (await api.listWorkOrders({ assigneeId: user?.id })).items.filter((w) => w.status.work === 'open' || w.status.work === 'in_progress');
    const details = await Promise.all(list.map((w) => api.getWorkOrder(w.id)));
    const appointments = await api.listAppointments();
    return details.map((d) => ({ order: d, appointment: appointments.find((a) => a.workOrderId === d.id && a.status === 'confirmed') }));
  });
  return (
    <Page maxWidth={840} testID="mechaniker-heute">
      <PageHeader title="Heute" subtitle={`${user?.displayName ?? ''}, ${formatDate(new Date())}`} />
      <QueryView query={query} loading="cards">
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon="Wrench" title="Keine Aufträge zugewiesen" message="Sobald Ihnen der Service einen Auftrag zuweist, erscheint er hier." />
          ) : (
            list.map(({ order, appointment }) => {
              const mine = order.items.filter((i) => i.assignedTo?.userId === user?.id || !i.assignedTo);
              return (
                <Card key={order.id} testID={`mechaniker-auftrag-${order.orderNumber}`}>
                  <Row wrap style={styles.between}>
                    <AppText variant="bodyStrong" code>
                      {keepPlates(order.licensePlate)}
                    </AppText>
                    <AppText variant="small" tone="subtle" numeric>
                      {order.orderNumber}
                      {appointment ? `, ${formatTime(appointment.startsAt)} Uhr` : ''}
                    </AppText>
                  </Row>
                  <AppText variant="heading">{keepPlates(order.vehicleLabel)}</AppText>
                  <AppText tone="muted">{order.title}</AppText>
                  <View style={[styles.items, { borderTopColor: t.colors.border }]}>
                    {mine.map((i) => {
                      const locked = i.authorization === 'pending_approval';
                      const blocked = i.authorization === 'rejected' || i.authorization === 'withdrawn';
                      return (
                        <View key={i.id} style={styles.item}>
                          <AppText style={[styles.flex, blocked ? { textDecorationLine: 'line-through', color: t.colors.textMuted } : null]}>{i.title}</AppText>
                          {locked ? (
                            <StatusChip status={{ label: 'Wartet auf Kundenfreigabe', tone: 'warning', icon: 'Lock' }} />
                          ) : blocked ? (
                            <StatusChip status={{ label: 'Nicht ausführen', tone: 'neutral', icon: 'Prohibit' }} />
                          ) : (
                            <StatusChip status={workItemExecutionLabels[i.executionStatus]} />
                          )}
                        </View>
                      );
                    })}
                  </View>
                  <Button label="Auftrag öffnen" size="lg" variant="primary" fullWidth icon="Wrench" onPress={() => router.push(routes.mechanic.workOrder(order.id) as Href)} />
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
