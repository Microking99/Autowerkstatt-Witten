/**
 * Werkstatt, Termin anlegen: Kunde, Fahrzeug, Art, Zeit, Hebebühne, Mitarbeiter, Auftrag.
 * Konflikte werden laufend geprüft (POST /appointments/conflicts) und angezeigt; Speichern
 * trotz Konflikt nur mit Begründung (die API verlangt sie ebenfalls).
 */
import { APPOINTMENT_KINDS, appointmentKindLabels, routes, type AppointmentKind, type SchedulingConflict } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApi } from '../../../src/data/ApiProvider';
import { ERROR_CODES } from '../../../src/data/errors';
import { useApiMutation, useApiQuery } from '../../../src/data/hooks';
import { keepPlates } from '../../../src/lib/format';
import { ActionError, conflictLabels } from '../../../src/screens/workshop/shared';
import { useStaffDirectory } from '../../../src/screens/workshop/staff';
import { useTheme } from '../../../src/theme';
import { AppText, Banner, Button, Checkbox, DateTimeField, ListGroup, ListRow, Page, PageHeader, Row, SearchField, Section, Select, StatusChip, TextField, useSaveShortcut, useToast } from '../../../src/ui';

export default function NewAppointment() {
  const t = useTheme();
  const api = useApi();
  const toast = useToast();
  const p = useLocalSearchParams<{ start?: string; buehne?: string; mitarbeiter?: string; kunde?: string; fahrzeug?: string; auftrag?: string }>();
  const initialStart = p.start && !Number.isNaN(Date.parse(p.start)) ? new Date(p.start) : new Date(new Date().setHours(8, 0, 0, 0));
  const [customer, setCustomer] = useState<{ id: string; displayName: string } | null>(null);
  const [q, setQ] = useState('');
  const [vehicleId, setVehicleId] = useState<string | null>(p.fahrzeug ?? null);
  const [kind, setKind] = useState<AppointmentKind>('service');
  const [start, setStart] = useState<Date | null>(initialStart);
  const [end, setEnd] = useState<Date | null>(new Date(initialStart.getTime() + 2 * 3_600_000));
  const [resourceId, setResourceId] = useState<string>(p.buehne ?? 'none');
  const [assignees, setAssignees] = useState<string[]>(p.mitarbeiter ? [p.mitarbeiter] : []);
  const [workOrderId, setWorkOrderId] = useState<string>(p.auftrag ?? 'none');
  const [customerNote, setCustomerNote] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [reason, setReason] = useState('');
  const [conflicts, setConflicts] = useState<SchedulingConflict[]>([]);
  const [needReason, setNeedReason] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { staff } = useStaffDirectory();

  const preset = useApiQuery(p.kunde && !customer ? `werkstatt:termin-neu:kunde:${p.kunde}` : null, (a) => a.getCustomer(p.kunde!));
  useEffect(() => {
    if (preset.data && !customer) setCustomer({ id: preset.data.id, displayName: preset.data.displayName });
  }, [preset.data, customer]);
  const customers = useApiQuery(customer ? null : `werkstatt:termin-neu:kunden:${q.trim()}`, (a) => a.listCustomers({ q: q.trim() || undefined }));
  const vehicles = useApiQuery(customer ? `werkstatt:termin-neu:fahrzeuge:${customer.id}` : null, (a) => a.listVehicles({ customerId: customer!.id }));
  const orders = useApiQuery(customer ? `werkstatt:termin-neu:auftraege:${customer.id}` : null, (a) => a.listWorkOrders({ customerId: customer!.id, work: 'active' }));
  const resources = useApiQuery('werkstatt:hebebuehnen', (a) => a.listResources());

  // Konflikte laufend prüfen (kurz verzögert)
  useEffect(() => {
    if (!start || !end || end <= start) return;
    const timer = setTimeout(() => {
      api
        .checkConflicts({ startsAt: start.toISOString(), endsAt: end.toISOString(), resourceId: resourceId === 'none' ? null : resourceId, assigneeIds: assignees, workOrderId: workOrderId === 'none' ? null : workOrderId })
        .then(setConflicts)
        .catch(() => setConflicts([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [api, start, end, resourceId, assignees, workOrderId]);

  const create = useApiMutation((a, override: string | null) =>
    a.createAppointment({
      kind,
      customerId: customer!.id,
      vehicleId: vehicleId!,
      workOrderId: workOrderId === 'none' ? null : workOrderId,
      startsAt: start!.toISOString(),
      endsAt: end!.toISOString(),
      resourceId: resourceId === 'none' ? null : resourceId,
      assigneeIds: assignees,
      customerNote: customerNote.trim() || null,
      internalNote: internalNote.trim() || null,
      overrideConflictsReason: override,
    }),
  );

  async function submit() {
    if (!customer || !vehicleId) return setError('Bitte Kunde und Fahrzeug wählen.');
    if (!start || !end || end <= start) return setError('Das Ende muss nach dem Beginn liegen.');
    if (conflicts.length > 0 && !reason.trim()) {
      setNeedReason(true);
      return setError('Es gibt Konflikte. Speichern nur mit Begründung.');
    }
    setError(null);
    try {
      const a = await create.mutate(conflicts.length > 0 ? reason.trim() : null);
      toast.show('Termin angelegt.');
      router.replace(routes.workshop.appointment(a.id) as Href);
    } catch (e) {
      const err = e as { code?: string; details?: unknown };
      if (err.code === ERROR_CODES.schedulingConflicts) {
        setConflicts(Array.isArray(err.details) ? (err.details as SchedulingConflict[]) : conflicts);
        setNeedReason(true);
      }
    }
  }
  useSaveShortcut(() => void submit());

  return (
    <Page maxWidth={880} testID="werkstatt-termin-neu">
      <PageHeader title="Termin anlegen" backHref={routes.workshop.calendar() as Href} backLabel="Kalender" crumbs={[{ label: 'Kalender', href: routes.workshop.calendar() as Href }, { label: 'Termin anlegen' }]} />
      <Section title="Kunde und Fahrzeug">
        {customer ? (
          <Banner tone="success" title={customer.displayName} action={<Button label="Anderen Kunden wählen" variant="quiet" onPress={() => { setCustomer(null); setVehicleId(null); setWorkOrderId('none'); }} />} />
        ) : (
          <>
            <SearchField value={q} onChangeText={setQ} label="Kunden suchen" placeholder="Name, Telefon, E-Mail oder Kennzeichen" />
            <ListGroup>
              {(customers.data?.items ?? []).slice(0, 8).map((c, i) => (
                <ListRow key={c.id} first={i === 0} icon="UserCircle" title={c.displayName} subtitle={c.customerNumber} onPress={() => setCustomer({ id: c.id, displayName: c.displayName })} testID={`termin-kunde-${c.customerNumber}`} />
              ))}
            </ListGroup>
          </>
        )}
        {customer ? (
          <Select
            label="Fahrzeug"
            value={vehicleId}
            onChange={setVehicleId}
            options={(vehicles.data?.items ?? []).map((v) => ({ value: v.id, label: `${keepPlates(v.licensePlate)}, ${v.make} ${v.model}` }))}
            required
            testID="termin-fahrzeug"
          />
        ) : null}
      </Section>
      <Section title="Termin">
        <Select label="Art" value={kind} onChange={setKind} options={APPOINTMENT_KINDS.map((k) => ({ value: k, label: appointmentKindLabels[k] }))} />
        <Row wrap gap={12} style={styles.alignStart}>
          <View style={styles.col}>
            <DateTimeField label="Beginn" value={start} onChange={(d) => { setStart(d); if (end && d >= end) setEnd(new Date(d.getTime() + 3_600_000)); }} required />
          </View>
          <View style={styles.col}>
            <DateTimeField label="Ende" value={end} onChange={setEnd} required />
          </View>
        </Row>
        <Select label="Hebebühne" value={resourceId} onChange={setResourceId} options={[{ value: 'none', label: 'Keine' }, ...(resources.data ?? []).filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }))]} testID="termin-buehne" />
        {staff.length > 0 ? (
          <View>
            <AppText variant="caption" tone="muted">Mitarbeiter</AppText>
            {staff.map((s) => (
              <Checkbox key={s.id} label={s.displayName} checked={assignees.includes(s.id)} onChange={(v) => setAssignees((l) => (v ? [...l, s.id] : l.filter((x) => x !== s.id)))} testID={`termin-mitarbeiter-${s.id}`} />
            ))}
          </View>
        ) : null}
        {customer ? (
          <Select label="Auftrag (freiwillig)" value={workOrderId} onChange={setWorkOrderId} options={[{ value: 'none', label: 'Ohne Auftrag' }, ...(orders.data?.items ?? []).map((o) => ({ value: o.id, label: `${o.orderNumber}: ${o.title}` }))]} help="Mit Auftrag prüft der Kalender auch, ob bestellte Teile rechtzeitig da sind." />
        ) : null}
        <TextField label="Hinweis für den Kunden" value={customerNote} onChangeText={setCustomerNote} multiline />
        <TextField label="Interne Notiz" value={internalNote} onChangeText={setInternalNote} multiline />
      </Section>
      <View style={[styles.conflicts, { borderColor: conflicts.length ? t.colors.danger : t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]} testID="termin-konflikte">
        <AppText variant="heading">{conflicts.length ? `${conflicts.length} ${conflicts.length === 1 ? 'Konflikt' : 'Konflikte'}` : 'Keine Konflikte gefunden'}</AppText>
        {conflicts.map((c, i) => (
          <View key={`${c.kind}-${i}`} style={styles.conflictRow}>
            <StatusChip status={conflictLabels[c.kind]} />
            <AppText style={styles.flex}>{c.message}</AppText>
          </View>
        ))}
        {conflicts.length > 0 || needReason ? (
          <TextField label="Begründung für das Speichern trotz Konflikt" value={reason} onChangeText={setReason} required multiline testID="konflikt-begruendung" help="Wird im Termin intern vermerkt und protokolliert." />
        ) : null}
      </View>
      {error ? <Banner tone="danger" message={error} /> : null}
      {create.error?.code !== ERROR_CODES.schedulingConflicts ? <ActionError error={create.error} /> : null}
      <Row wrap>
        <Button label="Abbrechen" onPress={() => router.back()} />
        <Button label={conflicts.length ? 'Trotz Konflikt speichern' : 'Termin speichern'} variant="primary" icon="Check" loading={create.pending} onPress={() => void submit()} testID="termin-speichern" />
      </Row>
    </Page>
  );
}

const styles = StyleSheet.create({
  alignStart: { alignItems: 'flex-start' },
  col: { flexGrow: 1, flexBasis: 240, minWidth: 220 },
  conflicts: { borderWidth: 1, borderLeftWidth: 4, padding: 16, gap: 10 },
  conflictRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  flex: { flex: 1, minWidth: 200 },
});
