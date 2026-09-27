/**
 * Werkstatt, Übersicht: Kacheln aus /dashboard (rollenbezogen), Termine heute, zuletzt
 * geänderte Aufträge. Kachel → gefilterte Liste (Filter in der URL). Weitere Werkstatt-
 * ansichten folgen mit Paket APP-2.
 */
import { appointmentKindLabels, appointmentStatusLabels, routes, type DashboardTile } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import { useSession } from '../../src/auth/session';
import { useApiQuery } from '../../src/data/hooks';
import { keepPlates, formatDate, formatTime } from '../../src/lib/format';
import { QueryView } from '../../src/screens/common';
import { useBreakpoint, useTheme } from '../../src/theme';
import { AppText, DataTable, EmptyState, Icon, iconSize, ListGroup, ListRow, Page, PageHeader, Section, StatusChip, StatusTriple, type IconName } from '../../src/ui';

type PressState = PressableStateCallbackType & { hovered?: boolean };

const tileIcons: Record<DashboardTile['key'], IconName> = {
  appointments_today: 'CalendarBlank',
  appointment_requests: 'CalendarPlus',
  open_work_orders: 'ClipboardText',
  pending_approvals: 'HourglassMedium',
  unread_messages: 'ChatCircleText',
  ready_for_pickup: 'Car',
  maintenance_due: 'Gauge',
  open_invoices: 'Receipt',
  my_assigned_items: 'Wrench',
};

function Tile({ tile, emphasis }: { tile: DashboardTile; emphasis: boolean }) {
  const t = useTheme();
  const attention = emphasis && tile.count > 0;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${tile.label}: ${tile.count}`}
      onPress={() => router.push(tile.targetPath as Href)}
      testID={`kachel-${tile.key}`}
      style={(s: PressState) => [
        styles.tile,
        { backgroundColor: t.colors.surface, borderColor: attention ? t.colors.warning : t.colors.border, borderRadius: t.radius.panel },
        s.hovered ? { borderColor: t.colors.accent } : null,
        s.pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <View style={styles.tileHead}>
        <Icon name={tileIcons[tile.key]} size={iconSize.md} color={attention ? t.colors.warning : t.colors.textMuted} />
        <AppText variant="small" tone="muted" style={styles.flex}>
          {tile.label}
        </AppText>
      </View>
      <AppText variant="display" numeric>
        {tile.count}
      </AppText>
    </Pressable>
  );
}

export default function WorkshopHome() {
  const { user } = useSession();
  const { device } = useBreakpoint();
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59).toISOString();
  const query = useApiQuery('werkstatt:uebersicht', async (api) => {
    const [tiles, appointments, orders] = await Promise.all([api.dashboard(), api.listAppointments({ from, to }), api.listWorkOrders()]);
    return { tiles, appointments: appointments.filter((a) => a.status === 'confirmed'), orders: orders.items.slice(0, 8) };
  });
  const attentionKeys = new Set(['pending_approvals', 'appointment_requests', 'unread_messages', 'ready_for_pickup']);
  return (
    <Page maxWidth={1200} testID="werkstatt-uebersicht">
      <PageHeader title="Übersicht" subtitle={`${user?.displayName ?? ''}, ${formatDate(today)}`} />
      <QueryView query={query} loading="cards">
        {({ tiles, appointments, orders }) => (
          <>
            <View style={styles.tiles}>
              {tiles.map((tile) => (
                <View key={tile.key} style={[styles.tileCell, { flexBasis: device === 'phone' ? '46%' : device === 'tablet' ? '30%' : '22%' }]}>
                  <Tile tile={tile} emphasis={attentionKeys.has(tile.key)} />
                </View>
              ))}
            </View>
            <Section title="Termine heute">
              {appointments.length === 0 ? (
                <EmptyState icon="CalendarBlank" title="Heute keine Termine" />
              ) : (
                <ListGroup>
                  {appointments.map((a, i) => (
                    <ListRow
                      key={a.id}
                      first={i === 0}
                      icon="CalendarCheck"
                      title={`${formatTime(a.startsAt)}-${formatTime(a.endsAt)} Uhr, ${appointmentKindLabels[a.kind]}`}
                      subtitle={`${a.customerDisplayName}, ${keepPlates(a.vehicleLabel)}`}
                      right={<StatusChip status={appointmentStatusLabels[a.status]} />}
                      onPress={() => router.push(routes.workshop.appointment(a.id) as Href)}
                    />
                  ))}
                </ListGroup>
              )}
            </Section>
            <Section title="Zuletzt geänderte Aufträge">
              <DataTable
                label="Aufträge"
                rows={orders}
                rowKey={(o) => o.id}
                onRowPress={(o) => router.push(routes.workshop.workOrder(o.id) as Href)}
                mobileTitle={(o) => `${o.orderNumber}: ${o.title}`}
                mobileSubtitle={(o) => `${o.customerDisplayName}, ${keepPlates(o.licensePlate)}`}
                columns={[
                  { key: 'nr', header: 'Auftrag', render: (o) => <AppText variant="bodyStrong" numeric>{o.orderNumber}</AppText>, sortValue: (o) => o.orderNumber, flex: 1 },
                  { key: 'kunde', header: 'Kunde, Fahrzeug', render: (o) => <View><AppText numberOfLines={2}>{o.customerDisplayName}</AppText><AppText variant="small" tone="muted" code>{keepPlates(o.licensePlate)}</AppText></View>, sortValue: (o) => o.customerDisplayName, flex: 1.6 },
                  { key: 'titel', header: 'Arbeit', render: (o) => <AppText numberOfLines={2}>{o.title}</AppText>, flex: 1.6 },
                  { key: 'status', header: 'Arbeit, Freigabe, Zahlung', render: (o) => <StatusTriple status={o.status} compact />, flex: 3.4 },
                ]}
              />
            </Section>
          </>
        )}
      </QueryView>
    </Page>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tileCell: { flexGrow: 1 },
  tile: { borderWidth: 1, padding: 16, gap: 8, minHeight: 104 },
  tileHead: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
