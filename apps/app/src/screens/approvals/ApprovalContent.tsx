/**
 * Inhalt einer Freigabeanfrage, wie der Kunde ihn sieht. Gemeinsam genutzt von der
 * Kundenansicht (Entscheidung) und der Werkstatt ("Vorschau wie beim Kunden").
 * Summen aus @werkstatt/domain (`calculateTotals`, Rundung je Zeile wie in der API).
 */
import type { ApprovalKind, ApprovalLine } from '@werkstatt/contracts';
import { calculateTotals } from '@werkstatt/domain';
import { StyleSheet, View } from 'react-native';
import { formatDateTime, formatMoney, formatPercentBp } from '../../lib/format';
import { useTheme } from '../../theme';
import { AppText, Banner, Button, MoneyText, PhotoGrid, Row, Section, StatusChip, type PhotoItem } from '../../ui';

export interface ApprovalContentData {
  kind: ApprovalKind;
  title: string;
  summaryCustomer: string;
  lines: ApprovalLine[];
  scheduleChange?: string | null;
  newReadyAt?: string | null;
}

/** Summen einer Anfrage (netto, USt, brutto) wie in der API. */
export function approvalTotals(lines: readonly ApprovalLine[]) {
  try {
    return calculateTotals(lines.map((l) => ({ quantity: l.quantity, unitPriceCents: l.unitPriceCents, vatRateBp: l.vatRateBp })));
  } catch {
    return null;
  }
}

export function ApprovalLinesTable({ lines, testID = 'freigabe-positionen' }: { lines: ApprovalLine[]; testID?: string }) {
  const t = useTheme();
  const totals = approvalTotals(lines);
  return (
    <View style={[styles.table, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]} testID={testID}>
      {lines.map((l, i) => (
        <View key={`${l.title}-${i}`} style={[styles.line, { borderTopColor: t.colors.border, borderTopWidth: i === 0 ? 0 : 1 }]}>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">{l.title}</AppText>
            {l.description ? (
              <AppText variant="small" tone="muted">
                {l.description}
              </AppText>
            ) : null}
            <AppText variant="small" tone="subtle" numeric>
              {String(l.quantity).replace('.', ',')} {l.unit} × {formatMoney(l.unitPriceCents)} netto, USt {formatPercentBp(l.vatRateBp)}
            </AppText>
          </View>
          <MoneyText cents={totals?.lineNetCents[i] ?? 0} />
        </View>
      ))}
      {totals ? (
        <View style={[styles.totals, { borderTopColor: t.colors.borderStrong }]}>
          <Row style={styles.between}>
            <AppText tone="muted">Summe netto</AppText>
            <MoneyText cents={totals.totalNetCents} tone="muted" />
          </Row>
          {totals.vatBreakdown.map((v) => (
            <Row key={v.vatRateBp} style={styles.between}>
              <AppText tone="muted">Umsatzsteuer {formatPercentBp(v.vatRateBp)}</AppText>
              <MoneyText cents={v.vatCents} tone="muted" />
            </Row>
          ))}
          <Row style={styles.between}>
            <AppText variant="heading">Gesamt</AppText>
            <MoneyText cents={totals.totalGrossCents} variant="heading" testID="freigabe-gesamt" />
          </Row>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Vorschau wie beim Kunden: Beschreibung, Fotos, Positionen und Kosten, Terminänderung und
 * die Entscheidungsfläche (hier ohne Funktion).
 */
export function ApprovalCustomerPreview({ content, photos, versionNo = 1 }: { content: ApprovalContentData; photos: PhotoItem[]; versionNo?: number }) {
  const t = useTheme();
  const totals = approvalTotals(content.lines);
  const isOffer = content.kind === 'offer';
  return (
    <View style={[styles.preview, { borderColor: t.colors.borderStrong, borderRadius: t.radius.panel, backgroundColor: t.colors.bg }]} testID="vorschau-kunde">
      <Banner tone="info" title="Vorschau: So sieht der Kunde die Anfrage" message="Interne Notizen, Einkaufspreise und nicht ausgewählte Fotos sieht der Kunde nicht." />
      <AppText variant="title">{content.title || 'Ohne Titel'}</AppText>
      <Row wrap>
        <StatusChip status={{ label: 'Wartet auf Ihre Entscheidung', tone: 'warning', icon: 'HourglassMedium' }} />
        <AppText variant="small" tone="subtle">
          {isOffer ? 'Angebot' : 'Zusatzarbeit'}, Version {versionNo}
        </AppText>
      </Row>
      <Section title="Beschreibung">
        <AppText>{content.summaryCustomer || 'Noch keine Beschreibung für den Kunden.'}</AppText>
      </Section>
      {photos.length > 0 ? (
        <Section title="Fotos">
          <PhotoGrid photos={photos} />
        </Section>
      ) : null}
      <Section title="Positionen und Kosten">
        <ApprovalLinesTable lines={content.lines} testID="vorschau-positionen" />
      </Section>
      {content.scheduleChange || content.newReadyAt ? (
        <Section title="Terminänderung">
          {content.scheduleChange ? <AppText>{content.scheduleChange}</AppText> : null}
          {content.newReadyAt ? (
            <AppText variant="bodyStrong" numeric>
              Voraussichtlich fertig: {formatDateTime(content.newReadyAt)}
            </AppText>
          ) : null}
        </Section>
      ) : null}
      <View style={[styles.decide, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]}>
        <AppText variant="heading">Ihre Entscheidung</AppText>
        <AppText tone="muted">Der Kunde entscheidet über genau diese Version. Eine Zusage im Chat gilt nicht als Freigabe.</AppText>
        <Row wrap>
          <Button label="Ablehnen" icon="XCircle" disabled accessibilityHint="In der Vorschau ohne Funktion" />
          <Button label={totals ? `Freigeben (${formatMoney(totals.totalGrossCents)})` : 'Freigeben'} variant="primary" icon="CheckCircle" disabled accessibilityHint="In der Vorschau ohne Funktion" />
        </Row>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0, gap: 2 },
  between: { justifyContent: 'space-between' },
  table: { borderWidth: 1, overflow: 'hidden' },
  line: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'flex-start' },
  totals: { borderTopWidth: 2, paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  preview: { borderWidth: 2, borderStyle: 'dashed', padding: 16, gap: 16 },
  decide: { borderWidth: 1, padding: 16, gap: 12 },
});
