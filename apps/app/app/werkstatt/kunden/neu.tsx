/**
 * Werkstatt, Kunde anlegen: Kundendatensatz (ohne App-Konto). Nach dem Speichern zur
 * Kundenakte; die Einladung zur App erfolgt dort im Register Zugang.
 */
import { routes } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { CustomerForm } from '../../../src/screens/workshop/CustomerForm';
import { Page, PageHeader, useToast } from '../../../src/ui';

export default function NewCustomer() {
  const toast = useToast();
  return (
    <Page maxWidth={760} testID="werkstatt-kunde-neu">
      <PageHeader
        title="Kunde anlegen"
        subtitle="Kundendatensatz ohne App-Zugang. Einladen können Sie danach in der Akte."
        backHref={routes.workshop.customers() as Href}
        backLabel="Kunden"
        crumbs={[{ label: 'Kunden', href: routes.workshop.customers() as Href }, { label: 'Kunde anlegen' }]}
      />
      <CustomerForm
        onCancel={() => router.back()}
        onSaved={(c) => {
          toast.show(`Kunde ${c.displayName} angelegt.`);
          router.replace(routes.workshop.customer(c.id) as Href);
        }}
      />
    </Page>
  );
}
