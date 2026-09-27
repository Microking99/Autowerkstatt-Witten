/**
 * Blätter (Sheet) und Bestätigungsdialoge. Telefon: Blatt von unten; ab Tablet: mittiger
 * Dialog. Esc (Web) und Zurück (Android) schließen über onRequestClose. Schatten nur hier
 * (schwebende Ebene), sonst Rahmen statt Schatten.
 */
import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBreakpoint, useTheme } from '../theme';
import { Button } from './Button';
import { IconButton } from './Button';
import { Icon, iconSize, type IconName } from './icons';
import { AppText } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Breite auf PC */
  width?: number;
  testID?: string;
}

export function Sheet({ visible, onClose, title, children, footer, width = 560, testID }: SheetProps) {
  const t = useTheme();
  const { device } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const phone = device === 'phone';
  return (
    <Modal visible={visible} transparent animationType={phone ? 'slide' : 'fade'} onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.backdrop, { justifyContent: phone ? 'flex-end' : 'center' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Schließen" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.overlay }]} />
        <View
          accessibilityViewIsModal
          aria-modal
          role="dialog"
          aria-label={title}
          testID={testID}
          style={[
            styles.sheet,
            {
              backgroundColor: t.colors.surfaceRaised,
              borderColor: t.colors.border,
              borderTopLeftRadius: t.radius.sheet,
              borderTopRightRadius: t.radius.sheet,
              borderBottomLeftRadius: phone ? 0 : t.radius.sheet,
              borderBottomRightRadius: phone ? 0 : t.radius.sheet,
              width: phone ? '100%' : width,
              maxWidth: '100%',
              maxHeight: phone ? '88%' : '84%',
              alignSelf: 'center',
              paddingBottom: phone ? Math.max(insets.bottom, 16) : 20,
            },
            Platform.OS === 'web' ? ({ boxShadow: '0 12px 32px rgba(15,18,21,0.18)' } as object) : styles.shadow,
          ]}
        >
          <View style={[styles.header, { borderBottomColor: t.colors.border }]}>
            <AppText variant="heading" style={styles.flex} numberOfLines={2}>
              {title}
            </AppText>
            <IconButton icon="X" accessibilityLabel="Schließen" onPress={onClose} size={44} />
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={[styles.footer, { borderTopColor: t.colors.border }]}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export interface ConfirmDialogProps {
  visible: boolean;
  /** nennt die Folge, bei Geld mit Betrag: "Zusatzarbeit für 329,51 € freigeben?" */
  title: string;
  message?: string;
  children?: ReactNode;
  /** nennt die Aktion: "Freigeben", "Ablehnen", "Weiter zur Zahlung" */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'destructive';
  icon?: IconName;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  children,
  confirmLabel,
  cancelLabel = 'Abbrechen',
  tone = 'primary',
  icon,
  loading,
  onConfirm,
  onCancel,
  testID,
}: ConfirmDialogProps) {
  const t = useTheme();
  const { device } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const phone = device === 'phone';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.backdrop, { justifyContent: phone ? 'flex-end' : 'center', padding: phone ? 0 : 24 }]}>
        <Pressable accessibilityLabel="Abbrechen" onPress={loading ? undefined : onCancel} style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.overlay }]} />
        <View
          accessibilityViewIsModal
          aria-modal
          role="alertdialog"
          aria-label={title}
          testID={testID}
          style={[
            styles.dialog,
            {
              backgroundColor: t.colors.surfaceRaised,
              borderColor: t.colors.border,
              borderRadius: t.radius.sheet,
              borderBottomLeftRadius: phone ? 0 : t.radius.sheet,
              borderBottomRightRadius: phone ? 0 : t.radius.sheet,
              width: phone ? '100%' : 480,
              paddingBottom: phone ? Math.max(insets.bottom, 20) : 24,
            },
            Platform.OS === 'web' ? ({ boxShadow: '0 12px 32px rgba(15,18,21,0.18)' } as object) : styles.shadow,
          ]}
        >
          {icon ? (
            <View style={[styles.dialogIcon, { backgroundColor: tone === 'destructive' ? t.colors.dangerSoft : t.colors.accentSoft, borderRadius: t.radius.pill }]}>
              <Icon name={icon} size={iconSize.lg} color={tone === 'destructive' ? t.colors.danger : t.colors.accent} />
            </View>
          ) : null}
          <AppText variant="title" style={styles.dialogTitle}>
            {title}
          </AppText>
          {message ? <AppText tone="muted">{message}</AppText> : null}
          {children}
          <View style={[styles.actions, phone ? styles.actionsPhone : null]}>
            <Button label={cancelLabel} variant="secondary" onPress={onCancel} disabled={loading} fullWidth={phone} />
            <Button label={confirmLabel} variant={tone === 'destructive' ? 'destructive' : 'primary'} onPress={onConfirm} loading={loading} fullWidth={phone} testID={testID ? `${testID}-bestaetigen` : undefined} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center' },
  sheet: { borderWidth: 1, overflow: 'hidden' },
  shadow: { shadowColor: '#0F1215', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 20, paddingRight: 8, paddingVertical: 8, borderBottomWidth: 1 },
  flex: { flex: 1 },
  content: { padding: 20, gap: 16 },
  footer: { borderTopWidth: 1, paddingHorizontal: 20, paddingTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end' },
  dialog: { borderWidth: 1, padding: 24, gap: 12 },
  dialogIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  dialogTitle: { marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 12, flexWrap: 'wrap' },
  actionsPhone: { flexDirection: 'column-reverse', alignItems: 'stretch' },
});
