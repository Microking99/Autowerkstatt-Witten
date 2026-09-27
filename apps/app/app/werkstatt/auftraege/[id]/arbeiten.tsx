/**
 * Werkstatt, Auftrag, Register Arbeiten: Positionen mit Freigabe- und Ausführungsstatus,
 * Zeiten (laufend seit) und Zuweisung; verbaute Teile je Position (mit Preis, soweit erfasst);
 * gemeldete Feststellungen der Mechaniker. Aktionen: Position hinzufügen bzw. ändern (nach
 * bestätigter Annahme nur über Freigabe: approval_required), aus einer Feststellung eine
 * Freigabeanfrage erstellen, Feststellung verwerfen.
 */
import {
  findingSeverityLabels,
  routes,
  workItemAuthorizationLabels,
  workItemExecutionLabels,
  type Finding,
  type MaintenanceType,
  type PartUsed,
  type WorkItem,
  type WorkItemKind,
  type WorkOrderDetail,
} from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApi } from '../../../../src/data/ApiProvider';
import { ERROR_CODES, type ApiError } from '../../../../src/data/errors';
import { useApiMutation, useApiQuery } from '../../../../src/data/hooks';
import { formatDateTime, formatKm, formatMoney, formatTime } from '../../../../src/lib/format';
import { lineGross } from '../../../../src/screens/customer/money';
import { WorkOrderFrame } from '../../../../src/screens/workshop/WorkOrderFrame';
import { ActionError, centsToInput, findingStatusLabels, parseEuro, parseQuantity, useCan } from '../../../../src/screens/workshop/shared';
import { useStaffDirectory } from '../../../../src/screens/workshop/staff';
import { useTheme } from '../../../../src/theme';
import {
  AppText,
  Banner,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  PhotoGrid,
  Row,
  Section,
  Select,
  Sheet,
  StatusChip,
  TextField,
  useSaveShortcut,
  useToast,
} from '../../../../src/ui';

const KIND_LABELS: Record<WorkItemKind, string> = { labor: 'Arbeit', part: 'Teil', flat_rate: 'Pauschale', other: 'Sonstiges' };

/** "4,5 × Motoröl 5W-30 (OF-1034)" */
function partText(p: PartUsed): string {
  return `${String(p.quantity).replace('.', ',')} × ${p.description}${p.partNumber ? ` (${p.partNumber})` : ''}`;
}

/** Preis je Teil, falls erfasst (Mechaniker erfassen ohne Preis) */
function partPrice(p: PartUsed): string {
  if (p.unitPriceCents === null || p.unitPriceCents === undefined) return 'ohne Preis';
  return `${formatMoney(p.unitPriceCents)} je Einheit`;
}

/** Verbaute Teile einer Position; Preis nur, wenn die Antwort ihn enthält. */
function PartList({ parts, testID }: { parts: readonly PartUsed[]; testID?: string }) {
  return (
    <View style={styles.cellGap} testID={testID}>
      {parts.map((p) => (
        <Row key={p.id} wrap gap={8} style={styles.between}>
          <AppText style={styles.flex}>{partText(p)}</AppText>
          <AppText variant="small" tone="muted" numeric>
            {`${partPrice(p)}, erfasst ${formatDateTime(p.recordedAt)}`}
          </AppText>
        </Row>
      ))}
    </View>
  );
}

export default function WorkItemsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <WorkOrderFrame id={String(id)} tab="arbeiten" maxWidth={1280} testID="werkstatt-arbeiten">
      {(order) => <Works order={order} />}
    </WorkOrderFrame>
  );
}

