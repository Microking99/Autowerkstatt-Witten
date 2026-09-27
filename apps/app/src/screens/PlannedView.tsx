import { router, usePathname, type Href } from 'expo-router';
import { Button, EmptyState, Page, PageHeader } from '../ui';

/**
 * Platzhalter innerhalb der Werkstatt- und Mechanikerbereiche: Die Navigation bleibt
 * sichtbar; die Ansicht selbst folgt mit Paket APP-2. Ehrlich statt leer.
 */
export function PlannedView({ home, homeLabel }: { home: string; homeLabel: string }) {
  const path = usePathname();
  return (
    <Page testID="ansicht-folgt">
      <PageHeader title="Ansicht folgt" subtitle={path} />
      <EmptyState
        icon="Wrench"
        title="Diese Ansicht ist im Entwurf noch nicht umgesetzt"
        message="Für Werkstatt und Mechaniker gibt es bisher die Navigation und die Startseite. Die weiteren Ansichten entstehen im nächsten Arbeitspaket nach docs/ansichten-und-routen.md."
        action={<Button label={homeLabel} variant="primary" icon="House" onPress={() => router.replace(home as Href)} />}
      />
    </Page>
  );
}
