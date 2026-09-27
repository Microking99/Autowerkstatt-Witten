/**
 * Register (Tabs) mit Auswahl in der URL, umbrechende Filter-Chips und eine Tabelle, die am
 * PC als sortierbare Tabelle und mobil als Zeilen mit den zwei wichtigsten Angaben erscheint.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import { useBreakpoint, useTheme } from '../theme';
import { Icon, iconSize, type IconName } from './icons';
import { ListGroup, ListRow } from './Layout';
import { AppText } from './Text';

type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: IconName;
}

/** Liest/schreibt das Register aus dem Query-Parameter (Standard: "register"). */
export function useTabParam<T extends string>(values: readonly T[], fallback: T, param = 'register'): [T, (v: T) => void] {
  const params = useLocalSearchParams<Record<string, string>>();
  const raw = params[param];
  const current = (values as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;
  const set = (v: T) => router.setParams({ [param]: v });
  return [current, set];
}

export function Tabs<T extends string>({ items, value, onChange, label }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const t = useTheme();
  return (
    <View style={[styles.tabsWrap, { borderBottomColor: t.colors.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" aria-label={label} contentContainerStyle={styles.tabs}>
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <Pressable
              key={item.value}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              aria-selected={selected}
              accessibilityLabel={item.count !== undefined ? `${item.label}, ${item.count}` : item.label}
              onPress={() => onChange(item.value)}
              testID={`register-${item.value}`}
              style={(s: PressState) => [
                styles.tab,
                { borderBottomColor: selected ? t.colors.accent : 'transparent' },
                s.hovered && !selected ? { borderBottomColor: t.colors.borderStrong } : null,
                s.pressed ? { opacity: 0.8 } : null,
              ]}
            >
              {item.icon ? <Icon name={item.icon} size={iconSize.sm} color={selected ? t.colors.accent : t.colors.textMuted} /> : null}
              <AppText variant="bodyStrong" tone={selected ? 'accent' : 'muted'} numberOfLines={1} style={{ fontWeight: selected ? '600' : '500' }}>
                {item.label}
              </AppText>
              {item.count !== undefined ? (
                <View style={[styles.count, { backgroundColor: selected ? t.colors.accentSoft : t.colors.surfaceSunken, borderRadius: t.radius.pill }]}>
                  <AppText variant="caption" numeric tone={selected ? 'accent' : 'muted'}>
                    {item.count}
                  </AppText>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

/** Filter-Chips (Einfachauswahl), umbrechend. */
export function FilterChips<T extends string>({ options, value, onChange, label }: { options: FilterOption<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" aria-label={label} style={styles.chips}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${label}: ${o.label}`}
            onPress={() => onChange(o.value)}
            style={(s: PressState) => [
              styles.chip,
              {
                borderRadius: t.radius.pill,
                borderColor: selected ? t.colors.accent : t.colors.borderStrong,
                backgroundColor: selected ? t.colors.accentSoft : t.colors.surface,
              },
              s.hovered && !selected ? { borderColor: t.colors.accent } : null,
              s.pressed ? { opacity: 0.85 } : null,
            ]}
          >
            {selected ? <Icon name="Check" size={iconSize.sm} color={t.colors.accent} /> : null}
            <AppText variant="small" tone={selected ? 'accent' : 'default'} style={{ fontWeight: selected ? '600' : '400' }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** Wert für die Sortierung */
  sortValue?: (row: Row) => string | number;
  width?: number;
  flex?: number;
  align?: 'left' | 'right';
}

/**
 * Tabelle am PC (Sortierung per Kopfzeile, Zeile per Enter öffnen); mobil als Zeilen.
 */
export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  onRowPress,
  mobileTitle,
  mobileSubtitle,
  mobileMeta,
  mobileRight,
  label,
}: {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  onRowPress?: (row: Row) => void;
  mobileTitle: (row: Row) => string;
  mobileSubtitle?: (row: Row) => string | null;
  mobileMeta?: (row: Row) => string | null;
  mobileRight?: (row: Row) => ReactNode;
  label: string;
}) {
  const t = useTheme();
  const { device } = useBreakpoint();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [rows, columns, sort]);

  if (device !== 'desktop') {
    return (
      <ListGroup>
        {sorted.map((row, i) => (
          <ListRow
            key={rowKey(row)}
            first={i === 0}
            title={mobileTitle(row)}
            subtitle={mobileSubtitle?.(row)}
            meta={mobileMeta?.(row)}
            right={mobileRight?.(row)}
            onPress={onRowPress ? () => onRowPress(row) : undefined}
          />
        ))}
      </ListGroup>
    );
  }

  return (
    <View role="grid" aria-label={label} style={[styles.table, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]}>
      <View role="row" style={[styles.tr, styles.thead, { backgroundColor: t.colors.surfaceSunken, borderBottomColor: t.colors.border }]}>
        {columns.map((c) => {
          const active = sort?.key === c.key;
          return (
            <Pressable
              key={c.key}
              accessibilityRole="button"
              accessibilityLabel={c.sortValue ? `${c.header}, sortieren` : c.header}
              disabled={!c.sortValue}
              onPress={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
              style={[styles.th, { flex: c.flex ?? 1, width: c.width, justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start' }]}
            >
              <AppText variant="caption" tone="muted">
                {c.header}
              </AppText>
              {active ? <Icon name={sort!.dir === 1 ? 'CaretDown' : 'CaretUp'} size={12} color={t.colors.textMuted} /> : null}
            </Pressable>
          );
        })}
      </View>
      {sorted.map((row, i) => (
        <Pressable
          key={rowKey(row)}
          accessibilityRole={onRowPress ? 'link' : undefined}
          disabled={!onRowPress}
          onPress={onRowPress ? () => onRowPress(row) : undefined}
          style={(s: PressState) => [
            styles.tr,
            { borderTopColor: t.colors.border, borderTopWidth: i === 0 ? 0 : 1 },
            s.hovered ? { backgroundColor: t.colors.surfaceSunken } : null,
          ]}
        >
          {columns.map((c) => (
            <View key={c.key} style={[styles.td, { flex: c.flex ?? 1, width: c.width, alignItems: c.align === 'right' ? 'flex-end' : 'stretch' }]}>
              {c.render(row)}
            </View>
          ))}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tabsWrap: { borderBottomWidth: 1 },
  tabs: { gap: 4 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 48, borderBottomWidth: 3 },
  count: { minWidth: 24, paddingHorizontal: 6, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, paddingHorizontal: 14, minHeight: 40 },
  table: { borderWidth: 1, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minHeight: 52 },
  thead: { minHeight: 40, borderBottomWidth: 1 },
  th: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, minHeight: 40 },
  td: { paddingHorizontal: 8, paddingVertical: 10, minWidth: 0 },
});
