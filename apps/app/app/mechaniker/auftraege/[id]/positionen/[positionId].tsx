/**
 * Mechaniker, Position: Beschreibung, Zeit, verbaute Teile, Notiz. Starten, Pausieren,
 * Abschließen (Hauptaktionen mindestens 56 hoch). Wartungspositionen verlangen beim
 * Abschluss den km-Stand oder ausdrücklich "km-Stand unbekannt" und die Wahl des Intervalls
 * aus den Optionen der Wartungsart. Alles geht über die Offline-Warteschlange; ohne
 * Verbindung wird gespeichert und später übertragen (mit dem Erfassungszeitpunkt auf dem
 * Gerät). Nicht freigegebene Positionen sind gesperrt ("Wartet auf Kundenfreigabe" bzw.
 * "Abgelehnt, nicht ausführen").
 *
 * Zeit und Teile kommen vom Server (`trackedMinutes`, `runningSince`, `parts`); lokal ergänzt
 * wird nur, was noch nicht übertragen ist (src/screens/mechanic/timing.ts).
 */
import { routes, workItemAuthorizationLabels, workItemExecutionLabels, type MaintenanceType, type WorkItem, type WorkOrderDetail } from '@werkstatt/contracts';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatDateTime, formatKm, formatTime } from '../../../../../src/lib/format';
import { newClientId } from '../../../../../src/lib/pickImage';
import { usePendingFor, useOfflineQueue } from '../../../../../src/offline/OfflineQueueProvider';
import type { QueueError } from '../../../../../src/offline/queueCore';
import { useCachedQuery } from '../../../../../src/offline/useCachedQuery';
import { QueryView } from '../../../../../src/screens/common';
import { expectedExecution, PendingChip } from '../../../../../src/screens/mechanic/pending';
import { itemTiming, partLabel, partRows } from '../../../../../src/screens/mechanic/timing';
import { parseInteger, parseQuantity } from '../../../../../src/screens/workshop/shared';
import { useTheme } from '../../../../../src/theme';
import { AppText, Banner, Button, Checkbox, ConfirmDialog, Page, PageHeader, Row, Section, Select, Sheet, StatusChip, TextField, useToast } from '../../../../../src/ui';

