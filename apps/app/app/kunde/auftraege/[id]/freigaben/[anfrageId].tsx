/**
 * Entscheidung über eine Freigabeanfrage (Angebot oder Zusatzarbeit).
 *
 * - Die Entscheidung wird an genau die angezeigte Version gebunden (versionId + contentHash).
 * - Hat die Werkstatt inzwischen geändert, antwortet der Server mit 409: Hinweis
 *   "Das Angebot wurde geändert" und neue Version laden.
 * - Bestätigungsdialog nennt Folge und Betrag; "Abbrechen" ist immer da.
 * - Ohne Verbindung keine Entscheidung (offline Erfasstes gilt nie als Freigabe).
 */
import { approvalRequestStatusLabels, routes, type ApprovalRequest, type ApprovalVersion, type ClientChannel } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useApi } from '../../../../../src/data/ApiProvider';
import { ApiError, ERROR_CODES } from '../../../../../src/data/errors';
import { useApiMutation, useApiQuery } from '../../../../../src/data/hooks';
import { useIsOffline } from '../../../../../src/data/network';
import { keepPlates, formatDate, formatDateTime, formatMoney } from '../../../../../src/lib/format';
import { lineNet } from '../../../../../src/screens/customer/money';
import { QueryView, openDownload } from '../../../../../src/screens/common';
import { useTheme } from '../../../../../src/theme';
import {
  AppText,
  Banner,
  Button,
  ConfirmDialog,
  Icon,
  iconSize,
  MoneyText,
  Page,
  PageHeader,
  PhotoGrid,
  Row,
  Section,
  StatusChip,
  TextField,
  useToast,
} from '../../../../../src/ui';

const channel: ClientChannel = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;

function Lines({ version }: { version: ApprovalVersion }) {
  const t = useTheme();
  const vat = version.totalGrossCents - version.totalNetCents;
  return (
    <View style={[styles.table, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]} testID="freigabe-positionen">
      {version.lines.map((l, i) => (
        <View key={`${l.title}-${i}`} style={[styles.line, { borderTopColor: t.colors.border, borderTopWidth: i === 0 ? 0 : 1 }]}>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">{l.title}</AppText>
            {l.description ? (
              <AppText variant="small" tone="muted">
                {l.description}
              </AppText>
            ) : null}
            <AppText variant="small" tone="subtle" numeric>
              {String(l.quantity).replace('.', ',')} {l.unit} × {formatMoney(l.unitPriceCents)} netto
            </AppText>
          </View>
          <MoneyText cents={lineNet(l)} />
        </View>
      ))}
      <View style={[styles.totals, { borderTopColor: t.colors.borderStrong }]}>
        <Row style={styles.between}>
          <AppText tone="muted">Summe netto</AppText>
          <MoneyText cents={version.totalNetCents} tone="muted" />
        </Row>
        <Row style={styles.between}>
          <AppText tone="muted">Umsatzsteuer</AppText>
          <MoneyText cents={vat} tone="muted" />
        </Row>
        <Row style={styles.between}>
          <AppText variant="heading">Gesamt</AppText>
          <MoneyText cents={version.totalGrossCents} variant="heading" testID="freigabe-gesamt" />
        </Row>
      </View>
    </View>
  );
}

function OlderVersions({ request }: { request: ApprovalRequest }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const older = request.versions.filter((v) => v.id !== request.currentVersion.id).reverse();
  if (older.length === 0) return null;
  return (
    <View style={styles.older}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={styles.olderToggle}>
        <Icon name={open ? 'CaretDown' : 'CaretRight'} size={iconSize.sm} color={t.colors.accent} />
        <AppText tone="accent" style={{ fontWeight: '600' }}>
          {older.length === 1 ? 'Frühere Version ansehen' : `${older.length} frühere Versionen ansehen`}
        </AppText>
      </Pressable>
      {open
        ? older.map((v) => (
            <View key={v.id} style={[styles.olderItem, { borderColor: t.colors.border, borderRadius: t.radius.panel }]}>
              <AppText variant="bodyStrong">
                Version {v.versionNo} vom {formatDate(v.sentAt)} (ungültig)
              </AppText>
              <AppText tone="muted" numeric>
                Gesamt {formatMoney(v.totalGrossCents)}, ersetzt am {formatDate(v.supersededAt)}
              </AppText>
              {v.decision ? (
                <AppText variant="small" tone="subtle">
                  Ihre damalige Entscheidung ({v.decision.decision === 'approved' ? 'freigegeben' : 'abgelehnt'}) gilt für diese Version nicht mehr.
                </AppText>
              ) : null}
            </View>
          ))
        : null}
    </View>
  );
}

