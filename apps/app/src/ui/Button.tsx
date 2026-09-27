import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { Icon, iconSize, type IconName } from './icons';
import { AppText } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive';

type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Mechanikeransicht: Hauptaktionen mindestens 56 hoch (Handschuhe) */
  size?: 'md' | 'lg';
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Schaltfläche: Beschriftung ist ein Verb, einzeilig. Eine primäre je Ansicht. */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  size = 'md',
  fullWidth,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const t = useTheme();
  const c = t.colors;
  const palette = {
    primary: { bg: c.accent, fg: c.accentText, border: c.accent },
    secondary: { bg: c.surface, fg: c.text, border: c.borderStrong },
    quiet: { bg: 'transparent', fg: c.accent, border: 'transparent' },
    destructive: { bg: c.danger, fg: t.scheme === 'dark' ? c.bg : '#FFFFFE', border: c.danger },
  }[variant];
  const inactive = disabled || loading;
  const height = size === 'lg' ? t.touchTarget.workshopPrimary : 48;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      android_ripple={{ color: c.overlay }}
      style={(state: PressState) => [
        styles.base,
        {
          minHeight: height,
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderRadius: t.radius.control,
          paddingHorizontal: variant === 'quiet' ? 12 : 20,
          opacity: disabled && !loading ? 0.5 : 1,
        },
        fullWidth ? styles.full : null,
        state.pressed && Platform.OS !== 'android' ? { opacity: 0.82 } : null,
        state.hovered && !inactive ? { backgroundColor: variant === 'quiet' ? c.accentSoft : palette.bg, borderColor: variant === 'secondary' ? c.accent : palette.border } : null,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator size="small" color={palette.fg} /> : icon ? <Icon name={icon} size={iconSize.md} color={palette.fg} /> : null}
        <AppText variant="bodyStrong" numberOfLines={2} style={[styles.label, { color: palette.fg }]}>
          {label}
        </AppText>
        {iconRight && !loading ? <Icon name={iconRight} size={iconSize.md} color={palette.fg} /> : null}
      </View>
    </Pressable>
  );
}

export interface IconButtonProps {
  icon: IconName;
  /** Pflicht: Symbol-Schaltflächen brauchen eine zugängliche Beschriftung */
  accessibilityLabel: string;
  onPress?: () => void;
  tone?: 'default' | 'accent' | 'danger' | 'onAccent';
  selected?: boolean;
  disabled?: boolean;
  size?: number;
  testID?: string;
  children?: ReactNode;
}

export function IconButton({ icon, accessibilityLabel, onPress, tone = 'default', selected, disabled, size = 48, testID }: IconButtonProps) {
  const t = useTheme();
  const color = { default: t.colors.text, accent: t.colors.accent, danger: t.colors.danger, onAccent: t.colors.accentText }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      android_ripple={{ color: t.colors.overlay, borderless: true }}
      hitSlop={size < 44 ? (44 - size) / 2 : undefined}
      style={(state: PressState) => [
        styles.icon,
        { width: size, height: size, borderRadius: t.radius.control },
        selected ? { backgroundColor: t.colors.accentSoft } : null,
        state.hovered ? { backgroundColor: t.colors.surfaceSunken } : null,
        state.pressed ? { opacity: 0.7 } : null,
        disabled ? { opacity: 0.4 } : null,
      ]}
    >
      <Icon name={icon} size={iconSize.lg} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // maxWidth: schmale Bildschirme dürfen nie über den Rand hinaus laufen (Beschriftung bricht dann um)
  base: { borderWidth: 1, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
  full: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  label: { flexShrink: 1, textAlign: 'center' },
  icon: { alignItems: 'center', justifyContent: 'center' },
});
