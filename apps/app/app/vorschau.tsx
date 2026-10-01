/**
 * Einstieg der Vorschau (nur Demo-Modus): Rollen wählen und vorgeschlagene Rundgänge mit einem
 * Klick starten. Für Vorführungen bei der Werkstatt; alle Daten sind Beispieldaten im Browser.
 */
import { routes } from '@werkstatt/contracts';
import { Redirect, router, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../src/auth/session';
import { IS_DEMO } from '../src/config';
import { invalidateAll } from '../src/data/invalidation';
import { DEMO_TOKENS } from '../src/data/demo/constants';
import { IDS, PREVIEW_IDS } from '../src/data/demo/seed';
import { useDemo } from '../src/demo/DemoPanel';
import { PublicPage, PublicPanel } from '../src/screens/common';
import { useBreakpoint, useTheme } from '../src/theme';
import { AppText, Button, ConfirmDialog, Icon, ListGroup, ListRow, iconSize, useToast, type IconName } from '../src/ui';

interface Tour {
  title: string;
  hint: string;
  path: string;
}

interface RoleCard {
  key: string;
  userId: string;
  icon: IconName;
  title: string;
  person: string;
  device: string;
  summary: string;
  cta: string;
  start: string;
  tours: Tour[];
}

const W = IDS.workOrders;

const ROLES: RoleCard[] = [
  {
    key: 'service',
    userId: IDS.users.service,
    icon: 'Storefront',
    title: 'Büro und Service',
    person: 'Petra Wiesmann',
    device: 'Am besten am PC',
    summary: 'Tagesübersicht, Kalender mit Hebebühnen, Kunden, Fahrzeuge, Aufträge von der Annahme bis zur Rechnung.',
    cta: 'Als Service ansehen',
    start: '/werkstatt',
    tours: [
      { title: 'Übersicht des Tages', hint: 'Offene Aufträge, Freigaben, Nachrichten, Abholungen', path: '/werkstatt' },
      { title: 'Kalender heute', hint: 'Hebebühne 2 ist doppelt belegt und wird markiert', path: '/werkstatt/kalender' },
      { title: 'Abschluss prüfen', hint: 'Hyundai i30: Arbeit fertig, Servicehistorie entsteht erst jetzt', path: `/werkstatt/auftraege/${PREVIEW_IDS.workOrders.i30Done}` },
      { title: 'Freigabe beim Kunden anfragen', hint: 'Škoda Octavia: Bremsen vorne mit Fotos und Preisen', path: `/werkstatt/auftraege/${W.octaviaInspection}/freigaben` },
      { title: 'Offene Rechnungen', hint: 'Eine davon ist überfällig', path: '/werkstatt/rechnungen?zahlung=offen' },
    ],
  },
  {
    key: 'mechanic',
    userId: IDS.users.emre,
    icon: 'Wrench',
    title: 'Mechaniker in der Halle',
    person: 'Emre Aydın',
    device: 'Am besten am Handy',
    summary: 'Nur die eigenen Aufträge, ohne Preise. Arbeit starten und abschließen, Feststellungen mit Foto, auch ohne Netz.',
    cta: 'Als Mechaniker ansehen',
    start: '/mechaniker',
    tours: [
      { title: 'Heute', hint: 'Zugewiesene Fahrzeuge und Positionen', path: '/mechaniker' },
      { title: 'Position starten und abschließen', hint: 'Toyota Yaris: Wartung nur mit km-Stand', path: `/mechaniker/auftraege/${W.yaris}` },
      { title: 'Feststellung melden', hint: 'Mit Foto und Dringlichkeit an den Service', path: `/mechaniker/auftraege/${W.yaris}/feststellung` },
    ],
  },
  {
    key: 'customer',
    userId: IDS.users.miriam,
    icon: 'UserCircle',
    title: 'Kundin in der App',
    person: 'Miriam Kowalczyk',
    device: 'Am besten am Handy',
    summary: 'Auftrag verfolgen, Zusatzarbeiten freigeben, Rechnungen bezahlen, Servicehistorie und Termine.',
    cta: 'Als Kundin ansehen',
    start: '/kunde',
    tours: [
      { title: 'Zusatzarbeit freigeben', hint: 'Bremsen vorne: Fotos, Preis, genau diese Version', path: `/kunde/auftraege/${W.octaviaInspection}/freigaben/${IDS.approvals.brakes}` },
      { title: 'Rechnung online bezahlen', hint: 'Simulierte Zahlungsseite, nichts wird abgebucht', path: `/kunde/rechnungen/${IDS.invoices.golfWheels}` },
      { title: 'Servicehistorie und Fälligkeiten', hint: 'VW Golf: was wann gemacht wurde, was als Nächstes fällig ist', path: `/kunde/fahrzeuge/${IDS.vehicles.golf}` },
      { title: 'Nachricht an die Werkstatt', hint: 'Chat zum Auftrag; ein "Ja" im Chat ist keine Freigabe', path: `/kunde/auftraege/${W.octaviaInspection}/chat` },
    ],
  },
];

const MORE: { userId: string; icon: IconName; title: string; hint: string }[] = [
  { userId: IDS.users.owner, icon: 'ShieldCheck', title: 'Inhaber', hint: 'Alle Rechte, Benutzer und Rechte, Einstellungen, Protokoll' },
  { userId: IDS.users.nadine, icon: 'UserMinus', title: 'Aushilfe im Büro', hint: 'Ohne Rechnungsrecht: Rechnungen und Zahlungen werden nicht angeboten' },
  { userId: IDS.users.guenter, icon: 'Car', title: 'Vorbesitzer', hint: 'Hat den Octavia verkauft und sieht ihn nicht mehr' },
];

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'CalendarBlank', title: 'Termine und Kalender', text: 'Hebebühnen und Mitarbeiter, Konflikte werden angezeigt, Terminanfragen aus der App.' },
  { icon: 'ClipboardText', title: 'Digitale Annahme', text: 'km-Stand, Vorschäden, vereinbarte Arbeiten; der Kunde bestätigt vor Ort oder in der App.' },
  { icon: 'Handshake', title: 'Freigaben mit Nachweis', text: 'Jede Zusatzarbeit mit Fotos und Preis; der Kunde gibt genau diese Fassung frei.' },
  { icon: 'Wrench', title: 'Mechaniker-Ansicht', text: 'Große Tasten, keine Preise, Zeiterfassung und Feststellungen, auch offline.' },
  { icon: 'Receipt', title: 'Rechnung und Zahlung', text: 'Rechnung im Kundenzugang, online bezahlen; bezahlt erst nach Bestätigung des Anbieters.' },
  { icon: 'QrCode', title: 'Servicehistorie mit QR', text: 'Digitales Serviceheft je Fahrzeug, Fälligkeiten nach Zeit und km.' },
];

