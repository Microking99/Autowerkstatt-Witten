/**
 * Kunde, Start: offene Entscheidungen, offene Rechnungen, abholbereit, nächster Termin,
 * ungelesene Nachrichten, bald fällige Wartung, laufende Aufträge. Karte → Vorgang.
 */
import { overdueLabel, paymentStatusLabels, routes } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../../src/auth/session';
import { useApiQuery } from '../../src/data/hooks';
import { keepPlates, formatDate, formatRelativeTime } from '../../src/lib/format';
import { appointmentStatusLabels, appointmentTitle, appointmentWhen, dueStateLabels, dueSummary, estimateLabel, salutationName } from '../../src/screens/customer/helpers';
import { QueryView } from '../../src/screens/common';
import { AppText, Button, Card, EmptyState, MoneyText, Page, Row, Section, StatusChip, StatusTriple } from '../../src/ui';

const go = (href: string) => router.push(href as Href);

export default function CustomerHome() {
  const { user } = useSession();
  const query = useApiQuery(`kunde:start:${user?.id}`, async (api) => {
    const [orders, invoices, appointments, conversations, vehicles, me] = await Promise.all([
      api.listWorkOrders(),
      api.listInvoices(),
      api.listAppointments(),
      api.listConversations(),
      api.listVehicles(),
      user?.customerId ? api.getCustomer(user.customerId) : Promise.resolve(undefined),
    ]);
    const pendingOrders = orders.items.filter((o) => o.status.pendingApprovalCount > 0);
    const approvalLists = await Promise.all(pendingOrders.map((o) => api.listApprovals(o.id)));
    const approvals = approvalLists
      .flat()
      .filter((a) => a.status === 'pending_customer')
      .map((a) => ({ approval: a, order: orders.items.find((o) => o.id === a.workOrderId)! }));
    const dues = (await Promise.all(vehicles.items.map(async (v) => (await api.maintenanceDue(v.id)).map((d) => ({ due: d, vehicle: v }))))).flat();
    return { orders: orders.items, invoices, appointments, conversations, vehicles: vehicles.items, approvals, dues, me };
  });

  return (
    <Page onRefresh={() => void query.refetch()} refreshing={query.isRefreshing} testID="kunde-start">
      <QueryView query={query} loading="cards">
        {(d) => {
          const name = salutationName(d.me);
          const openInvoices = d.invoices.filter((i) => i.openCents > 0 && i.status === 'issued').sort((a, b) => Number(b.overdue) - Number(a.overdue));
          const ready = d.orders.filter((o) => o.status.readyForPickup);
          const now = new Date().toISOString();
          const upcoming = d.appointments
            .filter((a) => ['requested', 'proposed', 'confirmed'].includes(a.status) && (a.endsAt >= now || a.status === 'proposed'))
            .sort((a, b) => (a.status === 'proposed' ? -1 : b.status === 'proposed' ? 1 : a.startsAt < b.startsAt ? -1 : 1));
          const unread = d.conversations.filter((c) => c.unreadCount > 0);
          const dues = d.dues.filter((x) => x.due.state === 'overdue' || x.due.state === 'due_soon');
          const running = d.orders.filter((o) => ['open', 'in_progress', 'work_completed'].includes(o.status.work));
          const nothing = d.approvals.length + openInvoices.length + ready.length + upcoming.length + unread.length + dues.length + running.length === 0;
          return (
            <>
              <View style={styles.greeting}>
                <AppText variant="display" accessibilityRole="header">
                  {name ? `Guten Tag, ${name}` : 'Guten Tag'}
                </AppText>
                <AppText tone="muted">Hier sehen Sie, was gerade ansteht.</AppText>
              </View>

              {nothing ? (
                <EmptyState icon="CheckCircle" title="Alles erledigt" message="Zurzeit wartet nichts auf Sie. Neue Anfragen der Werkstatt erscheinen hier." action={<Button label="Termin anfragen" variant="primary" onPress={() => go(routes.customer.requestAppointment())} />} />
              ) : null}

              {d.approvals.length > 0 ? (
                <Section title="Ihre Entscheidung ist gefragt" testID="start-entscheidungen">
                  {d.approvals.map(({ approval, order }) => (
                    <Card
                      key={approval.id}
                      tone="attention"
                      accessibilityLabel={`${approval.title}, ${order.orderNumber}. Jetzt ansehen`}
                      onPress={() => go(routes.customer.approval(order.id, approval.id))}
                      testID={`start-freigabe-${approval.id}`}
                    >
                      <StatusChip status={{ label: approval.kind === 'offer' ? 'Angebot wartet auf Sie' : 'Zusatzarbeit wartet auf Sie', tone: 'warning', icon: 'HourglassMedium' }} />
                      <AppText variant="heading">{approval.title}</AppText>
                      <AppText tone="muted">
                        {order.orderNumber}, {keepPlates(order.vehicleLabel)} {keepPlates(order.licensePlate)}
                      </AppText>
                      <Row wrap style={styles.between}>
                        <MoneyText cents={approval.currentVersion.totalGrossCents} variant="heading" />
                        <AppText variant="small" tone="subtle">
                          {approval.currentVersion.versionNo > 1 ? `Version ${approval.currentVersion.versionNo}, geändert` : 'Version 1'}
                        </AppText>
                      </Row>
                    </Card>
                  ))}
                </Section>
              ) : null}

              {openInvoices.length > 0 ? (
                <Section title="Offene Rechnungen" testID="start-rechnungen">
                  {openInvoices.map((inv) => (
                    <Card key={inv.id} tone={inv.overdue ? 'danger' : 'default'} onPress={() => go(routes.customer.invoice(inv.id))} accessibilityLabel={`Rechnung ${inv.invoiceNumber} öffnen`}>
                      <Row wrap>
                        <StatusChip status={paymentStatusLabels[inv.paymentStatus]} />
                        {inv.overdue ? <StatusChip status={overdueLabel} /> : null}
                      </Row>
                      <AppText variant="heading">Rechnung {inv.invoiceNumber}</AppText>
                      <Row wrap style={styles.between}>
                        <MoneyText cents={inv.openCents} variant="heading" />
                        <AppText variant="small" tone={inv.overdue ? 'danger' : 'subtle'} numeric>
                          Fällig am {formatDate(inv.dueDate)}
                        </AppText>
                      </Row>
                    </Card>
                  ))}
                </Section>
              ) : null}

              {ready.length > 0 ? (
                <Section title="Abholbereit">
                  {ready.map((o) => (
                    <Card key={o.id} onPress={() => go(routes.customer.workOrder(o.id))} accessibilityLabel={`${o.title} ist abholbereit`}>
                      <StatusChip status={{ label: 'Abholbereit', tone: 'success', icon: 'Car' }} />
                      <AppText variant="heading">
                        {keepPlates(o.vehicleLabel)} {keepPlates(o.licensePlate)}
                      </AppText>
                      <AppText tone="muted">
                        {o.orderNumber}: {o.title}. Sie können es zu unseren Öffnungszeiten abholen.
                      </AppText>
                    </Card>
                  ))}
                </Section>
              ) : null}

              {upcoming.length > 0 ? (
                <Section title="Termine" action={<Button label="Alle Termine" variant="quiet" onPress={() => go(routes.customer.appointments())} />}>
                  {upcoming.slice(0, 2).map((a) => (
                    <Card key={a.id} tone={a.status === 'proposed' ? 'attention' : 'default'} onPress={() => go(routes.customer.appointment(a.id))} accessibilityLabel={appointmentTitle(a)}>
                      <StatusChip status={appointmentStatusLabels[a.status]} />
                      <AppText variant="heading">{appointmentTitle(a)}</AppText>
                      <AppText tone="muted" numeric>
                        {appointmentWhen(a)}
                      </AppText>
                    </Card>
                  ))}
                </Section>
              ) : null}

              {unread.length > 0 ? (
                <Section title="Neue Nachrichten">
                  {unread.map((c) => (
                    <Card key={c.workOrderId} onPress={() => go(routes.customer.chat(c.workOrderId))} accessibilityLabel={`${c.unreadCount} neue Nachrichten zu ${c.orderNumber}`}>
                      <AppText variant="heading">
                        {c.orderNumber}: {c.title}
                      </AppText>
                      {c.lastMessage ? (
                        <AppText tone="muted" numberOfLines={2}>
                          {c.lastMessage.author.displayName}: {c.lastMessage.body || 'Foto'}
                        </AppText>
                      ) : null}
                      <AppText variant="small" tone="subtle">
                        {c.unreadCount === 1 ? '1 neue Nachricht' : `${c.unreadCount} neue Nachrichten`}
                        {c.lastMessage ? `, ${formatRelativeTime(c.lastMessage.createdAt)}` : ''}
                      </AppText>
                    </Card>
                  ))}
                </Section>
              ) : null}

              {dues.length > 0 ? (
                <Section title="Wartung bald fällig">
                  {dues.map(({ due, vehicle }) => (
                    <Card key={`${vehicle.id}-${due.lastServiceEntryId}`} onPress={() => go(routes.customer.vehicle(vehicle.id))} accessibilityLabel={`${due.title}, ${vehicle.make} ${vehicle.model}`}>
                      <Row wrap>
                        <StatusChip status={dueStateLabels[due.state]} />
                        {due.basis === 'km_estimated' || due.estimatedCurrentKm !== null ? <StatusChip status={estimateLabel} /> : null}
                      </Row>
                      <AppText variant="heading">{due.title}</AppText>
                      <AppText tone="muted">
                        {vehicle.make} {vehicle.model}, {keepPlates(vehicle.licensePlate)}. {dueSummary(due)}.
                      </AppText>
                    </Card>
                  ))}
                </Section>
              ) : null}

              {running.length > 0 ? (
                <Section title="Laufende Aufträge" action={<Button label="Alle Aufträge" variant="quiet" onPress={() => go(routes.customer.workOrders())} />}>
                  {running.map((o) => (
                    <Card key={o.id} onPress={() => go(routes.customer.workOrder(o.id))} accessibilityLabel={`${o.title}, ${o.orderNumber}`}>
                      <AppText variant="heading">{o.title}</AppText>
                      <AppText tone="muted">
                        {o.orderNumber}, {keepPlates(o.vehicleLabel)} {keepPlates(o.licensePlate)}
                      </AppText>
                      <StatusTriple status={o.status} audience="customer" compact />
                    </Card>
                  ))}
                </Section>
              ) : null}
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}

const styles = StyleSheet.create({
  greeting: { gap: 4 },
  between: { justifyContent: 'space-between' },
});
