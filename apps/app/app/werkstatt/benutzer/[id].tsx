/**
 * Werkstatt, Benutzerdetail: Name, Rolle, Rechte (Standard der Rolle aus @werkstatt/domain;
 * Abweichungen hervorgehoben), Status. Speichern; Deaktivieren bzw. Aktivieren mit
 * Bestätigung. Der letzte aktive Inhaber mit Benutzerverwaltung ist geschützt (API).
 */
import { PERMISSIONS, permissionLabels, roleLabels, routes, type Permission, type StaffUser } from '@werkstatt/contracts';
import { PERMISSION_MATRIX, effectivePermissions, type StaffRole } from '@werkstatt/domain';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../../../src/auth/session';
import { useApiMutation, useApiQuery } from '../../../src/data/hooks';
import { formatDateTime } from '../../../src/lib/format';
import { NotAvailableView, QueryView } from '../../../src/screens/common';
import { ActionError, useCan, userStatusLabels } from '../../../src/screens/workshop/shared';
import { useTheme } from '../../../src/theme';
import { AppText, Banner, Button, Checkbox, ConfirmDialog, Page, PageHeader, Row, Section, Select, StatusChip, TextField, useSaveShortcut, useToast } from '../../../src/ui';

const GROUPS: { title: string; prefixes: string[] }[] = [
  { title: 'Kunden und Fahrzeuge', prefixes: ['customers', 'customerAccounts', 'vehicles'] },
  { title: 'Termine und Aufträge', prefixes: ['dashboard', 'appointments', 'workOrders', 'workItems', 'intake', 'findings', 'approvals', 'messages'] },
  { title: 'Dokumente und Servicehistorie', prefixes: ['documents', 'serviceHistory'] },
  { title: 'Rechnungen und Zahlungen', prefixes: ['invoices', 'payments'] },
  { title: 'Verwaltung', prefixes: ['reports', 'users', 'settings', 'audit'] },
];

export default function UserDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const can = useCan();
  const query = useApiQuery(can('users.manage') ? `werkstatt:benutzer:${id}` : null, (a) => a.getUser(String(id)));
  if (!can('users.manage')) return <Page><NotAvailableView /></Page>;
  return (
    <Page maxWidth={960} testID="werkstatt-benutzer-detail">
      <PageHeader
        title={query.data?.displayName ?? 'Mitarbeiter'}
        subtitle={query.data ? `${query.data.email}, ${roleLabels[query.data.role]}` : undefined}
        backHref={routes.workshop.users() as Href}
        backLabel="Benutzer"
        crumbs={[{ label: 'Benutzer', href: routes.workshop.users() as Href }, { label: query.data?.displayName ?? 'Mitarbeiter' }]}
        meta={query.data ? <StatusChip status={userStatusLabels[query.data.status]} /> : null}
      />
      <QueryView query={query} loading="detail" notAvailableTitle="Mitarbeiter nicht verfügbar">
        {(u) => <UserForm user={u} />}
      </QueryView>
    </Page>
  );
}

