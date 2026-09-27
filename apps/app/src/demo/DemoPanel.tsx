/**
 * Demo-Steuerung (nur im Demo-Modus): Rolle wechseln, simulierte Mitteilungen,
 * Anbieterbestätigung simulieren, Werkstattaktionen auslösen, Verbindungsfehler/Offline,
 * Daten zurücksetzen. Alles wirkt nur auf die Beispieldaten im Speicher dieses Geräts.
 */
import { routes, safeNextPath } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../auth/session';
import { useApi } from '../data/ApiProvider';
import { isDemoApi } from '../data/createApi';
import type { DemoApi, ProviderOutcome } from '../data/demo/DemoApi';
import { toApiError } from '../data/errors';
import { invalidateAll } from '../data/invalidation';
import { formatMoney, formatRelativeTime } from '../lib/format';
import { useTheme } from '../theme';
import { AppText, Banner, Button, ConfirmDialog, Divider, ListGroup, ListRow, Sheet, SwitchRow, useToast } from '../ui';

interface DemoContextValue {
  demo: DemoApi | null;
  openPanel: () => void;
}

const DemoContext = createContext<DemoContextValue>({ demo: null, openPanel: () => undefined });

export function useDemo() {
  return useContext(DemoContext);
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const demo = isDemoApi(api) ? api : null;
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ demo, openPanel: () => setOpen(true) }), [demo]);
  return (
    <DemoContext.Provider value={value}>
      {children}
      {demo ? <DemoPanel demo={demo} visible={open} onClose={() => setOpen(false)} /> : null}
    </DemoContext.Provider>
  );
}

function useDemoVersion(demo: DemoApi) {
  const [version, setVersion] = useState(0);
  useEffect(() => demo.controls.subscribe(() => setVersion((v) => v + 1)), [demo]);
  return version;
}

const OUTCOMES: { outcome: ProviderOutcome; label: string }[] = [
  { outcome: 'paid', label: 'Bezahlt bestätigen' },
  { outcome: 'duplicate', label: 'Doppelt melden' },
  { outcome: 'cancelled', label: 'Abgebrochen' },
  { outcome: 'failed', label: 'Fehlgeschlagen' },
  { outcome: 'mismatch', label: 'Betrag weicht ab' },
];

