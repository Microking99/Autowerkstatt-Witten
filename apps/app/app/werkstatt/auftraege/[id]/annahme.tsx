/**
 * Werkstatt, digitale Fahrzeugannahme: Beanstandung, km-Stand, Tank, Vorschäden mit Fotos,
 * vereinbarte Leistungen, Kostenrahmen, interne und kundensichtbare Hinweise (deutlich
 * getrennt). Bestätigung vor Ort oder durch den Kunden in der App, gebunden an den
 * Inhalts-Hash. Die Bestätigung deckt nur die aufgeführten Leistungen (R-ANN-3).
 */
import type { Intake, WorkOrderDetail } from '@werkstatt/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApi } from '../../../../src/data/ApiProvider';
import { useApiMutation, useApiQuery } from '../../../../src/data/hooks';
import { useIsOffline } from '../../../../src/data/network';
import { formatDateTime, formatKm, formatMoney } from '../../../../src/lib/format';
import { newClientId, pickImage } from '../../../../src/lib/pickImage';
import { orderTabHref, WorkOrderFrame } from '../../../../src/screens/workshop/WorkOrderFrame';
import { ActionError, centsToInput, parseEuro, parseInteger, useCan } from '../../../../src/screens/workshop/shared';
import { useTheme } from '../../../../src/theme';
import {
  LoadingState,
  AppText,
  Banner,
  Button,
  Checkbox,
  Columns,
  ConfirmDialog,
  IconButton,
  PhotoView,
  Row,
  Section,
  Select,
  StatusChip,
  TextField,
  useSaveShortcut,
  useToast,
} from '../../../../src/ui';

interface Damage {
  key: string;
  area: string;
  description: string;
  photoId: string | null;
}

const FUEL = ['leer', '1/4', '1/2', '3/4', 'voll'] as const;

export default function IntakeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <WorkOrderFrame id={String(id)} tab="annahme" maxWidth={1040} testID="werkstatt-annahme">
      {(order) => <IntakeForm order={order} />}
    </WorkOrderFrame>
  );
}

