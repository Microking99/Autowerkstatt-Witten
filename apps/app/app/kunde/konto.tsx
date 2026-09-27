/** Konto: Profil, Mitteilungen, Benachrichtigungen, Passwort, Gerät, Abmelden. */
import { PasswordSchema, routes, safeNextPath, type NotificationEvent } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSession } from '../../src/auth/session';
import type { NotificationPreference } from '../../src/data/api';
import { useApiMutation, useApiQuery } from '../../src/data/hooks';
import { formatRelativeTime } from '../../src/lib/format';
import { QueryView } from '../../src/screens/common';
import { useTheme } from '../../src/theme';
import { AppText, Banner, Button, Columns, KeyValueList, ListGroup, ListRow, Page, PageHeader, Section, SwitchRow, TextField, useToast } from '../../src/ui';

const eventLabels: Partial<Record<NotificationEvent, string>> = {
  'approval.requested': 'Freigabe erbeten oder Angebot geändert',
  'message.received': 'Neue Nachricht',
  'invoice.issued': 'Rechnung bereitgestellt',
  'payment.confirmed': 'Zahlung bestätigt',
  'appointment.confirmed': 'Termin bestätigt',
  'appointment.proposed': 'Terminvorschlag der Werkstatt',
  'work_order.ready_for_pickup': 'Fahrzeug abholbereit',
  'maintenance.due_soon': 'Wartung bald fällig',
};

