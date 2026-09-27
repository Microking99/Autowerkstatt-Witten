/**
 * Werkstatt, Auftrag anlegen in Schritten: Kunde (suchen oder neu im Seitendialog) →
 * Fahrzeug (des Kunden oder neu) → Leistungen → Prüfen. Der Entwurf wird laufend lokal
 * gespeichert (R-AUF-3) und nach einem Neuladen oder Abbruch wiederhergestellt. "Anlegen"
 * erzeugt den Auftrag (Status Offen), "Als Entwurf anlegen" einen für Kunden unsichtbaren
 * Entwurf auf dem Server (POST /work-orders?draft=true).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { routes, type CustomerDetail, type CustomerSummary, type MaintenanceType, type VehicleDetail, type VehicleSummary } from '@werkstatt/contracts';
import { calculateTotals } from '@werkstatt/domain';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../../../src/auth/session';
import { useApiMutation, useApiQuery } from '../../../src/data/hooks';
import { formatDateTime, formatKm, formatMoney, keepPlates } from '../../../src/lib/format';
import { CustomerForm } from '../../../src/screens/workshop/CustomerForm';
import { ActionError, customerAccessLabels, parseEuro, parseQuantity } from '../../../src/screens/workshop/shared';
import { useStaffDirectory } from '../../../src/screens/workshop/staff';
import { VehicleForm } from '../../../src/screens/workshop/VehicleForm';
import { useBreakpoint, useTheme } from '../../../src/theme';
import {
  AppText,
  Banner,
  Button,
  Checkbox,
  DateTimeField,
  EmptyState,
  IconButton,
  KeyValueList,
  ListGroup,
  ListRow,
  Page,
  PageHeader,
  Row,
  SearchField,
  Section,
  Select,
  Sheet,
  StatusChip,
  TextField,
  useSaveShortcut,
  useToast,
} from '../../../src/ui';

type Step = 1 | 2 | 3 | 4;

interface DraftItem {
  key: string;
  title: string;
  quantity: string;
  unit: string;
  price: string;
  vat: string;
  maintenanceTypeId: string;
}

interface WizardDraft {
  v: 1;
  savedAt: string;
  step: Step;
  customer: { id: string; displayName: string } | null;
  vehicle: { id: string; label: string; plate: string } | null;
  title: string;
  descriptionCustomer: string;
  notesInternal: string;
  costLimit: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  assigneeIds: string[];
  items: DraftItem[];
}

const STEPS: { step: Step; label: string }[] = [
  { step: 1, label: 'Kunde' },
  { step: 2, label: 'Fahrzeug' },
  { step: 3, label: 'Leistungen' },
  { step: 4, label: 'Prüfen' },
];

let itemCounter = 0;
const newItem = (p: Partial<DraftItem> = {}): DraftItem => ({ key: `i${++itemCounter}-${Date.now()}`, title: '', quantity: '1', unit: 'Std.', price: '', vat: '1900', maintenanceTypeId: 'none', ...p });

function emptyDraft(): WizardDraft {
  return { v: 1, savedAt: new Date().toISOString(), step: 1, customer: null, vehicle: null, title: '', descriptionCustomer: '', notesInternal: '', costLimit: '', plannedStart: null, plannedEnd: null, assigneeIds: [], items: [] };
}

function parsedItems(items: DraftItem[]) {
  return items
    .map((i) => ({ i, q: parseQuantity(i.quantity), c: parseEuro(i.price) }))
    .filter(({ i }) => i.title.trim());
}

export default function NewWorkOrder() {
  const { user } = useSession();
  const params = useLocalSearchParams<{ kunde?: string; fahrzeug?: string }>();
  const storageKey = `werkstatt.auftragsentwurf.v1:${user?.id ?? 'unbekannt'}`;
  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  // Lokalen Entwurf laden (oder mit Kunde/Fahrzeug aus der Akte beginnen)
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(storageKey)
      .catch(() => null)
      .then((raw) => {
        if (!active) return;
        const saved = raw ? (JSON.parse(raw) as WizardDraft) : null;
        if (saved?.v === 1 && !params.kunde) {
          setDraft(saved);
          setRestored(saved.savedAt);
        } else setDraft(emptyDraft());
      })
      .catch(() => active && setDraft(emptyDraft()));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Laufend lokal speichern (kurz verzögert)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!draft) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void AsyncStorage.setItem(storageKey, JSON.stringify({ ...draft, savedAt: new Date().toISOString() })).catch(() => undefined);
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, storageKey]);

  return (
    <Page maxWidth={960} testID="werkstatt-auftrag-neu">
      <PageHeader
        title="Auftrag anlegen"
        subtitle="Entwurf wird laufend auf diesem Gerät gespeichert."
        backHref={routes.workshop.workOrders() as Href}
        backLabel="Aufträge"
        crumbs={[{ label: 'Aufträge', href: routes.workshop.workOrders() as Href }, { label: 'Auftrag anlegen' }]}
      />
      {draft ? (
        <Wizard
          draft={draft}
          setDraft={setDraft}
          restored={restored}
          presetCustomerId={params.kunde ?? null}
          presetVehicleId={params.fahrzeug ?? null}
          onDiscard={async () => {
            await AsyncStorage.removeItem(storageKey).catch(() => undefined);
            setRestored(null);
            setDraft(emptyDraft());
          }}
          onCreated={async (id) => {
            if (timer.current) clearTimeout(timer.current);
            await AsyncStorage.removeItem(storageKey).catch(() => undefined);
            router.replace(routes.workshop.workOrder(id) as Href);
          }}
        />
      ) : null}
    </Page>
  );
}

function Stepper({ step, onJump, enabled }: { step: Step; onJump: (s: Step) => void; enabled: (s: Step) => boolean }) {
  const t = useTheme();
  const { device } = useBreakpoint();
  if (device === 'phone') {
    // Telefon: vier gleich breite Schaltflächen, darunter der aktuelle Schritt in Worten
    return (
      <View accessibilityRole="progressbar" aria-label={`Schritt ${step} von 4`} style={styles.stepperPhone}>
        <View style={styles.stepRowPhone}>
          {STEPS.map((s) => (
            <View key={s.step} style={styles.stepCellPhone}>
              <Button
                label={String(s.step)}
                accessibilityLabel={`Schritt ${s.step}: ${s.label}${s.step === step ? ', aktuell' : s.step < step ? ', erledigt' : ''}`}
                variant={s.step === step ? 'primary' : 'secondary'}
                icon={s.step < step ? 'Check' : undefined}
                disabled={!enabled(s.step)}
                onPress={() => onJump(s.step)}
                fullWidth
                testID={`schritt-${s.step}`}
              />
            </View>
          ))}
        </View>
        <AppText variant="small" tone="muted">
          Schritt {step} von 4: {STEPS.find((x) => x.step === step)?.label}
        </AppText>
      </View>
    );
  }
  return (
    <View accessibilityRole="progressbar" aria-label={`Schritt ${step} von 4`} style={styles.stepper}>
      {STEPS.map((s) => {
        const current = s.step === step;
        const done = s.step < step;
        return (
          <View key={s.step} style={styles.stepItem}>
            <Button
              label={`${s.step}. ${s.label}`}
              accessibilityLabel={`Schritt ${s.step}: ${s.label}${current ? ', aktuell' : done ? ', erledigt' : ''}`}
              variant={current ? 'primary' : 'secondary'}
              icon={done ? 'Check' : undefined}
              disabled={!enabled(s.step)}
              onPress={() => onJump(s.step)}
              testID={`schritt-${s.step}`}
            />
            {s.step < 4 ? <View style={[styles.stepLine, { backgroundColor: done ? t.colors.accent : t.colors.border }]} /> : null}
          </View>
        );
      })}
    </View>
  );
}

function Wizard({
  draft,
  setDraft,
  restored,
  presetCustomerId,
  presetVehicleId,
  onDiscard,
  onCreated,
}: {
  draft: WizardDraft;
  setDraft: (d: WizardDraft) => void;
  restored: string | null;
  presetCustomerId: string | null;
  presetVehicleId: string | null;
  onDiscard: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const set = (patch: Partial<WizardDraft>) => setDraft({ ...draft, ...patch });
  const types = useApiQuery('werkstatt:wartungsarten', (a) => a.listMaintenanceTypes());

  // Vorbelegung aus Kunden- bzw. Fahrzeugakte (?kunde=…&fahrzeug=…)
  const preset = useApiQuery(presetCustomerId ? `werkstatt:auftrag-neu:vorbelegung:${presetCustomerId}:${presetVehicleId}` : null, async (a) => {
    const c = await a.getCustomer(presetCustomerId!);
    const v = presetVehicleId ? await a.getVehicle(presetVehicleId) : null;
    return { c, v };
  });
  const presetApplied = useRef(false);
  useEffect(() => {
    if (!preset.data || presetApplied.current) return;
    presetApplied.current = true;
    const { c, v } = preset.data;
    set({ customer: { id: c.id, displayName: c.displayName }, vehicle: v ? { id: v.id, label: `${v.make} ${v.model}`, plate: v.licensePlate } : null, step: v ? 3 : 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset.data]);

  const create = useApiMutation(async (a, asDraft: boolean) => {
    const items = parsedItems(draft.items).map(({ i, q, c }) => ({
      kind: 'labor' as const,
      title: i.title.trim(),
      quantity: q,
      unit: i.unit.trim() || 'Stk',
      unitPriceCents: c === null || Number.isNaN(c) ? null : c,
      vatRateBp: Number(i.vat),
      maintenanceTypeId: i.maintenanceTypeId === 'none' ? null : i.maintenanceTypeId,
    }));
    const limit = parseEuro(draft.costLimit);
    return a.createWorkOrder(
      {
        customerId: draft.customer!.id,
        vehicleId: draft.vehicle!.id,
        title: draft.title.trim(),
        descriptionCustomer: draft.descriptionCustomer.trim() || null,
        notesInternal: draft.notesInternal.trim() || null,
        costLimitCents: limit === null || Number.isNaN(limit) ? null : limit,
        plannedStart: draft.plannedStart,
        plannedEnd: draft.plannedEnd,
        assigneeIds: draft.assigneeIds,
        items,
      },
      { draft: asDraft },
    );
  });

  const itemErrors = parsedItems(draft.items).filter(({ q, c }) => !(q > 0) || (c !== null && Number.isNaN(c)));
  const canStep = (s: Step) => s === 1 || (s === 2 && !!draft.customer) || (s >= 3 && !!draft.customer && !!draft.vehicle) || s <= draft.step;
  const step3Valid = !!draft.title.trim() && itemErrors.length === 0;

  async function submit(asDraft: boolean) {
    try {
      const wo = await create.mutate(asDraft);
      toast.show(asDraft ? `Entwurf ${wo.orderNumber} angelegt (für den Kunden unsichtbar).` : `Auftrag ${wo.orderNumber} angelegt.`);
      onCreated(wo.id);
    } catch {
      // Fehler steht in der Ansicht; der lokale Entwurf bleibt erhalten
    }
  }

  useSaveShortcut(() => {
    if (draft.step === 4) void submit(false);
  }, draft.step === 4);

  return (
    <>
      {restored ? (
        <Banner
          tone="info"
          title="Entwurf wiederhergestellt"
          message={`Stand vom ${formatDateTime(restored)}. Sie können weitermachen oder neu beginnen.`}
          testID="entwurf-wiederhergestellt"
          action={<Button label="Verwerfen und neu beginnen" icon="Trash" onPress={onDiscard} />}
        />
      ) : null}
      <Stepper step={draft.step} onJump={(step) => set({ step })} enabled={canStep} />
      {draft.step === 1 ? <CustomerStep draft={draft} set={set} /> : null}
      {draft.step === 2 && draft.customer ? <VehicleStep draft={draft} set={set} /> : null}
      {draft.step === 3 ? <ServicesStep draft={draft} set={set} types={types.data ?? []} invalidItems={itemErrors.length} /> : null}
      {draft.step === 4 ? <ReviewStep draft={draft} types={types.data ?? []} /> : null}
      <ActionError error={create.error} title="Auftrag nicht angelegt" />
      <Row wrap style={styles.nav}>
        {draft.step > 1 ? <Button label="Zurück" icon="ArrowLeft" onPress={() => set({ step: (draft.step - 1) as Step })} testID="wizard-zurueck" /> : <View />}
        {draft.step < 4 ? (
          <Button
            label="Weiter"
            variant="primary"
            iconRight="ArrowRight"
            disabled={(draft.step === 1 && !draft.customer) || (draft.step === 2 && !draft.vehicle) || (draft.step === 3 && !step3Valid)}
            onPress={() => set({ step: (draft.step + 1) as Step })}
            testID="wizard-weiter"
          />
        ) : (
          <Row wrap>
            <Button label="Als Entwurf anlegen" icon="PencilSimple" onPress={() => void submit(true)} loading={create.pending} testID="als-entwurf-anlegen" />
            <Button label="Auftrag anlegen (Strg+Enter)" variant="primary" icon="Check" onPress={() => void submit(false)} loading={create.pending} testID="wizard-anlegen" />
          </Row>
        )}
      </Row>
      {draft.step === 3 && !draft.title.trim() ? <AppText variant="small" tone="subtle">Weiter, sobald ein Titel für den Auftrag eingetragen ist.</AppText> : null}
    </>
  );
}

function CustomerStep({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const chipFor = (c: CustomerSummary) =>
    draft.customer?.id === c.id ? <StatusChip status={{ label: 'Gewählt', tone: 'success', icon: 'Check' }} /> : <StatusChip status={customerAccessLabels[c.accessStatus]} />;
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useApiQuery(`werkstatt:wizard:kunden:${q.trim()}`, (a) => a.listCustomers({ q: q.trim() || undefined }));
  const pick = (c: { id: string; displayName: string }) => set({ customer: { id: c.id, displayName: c.displayName }, vehicle: draft.customer?.id === c.id ? draft.vehicle : null, step: 2 });
  return (
    <Section title="1. Kunde wählen" action={<Button label="Neuer Kunde" icon="UserPlus" onPress={() => setCreating(true)} testID="neuer-kunde" />}>
      {draft.customer ? <Banner tone="success" title={`Gewählt: ${draft.customer.displayName}`} message="Anderen Kunden wählen oder mit Weiter fortfahren." /> : null}
      <SearchField value={q} onChangeText={setQ} label="Kunden suchen" placeholder="Name, Telefon, E-Mail oder Kennzeichen" />
      {list.data && list.data.items.length === 0 ? (
        <EmptyState icon="Users" title="Kein Kunde gefunden" message="Suchbegriff ändern oder den Kunden neu anlegen." action={<Button label="Neuer Kunde" icon="UserPlus" onPress={() => setCreating(true)} />} />
      ) : (
        <ListGroup>
          {(list.data?.items ?? []).slice(0, 12).map((c: CustomerSummary, i) => (
            <ListRow
              key={c.id}
              first={i === 0}
              icon={c.kind === 'business' ? 'Storefront' : 'UserCircle'}
              title={c.displayName}
              subtitle={[c.customerNumber, c.phone, c.email].filter(Boolean).join(', ')}
              right={chipFor(c)}
              onPress={() => pick(c)}
              testID={`kunde-waehlen-${c.customerNumber}`}
            />
          ))}
        </ListGroup>
      )}
      <Sheet visible={creating} onClose={() => setCreating(false)} title="Neuer Kunde" width={680} testID="neuer-kunde-blatt">
        <AppText tone="muted">Der Auftragsentwurf bleibt erhalten. Nach dem Speichern geht es mit dem Fahrzeug weiter.</AppText>
        <CustomerForm
          compact
          inDialog
          submitLabel="Kunde anlegen und übernehmen"
          onCancel={() => setCreating(false)}
          onSaved={(c: CustomerDetail) => {
            setCreating(false);
            pick(c);
          }}
        />
      </Sheet>
    </Section>
  );
}

function VehicleStep({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  const [creating, setCreating] = useState(false);
  const customerId = draft.customer!.id;
  const list = useApiQuery(`werkstatt:wizard:fahrzeuge:${customerId}`, (a) => a.listVehicles({ customerId }));
  const pick = (v: VehicleSummary | VehicleDetail) => set({ vehicle: { id: v.id, label: `${v.make} ${v.model}`, plate: v.licensePlate }, step: 3 });
  return (
    <Section title={`2. Fahrzeug von ${draft.customer!.displayName}`} action={<Button label="Neues Fahrzeug" icon="Plus" onPress={() => setCreating(true)} testID="neues-fahrzeug" />}>
      {list.data && list.data.items.length === 0 ? (
        <EmptyState icon="Car" title="Noch kein Fahrzeug" message="Das Fahrzeug jetzt anlegen; der Kunde wird Halter." action={<Button label="Neues Fahrzeug" variant="primary" icon="Plus" onPress={() => setCreating(true)} testID="neues-fahrzeug-leer" />} />
      ) : (
        <ListGroup>
          {(list.data?.items ?? []).map((v, i) => (
            <ListRow
              key={v.id}
              first={i === 0}
              icon="Car"
              title={`${keepPlates(v.licensePlate)}, ${v.make} ${v.model}`}
              subtitle={v.vin ? `FIN ${v.vin}` : null}
              meta={v.lastOdometerKm ? `Zuletzt ${formatKm(v.lastOdometerKm)}` : null}
              right={draft.vehicle?.id === v.id ? <StatusChip status={{ label: 'Gewählt', tone: 'success', icon: 'Check' }} /> : undefined}
              onPress={() => pick(v)}
              testID={`fahrzeug-waehlen-${v.id}`}
            />
          ))}
        </ListGroup>
      )}
      <Sheet visible={creating} onClose={() => setCreating(false)} title="Neues Fahrzeug" width={720} testID="neues-fahrzeug-blatt">
        <VehicleForm
          inDialog
          ownerCustomerId={customerId}
          ownerName={draft.customer!.displayName}
          submitLabel="Fahrzeug anlegen und übernehmen"
          onCancel={() => setCreating(false)}
          onSaved={(v) => {
            setCreating(false);
            pick(v);
          }}
        />
      </Sheet>
    </Section>
  );
}

function ServicesStep({ draft, set, types, invalidItems }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void; types: MaintenanceType[]; invalidItems: number }) {
  const { staff } = useStaffDirectory();
  const setItem = (key: string, patch: Partial<DraftItem>) => set({ items: draft.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  return (
    <>
      <Section title="3. Leistungen">
        <TextField label="Titel des Auftrags" value={draft.title} onChangeText={(title) => set({ title })} required testID="auftrag-titel" placeholder="z. B. Inspektion und Bremsen prüfen" />
        <TextField label="Beschreibung für den Kunden" value={draft.descriptionCustomer} onChangeText={(descriptionCustomer) => set({ descriptionCustomer })} multiline />
        <TextField label="Interne Notiz (nie für den Kunden)" value={draft.notesInternal} onChangeText={(notesInternal) => set({ notesInternal })} multiline />
        <TextField label="Kostenrahmen in Euro (freiwillig)" value={draft.costLimit} onChangeText={(costLimit) => set({ costLimit })} keyboardType="decimal-pad" />
      </Section>
      <Section title="Positionen" action={<Button label="Position hinzufügen" icon="Plus" variant="quiet" onPress={() => set({ items: [...draft.items, newItem()] })} testID="wizard-position" />}>
        {draft.items.length === 0 ? <AppText tone="muted">Vereinbarte Leistungen als Positionen erfassen. Sie zählen zur Annahme, bis diese bestätigt ist.</AppText> : null}
        {draft.items.map((i, n) => (
          <View key={i.key} style={styles.item}>
            <Row style={styles.between}>
              <AppText variant="bodyStrong">Position {n + 1}</AppText>
              <IconButton icon="Trash" tone="danger" accessibilityLabel={`Position ${n + 1} entfernen`} onPress={() => set({ items: draft.items.filter((x) => x.key !== i.key) })} />
            </Row>
            <TextField label="Titel" value={i.title} onChangeText={(title) => setItem(i.key, { title })} testID={`wizard-position-${n}-titel`} />
            <Row wrap gap={12} style={styles.alignStart}>
              <View style={styles.small}>
                <TextField label="Menge" value={i.quantity} onChangeText={(quantity) => setItem(i.key, { quantity })} keyboardType="decimal-pad" />
              </View>
              <View style={styles.small}>
                <TextField label="Einheit" value={i.unit} onChangeText={(unit) => setItem(i.key, { unit })} />
              </View>
              <View style={styles.small}>
                <TextField label="Einzelpreis netto (€)" value={i.price} onChangeText={(price) => setItem(i.key, { price })} keyboardType="decimal-pad" testID={`wizard-position-${n}-preis`} />
              </View>
              <View style={styles.small}>
                <Select label="USt" value={i.vat} onChange={(vat) => setItem(i.key, { vat })} options={[{ value: '1900', label: '19 %' }, { value: '700', label: '7 %' }, { value: '0', label: '0 %' }]} />
              </View>
            </Row>
            <Select label="Wartungsart" value={i.maintenanceTypeId} onChange={(maintenanceTypeId) => setItem(i.key, { maintenanceTypeId })} options={[{ value: 'none', label: 'Keine Wartung' }, ...types.filter((m) => m.active).map((m) => ({ value: m.id, label: m.name }))]} />
          </View>
        ))}
        {invalidItems > 0 ? <AppText tone="danger">Bitte Menge und Preis der Positionen prüfen (Menge größer 0, Preis in Euro).</AppText> : null}
      </Section>
      <Section title="Planung">
        <Row wrap gap={12} style={styles.alignStart}>
          <View style={styles.col}>
            <DateTimeField label="Geplanter Beginn" value={draft.plannedStart ? new Date(draft.plannedStart) : null} onChange={(d) => set({ plannedStart: d.toISOString() })} />
          </View>
          <View style={styles.col}>
            <DateTimeField label="Geplantes Ende" value={draft.plannedEnd ? new Date(draft.plannedEnd) : null} onChange={(d) => set({ plannedEnd: d.toISOString() })} />
          </View>
        </Row>
        {staff.length > 0 ? (
          <View>
            <AppText variant="caption" tone="muted">Mechaniker zuweisen</AppText>
            {staff.map((s) => (
              <Checkbox key={s.id} label={s.displayName} checked={draft.assigneeIds.includes(s.id)} onChange={(v) => set({ assigneeIds: v ? [...draft.assigneeIds, s.id] : draft.assigneeIds.filter((x) => x !== s.id) })} />
            ))}
          </View>
        ) : null}
      </Section>
    </>
  );
}

function ReviewStep({ draft, types }: { draft: WizardDraft; types: MaintenanceType[] }) {
  const t = useTheme();
  const items = parsedItems(draft.items);
  const totals = useMemo(() => {
    const priced = items.filter(({ q, c }) => q > 0 && c !== null && !Number.isNaN(c));
    try {
      return calculateTotals(priced.map(({ q, c, i }) => ({ quantity: q, unitPriceCents: c as number, vatRateBp: Number(i.vat) })));
    } catch {
      return null;
    }
  }, [items]);
  const limit = parseEuro(draft.costLimit);
  return (
    <Section title="4. Prüfen">
      <KeyValueList
        items={[
          { label: 'Kunde', value: draft.customer?.displayName ?? '' },
          { label: 'Fahrzeug', value: draft.vehicle ? `${keepPlates(draft.vehicle.plate)}, ${draft.vehicle.label}` : '' },
          { label: 'Titel', value: draft.title },
          { label: 'Kostenrahmen', value: limit && !Number.isNaN(limit) ? formatMoney(limit) : 'nicht festgelegt', numeric: true },
          { label: 'Geplant', value: draft.plannedStart ? formatDateTime(draft.plannedStart) : 'offen', numeric: true },
          { label: 'Positionen', value: `${items.length}${totals ? `, zusammen ${formatMoney(totals.totalGrossCents)} brutto` : ''}`, numeric: true },
        ]}
      />
      {items.length > 0 ? (
        <View style={[styles.review, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]}>
          {items.map(({ i, q, c }) => (
            <Row key={i.key} style={styles.between}>
              <AppText style={styles.flex}>
                {i.title}
                {i.maintenanceTypeId !== 'none' ? ` (${types.find((m) => m.id === i.maintenanceTypeId)?.name ?? 'Wartung'})` : ''}
              </AppText>
              <AppText numeric tone="muted">{`${String(q).replace('.', ',')} ${i.unit}${c !== null && !Number.isNaN(c) ? ` × ${formatMoney(c)}` : ''}`}</AppText>
            </Row>
          ))}
        </View>
      ) : null}
      <Banner tone="info" message="Nach dem Anlegen: Fahrzeugannahme erfassen und vom Kunden bestätigen lassen. Die Bestätigung deckt nur diese Leistungen; alles Weitere läuft über eine Freigabeanfrage." />
      {limit !== null && totals && limit < totals.totalGrossCents ? <Banner tone="warning" message={`Die Positionen (${formatMoney(totals.totalGrossCents)}) liegen über dem Kostenrahmen (${formatMoney(limit)}).`} /> : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepLine: { width: 24, height: 2 },
  stepperPhone: { gap: 6 },
  stepRowPhone: { flexDirection: 'row', gap: 8 },
  stepCellPhone: { flex: 1, minWidth: 0 },
  nav: { justifyContent: 'space-between' },
  between: { justifyContent: 'space-between' },
  alignStart: { alignItems: 'flex-start' },
  item: { gap: 10, paddingVertical: 8 },
  small: { flexGrow: 1, flexBasis: 120, minWidth: 110 },
  col: { flexGrow: 1, flexBasis: 220, minWidth: 200 },
  review: { borderWidth: 1, padding: 12, gap: 8 },
  flex: { flex: 1, minWidth: 0 },
});
