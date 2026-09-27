import { router, usePathname, type Href } from 'expo-router';
import { Button, EmptyState, Page, PageHeader } from '../ui';

/**
 * Unbekannter Pfad innerhalb der Werkstatt- bzw. Mechanikerbereiche: Die Navigation bleibt
 * sichtbar, die Seite sagt ehrlich, dass es die Ansicht nicht gibt, und führt zurück.
 */
export function AreaNotFound({ home, homeLabel }: { home: string; homeLabel: string }) {
  const path = usePathname();
  return (
    <Page testID="ansicht-nicht-gefunden">
      <PageHeader title="Ansicht nicht gefunden" subtitle={path} />
      <EmptyState
        icon="Prohibit"
        title="Diese Adresse gibt es nicht"
        message="Vielleicht ist der Link veraltet oder unvollständig. Alle Ansichten erreichen Sie über die Navigation."
        action={<Button label={homeLabel} variant="primary" icon="House" onPress={() => router.replace(home as Href)} />}
      />
    </Page>
  );
}
