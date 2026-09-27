/**
 * Ehrliche Ansicht für Ergänzungen [E], deren Umfang noch offen ist (O-6 bis O-8): was die
 * Entscheidung vorsieht, was heute schon da ist und was ausdrücklich nicht umgesetzt ist.
 * Keine Fantasiefunktionen, keine Beispielzahlen.
 */
import { routes } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { AppText, Banner, Button, Icon, iconSize, Page, PageHeader, Section, StatusChip, type IconName } from '../../ui';

export function SupplementView({
  title,
  icon,
  code,
  question,
  proposal,
  today,
  open,
  testID,
}: {
  title: string;
  icon: IconName;
  code: string;
  question: string;
  proposal: string;
  today: string[];
  open: string[];
  testID: string;
}) {
  const t = useTheme();
  return (
    <Page maxWidth={800} testID={testID}>
      <PageHeader title={title} crumbs={[{ label: 'Übersicht', href: routes.workshop.home() as Href }, { label: title }]} meta={<StatusChip status={{ label: `Ergänzung, Details offen (${code})`, tone: 'warning', icon: 'HourglassMedium' }} />} />
      <View style={[styles.head, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]}>
        <View style={[styles.icon, { backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.pill }]}>
          <Icon name={icon} size={iconSize.lg} color={t.colors.textMuted} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">Offene Frage {code}</AppText>
          <AppText>{question}</AppText>
          <AppText tone="muted">Vorschlag bis zur Entscheidung: {proposal}</AppText>
        </View>
      </View>
      <Section title="Heute schon vorhanden">
        {today.map((line) => (
          <View key={line} style={styles.line}>
            <Icon name="CheckCircle" size={iconSize.sm} color={t.colors.success} />
            <AppText style={styles.flex}>{line}</AppText>
          </View>
        ))}
      </Section>
      <Section title="Noch nicht umgesetzt">
        {open.map((line) => (
          <View key={line} style={styles.line}>
            <Icon name="Minus" size={iconSize.sm} color={t.colors.textMuted} />
            <AppText tone="muted" style={styles.flex}>{line}</AppText>
          </View>
        ))}
      </Section>
      <Banner tone="info" message="Diese Ansicht zeigt bewusst keine Beispieldaten. Umfang und Abläufe werden festgelegt, sobald die offene Frage entschieden ist (docs/offene-entscheidungen.md)." />
      <Button label="Zur Übersicht" icon="SquaresFour" onPress={() => router.replace(routes.workshop.home() as Href)} />
    </Page>
  );
}

const styles = StyleSheet.create({
  head: { borderWidth: 1, padding: 16, gap: 12, flexDirection: 'row', alignItems: 'flex-start' },
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0, gap: 4 },
  line: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
