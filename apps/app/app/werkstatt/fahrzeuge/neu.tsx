/**
 * Werkstatt, Fahrzeug anlegen: zuerst Halter wählen (oder neu anlegen), dann Fahrzeugdaten.
 * Speichern → Fahrzeugakte.
 */
import { routes, type CustomerDetail, type CustomerSummary } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { useApiQuery } from '../../../src/data/hooks';
import { CustomerForm } from '../../../src/screens/workshop/CustomerForm';
import { VehicleForm } from '../../../src/screens/workshop/VehicleForm';
import { Banner, Button, ListGroup, ListRow, Page, PageHeader, SearchField, Section, Sheet, useToast } from '../../../src/ui';

export default function NewVehicle() {
  const params = useLocalSearchParams<{ kunde?: string }>();
  const toast = useToast();
  const [owner, setOwner] = useState<{ id: string; displayName: string } | null>(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const preset = useApiQuery(params.kunde && !owner ? `werkstatt:fahrzeug-neu:halter:${params.kunde}` : null, (a) => a.getCustomer(params.kunde!));
  const current = owner ?? (preset.data ? { id: preset.data.id, displayName: preset.data.displayName } : null);
  const list = useApiQuery(current ? null : `werkstatt:fahrzeug-neu:kunden:${q.trim()}`, (a) => a.listCustomers({ q: q.trim() || undefined }));
  return (
    <Page maxWidth={800} testID="werkstatt-fahrzeug-neu">
      <PageHeader title="Fahrzeug anlegen" backHref={routes.workshop.vehicles() as Href} backLabel="Fahrzeuge" crumbs={[{ label: 'Fahrzeuge', href: routes.workshop.vehicles() as Href }, { label: 'Fahrzeug anlegen' }]} />
      {current ? (
        <>
          <Banner tone="success" title={`Halter: ${current.displayName}`} action={<Button label="Anderen Halter wählen" variant="quiet" onPress={() => setOwner(null)} />} />
          <VehicleForm
            ownerCustomerId={current.id}
            onCancel={() => router.back()}
            onSaved={(v) => {
              toast.show(`Fahrzeug ${v.licensePlate} angelegt.`);
              router.replace(routes.workshop.vehicle(v.id) as Href);
            }}
          />
        </>
      ) : (
        <Section title="Halter wählen" action={<Button label="Neuer Kunde" icon="UserPlus" onPress={() => setCreating(true)} />}>
          <SearchField value={q} onChangeText={setQ} label="Kunden suchen" placeholder="Name, Telefon oder E-Mail" />
          <ListGroup>
            {(list.data?.items ?? []).slice(0, 12).map((c: CustomerSummary, i) => (
              <ListRow key={c.id} first={i === 0} icon="UserCircle" title={c.displayName} subtitle={[c.customerNumber, c.phone].filter(Boolean).join(', ')} onPress={() => setOwner({ id: c.id, displayName: c.displayName })} />
            ))}
          </ListGroup>
        </Section>
      )}
      <Sheet visible={creating} onClose={() => setCreating(false)} title="Neuer Kunde" width={680}>
        <CustomerForm
          inDialog
          compact
          submitLabel="Kunde anlegen und übernehmen"
          onCancel={() => setCreating(false)}
          onSaved={(c: CustomerDetail) => {
            setCreating(false);
            setOwner({ id: c.id, displayName: c.displayName });
          }}
        />
      </Sheet>
    </Page>
  );
}
