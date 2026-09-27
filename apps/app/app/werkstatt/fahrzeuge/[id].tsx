/**
 * Werkstatt, Fahrzeugakte mit Registern: Übersicht (mit Fälligkeiten), Kilometer (mit
 * Plausibilitätsprüfung), Aufträge, Servicehistorie (Korrektur als neue Revision mit
 * Pflichtbegründung), Dokumente, Halter (Halterwechsel mit Hinweis zur Datentrennung),
 * QR (Aufkleber anzeigen und drucken, Code erneuern).
 */
import { documentKindLabels, routes, type OdometerReading, type ServiceEntry, type VehicleDetail } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useApi } from '../../../src/data/ApiProvider';
import { useApiMutation, useApiQuery } from '../../../src/data/hooks';
import { formatDate, formatDateTime, formatKm, keepPlates } from '../../../src/lib/format';
import { QueryView, openDownload } from '../../../src/screens/common';
import { dueStateLabels, dueSummary, estimateLabel, isKmEstimate } from '../../../src/screens/customer/helpers';
import { odometerSourceLabel } from '../../../src/screens/customer/labels';
import { ActionError, InlineLink, parseInteger, useCan } from '../../../src/screens/workshop/shared';
import { VehicleForm } from '../../../src/screens/workshop/VehicleForm';
import { useTheme } from '../../../src/theme';
import {
  AppText,
  Banner,
  Button,
  Checkbox,
  Columns,
  ConfirmDialog,
  DateTimeField,
  EmptyState,
  KeyValueList,
  ListGroup,
  ListRow,
  Page,
  PageHeader,
  PhotoView,
  Row,
  SearchField,
  Section,
  Sheet,
  StatusChip,
  StatusTriple,
  Tabs,
  TextField,
  useSaveShortcut,
  useTabParam,
  useToast,
} from '../../../src/ui';

const TABS = ['uebersicht', 'kilometer', 'auftraege', 'servicehistorie', 'dokumente', 'halter', 'qr'] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = { uebersicht: 'Übersicht', kilometer: 'Kilometer', auftraege: 'Aufträge', servicehistorie: 'Servicehistorie', dokumente: 'Dokumente', halter: 'Halter', qr: 'QR-Code' };

export default function VehicleFile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicleId = String(id);
  const can = useCan();
  const toast = useToast();
  const [tab, setTab] = useTabParam(TABS, 'uebersicht');
  const [editing, setEditing] = useState(false);
  const query = useApiQuery(`werkstatt:fahrzeug:${vehicleId}`, (a) => a.getVehicle(vehicleId));
  const v = query.data;
  return (
    <Page maxWidth={1120} testID="werkstatt-fahrzeugakte">
      <PageHeader
        title={v ? `${keepPlates(v.licensePlate)}, ${v.make} ${v.model}` : 'Fahrzeug'}
        subtitle={v ? `Halter: ${v.currentOwner?.displayName ?? 'ohne Halter'}${v.isTestData ? ', Beispieldaten' : ''}` : undefined}
        backHref={routes.workshop.vehicles() as Href}
        backLabel="Fahrzeuge"
        crumbs={[{ label: 'Fahrzeuge', href: routes.workshop.vehicles() as Href }, { label: v ? keepPlates(v.licensePlate) : 'Fahrzeug' }]}
        actions={
          v ? (
            <>
              {can('vehicles.write') ? <Button label="Bearbeiten" icon="PencilSimple" onPress={() => setEditing(true)} /> : null}
              {can('workOrders.write') && v.currentOwner ? <Button label="Auftrag anlegen" variant="primary" icon="Plus" onPress={() => router.push(`${routes.workshop.newWorkOrder()}?kunde=${v.currentOwner!.customerId}&fahrzeug=${v.id}` as Href)} /> : null}
            </>
          ) : undefined
        }
      />
      <Tabs label="Register der Fahrzeugakte" items={TABS.map((x) => ({ value: x, label: LABELS[x] }))} value={tab} onChange={setTab} />
      <QueryView query={query} loading="detail" notAvailableTitle="Fahrzeug nicht verfügbar">
        {(vehicle) => (
          <>
            {tab === 'uebersicht' ? <Overview vehicle={vehicle} /> : null}
            {tab === 'kilometer' ? <Odometer vehicle={vehicle} /> : null}
            {tab === 'auftraege' ? <Orders vehicle={vehicle} /> : null}
            {tab === 'servicehistorie' ? <History vehicle={vehicle} /> : null}
            {tab === 'dokumente' ? <Documents vehicle={vehicle} /> : null}
            {tab === 'halter' ? <Owners vehicle={vehicle} /> : null}
            {tab === 'qr' ? <Qr vehicle={vehicle} /> : null}
            <Sheet visible={editing} onClose={() => setEditing(false)} title="Fahrzeug bearbeiten" width={720}>
              <VehicleForm
                inDialog
                initial={vehicle}
                ownerCustomerId={vehicle.currentOwner?.customerId ?? ''}
                onCancel={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  toast.show('Fahrzeug gespeichert.');
                }}
              />
            </Sheet>
          </>
        )}
      </QueryView>
    </Page>
  );
}

