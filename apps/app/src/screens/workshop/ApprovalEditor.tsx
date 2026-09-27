/**
 * Freigabeanfrage bearbeiten: Art, Titel, Beschreibung für den Kunden, Positionen mit Preisen
 * (Summen aus @werkstatt/domain), Fotos, Terminänderung. Darunter die Vorschau, wie der Kunde
 * die Anfrage sieht. Genutzt für neue Anfragen und neue Fassungen.
 */
import type { ApprovalDraftInput, ApprovalKind, ApprovalLine, MaintenanceType, Photo } from '@werkstatt/contracts';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApi } from '../../data/ApiProvider';
import { formatMoney } from '../../lib/format';
import { useBreakpoint, useTheme } from '../../theme';
import { AppText, Button, Checkbox, DateTimeField, IconButton, PhotoView, Row, Section, Select, SegmentedControl, TextField } from '../../ui';
import { ApprovalCustomerPreview, ApprovalLinesTable, approvalTotals } from '../approvals/ApprovalContent';
import { centsToInput, parseEuro, parseQuantity } from './shared';

export interface EditorLine {
  key: string;
  title: string;
  description: string;
  quantity: string;
  unit: string;
  price: string;
  vat: string;
  maintenanceTypeId: string;
}

export interface EditorState {
  kind: ApprovalKind;
  title: string;
  summaryCustomer: string;
  lines: EditorLine[];
  photoIds: string[];
  scheduleChange: string;
  newReadyAt: Date | null;
  findingId: string | null;
}

let lineCounter = 0;
export function emptyLine(partial: Partial<EditorLine> = {}): EditorLine {
  lineCounter += 1;
  return { key: `l${lineCounter}`, title: '', description: '', quantity: '1', unit: 'Std.', price: '', vat: '1900', maintenanceTypeId: 'none', ...partial };
}

export function editorFromDraft(d: Partial<ApprovalDraftInput> & { kind: ApprovalKind }): EditorState {
  return {
    kind: d.kind,
    title: d.title ?? '',
    summaryCustomer: d.summaryCustomer ?? '',
    lines: (d.lines ?? []).length > 0 ? d.lines!.map((l) => emptyLine({ title: l.title, description: l.description ?? '', quantity: String(l.quantity).replace('.', ','), unit: l.unit, price: centsToInput(l.unitPriceCents), vat: String(l.vatRateBp), maintenanceTypeId: l.maintenanceTypeId ?? 'none' })) : [emptyLine()],
    photoIds: d.photoIds ?? [],
    scheduleChange: d.scheduleChange ?? '',
    newReadyAt: d.newReadyAt ? new Date(d.newReadyAt) : null,
    findingId: d.findingId ?? null,
  };
}

/** Prüft die Eingaben; liefert den API-Entwurf oder Fehler je Feld. */
export function toDraft(s: EditorState): { draft: ApprovalDraftInput | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!s.title.trim()) errors.title = 'Bitte einen Titel angeben.';
  if (!s.summaryCustomer.trim()) errors.summary = 'Bitte in einfachen Worten beschreiben, was gemacht werden soll und warum.';
  const lines: ApprovalLine[] = [];
  s.lines.forEach((l, i) => {
    const q = parseQuantity(l.quantity);
    const cents = parseEuro(l.price);
    if (!l.title.trim()) errors[`line${i}`] = 'Titel fehlt.';
    else if (!(q > 0)) errors[`line${i}`] = 'Menge größer als 0.';
    else if (cents === null || Number.isNaN(cents) || cents < 0) errors[`line${i}`] = 'Einzelpreis netto in Euro angeben.';
    else lines.push({ title: l.title.trim(), description: l.description.trim() || null, quantity: q, unit: l.unit.trim() || 'Stk', unitPriceCents: cents, vatRateBp: Number(l.vat), maintenanceTypeId: l.maintenanceTypeId === 'none' ? null : l.maintenanceTypeId });
  });
  if (s.lines.length === 0) errors.lines = 'Mindestens eine Position.';
  if (Object.keys(errors).length > 0) return { draft: null, errors };
  return {
    errors,
    draft: {
      kind: s.kind,
      title: s.title.trim(),
      summaryCustomer: s.summaryCustomer.trim(),
      lines,
      scheduleChange: s.scheduleChange.trim() || null,
      newReadyAt: s.newReadyAt ? s.newReadyAt.toISOString() : null,
      photoIds: s.photoIds,
      findingId: s.findingId,
    },
  };
}

