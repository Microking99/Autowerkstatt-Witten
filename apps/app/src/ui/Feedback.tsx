/**
 * Rückmeldungen: Banner (dauerhaft in der Ansicht), Toast (kurz, nach Aktionen),
 * Demo-Hinweis und Offline-Hinweis.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Tone } from '@werkstatt/contracts';
import { useBreakpoint, useTheme } from '../theme';
import { Icon, iconSize, type IconName } from './icons';
import { toneColors } from './Status';
import { AppText } from './Text';

const toneIcon: Record<Tone, IconName> = { neutral: 'Info', info: 'Info', success: 'CheckCircle', warning: 'Warning', danger: 'WarningCircle' };

export function Banner({ tone = 'info', title, message, icon, action, testID }: { tone?: Tone; title?: string; message?: string; icon?: IconName; action?: ReactNode; testID?: string }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  const alert = tone === 'danger' || tone === 'warning';
  return (
    <View
      role={alert ? 'alert' : 'status'}
      accessibilityLiveRegion={alert ? 'assertive' : 'polite'}
      testID={testID}
      style={[styles.banner, { backgroundColor: c.bg, borderColor: c.fg, borderRadius: t.radius.panel }]}
    >
      <Icon name={icon ?? toneIcon[tone]} size={iconSize.lg} color={c.fg} />
      <View style={styles.bannerText}>
        {title ? (
          <AppText variant="bodyStrong" style={{ color: t.colors.text }}>
            {title}
          </AppText>
        ) : null}
        {message ? <AppText style={{ color: t.colors.text }}>{message}</AppText> : null}
        {action ? <View style={styles.bannerAction}>{action}</View> : null}
      </View>
    </View>
  );
}

interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<{ show: (message: string, tone?: Tone) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const show = useCallback((message: string, tone: Tone = 'success') => {
    const id = ++counter.current;
    setItems((list) => [...list.slice(-2), { id, tone, message }]);
    setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), 5000);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost items={items} onDismiss={(id) => setItems((list) => list.filter((i) => i.id !== id))} />
    </ToastContext.Provider>
  );
}

function ToastHost({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  if (items.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[styles.toastHost, { bottom: Math.max(insets.bottom, 16) + 72 }]}>
      {items.map((item) => {
        const c = toneColors(t, item.tone);
        return (
          <Pressable
            key={item.id}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            accessibilityLabel={item.message}
            accessibilityHint="Tippen zum Schließen"
            onPress={() => onDismiss(item.id)}
            style={[styles.toast, { backgroundColor: t.colors.surfaceRaised, borderColor: c.fg, borderRadius: t.radius.panel }]}
            testID="toast"
          >
            <Icon name={toneIcon[item.tone]} size={iconSize.md} color={c.fg} />
            <AppText style={styles.bannerText}>{item.message}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast außerhalb von ToastProvider');
  return ctx;
}

/** Dauerhaft sichtbare Leiste im Demo-Modus (docs/designsystem.md, Abschnitt 7). */
export function DemoBanner({ onOpenControls, onOpenOverview }: { onOpenControls: () => void; /** Vorschau: zurück zur Rollenwahl */ onOpenOverview?: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { device } = useBreakpoint();
  const compact = device === 'phone';
  return (
    <View
      role="note"
      testID="demo-hinweis"
      style={[styles.demo, { paddingTop: insets.top + 6, backgroundColor: t.colors.warningSoft, borderBottomColor: t.colors.border }]}
    >
      <Icon name="Flask" size={iconSize.md} color={t.colors.warning} />
      <AppText variant={compact ? 'caption' : 'small'} style={[styles.bannerText, { color: t.colors.text, fontWeight: '400' }]}>
        {onOpenOverview ? 'Vorschau mit Beispieldaten.' : 'Entwurf mit Beispieldaten.'} Keine echten Kunden, Zahlungen oder Nachrichten.
      </AppText>
      {onOpenOverview ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zur Übersicht der Vorschau"
          onPress={onOpenOverview}
          testID="vorschau-uebersicht"
          hitSlop={4}
          style={({ pressed }) => [styles.demoButton, { borderColor: t.colors.warning, borderRadius: t.radius.control }, compact ? styles.demoButtonCompact : null, pressed ? { opacity: 0.8 } : null]}
        >
          <Icon name="SquaresFour" size={compact ? iconSize.md : iconSize.sm} color={t.colors.text} />
          {compact ? null : (
            <AppText variant="small" style={{ fontWeight: '600' }}>
              Übersicht
            </AppText>
          )}
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Demo-Steuerung öffnen"
        onPress={onOpenControls}
        testID="demo-steuerung-oeffnen"
        hitSlop={4}
        style={({ pressed }) => [styles.demoButton, { borderColor: t.colors.warning, borderRadius: t.radius.control }, compact ? styles.demoButtonCompact : null, pressed ? { opacity: 0.8 } : null]}
      >
        <Icon name="Gear" size={compact ? iconSize.md : iconSize.sm} color={t.colors.text} />
        {compact ? null : (
          <AppText variant="small" style={{ fontWeight: '600' }}>
            Demo-Steuerung
          </AppText>
        )}
      </Pressable>
    </View>
  );
}

/**
 * Offline-Hinweis. "queue": Einträge werden gespeichert und später übertragen (Mechaniker).
 * "readonly": Kunden und Werkstatt; Freigaben und Zahlungen gehen offline nie (Regel 10).
 */
export function OfflineBanner({ visible, variant = 'readonly' }: { visible: boolean; variant?: 'queue' | 'readonly' }) {
  const t = useTheme();
  if (!visible) return null;
  const text =
    variant === 'queue'
      ? 'Offline. Änderungen werden gespeichert und später übertragen.'
      : 'Offline. Angezeigte Daten können veraltet sein. Freigaben, Zahlungen und Nachrichten sind erst wieder mit Verbindung möglich.';
  return (
    <View role="status" accessibilityLiveRegion="polite" testID="offline-hinweis" style={[styles.offline, { backgroundColor: t.colors.infoSoft, borderBottomColor: t.colors.border }]}>
      <Icon name="WifiSlash" size={iconSize.md} color={t.colors.info} />
      <AppText variant="small" style={[styles.bannerText, { color: t.colors.text }]}>
        {text}
      </AppText>
    </View>
  );
}

export function useTimeout(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setTimeout(() => ref.current(), ms);
    return () => clearTimeout(id);
  }, [ms]);
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', gap: 12, padding: 16, borderWidth: 1, borderLeftWidth: 4, alignItems: 'flex-start' },
  bannerText: { flex: 1, gap: 4, minWidth: 0 },
  bannerAction: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  toastHost: { position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 8, zIndex: 50 },
  toast: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderLeftWidth: 4, maxWidth: 560, width: '100%', minHeight: 48 },
  demo: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 6, borderBottomWidth: 1 },
  demoButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, paddingHorizontal: 10, minHeight: 40 },
  demoButtonCompact: { width: 44, height: 44, paddingHorizontal: 0, justifyContent: 'center' },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
});