export default function AccountScreen() {
  const t = useTheme();
  const toast = useToast();
  const { user, signOut } = useSession();
  const query = useApiQuery(`kunde:konto:${user?.id}`, async (api) => {
    const [customer, preferences, notifications] = await Promise.all([
      user?.customerId ? api.getCustomer(user.customerId) : Promise.resolve(null),
      api.getNotificationPreferences(),
      api.listNotifications(),
    ]);
    return { customer, preferences, notifications };
  });
  const [prefs, setPrefs] = useState<NotificationPreference[] | null>(null);
  useEffect(() => {
    if (query.data && prefs === null) setPrefs(query.data.preferences);
  }, [query.data, prefs]);
  const savePrefs = useApiMutation((api, list: NotificationPreference[]) => api.setNotificationPreferences(list));

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwSubmitted, setPwSubmitted] = useState(false);
  const changePw = useApiMutation((api) => api.changePassword({ currentPassword: current, newPassword: next }));
  const nextError = pwSubmitted && !PasswordSchema.safeParse(next).success ? 'Mindestens 10 Zeichen.' : null;

  const toggle = (eventType: NotificationEvent, channel: 'push' | 'email', enabled: boolean) =>
    setPrefs((list) => (list ?? []).map((p) => (p.eventType === eventType && p.channel === channel ? { ...p, enabled } : p)));

  return (
    <Page testID="kunde-konto">
      <PageHeader title="Konto" crumbs={[{ label: 'Start', href: routes.customer.home() as Href }, { label: 'Konto' }]} actions={<Button label="Abmelden" icon="SignOut" onPress={async () => { await signOut(); router.replace(routes.login() as Href); }} testID="abmelden" />} />
      <QueryView query={query} loading="detail">
        {({ customer, notifications }) => (
          <Columns ratio={[1, 1]}>
            <>
              <Section title="Profil">
                <KeyValueList
                  columns={1}
                  items={[
                    { label: 'Name', value: user?.displayName ?? '' },
                    { label: 'E-Mail-Adresse', value: user?.email ?? '' },
                    ...(customer ? [{ label: 'Kundennummer', value: customer.customerNumber, numeric: true }] : []),
                    ...(customer?.street ? [{ label: 'Anschrift', value: `${customer.street}, ${customer.postalCode ?? ''} ${customer.city ?? ''}` }] : []),
                    ...(customer?.mobile || customer?.phone ? [{ label: 'Telefon', value: customer.mobile ?? customer.phone ?? '' }] : []),
                  ]}
                />
                <AppText variant="small" tone="subtle">
                  Änderungen an Ihren Daten nimmt die Werkstatt für Sie vor. Schreiben Sie uns dazu in einem Auftrag oder rufen Sie an.
                </AppText>
              </Section>

              <Section title="Mitteilungen">
                {notifications.length === 0 ? (
                  <AppText tone="muted">Keine Mitteilungen.</AppText>
                ) : (
                  <ListGroup>
                    {notifications.slice(0, 6).map((n, i) => (
                      <ListRow
                        key={n.id}
                        first={i === 0}
                        icon="Bell"
                        title={n.title}
                        subtitle={n.body}
                        meta={`${formatRelativeTime(n.createdAt)}${n.readAt ? '' : ', neu'}`}
                        onPress={() => {
                          const target = safeNextPath(n.targetPath);
                          if (target) router.push(target as Href);
                        }}
                      />
                    ))}
                  </ListGroup>
                )}
              </Section>

              <Section title="Dieses Gerät">
                <AppText tone="muted">
                  {Platform.OS === 'web'
                    ? 'Browser: Die Anmeldung endet, wenn Sie diesen Tab schließen.'
                    : 'Die Anmeldung ist im geschützten Speicher dieses Geräts abgelegt. Mitteilungen erhalten Sie als Push-Benachrichtigung, wenn Sie es erlauben.'}
                </AppText>
              </Section>
            </>
            <>
              <Section title="Benachrichtigungen">
                <View style={[styles.box, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radius.panel }]}>
                  {[...new Set((prefs ?? []).map((p) => p.eventType))].map((eventType) => {
                    const push = prefs?.find((p) => p.eventType === eventType && p.channel === 'push');
                    const email = prefs?.find((p) => p.eventType === eventType && p.channel === 'email');
                    return (
                      <View key={eventType} style={[styles.pref, { borderBottomColor: t.colors.border }]}>
                        <AppText variant="bodyStrong">{eventLabels[eventType] ?? eventType}</AppText>
                        {push ? <SwitchRow label="App" value={push.enabled} onChange={(v) => toggle(eventType, 'push', v)} /> : null}
                        {email ? <SwitchRow label="E-Mail" value={email.enabled} onChange={(v) => toggle(eventType, 'email', v)} /> : null}
                      </View>
                    );
                  })}
                  {savePrefs.error ? <Banner tone="danger" message="Nicht gespeichert. Bitte versuchen Sie es erneut." /> : null}
                  <Button
                    label="Einstellungen speichern"
                    variant="primary"
                    loading={savePrefs.pending}
                    onPress={async () => {
                      try {
                        await savePrefs.mutate(prefs ?? []);
                        toast.show('Benachrichtigungen gespeichert.');
                      } catch {
                        // Hinweis oben
                      }
                    }}
                  />
                </View>
              </Section>

              <Section title="Passwort ändern">
                <View style={[styles.box, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radius.panel }]}>
                  {changePw.error ? <Banner tone="danger" message={changePw.error.isNetwork ? 'Keine Verbindung. Bitte versuchen Sie es erneut.' : changePw.error.message} /> : null}
                  <TextField label="Aktuelles Passwort" value={current} onChangeText={setCurrent} secure autoComplete="current-password" error={pwSubmitted && !current ? 'Bitte eingeben.' : null} />
                  <TextField label="Neues Passwort" value={next} onChangeText={setNext} secure autoComplete="new-password" help="Mindestens 10 Zeichen." error={nextError} />
                  <Button
                    label="Passwort ändern"
                    loading={changePw.pending}
                    onPress={async () => {
                      setPwSubmitted(true);
                      if (!current || !PasswordSchema.safeParse(next).success) return;
                      try {
                        await changePw.mutate();
                        setCurrent('');
                        setNext('');
                        setPwSubmitted(false);
                        toast.show('Passwort geändert.');
                      } catch {
                        // Hinweis oben
                      }
                    }}
                  />
                </View>
              </Section>
            </>
          </Columns>
        )}
      </QueryView>
    </Page>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, padding: 16, gap: 12 },
  pref: { borderBottomWidth: 1, paddingBottom: 8, gap: 0 },
});
