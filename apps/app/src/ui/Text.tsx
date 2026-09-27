import type { ReactNode } from 'react';
import { Platform, Text as RNText, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { keepPlates } from '../lib/format';
import { monoFont, useTheme, type TypographyVariant } from '../theme';

export type TextTone = 'default' | 'muted' | 'subtle' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'onAccent';

export interface AppTextProps extends Omit<TextProps, 'style'> {
  variant?: TypographyVariant;
  tone?: TextTone;
  /** Tabellenziffern für Beträge, km, Uhrzeiten, Nummern */
  numeric?: boolean;
  /** Kennzeichen/FIN: leichter Zeichenabstand, Monospace */
  code?: boolean;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
}

/** Kennzeichen, Auftrags- und Rechnungsnummern nicht umbrechen (z. B. "R-2026-0311"). */
function protect(children: ReactNode): ReactNode {
  if (typeof children === 'string') return keepPlates(children);
  if (Array.isArray(children)) return children.map((c) => (typeof c === 'string' ? keepPlates(c) : c));
  return children;
}

export function AppText({ variant = 'body', tone = 'default', numeric, code, align, style, children, ...rest }: AppTextProps) {
  const t = useTheme();
  const color = {
    default: t.colors.text,
    muted: t.colors.textMuted,
    subtle: t.colors.textSubtle,
    accent: t.colors.accent,
    success: t.colors.success,
    warning: t.colors.warning,
    danger: t.colors.danger,
    info: t.colors.info,
    onAccent: t.colors.accentText,
  }[tone];
  const isHeading = variant === 'display' || variant === 'title' || variant === 'heading';
  return (
    <RNText
      accessibilityRole={isHeading ? 'header' : undefined}
      android_hyphenationFrequency="normal"
      {...rest}
      style={[
        t.text(variant),
        { color },
        numeric ? { fontVariant: ['tabular-nums'] } : null,
        code ? [monoFont, { letterSpacing: 0.5, fontSize: (t.typography[variant].fontSize ?? 16) - 1 }] : null,
        align ? { textAlign: align } : null,
        Platform.OS === 'web' ? ({ overflowWrap: 'break-word' } as TextStyle) : null,
        style,
      ]}
    >
      {protect(children)}
    </RNText>
  );
}