/** Aktuelle Uhrzeit, alle 15 Sekunden neu, solange `active` (Anzeige der laufenden Zeit). */
function useNow(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    if (!active) return;
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export default function MechanicWorkItem() {
  const { id, positionId } = useLocalSearchParams<{ id: string; positionId: string }>();
  const orderId = String(id);
  const itemId = String(positionId);
  const query = useCachedQuery(`mechaniker:auftrag:${orderId}:position`, async (api) => {
    const [order, types] = await Promise.all([api.getWorkOrder(orderId), api.listMaintenanceTypes().catch(() => [] as MaintenanceType[])]);
    // Ladezeitpunkt auf dem Gerät: ab hier zählt die Anzeige die laufende Zeit weiter
    return { order, types, fetchedAt: new Date().toISOString() };
  });
  const item = query.data?.order.items.find((i) => i.id === itemId);
  return (
    <Page maxWidth={760} testID="mechaniker-position">
      <PageHeader
        title={item?.title ?? 'Position'}
        subtitle={query.data ? `${query.data.order.orderNumber}, ${query.data.order.licensePlate}` : undefined}
        backHref={routes.mechanic.workOrder(orderId) as Href}
        backLabel="Auftrag"
        crumbs={[{ label: 'Heute', href: routes.mechanic.home() as Href }, { label: query.data?.order.orderNumber ?? 'Auftrag', href: routes.mechanic.workOrder(orderId) as Href }, { label: item?.title ?? 'Position' }]}
      />
      {query.cachedAt ? <Banner tone="info" message={`Ohne Verbindung. Stand vom ${formatTime(query.cachedAt)} Uhr; Aktionen werden gespeichert und später übertragen.`} /> : null}
      <QueryView query={query} loading="detail" notAvailableTitle="Position nicht verfügbar">
        {({ order, types, fetchedAt }) => {
          const i = order.items.find((x) => x.id === itemId);
          if (!i) return <Banner tone="neutral" title="Position nicht gefunden" message="Sie wurde möglicherweise zurückgezogen." />;
          return <ItemView order={order} item={i} type={types.find((m) => m.id === i.maintenanceTypeId) ?? null} fetchedAt={fetchedAt ?? null} />;
        }}
      </QueryView>
    </Page>
  );
}

function ItemView({ order, item, type, fetchedAt }: { order: WorkOrderDetail; item: WorkItem; type: MaintenanceType | null; fetchedAt: string | null }) {
  const t = useTheme();
  const toast = useToast();
  const { submit, online } = useOfflineQueue();
  const scope = `item:${item.id}`;
  const pending = usePendingFor({ scope });
  const status = expectedExecution(item, pending);
  const locked = item.authorization === 'pending_approval';
  const blocked = item.authorization === 'rejected' || item.authorization === 'withdrawn';
  const finished = status === 'done' || status === 'not_done';
  const now = useNow(status === 'in_progress');
  const timing = itemTiming(item, pending, fetchedAt, now);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<QueueError | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [notDoneOpen, setNotDoneOpen] = useState(false);
  const [partOpen, setPartOpen] = useState(false);
  const [notDoneReason, setNotDoneReason] = useState('');
  const parts = partRows(item.parts, pending);

  async function run(kind: 'startWorkItem' | 'pauseWorkItem' | 'finishWorkItem' | 'notDoneWorkItem' | 'addPart', payload: Record<string, unknown>, label: string, success: string) {
    setBusy(true);
    setRejected(null);
    const entryId = newClientId();
    try {
      const result = await submit([{ id: entryId, kind, workOrderId: order.id, scope, label: `${label}: ${item.title}`, payload: { itemId: item.id, ...payload } }]);
      if (result.type === 'rejected') {
        setRejected(result.error);
        return false;
      }
      toast.show(result.type === 'queued' ? `${success} Gespeichert, wird übertragen, sobald eine Verbindung besteht.` : success, result.type === 'queued' ? 'info' : 'success');
      return true;
    } finally {
      setBusy(false);
    }
  }

  if (locked || blocked) {
    return (
      <View style={[styles.lock, { borderColor: locked ? t.colors.warning : t.colors.borderStrong, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]} testID="position-gesperrt">
        <StatusChip status={locked ? { label: 'Wartet auf Kundenfreigabe', tone: 'warning', icon: 'Lock' } : { label: item.authorization === 'rejected' ? 'Abgelehnt, nicht ausführen' : 'Zurückgezogen, nicht ausführen', tone: 'neutral', icon: 'Prohibit' }} />
        <AppText variant="heading">{locked ? 'Noch nicht beginnen' : 'Diese Arbeit nicht ausführen'}</AppText>
        <AppText tone="muted">
          {locked
            ? 'Der Kunde hat diese Arbeit noch nicht freigegeben. Sobald er freigibt, können Sie hier starten. Eine Zusage am Telefon oder im Chat reicht nicht.'
            : 'Der Kunde hat abgelehnt bzw. die Werkstatt hat die Anfrage zurückgezogen. Die Position erscheint nicht in der Servicehistorie.'}
        </AppText>
        {item.description ? <AppText>{item.description}</AppText> : null}
      </View>
    );
  }

  return (
    <>
      <Row wrap gap={8}>
        <StatusChip status={workItemAuthorizationLabels[item.authorization]} />
        <StatusChip status={workItemExecutionLabels[status]} testID="position-status" />
        <PendingChip entries={pending} />
      </Row>
      {rejected ? <Banner tone="danger" title="Nicht möglich" message={rejected.message} testID="position-abgelehnt" /> : null}
      {item.description ? (
        <Section title="Beschreibung">
          <AppText>{item.description}</AppText>
        </Section>
      ) : null}
      <View style={[styles.time, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]}>
        <AppText variant="caption" tone="muted">Zeit</AppText>
        <AppText variant="title" numeric testID="position-zeit">
          {timing.minutes} min
        </AppText>
        <AppText variant="small" tone="subtle" testID="position-zeit-hinweis">
          {status === 'in_progress'
            ? timing.since
              ? `Läuft seit ${formatTime(timing.since)} Uhr${timing.sinceLocal ? ' (auf diesem Gerät gestartet, noch nicht übertragen)' : ''}.`
              : 'Läuft.'
            : status === 'paused'
              ? 'Pausiert.'
              : finished
                ? `Abgeschlossen${item.doneAt ? ` ${formatDateTime(item.doneAt)}` : ''}.`
                : 'Noch nicht begonnen.'}
        </AppText>
        {item.maintenanceTypeId ? <AppText variant="small" tone="subtle">Wartungsposition: {type?.name ?? 'Wartung'}. Abschluss mit km-Stand.</AppText> : null}
      </View>
      {!finished ? (
        <View style={styles.actions}>
          {status === 'planned' || status === 'paused' ? (
            <Button label={status === 'paused' ? 'Fortsetzen' : 'Starten'} size="lg" variant="primary" icon="Play" fullWidth loading={busy} onPress={() => void run('startWorkItem', {}, 'Start', 'Gestartet.')} testID="position-starten" />
          ) : null}
          {status === 'in_progress' ? <Button label="Pausieren" size="lg" icon="Pause" fullWidth loading={busy} onPress={() => void run('pauseWorkItem', {}, 'Pause', 'Pausiert.')} testID="position-pausieren" /> : null}
          <Button label="Abschließen" size="lg" variant={status === 'in_progress' ? 'primary' : 'secondary'} icon="CheckCircle" fullWidth onPress={() => setFinishOpen(true)} testID="position-abschliessen" />
          <Row wrap gap={12}>
            <View style={styles.grow}>
              <Button label="Teil erfassen" size="lg" icon="Package" fullWidth onPress={() => setPartOpen(true)} testID="teil-erfassen" />
            </View>
            <View style={styles.grow}>
              <Button label="Nicht durchgeführt" size="lg" icon="Prohibit" fullWidth onPress={() => setNotDoneOpen(true)} />
            </View>
          </Row>
        </View>
      ) : (
        <Banner tone="success" title={status === 'done' ? 'Erledigt' : 'Nicht durchgeführt'} message={item.resultNotes ?? (item.doneOdometerKm !== null ? `km-Stand ${formatKm(item.doneOdometerKm)}` : undefined)} />
      )}
      {!online ? <AppText variant="small" tone="subtle">Ohne Verbindung: Aktionen werden auf dem Gerät gespeichert und in dieser Reihenfolge übertragen.</AppText> : null}
      <Section title={`Verbaute Teile (${parts.length})`}>
        {parts.length === 0 ? <AppText tone="muted">Noch keine Teile erfasst.</AppText> : null}
        {parts.map((p) => (
          <Row key={p.key} wrap gap={8}>
            <View style={styles.flex} testID={p.pending ? 'teil-wartend' : 'teil'}>
              <AppText>{partLabel(p)}</AppText>
              <AppText variant="small" tone="subtle" numeric>
                {p.pending ? `Erfasst ${formatTime(p.recordedAt)} Uhr auf diesem Gerät, noch nicht übertragen` : `Erfasst ${formatDateTime(p.recordedAt)}`}
              </AppText>
            </View>
            {p.pending ? <PendingChip entries={[p.pending.entry]} label="Nicht übertragen" /> : null}
          </Row>
        ))}
      </Section>
      <FinishSheet
        visible={finishOpen}
        item={item}
        type={type}
        busy={busy}
        onClose={() => setFinishOpen(false)}
        onFinish={async (input) => {
          const ok = await run('finishWorkItem', { input }, 'Abschluss', 'Position abgeschlossen.');
          if (ok) setFinishOpen(false);
        }}
      />
      <ConfirmDialog
        visible={notDoneOpen}
        title="Als nicht durchgeführt markieren?"
        message="Die Position erscheint nicht in der Servicehistorie. Der Service sieht die Begründung."
        confirmLabel="Nicht durchgeführt"
        tone="destructive"
        loading={busy}
        onCancel={() => setNotDoneOpen(false)}
        onConfirm={async () => {
          if (!notDoneReason.trim()) return;
          const ok = await run('notDoneWorkItem', { input: { reason: notDoneReason.trim() } }, 'Nicht durchgeführt', 'Als nicht durchgeführt markiert.');
          if (ok) {
            setNotDoneOpen(false);
            setNotDoneReason('');
          }
        }}
      >
        <TextField label="Begründung" value={notDoneReason} onChangeText={setNotDoneReason} required multiline error={notDoneReason.trim() ? null : 'Pflichtfeld'} />
      </ConfirmDialog>
      <PartSheet
        visible={partOpen}
        onClose={() => setPartOpen(false)}
        busy={busy}
        onSave={async (input) => {
          const ok = await run('addPart', { input }, 'Teil', 'Teil erfasst.');
          if (ok) setPartOpen(false);
        }}
      />
    </>
  );
}

function FinishSheet({
  visible,
  item,
  type,
  busy,
  onClose,
  onFinish,
}: {
  visible: boolean;
  item: WorkItem;
  type: MaintenanceType | null;
  busy: boolean;
  onClose: () => void;
  onFinish: (input: Record<string, unknown>) => void;
}) {
  const maintenance = !!item.maintenanceTypeId;
  const [km, setKm] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [notes, setNotes] = useState('');
  const [interval, setInterval] = useState('default');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setKm('');
    setUnknown(false);
    setNotes('');
    setError(null);
    setInterval(item.intervalKm || item.intervalMonths ? `${item.intervalKm ?? ''}|${item.intervalMonths ?? ''}` : 'default');
  }, [visible, item.intervalKm, item.intervalMonths]);
  const options = useMemo(() => {
    if (!type) return [];
    const base = [{ value: 'default', label: `Standard: ${[type.defaultIntervalKm ? formatKm(type.defaultIntervalKm) : null, type.defaultIntervalMonths ? `${type.defaultIntervalMonths} Monate` : null].filter(Boolean).join(' oder ') || 'ohne'}` }];
    const extra = type.intervalOptions.map((o) => ({ value: `${o.km ?? ''}|${o.months ?? ''}`, label: o.label }));
    const current = item.intervalKm || item.intervalMonths ? [{ value: `${item.intervalKm ?? ''}|${item.intervalMonths ?? ''}`, label: `Laut Auftrag: ${[item.intervalKm ? formatKm(item.intervalKm) : null, item.intervalMonths ? `${item.intervalMonths} Monate` : null].filter(Boolean).join(' oder ')}` }] : [];
    const all = [...current, ...base, ...extra];
    return all.filter((o, i) => all.findIndex((x) => x.value === o.value) === i);
  }, [type, item.intervalKm, item.intervalMonths]);

  function submit() {
    const input: Record<string, unknown> = { resultNotes: notes.trim() || null };
    if (maintenance) {
      const value = parseInteger(km);
      if (!unknown && (value === null || Number.isNaN(value))) return setError('km-Stand eintragen oder "km-Stand unbekannt" wählen.');
      // ausdrücklich null = km unbekannt (API: fehlt das Feld, wird der km-Stand verlangt)
      input.odometerKm = unknown ? null : value;
      if (interval !== 'default') {
        const [ikm, imonths] = interval.split('|');
        input.intervalKm = ikm ? Number(ikm) : null;
        input.intervalMonths = imonths ? Number(imonths) : null;
      }
    }
    setError(null);
    onFinish(input);
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Position abschließen"
      testID="abschluss-blatt"
      footer={
        <>
          <Button label="Abbrechen" onPress={onClose} />
          <Button label="Abschließen" variant="primary" size="lg" icon="CheckCircle" loading={busy} onPress={submit} testID="abschluss-bestaetigen" />
        </>
      }
    >
      {maintenance ? (
        <>
          <TextField label="km-Stand" value={km} onChangeText={setKm} keyboardType="number-pad" editable={!unknown} required={!unknown} error={error} testID="abschluss-km" />
          <Checkbox label="km-Stand unbekannt (Tacho defekt oder nicht ablesbar)" checked={unknown} onChange={setUnknown} testID="km-unbekannt" />
          {options.length > 0 ? <Select label="Intervall für die nächste Fälligkeit" value={interval} onChange={setInterval} options={options} testID="abschluss-intervall" /> : null}
        </>
      ) : null}
      <TextField label="Notiz zum Ergebnis (freiwillig)" value={notes} onChangeText={setNotes} multiline help="Tipp: Die Mikrofontaste der Gerätetastatur diktiert. Ob das auf dem Gerät bleibt, hängt von den Systemeinstellungen ab (O-9)." />
    </Sheet>
  );
}

