/**
 * Zustände jeder Ansicht: Laden (Skeleton in Form des Inhalts), Leer (Satz + nächster
 * Schritt), Fehler (Ursache + "Erneut versuchen"). Keine Dauerschleifen-Animation;
 * "Bewegung reduzieren" schaltet das sanfte Pulsieren ab.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View, type DimensionValue } from 'react-native';
import { describeError, type ApiError } from '../data/errors';
import { useTheme } from '../theme';
import { Button } from './Button';
import { Icon, iconSize, type IconName } from './icons';
import { AppText } from './Text';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => active && setReduced(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

export function Skeleton({ width = '100%', height = 16, radius }: { width?: DimensionValue; height?: number; radius?: number }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    if (reduced) return;
    // Ein langsamer Wechsel zeigt "lädt" an; endet, sobald der Inhalt da ist.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.6, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduced]);
  return <Animated.View style={{ width, height, borderRadius: radius ?? t.radius.control / 2, backgroundColor: t.colors.surfaceSunken, opacity }} />;
}

/** Platzhalter für Listen, Karten und Detailseiten. */
export function LoadingState({ variant = 'list', rows = 4, label = 'Wird geladen' }: { variant?: 'list' | 'detail' | 'cards'; rows?: number; label?: string }) {
  const t = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} aria-busy style={styles.loading} testID="ladezustand">
      {variant === 'detail' ? (
        <>
          <Skeleton width="60%" height={28} />
          <Skeleton width="40%" height={16} />
          <View style={[styles.skelCard, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]}>
            {Array.from({ length: rows }, (_, i) => (
              <View key={i} style={styles.skelRow}>
                <Skeleton width="30%" height={14} />
                <Skeleton width="45%" height={14} />
              </View>
            ))}
          </View>
        </>
      ) : (
        Array.from({ length: rows }, (_, i) => (
          <View key={i} style={[styles.skelCard, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]}>
            <Skeleton width="55%" height={18} />
            <Skeleton width="80%" height={14} />
            {variant === 'cards' ? <Skeleton width="35%" height={24} radius={999} /> : null}
          </View>
        ))
      )}
    </View>
  );
}

export function EmptyState({ icon = 'Info', title, message, action }: { icon?: IconName; title: string; message?: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.empty, { borderColor: t.colors.border, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]} testID="leerzustand">
      <View style={[styles.emptyIcon, { backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.pill }]}>
        <Icon name={icon} size={iconSize.lg} color={t.colors.textMuted} />
      </View>
      <AppText variant="heading" align="center">
        {title}
      </AppText>
      {message ? (
        <AppText tone="muted" align="center" style={styles.readable}>
          {message}
        </AppText>
      ) : null}
      {action}
    </View>
  );
}

export function ErrorState({ error, onRetry, retrying, title }: { error: ApiError | null; onRetry?: () => void; retrying?: boolean; title?: string }) {
  const t = useTheme();
  const d = describeError(error);
  return (
    <View
      role="alert"
      accessibilityLiveRegion="assertive"
      style={[styles.empty, { borderColor: t.colors.dangerSoft, borderRadius: t.radius.panel, backgroundColor: t.colors.surface }]}
      testID="fehlerzustand"
    >
      <View style={[styles.emptyIcon, { backgroundColor: t.colors.dangerSoft, borderRadius: t.radius.pill }]}>
        <Icon name={error?.isNetwork ? 'WifiSlash' : 'WarningCircle'} size={iconSize.lg} color={t.colors.danger} />
      </View>
      <AppText variant="heading" align="center">
        {title ?? d.title}
      </AppText>
      <AppText tone="muted" align="center" style={styles.readable}>
        {d.message}
      </AppText>
      {onRetry ? <Button label="Erneut versuchen" icon="ArrowsClockwise" onPress={onRetry} loading={retrying} variant="primary" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { gap: 12 },
  skelCard: { borderWidth: 1, padding: 16, gap: 10 },
  skelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  empty: { borderWidth: 1, padding: 24, gap: 12, alignItems: 'center' },
  emptyIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  readable: { maxWidth: 520 },
});
