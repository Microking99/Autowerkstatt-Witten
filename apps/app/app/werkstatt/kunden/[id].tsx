/**
 * Werkstatt, Kundenakte mit Registern: Übersicht, Fahrzeuge, Aufträge, Termine, Dokumente,
 * Kommunikation, Zugang. Bearbeiten; Fahrzeug neu; Auftrag anlegen (Kunde vorbelegt);
 * zur App einladen, Zugang sperren bzw. wieder freischalten; Datenexport (DSGVO Art. 15/20).
 */
import { appointmentKindLabels, appointmentStatusLabels, documentKindLabels, routes, type CustomerDetail } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApi } from '../../../src/data/ApiProvider';
import { useApiMutation, useApiQuery } from '../../../src/data/hooks';
import { formatDate, formatDateTime, formatKm, keepPlates } from '../../../src/lib/format';
import { QueryView, openDownload } from '../../../src/screens/common';
import { CustomerForm } from '../../../src/screens/workshop/CustomerForm';
import { ActionError, customerAccessLabels, useCan } from '../../../src/screens/workshop/shared';
import { VehicleForm } from '../../../src/screens/workshop/VehicleForm';
import { useTheme } from '../../../src/theme';
import {
  AppText,
  Banner,
  Button,
  Columns,
  ConfirmDialog,
  EmptyState,
  KeyValueList,
  ListGroup,
  ListRow,
  Page,
  PageHeader,
  Row,
  Section,
  Sheet,
  StatusChip,
  StatusTriple,
  Tabs,
  TextField,
  useTabParam,
  useToast,
} from '../../../src/ui';

const TABS = ['uebersicht', 'fahrzeuge', 'auftraege', 'termine', 'dokumente', 'kommunikation', 'zugang'] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = { uebersicht: 'Übersicht', fahrzeuge: 'Fahrzeuge', auftraege: 'Aufträge', termine: 'Termine', dokumente: 'Dokumente', kommunikation: 'Kommunikation', zugang: 'Zugang' };

export default function CustomerFile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const customerId = String(id);
  const can = useCan();
  const [tab, setTab] = useTabParam(TABS, 'uebersicht');
  const [editing, setEditing] = useState(false);
  const [newVehicle, setNewVehicle] = useState(false);
  const toast = useToast();
  const query = useApiQuery(`werkstatt:kunde:${customerId}`, (a) => a.getCustomer(customerId));
  const c = query.data;
  return (
    <Page maxWidth={1120} testID="werkstatt-kundenakte">
      <PageHeader
        title={c?.displayName ?? 'Kunde'}
        subtitle={c ? `Kundennummer ${c.customerNumber}${c.kind === 'business' ? ', Geschäftskunde' : ''}${c.isTestData ? ', Beispieldaten' : ''}` : undefined}
        backHref={routes.workshop.customers() as Href}
        backLabel="Kunden"
        crumbs={[{ label: 'Kunden', href: routes.workshop.customers() as Href }, { label: c?.displayName ?? 'Kunde' }]}
        meta={c ? <StatusChip status={customerAccessLabels[c.accessStatus]} testID="kunde-zugangsstatus" /> : null}
        actions={
          c ? (
            <>
              {can('customers.write') ? <Button label="Bearbeiten" icon="PencilSimple" onPress={() => setEditing(true)} testID="kunde-bearbeiten" /> : null}
              {can('workOrders.write') ? <Button label="Auftrag anlegen" variant="primary" icon="Plus" onPress={() => router.push(`${routes.workshop.newWorkOrder()}?kunde=${customerId}` as Href)} testID="kunde-auftrag-anlegen" /> : null}
            </>
          ) : undefined
        }
      />
      <Tabs label="Register der Kundenakte" items={TABS.map((v) => ({ value: v, label: LABELS[v] }))} value={tab} onChange={setTab} />
      <QueryView query={query} loading="detail" notAvailableTitle="Kunde nicht verfügbar">
        {(customer) => (
          <>
            {tab === 'uebersicht' ? <Overview customer={customer} /> : null}
            {tab === 'fahrzeuge' ? <Vehicles customer={customer} onNew={() => setNewVehicle(true)} /> : null}
            {tab === 'auftraege' ? <Orders customer={customer} /> : null}
            {tab === 'termine' ? <Appointments customer={customer} /> : null}
            {tab === 'dokumente' ? <Documents customer={customer} /> : null}
            {tab === 'kommunikation' ? <Communication customer={customer} /> : null}
            {tab === 'zugang' ? <Access customer={customer} /> : null}
            <Sheet visible={editing} onClose={() => setEditing(false)} title="Kundendaten bearbeiten" width={720}>
              <CustomerForm
                initial={customer}
                inDialog
                onCancel={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  toast.show('Kundendaten gespeichert.');
                }}
              />
            </Sheet>
            <Sheet visible={newVehicle} onClose={() => setNewVehicle(false)} title="Neues Fahrzeug" width={720}>
              <VehicleForm
                inDialog
                ownerCustomerId={customer.id}
                ownerName={customer.displayName}
                onCancel={() => setNewVehicle(false)}
                onSaved={(v) => {
                  setNewVehicle(false);
                  toast.show(`Fahrzeug ${v.licensePlate} angelegt.`);
                }}
              />
            </Sheet>
          </>
        )}
      </QueryView>
    </Page>
  );
}