function PartSheet({ visible, onClose, onSave, busy }: { visible: boolean; onClose: () => void; onSave: (input: { partNumber: string | null; description: string; quantity: number }) => void; busy: boolean }) {
  const [number, setNumber] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  useEffect(() => {
    if (visible) {
      setNumber('');
      setDescription('');
      setQuantity('1');
    }
  }, [visible]);
  const q = parseQuantity(quantity);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Verbautes Teil"
      testID="teil-blatt"
      footer={
        <>
          <Button label="Abbrechen" onPress={onClose} />
          <Button label="Speichern" variant="primary" size="lg" loading={busy} disabled={!description.trim() || !(q > 0)} onPress={() => onSave({ partNumber: number.trim() || null, description: description.trim(), quantity: q })} testID="teil-speichern" />
        </>
      }
    >
      <TextField label="Bezeichnung" value={description} onChangeText={setDescription} required testID="teil-bezeichnung" />
      <Row wrap gap={12}>
        <View style={styles.grow}>
          <TextField label="Teilenummer (freiwillig)" value={number} onChangeText={setNumber} autoCapitalize="characters" testID="teil-nummer" />
        </View>
        <View style={styles.grow}>
          <TextField label="Menge" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" error={q > 0 ? null : 'Menge größer 0'} testID="teil-menge" />
        </View>
      </Row>
      <AppText variant="small" tone="subtle">Ohne Preise; die Abrechnung macht der Service.</AppText>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  lock: { borderWidth: 1, borderLeftWidth: 4, padding: 16, gap: 10 },
  time: { borderWidth: 1, padding: 16, gap: 4 },
  actions: { gap: 12 },
  grow: { flexGrow: 1, flexBasis: 200 },
  flex: { flex: 1, minWidth: 0 },
});