/** Vorschau-Inhalt auch bei unvollständigen Zeilen (nur gültige Zeilen). */
function previewLines(s: EditorState): ApprovalLine[] {
  return s.lines
    .map((l) => ({ l, q: parseQuantity(l.quantity), c: parseEuro(l.price) }))
    .filter(({ l, q, c }) => l.title.trim() && q > 0 && c !== null && !Number.isNaN(c))
    .map(({ l, q, c }) => ({ title: l.title.trim(), description: l.description.trim() || null, quantity: q, unit: l.unit || 'Stk', unitPriceCents: c as number, vatRateBp: Number(l.vat), maintenanceTypeId: null }));
}

export function ApprovalEditor({
  state,
  onChange,
  errors,
  photos,
  maintenanceTypes,
  versionNo,
}: {
  state: EditorState;
  onChange: (s: EditorState) => void;
  errors: Record<string, string>;
  photos: Photo[];
  maintenanceTypes: MaintenanceType[];
  versionNo: number;
}) {
  const t = useTheme();
  const api = useApi();
  const { device } = useBreakpoint();
  const [view, setView] = useState<'bearbeiten' | 'vorschau'>('bearbeiten');
  const set = (patch: Partial<EditorState>) => onChange({ ...state, ...patch });
  const setLine = (key: string, patch: Partial<EditorLine>) => set({ lines: state.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const lines = previewLines(state);
  const totals = approvalTotals(lines);
  const selectedPhotos = photos.filter((p) => state.photoIds.includes(p.id));

  return (
    <View style={styles.stack}>
      <SegmentedControl
        label="Ansicht"
        value={view}
        onChange={setView}
        options={[
          { value: 'bearbeiten', label: 'Bearbeiten', icon: 'PencilSimple' },
          { value: 'vorschau', label: 'Vorschau wie beim Kunden', icon: 'Eye' },
        ]}
      />
      {view === 'vorschau' ? (
        <ApprovalCustomerPreview
          content={{ kind: state.kind, title: state.title, summaryCustomer: state.summaryCustomer, lines, scheduleChange: state.scheduleChange || null, newReadyAt: state.newReadyAt?.toISOString() ?? null }}
          photos={selectedPhotos.map((p) => ({ id: p.id, source: api.imageSource(p.contentUrl), caption: p.caption }))}
          versionNo={versionNo}
        />
      ) : (
        <>
          <Section title="Anfrage">
            <Select label="Art" value={state.kind} onChange={(kind) => set({ kind })} options={[{ value: 'additional_work', label: 'Zusatzarbeit (während der Reparatur)' }, { value: 'offer', label: 'Angebot (vor Beginn)' }]} />
            <TextField label="Titel" value={state.title} onChangeText={(title) => set({ title })} required error={errors.title} testID="anfrage-titel" />
            <TextField
              label="Beschreibung für den Kunden"
              value={state.summaryCustomer}
              onChangeText={(summaryCustomer) => set({ summaryCustomer })}
              multiline
              required
              error={errors.summary}
              help="Kurz, konkret, ohne Fachjargon: was, warum, was passiert ohne die Arbeit."
              testID="anfrage-beschreibung"
            />
          </Section>
          <Section title="Positionen und Preise" action={<Button label="Position hinzufügen" variant="quiet" icon="Plus" onPress={() => set({ lines: [...state.lines, emptyLine()] })} testID="anfrage-position-hinzufuegen" />}>
            {errors.lines ? <AppText tone="danger">{errors.lines}</AppText> : null}
            {state.lines.map((l, i) => (
              <View key={l.key} style={[styles.line, { borderColor: errors[`line${i}`] ? t.colors.danger : t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]} testID={`anfrage-zeile-${i}`}>
                <Row style={styles.between}>
                  <AppText variant="bodyStrong">Position {i + 1}</AppText>
                  {state.lines.length > 1 ? <IconButton icon="Trash" tone="danger" accessibilityLabel={`Position ${i + 1} entfernen`} onPress={() => set({ lines: state.lines.filter((x) => x.key !== l.key) })} /> : null}
                </Row>
                <TextField label="Titel" value={l.title} onChangeText={(v) => setLine(l.key, { title: v })} testID={`zeile-${i}-titel`} />
                <TextField label="Beschreibung (freiwillig)" value={l.description} onChangeText={(v) => setLine(l.key, { description: v })} />
                <Row wrap gap={12} style={styles.alignStart}>
                  <View style={styles.small}>
                    <TextField label="Menge" value={l.quantity} onChangeText={(v) => setLine(l.key, { quantity: v })} keyboardType="decimal-pad" testID={`zeile-${i}-menge`} />
                  </View>
                  <View style={styles.small}>
                    <TextField label="Einheit" value={l.unit} onChangeText={(v) => setLine(l.key, { unit: v })} />
                  </View>
                  <View style={styles.small}>
                    <TextField label="Einzelpreis netto (€)" value={l.price} onChangeText={(v) => setLine(l.key, { price: v })} keyboardType="decimal-pad" testID={`zeile-${i}-preis`} />
                  </View>
                  <View style={styles.small}>
                    <Select label="USt" value={l.vat} onChange={(v) => setLine(l.key, { vat: v })} options={[{ value: '1900', label: '19 %' }, { value: '700', label: '7 %' }, { value: '0', label: '0 %' }]} />
                  </View>
                </Row>
                <Select label="Wartungsart (für die Servicehistorie)" value={l.maintenanceTypeId} onChange={(v) => setLine(l.key, { maintenanceTypeId: v })} options={[{ value: 'none', label: 'Keine Wartung' }, ...maintenanceTypes.filter((m) => m.active).map((m) => ({ value: m.id, label: m.name }))]} />
                {errors[`line${i}`] ? <AppText variant="small" tone="danger">{errors[`line${i}`]}</AppText> : null}
              </View>
            ))}
            {lines.length > 0 ? <ApprovalLinesTable lines={lines} testID="anfrage-summen" /> : null}
            {totals ? (
              <AppText variant="small" tone="subtle" numeric>
                Der Kunde gibt genau diesen Betrag frei: {formatMoney(totals.totalGrossCents)} brutto. Jede spätere Änderung erzeugt eine neue Version.
              </AppText>
            ) : null}
          </Section>
          <Section title="Fotos für den Kunden">
            {photos.length === 0 ? (
              <AppText tone="muted">Zu diesem Auftrag gibt es noch keine Fotos.</AppText>
            ) : (
              <View style={styles.photos}>
                {photos.map((p) => {
                  const selected = state.photoIds.includes(p.id);
                  return (
                    <View key={p.id} style={[styles.photo, { borderColor: selected ? t.colors.accent : t.colors.border, borderWidth: selected ? 2 : 1, borderRadius: t.radius.panel, flexBasis: device === 'phone' ? '46%' : '30%' }]}>
                      <PhotoView source={api.imageSource(p.contentUrl)} caption={p.caption} height={110} />
                      <Checkbox label={p.caption ?? 'Foto'} checked={selected} onChange={() => set({ photoIds: selected ? state.photoIds.filter((x) => x !== p.id) : [...state.photoIds, p.id] })} testID={`anfrage-foto-${p.id}`} />
                    </View>
                  );
                })}
              </View>
            )}
            <AppText variant="small" tone="subtle">Ausgewählte Fotos werden beim Senden für den Kunden sichtbar.</AppText>
          </Section>
          <Section title="Terminänderung (freiwillig)">
            <TextField label="Hinweis zum Termin" value={state.scheduleChange} onChangeText={(scheduleChange) => set({ scheduleChange })} multiline help="Zum Beispiel: Teil kommt morgen, Fahrzeug einen Tag später fertig." />
            <DateTimeField label="Voraussichtlich fertig" value={state.newReadyAt} onChange={(newReadyAt) => set({ newReadyAt })} />
          </Section>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 24 },
  between: { justifyContent: 'space-between' },
  alignStart: { alignItems: 'flex-start' },
  line: { borderWidth: 1, padding: 12, gap: 10 },
  small: { flexGrow: 1, flexBasis: 120, minWidth: 110 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  photo: { padding: 8, gap: 4, flexGrow: 1 },
});