function Overview({ vehicle: v }: { vehicle: VehicleDetail }) {
  const t = useTheme();
  const due = useApiQuery(`werkstatt:fahrzeug:${v.id}:faellig`, (a) => a.maintenanceDue(v.id));
  return (
    <Columns ratio={[1.2, 1]}>
      <View style={styles.stack}>
        <KeyValueList
          items={[
            { label: 'Kennzeichen', value: keepPlates(v.licensePlate), code: true },
            { label: 'Fahrzeug', value: `${v.make} ${v.model}${v.variant ? ` ${v.variant}` : ''}` },
            { label: 'FIN', value: v.vin ?? 'nicht erfasst', code: true },
            { label: 'HSN / TSN', value: v.hsn || v.tsn ? `${v.hsn ?? ''} / ${v.tsn ?? ''}` : 'nicht erfasst', code: true },
            { label: 'Erstzulassung', value: v.firstRegistration ? formatDate(v.firstRegistration) : 'nicht erfasst', numeric: true },
            { label: 'Kraftstoff, Farbe', value: [v.fuelType, v.color].filter(Boolean).join(', ') || 'nicht erfasst' },
            { label: 'Letzter km-Stand', value: v.lastOdometerKm ? `${formatKm(v.lastOdometerKm)} am ${formatDate(v.lastOdometerAt)}` : 'unbekannt', numeric: true },
            { label: 'Halter', value: v.currentOwner ? <InlineLink label={v.currentOwner.displayName} onPress={() => router.push(routes.workshop.customer(v.currentOwner!.customerId) as Href)} /> : 'ohne Halter' },
          ]}
        />
        {v.notesInternal ? (
          <View style={[styles.internal, { borderColor: t.colors.borderStrong, backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.panel }]}>
            <StatusChip status={{ label: 'Intern, nie für Kunden', tone: 'neutral', icon: 'Lock' }} />
            <AppText>{v.notesInternal}</AppText>
          </View>
        ) : null}
      </View>
      <Section title="Fälligkeiten">
        <QueryView query={due}>
          {(items) =>
            items.length === 0 ? (
              <AppText tone="muted">Keine Wartung mit Intervall in der Historie.</AppText>
            ) : (
              <ListGroup>
                {items.map((d, i) => (
                  <ListRow key={`${d.lastServiceEntryId}-${i}`} first={i === 0} title={d.title} subtitle={dueSummary(d)} meta={d.explanation}>
                    <Row wrap gap={6}>
                      <StatusChip status={dueStateLabels[d.state]} />
                      {isKmEstimate(d) ? <StatusChip status={estimateLabel} /> : null}
                    </Row>
                  </ListRow>
                ))}
              </ListGroup>
            )
          }
        </QueryView>
      </Section>
    </Columns>
  );
}

