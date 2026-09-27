/**
 * Fotos, Chat-Blasen, Verlauf und Geldbeträge.
 */
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import type { ImageSourceSpec } from '../data/api';
import { formatMoney, formatTime } from '../lib/format';
import { useBreakpoint, useTheme } from '../theme';
import { Button } from './Button';
import { Icon, iconSize } from './icons';
import { Sheet } from './Overlay';
import { AppText, type AppTextProps } from './Text';
import { useAuthImage } from './authImage';

type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

export function MoneyText({ cents, variant = 'body', tone, strong, ...rest }: { cents: number; strong?: boolean } & Omit<AppTextProps, 'children'>) {
  return (
    <AppText variant={strong ? 'bodyStrong' : variant} tone={tone} numeric {...rest}>
      {formatMoney(cents)}
    </AppText>
  );
}

/**
 * Foto oder neutraler Platzhalter ("Beispielfoto") im Demo-Modus. Geschützte Quellen lädt
 * useAuthImage mit Anmeldung (nativ per Header, im Browser als Blob-URL).
 */
export function PhotoView({ source, caption, height = 140, fit = 'cover' }: { source: ImageSourceSpec; caption?: string | null; height?: number; fit?: 'cover' | 'contain' }) {
  const t = useTheme();
  const image = useAuthImage(source);
  if (source.uri && image.status !== 'ready') {
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={image.status === 'error' ? 'Foto konnte nicht geladen werden' : `Foto wird geladen: ${caption ?? ''}`}
        style={[styles.placeholder, { height, backgroundColor: t.colors.surfaceSunken, borderColor: t.colors.border, borderRadius: t.radius.control, borderStyle: 'solid' }]}
      >
        <Icon name={image.status === 'error' ? 'ImageBroken' : 'ImageSquare'} size={iconSize.xl} color={t.colors.textSubtle} />
        <AppText variant="caption" tone="muted" align="center">
          {image.status === 'error' ? 'Foto nicht verfügbar' : 'Wird geladen'}
        </AppText>
      </View>
    );
  }
  if (!source.uri) {
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={source.placeholderLabel ?? caption ?? 'Foto'}
        style={[styles.placeholder, { height, backgroundColor: t.colors.surfaceSunken, borderColor: t.colors.border, borderRadius: t.radius.control }]}
      >
        <Icon name="ImageSquare" size={iconSize.xl} color={t.colors.textSubtle} />
        <AppText variant="caption" tone="muted" align="center">
          Beispielfoto
        </AppText>
        {source.placeholderLabel && source.placeholderLabel.replace(/^Beispielfoto:?\s*/, '') ? (
          <AppText variant="caption" tone="subtle" align="center" numberOfLines={4} style={{ fontWeight: '400' }}>
            {source.placeholderLabel.replace(/^Beispielfoto:?\s*/, '')}
          </AppText>
        ) : null}
      </View>
    );
  }
  return (
    <Image
      source={image.status === 'ready' ? { uri: image.uri, headers: image.headers } : { uri: source.uri }}
      contentFit={fit}
      accessibilityLabel={caption ?? 'Foto'}
      style={{ height, width: '100%', borderRadius: t.radius.control, backgroundColor: t.colors.surfaceSunken }}
      transition={0}
    />
  );
}

export interface PhotoItem {
  id: string;
  source: ImageSourceSpec;
  caption?: string | null;
}

export function PhotoGrid({ photos, columns }: { photos: PhotoItem[]; columns?: number }) {
  const t = useTheme();
  const { device } = useBreakpoint();
  const [open, setOpen] = useState<PhotoItem | null>(null);
  const cols = columns ?? (device === 'phone' ? 2 : 3);
  return (
    <>
      <View style={styles.grid}>
        {photos.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`Foto vergrößern: ${p.caption ?? p.source.placeholderLabel ?? 'Foto'}`}
            onPress={() => setOpen(p)}
            style={(s: PressState) => [styles.gridItem, { width: `${100 / cols - 2}%` as `${number}%` }, s.pressed ? { opacity: 0.85 } : null, s.hovered ? { opacity: 0.92 } : null]}
          >
            <PhotoView source={p.source} caption={p.caption} height={device === 'phone' ? 120 : 150} />
            {p.caption ? (
              <AppText variant="small" tone="muted">
                {p.caption}
              </AppText>
            ) : null}
          </Pressable>
        ))}
      </View>
      <Sheet visible={open !== null} onClose={() => setOpen(null)} title={open?.caption ?? 'Foto'} width={760}>
        {open ? <PhotoView source={open.source} caption={open.caption} height={device === 'phone' ? 280 : 440} fit="contain" /> : null}
        <View style={{ height: 4, backgroundColor: t.colors.surfaceRaised }} />
      </Sheet>
    </>
  );
}

