/** Veröffentlichte Dokumente (Filter Fahrzeug/Art). Öffnen über die API (rechtegeprüft). */
import { documentKindLabels, routes, type DocumentKind } from '@werkstatt/contracts';
import type { Href } from 'expo-router';
import { useState } from 'react';
import { useApi } from '../../src/data/ApiProvider';
import { useApiQuery } from '../../src/data/hooks';
import { keepPlates, formatDate, formatFileSize } from '../../src/lib/format';
import { QueryView, openDownload } from '../../src/screens/common';
import { AppText, Button, EmptyState, FilterChips, ListGroup, ListRow, Page, PageHeader, useToast } from '../../src/ui';

export default function DocumentsScreen() {
  const api = useApi();
  const toast = useToast();
  const [kind, setKind] = useState<DocumentKind | 'alle'>('alle');
  const [vehicle, setVehicle] = useState<string>('alle');
  const query = useApiQuery('kunde:dokumente', async (a) => {
    const [documents, vehicles] = await Promise.all([a.listDocuments(), a.listVehicles()]);
    return { documents, vehicles: vehicles.items };
  });
  return (
    <Page testID="kunde-dokumente">
      <PageHeader title="Dokumente" crumbs={[{ label: 'Start', href: routes.customer.home() as Href }, { label: 'Dokumente' }]} />
      <QueryView query={query} loading="list">
        {({ documents, vehicles }) => {
          const kinds = [...new Set(documents.map((d) => d.kind))];
          const shown = documents.filter((d) => (kind === 'alle' || d.kind === kind) && (vehicle === 'alle' || d.vehicleId === vehicle));
          const plate = (id: string | null) => vehicles.find((v) => v.id === id);
          return (
            <>
              <FilterChips label="Art" value={kind} onChange={setKind} options={[{ value: 'alle' as const, label: 'Alle Arten' }, ...kinds.map((k) => ({ value: k, label: documentKindLabels[k] }))]} />
              {vehicles.length > 1 ? (
                <FilterChips label="Fahrzeug" value={vehicle} onChange={setVehicle} options={[{ value: 'alle', label: 'Alle Fahrzeuge' }, ...vehicles.map((v) => ({ value: v.id, label: `${v.model} (${keepPlates(v.licensePlate)})` }))]} />
              ) : null}
              {shown.length === 0 ? (
                <EmptyState
                  icon="FileText"
                  title={documents.length === 0 ? 'Noch keine Dokumente' : 'Keine Dokumente für diesen Filter'}
                  message={documents.length === 0 ? 'Angebote, Rechnungen und Protokolle erscheinen hier, sobald die Werkstatt sie für Sie freigibt.' : undefined}
                  action={documents.length > 0 ? <Button label="Filter zurücksetzen" onPress={() => { setKind('alle'); setVehicle('alle'); }} /> : undefined}
                />
              ) : (
                <ListGroup>
                  {shown.map((d, i) => {
                    const v = plate(d.vehicleId);
                    return (
                      <ListRow
                        key={d.id}
                        first={i === 0}
                        icon={d.kind === 'invoice' ? 'Receipt' : 'FileText'}
                        title={d.title}
                        subtitle={`${documentKindLabels[d.kind]}${v ? `, ${v.make} ${v.model}` : ''}`}
                        meta={`${formatDate(d.publishedAt ?? d.createdAt)}, ${d.versionCount > 1 ? `Version ${d.currentVersion.versionNo}, ` : ''}${formatFileSize(d.currentVersion.file.sizeBytes)}`}
                        testID={`dokument-${i}`}
                        onPress={async () => {
                          try {
                            const res = await openDownload(await api.downloadDocument(d.id));
                            if (res === 'unsupported') toast.show('Das Öffnen von Dokumenten auf dem Gerät folgt in einer späteren Version.', 'info');
                          } catch {
                            toast.show('Das Dokument konnte nicht geladen werden. Bitte versuchen Sie es erneut.', 'danger');
                          }
                        }}
                      />
                    );
                  })}
                </ListGroup>
              )}
              <AppText variant="small" tone="subtle">
                Hier erscheinen nur Dokumente, die die Werkstatt für Sie veröffentlicht hat. Interne Unterlagen der Werkstatt sind nicht enthalten.
              </AppText>
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}
