/**
 * Seitengerüst, Abschnitte, Zeilen, Schlüssel-Wert-Listen, Seitenkopf mit Zurück bzw.
 * Brotkrumen. Karten nur für echte Einheiten; sonst Gruppierung über Abstand und Linien.
 */
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native';
import { useBreakpoint, useTheme } from '../theme';
import { IconButton } from './Button';
import { Icon, iconSize, type IconName } from './icons';
import { AppText } from './Text';

type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

export function Page({
  children,
  maxWidth = 960,
  onRefresh,
  refreshing,
  testID,
  contentStyle,
}: {
  children: ReactNode;
  maxWidth?: number;
  onRefresh?: () => void;
  refreshing?: boolean;
  testID?: string;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const { pagePadding, device } = useBreakpoint();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={[{ paddingHorizontal: pagePadding, paddingTop: device === 'phone' ? 16 : 24, paddingBottom: 48 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh && Platform.OS !== 'web' ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.colors.accent} /> : undefined}
      testID={testID}
    >
      <View style={[styles.pageInner, { maxWidth }, contentStyle]}>{children}</View>
    </ScrollView>
  );
}

export interface Crumb {
  label: string;
  href?: Href;
}

/** Zurück: mobil Pfeil (Verlauf, sonst übergeordnete Ansicht), am PC Brotkrumen. */
export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  crumbs,
  actions,
  meta,
}: {
  title: string;
  subtitle?: string;
  backHref?: Href;
  backLabel?: string;
  crumbs?: Crumb[];
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  const t = useTheme();
  const { device } = useBreakpoint();
  const showCrumbs = device === 'desktop' && crumbs && crumbs.length > 0;
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else if (backHref) router.replace(backHref);
  };
  return (
    <View style={styles.header}>
      {showCrumbs ? (
        <View role="navigation" aria-label="Brotkrumen" style={styles.crumbs}>
          {crumbs!.map((c, i) => (
            <View key={`${c.label}-${i}`} style={styles.crumb}>
              {c.href ? (
                <Pressable accessibilityRole="link" onPress={() => router.navigate(c.href!)} style={(s: PressState) => [styles.crumbLink, s.hovered ? { opacity: 0.8 } : null]}>
                  <AppText variant="small" tone="accent" style={{ textDecorationLine: 'underline' }}>
                    {c.label}
                  </AppText>
                </Pressable>
              ) : (
                <AppText variant="small" tone="muted" aria-current="page">
                  {c.label}
                </AppText>
              )}
              {i < crumbs!.length - 1 ? <Icon name="CaretRight" size={14} color={t.colors.textSubtle} /> : null}
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.titleRow}>
        {!showCrumbs && backHref ? (
          <View style={styles.backWrap}>
            <IconButton icon="ArrowLeft" accessibilityLabel={backLabel ? `Zurück zu ${backLabel}` : 'Zurück'} onPress={goBack} testID="zurueck" />
          </View>
        ) : null}
        <View style={styles.titleText}>
          <AppText variant={device === 'phone' ? 'display' : 'title'} accessibilityRole="header" aria-level={1}>
            {title}
          </AppText>
          {subtitle ? <AppText tone="muted">{subtitle}</AppText> : null}
        </View>
        {actions && device !== 'phone' ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      {meta}
      {actions && device === 'phone' ? <View style={styles.actionsPhone}>{actions}</View> : null}
    </View>
  );
}

export function Section({ title, action, children, testID }: { title?: string; action?: ReactNode; children: ReactNode; testID?: string }) {
  return (
    <View style={styles.section} testID={testID}>
      {title || action ? (
        <View style={styles.sectionHead}>
          {title ? (
            <AppText variant="heading" style={styles.flex} aria-level={2}>
              {title}
            </AppText>
          ) : (
            <View style={styles.flex} />
          )}
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** Fläche für echte Einheiten (z. B. ein Auftrag in der Liste). */
export function Card({ children, onPress, accessibilityLabel, tone, testID, style }: { children: ReactNode; onPress?: () => void; accessibilityLabel?: string; tone?: 'default' | 'attention' | 'danger'; testID?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const borderColor = tone === 'attention' ? t.colors.warning : tone === 'danger' ? t.colors.danger : t.colors.border;
  const base = [styles.card, { backgroundColor: t.colors.surface, borderColor, borderRadius: t.radius.panel }, tone && tone !== 'default' ? { borderLeftWidth: 4, paddingLeft: 13 } : null, style];
  if (!onPress) return <View style={base} testID={testID}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      testID={testID}
      android_ripple={{ color: t.colors.overlay }}
      style={(s: PressState) => [base, s.hovered ? { borderColor: t.colors.accent } : null, s.pressed ? { opacity: 0.9 } : null]}
    >
      {children}
    </Pressable>
  );
}

/** Zeile einer Liste: Titel, zwei wichtigste Angaben, rechts Zusatz und Pfeil. */
export function ListRow({
  title,
  subtitle,
  meta,
  icon,
  right,
  onPress,
  accessibilityLabel,
  first,
  testID,
  children,
}: {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  icon?: IconName;
  right?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  first?: boolean;
  testID?: string;
  children?: ReactNode;
}) {
  const t = useTheme();
  const { device } = useBreakpoint();
  // Telefon: Zusatz (meist ein Status) unter den Text, damit der Titel nicht abgeschnitten wird
  const stackRight = device === 'phone';
  const content = (
    <>
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.control }]}>
          <Icon name={icon} size={iconSize.md} color={t.colors.textMuted} />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" tone="muted" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
        {meta ? (
          <AppText variant="small" tone="subtle" numeric numberOfLines={1}>
            {meta}
          </AppText>
        ) : null}
        {children}
        {right && stackRight ? <View style={styles.rowRightStacked}>{right}</View> : null}
      </View>
      {right && !stackRight ? <View style={styles.rowRight}>{right}</View> : null}
      {onPress ? <Icon name="CaretRight" size={iconSize.md} color={t.colors.textSubtle} /> : null}
    </>
  );
  const style = [styles.row, { borderTopColor: t.colors.border, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth * 2 }];
  if (!onPress) return <View style={style} testID={testID}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle, meta].filter(Boolean).join(', ')}
      onPress={onPress}
      testID={testID}
      android_ripple={{ color: t.colors.overlay }}
      style={(s: PressState) => [style, s.hovered ? { backgroundColor: t.colors.surfaceSunken } : null, s.pressed ? { opacity: 0.85 } : null]}
    >
      {content}
    </Pressable>
  );
}

/** Rahmen um eine Gruppe von ListRows. */
export function ListGroup({ children, testID }: { children: ReactNode; testID?: string }) {
  const t = useTheme();
  return <View style={[styles.group, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radius.panel }]} testID={testID}>{children}</View>;
}

export function KeyValueList({ items, columns }: { items: { label: string; value: ReactNode; numeric?: boolean; code?: boolean }[]; columns?: 1 | 2 }) {
  const t = useTheme();
  const { device } = useBreakpoint();
  const cols = columns ?? (device === 'phone' ? 1 : 2);
  return (
    <View style={[styles.kv, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]}>
      {items.map((item, i) => (
        <View
          key={item.label}
          style={[styles.kvItem, { width: cols === 2 ? '50%' : '100%', borderTopColor: t.colors.border, borderTopWidth: i < cols ? 0 : 1 }]}
        >
          <AppText variant="caption" tone="subtle">
            {item.label}
          </AppText>
          {typeof item.value === 'string' || typeof item.value === 'number' ? (
            <AppText numeric={item.numeric} code={item.code} selectable>
              {item.value}
            </AppText>
          ) : (
            item.value
          )}
        </View>
      ))}
    </View>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.colors.border, alignSelf: 'stretch' }} />;
}