export type ChatDeliveryState = 'sent' | 'sending' | 'failed';

export function ChatBubble({
  own,
  author,
  body,
  createdAt,
  photos,
  state = 'sent',
  onRetry,
  roleLabel,
}: {
  own: boolean;
  author: string;
  body: string;
  createdAt: string;
  photos?: PhotoItem[];
  state?: ChatDeliveryState;
  onRetry?: () => void;
  roleLabel?: string;
}) {
  const t = useTheme();
  const failed = state === 'failed';
  return (
    <View style={[styles.bubbleWrap, own ? styles.own : styles.other]} testID={failed ? 'nachricht-fehlgeschlagen' : undefined}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: own ? t.colors.accentSoft : t.colors.surface,
            borderColor: failed ? t.colors.danger : own ? t.colors.accentSoft : t.colors.border,
            borderRadius: t.radius.panel,
            borderBottomRightRadius: own ? 4 : t.radius.panel,
            borderBottomLeftRadius: own ? t.radius.panel : 4,
          },
        ]}
      >
        <AppText variant="caption" tone="muted">
          {own ? 'Sie' : author}
          {roleLabel ? ` (${roleLabel})` : ''}
        </AppText>
        {photos && photos.length > 0 ? <PhotoGrid photos={photos} columns={photos.length === 1 ? 1 : 2} /> : null}
        {body ? <AppText selectable>{body}</AppText> : null}
      </View>
      <View style={[styles.bubbleMeta, own ? { justifyContent: 'flex-end' } : null]}>
        {state === 'sending' ? (
          <AppText variant="caption" tone="subtle">
            Wird gesendet
          </AppText>
        ) : failed ? (
          <View style={styles.failRow} role="alert">
            <Icon name="WarningCircle" size={iconSize.sm} color={t.colors.danger} />
            <AppText variant="caption" tone="danger">
              Nicht gesendet
            </AppText>
            {onRetry ? <Button label="Erneut senden" variant="quiet" icon="ArrowsClockwise" onPress={onRetry} /> : null}
          </View>
        ) : (
          <AppText variant="caption" tone="subtle" numeric>
            {formatTime(createdAt)} Uhr
          </AppText>
        )}
      </View>
    </View>
  );
}

export interface TimelineItem {
  id: string;
  title: string;
  detail?: string | null;
  time?: string | null;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  icon?: Parameters<typeof Icon>[0]['name'];
  extra?: ReactNode;
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  const t = useTheme();
  const toneColor = (tone: TimelineItem['tone']) =>
    ({ neutral: t.colors.textMuted, success: t.colors.success, warning: t.colors.warning, danger: t.colors.danger, info: t.colors.info })[tone ?? 'neutral'];
  return (
    <View accessibilityRole="list">
      {items.map((item, i) => (
        <View key={item.id} accessibilityRole="text" style={styles.tlItem}>
          <View style={styles.tlRail}>
            <View style={[styles.tlMarker, { borderColor: toneColor(item.tone), backgroundColor: t.colors.surface }]}>
              <Icon name={item.icon ?? 'Circle'} size={iconSize.sm} color={toneColor(item.tone)} />
            </View>
            {i < items.length - 1 ? <View style={[styles.tlLine, { backgroundColor: t.colors.border }]} /> : null}
          </View>
          <View style={styles.tlBody}>
            <AppText variant="bodyStrong">{item.title}</AppText>
            {item.detail ? <AppText tone="muted">{item.detail}</AppText> : null}
            {item.time ? (
              <AppText variant="small" tone="subtle" numeric>
                {item.time}
              </AppText>
            ) : null}
            {item.extra}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { gap: 6, flexGrow: 1 },
  bubbleWrap: { maxWidth: '86%', gap: 4 },
  own: { alignSelf: 'flex-end' },
  other: { alignSelf: 'flex-start' },
  bubble: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  bubbleMeta: { flexDirection: 'row', paddingHorizontal: 4 },
  failRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tlItem: { flexDirection: 'row', gap: 12 },
  tlRail: { alignItems: 'center', width: 32 },
  tlMarker: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tlLine: { width: 2, flex: 1, minHeight: 16 },
  tlBody: { flex: 1, paddingBottom: 20, gap: 2, minWidth: 0 },
});
