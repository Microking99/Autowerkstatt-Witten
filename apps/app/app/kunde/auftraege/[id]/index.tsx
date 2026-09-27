/**
 * Auftrag (Kundensicht): Arbeitsstand, Positionen (vereinbart/freigegeben, wartet, abgelehnt),
 * Freigaben, Fotos, Annahme, Termine, Dokumente, Rechnung. Drei Status bleiben getrennt.
 */
import {
  approvalRequestStatusLabels,
  documentKindLabels,
  paymentStatusLabels,
  routes,
  workItemAuthorizationLabels,
  workItemExecutionLabels,
  type WorkItem,
} from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useApi } from '../../../../src/data/ApiProvider';
import { useApiQuery } from '../../../../src/data/hooks';
import { lineGross } from '../../../../src/screens/customer/money';
import { keepPlates, formatDate, formatDateTime, formatKm } from '../../../../src/lib/format';
import { appointmentStatusLabels, appointmentTitle, appointmentWhen } from '../../../../src/screens/customer/helpers';
import { QueryView, openDownload } from '../../../../src/screens/common';
import { useTheme } from '../../../../src/theme';
import {
  AppText,
  Banner,
  Button,
  Card,
  Columns,
  KeyValueList,
  ListGroup,
  ListRow,
  MoneyText,
  Page,
  PageHeader,
  PhotoGrid,
  Row,
  Section,
  StatusChip,
  StatusTriple,
  useToast,
} from '../../../../src/ui';

function ItemRow({ item, first }: { item: WorkItem; first: boolean }) {
  const t = useTheme();
  const rejected = item.authorization === 'rejected';
  return (
    <View style={[styles.item, { borderTopColor: t.colors.border, borderTopWidth: first ? 0 : 1 }]} testID={`position-${item.id}`}>
      <View style={styles.itemHead}>
        <AppText variant="bodyStrong" style={[styles.flex, rejected ? { textDecorationLine: 'line-through', color: t.colors.textMuted } : null]}>
          {item.title}
        </AppText>
        {item.unitPriceCents !== undefined && item.unitPriceCents !== null ? <MoneyText cents={lineGross(item)} tone={rejected ? 'subtle' : 'default'} /> : null}
      </View>
      <Row wrap gap={8}>
        <StatusChip status={workItemAuthorizationLabels[item.authorization]} />
        {item.authorization === 'agreed' || item.authorization === 'approved' ? <StatusChip status={workItemExecutionLabels[item.executionStatus]} /> : null}
      </Row>
      {rejected ? (
        <AppText variant="small" tone="muted">
          Von Ihnen abgelehnt. Diese Arbeit wird nicht ausgeführt und nicht in die Servicehistorie übernommen.
        </AppText>
      ) : null}
      {item.quantity !== 1 ? (
        <AppText variant="small" tone="subtle" numeric>
          {String(item.quantity).replace('.', ',')} {item.unit}
        </AppText>
      ) : null}
    </View>
  );
}

