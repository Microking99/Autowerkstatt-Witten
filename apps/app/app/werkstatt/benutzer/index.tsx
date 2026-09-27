/**
 * Werkstatt, Benutzer (nur mit users.manage): Mitarbeiter mit Rolle, Status und
 * Rechteabweichungen vom Rollenstandard. Einladen; Zeile → Detail.
 */
import { roleLabels, routes, type Role } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useApiMutation, useApiQuery } from '../../../src/data/hooks';
import { formatDateTime } from '../../../src/lib/format';
import { NotAvailableView, QueryView } from '../../../src/screens/common';
import { ActionError, useCan, userStatusLabels } from '../../../src/screens/workshop/shared';
import { AppText, Banner, Button, DataTable, Page, PageHeader, Row, Select, Sheet, StatusChip, TextField, useSaveShortcut, useToast } from '../../../src/ui';

export default function UserList() {
  const can = useCan();
  const toast = useToast();
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Exclude<Role, 'customer'>>('mechanic');
  const list = useApiQuery(can('users.manage') ? 'werkstatt:benutzer' : null, (a) => a.listUsers());
  const send = useApiMutation((a) => a.inviteUser({ email: email.trim(), displayName: name.trim(), role }));
  const valid = /^\S+@\S+\.\S+$/.test(email.trim()) && !!name.trim();
  async function submit() {
    if (!valid) return;
    try {
      const u = await send.mutate();
      setInvite(false);
      setEmail('');
      setName('');
      toast.show(`Einladung an ${u.email} gesendet.`);
    } catch {
      // Fehler im Blatt
    }
  }
  useSaveShortcut(() => void submit(), invite, 'dialog');
  if (!can('users.manage')) return <Page><NotAvailableView title="Nur für Inhaber bzw. Mitarbeiter mit Benutzerverwaltung" /></Page>;
  return (
    <Page maxWidth={1120} testID="werkstatt-benutzer">
      <PageHeader
        title="Benutzer"
        subtitle="Mitarbeiterkonten. Rechte folgen der Rolle; Abweichungen sind markiert."
        crumbs={[{ label: 'Übersicht', href: routes.workshop.home() as Href }, { label: 'Benutzer' }]}
        actions={<Button label="Mitarbeiter einladen" variant="primary" icon="UserPlus" onPress={() => setInvite(true)} testID="benutzer-einladen" />}
      />
      <QueryView query={list}>
        {(users) => (
          <DataTable
            label="Mitarbeiter"
            keyboardNav
            rows={users}
            rowKey={(u) => u.id}
            rowTestID={(u) => `benutzer-${u.email}`}
            onRowPress={(u) => router.push(routes.workshop.user(u.id) as Href)}
            mobileTitle={(u) => u.displayName}
            mobileSubtitle={(u) => `${roleLabels[u.role]}, ${userStatusLabels[u.status].label}`}
            mobileMeta={(u) => (u.permissionOverrides.length ? `${u.permissionOverrides.length} Abweichung(en) vom Rollenstandard` : null)}
            columns={[
              { key: 'name', header: 'Name', render: (u) => <View><AppText variant="bodyStrong">{u.displayName}</AppText><AppText variant="small" tone="muted">{u.email}</AppText></View>, sortValue: (u) => u.displayName, flex: 2 },
              { key: 'rolle', header: 'Rolle', render: (u) => <AppText>{roleLabels[u.role]}</AppText>, sortValue: (u) => u.role, flex: 1.2 },
              { key: 'status', header: 'Status', render: (u) => <StatusChip status={userStatusLabels[u.status]} />, sortValue: (u) => u.status, flex: 1 },
              {
                key: 'rechte',
                header: 'Rechte',
                render: (u) =>
                  u.permissionOverrides.length ? (
                    <StatusChip status={{ label: `${u.permissionOverrides.length} ${u.permissionOverrides.length === 1 ? 'Abweichung' : 'Abweichungen'}`, tone: 'warning', icon: 'ShieldWarning' }} />
                  ) : (
                    <AppText variant="small" tone="muted">Rollenstandard</AppText>
                  ),
                flex: 1.3,
              },
              { key: 'login', header: 'Letzte Anmeldung', render: (u) => <AppText variant="small" numeric>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'noch nie'}</AppText>, sortValue: (u) => u.lastLoginAt ?? '', flex: 1.3 },
            ]}
          />
        )}
      </QueryView>
      <Sheet
        visible={invite}
        onClose={() => setInvite(false)}
        title="Mitarbeiter einladen"
        footer={
          <>
            <Button label="Abbrechen" onPress={() => setInvite(false)} />
            <Button label="Einladung senden" variant="primary" disabled={!valid} loading={send.pending} onPress={() => void submit()} testID="einladung-senden" />
          </>
        }
      >
        <TextField label="Name" value={name} onChangeText={setName} required />
        <TextField label="E-Mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" required />
        <Select label="Rolle" value={role} onChange={setRole} options={(['mechanic', 'service', 'admin'] as const).map((r) => ({ value: r, label: roleLabels[r] }))} />
        <Banner tone="info" message="Die Person erhält einen Link (7 Tage gültig) und legt selbst ein Passwort fest. Rechte richten sich nach der Rolle; Abweichungen stellen Sie danach im Detail ein." />
        <ActionError error={send.error} />
      </Sheet>
      <Row>
        <AppText variant="small" tone="subtle">Mindestens ein aktiver Inhaber mit Benutzerverwaltung bleibt immer erhalten.</AppText>
      </Row>
    </Page>
  );
}