function Works({ order }: { order: WorkOrderDetail }) {
  const t = useTheme();
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const [editing, setEditing] = useState<WorkItem | 'new' | null>(null);
  const [dismiss, setDismiss] = useState<Finding | null>(null);
  const findings = useApiQuery(`werkstatt:feststellungen:${order.id}`, (a) => a.listFindings(order.id));
  const photos = useApiQuery(`werkstatt:fotos:${order.id}`, (a) => a.listPhotos(order.id));
  const types = useApiQuery('werkstatt:wartungsarten', (a) => a.listMaintenanceTypes());
  const dismissAction = useApiMutation((a, f: Finding) => a.dismissFinding(f.id));
  const confirmed = !!order.intake?.confirmedAt;
  const closed = ['cancelled', 'picked_up', 'completed'].includes(order.status.work);
  const canWrite = can('workOrders.write') && !closed;
  const open = (findings.data ?? []).filter((f) => f.status === 'reported' || f.status === 'new');
  const done = (findings.data ?? []).filter((f) => f.status === 'converted' || f.status === 'dismissed');
  const typeName = (id: string | null) => (id ? (types.data?.find((m) => m.id === id)?.name ?? 'Wartungsart') : null);
  const withParts = order.items.filter((i) => (i.parts?.length ?? 0) > 0);

  return (
    <>
      {confirmed ? (
        <Banner
          tone="info"
          title="Annahme bestätigt"
          message="Neue Positionen und Änderungen an Umfang oder Preis vereinbarter Leistungen gehen nur über eine Freigabeanfrage. Zuweisung, Wartungsart und Intervall bleiben änderbar."
          action={can('approvals.request') && !closed ? <Button label="Freigabe anfragen" icon="PaperPlaneRight" onPress={() => router.push(routes.workshop.newApproval(order.id) as Href)} /> : undefined}
        />
      ) : null}
      <Section
        title={`Positionen (${order.items.length})`}
        action={canWrite && !confirmed ? <Button label="Position hinzufügen" icon="Plus" variant="primary" onPress={() => setEditing('new')} testID="position-hinzufuegen" /> : null}
      >
        {order.items.length === 0 ? (
          <EmptyState icon="ListChecks" title="Noch keine Positionen" message={confirmed ? 'Weitere Arbeiten als Freigabeanfrage senden.' : 'Vereinbarte Leistungen als Positionen erfassen. Sie zählen zur Annahme, bis diese bestätigt ist.'} />
        ) : (
          <DataTable
            label="Positionen"
            rows={order.items}
            rowKey={(i) => i.id}
            rowTestID={(i) => `position-${i.position}`}
            onRowPress={canWrite ? (i) => setEditing(i) : undefined}
            mobileTitle={(i) => `${i.position}. ${i.title}`}
            mobileSubtitle={(i) => `${workItemAuthorizationLabels[i.authorization].label}, ${workItemExecutionLabels[i.executionStatus].label}${i.assignedTo ? `, ${i.assignedTo.displayName}` : ''}`}
            mobileMeta={(i) => `${String(i.quantity).replace('.', ',')} ${i.unit}${i.unitPriceCents !== null && i.unitPriceCents !== undefined ? `, ${formatMoney(lineGross(i))} brutto` : ''}`}
            columns={[
              { key: 'pos', header: 'Nr.', render: (i) => <AppText numeric>{i.position}</AppText>, sortValue: (i) => i.position, width: 48, flex: 0 },
              {
                key: 'titel',
                header: 'Position',
                render: (i) => (
                  <View>
                    <AppText variant="bodyStrong" numberOfLines={2}>
                      {i.title}
                    </AppText>
                    <AppText variant="small" tone="muted" numberOfLines={2}>
                      {[KIND_LABELS[i.kind], i.origin === 'intake' ? 'aus Annahme' : i.origin === 'offer' ? 'aus Angebot' : 'Zusatzarbeit', typeName(i.maintenanceTypeId)].filter(Boolean).join(', ')}
                    </AppText>
                  </View>
                ),
                sortValue: (i) => i.title,
                flex: 2.2,
              },
              { key: 'menge', header: 'Menge', render: (i) => <AppText numeric>{`${String(i.quantity).replace('.', ',')} ${i.unit}`}</AppText>, flex: 0.8 },
              { key: 'preis', header: 'Brutto', align: 'right', render: (i) => <AppText numeric>{i.unitPriceCents !== null && i.unitPriceCents !== undefined ? formatMoney(lineGross(i)) : 'ohne Preis'}</AppText>, sortValue: (i) => lineGross(i), flex: 0.9 },
              { key: 'freigabe', header: 'Freigabe', render: (i) => <StatusChip status={workItemAuthorizationLabels[i.authorization]} />, sortValue: (i) => i.authorization, flex: 1.3 },
              {
                key: 'ausfuehrung',
                header: 'Ausführung',
                render: (i) => (
                  <View style={styles.cellGap}>
                    <StatusChip status={workItemExecutionLabels[i.executionStatus]} />
                    {i.trackedMinutes ? <AppText variant="small" tone="muted" numeric>{`${i.trackedMinutes} min`}</AppText> : null}
                    {i.executionStatus === 'in_progress' && i.runningSince ? <AppText variant="small" tone="muted" numeric>{`läuft seit ${formatTime(i.runningSince)} Uhr`}</AppText> : null}
                    {i.parts?.length ? <AppText variant="small" tone="subtle" numeric>{`${i.parts.length} ${i.parts.length === 1 ? 'Teil' : 'Teile'}`}</AppText> : null}
                    {i.doneAt ? <AppText variant="small" tone="subtle" numeric>{`${formatDateTime(i.doneAt)}${i.maintenanceTypeId ? `, ${formatKm(i.doneOdometerKm)}` : ''}`}</AppText> : null}
                  </View>
                ),
                sortValue: (i) => i.executionStatus,
                flex: 1.5,
              },
              { key: 'wer', header: 'Mechaniker', render: (i) => <AppText variant="small">{i.assignedTo?.displayName ?? 'Auftrag'}</AppText>, flex: 1 },
            ]}
          />
        )}
        {order.items.some((i) => i.resultNotes) ? (
          <View style={[styles.notes, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]}>
            <AppText variant="caption" tone="muted">Notizen der Mechaniker</AppText>
            {order.items
              .filter((i) => i.resultNotes)
              .map((i) => (
                <AppText key={i.id}>
                  <AppText variant="bodyStrong">{i.title}: </AppText>
                  {i.resultNotes}
                </AppText>
              ))}
          </View>
        ) : null}
      </Section>

      <Section title="Verbaute Teile">
        {withParts.length === 0 ? <AppText tone="muted">Noch keine Teile erfasst. Mechaniker erfassen verbaute Teile an der Position.</AppText> : null}
        {withParts.map((i) => (
          <View key={i.id} style={[styles.notes, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]} testID={`teile-position-${i.position}`}>
            <AppText variant="bodyStrong">{`${i.position}. ${i.title}`}</AppText>
            <PartList parts={i.parts ?? []} />
          </View>
        ))}
      </Section>

      <Section title={`Gemeldete Feststellungen (${open.length})`}>
        {findings.status === 'loading' ? <AppText tone="muted">Feststellungen werden geladen</AppText> : null}
        {findings.data && open.length === 0 ? <AppText tone="muted">Keine offenen Feststellungen.</AppText> : null}
        {open.map((f) => {
          const fp = (photos.data ?? []).filter((p) => f.photoIds.includes(p.id) || p.findingId === f.id);
          return (
            <View key={f.id} style={[styles.finding, { borderColor: f.severity === 'safety' ? t.colors.danger : f.severity === 'urgent' ? t.colors.warning : t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]} testID={`feststellung-${f.id}`}>
              <Row wrap gap={8}>
                <StatusChip status={findingSeverityLabels[f.severity]} />
                <StatusChip status={findingStatusLabels[f.status]} />
                <AppText variant="small" tone="subtle" numeric>
                  {f.reportedBy.displayName}, {formatDateTime(f.createdAt)}
                  {f.dictated ? ', diktiert' : ''}
                </AppText>
              </Row>
              <AppText>{f.description}</AppText>
              {fp.length > 0 ? <PhotoGrid photos={fp.map((p) => ({ id: p.id, source: api.imageSource(p.contentUrl), caption: p.caption }))} /> : null}
              {!closed ? (
                <Row wrap>
                  {can('approvals.request') ? (
                    <Button label="Freigabeanfrage erstellen" variant="primary" icon="PaperPlaneRight" onPress={() => router.push(`${routes.workshop.newApproval(order.id)}?feststellung=${f.id}` as Href)} testID="aus-feststellung-anfrage" />
                  ) : null}
                  {can('approvals.request') || can('workOrders.write') ? <Button label="Verwerfen" icon="Prohibit" onPress={() => setDismiss(f)} /> : null}
                </Row>
              ) : null}
            </View>
          );
        })}
        {done.length > 0 ? (
          <AppText variant="small" tone="subtle">
            {done.length} erledigte {done.length === 1 ? 'Feststellung' : 'Feststellungen'} (übernommen oder verworfen).
          </AppText>
        ) : null}
      </Section>

      <ItemSheet order={order} item={editing} types={types.data ?? []} confirmedIntake={confirmed} onClose={() => setEditing(null)} />
      <ConfirmDialog
        visible={dismiss !== null}
        title="Feststellung verwerfen?"
        message="Die Feststellung bleibt im Verlauf sichtbar, es wird aber keine Freigabe beim Kunden angefragt."
        confirmLabel="Verwerfen"
        tone="destructive"
        loading={dismissAction.pending}
        onCancel={() => setDismiss(null)}
        onConfirm={async () => {
          if (!dismiss) return;
          try {
            await dismissAction.mutate(dismiss);
            setDismiss(null);
            toast.show('Feststellung verworfen.');
          } catch {
            // Fehler im Dialog
          }
        }}
      >
        <ActionError error={dismissAction.error} />
      </ConfirmDialog>
    </>
  );
}

function ItemSheet({ order, item, types, confirmedIntake, onClose }: { order: WorkOrderDetail; item: WorkItem | 'new' | null; types: MaintenanceType[]; confirmedIntake: boolean; onClose: () => void }) {
  const toast = useToast();
  const { staff } = useStaffDirectory(item !== null);
  const isNew = item === 'new';
  const existing = item && item !== 'new' ? item : null;
  const [kind, setKind] = useState<WorkItemKind>('labor');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('Std.');
  const [price, setPrice] = useState('');
  const [vat, setVat] = useState('1900');
  const [typeId, setTypeId] = useState<string>('none');
  const [interval, setInterval] = useState<string>('default');
  const [assignee, setAssignee] = useState<string>('auftrag');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation(async (api, input: Record<string, unknown>) => (existing ? api.updateWorkItem(existing.id, input) : api.addWorkItem(order.id, input as never)));

  useEffect(() => {
    if (item === null) return;
    save.reset();
    setErrors({});
    const i = existing;
    setKind(i?.kind ?? 'labor');
    setTitle(i?.title ?? '');
    setDescription(i?.description ?? '');
    setQuantity(String(i?.quantity ?? 1).replace('.', ','));
    setUnit(i?.unit ?? 'Std.');
    setPrice(centsToInput(i?.unitPriceCents ?? null));
    setVat(String(i?.vatRateBp ?? 1900));
    setTypeId(i?.maintenanceTypeId ?? 'none');
    setInterval(i && (i.intervalKm || i.intervalMonths) ? `${i.intervalKm ?? ''}|${i.intervalMonths ?? ''}` : 'default');
    setAssignee(i?.assignedTo?.userId ?? 'auftrag');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  const bound = !!existing?.approvalRequestId;
  const finished = existing?.executionStatus === 'done' || existing?.executionStatus === 'not_done';
  const scopeLocked = bound || finished || (confirmedIntake && (!existing || existing.origin === 'intake'));
  const type = types.find((m) => m.id === typeId);
  const intervalOptions = type ? [{ value: 'default', label: `Standard (${[type.defaultIntervalKm ? `${type.defaultIntervalKm} km` : null, type.defaultIntervalMonths ? `${type.defaultIntervalMonths} Monate` : null].filter(Boolean).join(', ') || 'ohne'})` }, ...type.intervalOptions.map((o) => ({ value: `${o.km ?? ''}|${o.months ?? ''}`, label: o.label }))] : [];

  async function submit() {
    const e: Record<string, string> = {};
    const q = parseQuantity(quantity);
    const cents = parseEuro(price);
    if (!scopeLocked) {
      if (!title.trim()) e.title = 'Bitte einen Titel angeben.';
      if (!(q > 0)) e.quantity = 'Menge größer als 0.';
      if (cents !== null && Number.isNaN(cents)) e.price = 'Betrag in Euro, zum Beispiel 78,00.';
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const [ikm, imonths] = interval === 'default' ? ['', ''] : interval.split('|');
    const base: Record<string, unknown> = {
      maintenanceTypeId: typeId === 'none' ? null : typeId,
      intervalKm: typeId === 'none' || !ikm ? null : Number(ikm),
      intervalMonths: typeId === 'none' || !imonths ? null : Number(imonths),
      assignedTo: assignee === 'auftrag' ? null : assignee,
    };
    const scope = scopeLocked ? {} : { kind, title: title.trim(), description: description.trim() || null, quantity: q, unit: unit.trim() || 'Stk', unitPriceCents: cents, vatRateBp: Number(vat) };
    try {
      await save.mutate({ ...scope, ...base });
      toast.show(isNew ? 'Position hinzugefügt.' : 'Position gespeichert.');
      onClose();
    } catch {
      // Fehler unten, bei approval_required mit Weg zur Freigabeanfrage
    }
  }

  useSaveShortcut(() => void submit(), item !== null, 'dialog');
  const needsApproval = (save.error as ApiError | null)?.code === ERROR_CODES.approvalRequired;

  return (
    <Sheet
      visible={item !== null}
      onClose={onClose}
      title={isNew ? 'Position hinzufügen' : `Position ${existing?.position}: ${existing?.title ?? ''}`}
      width={640}
      testID="position-blatt"
      footer={
        <>
          <Button label="Abbrechen" onPress={onClose} />
          <Button label="Speichern" variant="primary" loading={save.pending} onPress={() => void submit()} testID="position-speichern" />
        </>
      }
    >
      {bound ? <Banner tone="info" message="Diese Position gehört zu einer Freigabeanfrage. Umfang und Preis ändern Sie dort; das erzeugt eine neue Version." /> : null}
      {finished ? <Banner tone="info" message="Die Position ist abgeschlossen. Umfang und Preis sind nicht mehr änderbar." /> : null}
      {confirmedIntake && !bound && !finished ? (
        <Banner tone="warning" message="Die Annahme ist bestätigt: Umfang und Preis vereinbarter Leistungen ändern sich nur über eine Freigabeanfrage. Zuweisung, Wartungsart und Intervall bleiben änderbar." />
      ) : null}
      {!scopeLocked ? (
        <>
          <Select label="Art" value={kind} onChange={setKind} options={(Object.keys(KIND_LABELS) as WorkItemKind[]).map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
          <TextField label="Titel" value={title} onChangeText={setTitle} required error={errors.title} testID="position-titel" />
          <TextField label="Beschreibung" value={description} onChangeText={setDescription} multiline />
          <Row wrap gap={12} style={styles.alignStart}>
            <View style={styles.small}>
              <TextField label="Menge" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" error={errors.quantity} />
            </View>
            <View style={styles.small}>
              <TextField label="Einheit" value={unit} onChangeText={setUnit} />
            </View>
            <View style={styles.small}>
              <TextField label="Einzelpreis netto (€)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" error={errors.price} testID="position-preis" />
            </View>
            <View style={styles.small}>
              <Select label="USt" value={vat} onChange={setVat} options={[{ value: '1900', label: '19 %' }, { value: '700', label: '7 %' }, { value: '0', label: '0 %' }]} />
            </View>
          </Row>
        </>
      ) : existing ? (
        <AppText tone="muted" numeric>
          {`${String(existing.quantity).replace('.', ',')} ${existing.unit}${existing.unitPriceCents !== null && existing.unitPriceCents !== undefined ? `, ${formatMoney(existing.unitPriceCents)} netto je Einheit` : ''}`}
        </AppText>
      ) : null}
      <Select
        label="Wartungsart (für die Servicehistorie)"
        value={typeId}
        onChange={(v) => {
          setTypeId(v);
          setInterval('default');
        }}
        options={[{ value: 'none', label: 'Keine Wartung' }, ...types.filter((m) => m.active).map((m) => ({ value: m.id, label: m.name }))]}
        help="Nur Wartungspositionen erzeugen nach dem fachlichen Abschluss einen Serviceeintrag."
      />
      {type ? <Select label="Intervall" value={interval} onChange={setInterval} options={intervalOptions} /> : null}
      <Select label="Mechaniker für diese Position" value={assignee} onChange={setAssignee} options={[{ value: 'auftrag', label: 'Wie Auftrag (alle Zugewiesenen)' }, ...staff.map((s) => ({ value: s.id, label: s.displayName }))]} />
      {existing ? (
        <View style={styles.cellGap}>
          <AppText variant="caption" tone="muted">{`Verbaute Teile (${existing.parts?.length ?? 0})`}</AppText>
          {existing.parts?.length ? <PartList parts={existing.parts} /> : <AppText variant="small" tone="subtle">Noch keine Teile erfasst. Mechaniker erfassen verbaute Teile an der Position.</AppText>}
        </View>
      ) : null}
      {needsApproval ? (
        <Banner
          tone="warning"
          title="Nur über Freigabe möglich"
          message={save.error?.message}
          action={<Button label="Freigabe anfragen" icon="PaperPlaneRight" onPress={() => { onClose(); router.push(routes.workshop.newApproval(order.id) as Href); }} />}
        />
      ) : (
        <ActionError error={save.error} />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  cellGap: { gap: 4 },
  notes: { borderWidth: 1, padding: 12, gap: 6 },
  finding: { borderWidth: 1, borderLeftWidth: 4, padding: 16, gap: 10 },
  alignStart: { alignItems: 'flex-start' },
  between: { justifyContent: 'space-between' },
  flex: { flex: 1, minWidth: 160 },
  small: { flexGrow: 1, flexBasis: 120, minWidth: 110 },
});
