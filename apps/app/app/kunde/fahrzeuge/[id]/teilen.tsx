/**
 * Freigaben für Dritte (z. B. Kaufinteressenten): Einträge wählen, Ablauf, FIN ja/nein →
 * Link teilen. Widerrufen mit Bestätigung. Der Link wird nur direkt nach dem Anlegen angezeigt.
 */
import { routes, type VehicleShare } from '@werkstatt/contracts';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';
import { useApiMutation, useApiQuery } from '../../../../src/data/hooks';
import { useIsOffline } from '../../../../src/data/network';
import { keepPlates, formatDate, formatDateTime, formatKm } from '../../../../src/lib/format';
import { QueryView } from '../../../../src/screens/common';
import { useTheme } from '../../../../src/theme';
import {
  AppText,
  Banner,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DateTimeField,
  EmptyState,
  Page,
  PageHeader,
  Row,
  Section,
  StatusChip,
  SwitchRow,
  TextField,
  useToast,
} from '../../../../src/ui';

function shareState(s: VehicleShare): { label: string; tone: 'success' | 'neutral' | 'danger'; icon: string } {
  if (s.revokedAt) return { label: 'Widerrufen', tone: 'neutral', icon: 'Prohibit' };
  if (Date.parse(s.expiresAt) <= Date.now()) return { label: 'Abgelaufen', tone: 'neutral', icon: 'Clock' };
  return { label: 'Aktiv', tone: 'success', icon: 'CheckCircle' };
}

function inDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  return d;
}

