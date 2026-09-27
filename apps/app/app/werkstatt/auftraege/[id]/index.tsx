/**
 * Werkstatt, Auftrag, Register Übersicht: Kunde, Fahrzeug, drei getrennte Status, Termine,
 * Mitarbeiter, Kostenrahmen, Abholbereit. Aktionen: Status weiterschalten, Mitarbeiter
 * zuweisen, Abschluss prüfen (erzeugt Serviceeinträge, Bestätigung), abholbereit melden,
 * abgeholt, stornieren (Grund Pflicht; offene Freigabeanfragen werden zurückgezogen).
 */
import { appointmentKindLabels, appointmentStatusLabels, routes, workItemAuthorizationLabels, workItemExecutionLabels, type WorkOrderDetail } from '@werkstatt/contracts';
import { allExecutableItemsFinished, isExecutableAuthorization } from '@werkstatt/domain';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApiMutation, useApiQuery } from '../../../../src/data/hooks';
import { useIsOffline } from '../../../../src/data/network';
import { formatDate, formatDateTime, formatKm, formatMoney, keepPlates } from '../../../../src/lib/format';
import { orderTabHref, WorkOrderFrame } from '../../../../src/screens/workshop/WorkOrderFrame';
import { ActionError, InlineLink, parseInteger, useCan } from '../../../../src/screens/workshop/shared';
import { useStaffDirectory } from '../../../../src/screens/workshop/staff';
import { useTheme } from '../../../../src/theme';
import {
  AppText,
  Banner,
  Button,
  Checkbox,
  Columns,
  ConfirmDialog,
  EmptyState,
  KeyValueList,
  ListGroup,
  ListRow,
  Row,
  Section,
  Sheet,
  StatusChip,
  TextField,
  useToast,
} from '../../../../src/ui';

type Dialog = 'open' | 'cancel' | 'resume' | 'review' | 'pickup' | 'pickedUp' | null;

export default function WorkOrderOverview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <WorkOrderFrame id={String(id)} tab="uebersicht" testID="werkstatt-auftrag-uebersicht">
      {(order) => <Overview order={order} />}
    </WorkOrderFrame>
  );
}