function Odometer({ vehicle }: { vehicle: VehicleDetail }) {
  const t = useTheme();
  const can = useCan();
  const toast = useToast();
  const list = useApiQuery(`werkstatt:fahrzeug:${vehicle.id}:km`, (a) => a.listOdometer(vehicle.id));
  const [value, setValue] = useState('');
  const [at, setAt] = useState<Date | null>(new Date());
  const [confirmLow, setConfirmLow] = useState(false);
  const add = useApiMutation((a, km: number) => a.addOdometer(vehicle.id, { valueKm: km, recordedAt: (at ?? new Date()).toISOString() }));
  const km = parseInteger(value);
  const last = [...(list.data ?? [])].sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))[0];
  const lower = km !== null && !Number.isNaN(km) && last ? km < last.valueKm : false;
  async function save() {
    if (km === null || Number.isNaN(km)) return;
    try {
      const r = await add.mutate(km);
      setValue('');
      setConfirmLow(false);
      toast.show(r.plausibility === 'ok' ? 'km-Stand gespeichert.' : 'km-Stand gespeichert und als unplausibel markiert.', r.plausibility === 'ok' ? 'success' : 'warning');
    } catch {
      setConfirmLow(false);
    }
  }
  return (
    <Columns ratio={[1.4, 1]}>
      <QueryView query={list}>
        {(readings: OdometerReading[]) =>
          readings.length === 0 ? (
            <EmptyState icon="Gauge" title="Keine km-Stände" />
          ) : (
            <ListGroup>
              {[...readings]
                .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))
                .map((r, i) => (
                  <ListRow key={r.id} first={i === 0} icon="Gauge" title={formatKm(r.valueKm)} subtitle={`${formatDateTime(r.recordedAt)}, ${odometerSourceLabel[r.source].replace('von Ihnen angegeben', 'vom Kunden angegeben')}`}>
                    {r.plausibility !== 'ok' ? <StatusChip status={{ label: 'Niedriger als ein früherer Stand', tone: 'warning', icon: 'Warning' }} /> : null}
                  </ListRow>
                ))}
            </ListGroup>
          )
        }
      </QueryView>
      {can('vehicles.write') ? (
        <View style={[styles.panel, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]}>
          <AppText variant="heading">km-Stand erfassen</AppText>
          <TextField label="km-Stand" value={value} onChangeText={setValue} keyboardType="number-pad" error={km !== null && Number.isNaN(km) ? 'Nur Ziffern.' : null} testID="km-wert" />
          <DateTimeField label="Abgelesen am" value={at} onChange={setAt} maximumDate={new Date()} />
          {lower ? <Banner tone="warning" message={`Der Wert liegt unter dem letzten Stand (${formatKm(last!.valueKm)}). Bitte prüfen; gespeichert wird er als unplausibel markiert.`} /> : null}
          <Button label="Speichern" variant="primary" icon="Check" disabled={km === null || Number.isNaN(km)} loading={add.pending} onPress={() => (lower ? setConfirmLow(true) : void save())} testID="km-speichern" />
          <ActionError error={add.error} />
          <ConfirmDialog visible={confirmLow} title="Niedrigeren km-Stand speichern?" message="Zum Beispiel nach einem Tachotausch. Der Eintrag wird als unplausibel markiert und fließt nicht in Schätzungen ein." confirmLabel="Trotzdem speichern" loading={add.pending} onCancel={() => setConfirmLow(false)} onConfirm={() => void save()} />
        </View>
      ) : (
        <View />
      )}
    </Columns>
  );
}

function Orders({ vehicle }: { vehicle: VehicleDetail }) {
  const list = useApiQuery(`werkstatt:fahrzeug:${vehicle.id}:auftraege`, (a) => a.listWorkOrders({ vehicleId: vehicle.id }));
  return (
    <QueryView query={list}>
      {(page) =>
        page.items.length === 0 ? (
          <EmptyState icon="ClipboardText" title="Keine Aufträge" />
        ) : (
          <>
            <AppText variant="small" tone="subtle">Aufträge gehören dem jeweiligen Kunden. Aufträge früherer Halter sieht der neue Halter nicht.</AppText>
            <ListGroup>
              {page.items.map((o, i) => (
                <ListRow key={o.id} first={i === 0} title={`${o.orderNumber}: ${o.title}`} subtitle={o.customerDisplayName} meta={`Geändert ${formatDate(o.updatedAt)}`} onPress={() => router.push(routes.workshop.workOrder(o.id) as Href)}>
                  <StatusTriple status={o.status} compact />
                </ListRow>
              ))}
            </ListGroup>
          </>
        )
      }
    </QueryView>
  );
}

