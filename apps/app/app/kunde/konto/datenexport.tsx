/**
 * Kunde, Datenexport (DSGVO Art. 15 und 20): eigene Daten als Datei über GET /me/export.
 * Enthalten sind nur Daten, die der Kunde ohnehin sehen darf; interne Notizen der Werkstatt
 * und Daten anderer Halter nicht.
 */
import { routes } from '@werkstatt/contracts';
import type { Href } from 'expo-router';
import { useState } from 'react';
import { useApi } from '../../../src/data/ApiProvider';
import { useIsOffline } from '../../../src/data/network';
import { openDownload } from '../../../src/screens/common';
import { AppText, Banner, Button, Page, PageHeader, Section, useToast } from '../../../src/ui';

export default function DataExportScreen() {
  const api = useApi();
  const toast = useToast();
  const offline = useIsOffline();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Page maxWidth={720} testID="kunde-datenexport">
      <PageHeader
        title="Datenexport"
        backHref={routes.customer.account() as Href}
        backLabel="Konto"
        crumbs={[{ label: 'Konto', href: routes.customer.account() as Href }, { label: 'Datenexport' }]}
      />
      <Section title="Was enthalten ist">
        <AppText>Ihre Kundendaten, Ihre aktuellen Fahrzeuge mit Servicehistorie, Ihre Aufträge mit Freigaben und Nachrichten, Ihre Rechnungen mit Zahlungen und die für Sie veröffentlichten Dokumente.</AppText>
        <AppText tone="muted">Nicht enthalten sind interne Notizen der Werkstatt und Daten früherer oder späterer Halter Ihrer Fahrzeuge.</AppText>
      </Section>
      {offline ? <Banner tone="info" message="Der Export ist nur mit Verbindung möglich." /> : null}
      {error ? <Banner tone="danger" title="Export fehlgeschlagen" message={error} /> : null}
      {done ? <Banner tone="success" title="Export erstellt" message={`Datei: ${done}`} testID="export-fertig" /> : null}
      <Button
        label="Export erstellen und herunterladen"
        variant="primary"
        icon="DownloadSimple"
        loading={busy}
        disabled={offline}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            const file = await api.exportOwnData();
            const res = await openDownload(file, 'Meine Daten');
            if (res === 'unsupported') toast.show('Auf diesem Gerät gibt es keine App zum Öffnen der Datei.', 'info');
            setDone(file.fileName);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Bitte später erneut versuchen.');
          } finally {
            setBusy(false);
          }
        }}
        testID="export-erstellen"
      />
      <AppText variant="small" tone="subtle">Die Datei enthält personenbezogene Daten. Bitte sicher aufbewahren und nicht weitergeben.</AppText>
    </Page>
  );
}