function Overview({ order }: { order: WorkOrderDetail }) {
  const t = useTheme();
  const can = useCan();
  const toast = useToast();
  const offline = useIsOffline();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState('');
  const [reviewKm, setReviewKm] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const appointments = useApiQuery(`werkstatt:auftrag:${order.id}:termine`, async (api) => (await api.listAppointments({})).filter((a) => a.workOrderId === order.id));
  const action = useApiMutation(async (api, kind: Exclude<Dialog, null>) => {
    switch (kind) {
      case 'open':
        return api.transitionWorkOrder(order.id, { to: 'open' });
      case 'resume':
        return api.transitionWorkOrder(order.id, { to: 'in_progress', reason: reason.trim() || null });
      case 'cancel':
        return api.transitionWorkOrder(order.id, { to: 'cancelled', reason: reason.trim() });
      case 'review': {
        const km = parseInteger(reviewKm);
        return api.completeReview(order.id, { confirm: true, odometerKm: km === null || Number.isNaN(km) ? null : km });
      }
      case 'pickup':
        return api.readyForPickup(order.id);
      case 'pickedUp':
        return api.pickedUp(order.id);
    }
  });

  const work = order.status.work;
  const items = order.items;
  const finished = allExecutableItemsFinished(items);
  const pendingItems = items.filter((i) => i.authorization === 'pending_approval');
  const maintenanceDone = items.filter((i) => i.maintenanceTypeId && isExecutableAuthorization(i.authorization) && i.executionStatus === 'done');
  const kmMissing = maintenanceDone.some((i) => i.doneOdometerKm === null);
  const closed = work === 'cancelled' || work === 'picked_up';

  async function run(kind: Exclude<Dialog, null>, success: string) {
    try {
      await action.mutate(kind);
      setDialog(null);
      setReason('');
      toast.show(success);
    } catch {
      // Fehler steht im Dialog bzw. in der Ansicht
    }
  }

  const next = (() => {
    if (work === 'draft' && can('workOrders.write')) return <Button label="Auftrag eröffnen" variant="primary" icon="Play" onPress={() => setDialog('open')} testID="auftrag-eroeffnen" />;
    if (work === 'work_completed' && can('workOrders.completeReview'))
      return <Button label="Abschluss prüfen" variant="primary" icon="SealCheck" onPress={() => setDialog('review')} disabled={offline} testID="abschluss-pruefen" />;
    if ((work === 'completed' || work === 'work_completed') && !order.readyForPickupAt && can('workOrders.write'))
      return <Button label="Abholbereit melden" variant={work === 'completed' ? 'primary' : 'secondary'} icon="Car" onPress={() => setDialog('pickup')} testID="abholbereit-melden" />;
    if (work === 'completed' && can('workOrders.write')) return <Button label="Als abgeholt markieren" variant="primary" icon="CheckCircle" onPress={() => setDialog('pickedUp')} testID="abgeholt" />;
    return null;
  })();

  return (
    <>
      <ActionError error={dialog === null ? action.error : null} title="Aktion nicht ausgeführt" />
      <Columns ratio={[1.4, 1]}>
        <View style={styles.stack}>
          <Section title="Kunde und Fahrzeug">
            <KeyValueList
              items={[
                { label: 'Kunde', value: <InlineLink label={order.customerDisplayName} onPress={() => router.push(routes.workshop.customer(order.customerId) as Href)} testID="link-kunde" /> },
                { label: 'Fahrzeug', value: <InlineLink label={`${keepPlates(order.licensePlate)}, ${keepPlates(order.vehicleLabel)}`} onPress={() => router.push(routes.workshop.vehicle(order.vehicleId) as Href)} testID="link-fahrzeug" /> },
                { label: 'Kostenrahmen', value: order.costLimitCents ? formatMoney(order.costLimitCents) : 'nicht festgelegt', numeric: true },
                { label: 'Geplant', value: order.plannedStart ? `${formatDateTime(order.plannedStart)}${order.plannedEnd ? ` bis ${formatDateTime(order.plannedEnd)}` : ''}` : 'offen', numeric: true },
                { label: 'Angelegt', value: formatDateTime(order.createdAt), numeric: true },
                { label: 'Abholbereit', value: order.readyForPickupAt ? `gemeldet ${formatDateTime(order.readyForPickupAt)}` : 'noch nicht gemeldet' },
              ]}
            />
          </Section>
          {order.descriptionCustomer ? (
            <Section title="Beschreibung für den Kunden">
              <AppText>{order.descriptionCustomer}</AppText>
            </Section>
          ) : null}
          {order.notesInternal ? (
            <View style={[styles.internal, { borderColor: t.colors.borderStrong, backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.panel }]}>
              <StatusChip status={{ label: 'Intern, nicht für Kunden', tone: 'neutral', icon: 'Lock' }} />
              <AppText>{order.notesInternal}</AppText>
            </View>
          ) : null}
          <Section title="Positionen" action={<Button label="Arbeiten öffnen" variant="quiet" iconRight="CaretRight" onPress={() => router.push(orderTabHref(order.id, 'arbeiten'))} />}>
            {items.length === 0 ? (
              <EmptyState icon="ListChecks" title="Noch keine Positionen" message="Leistungen im Register Arbeiten erfassen oder als Freigabeanfrage senden." />
            ) : (
              <ListGroup>
                {items.map((i, index) => (
                  <ListRow key={i.id} first={index === 0} title={i.title} subtitle={i.assignedTo ? i.assignedTo.displayName : 'nicht zugewiesen'}>
                    <Row wrap gap={6}>
                      <StatusChip status={workItemAuthorizationLabels[i.authorization]} />
                      <StatusChip status={workItemExecutionLabels[i.executionStatus]} />
                    </Row>
                  </ListRow>
                ))}
              </ListGroup>
            )}
          </Section>
          <Section title="Termine">
            {appointments.data && appointments.data.length > 0 ? (
              <ListGroup>
                {appointments.data.map((a, i) => (
                  <ListRow
                    key={a.id}
                    first={i === 0}
                    icon="CalendarBlank"
                    title={`${formatDateTime(a.startsAt)}, ${appointmentKindLabels[a.kind]}`}
                    subtitle={a.internalNote ?? a.customerNote}
                    right={<StatusChip status={appointmentStatusLabels[a.status]} />}
                    onPress={() => router.push(routes.workshop.appointment(a.id) as Href)}
                  />
                ))}
              </ListGroup>
            ) : (
              <AppText tone="muted">{appointments.status === 'loading' ? 'Termine werden geladen' : 'Kein Termin mit diesem Auftrag verknüpft.'}</AppText>
            )}
          </Section>
        </View>
        <View style={styles.stack}>
          <Section title="Nächster Schritt">
            <View style={[styles.panel, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]}>
              <AppText tone="muted">{nextHint(order, finished, pendingItems.length)}</AppText>
              {offline && work === 'work_completed' ? <Banner tone="info" message="Der fachliche Abschluss ist erst wieder mit Verbindung möglich." /> : null}
              {next ?? <AppText variant="small" tone="subtle">Keine Aktion nötig.</AppText>}
              {work === 'work_completed' && !finished && can('workOrders.write') ? (
                <Button label="Wieder in Arbeit setzen" icon="ArrowCounterClockwise" onPress={() => setDialog('resume')} />
              ) : null}
            </View>
          </Section>
          <Section title="Mitarbeiter" action={can('workOrders.write') && !closed ? <Button label="Zuweisen" variant="quiet" icon="UserPlus" onPress={() => setAssignOpen(true)} testID="mitarbeiter-zuweisen" /> : null}>
            {order.assignees.length === 0 ? (
              <AppText tone="muted">Noch niemand zugewiesen.</AppText>
            ) : (
              <Row wrap gap={8}>
                {order.assignees.map((a) => (
                  <StatusChip key={a.userId} status={{ label: a.displayName, tone: 'info', icon: 'Wrench' }} />
                ))}
              </Row>
            )}
          </Section>
          <Section title="Annahme" action={<Button label="Annahme öffnen" variant="quiet" iconRight="CaretRight" onPress={() => router.push(orderTabHref(order.id, 'annahme'))} />}>
            {order.intake ? (
              <StatusChip
                status={
                  order.intake.confirmedAt
                    ? { label: `Bestätigt ${formatDate(order.intake.confirmedAt)}${order.intake.confirmationMethod === 'app' ? ' in der App' : ' vor Ort'}`, tone: 'success', icon: 'SealCheck' }
                    : { label: 'Noch nicht bestätigt', tone: 'warning', icon: 'HourglassMedium' }
                }
              />
            ) : (
              <AppText tone="muted">Noch keine Fahrzeugannahme erfasst.</AppText>
            )}
            {order.intake ? <AppText variant="small" tone="subtle" numeric>km-Stand bei Annahme: {formatKm(order.intake.odometerKm)}</AppText> : null}
          </Section>
          {!closed && work !== 'completed' && can('workOrders.write') ? (
            <Section title="Stornieren">
              <AppText variant="small" tone="muted">Gesendete, noch offene Freigabeanfragen werden dabei automatisch zurückgezogen.</AppText>
              <Button label="Auftrag stornieren" variant="secondary" icon="XCircle" onPress={() => setDialog('cancel')} testID="auftrag-stornieren" />
            </Section>
          ) : null}
        </View>
      </Columns>

      <ConfirmDialog visible={dialog === 'open'} title="Auftrag eröffnen?" message="Der Auftrag wird damit für den Kunden sichtbar und kann bearbeitet werden." confirmLabel="Eröffnen" icon="Play" loading={action.pending} onCancel={() => setDialog(null)} onConfirm={() => void run('open', 'Auftrag eröffnet.')}>
        <ActionError error={action.error} />
      </ConfirmDialog>
      <ConfirmDialog visible={dialog === 'resume'} title="Wieder in Arbeit setzen?" message="Es gibt offene ausführbare Positionen, zum Beispiel nach einer neuen Freigabe." confirmLabel="In Arbeit setzen" loading={action.pending} onCancel={() => setDialog(null)} onConfirm={() => void run('resume', 'Auftrag wieder in Arbeit.')}>
        <ActionError error={action.error} />
      </ConfirmDialog>
      <ConfirmDialog
        visible={dialog === 'cancel'}
        title={`Auftrag ${order.orderNumber} stornieren?`}
        message="Der Auftrag wird nicht weiter bearbeitet. Gesendete, offene Freigabeanfragen werden zurückgezogen; der Kunde muss nichts mehr entscheiden."
        confirmLabel="Stornieren"
        tone="destructive"
        icon="XCircle"
        loading={action.pending}
        onCancel={() => setDialog(null)}
        testID="stornieren-dialog"
        onConfirm={() => (reason.trim() ? void run('cancel', 'Auftrag storniert.') : undefined)}
      >
        <TextField label="Grund" value={reason} onChangeText={setReason} required multiline error={reason.trim() ? null : 'Bitte einen Grund angeben.'} testID="storno-grund" />
        <ActionError error={action.error} />
      </ConfirmDialog>
      <ConfirmDialog
        visible={dialog === 'review'}
        title="Auftrag fachlich abschließen?"
        message={
          maintenanceDone.length > 0
            ? `Dabei entstehen ${maintenanceDone.length} ${maintenanceDone.length === 1 ? 'Serviceeintrag' : 'Serviceeinträge'} in der Fahrzeughistorie, genau einmal: ${maintenanceDone.map((i) => i.title).join(', ')}.`
            : 'Es wurden keine Wartungsarbeiten ausgeführt; es entstehen keine Serviceeinträge.'
        }
        confirmLabel="Abschluss bestätigen"
        icon="SealCheck"
        loading={action.pending}
        onCancel={() => setDialog(null)}
        testID="abschluss-dialog"
        onConfirm={() => void run('review', 'Auftrag abgeschlossen. Serviceeinträge erzeugt.')}
      >
        {pendingItems.length > 0 ? <Banner tone="warning" message={`${pendingItems.length} ${pendingItems.length === 1 ? 'Position wartet' : 'Positionen warten'} noch auf die Kundenfreigabe. Sie werden nicht ausgeführt und erscheinen nicht in der Historie.`} /> : null}
        {kmMissing ? (
          <TextField label="km-Stand für Wartungspositionen ohne km-Angabe" value={reviewKm} onChangeText={setReviewKm} keyboardType="number-pad" help="Leer lassen, wenn unbekannt. Es wird dann keine km-Fälligkeit berechnet." />
        ) : null}
        <AppText variant="small" tone="subtle">
          Abgelehnte oder zurückgezogene Arbeiten erscheinen nie in der Servicehistorie. Korrekturen später nur als neue Revision mit Begründung.
        </AppText>
        <ActionError error={action.error} />
      </ConfirmDialog>
      <ConfirmDialog visible={dialog === 'pickup'} title="Abholbereit melden?" message="Der Kunde wird benachrichtigt, dass das Fahrzeug abgeholt werden kann." confirmLabel="Abholbereit melden" icon="Car" loading={action.pending} onCancel={() => setDialog(null)} onConfirm={() => void run('pickup', 'Abholbereit gemeldet.')}>
        <ActionError error={action.error} />
      </ConfirmDialog>
      <ConfirmDialog
        visible={dialog === 'pickedUp'}
        title="Fahrzeug abgeholt?"
        message={order.status.payment === 'open' || order.status.payment === 'partially_paid' ? 'Hinweis: Die Rechnung ist noch nicht vollständig bezahlt. Der Zahlungsstatus bleibt davon getrennt.' : 'Der Auftrag wird als abgeholt abgeschlossen.'}
        confirmLabel="Als abgeholt markieren"
        loading={action.pending}
        onCancel={() => setDialog(null)}
        onConfirm={() => void run('pickedUp', 'Als abgeholt markiert.')}
      >
        <ActionError error={action.error} />
      </ConfirmDialog>
      <AssignSheet order={order} visible={assignOpen} onClose={() => setAssignOpen(false)} />
    </>
  );
}

