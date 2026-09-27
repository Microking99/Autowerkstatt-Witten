/**
 * Werkstatt, Freigabeanfrage mit Versionsverlauf. Ändern erzeugt nach dem Senden eine neue
 * Version; eine Entscheidung zur alten Version verfällt (Hinweis). Wurde aus der Anfrage
 * schon gearbeitet, lehnt die API ab (approval_in_execution): dann "Neue Freigabeanfrage".
 * Zurückziehen mit Bestätigung. Mitarbeiter entscheiden nie für den Kunden.
 */
import { approvalRequestStatusLabels, routes, type ApprovalRequest, type WorkOrderDetail } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApi } from '../../../../../src/data/ApiProvider';
import { ERROR_CODES } from '../../../../../src/data/errors';
import { useApiMutation, useApiQuery } from '../../../../../src/data/hooks';
import { useIsOffline } from '../../../../../src/data/network';
import { formatDateTime, formatMoney } from '../../../../../src/lib/format';
import { ApprovalLinesTable, approvalTotals } from '../../../../../src/screens/approvals/ApprovalContent';
import { QueryView } from '../../../../../src/screens/common';
import { ApprovalEditor, editorFromDraft, previewLines, toDraft, type EditorState } from '../../../../../src/screens/workshop/ApprovalEditor';
import { WorkOrderFrame } from '../../../../../src/screens/workshop/WorkOrderFrame';
import { ActionError, useCan } from '../../../../../src/screens/workshop/shared';
import { useTheme } from '../../../../../src/theme';
import { AppText, Banner, Button, ConfirmDialog, PhotoGrid, Row, Section, StatusChip, useSaveShortcut, useToast } from '../../../../../src/ui';

const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;
const channelLabel = { ios: 'iPhone-App', android: 'Android-App', web: 'Browser', windows: 'Windows-Anwendung' } as const;

export default function ApprovalDetailScreen() {
  const { id, anfrageId } = useLocalSearchParams<{ id: string; anfrageId: string }>();
  return (
    <WorkOrderFrame id={String(id)} tab="freigaben" crumbExtra="Anfrage" maxWidth={960} testID="werkstatt-freigabe">
      {(order) => <Detail order={order} requestId={String(anfrageId)} />}
    </WorkOrderFrame>
  );
}

function Detail({ order, requestId }: { order: WorkOrderDetail; requestId: string }) {
  const request = useApiQuery(`werkstatt:freigabe:${requestId}`, (a) => a.getApproval(requestId));
  return <QueryView query={request} loading="detail" notAvailableTitle="Anfrage nicht verfügbar">{(r) => <RequestView order={order} request={r} />}</QueryView>;
}