function UserForm({ user }: { user: StaffUser }) {
  const t = useTheme();
  const toast = useToast();
  const { user: me } = useSession();
  const [name, setName] = useState(user.displayName);
  const [role, setRole] = useState<StaffRole>(user.role as StaffRole);
  const [granted, setGranted] = useState<Set<Permission>>(new Set(user.effectivePermissions));
  const [dialog, setDialog] = useState<'disable' | 'enable' | 'save' | null>(null);
  useEffect(() => {
    setName(user.displayName);
    setRole(user.role as StaffRole);
    setGranted(new Set(user.effectivePermissions));
  }, [user]);
  const defaults = useMemo(() => effectivePermissions(role, []), [role]);
  const overrides = PERMISSIONS.filter((p) => PERMISSION_MATRIX[p][role] !== 'never' && granted.has(p) !== defaults.has(p)).map((p) => ({ permission: p, granted: granted.has(p) }));
  const save = useApiMutation((a) => a.updateUser(user.id, { displayName: name.trim(), role, permissionOverrides: overrides }));
  const disable = useApiMutation((a) => a.disableUser(user.id));
  const enable = useApiMutation((a) => a.enableUser(user.id));
  const dirty = name.trim() !== user.displayName || role !== user.role || overrides.length !== user.permissionOverrides.length || overrides.some((o) => !user.permissionOverrides.some((x) => x.permission === o.permission && x.granted === o.granted));
  const self = me?.id === user.id;

  function changeRole(r: StaffRole) {
    setRole(r);
    // Beim Rollenwechsel mit dem Standard der neuen Rolle beginnen
    setGranted(new Set(effectivePermissions(r, [])));
  }

  async function doSave() {
    try {
      await save.mutate();
      setDialog(null);
      toast.show('Gespeichert.');
    } catch {
      setDialog(null);
    }
  }
  useSaveShortcut(() => dirty && setDialog('save'));

  return (
    <>
      <Section title="Konto">
        <TextField label="Name" value={name} onChangeText={setName} required />
        <Select label="Rolle" value={role} onChange={changeRole} options={(['mechanic', 'service', 'admin'] as const).map((r) => ({ value: r, label: roleLabels[r] }))} help="Beim Wechsel der Rolle gelten zunächst deren Standardrechte." />
        <AppText variant="small" tone="subtle" numeric>
          Letzte Anmeldung: {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'noch nie'}, angelegt {formatDateTime(user.createdAt)}
        </AppText>
      </Section>
      <Section title={`Rechte${overrides.length ? ` (${overrides.length} ${overrides.length === 1 ? 'Abweichung' : 'Abweichungen'} vom Standard)` : ''}`}>
        <Banner tone="info" message="Rechte gelten serverseitig. Markiert sind Abweichungen vom Standard der Rolle. Nicht zulässige Rechte (zum Beispiel Preise für Mechaniker) sind gesperrt." />
        {GROUPS.map((g) => (
          <View key={g.title} style={[styles.group, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]}>
            <AppText variant="bodyStrong">{g.title}</AppText>
            {PERMISSIONS.filter((p) => g.prefixes.includes(p.split('.')[0]!)).map((p) => {
              const cell = PERMISSION_MATRIX[p][role];
              const deviates = cell !== 'never' && granted.has(p) !== defaults.has(p);
              return (
                <View key={p} style={[styles.perm, deviates ? { backgroundColor: t.colors.warningSoft, borderRadius: t.radius.control } : null]} testID={`recht-${p}`}>
                  {cell === 'never' ? (
                    <Row gap={12} style={styles.never}>
                      <StatusChip status={{ label: 'Für diese Rolle nicht möglich', tone: 'neutral', icon: 'Prohibit' }} />
                      <AppText tone="muted" style={styles.flex}>{permissionLabels[p]}</AppText>
                    </Row>
                  ) : (
                    <Checkbox
                      label={permissionLabels[p]}
                      description={deviates ? (granted.has(p) ? 'Abweichung: zusätzlich erteilt' : 'Abweichung: entzogen') : cell === 'default' ? 'Standard der Rolle' : 'Nur auf Wunsch'}
                      checked={granted.has(p)}
                      onChange={(v) =>
                        setGranted((s) => {
                          const next = new Set(s);
                          if (v) next.add(p);
                          else next.delete(p);
                          return next;
                        })
                      }
                    />
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </Section>
      <ActionError error={save.error} />
      <Row wrap>
        <Button label="Speichern" variant="primary" icon="Check" disabled={!dirty || !name.trim()} loading={save.pending} onPress={() => setDialog('save')} testID="benutzer-speichern" />
        {user.status !== 'disabled' ? <Button label="Deaktivieren" icon="UserMinus" onPress={() => setDialog('disable')} disabled={self} testID="benutzer-deaktivieren" /> : <Button label="Wieder aktivieren" icon="LockOpen" onPress={() => setDialog('enable')} testID="benutzer-aktivieren" />}
      </Row>
      {self ? <AppText variant="small" tone="subtle">Das eigene Konto kann hier nicht deaktiviert werden.</AppText> : null}
      <ActionError error={disable.error ?? enable.error} title="Nicht geändert" />
      <ConfirmDialog
        visible={dialog === 'save'}
        title="Rechte und Rolle speichern?"
        message={overrides.length ? `${overrides.length} ${overrides.length === 1 ? 'Recht weicht' : 'Rechte weichen'} vom Standard der Rolle ab. Die Änderung wirkt sofort und wird protokolliert.` : 'Es gelten die Standardrechte der Rolle. Die Änderung wirkt sofort.'}
        confirmLabel="Speichern"
        loading={save.pending}
        onCancel={() => setDialog(null)}
        onConfirm={() => void doSave()}
      />
      <ConfirmDialog
        visible={dialog === 'disable'}
        title={`${user.displayName} deaktivieren?`}
        message="Die Person wird sofort abgemeldet und kann sich nicht mehr anmelden. Zuweisungen bleiben sichtbar, Daten bleiben erhalten."
        confirmLabel="Deaktivieren"
        tone="destructive"
        loading={disable.pending}
        onCancel={() => setDialog(null)}
        testID="deaktivieren-dialog"
        onConfirm={async () => {
          try {
            await disable.mutate();
            setDialog(null);
            toast.show('Konto deaktiviert.');
          } catch {
            setDialog(null);
          }
        }}
      />
      <ConfirmDialog
        visible={dialog === 'enable'}
        title={`${user.displayName} wieder aktivieren?`}
        message="Die Person kann sich danach wieder anmelden."
        confirmLabel="Aktivieren"
        loading={enable.pending}
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          try {
            await enable.mutate();
            setDialog(null);
            toast.show('Konto aktiviert.');
          } catch {
            setDialog(null);
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  group: { borderWidth: 1, padding: 12, gap: 2 },
  perm: { paddingHorizontal: 8 },
  never: { minHeight: 48, alignItems: 'center', flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 160 },
});