export default function ApprovalDecisionScreen() {
  const { id, anfrageId } = useLocalSearchParams<{ id: string; anfrageId: string }>();
  const workOrderId = String(id);
  const requestId = String(anfrageId);
  const api = useApi();
  const toast = useToast();
  const t = useTheme();
  const offline = useIsOffline();
  const [dialog, setDialog] = useState<'approved' | 'rejected' | null>(null);
  const [comment, setComment] = useState('');
  const [outdated, setOutdated] = useState(false);
  const [result, setResult] = useState<{ decision: 'approved' | 'rejected'; amount: number; versionNo: number; at: string } | null>(null);

  const query = useApiQuery(`kunde:freigabe:${requestId}`, async (a) => {
    const [request, order, photos] = await Promise.all([a.getApproval(requestId), a.getWorkOrder(workOrderId), a.listPhotos(workOrderId)]);
    if (request.workOrderId !== workOrderId) throw ApiError.notFound();
    return { request, order, photos };
  });
  const decide = useApiMutation((a, input: { version: ApprovalVersion; decision: 'approved' | 'rejected' }) =>
    a.decideApproval(requestId, {
      versionId: input.version.id,
      contentHash: input.version.contentHash,
      decision: input.decision,
      comment: input.decision === 'rejected' && comment.trim() ? comment.trim() : null,
      channel,
    }),
  );

  const request = query.data?.request;
  const title = request?.title ?? 'Freigabe';
  const header = (
    <PageHeader
      title={title}
      subtitle={query.data ? `Auftrag ${query.data.order.orderNumber}, ${keepPlates(query.data.order.vehicleLabel)} ${keepPlates(query.data.order.licensePlate)}` : undefined}
      backHref={routes.customer.workOrder(workOrderId) as Href}
      backLabel="Auftrag"
      crumbs={[
        { label: 'Aufträge', href: routes.customer.workOrders() as Href },
        { label: query.data?.order.orderNumber ?? 'Auftrag', href: routes.customer.workOrder(workOrderId) as Href },
        { label: title },
      ]}
    />
  );

  if (result) {
    const approved = result.decision === 'approved';
    return (
      <Page maxWidth={720} testID="freigabe-ergebnis">
        {header}
        <View style={[styles.result, { backgroundColor: t.colors.surface, borderColor: approved ? t.colors.success : t.colors.border, borderRadius: t.radius.panel }]}>
          <View style={[styles.resultIcon, { backgroundColor: approved ? t.colors.successSoft : t.colors.surfaceSunken, borderRadius: t.radius.pill }]}>
            <Icon name={approved ? 'CheckCircle' : 'XCircle'} size={iconSize.xl} color={approved ? t.colors.success : t.colors.textMuted} />
          </View>
          <AppText variant="display" role="alert">
            {approved ? 'Freigabe erteilt' : 'Abgelehnt'}
          </AppText>
          <AppText tone="muted">
            {approved
              ? `Sie haben Version ${result.versionNo} über ${formatMoney(result.amount)} freigegeben. Wir führen die Arbeiten wie beschrieben aus. Ändert sich Umfang oder Preis, fragen wir Sie erneut.`
              : `Sie haben Version ${result.versionNo} abgelehnt. Diese Arbeiten führen wir nicht aus. Bereits vereinbarte Arbeiten bleiben davon unberührt.`}
          </AppText>
          <AppText variant="small" tone="subtle" numeric>
            Gespeichert am {formatDateTime(result.at)}
          </AppText>
          <Row wrap>
            <Button label="Zum Auftrag" variant="primary" onPress={() => router.replace(routes.customer.workOrder(workOrderId) as Href)} testID="zum-auftrag" />
            <Button label="Nachricht schreiben" icon="ChatCircleText" onPress={() => router.push(routes.customer.chat(workOrderId) as Href)} />
          </Row>
        </View>
      </Page>
    );
  }

  return (
    <Page maxWidth={760} testID="kunde-freigabe">
      {header}
      <QueryView query={query} loading="detail">
        {({ request: r, photos }) => {
          const v = r.currentVersion;
          const pending = r.status === 'pending_customer';
          const isOffer = r.kind === 'offer';
          const versionPhotos = photos.filter((p) => v.photoIds.includes(p.id));
          const decision = v.decision;
          return (
            <>
              <Row wrap>
                <StatusChip status={pending ? { label: 'Wartet auf Ihre Entscheidung', tone: 'warning', icon: 'HourglassMedium' } : approvalRequestStatusLabels[r.status]} testID="freigabe-status" />
                <AppText variant="small" tone="subtle" numeric>
                  {isOffer ? 'Angebot' : 'Zusatzarbeit'}, Version {v.versionNo} vom {formatDate(v.sentAt)}
                </AppText>
              </Row>

              {outdated ? (
                <Banner
                  tone="warning"
                  title="Das Angebot wurde geändert"
                  message="Die Werkstatt hat Umfang oder Preis geändert, während Sie die Anfrage geöffnet hatten. Ihre Entscheidung wurde nicht gespeichert. Bitte prüfen Sie die neue Version."
                  testID="angebot-geaendert"
                  action={
                    <Button
                      label="Neue Version laden"
                      variant="primary"
                      icon="ArrowsClockwise"
                      loading={query.isRefreshing}
                      onPress={async () => {
                        await query.refetch();
                        setOutdated(false);
                      }}
                    />
                  }
                />
              ) : v.versionNo > 1 && pending ? (
                <Banner tone="info" title={`Geänderte Anfrage (Version ${v.versionNo})`} message="Die Werkstatt hat diese Anfrage geändert. Frühere Versionen sind ungültig; bitte entscheiden Sie über die aktuelle Version." />
              ) : null}

              {decide.error && !outdated ? (
                <Banner
                  tone="danger"
                  title="Entscheidung nicht gespeichert"
                  message={decide.error.isNetwork ? 'Die Verbindung ist abgebrochen. Ihre Entscheidung wurde nicht übertragen. Bitte versuchen Sie es erneut.' : decide.error.message}
                  testID="entscheidung-fehler"
                />
              ) : null}

              <Section title="Beschreibung">
                <AppText>{v.summaryCustomer}</AppText>
              </Section>

              {versionPhotos.length > 0 ? (
                <Section title="Fotos">
                  <PhotoGrid photos={versionPhotos.map((p) => ({ id: p.id, source: api.imageSource(p.contentUrl), caption: p.caption }))} />
                </Section>
              ) : null}

              <Section title="Positionen und Kosten">
                <Lines version={v} />
              </Section>

              {v.scheduleChange || v.newReadyAt ? (
                <Section title="Terminänderung">
                  {v.scheduleChange ? <AppText>{v.scheduleChange}</AppText> : null}
                  {v.newReadyAt ? (
                    <AppText variant="bodyStrong" numeric>
                      Voraussichtlich fertig: {formatDateTime(v.newReadyAt)}
                    </AppText>
                  ) : null}
                </Section>
              ) : null}

              {v.documentVersionId ? (
                <Button
                  label="Angebot als PDF öffnen"
                  icon="FileText"
                  onPress={async () => {
                    try {
                      const docs = await api.listDocuments({ workOrderId });
                      const doc = docs.find((d) => d.kind === 'offer') ?? docs[0];
                      if (!doc) return;
                      const res = await openDownload(await api.downloadDocument(doc.id));
                      if (res === 'unsupported') toast.show('Das Öffnen von Dokumenten auf dem Gerät folgt in einer späteren Version.', 'info');
                    } catch {
                      toast.show('Das Dokument konnte nicht geladen werden.', 'danger');
                    }
                  }}
                />
              ) : null}

              {decision ? (
                <Banner
                  tone={decision.decision === 'approved' ? 'success' : 'neutral'}
                  title={decision.decision === 'approved' ? 'Von Ihnen freigegeben' : 'Von Ihnen abgelehnt'}
                  message={`${decision.decidedByDisplayName} am ${formatDateTime(decision.decidedAt)}${decision.comment ? `. Ihre Anmerkung: ${decision.comment}` : ''}. Prüfsumme der Version: ${shortHash(decision.contentHash)}`}
                />
              ) : null}
              {r.status === 'withdrawn' ? <Banner tone="neutral" title="Zurückgezogen" message="Die Werkstatt hat diese Anfrage zurückgezogen. Es ist keine Entscheidung nötig." /> : null}

              {pending ? (
                <View style={[styles.decide, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]}>
                  <AppText variant="heading">Ihre Entscheidung</AppText>
                  <AppText tone="muted">
                    Sie entscheiden über genau diese Version (Prüfsumme {shortHash(v.contentHash)}). Eine Zusage im Chat gilt nicht als Freigabe.
                  </AppText>
                  {offline ? <Banner tone="info" message="Ohne Verbindung ist keine Entscheidung möglich. Sobald Sie wieder online sind, können Sie freigeben oder ablehnen." /> : null}
                  <View style={styles.decideButtons}>
                    <Button label="Ablehnen" variant="secondary" icon="XCircle" onPress={() => setDialog('rejected')} disabled={offline || outdated} testID="ablehnen" style={styles.grow} />
                    <Button label="Freigeben" variant="primary" icon="CheckCircle" onPress={() => setDialog('approved')} disabled={offline || outdated} testID="freigeben" style={styles.grow} />
                  </View>
                </View>
              ) : null}

              <OlderVersions request={r} />

              <ConfirmDialog
                visible={dialog === 'approved'}
                title={`${isOffer ? 'Angebot' : 'Zusatzarbeit'} für ${formatMoney(v.totalGrossCents)} freigeben?`}
                message={`Sie beauftragen die Werkstatt mit den aufgeführten Positionen (Version ${v.versionNo}). Ändert sich Umfang oder Preis, fragen wir Sie erneut.`}
                confirmLabel="Freigeben"
                icon="CheckCircle"
                loading={decide.pending}
                onCancel={() => setDialog(null)}
                testID="freigeben-dialog"
                onConfirm={() => void submit('approved', v)}
              />
              <ConfirmDialog
                visible={dialog === 'rejected'}
                title={`${isOffer ? 'Angebot' : 'Zusatzarbeit'} über ${formatMoney(v.totalGrossCents)} ablehnen?`}
                message="Diese Arbeiten werden nicht ausgeführt. Bereits vereinbarte Arbeiten bleiben unberührt."
                confirmLabel="Ablehnen"
                tone="destructive"
                icon="XCircle"
                loading={decide.pending}
                onCancel={() => setDialog(null)}
                testID="ablehnen-dialog"
                onConfirm={() => void submit('rejected', v)}
              >
                <TextField label="Anmerkung für die Werkstatt (freiwillig)" value={comment} onChangeText={setComment} multiline maxLength={1000} />
              </ConfirmDialog>
            </>
          );
        }}
      </QueryView>
    </Page>
  );

  async function submit(decision: 'approved' | 'rejected', version: ApprovalVersion) {
    try {
      const updated = await decide.mutate({ version, decision });
      setDialog(null);
      setResult({ decision, amount: version.totalGrossCents, versionNo: version.versionNo, at: updated.currentVersion.decision?.decidedAt ?? new Date().toISOString() });
    } catch (e) {
      setDialog(null);
      const err = e as ApiError;
      if (err.code === ERROR_CODES.approvalVersionOutdated) setOutdated(true);
      else if (err.code === ERROR_CODES.approvalAlreadyDecided) {
        toast.show('Zu dieser Version liegt bereits eine Entscheidung vor.', 'info');
        void query.refetch();
      }
    }
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0, gap: 2 },
  between: { justifyContent: 'space-between' },
  table: { borderWidth: 1, overflow: 'hidden' },
  line: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'flex-start' },
  totals: { borderTopWidth: 2, paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  decide: { borderWidth: 1, padding: 16, gap: 12 },
  decideButtons: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  grow: { flexGrow: 1, flexBasis: 140, alignSelf: 'auto' },
  older: { gap: 8 },
  olderToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  olderItem: { borderWidth: 1, padding: 12, gap: 4 },
  result: { borderWidth: 1, borderLeftWidth: 4, padding: 24, gap: 12 },
  resultIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});
