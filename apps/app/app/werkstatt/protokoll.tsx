/**
 * Werkstatt, Änderungsprotokoll (audit.read): wer hat wann was geändert. Filter nach
 * Bereich (Aktionspräfix, in der URL) und Anzahl. Nur lesen.
 */
import { roleLabels, routes } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { View } from 'react-native';
import { useApiQuery } from '../../src/data/hooks';
import { formatDateTime } from '../../src/lib/format';
import { NotAvailableView, QueryView } from '../../src/screens/common';
import { auditActionLabel, auditEntityLabel, summarizeAuditData } from '../../src/screens/workshop/auditLabels';
import { useCan } from '../../src/screens/workshop/shared';
import { AppText, DataTable, EmptyState, FilterChips, Page, PageHeader } from '../../src/ui';

const AREAS = [
  { value: 'alle', label: 'Alle' },
  { value: 'work_order', label: 'Aufträge' },
  { value: 'work_item', label: 'Positionen' },
  { value: 'approval', label: 'Freigaben' },
  { value: 'intake', label: 'Annahme' },
  { value: 'invoice', label: 'Rechnungen' },
  { value: 'payment', label: 'Zahlungen' },
  { value: 'refund', label: 'Erstattungen' },
  { value: 'service_entry', label: 'Servicehistorie' },
  { value: 'vehicle', label: 'Fahrzeuge' },
  { value: 'customer', label: 'Kunden' },
  { value: 'appointment', label: 'Termine' },
  { value: 'user', label: 'Benutzer' },
  { value: 'auth', label: 'Anmeldungen' },
] as const;

export default function AuditScreen() {
  const can = useCan();
  const params = useLocalSearchParams<{ bereich?: string }>();
  const area = AREAS.some((a) => a.value === params.bereich) ? (params.bereich as (typeof AREAS)[number]['value']) : 'alle';
  const query = useApiQuery(can('audit.read') ? `werkstatt:protokoll:${area}` : null, (api) => api.listAudit({ action: area === 'alle' ? undefined : `${area}.`, limit: 200 }));
  if (!can('audit.read')) return <Page><NotAvailableView title="Protokoll nur mit Recht zur Einsicht" /></Page>;
  return (
    <Page maxWidth={1280} testID="werkstatt-protokoll">
      <PageHeader title="Änderungsprotokoll" subtitle="Die neuesten 200 Einträge. Einträge lassen sich nicht ändern oder löschen." crumbs={[{ label: 'Übersicht', href: routes.workshop.home() as Href }, { label: 'Protokoll' }]} />
      <FilterChips label="Bereich" value={area} onChange={(v) => router.setParams({ bereich: v === 'alle' ? undefined : v })} options={AREAS.map((a) => ({ value: a.value, label: a.label }))} />
      <QueryView query={query}>
        {(entries) =>
          entries.length === 0 ? (
            <EmptyState icon="ClockCounterClockwise" title="Keine Einträge" />
          ) : (
            <DataTable
              label="Protokolleinträge"
              keyboardNav
              rows={entries}
              rowKey={(e) => e.id}
              mobileTitle={(e) => auditActionLabel(e.action)}
              mobileSubtitle={(e) => `${e.actorDisplayName ?? 'System'}${e.actorRole ? ` (${roleLabels[e.actorRole]})` : ''}`}
              mobileMeta={(e) => formatDateTime(e.occurredAt)}
              columns={[
                { key: 'zeit', header: 'Zeitpunkt', render: (e) => <AppText variant="small" numeric>{formatDateTime(e.occurredAt)}</AppText>, sortValue: (e) => e.occurredAt, width: 170 },
                { key: 'wer', header: 'Wer', render: (e) => <View><AppText variant="small">{e.actorDisplayName ?? 'System'}</AppText>{e.actorRole ? <AppText variant="caption" tone="muted">{roleLabels[e.actorRole]}</AppText> : null}</View>, sortValue: (e) => e.actorDisplayName ?? '', flex: 1.2 },
                { key: 'aktion', header: 'Aktion', render: (e) => <AppText variant="small" style={{ fontWeight: '600' }}>{auditActionLabel(e.action)}</AppText>, sortValue: (e) => auditActionLabel(e.action), flex: 1.6 },
                { key: 'objekt', header: 'Objekt', render: (e) => <AppText variant="small" tone="muted">{auditEntityLabel(e.entityType)}</AppText>, sortValue: (e) => auditEntityLabel(e.entityType), flex: 0.9 },
                { key: 'daten', header: 'Angaben', render: (e) => <AppText variant="small" tone="muted" numberOfLines={3}>{summarizeAuditData(e.data) || 'ohne weitere Angaben'}</AppText>, flex: 2.4 },
              ]}
            />
          )
        }
      </QueryView>
    </Page>
  );
}