function RequestView({ order, request }: { order: WorkOrderDetail; request: ApprovalRequest }) {
  const t = useTheme();
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const offline = useIsOffline();
  const photos = useApiQuery(`werkstatt:fotos:${order.id}`, (a) => a.listPhotos(order.id));
  const types = useApiQuery('werkstatt:wartungsarten', (a) => a.listMaintenanceTypes());
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<'send' | 'revise' | 'withdraw' | null>(null);
  const v = request.currentVersion;
  const isDraft = request.status === 'draft';
  const orderOpen = ['draft', 'open', 'in_progress', 'work_completed'].includes(order.status.work);
  const mayChange = can('approvals.request') && orderOpen && request.status !== 'withdrawn';

  const revise = useApiMutation((a, s: EditorState) => {
    const { draft } = toDraft(s);
    if (!draft) throw new Error('ungültig');
    return a.reviseApproval(request.id, draft);
  });
  const send = useApiMutation((a) => a.sendApproval(request.id));
  const withdraw = useApiMutation((a) => a.withdrawApproval(request.id));
  const inExecution = revise.error?.code === ERROR_CODES.approvalInExecution;

  function startEdit() {
    revise.reset();
    setErrors({});
    setEditing(editorFromDraft({ kind: request.kind, title: request.title, summaryCustomer: v.summaryCustomer, lines: v.lines, photoIds: v.photoIds, scheduleChange: v.scheduleChange, newReadyAt: v.newReadyAt, findingId: request.findingId }));
  }

  function checkEdit(): boolean {
    if (!editing) return false;
    const { errors: e } = toDraft(editing);
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      const updated = await revise.mutate(editing);
      setDialog(null);
      setEditing(null);
      toast.show(isDraft ? 'Entwurf gespeichert.' : `Version ${updated.currentVersion.versionNo} gesendet. Die frühere Entscheidung gilt nicht mehr.`);
    } catch {
      setDialog(null);
    }
  }

  useSaveShortcut(() => {
    if (!checkEdit()) return;
    if (isDraft) void saveEdit();
    else setDialog('revise');
  }, editing !== null);

  if (editing) {
    const previewed = previewLines(editing);
    const totals = previewed.length > 0 ? approvalTotals(previewed) : null;
    return (
      <>
        {!isDraft ? (
          <Banner
            tone="warning"
            title={`Änderung erzeugt Version ${v.versionNo + 1}`}
            message="Nach dem Speichern erhält der Kunde die neue Version. Eine Entscheidung zur bisherigen Version gilt nicht mehr; bereits freigegebene, noch nicht begonnene Positionen warten wieder auf die Freigabe."
          />
        ) : null}
        <ApprovalEditor state={editing} onChange={setEditing} errors={errors} photos={photos.data ?? []} maintenanceTypes={types.data ?? []} versionNo={isDraft ? v.versionNo : v.versionNo + 1} />
        {inExecution ? (
          <Banner
            tone="warning"
            title="Aus dieser Anfrage wird bereits gearbeitet"
            message={`${revise.error?.message ?? ''} Die bisherige Anfrage bleibt unverändert.`}
            testID="anfrage-in-ausfuehrung"
            action={<Button label="Neue Freigabeanfrage" variant="primary" icon="Plus" onPress={() => router.push(routes.workshop.newApproval(order.id) as Href)} testID="neue-anfrage-statt-aenderung" />}
          />
        ) : (
          <ActionError error={revise.error} />
        )}
        <Row wrap>
          <Button label="Abbrechen" onPress={() => setEditing(null)} />
          <Button
            label={isDraft ? 'Entwurf speichern' : 'Neue Version senden'}
            variant="primary"
            icon={isDraft ? 'Check' : 'PaperPlaneRight'}
            disabled={offline && !isDraft}
            loading={revise.pending}
            onPress={() => {
              if (!checkEdit()) return;
              if (isDraft) void saveEdit();
              else setDialog('revise');
            }}
            testID="anfrage-aenderung-speichern"
          />
        </Row>
        <ConfirmDialog
          visible={dialog === 'revise'}
          title={totals ? `Version ${v.versionNo + 1} über ${formatMoney(totals.totalGrossCents)} senden?` : `Version ${v.versionNo + 1} senden?`}
          message="Der Kunde muss neu entscheiden. Die bisherige Version wird ungültig, auch wenn sie schon freigegeben war."
          confirmLabel="Neue Version senden"
          icon="PaperPlaneRight"
          loading={revise.pending}
          onCancel={() => setDialog(null)}
          testID="neue-version-dialog"
          onConfirm={() => void saveEdit()}
        />
      </>
    );
  }

  const versionPhotos = (photos.data ?? []).filter((p) => v.photoIds.includes(p.id));
  const older = [...request.versions].filter((x) => x.id !== v.id).sort((a, b) => b.versionNo - a.versionNo);
  return (
    <>
      <Row wrap>
        <StatusChip status={approvalRequestStatusLabels[request.status]} testID="anfrage-status" />
        <AppText variant="small" tone="subtle" numeric>
          {request.kind === 'offer' ? 'Angebot' : 'Zusatzarbeit'}, Version {v.versionNo}
          {v.sentAt ? `, gesendet ${formatDateTime(v.sentAt)}` : ', noch nicht gesendet'}
        </AppText>
      </Row>
      {isDraft ? <Banner tone="info" title="Entwurf" message="Der Kunde sieht die Anfrage erst nach dem Senden. Die Positionen entstehen im Auftrag ebenfalls erst beim Senden." /> : null}
      {request.status === 'pending_customer' ? <Banner tone="warning" title="Wartet auf die Entscheidung des Kunden" message="Die Positionen sind für Mechaniker gesperrt, bis der Kunde freigibt." /> : null}
      {v.decision ? (
        <Banner
          tone={v.decision.decision === 'approved' ? 'success' : 'neutral'}
          title={v.decision.decision === 'approved' ? 'Vom Kunden freigegeben' : 'Vom Kunden abgelehnt'}
          message={`${v.decision.decidedByDisplayName} am ${formatDateTime(v.decision.decidedAt)} (${channelLabel[v.decision.channel]}), Version ${v.versionNo}, Prüfsumme ${shortHash(v.decision.contentHash)}${v.decision.comment ? `. Anmerkung: ${v.decision.comment}` : ''}`}
          testID="anfrage-entscheidung"
        />
      ) : null}
      {request.status === 'withdrawn' ? <Banner tone="neutral" title="Zurückgezogen" message="Der Kunde muss nichts mehr entscheiden. Wartende Positionen dieser Anfrage werden nicht ausgeführt." /> : null}

      <Section title="Beschreibung für den Kunden">
        <AppText>{v.summaryCustomer}</AppText>
      </Section>
      {versionPhotos.length > 0 ? (
        <Section title="Fotos">
          <PhotoGrid photos={versionPhotos.map((p) => ({ id: p.id, source: api.imageSource(p.contentUrl), caption: p.caption }))} />
        </Section>
      ) : null}
      <Section title="Positionen und Kosten">
        <ApprovalLinesTable lines={v.lines} />
      </Section>
      {v.scheduleChange || v.newReadyAt ? (
        <Section title="Terminänderung">
          {v.scheduleChange ? <AppText>{v.scheduleChange}</AppText> : null}
          {v.newReadyAt ? <AppText numeric>Voraussichtlich fertig: {formatDateTime(v.newReadyAt)}</AppText> : null}
        </Section>
      ) : null}

      {mayChange ? (
        <View style={[styles.actions, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]}>
          <Row wrap>
            {isDraft ? <Button label="Senden" variant="primary" icon="PaperPlaneRight" onPress={() => setDialog('send')} disabled={offline} testID="entwurf-senden" /> : null}
            <Button label={isDraft ? 'Bearbeiten' : 'Ändern (neue Version)'} icon="PencilSimple" onPress={startEdit} testID="anfrage-aendern" />
            {request.status === 'pending_customer' || isDraft ? <Button label="Zurückziehen" icon="ArrowUDownLeft" onPress={() => setDialog('withdraw')} testID="anfrage-zurueckziehen" /> : null}
          </Row>
          <AppText variant="small" tone="subtle">Nur der Kunde kann freigeben oder ablehnen. Eine Zusage am Telefon oder im Chat ist keine Freigabe.</AppText>
        </View>
      ) : null}
      <ActionError error={send.error ?? withdraw.error} />

      <Section title="Versionsverlauf">
        {[v, ...older].map((x) => (
          <View key={x.id} style={[styles.version, { borderColor: x.id === v.id ? t.colors.accent : t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]} testID={`version-${x.versionNo}`}>
            <Row wrap style={styles.between}>
              <AppText variant="bodyStrong">
                Version {x.versionNo}
                {x.id === v.id ? ' (aktuell)' : ' (ungültig)'}
              </AppText>
              <AppText numeric>{formatMoney(x.totalGrossCents)} brutto</AppText>
            </Row>
            <AppText variant="small" tone="muted" numeric>
              {x.sentAt ? `Gesendet ${formatDateTime(x.sentAt)}` : 'Nicht gesendet'}
              {x.supersededAt ? `, ersetzt ${formatDateTime(x.supersededAt)}` : ''}, Prüfsumme {shortHash(x.contentHash)}
            </AppText>
            {x.decision ? (
              <AppText variant="small">
                {x.decision.decision === 'approved' ? 'Freigegeben' : 'Abgelehnt'} von {x.decision.decidedByDisplayName} am {formatDateTime(x.decision.decidedAt)}
                {x.id !== v.id ? '. Gilt nicht mehr, weil die Anfrage geändert wurde.' : ''}
              </AppText>
            ) : null}
          </View>
        ))}
      </Section>

      <ConfirmDialog
        visible={dialog === 'send'}
        title={`Freigabeanfrage über ${formatMoney(v.totalGrossCents)} senden?`}
        message={`${order.customerDisplayName} wird benachrichtigt. Ausgewählte Fotos werden für den Kunden sichtbar.`}
        confirmLabel="Senden"
        icon="PaperPlaneRight"
        loading={send.pending}
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          try {
            await send.mutate();
            setDialog(null);
            toast.show('Freigabeanfrage gesendet.');
          } catch {
            setDialog(null);
          }
        }}
      />
      <ConfirmDialog
        visible={dialog === 'withdraw'}
        title="Anfrage zurückziehen?"
        message="Der Kunde kann danach nicht mehr entscheiden. Wartende Positionen dieser Anfrage werden nicht ausgeführt."
        confirmLabel="Zurückziehen"
        tone="destructive"
        loading={withdraw.pending}
        onCancel={() => setDialog(null)}
        testID="zurueckziehen-dialog"
        onConfirm={async () => {
          try {
            await withdraw.mutate();
            setDialog(null);
            toast.show('Anfrage zurückgezogen.');
          } catch {
            setDialog(null);
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  actions: { borderWidth: 1, padding: 16, gap: 12 },
  version: { borderWidth: 1, padding: 12, gap: 4 },
});