export default function SharesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicleId = String(id);
  const t = useTheme();
  const toast = useToast();
  const offline = useIsOffline();
  const query = useApiQuery(`kunde:freigaben:${vehicleId}`, async (api) => {
    const [vehicle, entries, shares] = await Promise.all([api.getVehicle(vehicleId), api.listServiceEntries(vehicleId), api.listShares(vehicleId)]);
    return { vehicle, entries, shares };
  });
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<string[] | null>(null);
  const [expires, setExpires] = useState<Date>(inDays(14));
  const [includeVin, setIncludeVin] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [revoke, setRevoke] = useState<VehicleShare | null>(null);
  const [created, setCreated] = useState<VehicleShare | null>(null);
  const create = useApiMutation((api) =>
    api.createShare(vehicleId, { label: label.trim(), serviceEntryIds: selected ?? (query.data?.entries ?? []).map((e) => e.id), includeVin, expiresAt: expires.toISOString() }),
  );
  const revokeMutation = useApiMutation((api, shareId: string) => api.revokeShare(shareId));

  const entries = query.data?.entries ?? [];
  const chosen = selected ?? entries.map((e) => e.id);
  const labelError = submitted && !label.trim() ? 'Bitte geben Sie eine Bezeichnung ein, zum Beispiel den Namen des Interessenten.' : null;
  const entriesError = submitted && chosen.length === 0 ? 'Bitte wählen Sie mindestens einen Eintrag aus.' : null;
  const maxDate = inDays(90);
  const expiresError = submitted && (expires.getTime() <= Date.now() || expires.getTime() > maxDate.getTime()) ? 'Das Ablaufdatum muss in den nächsten 90 Tagen liegen.' : null;
  const title = query.data ? `${query.data.vehicle.make} ${query.data.vehicle.model}` : 'Fahrzeug';

  const copy = async (url: string) => {
    await Clipboard.setStringAsync(url);
    toast.show('Link kopiert.');
  };

  return (
    <Page testID="kunde-teilen">
      <PageHeader
        title="Fahrzeug teilen"
        subtitle={query.data ? `${title}, ${keepPlates(query.data.vehicle.licensePlate)}` : undefined}
        backHref={routes.customer.vehicle(vehicleId) as Href}
        backLabel={title}
        crumbs={[
          { label: 'Fahrzeuge', href: routes.customer.vehicles() as Href },
          { label: title, href: routes.customer.vehicle(vehicleId) as Href },
          { label: 'Teilen' },
        ]}
      />
      <QueryView query={query} loading="detail">
        {({ shares }) => (
          <>
            <AppText tone="muted">
              Mit einer Freigabe sehen zum Beispiel Kaufinteressenten ausgewählte Wartungsnachweise dieses Fahrzeugs, ohne Konto. Namen, Rechnungen, Preise und Nachrichten sind nie enthalten. Sie können jede Freigabe jederzeit widerrufen.
            </AppText>

            {created?.shareUrl ? (
              <Banner
                tone="success"
                title="Freigabe erstellt"
                message={`Dieser Link wird nur jetzt angezeigt. Bitte kopieren oder teilen Sie ihn: ${created.shareUrl}`}
                testID="freigabe-link"
                action={
                  <>
                    <Button label="Link kopieren" icon="Copy" variant="primary" onPress={() => void copy(created.shareUrl!)} />
                    {Platform.OS !== 'web' ? <Button label="Teilen" icon="ShareNetwork" onPress={() => void Share.share({ message: created.shareUrl! })} /> : null}
                  </>
                }
              />
            ) : null}

            <Section title="Bestehende Freigaben" testID="bestehende-freigaben">
              {shares.length === 0 ? (
                <AppText tone="muted">Noch keine Freigaben.</AppText>
              ) : (
                shares.map((s) => {
                  const st = shareState(s);
                  return (
                    <Card key={s.id} testID={`freigabe-${s.id}`}>
                      <Row wrap style={styles.between}>
                        <AppText variant="heading" style={styles.flex}>
                          {s.label}
                        </AppText>
                        <StatusChip status={{ label: st.label, tone: st.tone, icon: st.icon }} />
                      </Row>
                      <AppText tone="muted" numeric>
                        {s.serviceEntryIds.length === 1 ? '1 Eintrag' : `${s.serviceEntryIds.length} Einträge`}, {s.includeVin ? 'mit FIN' : 'ohne FIN'}, gültig bis {formatDate(s.expiresAt)}
                      </AppText>
                      <AppText variant="small" tone="subtle" numeric>
                        {s.accessCount === 1 ? '1 Abruf' : `${s.accessCount} Abrufe`}
                        {s.lastAccessedAt ? `, zuletzt ${formatDateTime(s.lastAccessedAt)}` : ''}
                        {s.revokedAt ? `, widerrufen am ${formatDate(s.revokedAt)}` : ''}
                      </AppText>
                      {st.label === 'Aktiv' ? (
                        <Button label="Widerrufen" variant="destructive" icon="Prohibit" onPress={() => setRevoke(s)} disabled={offline} testID={`widerrufen-${s.id}`} />
                      ) : null}
                    </Card>
                  );
                })
              )}
            </Section>

            <Section title="Neue Freigabe">
              {entries.length === 0 ? (
                <EmptyState icon="ClockCounterClockwise" title="Keine Einträge zum Teilen" message="Sobald Wartungen in der Servicehistorie stehen, können Sie sie hier freigeben." />
              ) : (
                <View style={[styles.form, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radius.panel }]}>
                  <TextField label="Bezeichnung" value={label} onChangeText={setLabel} error={labelError} help="Nur für Sie sichtbar, damit Sie Freigaben unterscheiden können." required testID="freigabe-bezeichnung" />
                  <View style={styles.checks} accessibilityRole="list">
                    <AppText variant="caption" tone="muted">
                      Einträge
                    </AppText>
                    {entries.map((e) => (
                      <Checkbox
                        key={e.id}
                        label={`${e.title}, ${formatDate(e.performedOn)}`}
                        description={formatKm(e.odometerKm)}
                        checked={chosen.includes(e.id)}
                        onChange={(on) => setSelected(on ? [...chosen, e.id] : chosen.filter((x) => x !== e.id))}
                      />
                    ))}
                    {entriesError ? (
                      <AppText variant="small" tone="danger" role="alert">
                        {entriesError}
                      </AppText>
                    ) : null}
                  </View>
                  <DateTimeField label="Gültig bis" mode="date" value={expires} onChange={setExpires} minimumDate={inDays(1)} maximumDate={maxDate} help="Höchstens 90 Tage." error={expiresError} required testID="freigabe-ablauf" />
                  <SwitchRow label="FIN anzeigen" description="Die Fahrzeug-Identifizierungsnummer hilft Käufern bei der Prüfung." value={includeVin} onChange={setIncludeVin} />
                  {create.error ? <Banner tone="danger" title="Nicht erstellt" message={create.error.isNetwork ? 'Keine Verbindung. Bitte versuchen Sie es erneut.' : create.error.message} /> : null}
                  {offline ? <Banner tone="info" message="Ohne Verbindung können keine Freigaben erstellt werden." /> : null}
                  <Button
                    label="Freigabe erstellen"
                    variant="primary"
                    icon="LinkSimple"
                    disabled={offline}
                    testID="freigabe-erstellen"
                    onPress={() => {
                      setSubmitted(true);
                      if (!label.trim() || chosen.length === 0 || expires.getTime() <= Date.now() || expires.getTime() > maxDate.getTime()) return;
                      setConfirmCreate(true);
                    }}
                  />
                </View>
              )}
            </Section>
          </>
        )}
      </QueryView>

      <ConfirmDialog
        visible={confirmCreate}
        title={`${chosen.length === 1 ? '1 Eintrag' : `${chosen.length} Einträge`} bis ${formatDate(expires)} freigeben?`}
        message={`Jeder mit dem Link sieht diese Einträge${includeVin ? ' und die FIN' : ''}. Sie können die Freigabe jederzeit widerrufen.`}
        confirmLabel="Freigeben"
        icon="LinkSimple"
        loading={create.pending}
        onCancel={() => setConfirmCreate(false)}
        onConfirm={async () => {
          try {
            const share = await create.mutate();
            setCreated(share);
            setLabel('');
            setSubmitted(false);
            toast.show('Freigabe erstellt.');
          } catch {
            // Fehler im Formular
          } finally {
            setConfirmCreate(false);
          }
        }}
        testID="freigabe-dialog"
      />
      <ConfirmDialog
        visible={revoke !== null}
        title={`Freigabe "${revoke?.label ?? ''}" widerrufen?`}
        message="Der Link funktioniert danach nicht mehr. Das lässt sich nicht rückgängig machen; bei Bedarf erstellen Sie eine neue Freigabe."
        confirmLabel="Widerrufen"
        tone="destructive"
        icon="Prohibit"
        loading={revokeMutation.pending}
        onCancel={() => setRevoke(null)}
        onConfirm={async () => {
          if (!revoke) return;
          try {
            await revokeMutation.mutate(revoke.id);
            toast.show('Freigabe widerrufen.');
          } catch (e) {
            toast.show('Widerruf fehlgeschlagen. Bitte versuchen Sie es erneut.', 'danger');
          } finally {
            setRevoke(null);
          }
        }}
        testID="widerruf-dialog"
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  flex: { flex: 1, minWidth: 160 },
  form: { borderWidth: 1, padding: 16, gap: 16 },
  checks: { gap: 0 },
});