function History({ vehicle }: { vehicle: VehicleDetail }) {
  const t = useTheme();
  const can = useCan();
  const [correct, setCorrect] = useState<ServiceEntry | null>(null);
  const [showAll, setShowAll] = useState(false);
  const list = useApiQuery(`werkstatt:fahrzeug:${vehicle.id}:historie`, (a) => a.listServiceEntries(vehicle.id));
  return (
    <QueryView query={list}>
      {(entries) => {
        const shown = showAll ? entries : entries.filter((e) => e.status === 'valid');
        return (
          <>
            <Row wrap style={styles.between}>
              <AppText variant="small" tone="subtle">Einträge entstehen nur beim fachlichen Abschluss ausgeführter Wartungsarbeit. Korrekturen erzeugen eine neue Revision; nichts wird überschrieben.</AppText>
              <Checkbox label="Ersetzte und stornierte Revisionen zeigen" checked={showAll} onChange={setShowAll} testID="revisionen-zeigen" />
            </Row>
            {shown.length === 0 ? (
              <EmptyState icon="SealCheck" title="Keine Serviceeinträge" />
            ) : (
              shown.map((e) => (
                <View key={e.id} style={[styles.entry, { borderColor: t.colors.border, backgroundColor: e.status === 'valid' ? t.colors.surface : t.colors.surfaceSunken, borderRadius: t.radius.panel }]} testID={`serviceeintrag-${e.id}`}>
                  <Row wrap style={styles.between}>
                    <AppText variant="bodyStrong">{e.title}</AppText>
                    <Row wrap gap={6}>
                      {e.revisionNo > 1 ? <StatusChip status={{ label: `Revision ${e.revisionNo}`, tone: 'info', icon: 'PencilSimple' }} /> : null}
                      <StatusChip status={e.status === 'valid' ? { label: 'Gültig', tone: 'success', icon: 'CheckCircle' } : e.status === 'superseded' ? { label: 'Ersetzt', tone: 'neutral', icon: 'ArrowCounterClockwise' } : { label: 'Storniert', tone: 'danger', icon: 'XCircle' }} />
                    </Row>
                  </Row>
                  <AppText tone="muted" numeric>
                    {formatDate(e.performedOn)}, {formatKm(e.odometerKm)}, {e.workshopName}
                    {e.maintenanceTypeName ? `, ${e.maintenanceTypeName}` : ''}
                  </AppText>
                  {e.details ? <AppText>{e.details}</AppText> : null}
                  {e.nextDueDate || e.nextDueKm ? (
                    <AppText variant="small" tone="subtle" numeric>
                      Nächste Fälligkeit: {[e.nextDueDate ? formatDate(e.nextDueDate) : null, e.nextDueKm ? formatKm(e.nextDueKm) : null].filter(Boolean).join(' oder ')}
                    </AppText>
                  ) : null}
                  {e.correctionReason ? <AppText variant="small">Korrekturgrund: {e.correctionReason}</AppText> : null}
                  <Row wrap>
                    {e.workOrderId ? <Button label="Auftrag öffnen" variant="quiet" iconRight="CaretRight" onPress={() => router.push(routes.workshop.workOrder(e.workOrderId!) as Href)} /> : null}
                    {e.status === 'valid' && can('serviceHistory.correct') ? <Button label="Korrigieren" icon="PencilSimple" onPress={() => setCorrect(e)} testID={`korrigieren-${e.id}`} /> : null}
                  </Row>
                </View>
              ))
            )}
            <CorrectionSheet entry={correct} onClose={() => setCorrect(null)} />
          </>
        );
      }}
    </QueryView>
  );
}

