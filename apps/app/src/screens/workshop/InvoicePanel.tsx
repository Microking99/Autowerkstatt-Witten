/**
 * Rechnung in der Werkstatt: Beträge und Zahlungsstatus (serverseitig berechnet), Dokument,
 * Zahlungen, Zahlungsversuche (Checkouts) und Erstattungen. Aktionen nur mit Recht:
 * stellen und stornieren (invoices.write), manuelle Zahlung (payments.recordManual, alle
 * Pflichtangaben, Bestätigung), Erstattung (payments.refund). Ohne Verbindung keine Zahlung.
 */
import { checkoutStatusLabels, overdueLabel, paymentMethodLabels, paymentStatusLabels, type Invoice, type Payment, type PaymentMethod, type WorkOrderDetail } from '@werkstatt/contracts';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApi } from '../../data/ApiProvider';
import { useApiMutation } from '../../data/hooks';
import { useIsOffline } from '../../data/network';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { pickDocument } from '../../lib/pickDocument';
import { newClientId, type PickedImage } from '../../lib/pickImage';
import { lineGross } from '../customer/money';
import { openDownload } from '../common';
import { useTheme } from '../../theme';
import { AppText, Banner, Button, ConfirmDialog, DateTimeField, KeyValueList, ListGroup, ListRow, Row, Section, Select, Sheet, StatusChip, TextField, useSaveShortcut, useToast } from '../../ui';
import { ActionError, centsToInput, invoiceStatusLabels, parseEuro, useCan } from './shared';

type ManualMethod = Exclude<PaymentMethod, 'sumup_online'>;

