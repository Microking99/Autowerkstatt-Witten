/**
 * Öffentliche Fahrzeugansicht (QR-Kurzansicht oder Freigabe für Kaufinteressenten).
 * Zeigt nie Namen, Kennzeichen, Preise, Rechnungen, Dokumente oder Nachrichten.
 */
import type { PublicVehicleView as View_ } from '@werkstatt/contracts';
import { StyleSheet, View } from 'react-native';
import { formatDate, formatKm, formatVin } from '../lib/format';
import { useTheme } from '../theme';
import { AppText, Banner, KeyValueList, StatusChip } from '../ui';
import { PublicPanel } from './common';

export function PublicVehicleHistory({ view }: { view: View_ }) {
  const t = useTheme();
  const isShare = view.source === 'share';
  return (
    <>
      <PublicPanel>
        <View style={styles.head}>
          <AppText variant="caption" tone="subtle">
            {isShare ? 'Freigegebene Servicehistorie' : 'Serviceheft (öffentliche Kurzansicht)'}
          </AppText>
          <AppText variant="display">
            {view.make} {view.model}
          </AppText>
          {view.variant ? <AppText tone="muted">{view.variant}</AppText> : null}
        </View>
        <KeyValueList
          columns={1}
          items={[
            ...(view.vin ? [{ label: 'FIN', value: formatVin(view.vin), code: true }] : []),
            { label: 'Werkstatt', value: view.workshopName },
            ...(view.expiresAt ? [{ label: 'Freigabe gültig bis', value: formatDate(view.expiresAt), numeric: true }] : []),
            { label: 'Einträge', value: String(view.entries.length), numeric: true },
          ]}
        />
        <Banner
          tone="info"
          message={
            isShare
              ? 'Der Halter hat ausschließlich diese Einträge für Sie freigegeben. Namen, Rechnungen, Preise und weitere Unterlagen sind nicht enthalten.'
              : 'Diese Kurzansicht hat der Halter freigegeben. Sie enthält keine persönlichen Daten, Preise oder Unterlagen.'
          }
        />
      </PublicPanel>
      <View style={styles.list} accessibilityRole="list">
        {view.entries.length === 0 ? (
          <PublicPanel>
            <AppText tone="muted">Es sind keine Einträge freigegeben.</AppText>
          </PublicPanel>
        ) : (
          view.entries.map((e, i) => (
            <View key={`${e.performedOn}-${i}`} style={[styles.entry, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radius.panel }]} testID="oeffentlicher-eintrag">
              <View style={styles.entryHead}>
                <AppText variant="heading" style={styles.flex}>
                  {e.title}
                </AppText>
                {e.revisionNo > 1 ? <StatusChip status={{ label: 'Korrigiert', tone: 'info', icon: 'PencilSimple' }} /> : null}
              </View>
              <AppText tone="muted" numeric>
                {formatDate(e.performedOn)}, {formatKm(e.odometerKm)}
              </AppText>
              {e.details ? <AppText>{e.details}</AppText> : null}
              {e.nextDueDate || e.nextDueKm ? (
                <AppText variant="small" tone="subtle" numeric>
                  Nächste Fälligkeit: {[e.nextDueDate ? formatDate(e.nextDueDate) : null, e.nextDueKm ? formatKm(e.nextDueKm) : null].filter(Boolean).join(' oder ')}
                </AppText>
              ) : null}
            </View>
          ))
        )}
      </View>
      <AppText variant="small" tone="subtle">
        Einträge entstehen nur aus abgeschlossenen Wartungsarbeiten der {view.workshopName}. Es besteht keine Verbindung zu digitalen Serviceheften der Hersteller.
      </AppText>
    </>
  );
}

const styles = StyleSheet.create({
  head: { gap: 4 },
  list: { gap: 12 },
  entry: { borderWidth: 1, padding: 16, gap: 6 },
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 160 },
});