function DemoPanel({ demo, visible, onClose }: { demo: DemoApi; visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const session = useSession();
  const toast = useToast();
  useDemoVersion(demo);
  const [confirmReset, setConfirmReset] = useState(false);
  const c = demo.controls;

  const run = useCallback(
    (fn: () => string | void, closeAfter = false, refresh = true) => {
      try {
        const message = fn();
        // refresh=false: Änderung "auf einem anderen Gerät" (die offene Ansicht bleibt veraltet)
        if (refresh) invalidateAll();
        if (message) toast.show(message, 'info');
        if (closeAfter) onClose();
      } catch (e) {
        toast.show(toApiError(e).message, 'danger');
      }
    },
    [onClose, toast],
  );

  const go = (path: string) => {
    const safe = safeNextPath(path);
    onClose();
    if (safe) router.push(safe as Href);
  };

  const notifications = c.notificationsFor(session.user?.id ?? null);
  const checkouts = c.pendingCheckouts();
  const requests = c.openAppointmentRequests();
  const approvals = c.pendingApprovals();
  const orders = c.activeWorkOrders();

  return (
    <>
      <Sheet visible={visible} onClose={onClose} title="Demo-Steuerung" width={640} testID="demo-steuerung">
        <Banner tone="warning" message="Nur für den klickbaren Entwurf. Alle Aktionen wirken auf Beispieldaten in diesem Browser bzw. auf diesem Gerät." />

        <Block title="Rolle wechseln">
          <View style={styles.wrap}>
            {c.accounts().map((a) => (
              <Button
                key={a.key}
                label={a.label}
                variant={session.user?.id === a.userId ? 'primary' : 'secondary'}
                accessibilityLabel={`Als ${a.label} anmelden (${a.displayName})`}
                testID={`rolle-${a.key}`}
                onPress={async () => {
                  const res = c.loginAs(a.userId);
                  await session.adopt(res);
                  onClose();
                  router.replace(routes.root() as Href);
                }}
              />
            ))}
            {session.user ? (
              <Button
                label="Abmelden"
                variant="quiet"
                icon="SignOut"
                onPress={async () => {
                  await session.signOut();
                  onClose();
                  router.replace(routes.login() as Href);
                }}
              />
            ) : null}
          </View>
          <AppText variant="small" tone="subtle">
            Angemeldet: {session.user ? `${session.user.displayName}` : 'niemand'}
          </AppText>
        </Block>

        <Block title={`Mitteilungen an ${notifications.recipient}`} hint="Simulierte Push-Benachrichtigungen. Tippen öffnet das Ziel; ohne Anmeldung führt der Weg über die Anmeldung zum Vorgang.">
          {notifications.items.length === 0 ? (
            <AppText tone="muted">Keine Mitteilungen.</AppText>
          ) : (
            <ListGroup>
              {notifications.items.slice(0, 6).map((n, i) => (
                <ListRow key={n.id} first={i === 0} icon="Bell" title={n.title} subtitle={n.body} meta={formatRelativeTime(n.createdAt)} onPress={() => go(n.targetPath)} testID={`mitteilung-${i}`} />
              ))}
            </ListGroup>
          )}
        </Block>

        <Block title="Zahlungsanbieter (simuliert)" hint="Erst die serverseitig geprüfte Bestätigung setzt eine Rechnung auf Bezahlt.">
          {checkouts.length === 0 ? (
            <AppText tone="muted">Keine offenen Zahlungsversuche. Starten Sie in einer Rechnung "Jetzt bezahlen".</AppText>
          ) : (
            checkouts.map((co) => (
              <View key={co.checkoutId} style={[styles.item, { borderColor: t.colors.border, borderRadius: t.radius.panel }]}>
                <AppText variant="bodyStrong">
                  {co.invoiceNumber}, {co.customerDisplayName}
                </AppText>
                <AppText tone="muted" numeric>
                  {formatMoney(co.amountCents)}
                  {co.customerSubmitted ? ', auf der Anbieterseite abgeschickt' : ', noch nicht abgeschickt'}
                </AppText>
                <View style={styles.wrap}>
                  {OUTCOMES.map((o) => (
                    <Button key={o.outcome} label={o.label} variant={o.outcome === 'paid' ? 'primary' : 'secondary'} testID={`anbieter-${o.outcome}`} onPress={() => run(() => c.simulateProvider(co.checkoutId, o.outcome))} />
                  ))}
                </View>
              </View>
            ))
          )}
        </Block>

        <Block title="Werkstatt (simuliert)">
          {requests.map((r) => (
            <View key={r.id} style={[styles.item, { borderColor: t.colors.border, borderRadius: t.radius.panel }]}>
              <AppText variant="bodyStrong">Terminanfrage: {r.label}</AppText>
              <View style={styles.wrap}>
                <Button label="Termin bestätigen" testID={`werkstatt-termin-bestaetigen-${r.id}`} onPress={() => run(() => c.workshopConfirmAppointment(r.id))} />
                <Button label="Alternative vorschlagen" testID={`werkstatt-termin-alternative-${r.id}`} onPress={() => run(() => c.workshopProposeAlternative(r.id))} />
              </View>
            </View>
          ))}
          {approvals.map((a) => (
            <View key={a.id} style={[styles.item, { borderColor: t.colors.border, borderRadius: t.radius.panel }]}>
              <AppText variant="bodyStrong">
                Freigabe: {a.label} (Version {a.versionNo})
              </AppText>
              <AppText variant="small" tone="subtle">
                Wirkt wie eine Änderung durch die Werkstatt an einem anderen Gerät: Eine geöffnete Entscheidungsansicht zeigt noch die alte Version.
              </AppText>
              <Button label="Angebot ändern (neue Version)" testID={`werkstatt-neue-version-${a.id}`} onPress={() => run(() => c.workshopReviseApproval(a.id), false, false)} />
            </View>
          ))}
          {orders.map((o) => (
            <View key={o.id} style={[styles.item, { borderColor: t.colors.border, borderRadius: t.radius.panel }]}>
              <AppText variant="bodyStrong">
                {o.label}, {o.customer}
              </AppText>
              <View style={styles.wrap}>
                <Button label="Im Chat antworten" testID={`werkstatt-antwort-${o.id}`} onPress={() => run(() => c.workshopReply(o.id))} />
                <Button label="Auftrag abschließen" testID={`werkstatt-abschliessen-${o.id}`} onPress={() => run(() => c.workshopCompleteOrder(o.id))} />
              </View>
            </View>
          ))}
        </Block>

        <Block title="Verbindung">
          <SwitchRow testID="demo-fehler" label="Nächste Anfrage schlägt fehl" description="Simuliert einen Verbindungsabbruch bei der nächsten Anfrage." value={c.isFailNext()} onChange={(v) => c.setFailNext(v)} />
          <SwitchRow testID="demo-offline" label="Offline" description="Alle Anfragen schlagen fehl, bis Sie wieder einschalten." value={c.isOffline()} onChange={(v) => c.setOffline(v)} />
        </Block>

        <Divider />
        <Button label="Daten zurücksetzen" variant="destructive" icon="ArrowCounterClockwise" onPress={() => setConfirmReset(true)} />
      </Sheet>
      <ConfirmDialog
        visible={confirmReset}
        title="Alle Beispieldaten zurücksetzen?"
        message="Alle Änderungen dieser Demo gehen verloren. Sie bleiben angemeldet."
        confirmLabel="Zurücksetzen"
        tone="destructive"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          run(() => {
            c.reset();
            return 'Beispieldaten wurden zurückgesetzt.';
          }, true);
        }}
      />
    </>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <AppText variant="heading">{title}</AppText>
      {hint ? (
        <AppText variant="small" tone="subtle">
          {hint}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: { borderWidth: 1, padding: 12, gap: 8 },
});