function nextHint(order: WorkOrderDetail, finished: boolean, pending: number): string {
  switch (order.status.work) {
    case 'draft':
      return 'Entwurf, für den Kunden unsichtbar. Nach dem Eröffnen kann die Annahme bestätigt und gearbeitet werden.';
    case 'open':
      return 'Wartet auf Arbeitsbeginn. Der Status wechselt automatisch, sobald ein Mechaniker eine Position startet.';
    case 'in_progress':
      return pending > 0 ? `In Arbeit. ${pending} ${pending === 1 ? 'Position wartet' : 'Positionen warten'} auf die Kundenfreigabe.` : 'In Arbeit.';
    case 'work_completed':
      return finished ? 'Alle ausführbaren Positionen sind erledigt. Jetzt fachlich abschließen: Erst dabei entstehen die Serviceeinträge.' : 'Es gibt wieder offene Positionen.';
    case 'completed':
      return order.readyForPickupAt ? 'Abgeschlossen und abholbereit gemeldet.' : 'Fachlich abgeschlossen. Abholbereit melden, sobald das Fahrzeug bereitsteht.';
    case 'picked_up':
      return 'Abgeholt. Der Auftrag ist erledigt.';
    case 'cancelled':
      return 'Storniert.';
  }
}

function AssignSheet({ order, visible, onClose }: { order: WorkOrderDetail; visible: boolean; onClose: () => void }) {
  const { staff, complete } = useStaffDirectory(visible);
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>(order.assignees.map((a) => a.userId));
  useEffect(() => {
    if (visible) setSelected(order.assignees.map((a) => a.userId));
    // beim Öffnen den aktuellen Stand übernehmen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const save = useApiMutation((api, ids: string[]) => api.setAssignees(order.id, ids));
  const options = [...staff];
  for (const a of order.assignees) if (!options.some((s) => s.id === a.userId)) options.push({ id: a.userId, displayName: a.displayName, role: null });
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Mitarbeiter zuweisen"
      footer={
        <>
          <Button label="Abbrechen" onPress={onClose} />
          <Button
            label="Speichern"
            variant="primary"
            loading={save.pending}
            onPress={async () => {
              try {
                await save.mutate(selected);
                toast.show('Zuweisung gespeichert.');
                onClose();
              } catch {
                // Fehler unten
              }
            }}
            testID="zuweisung-speichern"
          />
        </>
      }
    >
      <AppText tone="muted">Zugewiesene Mechaniker sehen den Auftrag, die Annahme und die Fahrzeughistorie, solange der Auftrag läuft. Preise sehen sie nie.</AppText>
      {!complete ? <Banner tone="info" message="Ohne Benutzerverwaltungsrecht werden nur Mitarbeiter angezeigt, die bereits Aufträgen zugewiesen sind." /> : null}
      {options.map((s) => (
        <Checkbox
          key={s.id}
          label={s.displayName}
          description={s.role === 'mechanic' ? 'Mechaniker' : s.role === 'service' ? 'Service' : s.role === 'admin' ? 'Inhaber' : undefined}
          checked={selected.includes(s.id)}
          onChange={(v) => setSelected((list) => (v ? [...list, s.id] : list.filter((x) => x !== s.id)))}
          testID={`zuweisen-${s.id}`}
        />
      ))}
      <ActionError error={save.error} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 24 },
  panel: { borderWidth: 1, padding: 16, gap: 12 },
  internal: { borderWidth: 1, borderStyle: 'dashed', padding: 16, gap: 8 },
  linkButton: { paddingHorizontal: 0, minHeight: 32, alignSelf: 'flex-start' },
});
