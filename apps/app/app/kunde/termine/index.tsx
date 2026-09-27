/** Termine: angefragt, Alternative vorgeschlagen, bestätigt. Anfragen; Alternative annehmen/ablehnen im Detail. */
import { routes, type Appointment } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { useApiQuery } from '../../../src/data/hooks';
import { appointmentStatusLabels, appointmentTitle, appointmentWhen } from '../../../src/screens/customer/helpers';
import { QueryView } from '../../../src/screens/common';
import { AppText, Button, Card, EmptyState, Page, PageHeader, Section, StatusChip, Tabs, useTabParam } from '../../../src/ui';

const TABS = ['anstehend', 'vergangen'] as const;

function AppointmentCard({ a }: { a: Appointment }) {
  return (
    <Card tone={a.status === 'proposed' ? 'attention' : 'default'} onPress={() => router.push(routes.customer.appointment(a.id) as Href)} accessibilityLabel={`${appointmentTitle(a)}, ${appointmentStatusLabels[a.status].label}`} testID={`termin-${a.id}`}>
      <StatusChip status={appointmentStatusLabels[a.status]} />
      <AppText variant="heading">{appointmentTitle(a)}</AppText>
      <AppText tone="muted" numeric>
        {appointmentWhen(a)}
      </AppText>
    </Card>
  );
}

export default function AppointmentsScreen() {
  const [tab, setTab] = useTabParam(TABS, 'anstehend');
  const query = useApiQuery('kunde:termine', (api) => api.listAppointments());
  const now = new Date().toISOString();
  const all = query.data ?? [];
  const upcoming = all.filter((a) => ['requested', 'proposed', 'confirmed'].includes(a.status) && (a.endsAt >= now || a.status !== 'confirmed'));
  const past = all.filter((a) => !upcoming.includes(a)).reverse();
  return (
    <Page testID="kunde-termine">
      <PageHeader
        title="Termine"
        crumbs={[{ label: 'Start', href: routes.customer.home() as Href }, { label: 'Termine' }]}
        actions={<Button label="Termin anfragen" variant="primary" icon="CalendarPlus" onPress={() => router.push(routes.customer.requestAppointment() as Href)} testID="termin-anfragen" />}
      />
      <Tabs label="Termine" value={tab} onChange={setTab} items={[{ value: 'anstehend', label: 'Anstehend', count: query.data ? upcoming.length : undefined }, { value: 'vergangen', label: 'Vergangen' }]} />
      <QueryView query={query} loading="cards">
        {() => {
          if (tab === 'vergangen') {
            return past.length === 0 ? <EmptyState icon="CalendarBlank" title="Keine vergangenen Termine" /> : past.map((a) => <AppointmentCard key={a.id} a={a} />);
          }
          if (upcoming.length === 0) {
            return <EmptyState icon="CalendarBlank" title="Keine anstehenden Termine" message="Fragen Sie einen Termin an; die Werkstatt bestätigt ihn oder schlägt eine Alternative vor." action={<Button label="Termin anfragen" variant="primary" onPress={() => router.push(routes.customer.requestAppointment() as Href)} />} />;
          }
          const proposed = upcoming.filter((a) => a.status === 'proposed');
          const requested = upcoming.filter((a) => a.status === 'requested');
          const confirmed = upcoming.filter((a) => a.status === 'confirmed');
          return (
            <>
              {proposed.length > 0 ? <Section title="Ihre Rückmeldung ist gefragt">{proposed.map((a) => <AppointmentCard key={a.id} a={a} />)}</Section> : null}
              {requested.length > 0 ? (
                <Section title="Angefragt, noch nicht bestätigt">
                  <AppText variant="small" tone="subtle">
                    Eine Anfrage ist noch keine Buchung. Die Werkstatt bestätigt oder schlägt eine Alternative vor.
                  </AppText>
                  {requested.map((a) => <AppointmentCard key={a.id} a={a} />)}
                </Section>
              ) : null}
              {confirmed.length > 0 ? <Section title="Bestätigt">{confirmed.map((a) => <AppointmentCard key={a.id} a={a} />)}</Section> : null}
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}
