/**
 * Simulierte Zahlungsseite des Anbieters (nur Demo). Klar gekennzeichnet; es werden keine
 * Kartendaten abgefragt. "Zahlung abschließen" ändert nichts an der Rechnung: Erst die
 * Anbieterbestätigung (Demo-Steuerung) und die Prüfung durch den Server setzen "Bezahlt".
 */
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatMoney } from '../lib/format';
import { useTheme } from '../theme';
import { AppText, Banner, Button, Icon, iconSize, KeyValueList, Row } from '../ui';

export function DemoProviderPage({
  visible,
  amountCents,
  reference,
  merchant,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  amountCents: number;
  reference: string;
  merchant: string;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen">
      <View style={[styles.fill, { backgroundColor: t.colors.surfaceSunken, paddingTop: insets.top }]} testID="demo-anbieterseite">
        <View style={[styles.bar, { backgroundColor: t.colors.warningSoft, borderBottomColor: t.colors.border }]}>
          <Icon name="Flask" size={iconSize.md} color={t.colors.warning} />
          <AppText variant="bodyStrong" style={styles.fill}>
            Simulierte Zahlungsseite des Anbieters (Demo)
          </AppText>
        </View>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
          <View style={[styles.card, { backgroundColor: t.colors.surfaceRaised, borderColor: t.colors.border, borderRadius: t.radius.sheet }]}>
            <Row>
              <Icon name="Lock" size={iconSize.md} color={t.colors.textMuted} />
              <AppText tone="muted">Anbieter-Checkout (hier nur nachgestellt)</AppText>
            </Row>
            <AppText variant="display" numeric>
              {formatMoney(amountCents)}
            </AppText>
            <KeyValueList
              columns={1}
              items={[
                { label: 'Empfänger', value: merchant },
                { label: 'Referenz', value: reference, code: true },
              ]}
            />
            <Banner
              tone="warning"
              message="Dies ist keine echte Zahlungsseite. Es werden keine Kartendaten abgefragt und kein Geld bewegt. In der echten App öffnet sich hier die gesicherte Seite des Zahlungsanbieters."
            />
            <View style={styles.actions}>
              <Button label="Bezahlen (simuliert)" variant="primary" icon="CreditCard" onPress={onSubmit} testID="anbieter-abschliessen" fullWidth />
              <Button label="Abbrechen" onPress={onCancel} testID="anbieter-abbrechen" fullWidth />
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  content: { padding: 16, alignItems: 'center' },
  card: { width: '100%', maxWidth: 480, borderWidth: 1, padding: 24, gap: 16 },
  actions: { gap: 12 },
});
