/**
 * Mechaniker, Auftrag: Fahrzeug, Annahme (Beanstandung, Vorschäden, interne Hinweise),
 * Positionen ohne Preise, eigene Feststellungen, bisherige Servicehistorie. Aktionen:
 * Position öffnen, Feststellung erfassen, Checkliste [E]. Ohne Verbindung wird der zuletzt
 * geladene Stand angezeigt.
 */
import { findingSeverityLabels, routes, workItemExecutionLabels, type ServiceEntry, type WorkItem } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../../../../src/auth/session';
import { formatDate, formatKm, formatTime, keepPlates } from '../../../../src/lib/format';
import { useOfflineQueue } from '../../../../src/offline/OfflineQueueProvider';
import { useCachedQuery } from '../../../../src/offline/useCachedQuery';
import { QueryView } from '../../../../src/screens/common';
import { expectedExecution, PendingChip } from '../../../../src/screens/mechanic/pending';
import { findingStatusLabels } from '../../../../src/screens/workshop/shared';
import { useTheme } from '../../../../src/theme';
import { AppText, Banner, Button, Icon, iconSize, KeyValueList, ListGroup, ListRow, Page, PageHeader, Row, Section, StatusChip } from '../../../../src/ui';

export default function MechanicWorkOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id);
  const t = useTheme();
  const { user } = useSession();
  const { entries } = useOfflineQueue();
  const query = useCachedQuery(`mechaniker:auftrag:${orderId}`, async (api) => {
    const order = await api.getWorkOrder(orderId);
    const [findings, history] = await Promise.all([api.listFindings(orderId), api.listServiceEntries(order.vehicleId).catch(() => [] as ServiceEntry[])]);
    return { order, findings, history };
  });
  const pending = entries.filter((e) => e.workOrderId === orderId);
  const queuedFindings = pending.filter((e) => e.kind === 'createFinding');
  return (
    <Page maxWidth={840} testID="mechaniker-auftrag">
      <PageHeader
        title={query.data ? keepPlates(query.data.order.vehicleLabel) : 'Auftrag'}
        subtitle={query.data ? `${keepPlates(query.data.order.licensePlate)}, ${query.data.order.orderNumber}: ${query.data.order.title}` : undefined}
        backHref={routes.mechanic.home() as Href}
        backLabel="Heute"
        crumbs={[{ label: 'Heute', href: routes.mechanic.home() as Href }, { label: query.data?.order.orderNumber ?? 'Auftrag' }]}
      />
      {query.cachedAt ? <Banner tone="info" title="Ohne Verbindung" message={`Stand vom ${formatDate(query.cachedAt)}, ${formatTime(query.cachedAt)} Uhr. Neue Einträge werden gespeichert und später übertragen.`} /> : null}
      <QueryView query={query} loading="detail" notAvailableTitle="Auftrag nicht verfügbar">
        {({ order, findings, history }) => {
          const mine = (i: WorkItem) => !i.assignedTo || i.assignedTo.userId === user?.id;
          return (
            <>
              <Row wrap gap={12}>
                <View style={styles.grow}>
                  <Button label="Feststellung erfassen" size="lg" variant="primary" icon="NotePencil" fullWidth onPress={() => router.push(routes.mechanic.finding(order.id) as Href)} testID="feststellung-erfassen" />
                </View>
                <View style={styles.grow}>
                  <Button label="Checkliste (Ergänzung)" size="lg" icon="ListChecks" fullWidth onPress={() => router.push(routes.mechanic.checklist(order.id) as Href)} testID="checkliste-oeffnen" />
                </View>
              </Row>
              <Section title="Positionen">
                <ListGroup>
                  {order.items.map((i, n) => {
                    const locked = i.authorization === 'pending_approval';
                    const blocked = i.authorization === 'rejected' || i.authorization === 'withdrawn';
                    const itemPending = pending.filter((e) => e.scope === `item:${i.id}`);
                    return (
                      <ListRow
                        key={i.id}
                        first={n === 0}
                        icon={locked ? 'Lock' : blocked ? 'Prohibit' : i.maintenanceTypeId ? 'Gauge' : 'Wrench'}
                        title={i.title}
                        subtitle={`${String(i.quantity).replace('.', ',')} ${i.unit}${i.assignedTo ? `, ${i.assignedTo.userId === user?.id ? 'Ihnen zugewiesen' : i.assignedTo.displayName}` : ''}`}
                        onPress={() => router.push(routes.mechanic.workItem(order.id, i.id) as Href)}
                        testID={`position-${i.position}`}
                      >
                        <Row wrap gap={6}>
                          {locked ? (
                            <StatusChip status={{ label: 'Wartet auf Kundenfreigabe', tone: 'warning', icon: 'Lock' }} />
                          ) : blocked ? (
                            <StatusChip status={{ label: i.authorization === 'rejected' ? 'Abgelehnt, nicht ausführen' : 'Zurückgezogen, nicht ausführen', tone: 'neutral', icon: 'Prohibit' }} />
                          ) : (
                            <StatusChip status={workItemExecutionLabels[expectedExecution(i, itemPending)]} />
                          )}
                          <PendingChip entries={itemPending} />
                          {!mine(i) ? <AppText variant="small" tone="subtle">Andere Zuweisung</AppText> : null}
                        </Row>
                      </ListRow>
                    );
                  })}
                </ListGroup>
              </Section>
              {order.intake ? (
                <Section title="Annahme">
                  <KeyValueList
                    columns={1}
                    items={[
                      { label: 'Beanstandung', value: order.intake.customerComplaint },
                      { label: 'km-Stand bei Annahme', value: formatKm(order.intake.odometerKm), numeric: true },
                      { label: 'Vereinbarte Leistungen', value: order.intake.agreedServices || 'siehe Positionen' },
                      ...(order.intake.damages.length ? [{ label: 'Vorschäden', value: order.intake.damages.map((d) => `${d.area}: ${d.description}`).join('; ') }] : []),
                    ]}
                  />
                  {order.intake.notesInternal ? (
                    <View style={[styles.internal, { borderColor: t.colors.borderStrong, backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.panel }]}>
                      <StatusChip status={{ label: 'Interner Hinweis', tone: 'neutral', icon: 'Lock' }} />
                      <AppText>{order.intake.notesInternal}</AppText>
                    </View>
                  ) : null}
                </Section>
              ) : null}
              <Section title="Feststellungen">
                {findings.length === 0 && queuedFindings.length === 0 ? <AppText tone="muted">Noch keine Feststellungen.</AppText> : null}
                {queuedFindings.map((e) => (
                  <View key={e.id} style={[styles.finding, { borderColor: t.colors.warning, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]} testID="feststellung-offline">
                    <Row wrap gap={6}>
                      <PendingChip entries={[e]} />
                    </Row>
                    <AppText>{String(e.payload.description ?? '')}</AppText>
                  </View>
                ))}
                {findings.map((f) => (
                  <View key={f.id} style={[styles.finding, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]}>
                    <Row wrap gap={6}>
                      <StatusChip status={findingSeverityLabels[f.severity]} />
                      <StatusChip status={findingStatusLabels[f.status]} />
                    </Row>
                    <AppText>{f.description}</AppText>
                    <AppText variant="small" tone="subtle">{f.reportedBy.displayName}, {formatDate(f.createdAt)}</AppText>
                  </View>
                ))}
                <AppText variant="small" tone="subtle">Eine Feststellung ist keine Freigabe. Ob der Kunde gefragt wird, entscheidet der Service.</AppText>
              </Section>
              <Section title="Bisherige Servicehistorie">
                {history.filter((e) => e.status === 'valid').length === 0 ? (
                  <AppText tone="muted">Keine Einträge.</AppText>
                ) : (
                  history
                    .filter((e) => e.status === 'valid')
                    .slice(0, 8)
                    .map((e) => (
                      <View key={e.id} style={styles.history}>
                        <Icon name="SealCheck" size={iconSize.sm} color={t.colors.textMuted} />
                        <AppText style={styles.flex}>
                          {formatDate(e.performedOn)}, {formatKm(e.odometerKm)}: {e.title}
                        </AppText>
                      </View>
                    ))
                )}
              </Section>
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1, flexBasis: 240 },
  internal: { borderWidth: 1, borderStyle: 'dashed', padding: 12, gap: 6 },
  finding: { borderWidth: 1, borderLeftWidth: 4, padding: 12, gap: 6 },
  history: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0 },
});
