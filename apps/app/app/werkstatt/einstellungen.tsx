/**
 * Werkstatt, Einstellungen (settings.manage): Werkstattdaten und Öffnungszeiten,
 * Wartungsarten mit Intervallen und Intervall-Optionen, Hebebühnen, eigene
 * Benachrichtigungen, Zahlungsanbindung nur als Status ("konfiguriert" bzw. "nicht
 * konfiguriert"); Schlüssel und Geheimnisse erscheinen nie in der Oberfläche.
 * Speichern je Abschnitt.
 */
import { routes, type MaintenanceType, type NotificationEvent, type Resource, type ResourceKind, type WorkshopSettings } from '@werkstatt/contracts';
import type { Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NotificationPreference } from '../../src/data/api';
import { useApiMutation, useApiQuery } from '../../src/data/hooks';
import { formatKm } from '../../src/lib/format';
import { newClientId } from '../../src/lib/pickImage';
import { NotAvailableView, QueryView } from '../../src/screens/common';
import { ActionError, parseInteger, resourceKindLabels, useCan } from '../../src/screens/workshop/shared';
import { useTheme } from '../../src/theme';
import { AppText, Banner, Button, IconButton, ListGroup, ListRow, Page, PageHeader, Row, Section, Select, Sheet, StatusChip, SwitchRow, Tabs, TextField, useTabParam, useToast } from '../../src/ui';

const TABS = ['werkstatt', 'wartungsarten', 'hebebuehnen', 'benachrichtigungen', 'zahlung'] as const;
const LABELS: Record<(typeof TABS)[number], string> = { werkstatt: 'Werkstattdaten', wartungsarten: 'Wartungsarten', hebebuehnen: 'Hebebühnen', benachrichtigungen: 'Benachrichtigungen', zahlung: 'Zahlungsanbindung' };
const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export default function SettingsScreen() {
  const can = useCan();
  const [tab, setTab] = useTabParam(TABS, 'werkstatt');
  if (!can('settings.manage')) return <Page><NotAvailableView title="Einstellungen nur mit Recht zur Verwaltung" /></Page>;
  return (
    <Page maxWidth={960} testID="werkstatt-einstellungen">
      <PageHeader title="Einstellungen" crumbs={[{ label: 'Übersicht', href: routes.workshop.home() as Href }, { label: 'Einstellungen' }]} />
      <Tabs label="Bereiche der Einstellungen" items={TABS.map((v) => ({ value: v, label: LABELS[v] }))} value={tab} onChange={setTab} />
      {tab === 'werkstatt' ? <WorkshopData /> : null}
      {tab === 'wartungsarten' ? <MaintenanceTypes /> : null}
      {tab === 'hebebuehnen' ? <Lifts /> : null}
      {tab === 'benachrichtigungen' ? <Notifications /> : null}
      {tab === 'zahlung' ? <Payment /> : null}
    </Page>
  );
}

function WorkshopData() {
  const query = useApiQuery('werkstatt:einstellungen', (a) => a.getSettings());
  return <QueryView query={query} loading="detail">{(s) => <WorkshopForm settings={s} />}</QueryView>;
}

