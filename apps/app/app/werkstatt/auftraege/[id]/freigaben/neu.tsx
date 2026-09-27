/**
 * Werkstatt, Freigabeanfrage erstellen: Positionen mit Preisen, Beschreibung für den Kunden,
 * Fotos, Terminänderung; Vorschau wie beim Kunden; Senden mit Bestätigung (Kunde wird
 * benachrichtigt). Aus einer Feststellung (?feststellung=<id>) vorbelegt.
 */
import { routes, type WorkOrderDetail } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApiMutation, useApiQuery } from '../../../../../src/data/hooks';
import { useIsOffline } from '../../../../../src/data/network';
import { formatMoney } from '../../../../../src/lib/format';
import { approvalTotals } from '../../../../../src/screens/approvals/ApprovalContent';
import { ApprovalEditor, editorFromDraft, emptyLine, previewLines, toDraft, type EditorState } from '../../../../../src/screens/workshop/ApprovalEditor';
import { WorkOrderFrame } from '../../../../../src/screens/workshop/WorkOrderFrame';
import { ActionError, useCan } from '../../../../../src/screens/workshop/shared';
import { useTheme } from '../../../../../src/theme';
import { AppText, Banner, Button, ConfirmDialog, Row, useSaveShortcut, useToast } from '../../../../../src/ui';

export default function NewApprovalScreen() {
  const { id, feststellung } = useLocalSearchParams<{ id: string; feststellung?: string }>();
  return (
    <WorkOrderFrame id={String(id)} tab="freigaben" crumbExtra="Neue Anfrage" maxWidth={960} testID="werkstatt-freigabe-neu">
      {(order) => <NewApproval order={order} findingId={feststellung ?? null} />}
    </WorkOrderFrame>
  );
}

function NewApproval({ order, findingId }: { order: WorkOrderDetail; findingId: string | null }) {
  const t = useTheme();
  const can = useCan();
  const toast = useToast();
  const offline = useIsOffline();
  const photos = useApiQuery(`werkstatt:fotos:${order.id}`, (a) => a.listPhotos(order.id));
  const types = useApiQuery('werkstatt:wartungsarten', (a) => a.listMaintenanceTypes());
  const findings = useApiQuery(findingId ? `werkstatt:feststellungen:${order.id}` : null, (a) => a.listFindings(order.id));
  const [state, setState] = useState<EditorState>(() => editorFromDraft({ kind: order.status.work === 'draft' || order.status.work === 'open' ? 'offer' : 'additional_work' }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmSend, setConfirmSend] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  // Aus einer Feststellung vorbelegen (Beschreibung, Fotos, Bezug)
  useEffect(() => {
    if (prefilled || !findingId || !findings.data) return;
    const f = findings.data.find((x) => x.id === findingId);
    if (!f) return;
    const photoIds = (photos.data ?? []).filter((p) => f.photoIds.includes(p.id) || p.findingId === f.id).map((p) => p.id);
    setState((s) => ({
      ...s,
      kind: 'additional_work',
      title: f.description.length > 60 ? `${f.description.slice(0, 57)}...` : f.description,
      summaryCustomer: f.description,
      photoIds,
      findingId: f.id,
      lines: s.lines.length === 1 && !s.lines[0]!.title ? [emptyLine({ title: '', unit: 'Stk' }), emptyLine({ title: 'Arbeitszeit', unit: 'Std.' })] : s.lines,
    }));
    setPrefilled(true);
  }, [findingId, findings.data, photos.data, prefilled]);

  const create = useApiMutation(async (a, send: boolean) => {
    const { draft } = toDraft(state);
    if (!draft) throw new Error('ungültig');
    const created = await a.createApproval(order.id, draft);
    if (!send) return created;
    try {
      return await a.sendApproval(created.id);
    } catch {
      // Entwurf ist gespeichert; Senden in der Anfrage erneut versuchen (keine Dublette)
      toast.show('Entwurf gespeichert, das Senden ist fehlgeschlagen. Bitte in der Anfrage erneut senden.', 'warning');
      return created;
    }
  });

  function check(): boolean {
    const { errors: e } = toDraft(state);
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(send: boolean) {
    try {
      const r = await create.mutate(send);
      setConfirmSend(false);
      if (!send) toast.show('Entwurf gespeichert. Der Kunde sieht ihn noch nicht.');
      else if (r.status !== 'draft') toast.show('Freigabeanfrage gesendet. Der Kunde wird benachrichtigt.');
      router.replace(routes.workshop.approval(order.id, r.id) as Href);
    } catch {
      setConfirmSend(false);
    }
  }

  useSaveShortcut(() => {
    if (check()) void submit(false);
  }, can('approvals.request'));

  if (!can('approvals.request')) return <Banner tone="neutral" message="Für Freigabeanfragen fehlt Ihnen das Recht." />;
  // Gleiche Summe wie im Editor, auch solange andere Felder noch fehlen
  const previewed = previewLines(state);
  const totals = previewed.length > 0 ? approvalTotals(previewed) : null;
  return (
    <>
      {findingId ? <Banner tone="info" message="Vorbelegt aus der Feststellung des Mechanikers. Positionen und Preise ergänzen; die Feststellung gilt danach als übernommen." /> : null}
      <ApprovalEditor state={state} onChange={setState} errors={errors} photos={photos.data ?? []} maintenanceTypes={types.data ?? []} versionNo={1} />
      <ActionError error={create.error} />
      <View style={[styles.bar, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]}>
        <AppText tone="muted" style={styles.flex}>
          {totals ? `Gesamt ${formatMoney(totals.totalGrossCents)} brutto.` : 'Positionen mit Preisen ergänzen.'} Nach dem Senden erzeugt jede Änderung eine neue Version.
        </AppText>
        <Row wrap>
          <Button label="Als Entwurf speichern" icon="Check" onPress={() => check() && void submit(false)} loading={create.pending && !confirmSend} testID="anfrage-entwurf" />
          <Button label="Senden" variant="primary" icon="PaperPlaneRight" onPress={() => check() && setConfirmSend(true)} disabled={offline} testID="anfrage-senden" />
        </Row>
        {offline ? <AppText variant="small" tone="subtle">Senden erst wieder mit Verbindung.</AppText> : null}
      </View>
      <ConfirmDialog
        visible={confirmSend}
        title={totals ? `Freigabeanfrage über ${formatMoney(totals.totalGrossCents)} senden?` : 'Freigabeanfrage senden?'}
        message={`${order.customerDisplayName} wird benachrichtigt und entscheidet in der App. Ausgewählte Fotos werden für den Kunden sichtbar. Die Positionen erscheinen im Auftrag als "Wartet auf Freigabe" und sind für Mechaniker gesperrt.`}
        confirmLabel="Senden"
        icon="PaperPlaneRight"
        loading={create.pending}
        onCancel={() => setConfirmSend(false)}
        testID="senden-dialog"
        onConfirm={() => void submit(true)}
      >
        <ActionError error={create.error} />
      </ConfirmDialog>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { borderWidth: 1, padding: 16, gap: 12 },
  flex: { flexShrink: 1 },
});
