/**
 * Werkstatt, Auftrag, Register Freigaben: Anfragen mit aktueller Version, Betrag und
 * Entscheidung. Neue Anfrage; Anfrage öffnen (Versionsverlauf, ändern, zurückziehen).
 */
import { approvalRequestStatusLabels, routes, type WorkOrderDetail } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { View } from 'react-native';
import { useApiQuery } from '../../../../../src/data/hooks';
import { formatDate, formatMoney } from '../../../../../src/lib/format';
import { QueryView } from '../../../../../src/screens/common';
import { WorkOrderFrame } from '../../../../../src/screens/workshop/WorkOrderFrame';
import { useCan } from '../../../../../src/screens/workshop/shared';
import { AppText, Banner, Button, DataTable, EmptyState, Row, StatusChip } from '../../../../../src/ui';

export default function ApprovalsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <WorkOrderFrame id={String(id)} tab="freigaben" testID="werkstatt-freigaben">
      {(order) => <Approvals order={order} />}
    </WorkOrderFrame>
  );
}

function Approvals({ order }: { order: WorkOrderDetail }) {
  const can = useCan();
  const list = useApiQuery(`werkstatt:freigaben:${order.id}`, (a) => a.listApprovals(order.id));
  const closed = !['draft', 'open', 'in_progress', 'work_completed'].includes(order.status.work);
  const newHref = routes.workshop.newApproval(order.id) as Href;
  return (
    <QueryView query={list}>
      {(requests) => (
        <>
          <Row wrap style={{ justifyContent: 'space-between' }}>
            <AppText tone="muted">Nur der Kunde selbst entscheidet, gebunden an genau eine Version. Ein "Ja" im Chat ist keine Freigabe.</AppText>
            {can('approvals.request') && !closed ? <Button label="Neue Freigabeanfrage" icon="Plus" variant="primary" onPress={() => router.push(newHref)} testID="neue-freigabe" /> : null}
          </Row>
          {closed ? <Banner tone="neutral" message="Der Auftrag ist abgeschlossen oder storniert. Neue Anfragen sind nicht mehr möglich." /> : null}
          {requests.length === 0 ? (
            <EmptyState icon="HourglassMedium" title="Keine Freigabeanfragen" message="Zusatzarbeiten und Angebote werden hier angefragt, oft aus einer Feststellung des Mechanikers." />
          ) : (
            <DataTable
              label="Freigabeanfragen"
              keyboardNav
              rows={requests}
              rowKey={(r) => r.id}
              rowTestID={(r) => `anfrage-${r.id}`}
              onRowPress={(r) => router.push(routes.workshop.approval(order.id, r.id) as Href)}
              mobileTitle={(r) => r.title}
              mobileSubtitle={(r) => `${approvalRequestStatusLabels[r.status].label}, Version ${r.currentVersion.versionNo}`}
              mobileMeta={(r) => `${formatMoney(r.currentVersion.totalGrossCents)} brutto${r.currentVersion.sentAt ? `, gesendet ${formatDate(r.currentVersion.sentAt)}` : ', nicht gesendet'}`}
              columns={[
                {
                  key: 'titel',
                  header: 'Anfrage',
                  render: (r) => (
                    <View>
                      <AppText variant="bodyStrong">{r.title}</AppText>
                      <AppText variant="small" tone="muted">{r.kind === 'offer' ? 'Angebot' : 'Zusatzarbeit'}</AppText>
                    </View>
                  ),
                  sortValue: (r) => r.title,
                  flex: 2,
                },
                { key: 'status', header: 'Status', render: (r) => <StatusChip status={approvalRequestStatusLabels[r.status]} />, sortValue: (r) => r.status, flex: 1.3 },
                { key: 'version', header: 'Version', render: (r) => <AppText numeric>{r.currentVersion.versionNo}</AppText>, flex: 0.6 },
                { key: 'betrag', header: 'Brutto', align: 'right', render: (r) => <AppText numeric>{formatMoney(r.currentVersion.totalGrossCents)}</AppText>, sortValue: (r) => r.currentVersion.totalGrossCents, flex: 1 },
                { key: 'gesendet', header: 'Gesendet', render: (r) => <AppText numeric>{r.currentVersion.sentAt ? formatDate(r.currentVersion.sentAt) : 'Entwurf'}</AppText>, flex: 1 },
                {
                  key: 'entscheidung',
                  header: 'Entscheidung',
                  render: (r) => <AppText variant="small">{r.currentVersion.decision ? `${r.currentVersion.decision.decision === 'approved' ? 'Freigegeben' : 'Abgelehnt'} am ${formatDate(r.currentVersion.decision.decidedAt)}` : 'offen'}</AppText>,
                  flex: 1.4,
                },
              ]}
            />
          )}
        </>
      )}
    </QueryView>
  );
}
