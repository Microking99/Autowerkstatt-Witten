/**
 * Mechaniker, Synchronisierung: nicht übertragene Einträge der Offline-Warteschlange in der
 * Reihenfolge der Erfassung, vom Server abgelehnte Einträge (Konflikte) mit Grund.
 * Erneut senden oder verwerfen (Bestätigung). Freigaben, Zahlungen, fachlicher Abschluss
 * und Rechnungen gibt es offline nie.
 */
import { routes } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatDateTime } from '../../src/lib/format';
import { useOfflineQueue } from '../../src/offline/OfflineQueueProvider';
import type { QueueEntry } from '../../src/offline/queueCore';
import { conflictLabel, queueKindLabels, unsyncedLabel } from '../../src/screens/mechanic/pending';
import { useTheme } from '../../src/theme';
import { AppText, Banner, Button, ConfirmDialog, EmptyState, Page, PageHeader, Row, Section, StatusChip, useToast } from '../../src/ui';

export default function SyncScreen() {
  const t = useTheme();
  const toast = useToast();
  const { entries, summary, online, flush, retry, discard } = useOfflineQueue();
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<QueueEntry | null>(null);
  const conflicts = entries.filter((e) => e.state === 'conflict');
  const waiting = entries.filter((e) => e.state !== 'conflict');

  return (
    <Page maxWidth={760} testID="mechaniker-sync">
      <PageHeader title="Synchronisierung" subtitle={online ? 'Verbindung besteht.' : 'Keine Verbindung.'} crumbs={[{ label: 'Heute', href: routes.mechanic.home() as Href }, { label: 'Synchronisierung' }]} />
      <Row wrap gap={8}>
        <StatusChip status={online ? { label: 'Online', tone: 'success', icon: 'CheckCircle' } : { label: 'Offline', tone: 'warning', icon: 'WifiSlash' }} testID="verbindung" />
        <StatusChip status={summary.pending ? { ...unsyncedLabel, label: `${summary.pending} nicht synchronisiert` } : { label: 'Alles übertragen', tone: 'success', icon: 'CloudArrowUp' }} testID="sync-status" />
        {summary.conflicts ? <StatusChip status={{ ...conflictLabel, label: `${summary.conflicts} ${summary.conflicts === 1 ? 'Konflikt' : 'Konflikte'}` }} /> : null}
      </Row>
      {online && waiting.length > 0 ? (
        <Button
          label="Jetzt übertragen"
          variant="primary"
          size="lg"
          icon="CloudArrowUp"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await flush();
              toast.show('Übertragung abgeschlossen.');
            } finally {
              setBusy(false);
            }
          }}
          testID="jetzt-uebertragen"
        />
      ) : null}
      {!online && waiting.length > 0 ? <Banner tone="info" message="Die Einträge werden automatisch übertragen, sobald eine Verbindung besteht. Bitte die App bis dahin nicht abmelden." /> : null}
      {entries.length === 0 ? <EmptyState icon="CloudArrowUp" title="Alles übertragen" message="Es gibt keine offenen Einträge auf diesem Gerät." /> : null}
      {conflicts.length > 0 ? (
        <Section title="Vom Server abgelehnt">
          <AppText tone="muted">Der Server entscheidet über Statuswechsel. Prüfen Sie den Grund und senden Sie erneut oder verwerfen Sie den Eintrag. Einträge derselben Position warten, bis das geklärt ist.</AppText>
          {conflicts.map((e) => (
            <View key={e.id} style={[styles.entry, { borderColor: t.colors.danger, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]} testID={`konflikt-${e.id}`}>
              <Row wrap style={styles.between}>
                <AppText variant="bodyStrong">{e.label}</AppText>
                <StatusChip status={conflictLabel} />
              </Row>
              <AppText>{e.lastError?.message ?? 'Abgelehnt.'}</AppText>
              <AppText variant="small" tone="subtle" numeric>
                Erfasst {formatDateTime(e.createdAt)}, {e.attempts} {e.attempts === 1 ? 'Versuch' : 'Versuche'}
              </AppText>
              <Row wrap>
                <Button label="Erneut senden" size="lg" icon="ArrowsClockwise" disabled={!online} onPress={() => void retry(e.id)} testID={`erneut-${e.id}`} />
                <Button label="Verwerfen" size="lg" icon="Trash" onPress={() => setConfirmDiscard(e)} testID={`verwerfen-${e.id}`} />
                <Button label="Auftrag öffnen" variant="quiet" iconRight="CaretRight" onPress={() => router.push(routes.mechanic.workOrder(e.workOrderId) as Href)} />
              </Row>
            </View>
          ))}
        </Section>
      ) : null}
      {waiting.length > 0 ? (
        <Section title={`Warten auf Übertragung (${waiting.length})`}>
          {waiting.map((e, i) => (
            <View key={e.id} style={[styles.entry, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]} testID={`wartend-${i}`}>
              <Row wrap style={styles.between}>
                <AppText variant="bodyStrong">{e.label || queueKindLabels[e.kind]}</AppText>
                <StatusChip status={e.state === 'sending' ? { label: 'Wird übertragen', tone: 'info', icon: 'CloudArrowUp' } : unsyncedLabel} />
              </Row>
              <AppText variant="small" tone="subtle" numeric>
                {i + 1}. in der Reihenfolge, erfasst {formatDateTime(e.createdAt)}
                {e.attempts > 0 ? `, ${e.attempts} ${e.attempts === 1 ? 'Versuch' : 'Versuche'} ohne Verbindung` : ''}
              </AppText>
              {e.kind === 'photo' && String(e.payload.uri ?? '').startsWith('blob:') ? <AppText variant="small" tone="warning">Großes Foto im Browser: Nach einem Neuladen der Seite ist es nicht mehr verfügbar.</AppText> : null}
              <Button label="Verwerfen" variant="quiet" icon="Trash" onPress={() => setConfirmDiscard(e)} />
            </View>
          ))}
        </Section>
      ) : null}
      <Section title="Offline nie möglich">
        <AppText tone="muted">Kundenfreigaben, Zahlungen, fachlicher Abschluss, Rechnungen, Halterwechsel und Rechteänderungen brauchen immer eine Verbindung. Offline Erfasstes gilt nie als Freigabe oder Zahlung.</AppText>
      </Section>
      <ConfirmDialog
        visible={confirmDiscard !== null}
        title="Eintrag verwerfen?"
        message={`"${confirmDiscard?.label ?? ''}" wird gelöscht und nicht übertragen. Davon abhängige Einträge (zum Beispiel "An Service melden" zu einer Feststellung) werden ebenfalls verworfen.`}
        confirmLabel="Verwerfen"
        tone="destructive"
        onCancel={() => setConfirmDiscard(null)}
        testID="verwerfen-dialog"
        onConfirm={async () => {
          if (!confirmDiscard) return;
          const removed = await discard(confirmDiscard.id);
          setConfirmDiscard(null);
          toast.show(removed.length > 1 ? `${removed.length} Einträge verworfen.` : 'Eintrag verworfen.');
        }}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  entry: { borderWidth: 1, borderLeftWidth: 4, padding: 12, gap: 6 },
  between: { justifyContent: 'space-between' },
});