function Overview({ customer: c }: { customer: CustomerDetail }) {
  const t = useTheme();
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const [archive, setArchive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const archiveAction = useApiMutation((a) => a.archiveCustomer(c.id));
  const address = [c.street, [c.postalCode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return (
    <>
    <Columns ratio={[1.4, 1]}>
      <View style={styles.stack}>
        <KeyValueList
          items={[
            { label: 'Name', value: [c.salutation, c.firstName, c.lastName].filter(Boolean).join(' ') || c.displayName },
            ...(c.companyName ? [{ label: 'Firma', value: c.companyName }] : []),
            { label: 'Telefon', value: c.phone ?? 'nicht hinterlegt' },
            { label: 'Mobil', value: c.mobile ?? 'nicht hinterlegt' },
            { label: 'E-Mail', value: c.email ?? 'nicht hinterlegt' },
            { label: 'Anschrift', value: address || 'nicht hinterlegt' },
            { label: 'Kunde seit', value: formatDate(c.createdAt), numeric: true },
            { label: 'Fahrzeuge', value: String(c.vehicleCount), numeric: true },
          ]}
        />
        {c.notesInternal ? (
          <View style={[styles.internal, { borderColor: t.colors.borderStrong, backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.panel }]}>
            <StatusChip status={{ label: 'Intern, nie für Kunden', tone: 'neutral', icon: 'Lock' }} />
            <AppText>{c.notesInternal}</AppText>
          </View>
        ) : null}
        {c.archivedAt ? <Banner tone="neutral" title="Archiviert" message={`Seit ${formatDate(c.archivedAt)}. Daten bleiben erhalten.`} /> : null}
      </View>
      <View style={styles.stack}>
        {can('reports.export') && can('customers.read') ? (
          <Section title="Datenexport">
            <AppText tone="muted">Auskunft und Datenübertragbarkeit (DSGVO Art. 15 und 20): alle Daten dieses Kunden als Datei.</AppText>
            <Button
              label="Daten exportieren"
              icon="DownloadSimple"
              loading={exporting}
              onPress={async () => {
                setExporting(true);
                try {
                  const res = await openDownload(await api.exportCustomerData(c.id), `Datenexport ${c.displayName}`);
                  if (res === 'unsupported') toast.show('Auf diesem Gerät gibt es keine App zum Öffnen der Datei.', 'info');
                } catch {
                  toast.show('Der Export konnte nicht erstellt werden.', 'danger');
                } finally {
                  setExporting(false);
                }
              }}
              testID="kunde-datenexport"
            />
          </Section>
        ) : null}
        {can('customers.write') && !c.archivedAt ? (
          <Section title="Archivieren">
            <AppText variant="small" tone="muted">Archivierte Kunden erscheinen nicht mehr in der Suche. Aufträge, Rechnungen und Servicehistorie bleiben erhalten.</AppText>
            <Button label="Kunde archivieren" icon="Prohibit" onPress={() => setArchive(true)} />
          </Section>
        ) : null}
      </View>
    </Columns>
      <ConfirmDialog
        visible={archive}
        title={`${c.displayName} archivieren?`}
        message="Der Kundendatensatz bleibt erhalten, erscheint aber nicht mehr in Listen und Suche."
        confirmLabel="Archivieren"
        tone="destructive"
        loading={archiveAction.pending}
        onCancel={() => setArchive(false)}
        onConfirm={async () => {
          try {
            await archiveAction.mutate();
            setArchive(false);
            toast.show('Kunde archiviert.');
          } catch {
            // Fehler im Dialog
          }
        }}
      >
        <ActionError error={archiveAction.error} />
      </ConfirmDialog>
    </>
  );
}

function Vehicles({ customer, onNew }: { customer: CustomerDetail; onNew: () => void }) {
  const can = useCan();
  const list = useApiQuery(`werkstatt:kunde:${customer.id}:fahrzeuge`, (a) => a.listVehicles({ customerId: customer.id }));
  return (
    <Section title="Fahrzeuge (aktueller Halter)" action={can('vehicles.write') ? <Button label="Fahrzeug anlegen" icon="Plus" onPress={onNew} testID="kunde-fahrzeug-neu" /> : null}>
      <QueryView query={list}>
        {(page) =>
          page.items.length === 0 ? (
            <EmptyState icon="Car" title="Keine Fahrzeuge" message="Fahrzeuge verkaufter Autos erscheinen hier nicht mehr; ihre Aufträge bleiben beim Kunden." />
          ) : (
            <ListGroup>
              {page.items.map((v, i) => (
                <ListRow key={v.id} first={i === 0} icon="Car" title={`${keepPlates(v.licensePlate)}, ${v.make} ${v.model}`} subtitle={v.vin ? `FIN ${v.vin}` : null} meta={v.lastOdometerKm ? `Zuletzt ${formatKm(v.lastOdometerKm)}` : null} onPress={() => router.push(routes.workshop.vehicle(v.id) as Href)} />
              ))}
            </ListGroup>
          )
        }
      </QueryView>
    </Section>
  );
}

function Orders({ customer }: { customer: CustomerDetail }) {
  const list = useApiQuery(`werkstatt:kunde:${customer.id}:auftraege`, (a) => a.listWorkOrders({ customerId: customer.id }));
  return (
    <QueryView query={list}>
      {(page) =>
        page.items.length === 0 ? (
          <EmptyState icon="ClipboardText" title="Keine Aufträge" action={<Button label="Auftrag anlegen" icon="Plus" onPress={() => router.push(`${routes.workshop.newWorkOrder()}?kunde=${customer.id}` as Href)} />} />
        ) : (
          <ListGroup>
            {page.items.map((o, i) => (
              <ListRow key={o.id} first={i === 0} title={`${o.orderNumber}: ${o.title}`} subtitle={`${keepPlates(o.licensePlate)}, ${keepPlates(o.vehicleLabel)}`} meta={`Geändert ${formatDate(o.updatedAt)}`} onPress={() => router.push(routes.workshop.workOrder(o.id) as Href)}>
                <StatusTriple status={o.status} compact />
              </ListRow>
            ))}
          </ListGroup>
        )
      }
    </QueryView>
  );
}

function Appointments({ customer }: { customer: CustomerDetail }) {
  const list = useApiQuery(`werkstatt:kunde:${customer.id}:termine`, async (a) => (await a.listAppointments({})).filter((x) => x.customerId === customer.id));
  return (
    <QueryView query={list}>
      {(items) =>
        items.length === 0 ? (
          <EmptyState icon="CalendarBlank" title="Keine Termine" action={<Button label="Termin anlegen" icon="CalendarPlus" onPress={() => router.push(`${routes.workshop.newAppointment()}?kunde=${customer.id}` as Href)} />} />
        ) : (
          <ListGroup>
            {items
              .sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1))
              .map((a, i) => (
                <ListRow key={a.id} first={i === 0} icon="CalendarBlank" title={`${formatDateTime(a.startsAt)}, ${appointmentKindLabels[a.kind]}`} subtitle={keepPlates(a.vehicleLabel)} right={<StatusChip status={appointmentStatusLabels[a.status]} />} onPress={() => router.push(routes.workshop.appointment(a.id) as Href)} />
              ))}
          </ListGroup>
        )
      }
    </QueryView>
  );
}

function Documents({ customer }: { customer: CustomerDetail }) {
  const api = useApi();
  const toast = useToast();
  const list = useApiQuery(`werkstatt:kunde:${customer.id}:dokumente`, (a) => a.listDocuments({ customerId: customer.id }));
  return (
    <QueryView query={list}>
      {(docs) =>
        docs.length === 0 ? (
          <EmptyState icon="FileText" title="Keine Dokumente" />
        ) : (
          <ListGroup>
            {docs.map((d, i) => (
              <ListRow
                key={d.id}
                first={i === 0}
                icon="FileText"
                title={d.title}
                subtitle={`${documentKindLabels[d.kind]}, Version ${d.currentVersion.versionNo}`}
                right={<StatusChip status={d.publishedAt ? { label: 'Veröffentlicht', tone: 'info', icon: 'Eye' } : { label: 'Intern', tone: 'neutral', icon: 'Lock' }} />}
                onPress={async () => {
                  try {
                    await openDownload(await api.downloadDocument(d.id), d.title);
                  } catch {
                    toast.show('Das Dokument konnte nicht geladen werden.', 'danger');
                  }
                }}
              />
            ))}
          </ListGroup>
        )
      }
    </QueryView>
  );
}

function Communication({ customer }: { customer: CustomerDetail }) {
  const list = useApiQuery(`werkstatt:kunde:${customer.id}:kommunikation`, async (a) => {
    const [orders, conversations] = await Promise.all([a.listWorkOrders({ customerId: customer.id }), a.listConversations()]);
    const ids = new Set(orders.items.map((o) => o.id));
    return conversations.filter((c) => ids.has(c.workOrderId));
  });
  return (
    <QueryView query={list}>
      {(items) =>
        items.length === 0 ? (
          <EmptyState icon="ChatCircleText" title="Keine Nachrichten" message="Nachrichten laufen je Auftrag im Auftrags-Chat." />
        ) : (
          <ListGroup>
            {items.map((c, i) => (
              <ListRow
                key={c.workOrderId}
                first={i === 0}
                icon="ChatCircleText"
                title={`${c.orderNumber}: ${c.title}`}
                subtitle={c.lastMessage ? `${c.lastMessage.author.displayName}: ${c.lastMessage.body || 'Foto'}` : 'Noch keine Nachricht'}
                meta={c.lastMessage ? formatDateTime(c.lastMessage.createdAt) : null}
                right={c.unreadCount > 0 ? <StatusChip status={{ label: `${c.unreadCount} ungelesen`, tone: 'warning', icon: 'ChatCircleText' }} /> : undefined}
                onPress={() => router.push(routes.workshop.workOrderTab(c.workOrderId, 'chat') as Href)}
              />
            ))}
          </ListGroup>
        )
      }
    </QueryView>
  );
}

function Access({ customer: c }: { customer: CustomerDetail }) {
  const t = useTheme();
  const can = useCan();
  const toast = useToast();
  const [email, setEmail] = useState(c.email ?? '');
  const [dialog, setDialog] = useState<'invite' | 'disable' | 'enable' | null>(null);
  const invite = useApiMutation((a) => a.inviteCustomer(c.id, { email: email.trim() }));
  const disable = useApiMutation((a) => a.disableCustomerAccount(c.id));
  const enable = useApiMutation((a) => a.enableCustomerAccount(c.id));
  useEffect(() => setEmail(c.email ?? ''), [c.email]);
  const manage = can('customerAccounts.manage');
  const status = c.accessStatus;
  const explain: Record<typeof status, string> = {
    none: 'Der Kunde hat keinen App-Zugang. Aufträge, Freigaben und Rechnungen laufen dann telefonisch, per E-Mail und vor Ort.',
    invited: 'Eine Einladung ist unterwegs. Sie gilt 7 Tage; bis dahin kann der Kunde ein Passwort festlegen.',
    active: 'Der Kunde nutzt die App: Aufträge, Freigaben, Rechnungen, Servicehistorie seiner aktuellen Fahrzeuge.',
    disabled: 'Der Zugang ist gesperrt. Der Kunde kann sich nicht anmelden; seine Daten bleiben erhalten.',
  };
  return (
    <View style={[styles.panel, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]} testID="kunde-zugang">
      <StatusChip status={customerAccessLabels[status]} />
      <AppText tone="muted">{explain[status]}</AppText>
      {!manage ? (
        <AppText variant="small" tone="subtle">Zugänge verwalten dürfen nur Mitarbeiter mit dem Recht "Kundenzugänge verwalten".</AppText>
      ) : (
        <>
          {status === 'none' || status === 'invited' ? (
            <>
              <TextField label="E-Mail-Adresse für die Einladung" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" testID="einladung-email" />
              <Button label={status === 'invited' ? 'Einladung erneut senden' : 'Zur App einladen'} variant="primary" icon="EnvelopeSimple" disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} onPress={() => setDialog('invite')} testID="kunde-einladen" />
            </>
          ) : null}
          <Row wrap>
            {status === 'active' || status === 'invited' ? <Button label="Zugang sperren" icon="Lock" onPress={() => setDialog('disable')} testID="zugang-sperren" /> : null}
            {status === 'disabled' ? <Button label="Zugang wieder freischalten" variant="primary" icon="LockOpen" onPress={() => setDialog('enable')} testID="zugang-freischalten" /> : null}
          </Row>
        </>
      )}
      <ConfirmDialog
        visible={dialog === 'invite'}
        title={`${c.displayName} zur App einladen?`}
        message={`Die Einladung geht an ${email.trim()}. Der Kunde legt selbst ein Passwort fest und sieht danach seine Aufträge und aktuellen Fahrzeuge.`}
        confirmLabel="Einladung senden"
        icon="EnvelopeSimple"
        loading={invite.pending}
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          try {
            await invite.mutate();
            setDialog(null);
            toast.show('Einladung gesendet.');
          } catch {
            // Fehler im Dialog
          }
        }}
      >
        <ActionError error={invite.error} />
      </ConfirmDialog>
      <ConfirmDialog
        visible={dialog === 'disable'}
        title="Zugang sperren?"
        message="Der Kunde wird sofort abgemeldet und kann sich nicht mehr anmelden. Daten, Aufträge und Rechnungen bleiben erhalten. Die Sperre lässt sich aufheben."
        confirmLabel="Zugang sperren"
        tone="destructive"
        icon="Lock"
        loading={disable.pending}
        onCancel={() => setDialog(null)}
        testID="sperren-dialog"
        onConfirm={async () => {
          try {
            await disable.mutate();
            setDialog(null);
            toast.show('Zugang gesperrt.');
          } catch {
            // Fehler im Dialog
          }
        }}
      >
        <ActionError error={disable.error} />
      </ConfirmDialog>
      <ConfirmDialog
        visible={dialog === 'enable'}
        title="Zugang wieder freischalten?"
        message="Der Kunde kann sich danach wieder mit seinem bisherigen Passwort anmelden. Wurde das Konto nie aktiviert, bleibt es eingeladen."
        confirmLabel="Freischalten"
        icon="LockOpen"
        loading={enable.pending}
        onCancel={() => setDialog(null)}
        testID="freischalten-dialog"
        onConfirm={async () => {
          try {
            await enable.mutate();
            setDialog(null);
            toast.show('Zugang freigeschaltet.');
          } catch {
            // Fehler im Dialog
          }
        }}
      >
        <ActionError error={enable.error} />
      </ConfirmDialog>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 24 },
  internal: { borderWidth: 1, borderStyle: 'dashed', padding: 16, gap: 8 },
  panel: { borderWidth: 1, padding: 16, gap: 12 },
});