export function InvoicePanel({ invoice }: { invoice: Invoice }) {
  const t = useTheme();
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const offline = useIsOffline();
  const [dialog, setDialog] = useState<'issue' | 'cancel' | null>(null);
  const [number, setNumber] = useState('');
  const [reason, setReason] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [refundFor, setRefundFor] = useState<Payment | null>(null);
  const issue = useApiMutation((a) => a.issueInvoice(invoice.id, { invoiceNumber: number.trim() }));
  const cancel = useApiMutation((a) => a.cancelInvoice(invoice.id, { reason: reason.trim() || null }));
  const refresh = useApiMutation((a) => a.refreshPaymentStatus(invoice.id));

  useEffect(() => {
    if (dialog === 'issue' && !number) setNumber(`R-${new Date().getFullYear()}-`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  const issued = invoice.status === 'issued';
  const draft = invoice.status === 'draft';
  const checkouts = invoice.checkouts ?? [];
  const refunds = invoice.refunds ?? [];

  return (
    <View style={[styles.panel, { borderColor: invoice.overdue ? t.colors.danger : t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]} testID={`rechnung-${invoice.invoiceNumber ?? 'entwurf'}`}>
      <Row wrap style={styles.between}>
        <AppText variant="heading">{invoice.invoiceNumber ? `Rechnung ${invoice.invoiceNumber}` : 'Rechnungsentwurf'}</AppText>
        <Row wrap gap={8}>
          <StatusChip status={invoiceStatusLabels[invoice.status]} />
          <StatusChip prefix="Zahlung" status={paymentStatusLabels[invoice.paymentStatus]} testID="rechnung-zahlstatus" />
          {invoice.overdue ? <StatusChip status={overdueLabel} /> : null}
        </Row>
      </Row>
      <KeyValueList
        items={[
          { label: 'Rechnungsbetrag (brutto)', value: formatMoney(invoice.totalGrossCents), numeric: true },
          { label: 'Offen', value: formatMoney(invoice.openCents), numeric: true },
          { label: 'Bezahlt', value: formatMoney(invoice.paidCents), numeric: true },
          { label: 'Erstattet', value: formatMoney(invoice.refundedCents), numeric: true },
          { label: 'Gestellt am', value: invoice.issuedAt ? formatDate(invoice.issuedAt) : 'noch nicht gestellt', numeric: true },
          { label: 'Fällig am', value: invoice.dueDate ? formatDate(invoice.dueDate) : 'ohne Datum', numeric: true },
        ]}
      />
      <Row wrap>
        {invoice.documentId ? (
          <Button
            label="PDF öffnen"
            icon="FileText"
            onPress={async () => {
              try {
                const res = await openDownload(await api.downloadDocument(invoice.documentId!), invoice.invoiceNumber ?? 'Rechnung');
                if (res === 'unsupported') toast.show('Auf diesem Gerät gibt es keine App zum Öffnen der Datei.', 'info');
              } catch {
                toast.show('Das Dokument konnte nicht geladen werden.', 'danger');
              }
            }}
          />
        ) : null}
        {draft && can('invoices.write') ? <Button label="Rechnung stellen" variant="primary" icon="Receipt" onPress={() => setDialog('issue')} testID="rechnung-stellen" /> : null}
        {issued && invoice.openCents > 0 && can('payments.recordManual') ? (
          <Button label="Zahlung erfassen" variant="primary" icon="HandCoins" onPress={() => setManualOpen(true)} disabled={offline} testID="zahlung-erfassen" />
        ) : null}
        {issued && checkouts.some((c) => c.status === 'pending' || c.status === 'created') ? (
          <Button label="Beim Anbieter prüfen" icon="ArrowsClockwise" loading={refresh.pending} onPress={async () => { try { await refresh.mutate(); toast.show('Zahlungsstatus geprüft.'); } catch { /* unten */ } }} disabled={offline} />
        ) : null}
        {issued && can('invoices.write') ? <Button label="Stornieren" icon="XCircle" onPress={() => setDialog('cancel')} testID="rechnung-stornieren" /> : null}
      </Row>
      {issued && invoice.openCents > 0 && !can('payments.recordManual') ? (
        <AppText variant="small" tone="subtle" testID="kein-zahlungsrecht">
          Zahlungen manuell buchen dürfen nur Mitarbeiter mit dem Recht "Zahlung manuell zuordnen".
        </AppText>
      ) : null}
      {offline ? <AppText variant="small" tone="subtle">Zahlungen und Erstattungen sind erst wieder mit Verbindung möglich.</AppText> : null}
      <ActionError error={refresh.error} title="Prüfung fehlgeschlagen" />

      <Section title="Zahlungen">
        {invoice.payments.length === 0 ? (
          <AppText tone="muted">Noch keine Zahlung eingegangen.</AppText>
        ) : (
          <ListGroup>
            {invoice.payments.map((p, i) => (
              <ListRow
                key={p.id}
                first={i === 0}
                icon={p.method === 'sumup_online' ? 'CreditCard' : p.method === 'cash' ? 'Money' : p.method === 'bank_transfer' ? 'Bank' : 'CreditCard'}
                title={`${formatMoney(p.amountCents)}, ${paymentMethodLabels[p.method]}`}
                subtitle={[formatDateTime(p.receivedAt), p.referenceText, p.recordedByDisplayName ? `erfasst von ${p.recordedByDisplayName}` : 'vom Anbieter bestätigt'].filter(Boolean).join(', ')}
                meta={p.refundedCents > 0 ? `davon erstattet ${formatMoney(p.refundedCents)}` : null}
                right={
                  can('payments.refund') && p.amountCents - p.refundedCents > 0 ? (
                    <Button label="Erstatten" variant="quiet" icon="ArrowCounterClockwise" onPress={() => setRefundFor(p)} disabled={offline} testID={`erstatten-${p.id}`} />
                  ) : undefined
                }
              />
            ))}
          </ListGroup>
        )}
      </Section>
      {checkouts.length > 0 ? (
        <Section title="Zahlungsversuche online">
          <ListGroup>
            {checkouts.map((c, i) => (
              <ListRow key={c.id} first={i === 0} icon="CreditCard" title={formatMoney(c.amountCents)} subtitle={`Angelegt ${formatDateTime(c.createdAt)}${c.lastCheckedAt ? `, geprüft ${formatDateTime(c.lastCheckedAt)}` : ''}`} right={<StatusChip status={checkoutStatusLabels[c.status]} />} />
            ))}
          </ListGroup>
          <AppText variant="small" tone="subtle">Ein Zahlungsversuch ändert nichts am Rechnungsstatus. Bezahlt gilt erst nach der geprüften Bestätigung des Anbieters.</AppText>
        </Section>
      ) : null}
      {refunds.length > 0 ? (
        <Section title="Erstattungen">
          <ListGroup>
            {refunds.map((r, i) => (
              <ListRow key={r.id} first={i === 0} icon="ArrowCounterClockwise" title={formatMoney(r.amountCents)} subtitle={`${formatDateTime(r.requestedAt)}${r.failureReason ? `, ${r.failureReason}` : ''}`} right={<StatusChip status={r.status === 'succeeded' ? { label: 'Erstattet', tone: 'success', icon: 'CheckCircle' } : r.status === 'failed' ? { label: 'Fehlgeschlagen', tone: 'danger', icon: 'XCircle' } : { label: 'Beantragt', tone: 'warning', icon: 'HourglassMedium' }} />} />
            ))}
          </ListGroup>
        </Section>
      ) : null}

      <ConfirmDialog
        visible={dialog === 'issue'}
        title={`Rechnung über ${formatMoney(invoice.totalGrossCents)} stellen?`}
        message="Der Kunde sieht die Rechnung danach in der App und kann sie bezahlen. Das PDF wird dabei veröffentlicht."
        confirmLabel="Rechnung stellen"
        icon="Receipt"
        loading={issue.pending}
        onCancel={() => setDialog(null)}
        testID="stellen-dialog"
        onConfirm={async () => {
          if (!number.trim()) return;
          try {
            await issue.mutate();
            setDialog(null);
            toast.show('Rechnung gestellt.');
          } catch {
            // Fehler im Dialog
          }
        }}
      >
        <TextField label="Rechnungsnummer" value={number} onChangeText={setNumber} required error={number.trim() ? null : 'Pflichtfeld'} testID="rechnungsnummer" />
        <ActionError error={issue.error} />
      </ConfirmDialog>
      <ConfirmDialog
        visible={dialog === 'cancel'}
        title={`Rechnung ${invoice.invoiceNumber ?? ''} stornieren?`}
        message="Die Rechnung gilt danach nicht mehr. Offene Zahlungsversuche werden deaktiviert. Bereits gebuchte Zahlungen bleiben sichtbar und können erstattet werden."
        confirmLabel="Stornieren"
        tone="destructive"
        loading={cancel.pending}
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          try {
            await cancel.mutate();
            setDialog(null);
            toast.show('Rechnung storniert.');
          } catch {
            // Fehler im Dialog
          }
        }}
      >
        <TextField label="Grund (freiwillig)" value={reason} onChangeText={setReason} />
        <ActionError error={cancel.error} />
      </ConfirmDialog>
      <ManualPaymentSheet invoice={invoice} visible={manualOpen} onClose={() => setManualOpen(false)} />
      <RefundSheet payment={refundFor} onClose={() => setRefundFor(null)} />
    </View>
  );
}

function ManualPaymentSheet({ invoice, visible, onClose }: { invoice: Invoice; visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const [method, setMethod] = useState<ManualMethod>('bank_transfer');
  const [amount, setAmount] = useState('');
  const [receivedAt, setReceivedAt] = useState<Date | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const record = useApiMutation((a, cents: number) =>
    a.recordManualPayment(invoice.id, { method, amountCents: cents, receivedAt: (receivedAt ?? new Date()).toISOString(), referenceText: reference.trim(), note: note.trim() || null }),
  );

  useEffect(() => {
    if (!visible) return;
    record.reset();
    setAmount(centsToInput(invoice.openCents));
    setReceivedAt(new Date());
    setReference(invoice.bankTransfer?.reference ?? '');
    setNote('');
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const cents = parseEuro(amount);
  function check() {
    const e: Record<string, string> = {};
    if (cents === null || Number.isNaN(cents) || cents <= 0) e.amount = 'Betrag in Euro angeben.';
    else if (cents > invoice.openCents) e.amount = `Höchstens der offene Betrag (${formatMoney(invoice.openCents)}).`;
    if (!receivedAt) e.receivedAt = 'Eingangsdatum angeben.';
    else if (receivedAt.getTime() > Date.now() + 60_000) e.receivedAt = 'Das Eingangsdatum darf nicht in der Zukunft liegen.';
    if (!reference.trim()) e.reference = method === 'bank_transfer' ? 'Verwendungszweck bzw. Kontoauszug angeben.' : 'Beleg- oder Kassennummer angeben.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  useSaveShortcut(() => check() && setConfirm(true), visible && !confirm, 'dialog');
  return (
    <>
    <Sheet
      visible={visible && !confirm}
      onClose={onClose}
      title="Zahlung manuell erfassen"
      testID="zahlung-blatt"
      footer={
        <>
          <Button label="Abbrechen" onPress={onClose} />
          <Button label="Weiter" variant="primary" onPress={() => check() && setConfirm(true)} testID="zahlung-weiter" />
        </>
      }
    >
      <Banner tone="info" message="Nur Zahlungen buchen, die tatsächlich eingegangen sind (Kontoauszug, Kasse, Kartenterminal). Online-Zahlungen bucht das System nach der Anbieterbestätigung selbst." />
      <Select label="Zahlungsart" value={method} onChange={setMethod} options={(['bank_transfer', 'cash', 'card_terminal'] as ManualMethod[]).map((m) => ({ value: m, label: paymentMethodLabels[m] }))} required />
      <TextField label="Betrag in Euro" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" required error={errors.amount} help={`Offen: ${formatMoney(invoice.openCents)}`} testID="zahlung-betrag" />
      <DateTimeField label="Eingegangen am" value={receivedAt} onChange={setReceivedAt} required error={errors.receivedAt} maximumDate={new Date()} />
      <TextField label={method === 'bank_transfer' ? 'Verwendungszweck / Kontoauszug' : 'Beleg- oder Kassennummer'} value={reference} onChangeText={setReference} required error={errors.reference} testID="zahlung-referenz" />
      <TextField label="Notiz (freiwillig)" value={note} onChangeText={setNote} multiline />
    </Sheet>
      <ConfirmDialog
        visible={confirm}
        title={`Zahlung über ${cents ? formatMoney(cents) : ''} buchen?`}
        message={`${paymentMethodLabels[method]}, eingegangen ${receivedAt ? formatDateTime(receivedAt) : ''}, Referenz "${reference.trim()}". Die Buchung wird protokolliert und kann nur über eine Erstattung ausgeglichen werden.`}
        confirmLabel="Zahlung buchen"
        icon="HandCoins"
        loading={record.pending}
        onCancel={() => setConfirm(false)}
        testID="zahlung-dialog"
        onConfirm={async () => {
          try {
            await record.mutate(cents as number);
            setConfirm(false);
            toast.show('Zahlung gebucht.');
            onClose();
          } catch {
            // Fehler im Dialog
          }
        }}
      >
        <ActionError error={record.error} />
      </ConfirmDialog>
    </>
  );
}

function RefundSheet({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refund = useApiMutation((a, cents: number) => a.refundPayment(payment!.id, { amountCents: cents, idempotencyKey: key, reason: reason.trim() }));
  useEffect(() => {
    if (!payment) return;
    refund.reset();
    setAmount(centsToInput(payment.amountCents - payment.refundedCents));
    setReason('');
    setKey(newClientId().replace(/-/g, '').slice(0, 32));
    setConfirm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment?.id]);
  const cents = parseEuro(amount);
  const max = payment ? payment.amountCents - payment.refundedCents : 0;
  function check() {
    if (cents === null || Number.isNaN(cents) || cents <= 0) return setError('Betrag in Euro angeben.'), false;
    if (cents > max) return setError(`Höchstens ${formatMoney(max)}.`), false;
    if (!reason.trim()) return setError('Bitte einen Grund angeben.'), false;
    setError(null);
    return true;
  }
  return (
    <>
    <Sheet
      visible={payment !== null && !confirm}
      onClose={onClose}
      title="Erstattung"
      footer={
        <>
          <Button label="Abbrechen" onPress={onClose} />
          <Button label="Weiter" variant="primary" onPress={() => check() && setConfirm(true)} />
        </>
      }
    >
      {payment ? <AppText tone="muted">{`${paymentMethodLabels[payment.method]} über ${formatMoney(payment.amountCents)} vom ${formatDate(payment.receivedAt)}. Erstattbar: ${formatMoney(max)}.`}</AppText> : null}
      <TextField label="Betrag in Euro" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" required />
      <TextField label="Grund" value={reason} onChangeText={setReason} required multiline />
      {error ? <AppText tone="danger">{error}</AppText> : null}
    </Sheet>
      <ConfirmDialog
        visible={confirm}
        title={`${cents ? formatMoney(cents) : ''} erstatten?`}
        message={payment?.method === 'sumup_online' ? 'Die Erstattung wird beim Zahlungsanbieter beauftragt.' : 'Die Erstattung wird gebucht; die Auszahlung (bar oder Überweisung) erfolgt außerhalb der Software.'}
        confirmLabel="Erstatten"
        tone="destructive"
        loading={refund.pending}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          try {
            await refund.mutate(cents as number);
            setConfirm(false);
            toast.show('Erstattung gebucht.');
            onClose();
          } catch {
            // Fehler im Dialog
          }
        }}
      >
        <ActionError error={refund.error} />
      </ConfirmDialog>
    </>
  );
}

/** Rechnung anlegen: Betrag (vorbelegt aus erledigten Positionen), Fälligkeit, PDF. */
export function CreateInvoiceSheet({ order, visible, onClose }: { order: WorkOrderDetail; visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const suggested = order.items.filter((i) => (i.authorization === 'agreed' || i.authorization === 'approved') && i.executionStatus === 'done').reduce((s, i) => s + lineGross(i), 0);
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState<Date | null>(null);
  const [file, setFile] = useState<PickedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useApiMutation(async (a, cents: number) => {
    const ref = file ? await a.uploadFile(file, { idempotencyKey: newClientId() }) : null;
    return a.createInvoice({ workOrderId: order.id, customerId: order.customerId, totalGrossCents: cents, dueDate: due ? `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}` : null, documentFileId: ref?.id ?? null });
  });
  useEffect(() => {
    if (!visible) return;
    create.reset();
    setAmount(centsToInput(suggested || null));
    setDue(new Date(Date.now() + 14 * 86_400_000));
    setFile(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  async function submit() {
    const cents = parseEuro(amount);
    if (cents === null || Number.isNaN(cents) || cents <= 0) return setError('Rechnungsbetrag in Euro angeben.');
    setError(null);
    try {
      await create.mutate(cents);
      toast.show('Rechnungsentwurf angelegt. Der Kunde sieht ihn erst nach dem Stellen.');
      onClose();
    } catch {
      // Fehler unten
    }
  }
  useSaveShortcut(() => void submit(), visible, 'dialog');
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Rechnung anlegen"
      testID="rechnung-anlegen-blatt"
      footer={
        <>
          <Button label="Abbrechen" onPress={onClose} />
          <Button label="Entwurf anlegen" variant="primary" loading={create.pending} onPress={() => void submit()} testID="rechnung-entwurf-anlegen" />
        </>
      }
    >
      <AppText tone="muted">Die Rechnung selbst entsteht außerhalb dieser Software (eigene Rechnungserstellung ist offen, E-1 bis E-3) und wird hier als PDF mit Betrag hinterlegt.</AppText>
      <TextField label="Rechnungsbetrag brutto in Euro" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" required error={error} help={suggested ? `Summe der erledigten, vereinbarten bzw. freigegebenen Positionen: ${formatMoney(suggested)}` : undefined} testID="rechnung-betrag" />
      <DateTimeField label="Fällig am" value={due} onChange={setDue} mode="date" />
      <Button
        label={file ? `PDF: ${file.name}` : 'Rechnungs-PDF auswählen'}
        icon="Paperclip"
        onPress={async () => {
          try {
            setFile(await pickDocument(['application/pdf']));
          } catch {
            toast.show('Die Datei konnte nicht gewählt werden.', 'danger');
          }
        }}
      />
      <ActionError error={create.error} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, padding: 16, gap: 16 },
  between: { justifyContent: 'space-between', alignItems: 'center' },
});
