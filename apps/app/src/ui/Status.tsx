/**
 * Status immer als Text + Symbol + Farbe (docs/designsystem.md). Bezeichnungen und Töne
 * stammen aus @werkstatt/contracts (labels.ts), damit alle Clients gleich benennen.
 */
import {
  approvalOverviewLabels,
  overdueLabel,
  paymentStatusLabels,
  workOrderStatusLabels,
  type StatusLabel,
  type StatusTriple as StatusTripleDto,
  type Tone,
} from '@werkstatt/contracts';
import { StyleSheet, View } from 'react-native';
import { useTheme, type Theme } from '../theme';
import { Icon, iconSize } from './icons';
import { AppText } from './Text';

export function toneColors(t: Theme, tone: Tone): { fg: string; bg: string; border: string } {
  const c = t.colors;
  switch (tone) {
    case 'success':
      return { fg: c.success, bg: c.successSoft, border: c.successSoft };
    case 'warning':
      return { fg: c.warning, bg: c.warningSoft, border: c.warningSoft };
    case 'danger':
      return { fg: c.danger, bg: c.dangerSoft, border: c.dangerSoft };
    case 'info':
      return { fg: c.info, bg: c.infoSoft, border: c.infoSoft };
    default:
      return { fg: c.textMuted, bg: c.surfaceSunken, border: c.border };
  }
}

export function StatusChip({ status, prefix, testID }: { status: StatusLabel; prefix?: string; testID?: string }) {
  const t = useTheme();
  const colors = toneColors(t, status.tone);
  const text = prefix ? `${prefix}: ${status.label}` : status.label;
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
      testID={testID}
      style={[styles.chip, { backgroundColor: colors.bg, borderColor: colors.border, borderRadius: t.radius.pill }]}
    >
      <Icon name={status.icon} size={iconSize.sm} color={colors.fg} />
      <AppText variant="caption" style={{ color: colors.fg }} numberOfLines={2}>
        {prefix ? <AppText variant="caption" style={{ color: colors.fg, fontWeight: '400' }}>{`${prefix}: `}</AppText> : null}
        {status.label}
      </AppText>
    </View>
  );
}

/**
 * Drei getrennte Chips für Arbeit, Freigabe und Zahlung (R-AUF-5). Überfällig und
 * Abholbereit erscheinen als zusätzliche Merkmale, nie als Ersatz.
 */
export function StatusTriple({ status, compact, audience = 'staff' }: { status: StatusTripleDto; compact?: boolean; audience?: 'customer' | 'staff' }) {
  // Für Kunden aus ihrer Sicht formuliert ("Ihre Entscheidung fehlt" statt "Wartet auf Kunde").
  const approval =
    audience === 'customer' && status.approval === 'pending'
      ? { ...approvalOverviewLabels.pending, label: status.pendingApprovalCount > 1 ? `${status.pendingApprovalCount} Entscheidungen offen` : 'Ihre Entscheidung fehlt' }
      : approvalOverviewLabels[status.approval];
  return (
    <View style={[styles.triple, compact ? styles.tripleCompact : null]} accessibilityLabel="Status">
      <StatusChip prefix="Arbeit" status={workOrderStatusLabels[status.work]} />
      <StatusChip prefix="Freigabe" status={approval} />
      <StatusChip prefix="Zahlung" status={paymentStatusLabels[status.payment]} />
      {status.overdue ? <StatusChip status={overdueLabel} /> : null}
      {status.readyForPickup ? <StatusChip status={{ label: 'Abholbereit', tone: 'success', icon: 'Car' }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 28,
    borderWidth: 1,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  triple: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tripleCompact: { gap: 6 },
});