export default function WorkOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workOrderId = String(id);
  const api = useApi();
  const toast = useToast();
  const query = useApiQuery(`kunde:auftrag:${workOrderId}`, async (a) => {
    const [order, approvals, photos, documents, invoices, appointments] = await Promise.all([
      a.getWorkOrder(workOrderId),
      a.listApprovals(workOrderId),
      a.listPhotos(workOrderId),
      a.listDocuments({ workOrderId }),
      a.listInvoices(),
      a.listAppointments(),
    ]);
    return {
      order,
      approvals,
      photos,
      documents,
      invoices: invoices.filter((i) => i.workOrderId === workOrderId),
      appointments: appointments.filter((x) => x.workOrderId === workOrderId),
    };
  });

  const title = query.data?.order.title ?? 'Auftrag';
  return (
    <Page testID="kunde-auftrag">
      <PageHeader
        title={title}
        subtitle={query.data ? `${query.data.order.orderNumber}, ${keepPlates(query.data.order.vehicleLabel)} ${keepPlates(query.data.order.licensePlate)}` : undefined}
        backHref={routes.customer.workOrders() as Href}
        backLabel="Aufträge"
        crumbs={[{ label: 'Start', href: routes.customer.home() as Href }, { label: 'Aufträge', href: routes.customer.workOrders() as Href }, { label: title }]}
        actions={query.data ? <Button label="Nachricht schreiben" icon="ChatCircleText" onPress={() => router.push(routes.customer.chat(workOrderId) as Href)} testID="zum-chat" /> : null}
      />
      <QueryView query={query} loading="detail">
        {({ order, approvals, photos, documents, invoices, appointments }) => {
          const pending = approvals.filter((a) => a.status === 'pending_customer');
          const agreed = order.items.filter((i) => i.authorization === 'agreed' || i.authorization === 'approved');
          const waiting = order.items.filter((i) => i.authorization === 'pending_approval');
          const rejected = order.items.filter((i) => i.authorization === 'rejected');
          return (
            <>
              <StatusTriple status={order.status} audience="customer" />
              {pending.map((a) => (
                <Banner
                  key={a.id}
                  tone="warning"
                  title={`Ihre Entscheidung ist gefragt: ${a.title}`}
                  message={a.kind === 'offer' ? 'Bitte prüfen Sie das Angebot.' : 'Wir haben eine zusätzliche Arbeit gefunden. Ohne Ihre Freigabe führen wir sie nicht aus.'}
                  action={<Button label="Ansehen und entscheiden" variant="primary" onPress={() => router.push(routes.customer.approval(workOrderId, a.id) as Href)} testID={`zur-freigabe-${a.id}`} />}
                />
              ))}
              {order.status.readyForPickup ? <Banner tone="success" title="Ihr Fahrzeug ist abholbereit" message="Sie können es zu unseren Öffnungszeiten abholen." /> : null}
              {order.descriptionCustomer ? <AppText>{order.descriptionCustomer}</AppText> : null}

              <Columns ratio={[3, 2]}>
                <>
                  <Section title="Positionen" testID="positionen">
                    {agreed.length > 0 ? (
                      <View style={styles.group}>
                        <AppText variant="caption" tone="muted">
                          Vereinbart und freigegeben
                        </AppText>
                        <ListGroup>
                          {agreed.map((i, n) => (
                            <ItemRow key={i.id} item={i} first={n === 0} />
                          ))}
                        </ListGroup>
                      </View>
                    ) : null}
                    {waiting.length > 0 ? (
                      <View style={styles.group}>
                        <AppText variant="caption" tone="warning">
                          Wartet auf Ihre Entscheidung
                        </AppText>
                        <ListGroup>
                          {waiting.map((i, n) => (
                            <ItemRow key={i.id} item={i} first={n === 0} />
                          ))}
                        </ListGroup>
                      </View>
                    ) : null}
                    {rejected.length > 0 ? (
                      <View style={styles.group}>
                        <AppText variant="caption" tone="muted">
                          Abgelehnt
                        </AppText>
                        <ListGroup>
                          {rejected.map((i, n) => (
                            <ItemRow key={i.id} item={i} first={n === 0} />
                          ))}
                        </ListGroup>
                      </View>
                    ) : null}
                    {order.items.length === 0 ? <AppText tone="muted">Noch keine Positionen erfasst.</AppText> : (
                      <AppText variant="small" tone="subtle">
                        Beträge inklusive Umsatzsteuer.
                      </AppText>
                    )}
                  </Section>

                  {approvals.length > 0 ? (
                    <Section title="Freigaben">
                      <ListGroup>
                        {approvals.map((a, n) => (
                          <ListRow
                            key={a.id}
                            first={n === 0}
                            icon={a.kind === 'offer' ? 'FileText' : 'Wrench'}
                            title={a.title}
                            subtitle={`Version ${a.currentVersion.versionNo}${a.currentVersion.decision ? `, entschieden am ${formatDate(a.currentVersion.decision.decidedAt)}` : ''}`}
                            onPress={() => router.push(routes.customer.approval(workOrderId, a.id) as Href)}
                          >
                            <StatusChip status={a.status === 'pending_customer' ? { label: 'Wartet auf Ihre Entscheidung', tone: 'warning', icon: 'HourglassMedium' } : approvalRequestStatusLabels[a.status]} />
                          </ListRow>
                        ))}
                      </ListGroup>
                    </Section>
                  ) : null}

                  {photos.length > 0 ? (
                    <Section title="Fotos">
                      <PhotoGrid photos={photos.map((p) => ({ id: p.id, source: api.imageSource(p.contentUrl), caption: p.caption }))} />
                    </Section>
                  ) : null}
                </>
                <>
                  {order.intake ? (
                    <Section title="Fahrzeugannahme">
                      <KeyValueList
                        columns={1}
                        items={[
                          { label: 'Ihr Anliegen', value: order.intake.customerComplaint },
                          { label: 'Vereinbart', value: order.intake.agreedServices || 'keine Angabe' },
                          { label: 'Kilometerstand', value: formatKm(order.intake.odometerKm), numeric: true },
                          ...(order.intake.costLimitCents ? [{ label: 'Kostenrahmen', value: <MoneyText cents={order.intake.costLimitCents} /> }] : []),
                          { label: 'Bestätigt', value: order.intake.confirmedAt ? formatDateTime(order.intake.confirmedAt) : 'noch nicht bestätigt' },
                        ]}
                      />
                      <AppText variant="small" tone="subtle">
                        Die Bestätigung der Annahme gilt nur für die dort vereinbarten Arbeiten, nicht für spätere Zusatzarbeiten.
                      </AppText>
                    </Section>
                  ) : null}

                  <Section title="Termine">
                    {appointments.length === 0 ? (
                      <AppText tone="muted">Keine Termine zu diesem Auftrag.</AppText>
                    ) : (
                      appointments.map((a) => (
                        <Card key={a.id} onPress={() => router.push(routes.customer.appointment(a.id) as Href)} accessibilityLabel={appointmentTitle(a)}>
                          <StatusChip status={appointmentStatusLabels[a.status]} />
                          <AppText numeric>{appointmentWhen(a)}</AppText>
                        </Card>
                      ))
                    )}
                  </Section>

                  <Section title="Dokumente">
                    {documents.length === 0 ? (
                      <AppText tone="muted">Noch keine Dokumente veröffentlicht.</AppText>
                    ) : (
                      <ListGroup>
                        {documents.map((d, n) => (
                          <ListRow
                            key={d.id}
                            first={n === 0}
                            icon="FileText"
                            title={d.title}
                            subtitle={`${documentKindLabels[d.kind]}${d.versionCount > 1 ? `, Version ${d.currentVersion.versionNo}` : ''}`}
                            onPress={async () => {
                              try {
                                const res = await api.downloadDocument(d.id);
                                const r = await openDownload(res);
                                if (r === 'unsupported') toast.show('Auf diesem Gerät gibt es keine App zum Öffnen der Datei. Bitte im Browser öffnen.', 'info');
                              } catch {
                                toast.show('Das Dokument konnte nicht geladen werden.', 'danger');
                              }
                            }}
                          />
                        ))}
                      </ListGroup>
                    )}
                  </Section>

                  <Section title="Rechnung">
                    {invoices.length === 0 ? (
                      <AppText tone="muted">Die Rechnung erhalten Sie nach Abschluss der Arbeiten.</AppText>
                    ) : (
                      invoices.map((inv) => (
                        <Card key={inv.id} onPress={() => router.push(routes.customer.invoice(inv.id) as Href)} accessibilityLabel={`Rechnung ${inv.invoiceNumber}`}>
                          <Row wrap style={styles.between}>
                            <AppText variant="bodyStrong">Rechnung {inv.invoiceNumber}</AppText>
                            <StatusChip status={paymentStatusLabels[inv.paymentStatus]} />
                          </Row>
                          <MoneyText cents={inv.totalGrossCents} />
                        </Card>
                      ))
                    )}
                  </Section>
                </>
              </Columns>
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}

const styles = StyleSheet.create({
  item: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  itemHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0 },
  group: { gap: 6 },
  between: { justifyContent: 'space-between' },
});