function CorrectionSheet({ entry, onClose }: { entry: ServiceEntry | null; onClose: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState<Date | null>(null);
  const [km, setKm] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [voidIt, setVoidIt] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const save = useApiMutation((a, input: Parameters<typeof a.correctServiceEntry>[1]) => a.correctServiceEntry(entry!.id, input));
  useEffect(() => {
    if (!entry) return;
    save.reset();
    setDate(new Date(entry.performedOn));
    setKm(entry.odometerKm !== null ? String(entry.odometerKm) : '');
    setTitle(entry.title);
    setDetails(entry.details ?? '');
    setVoidIt(false);
    setReason('');
    setError(null);
    setConfirm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);
  function check() {
    if (!reason.trim()) return setError('Bitte die Begründung angeben (Pflicht).'), false;
    const k = parseInteger(km);
    if (k !== null && Number.isNaN(k)) return setError('km-Stand nur in Ziffern.'), false;
    setError(null);
    return true;
  }
  async function submit() {
    if (!entry) return;
    const k = parseInteger(km);
    const d = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : entry.performedOn;
    try {
      await save.mutate({ performedOn: d, odometerKm: k === null || Number.isNaN(k) ? null : k, title: title.trim() || entry.title, details: details.trim() || null, void: voidIt, reason: reason.trim() });
      setConfirm(false);
      toast.show(voidIt ? 'Eintrag storniert (neue Revision).' : 'Korrektur als neue Revision gespeichert.');
      onClose();
    } catch {
      setConfirm(false);
    }
  }
  useSaveShortcut(() => check() && setConfirm(true), entry !== null && !confirm, 'dialog');
  return (
    <>
      <Sheet
        visible={entry !== null && !confirm}
        onClose={onClose}
        title="Serviceeintrag korrigieren"
        testID="korrektur-blatt"
        footer={
          <>
            <Button label="Abbrechen" onPress={onClose} />
            <Button label="Weiter" variant="primary" onPress={() => check() && setConfirm(true)} testID="korrektur-weiter" />
          </>
        }
      >
        <Banner tone="info" message="Die Korrektur erzeugt eine neue Revision. Der bisherige Stand bleibt als ersetzt nachvollziehbar." />
        <DateTimeField label="Durchgeführt am" value={date} onChange={setDate} mode="date" maximumDate={new Date()} />
        <TextField label="km-Stand" value={km} onChangeText={setKm} keyboardType="number-pad" help="Leer lassen, wenn unbekannt." testID="korrektur-km" />
        <TextField label="Titel" value={title} onChangeText={setTitle} />
        <TextField label="Details" value={details} onChangeText={setDetails} multiline />
        <Checkbox label="Eintrag stornieren (war falsch angelegt)" checked={voidIt} onChange={setVoidIt} />
        <TextField label="Begründung" value={reason} onChangeText={setReason} required multiline error={error} testID="korrektur-grund" />
        <ActionError error={save.error} />
      </Sheet>
      <ConfirmDialog
        visible={confirm}
        title={voidIt ? 'Serviceeintrag stornieren?' : 'Korrektur speichern?'}
        message={`Es entsteht Revision ${(entry?.revisionNo ?? 1) + 1}. Begründung: ${reason.trim()}`}
        confirmLabel={voidIt ? 'Stornieren' : 'Korrektur speichern'}
        tone={voidIt ? 'destructive' : 'primary'}
        loading={save.pending}
        onCancel={() => setConfirm(false)}
        testID="korrektur-dialog"
        onConfirm={() => void submit()}
      >
        <ActionError error={save.error} />
      </ConfirmDialog>
    </>
  );
}

function Documents({ vehicle }: { vehicle: VehicleDetail }) {
  const api = useApi();
  const toast = useToast();
  const list = useApiQuery(`werkstatt:fahrzeug:${vehicle.id}:dokumente`, (a) => a.listDocuments({ vehicleId: vehicle.id }));
  return (
    <QueryView query={list}>
      {(docs) =>
        docs.length === 0 ? (
          <EmptyState icon="FileText" title="Keine Dokumente" />
        ) : (
          <ListGroup>
            {docs.map((d, i) => (
              <ListRow
                key={d.id}
                first={i === 0}
                icon="FileText"
                title={d.title}
                subtitle={`${documentKindLabels[d.kind]}, ${formatDate(d.currentVersion.createdAt)}`}
                right={<StatusChip status={d.publishedAt ? { label: 'Veröffentlicht', tone: 'info', icon: 'Eye' } : { label: 'Intern', tone: 'neutral', icon: 'Lock' }} />}
                onPress={async () => {
                  try {
                    await openDownload(await api.downloadDocument(d.id), d.title);
                  } catch {
                    toast.show('Das Dokument konnte nicht geladen werden.', 'danger');
                  }
                }}
              />
            ))}
          </ListGroup>
        )
      }
    </QueryView>
  );
}

function Owners({ vehicle }: { vehicle: VehicleDetail }) {
  const t = useTheme();
  const can = useCan();
  const toast = useToast();
  const list = useApiQuery(`werkstatt:fahrzeug:${vehicle.id}:halter`, (a) => a.listOwnerships(vehicle.id));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<{ id: string; displayName: string } | null>(null);
  const [at, setAt] = useState<Date | null>(new Date());
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const customers = useApiQuery(open ? `werkstatt:halterwechsel:kunden:${q.trim()}` : null, (a) => a.listCustomers({ q: q.trim() || undefined }));
  const transfer = useApiMutation((a) => a.transferOwnership(vehicle.id, { newCustomerId: target!.id, effectiveAt: (at ?? new Date()).toISOString(), note: note.trim() || null }));
  return (
    <>
      <Section title="Halterverlauf" action={can('vehicles.transferOwnership') ? <Button label="Halterwechsel" icon="ArrowsLeftRight" variant="primary" onPress={() => { setOpen(true); setTarget(null); setQ(''); setNote(''); transfer.reset(); }} testID="halterwechsel" /> : null}>
        <QueryView query={list}>
          {(items) => (
            <ListGroup>
              {[...items]
                .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
                .map((o, i) => (
                  <ListRow key={o.id} first={i === 0} icon="UserCircle" title={o.customerDisplayName} subtitle={`seit ${formatDate(o.startedAt)}${o.endedAt ? ` bis ${formatDate(o.endedAt)}` : ''}${o.note ? `, ${o.note}` : ''}`} right={<StatusChip status={o.endedAt ? { label: 'Früherer Halter', tone: 'neutral', icon: 'ClockCounterClockwise' } : { label: 'Aktueller Halter', tone: 'success', icon: 'CheckCircle' }} />} onPress={() => router.push(routes.workshop.customer(o.customerId) as Href)} />
                ))}
            </ListGroup>
          )}
        </QueryView>
      </Section>
      <Sheet
        visible={open && !confirm}
        onClose={() => setOpen(false)}
        title="Halterwechsel"
        width={640}
        testID="halterwechsel-blatt"
        footer={
          <>
            <Button label="Abbrechen" onPress={() => setOpen(false)} />
            <Button label="Weiter" variant="primary" disabled={!target || !at} onPress={() => setConfirm(true)} testID="halterwechsel-weiter" />
          </>
        }
      >
        <View style={[styles.warning, { borderColor: t.colors.warning, backgroundColor: t.colors.warningSoft, borderRadius: t.radius.panel }]} testID="datentrennung-hinweis">
          <AppText variant="bodyStrong">Datentrennung beachten</AppText>
          <AppText>
            Der neue Halter sieht danach das Fahrzeug und seine Servicehistorie ohne Auftragsbezug. Aufträge, Dokumente, Nachrichten, Freigaben und Rechnungen des bisherigen Halters sieht er nie. Freigabelinks des bisherigen Halters werden widerrufen, die öffentliche QR-Ansicht wird ausgeschaltet.
          </AppText>
        </View>
        <AppText variant="caption" tone="muted">Neuer Halter</AppText>
        {target ? (
          <Banner tone="success" title={target.displayName} action={<Button label="Ändern" variant="quiet" onPress={() => setTarget(null)} />} />
        ) : (
          <>
            <SearchField value={q} onChangeText={setQ} label="Neuen Halter suchen" placeholder="Name, Telefon oder E-Mail" />
            <ListGroup>
              {(customers.data?.items ?? [])
                .filter((c) => c.id !== vehicle.currentOwner?.customerId)
                .slice(0, 8)
                .map((c, i) => (
                  <ListRow key={c.id} first={i === 0} icon="UserCircle" title={c.displayName} subtitle={c.customerNumber} onPress={() => setTarget({ id: c.id, displayName: c.displayName })} testID={`neuer-halter-${c.customerNumber}`} />
                ))}
            </ListGroup>
          </>
        )}
        <DateTimeField label="Wirksam ab" value={at} onChange={setAt} maximumDate={new Date()} />
        <TextField label="Notiz (freiwillig)" value={note} onChangeText={setNote} />
        <ActionError error={transfer.error} />
      </Sheet>
      <ConfirmDialog
        visible={confirm}
        title={`${keepPlates(vehicle.licensePlate)} auf ${target?.displayName ?? ''} umschreiben?`}
        message={`Bisheriger Halter: ${vehicle.currentOwner?.displayName ?? 'keiner'}. Dessen Aufträge, Dokumente, Nachrichten, Freigaben und Rechnungen bleiben bei ihm; der neue Halter sieht sie nicht.`}
        confirmLabel="Halter wechseln"
        icon="ArrowsLeftRight"
        loading={transfer.pending}
        onCancel={() => setConfirm(false)}
        testID="halterwechsel-dialog"
        onConfirm={async () => {
          try {
            await transfer.mutate();
            setConfirm(false);
            setOpen(false);
            toast.show('Halter gewechselt.');
          } catch {
            setConfirm(false);
          }
        }}
      >
        <ActionError error={transfer.error} />
      </ConfirmDialog>
    </>
  );
}

function Qr({ vehicle }: { vehicle: VehicleDetail }) {
  const t = useTheme();
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const [rotate, setRotate] = useState(false);
  const rotation = useApiMutation((a) => a.rotateQr(vehicle.id));
  const sticker = api.qrStickerSource(vehicle.id);
  return (
    <>
    <Columns ratio={[1, 1]}>
      <View style={[styles.panel, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]} testID="qr-aufkleber">
        <AppText variant="heading">Aufkleber</AppText>
        <PhotoView source={sticker} caption={`QR-Aufkleber ${vehicle.licensePlate}`} height={240} fit="contain" />
        {vehicle.qrUrl ? <AppText variant="small" tone="subtle" code selectable>{vehicle.qrUrl}</AppText> : null}
        <Row wrap>
          {Platform.OS === 'web' ? <Button label="Drucken" icon="Printer" onPress={() => typeof window !== 'undefined' && window.print()} /> : null}
        </Row>
      </View>
      <View style={styles.stack}>
        <Section title="Was der QR-Code zeigt">
          <AppText>Der QR-Code ist kein Generalschlüssel. Ohne Anmeldung zeigt er nur, was der aktuelle Halter ausdrücklich freigegeben hat (öffentliche Ansicht: {vehicle.qrPublicViewEnabled ? 'eingeschaltet' : 'ausgeschaltet'}). Mitarbeiter sehen nach der Anmeldung die Fahrzeugakte.</AppText>
        </Section>
        {can('vehicles.write') ? (
          <Section title="Code erneuern">
            <AppText variant="small" tone="muted">Nötig, wenn ein Aufkleber verloren ging oder ein altes Foto im Umlauf ist. Der alte Code funktioniert danach nicht mehr; ein neuer Aufkleber muss aufgeklebt werden.</AppText>
            <Button label="Code erneuern" icon="ArrowsClockwise" onPress={() => setRotate(true)} testID="qr-erneuern" />
          </Section>
        ) : null}
      </View>
    </Columns>
      <ConfirmDialog
        visible={rotate}
        title="QR-Code erneuern?"
        message="Der bisherige Aufkleber wird sofort ungültig. Bitte danach den neuen Aufkleber drucken und anbringen."
        confirmLabel="Code erneuern"
        tone="destructive"
        loading={rotation.pending}
        onCancel={() => setRotate(false)}
        onConfirm={async () => {
          try {
            await rotation.mutate();
            setRotate(false);
            toast.show('Neuer QR-Code erzeugt. Bitte den Aufkleber drucken.');
          } catch {
            // Fehler im Dialog
          }
        }}
      >
        <ActionError error={rotation.error} />
      </ConfirmDialog>
    </>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 24 },
  between: { justifyContent: 'space-between', alignItems: 'center' },
  internal: { borderWidth: 1, borderStyle: 'dashed', padding: 16, gap: 8 },
  panel: { borderWidth: 1, padding: 16, gap: 12 },
  entry: { borderWidth: 1, padding: 16, gap: 6 },
  warning: { borderWidth: 1, borderLeftWidth: 4, padding: 16, gap: 6 },
});
