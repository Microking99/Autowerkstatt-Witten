/**
 * Konto für Mitarbeiter (Werkstatt und Mechaniker): Profil, eigene Rechte, Passwort ändern,
 * Abmelden. In der Mechanikeransicht warnt das Abmelden vor nicht übertragenen Einträgen.
 */
import { PasswordSchema, permissionLabels, roleLabels, routes } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useSession } from '../auth/session';
import { useApiMutation } from '../data/hooks';
import { AppText, Banner, Button, Columns, ConfirmDialog, KeyValueList, Page, PageHeader, Section, TextField, useToast } from '../ui';

export function StaffAccount({ home, homeLabel, unsynced = 0, extra, testID }: { home: string; homeLabel: string; unsynced?: number; extra?: ReactNode; testID?: string }) {
  const toast = useToast();
  const { user, signOut } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const change = useApiMutation((api) => api.changePassword({ currentPassword: current, newPassword: next }));
  const nextError = submitted && !PasswordSchema.safeParse(next).success ? 'Mindestens 10 Zeichen.' : null;
  async function out() {
    await signOut();
    router.replace(routes.login() as Href);
  }
  return (
    <Page maxWidth={960} testID={testID}>
      <PageHeader
        title="Konto"
        crumbs={[{ label: homeLabel, href: home as Href }, { label: 'Konto' }]}
        actions={<Button label="Abmelden" icon="SignOut" onPress={() => (unsynced > 0 ? setConfirmOut(true) : void out())} testID="abmelden" />}
      />
      {extra}
      <Columns ratio={[1, 1]}>
        <Section title="Profil">
          <KeyValueList
            columns={1}
            items={[
              { label: 'Name', value: user?.displayName ?? '' },
              { label: 'E-Mail-Adresse', value: user?.email ?? '' },
              { label: 'Rolle', value: user ? roleLabels[user.role] : '' },
              { label: 'Rechte', value: user ? user.permissions.map((p) => permissionLabels[p]).join(', ') : '' },
            ]}
          />
          <AppText variant="small" tone="subtle">Rolle und Rechte ändert der Inhaber unter Benutzer.</AppText>
        </Section>
        <Section title="Passwort ändern">
          <TextField label="Aktuelles Passwort" value={current} onChangeText={setCurrent} secure autoComplete="current-password" />
          <TextField label="Neues Passwort" value={next} onChangeText={setNext} secure autoComplete="new-password" error={nextError} help="Mindestens 10 Zeichen. Andere Sitzungen werden danach abgemeldet." />
          {change.error ? <Banner tone="danger" message={change.error.message} /> : null}
          <Button
            label="Passwort ändern"
            variant="primary"
            loading={change.pending}
            disabled={!current || !next}
            onPress={async () => {
              setSubmitted(true);
              if (!PasswordSchema.safeParse(next).success) return;
              try {
                await change.mutate();
                setCurrent('');
                setNext('');
                setSubmitted(false);
                toast.show('Passwort geändert.');
              } catch {
                // Fehler oben
              }
            }}
          />
        </Section>
      </Columns>
      <ConfirmDialog
        visible={confirmOut}
        title="Trotzdem abmelden?"
        message={`${unsynced} ${unsynced === 1 ? 'Eintrag ist' : 'Einträge sind'} noch nicht übertragen. Sie bleiben auf diesem Gerät gespeichert und werden nach der nächsten Anmeldung mit diesem Konto übertragen.`}
        confirmLabel="Abmelden"
        onCancel={() => setConfirmOut(false)}
        onConfirm={() => void out()}
      />
    </Page>
  );
}
