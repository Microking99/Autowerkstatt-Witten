/**
 * Kunde, Fahrzeugannahme ansehen und bestätigen: Anliegen, km-Stand, Vorschäden,
 * vereinbarte Leistungen mit Preisen, Kostenrahmen, Hinweise. Die Bestätigung ist an den
 * Inhalts-Hash gebunden und deckt nur die aufgeführten Leistungen (R-ANN-3); alles
 * Weitere fragt die Werkstatt eigens an. Ohne Verbindung keine Bestätigung.
 */
import { routes, type Intake, type WorkOrderDetail } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError, ERROR_CODES } from '../../../../src/data/errors';
import { useApiMutation, useApiQuery } from '../../../../src/data/hooks';
import { useIsOffline } from '../../../../src/data/network';
import { formatDateTime, formatKm, formatMoney, keepPlates } from '../../../../src/lib/format';
import { QueryView } from '../../../../src/screens/common';
import { lineGross } from '../../../../src/screens/customer/money';
import { useTheme } from '../../../../src/theme';
import { AppText, Banner, Button, ConfirmDialog, KeyValueList, MoneyText, Page, PageHeader, Row, Section, StatusChip, useToast } from '../../../../src/ui';

export default function CustomerIntake() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id);
  const query = useApiQuery(`kunde:annahme:${orderId}`, async (api) => {
    const [order, intake] = await Promise.all([api.getWorkOrder(orderId), api.getIntake(orderId)]);
    return { order, intake };
  });
  return (
    <Page maxWidth={760} testID="kunde-annahme">
      <PageHeader
        title="Fahrzeugannahme"
        subtitle={query.data ? `Auftrag ${query.data.order.orderNumber}, ${keepPlates(query.data.order.vehicleLabel)} ${keepPlates(query.data.order.licensePlate)}` : undefined}
        backHref={routes.customer.workOrder(orderId) as Href}
        backLabel="Auftrag"
        crumbs={[
          { label: 'Aufträge', href: routes.customer.workOrders() as Href },
          { label: query.data?.order.orderNumber ?? 'Auftrag', href: routes.customer.workOrder(orderId) as Href },
          { label: 'Annahme' },
        ]}
      />
      <QueryView query={query} loading="detail" notAvailableTitle="Annahme nicht verfügbar">
        {({ order, intake }) => <IntakeView order={order} intake={intake} onReload={() => void query.refetch()} />}
      </QueryView>
    </Page>
  );
}