export default function PreviewScreen() {
  const t = useTheme();
  const { device } = useBreakpoint();
  const session = useSession();
  const toast = useToast();
  const { demo } = useDemo();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  if (!IS_DEMO || !demo) return <Redirect href={routes.root() as Href} />;
  const controls = demo.controls;

  const openAs = async (userId: string, path: string) => {
    setBusy(`${userId}:${path}`);
    try {
      await session.adopt(controls.loginAs(userId));
      router.push(path as Href);
    } catch {
      toast.show('Die Rolle konnte nicht geöffnet werden. Bitte die Beispieldaten zurücksetzen.', 'danger');
    } finally {
      setBusy(null);
    }
  };

  const openPublic = async (path: string) => {
    if (session.user) await session.signOut();
    router.push(path as Href);
  };

  const columns = device === 'desktop' ? 3 : device === 'tablet' ? 2 : 1;

  return (
    <PublicPage width={1120} testID="vorschau">
      <View style={styles.intro}>
        <AppText variant="display">
          Vorschau der Werkstattsoftware
        </AppText>
        <AppText tone="muted" style={styles.readable}>
          Hier sehen Sie alle Bereiche mit Beispieldaten: 12 Kunden, 16 Fahrzeuge und Aufträge in jedem Zustand. Wählen Sie eine Rolle. Alles, was Sie hier tun, bleibt in diesem Browser. Es gibt keine echten Kunden, Zahlungen oder Nachrichten.
        </AppText>
      </View>

      <View style={[styles.grid, { flexDirection: columns === 1 ? 'column' : 'row' }]}>
        {ROLES.map((role) => (
          <View key={role.key} style={[styles.roleCard, columns > 1 ? { flexBasis: `${100 / columns - 2}%`, flexGrow: 1 } : null, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radius.panel }]} testID={`vorschau-rolle-${role.key}`}>
            <View style={styles.roleHead}>
              <View style={[styles.roleIcon, { backgroundColor: t.colors.accentSoft, borderRadius: t.radius.control }]}>
                <Icon name={role.icon} size={iconSize.lg} color={t.colors.accent} />
              </View>
              <View style={styles.flex}>
                <AppText variant="heading">{role.title}</AppText>
                <AppText variant="small" tone="subtle">
                  {role.person}, {role.device}
                </AppText>
              </View>
            </View>
            <AppText tone="muted">{role.summary}</AppText>
            <Button label={role.cta} variant="primary" icon="ArrowRight" fullWidth loading={busy === `${role.userId}:${role.start}`} onPress={() => void openAs(role.userId, role.start)} testID={`vorschau-start-${role.key}`} />
            <AppText variant="small" tone="subtle" style={styles.label}>
              RUNDGANG
            </AppText>
            <ListGroup>
              {role.tours.map((tour, i) => (
                <ListRow key={tour.path} first={i === 0} title={tour.title} subtitle={tour.hint} onPress={() => void openAs(role.userId, tour.path)} testID={`vorschau-${role.key}-${i}`} />
              ))}
            </ListGroup>
          </View>
        ))}
      </View>

      <PublicPanel>
        <AppText variant="heading">Weitere Blickwinkel</AppText>
        <ListGroup>
          {MORE.map((m, i) => (
            <ListRow key={m.userId} first={i === 0} icon={m.icon} title={m.title} subtitle={m.hint} onPress={() => void openAs(m.userId, '/')} testID={`vorschau-weitere-${i}`} />
          ))}
          <ListRow icon="QrCode" title="QR-Code am Fahrzeug scannen" subtitle="Ohne Anmeldung: nur das, was der Halter freigegeben hat" onPress={() => void openPublic(`/q/${DEMO_TOKENS.qrGolf}`)} testID="vorschau-qr" />
        </ListGroup>
      </PublicPanel>

      <View style={styles.features}>
        <AppText variant="heading">Was die Software abdeckt</AppText>
        <View style={[styles.featureGrid, { flexDirection: columns === 1 ? 'column' : 'row' }]}>
          {FEATURES.map((f) => (
            <View key={f.title} style={[styles.feature, columns > 1 ? { flexBasis: `${100 / columns - 3}%`, flexGrow: 1 } : null]}>
              <Icon name={f.icon} size={iconSize.md} color={t.colors.accent} />
              <View style={styles.flex}>
                <AppText variant="bodyStrong">{f.title}</AppText>
                <AppText variant="small" tone="muted">
                  {f.text}
                </AppText>
              </View>
            </View>
          ))}
        </View>
      </View>

      <PublicPanel>
        <AppText variant="heading">Hinweise zur Vorschau</AppText>
        <AppText tone="muted" style={styles.readable}>
          Die fertige Software läuft als App auf iPhone und Android, als Programm unter Windows und im Browser, alle mit denselben Daten. Diese Vorschau läuft nur im Browser. Über "Demo-Steuerung" oben wechseln Sie jederzeit die Rolle, simulieren eine Zahlung oder schalten das Netz ab.
        </AppText>
        <View style={styles.actions}>
          <Button label="Beispieldaten zurücksetzen" icon="ArrowCounterClockwise" onPress={() => setConfirmReset(true)} testID="vorschau-zuruecksetzen" />
        </View>
      </PublicPanel>

      <ConfirmDialog
        visible={confirmReset}
        title="Beispieldaten zurücksetzen?"
        message="Alle Änderungen aus dieser Vorschau gehen verloren, die Beispieldaten beginnen neu."
        confirmLabel="Zurücksetzen"
        icon="ArrowCounterClockwise"
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          controls.reset();
          if (session.user) await session.signOut();
          invalidateAll();
          setConfirmReset(false);
          toast.show('Beispieldaten zurückgesetzt.');
        }}
        testID="vorschau-zuruecksetzen-dialog"
      />
    </PublicPage>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  readable: { maxWidth: 680 },
  grid: { gap: 16, flexWrap: 'wrap' },
  roleCard: { borderWidth: 1, padding: 20, gap: 14, minWidth: 0 },
  roleHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  roleIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  label: { letterSpacing: 0.8, marginTop: 4 },
  features: { gap: 12 },
  featureGrid: { gap: 16, flexWrap: 'wrap' },
  feature: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});
