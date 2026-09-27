/**
 * Werkstatt, Auftrag, Register Rechnung: Rechnung(en) zum Auftrag mit Zahlungen,
 * Zahlungsversuchen und Erstattungen. Rechnung anlegen (PDF und Betrag), stellen,
 * stornieren; manuelle Zahlung und Erstattung nur mit dem jeweiligen Recht.
 */
import type { WorkOrderDetail } from '@werkstatt/contracts';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useApiQuery } from '../../../../src/data/hooks';
import { QueryView } from '../../../../src/screens/common';
import { CreateInvoiceSheet, InvoicePanel } from '../../../../src/screens/workshop/InvoicePanel';
import { WorkOrderFrame } from '../../../../src/screens/workshop/WorkOrderFrame';
import { useCan } from '../../../../src/screens/workshop/shared';
import { AppText, Button, EmptyState, Row } from '../../../../src/ui';

export default function InvoiceTab() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <WorkOrderFrame id={String(id)} tab="rechnung" testID="werkstatt-rechnung">
      {(order) => <Invoices order={order} />}
    </WorkOrderFrame>
  );
}

function Invoices({ order }: { order: WorkOrderDetail }) {
  const can = useCan();
  const [create, setCreate] = useState(false);
  const list = useApiQuery(`werkstatt:auftrag-rechnungen:${order.id}`, async (a) => (await a.listInvoices({ customerId: order.customerId })).filter((i) => i.workOrderId === order.id));
  const canCreate = can('invoices.write') && order.status.work !== 'cancelled' && order.status.work !== 'draft';
  return (
    <QueryView query={list}>
      {(invoices) => (
        <>
          <Row wrap style={{ justifyContent: 'space-between' }}>
            <AppText tone="muted">Arbeitsstatus, Freigabestatus und Zahlungsstatus sind getrennt. Bezahlt gilt erst nach geprüfter Bestätigung oder manueller Buchung.</AppText>
            {canCreate ? <Button label="Rechnung anlegen" icon="Plus" variant={invoices.length === 0 ? 'primary' : 'secondary'} onPress={() => setCreate(true)} testID="rechnung-anlegen" /> : null}
          </Row>
          {invoices.length === 0 ? (
            <EmptyState icon="Receipt" title="Noch keine Rechnung" message={canCreate ? 'Rechnung anlegen, sobald die Arbeiten erledigt sind.' : 'Für Rechnungen fehlt Ihnen das Recht oder der Auftrag ist noch ein Entwurf.'} />
          ) : (
            invoices.map((inv) => <InvoicePanel key={inv.id} invoice={inv} />)
          )}
          <CreateInvoiceSheet order={order} visible={create} onClose={() => setCreate(false)} />
        </>
      )}
    </QueryView>
  );
}