function IntakeView({ order, intake, onReload }: { order: WorkOrderDetail; intake: Intake; onReload: () => void }) {
  const t = useTheme();
  const toast = useToast();
  const offline = useIsOffline();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [changed, setChanged] = useState(false);
  const confirm = useApiMutation((api) => api.confirmIntake(order.id, { method: 'app', contentHash: intake.contentHash ?? '' }));
  const agreed = order.items.filter((i) => i.origin === 'intake');
  const total = agreed.reduce((s, i) => s + lineGross(i), 0);
  const confirmed = !!intake.confirmedAt;
  return (
    <>
      <Row wrap>
        <StatusChip status={confirmed ? { label: `Bestätigt am ${formatDateTime(intake.confirmedAt)}`, tone: 'success', icon: 'SealCheck' } : { label: 'Noch nicht bestätigt', tone: 'warning', icon: 'HourglassMedium' }} testID="annahme-status" />
      </Row>
      {changed ? (
        <Banner tone="warning" title="Die Annahme wurde geändert" message="Die Werkstatt hat die Annahme inzwischen geändert. Bitte prüfen Sie die aktuelle Fassung." action={<Button label="Aktuelle Fassung laden" icon="ArrowsClockwise" onPress={() => { setChanged(false); onReload(); }} />} />
      ) : null}
      <Section title="Ihr Anliegen">
        <AppText>{intake.customerComplaint}</AppText>
      </Section>
      <KeyValueList
        columns={1}
        items={[
          { label: 'Kilometerstand bei Annahme', value: formatKm(intake.odometerKm), numeric: true },
          ...(intake.fuelLevel ? [{ label: 'Tankfüllung', value: intake.fuelLevel }] : []),
          ...(intake.costLimitCents ? [{ label: 'Kostenrahmen', value: formatMoney(intake.costLimitCents), numeric: true }] : []),
        ]}
      />
      {intake.damages.length > 0 ? (
        <Section title="Vorhandene Schäden">
          {intake.damages.map((d, i) => (
            <AppText key={i}>
              <AppText variant="bodyStrong">{d.area}: </AppText>
              {d.description}
            </AppText>
          ))}
        </Section>
      ) : null}
      <Section title="Vereinbarte Leistungen">
        {intake.agreedServices ? <AppText>{intake.agreedServices}</AppText> : null}
        {agreed.length > 0 ? (
          <View style={[styles.table, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]}>
            {agreed.map((i, n) => (
              <Row key={i.id} style={[styles.line, { borderTopColor: t.colors.border, borderTopWidth: n === 0 ? 0 : 1 }]}>
                <AppText style={styles.flex}>{i.title}</AppText>
                {i.unitPriceCents !== null && i.unitPriceCents !== undefined ? <MoneyText cents={lineGross(i)} /> : null}
              </Row>
            ))}
            {total > 0 ? (
              <Row style={[styles.line, { borderTopColor: t.colors.borderStrong, borderTopWidth: 2 }]}>
                <AppText variant="bodyStrong" style={styles.flex}>Summe (brutto)</AppText>
                <MoneyText cents={total} strong />
              </Row>
            ) : null}
          </View>
        ) : null}
      </Section>
      {intake.notesCustomer ? (
        <Section title="Hinweise der Werkstatt">
          <AppText>{intake.notesCustomer}</AppText>
        </Section>
      ) : null}
      <Banner tone="info" title="Was Sie bestätigen" message="Ihre Bestätigung gilt nur für die aufgeführten Leistungen. Stellt die Werkstatt weitere nötige Arbeiten fest, fragt sie Sie mit Preis gesondert an; ohne Ihre Freigabe wird nichts Zusätzliches ausgeführt." />
      {!confirmed ? (
        <>
          {offline ? <Banner tone="info" message="Ohne Verbindung ist keine Bestätigung möglich." /> : null}
          <Button label="Annahme bestätigen" variant="primary" icon="Signature" disabled={offline || changed} onPress={() => setConfirmOpen(true)} testID="annahme-bestaetigen" />
        </>
      ) : null}
      <ConfirmDialog
        visible={confirmOpen}
        title={total > 0 ? `Annahme mit Leistungen über ${formatMoney(total)} bestätigen?` : 'Annahme bestätigen?'}
        message="Sie bestätigen Anliegen, km-Stand, Vorschäden und die aufgeführten Leistungen. Die Bestätigung deckt nur diese Leistungen, keine späteren Zusatzarbeiten."
        confirmLabel="Bestätigen"
        icon="Signature"
        loading={confirm.pending}
        onCancel={() => setConfirmOpen(false)}
        testID="annahme-dialog"
        onConfirm={async () => {
          try {
            await confirm.mutate();
            setConfirmOpen(false);
            toast.show('Annahme bestätigt. Vielen Dank.');
          } catch (e) {
            setConfirmOpen(false);
            if ((e as ApiError).code === ERROR_CODES.intakeChanged) setChanged(true);
            else toast.show((e as ApiError).message ?? 'Nicht bestätigt.', 'danger');
          }
        }}
      />
      <Button label="Zum Auftrag" variant="quiet" iconRight="CaretRight" onPress={() => router.push(routes.customer.workOrder(order.id) as Href)} />
    </>
  );
}

const styles = StyleSheet.create({
  table: { borderWidth: 1, overflow: 'hidden' },
  line: { paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'space-between' },
  flex: { flex: 1, minWidth: 0 },
});
