/**
 * Werkstatt, offene Terminanfragen von Kunden (und offene Vorschläge). Anfrage → Detail
 * (bestätigen, Alternative vorschlagen, absagen). Eine Anfrage ist noch keine Buchung.
 */
import { appointmentKindLabels, appointmentStatusLabels, routes } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { useApiQuery } from '../../../src/data/hooks';
import { formatDateTime, formatTimeRange, keepPlates } from '../../../src/lib/format';
import { QueryView } from '../../../src/screens/common';
import { EmptyState, ListGroup, ListRow, Page, PageHeader, Section, StatusChip } from '../../../src/ui';

export default function AppointmentRequests() {
  const query = useApiQuery('werkstatt:terminanfragen', async (api) => {
    const all = await api.listAppointments({});
    return { requested: all.filter((a) => a.status === 'requested'), proposed: all.filter((a) => a.status === 'proposed') };
  });
  return (
    <Page maxWidth={880} testID="werkstatt-terminanfragen">
      <PageHeader
        title="Terminanfragen"
        subtitle="Wünsche der Kunden. Erst mit der Bestätigung wird daraus ein Termin."
        backHref={routes.workshop.calendar() as Href}
        backLabel="Kalender"
        crumbs={[{ label: 'Kalender', href: routes.workshop.calendar() as Href }, { label: 'Terminanfragen' }]}
      />
      <QueryView query={query}>
        {({ requested, proposed }) => (
          <>
            <Section title={`Offen (${requested.length})`}>
              {requested.length === 0 ? (
                <EmptyState icon="CalendarCheck" title="Keine offenen Anfragen" />
              ) : (
                <ListGroup>
                  {requested.map((a, i) => (
                    <ListRow
                      key={a.id}
                      first={i === 0}
                      icon="CalendarPlus"
                      title={`${a.customerDisplayName}: ${appointmentKindLabels[a.kind]}`}
                      subtitle={`${keepPlates(a.vehicleLabel)}. Wunsch: ${formatTimeRange(a.startsAt, a.endsAt)}`}
                      meta={a.customerNote}
                      right={<StatusChip status={appointmentStatusLabels[a.status]} />}
                      onPress={() => router.push(routes.workshop.appointment(a.id) as Href)}
                      testID={`anfrage-${a.id}`}
                    />
                  ))}
                </ListGroup>
              )}
            </Section>
            {proposed.length > 0 ? (
              <Section title={`Alternative vorgeschlagen, Antwort des Kunden offen (${proposed.length})`}>
                <ListGroup>
                  {proposed.map((a, i) => {
                    const open = a.proposals.find((p) => p.status === 'open');
                    return (
                      <ListRow
                        key={a.id}
                        first={i === 0}
                        icon="CalendarBlank"
                        title={`${a.customerDisplayName}: ${appointmentKindLabels[a.kind]}`}
                        subtitle={open ? `Vorschlag: ${formatDateTime(open.startsAt)}` : keepPlates(a.vehicleLabel)}
                        right={<StatusChip status={appointmentStatusLabels[a.status]} />}
                        onPress={() => router.push(routes.workshop.appointment(a.id) as Href)}
                      />
                    );
                  })}
                </ListGroup>
              </Section>
            ) : null}
          </>
        )}
      </QueryView>
    </Page>
  );
}