export function Row({ children, gap = 12, wrap, style }: { children: ReactNode; gap?: number; wrap?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

/** Zwei Spalten ab Tablet, eine auf dem Telefon. */
export function Columns({ children, ratio = [1, 1] }: { children: [ReactNode, ReactNode]; ratio?: [number, number] }) {
  const { device } = useBreakpoint();
  if (device === 'phone') return <View style={styles.stack}>{children}</View>;
  return (
    <View style={styles.columns}>
      <View style={{ flex: ratio[0], minWidth: 0, gap: 24 }}>{children[0]}</View>
      <View style={{ flex: ratio[1], minWidth: 0, gap: 24 }}>{children[1]}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  pageInner: { width: '100%', alignSelf: 'center', gap: 24 },
  header: { gap: 12 },
  crumbs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  crumbLink: { minHeight: 32, justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  backWrap: { marginLeft: -12, marginTop: -6 },
  titleText: { flex: 1, gap: 4, minWidth: 0 },
  actions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' },
  actionsPhone: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  section: { gap: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32 },
  flex: { flex: 1 },
  card: { borderWidth: 1, padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  rowIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  rowRight: { flexShrink: 1, maxWidth: '45%', alignItems: 'flex-end' },
  rowRightStacked: { paddingTop: 4, gap: 6 },
  group: { borderWidth: 1, overflow: 'hidden' },
  kv: { borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden' },
  kvItem: { paddingHorizontal: 16, paddingVertical: 12, gap: 2 },
  stack: { gap: 24 },
  columns: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' },
});