function IntakeForm({ order }: { order: WorkOrderDetail }) {
  const t = useTheme();
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const offline = useIsOffline();
  const intakeQuery = useApiQuery(`werkstatt:annahme:${order.id}`, async (a) => {
    try {
      return await a.getIntake(order.id);
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  });
  const photos = useApiQuery(`werkstatt:annahme:fotos:${order.id}`, (a) => a.listPhotos(order.id));
  const intake = intakeQuery.data ?? null;
  const editable = can('intake.write') && !['cancelled', 'picked_up', 'completed'].includes(order.status.work);

  const [km, setKm] = useState('');
  const [kmUnknown, setKmUnknown] = useState(false);
  const [fuel, setFuel] = useState<string | null>(null);
  const [complaint, setComplaint] = useState('');
  const [damages, setDamages] = useState<Damage[]>([]);
  const [agreed, setAgreed] = useState('');
  const [limit, setLimit] = useState('');
  const [internal, setInternal] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Inhalts-Hash der zuletzt gespeicherten Fassung: bestätigt wird genau diese, nicht ein älterer Stand
  const [savedHash, setSavedHash] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  // Formular mit dem gespeicherten Stand füllen (auch nach dem Speichern)
  useEffect(() => {
    if (intakeQuery.status !== 'success' || dirty) return;
    const i = intake;
    setKm(i?.odometerKm !== null && i?.odometerKm !== undefined ? String(i.odometerKm) : '');
    // Ohne km-Stand gilt er erst nach einer Bestätigung als "unbekannt"; vorher ist er nur noch nicht erfasst
    setKmUnknown(!!i && i.odometerKm === null && !!i.confirmedAt);
    setFuel(i?.fuelLevel ?? null);
    setComplaint(i?.customerComplaint ?? '');
    setDamages((i?.damages ?? []).map((d, n) => ({ key: `d${n}`, ...d })));
    setAgreed(i?.agreedServices ?? '');
    setLimit(centsToInput(i?.costLimitCents ?? order.costLimitCents ?? null));
    setInternal(i?.notesInternal ?? '');
    setCustomerNote(i?.notesCustomer ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intakeQuery.status, intake?.contentHash, intake?.confirmedAt]);

  const save = useApiMutation((a, input: Parameters<typeof api.saveIntake>[1]) => a.saveIntake(order.id, input));
  const confirm = useApiMutation((a, current: Intake) => a.confirmIntake(order.id, { method: 'on_site_signature', contentHash: current.contentHash ?? '' }));
  const agreedItems = order.items.filter((i) => i.origin === 'intake');
  const photoById = useMemo(() => new Map((photos.data ?? []).map((p) => [p.id, p])), [photos.data]);

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  function validate() {
    const e: Record<string, string> = {};
    const kmValue = parseInteger(km);
    if (!kmUnknown && (kmValue === null || Number.isNaN(kmValue))) e.km = 'km-Stand eintragen oder "km-Stand unbekannt" wählen.';
    if (!complaint.trim()) e.complaint = 'Bitte die Beanstandung bzw. den Auftrag des Kunden eintragen.';
    const cents = parseEuro(limit);
    if (cents !== null && (Number.isNaN(cents) || cents <= 0)) e.limit = 'Betrag in Euro, zum Beispiel 450,00.';
    damages.forEach((d, n) => {
      if (!d.area.trim() || !d.description.trim()) e[`damage${n}`] = 'Bereich und Beschreibung angeben oder den Schaden entfernen.';
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSave() {
    if (!editable || !validate()) return;
    const kmValue = parseInteger(km);
    try {
      const saved = await save.mutate({
        odometerKm: kmUnknown ? null : (kmValue as number),
        fuelLevel: fuel,
        customerComplaint: complaint.trim(),
        damages: damages.map((d) => ({ area: d.area.trim(), description: d.description.trim(), photoId: d.photoId })),
        agreedServices: agreed.trim(),
        costLimitCents: parseEuro(limit) ?? null,
        notesInternal: internal.trim() || null,
        notesCustomer: customerNote.trim() || null,
      });
      setSavedHash(saved.contentHash ?? null);
      setDirty(false);
      toast.show(intake?.confirmedAt ? 'Annahme gespeichert. Die bisherige Bestätigung gilt nur, wenn sich der Inhalt nicht geändert hat.' : 'Annahme gespeichert.');
    } catch {
      // Fehler steht oben
    }
  }

  useSaveShortcut(() => void onSave(), editable);

  async function addDamagePhoto(key: string) {
    const picked = await pickImage('camera');
    if (picked.type === 'denied' || picked.type === 'failed') {
      toast.show(picked.message, 'danger');
      return;
    }
    if (picked.type !== 'picked') return;
    setUploading(key);
    try {
      const file = await api.uploadFile(picked.image, { idempotencyKey: newClientId() });
      const photo = await api.attachPhoto(order.id, { id: newClientId(), fileId: file.id, context: 'intake', caption: 'Vorschaden bei Annahme' });
      setDamages((list) => list.map((d) => (d.key === key ? { ...d, photoId: photo.id } : d)));
      setDirty(true);
      void photos.refetch();
    } catch {
      toast.show('Das Foto konnte nicht hochgeladen werden.', 'danger');
    } finally {
      setUploading(null);
    }
  }

  const confirmed = !!intake?.confirmedAt;
  // Nach dem Speichern erst bestätigen, wenn die gespeicherte Fassung geladen ist
  const syncing = savedHash !== null && intake?.contentHash !== savedHash;
  // Erst nach dem Laden bearbeitbar, sonst überschreibt der geladene Stand die Eingaben nicht
  if (intakeQuery.status === 'loading') return <LoadingState variant="detail" label="Annahme wird geladen" />;
  return (
    <>
      <ActionError error={save.error} />
      {confirmed ? (
        <Banner
          tone="success"
          title={`Bestätigt am ${formatDateTime(intake!.confirmedAt)}${intake!.confirmationMethod === 'app' ? ' durch den Kunden in der App' : ' vor Ort'}`}
          message="Die Bestätigung gilt für genau diesen Inhalt. Eine Änderung hebt sie auf. Weitere Arbeiten und Änderungen an Umfang oder Preis vereinbarter Leistungen laufen über eine Freigabeanfrage."
          testID="annahme-bestaetigt"
        />
      ) : intake ? (
        <Banner tone="warning" title="Noch nicht bestätigt" message="Der Kunde bestätigt vor Ort oder in der App. Die Bestätigung deckt nur die unten aufgeführten Leistungen." />
      ) : (
        <Banner tone="info" title="Noch keine Annahme" message="Beanstandung, km-Stand und Vorschäden erfassen, dann speichern und bestätigen lassen." />
      )}
      {intakeQuery.status === 'error' ? <ActionError error={intakeQuery.error} title="Annahme nicht geladen" /> : null}
      <Columns ratio={[1.3, 1]}>
        <View style={styles.stack}>
          <Section title="Fahrzeug und Beanstandung">
            <Row wrap gap={12} style={styles.alignStart}>
              <View style={styles.field}>
                <TextField label="km-Stand" value={km} onChangeText={touch(setKm)} keyboardType="number-pad" editable={editable && !kmUnknown} error={errors.km} required={!kmUnknown} testID="annahme-km" />
              </View>
              <View style={styles.field}>
                <Select label="Tankfüllung" value={fuel} onChange={touch(setFuel)} options={FUEL.map((f) => ({ value: f, label: f }))} placeholder="nicht erfasst" />
              </View>
            </Row>
            <Checkbox label="km-Stand unbekannt (Tacho defekt oder nicht ablesbar)" checked={kmUnknown} onChange={touch(setKmUnknown)} />
            <TextField label="Beanstandung, Auftrag des Kunden" value={complaint} onChangeText={touch(setComplaint)} multiline required editable={editable} error={errors.complaint} testID="annahme-beanstandung" />
          </Section>
          <Section title="Vorschäden" action={editable ? <Button label="Schaden hinzufügen" variant="quiet" icon="Plus" onPress={() => { setDamages((l) => [...l, { key: newClientId(), area: '', description: '', photoId: null }]); setDirty(true); }} testID="schaden-hinzufuegen" /> : null}>
            {damages.length === 0 ? <AppText tone="muted">Keine Vorschäden erfasst.</AppText> : null}
            {damages.map((d, n) => {
              const photo = d.photoId ? photoById.get(d.photoId) : undefined;
              return (
                <View key={d.key} style={[styles.damage, { borderColor: errors[`damage${n}`] ? t.colors.danger : t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]}>
                  <Row style={styles.between}>
                    <AppText variant="bodyStrong">Schaden {n + 1}</AppText>
                    {editable ? <IconButton icon="Trash" accessibilityLabel={`Schaden ${n + 1} entfernen`} tone="danger" onPress={() => { setDamages((l) => l.filter((x) => x.key !== d.key)); setDirty(true); }} /> : null}
                  </Row>
                  <TextField label="Bereich" value={d.area} onChangeText={(v) => { setDamages((l) => l.map((x) => (x.key === d.key ? { ...x, area: v } : x))); setDirty(true); }} editable={editable} placeholder="z. B. Stoßfänger hinten links" />
                  <TextField label="Beschreibung" value={d.description} onChangeText={(v) => { setDamages((l) => l.map((x) => (x.key === d.key ? { ...x, description: v } : x))); setDirty(true); }} editable={editable} />
                  {photo ? <PhotoView source={api.imageSource(photo.contentUrl)} caption={photo.caption} height={140} /> : null}
                  {editable ? <Button label={photo ? 'Foto ersetzen' : 'Foto aufnehmen'} icon="Camera" loading={uploading === d.key} onPress={() => void addDamagePhoto(d.key)} /> : null}
                  {errors[`damage${n}`] ? <AppText variant="small" tone="danger">{errors[`damage${n}`]}</AppText> : null}
                </View>
              );
            })}
          </Section>
          <Section title="Vereinbarte Leistungen">
            <TextField label="Vereinbarte Leistungen (Freitext für den Kunden)" value={agreed} onChangeText={touch(setAgreed)} multiline editable={editable} testID="annahme-leistungen" />
            {agreedItems.length > 0 ? (
              <View style={[styles.items, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]}>
                {agreedItems.map((i) => (
                  <Row key={i.id} style={styles.between}>
                    <AppText style={styles.flex}>{i.title}</AppText>
                    <AppText variant="small" tone="muted" numeric>
                      {String(i.quantity).replace('.', ',')} {i.unit}
                      {i.unitPriceCents !== undefined && i.unitPriceCents !== null ? `, ${formatMoney(i.unitPriceCents)} netto` : ''}
                    </AppText>
                  </Row>
                ))}
              </View>
            ) : (
              <AppText variant="small" tone="subtle">Positionen erfassen Sie im Register Arbeiten; vor der ersten Bestätigung zählen sie zur Annahme.</AppText>
            )}
            <Banner tone="info" message="Die Bestätigung deckt nur diese Leistungen. Alles Weitere braucht eine eigene Freigabe des Kunden." />
            <TextField label="Kostenrahmen in Euro" value={limit} onChangeText={touch(setLimit)} keyboardType="decimal-pad" editable={editable} error={errors.limit} help="Ab diesem Betrag wird der Kunde vorher gefragt." />
          </Section>
        </View>
        <View style={styles.stack}>
          <Section title="Hinweise">
            <View style={[styles.note, { borderColor: t.colors.info, backgroundColor: t.colors.infoSoft, borderRadius: t.radius.panel }]}>
              <StatusChip status={{ label: 'Für den Kunden sichtbar', tone: 'info', icon: 'Eye' }} />
              <TextField label="Hinweise für den Kunden" value={customerNote} onChangeText={touch(setCustomerNote)} multiline editable={editable} />
            </View>
            <View style={[styles.note, { borderColor: t.colors.borderStrong, backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.panel, borderStyle: 'dashed' }]}>
              <StatusChip status={{ label: 'Intern, nie für Kunden', tone: 'neutral', icon: 'Lock' }} />
              <TextField label="Interne Hinweise (Schlüssel, Rückruf, Besonderheiten)" value={internal} onChangeText={touch(setInternal)} multiline editable={editable} testID="annahme-intern" />
            </View>
          </Section>
          <Section title="Speichern und bestätigen">
            <View style={[styles.panel, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]}>
              {editable ? (
                <Button label={dirty ? 'Annahme speichern (Strg+Enter)' : 'Gespeichert'} variant={dirty ? 'primary' : 'secondary'} icon="Check" loading={save.pending} disabled={!dirty} onPress={() => void onSave()} fullWidth testID="annahme-speichern" />
              ) : (
                <AppText tone="muted">Nur lesen: Ihnen fehlt das Recht zur Annahme oder der Auftrag ist abgeschlossen.</AppText>
              )}
              {intake && !confirmed && editable ? (
                <>
                  <Button label="Vor Ort bestätigen lassen" icon="Signature" onPress={() => setConfirmOpen(true)} disabled={dirty || offline || syncing} loading={syncing} fullWidth testID="annahme-vor-ort" />
                  <AppText variant="small" tone="subtle">
                    {dirty ? 'Erst speichern, dann bestätigen lassen.' : offline ? 'Bestätigung erst wieder mit Verbindung.' : 'Oder der Kunde bestätigt in der App unter Auftrag, Annahme.'}
                  </AppText>
                </>
              ) : null}
              {intake ? <AppText variant="small" tone="subtle" numeric>km-Stand: {formatKm(intake.odometerKm)}{intake.contentHash ? `, Prüfsumme ${intake.contentHash.slice(0, 8)}` : ''}</AppText> : null}
            </View>
            <Button label="Zu den Arbeiten" variant="quiet" iconRight="CaretRight" onPress={() => router.push(orderTabHref(order.id, 'arbeiten'))} />
          </Section>
        </View>
      </Columns>
      <ConfirmDialog
        visible={confirmOpen}
        title="Annahme vor Ort bestätigen?"
        message="Der Kunde hat die Annahme auf dem Gerät gelesen und bestätigt: Beanstandung, km-Stand, Vorschäden und die aufgeführten Leistungen. Die Bestätigung deckt nur diese Leistungen; weitere Arbeiten brauchen eine eigene Freigabe."
        confirmLabel="Bestätigung speichern"
        icon="Signature"
        loading={confirm.pending}
        onCancel={() => setConfirmOpen(false)}
        testID="annahme-bestaetigen-dialog"
        onConfirm={async () => {
          if (!intake) return;
          try {
            await confirm.mutate(intake);
            setConfirmOpen(false);
            toast.show('Annahme bestätigt.');
          } catch {
            // Fehler im Dialog
          }
        }}
      >
        <ActionError error={confirm.error} title="Nicht bestätigt" />
      </ConfirmDialog>
    </>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 24 },
  field: { flexGrow: 1, flexBasis: 180, minWidth: 160 },
  alignStart: { alignItems: 'flex-start' },
  between: { justifyContent: 'space-between' },
  flex: { flex: 1, minWidth: 0 },
  damage: { borderWidth: 1, padding: 12, gap: 10 },
  items: { borderWidth: 1, padding: 12, gap: 8 },
  note: { borderWidth: 1, padding: 12, gap: 8 },
  panel: { borderWidth: 1, padding: 16, gap: 12 },
});