function WorkshopForm({ settings }: { settings: WorkshopSettings }) {
  const toast = useToast();
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const save = useApiMutation((a) =>
    a.updateSettings({
      name: s.name.trim(),
      legalName: s.legalName?.trim() || null,
      street: s.street?.trim() || null,
      postalCode: s.postalCode?.trim() || null,
      city: s.city?.trim() || null,
      phone: s.phone?.trim() || null,
      email: s.email?.trim() || null,
      website: s.website?.trim() || null,
      vatId: s.vatId?.trim() || null,
      iban: s.iban?.replace(/\s/g, '') || null,
      bic: s.bic?.trim() || null,
      bankName: s.bankName?.trim() || null,
      paymentTermDays: s.paymentTermDays,
      openingHours: s.openingHours,
    }),
  );
  const field = (key: keyof WorkshopSettings, label: string, extra: object = {}) => (
    <TextField label={label} value={String(s[key] ?? '')} onChangeText={(v) => setS({ ...s, [key]: v })} {...extra} />
  );
  return (
    <>
      <Section title="Werkstatt">
        {field('name', 'Name', { required: true })}
        {field('legalName', 'Firmierung (Rechtsform)')}
        {field('street', 'Straße und Hausnummer')}
        <Row wrap gap={12} style={styles.alignStart}>
          <View style={styles.narrow}>{field('postalCode', 'PLZ')}</View>
          <View style={styles.wide}>{field('city', 'Ort')}</View>
        </Row>
        <Row wrap gap={12} style={styles.alignStart}>
          <View style={styles.wide}>{field('phone', 'Telefon')}</View>
          <View style={styles.wide}>{field('email', 'E-Mail')}</View>
        </Row>
        {field('website', 'Webseite')}
      </Section>
      <Section title="Rechnungsangaben">
        {field('vatId', 'USt-IdNr.')}
        <Row wrap gap={12} style={styles.alignStart}>
          <View style={styles.wide}>{field('iban', 'IBAN')}</View>
          <View style={styles.narrow}>{field('bic', 'BIC')}</View>
        </Row>
        {field('bankName', 'Bank')}
        <TextField label="Zahlungsziel in Tagen" value={String(s.paymentTermDays)} onChangeText={(v) => setS({ ...s, paymentTermDays: Number(v.replace(/\D/g, '')) || 0 })} keyboardType="number-pad" />
      </Section>
      <Section title="Öffnungszeiten">
        {WEEKDAYS.map((label, i) => {
          const weekday = i + 1;
          const entry = s.openingHours.find((o) => o.weekday === weekday);
          return (
            <Row key={weekday} wrap gap={12} style={styles.alignCenter}>
              <AppText style={styles.day}>{label}</AppText>
              {entry ? (
                <>
                  <View style={styles.time}>
                    <TextField label={`${label} öffnet`} value={entry.opens} onChangeText={(v) => setS({ ...s, openingHours: s.openingHours.map((o) => (o.weekday === weekday ? { ...o, opens: v } : o)) })} />
                  </View>
                  <View style={styles.time}>
                    <TextField label={`${label} schließt`} value={entry.closes} onChangeText={(v) => setS({ ...s, openingHours: s.openingHours.map((o) => (o.weekday === weekday ? { ...o, closes: v } : o)) })} />
                  </View>
                  <Button label="Geschlossen" variant="quiet" onPress={() => setS({ ...s, openingHours: s.openingHours.filter((o) => o.weekday !== weekday) })} />
                </>
              ) : (
                <Button label="Geöffnet setzen" variant="quiet" icon="Plus" onPress={() => setS({ ...s, openingHours: [...s.openingHours, { weekday, opens: '08:00', closes: '17:00' }].sort((a, b) => a.weekday - b.weekday) })} />
              )}
            </Row>
          );
        })}
        <AppText variant="small" tone="subtle">Der Kalender markiert Termine außerhalb dieser Zeiten.</AppText>
      </Section>
      <ActionError error={save.error} />
      <Button
        label="Werkstattdaten speichern"
        variant="primary"
        icon="Check"
        loading={save.pending}
        disabled={!s.name.trim()}
        onPress={async () => {
          try {
            await save.mutate();
            toast.show('Werkstattdaten gespeichert.');
          } catch {
            // Fehler oben
          }
        }}
        testID="werkstatt-speichern"
      />
    </>
  );
}

function MaintenanceTypes() {
  const query = useApiQuery('werkstatt:wartungsarten', (a) => a.listMaintenanceTypes());
  const [editing, setEditing] = useState<MaintenanceType | 'new' | null>(null);
  return (
    <>
      <Section title="Wartungsarten und Intervalle" action={<Button label="Wartungsart anlegen" icon="Plus" onPress={() => setEditing('new')} />}>
        <AppText tone="muted">Aus Wartungspositionen mit Wartungsart entstehen beim fachlichen Abschluss Serviceeinträge. Die Intervall-Optionen bietet die Mechanikeransicht beim Abschluss an.</AppText>
        <QueryView query={query}>
          {(types) => (
            <ListGroup>
              {types.map((m, i) => (
                <ListRow
                  key={m.id}
                  first={i === 0}
                  icon="Gauge"
                  title={m.name}
                  subtitle={`Standard: ${[m.defaultIntervalKm ? `${formatKm(m.defaultIntervalKm)}` : null, m.defaultIntervalMonths ? `${m.defaultIntervalMonths} Monate` : null].filter(Boolean).join(', ') || 'ohne Intervall'}`}
                  meta={m.intervalOptions.length ? `Optionen: ${m.intervalOptions.map((o) => o.label).join(', ')}` : null}
                  right={<StatusChip status={m.active ? { label: 'Aktiv', tone: 'success', icon: 'CheckCircle' } : { label: 'Inaktiv', tone: 'neutral', icon: 'Minus' }} />}
                  onPress={() => setEditing(m)}
                />
              ))}
            </ListGroup>
          )}
        </QueryView>
      </Section>
      <MaintenanceTypeSheet value={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function MaintenanceTypeSheet({ value, onClose }: { value: MaintenanceType | 'new' | null; onClose: () => void }) {
  const toast = useToast();
  const existing = value && value !== 'new' ? value : null;
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [km, setKm] = useState('');
  const [months, setMonths] = useState('');
  const [active, setActive] = useState(true);
  const [options, setOptions] = useState<{ km: string; months: string; label: string }[]>([]);
  useEffect(() => {
    if (!value) return;
    setName(existing?.name ?? '');
    setKey(existing?.key ?? '');
    setKm(existing?.defaultIntervalKm ? String(existing.defaultIntervalKm) : '');
    setMonths(existing?.defaultIntervalMonths ? String(existing.defaultIntervalMonths) : '');
    setActive(existing?.active ?? true);
    setOptions((existing?.intervalOptions ?? []).map((o) => ({ km: o.km ? String(o.km) : '', months: o.months ? String(o.months) : '', label: o.label })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const save = useApiMutation((a) => {
    const n = (v: string) => {
      const x = parseInteger(v);
      return x === null || Number.isNaN(x) ? null : x;
    };
    return a.upsertMaintenanceType(existing?.id ?? newClientId(), {
      key: key.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      name: name.trim(),
      defaultIntervalKm: n(km),
      defaultIntervalMonths: n(months),
      intervalOptions: options.filter((o) => o.label.trim()).map((o) => ({ km: n(o.km), months: n(o.months), label: o.label.trim() })),
      active,
    });
  });
  return (
    <Sheet
      visible={value !== null}
      onClose={onClose}
      title={existing ? existing.name : 'Wartungsart anlegen'}
      width={640}
      footer={
        <>
          <Button label="Abbrechen" onPress={onClose} />
          <Button
            label="Speichern"
            variant="primary"
            disabled={!name.trim()}
            loading={save.pending}
            onPress={async () => {
              try {
                await save.mutate();
                toast.show('Wartungsart gespeichert.');
                onClose();
              } catch {
                // Fehler unten
              }
            }}
          />
        </>
      }
    >
      <TextField label="Name" value={name} onChangeText={setName} required />
      <TextField label="Schlüssel (technisch)" value={key} onChangeText={setKey} autoCapitalize="none" help="Wird aus dem Namen gebildet, wenn leer." />
      <Row wrap gap={12} style={styles.alignStart}>
        <View style={styles.wide}>
          <TextField label="Standardintervall km" value={km} onChangeText={setKm} keyboardType="number-pad" />
        </View>
        <View style={styles.wide}>
          <TextField label="Standardintervall Monate" value={months} onChangeText={setMonths} keyboardType="number-pad" />
        </View>
      </Row>
      <AppText variant="caption" tone="muted">Intervall-Optionen (z. B. Longlife)</AppText>
      {options.map((o, i) => (
        <Row key={i} wrap gap={8} style={styles.alignEnd}>
          <View style={styles.wide}>
            <TextField label="Bezeichnung" value={o.label} onChangeText={(v) => setOptions((l) => l.map((x, n) => (n === i ? { ...x, label: v } : x)))} />
          </View>
          <View style={styles.narrow}>
            <TextField label="km" value={o.km} onChangeText={(v) => setOptions((l) => l.map((x, n) => (n === i ? { ...x, km: v } : x)))} keyboardType="number-pad" />
          </View>
          <View style={styles.narrow}>
            <TextField label="Monate" value={o.months} onChangeText={(v) => setOptions((l) => l.map((x, n) => (n === i ? { ...x, months: v } : x)))} keyboardType="number-pad" />
          </View>
          <IconButton icon="Trash" tone="danger" accessibilityLabel={`Option ${i + 1} entfernen`} onPress={() => setOptions((l) => l.filter((_, n) => n !== i))} />
        </Row>
      ))}
      <Button label="Option hinzufügen" variant="quiet" icon="Plus" onPress={() => setOptions((l) => [...l, { km: '', months: '', label: '' }])} />
      <SwitchRow label="Aktiv" value={active} onChange={setActive} description="Inaktive Wartungsarten stehen für neue Positionen nicht zur Auswahl; bestehende Einträge bleiben." />
      <ActionError error={save.error} />
    </Sheet>
  );
}

function Lifts() {
  const toast = useToast();
  const query = useApiQuery('werkstatt:hebebuehnen', (a) => a.listResources());
  const [editing, setEditing] = useState<Resource | 'new' | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ResourceKind>('lift');
  const [active, setActive] = useState(true);
  const existing = editing && editing !== 'new' ? editing : null;
  useEffect(() => {
    if (!editing) return;
    setName(existing?.name ?? '');
    setKind(existing?.kind ?? 'lift');
    setActive(existing?.active ?? true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const save = useApiMutation((a) => a.upsertResource(existing?.id ?? newClientId(), { name: name.trim(), kind, active }));
  return (
    <>
      <Section title="Hebebühnen und Plätze" action={<Button label="Anlegen" icon="Plus" onPress={() => setEditing('new')} />}>
        <QueryView query={query}>
          {(items) => (
            <ListGroup>
              {items.map((r, i) => (
                <ListRow key={r.id} first={i === 0} icon="Wrench" title={r.name} subtitle={resourceKindLabels[r.kind]} right={<StatusChip status={r.active ? { label: 'Aktiv', tone: 'success', icon: 'CheckCircle' } : { label: 'Inaktiv', tone: 'neutral', icon: 'Minus' }} />} onPress={() => setEditing(r)} />
              ))}
            </ListGroup>
          )}
        </QueryView>
      </Section>
      <Sheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={existing ? existing.name : 'Hebebühne anlegen'}
        footer={
          <>
            <Button label="Abbrechen" onPress={() => setEditing(null)} />
            <Button
              label="Speichern"
              variant="primary"
              disabled={!name.trim()}
              loading={save.pending}
              onPress={async () => {
                try {
                  await save.mutate();
                  toast.show('Gespeichert.');
                  setEditing(null);
                } catch {
                  // Fehler unten
                }
              }}
            />
          </>
        }
      >
        <TextField label="Name" value={name} onChangeText={setName} required />
        <Select label="Art" value={kind} onChange={setKind} options={(Object.keys(resourceKindLabels) as ResourceKind[]).map((k) => ({ value: k, label: resourceKindLabels[k] }))} />
        <SwitchRow label="Aktiv" value={active} onChange={setActive} description="Inaktive Plätze erscheinen nicht im Kalender." />
        <ActionError error={save.error} />
      </Sheet>
    </>
  );
}

const EVENT_LABELS: Record<NotificationEvent, string> = {
  'approval.requested': 'Freigabe angefragt (an Kunden)',
  'approval.decided': 'Kunde hat entschieden',
  'message.received': 'Neue Nachricht',
  'invoice.issued': 'Rechnung gestellt',
  'payment.confirmed': 'Zahlung bestätigt',
  'appointment.confirmed': 'Termin bestätigt',
  'appointment.proposed': 'Terminvorschlag',
  'appointment.requested': 'Terminanfrage eingegangen',
  'work_order.ready_for_pickup': 'Fahrzeug abholbereit',
  'finding.reported': 'Feststellung gemeldet',
  'maintenance.due_soon': 'Wartung bald fällig',
};

function Notifications() {
  const toast = useToast();
  const query = useApiQuery('werkstatt:benachrichtigungen', (a) => a.getNotificationPreferences());
  const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
  useEffect(() => {
    if (query.data) setPrefs(query.data);
  }, [query.data]);
  const save = useApiMutation((a) => a.setNotificationPreferences(prefs));
  const staffEvents: NotificationEvent[] = ['approval.decided', 'message.received', 'appointment.requested', 'finding.reported', 'payment.confirmed'];
  const isOn = (e: NotificationEvent, ch: 'push' | 'email') => prefs.find((p) => p.eventType === e && p.channel === ch)?.enabled ?? true;
  const toggle = (e: NotificationEvent, ch: 'push' | 'email', enabled: boolean) => setPrefs((l) => [...l.filter((p) => !(p.eventType === e && p.channel === ch)), { eventType: e, channel: ch, enabled }]);
  return (
    <Section title="Meine Benachrichtigungen">
      <AppText tone="muted">Diese Einstellungen gelten für Ihr eigenes Konto. Hinweise in der App erscheinen immer.</AppText>
      <QueryView query={query}>
        {() => (
          <>
            {staffEvents.map((e) => (
              <View key={e} style={styles.pref}>
                <AppText variant="bodyStrong">{EVENT_LABELS[e]}</AppText>
                <SwitchRow label="Push auf dem Telefon" value={isOn(e, 'push')} onChange={(v) => toggle(e, 'push', v)} />
                <SwitchRow label="E-Mail" value={isOn(e, 'email')} onChange={(v) => toggle(e, 'email', v)} />
              </View>
            ))}
            <ActionError error={save.error} />
            <Button
              label="Benachrichtigungen speichern"
              variant="primary"
              loading={save.pending}
              onPress={async () => {
                try {
                  await save.mutate();
                  toast.show('Gespeichert.');
                } catch {
                  // Fehler oben
                }
              }}
            />
          </>
        )}
      </QueryView>
    </Section>
  );
}

function Payment() {
  const t = useTheme();
  const query = useApiQuery('werkstatt:einstellungen', (a) => a.getSettings());
  return (
    <QueryView query={query}>
      {(s) => (
        <View style={[styles.panel, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]} testID="zahlungsanbindung">
          <AppText variant="heading">Online-Zahlung</AppText>
          <Row wrap gap={8}>
            <StatusChip status={s.paymentProvider === 'sumup' ? { label: 'Anbieter: SumUp', tone: 'info', icon: 'CreditCard' } : { label: 'Online-Zahlung aus', tone: 'neutral', icon: 'Minus' }} />
            <StatusChip status={s.paymentProviderConfigured ? { label: 'Konfiguriert', tone: 'success', icon: 'CheckCircle' } : { label: 'Nicht konfiguriert', tone: 'warning', icon: 'Warning' }} testID="zahlung-konfiguriert" />
          </Row>
          <AppText tone="muted">
            Zugangsschlüssel werden nur auf dem Server hinterlegt (Umgebungsvariablen) und hier nie angezeigt oder eingegeben. Ohne Konfiguration sehen Kunden nur die Überweisungsdaten.
          </AppText>
          <Banner tone="info" message="Konto, Vertrag und Sandbox beim Zahlungsanbieter sind eine offene Entscheidung (O-2). Echte Zahlungen nur nach ausdrücklicher Freigabe des Inhabers." />
          <AppText variant="heading">Dokumentvorlagen</AppText>
          <AppText tone="muted">Nicht umgesetzt: Angebote und Rechnungen werden als fertige PDF hochgeladen (E-1). Eigene Vorlagen gehören zu einer späteren Entscheidung.</AppText>
        </View>
      )}
    </QueryView>
  );
}

const styles = StyleSheet.create({
  alignStart: { alignItems: 'flex-start' },
  alignCenter: { alignItems: 'center' },
  alignEnd: { alignItems: 'flex-end' },
  narrow: { flexBasis: 110, flexGrow: 1, minWidth: 100 },
  wide: { flexBasis: 200, flexGrow: 2, minWidth: 180 },
  day: { width: 110 },
  time: { width: 150 },
  pref: { gap: 0, paddingVertical: 8 },
  panel: { borderWidth: 1, padding: 16, gap: 12 },
});
