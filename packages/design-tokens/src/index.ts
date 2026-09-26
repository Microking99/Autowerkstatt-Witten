/**
 * Design-Tokens der Autowerkstatt-Witten-Software.
 * Verbindliche Beschreibung: docs/designsystem.md
 */

export type ColorScheme = 'light' | 'dark';

export interface ColorTokens {
  bg: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  focus: string;
  overlay: string;
}

export const colors: Record<ColorScheme, ColorTokens> = {
  light: {
    bg: '#F3F4F6',
    surface: '#FCFCFD',
    surfaceRaised: '#FFFFFE',
    surfaceSunken: '#E9EBEE',
    border: '#D9DDE3',
    borderStrong: '#B8BFC8',
    text: '#16191D',
    textMuted: '#4A515B',
    textSubtle: '#5F6671',
    accent: '#0B5F6B',
    accentText: '#FCFCFD',
    accentSoft: '#E1F0F2',
    success: '#1E7A46',
    successSoft: '#E3F3E9',
    warning: '#8A5A00',
    warningSoft: '#FFF1CC',
    danger: '#B42318',
    dangerSoft: '#FDE7E5',
    info: '#35517A',
    infoSoft: '#E6EDF7',
    focus: '#0B5F6B',
    overlay: 'rgba(15, 18, 21, 0.45)',
  },
  dark: {
    bg: '#0F1215',
    surface: '#171B20',
    surfaceRaised: '#1E242A',
    surfaceSunken: '#0B0E11',
    border: '#2C333B',
    borderStrong: '#46505B',
    text: '#ECEFF2',
    textMuted: '#A9B1BB',
    textSubtle: '#8C95A0',
    accent: '#5FB8C4',
    accentText: '#0B1A1D',
    accentSoft: '#12343A',
    success: '#5BC98A',
    successSoft: '#123322',
    warning: '#E7B34A',
    warningSoft: '#3A2C0C',
    danger: '#F07A70',
    dangerSoft: '#3D1614',
    info: '#8FB0DD',
    infoSoft: '#18253A',
    focus: '#5FB8C4',
    overlay: 'rgba(0, 0, 0, 0.6)',
  },
};

export const space = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  x3: 32,
  x4: 40,
  x5: 48,
  x6: 64,
} as const;

/** Seitenränder je Geräteklasse. */
export const pagePadding = { phone: 16, tablet: 24, desktop: 32 } as const;

/** Eine Radius-Skala: Eingaben/Schaltflächen 8, Flächen 12, Blätter/Dialoge 16, Chips voll. */
export const radius = { control: 8, panel: 12, sheet: 16, pill: 999 } as const;

export interface TextStyleToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
}

export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '600' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  dense: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  small: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
} as const satisfies Record<string, TextStyleToken>;

/** Systemschriften je Plattform (keine geladenen Schriften). */
export const fontFamily = {
  web: 'system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace',
} as const;

/** Mindestgrößen für Bedienflächen. */
export const touchTarget = {
  ios: 44,
  android: 48,
  /** Hauptaktionen in der Mechanikeransicht (Handschuhe, O-13). */
  workshopPrimary: 56,
} as const;

export const motion = {
  /** Nur für Rückmeldung und Zustandswechsel. */
  fast: 150,
  normal: 200,
} as const;

/** Breakpoints (Breite in px) für Layoutwechsel. */
export const breakpoints = { tablet: 768, desktop: 1024, wide: 1280 } as const;

export const zIndex = { base: 0, sticky: 10, dropdown: 20, sheet: 30, dialog: 40, toast: 50 } as const;

// ---------------------------------------------------------------------------
// Kontrastberechnung (WCAG 2.x) für Tests und Laufzeitprüfungen
// ---------------------------------------------------------------------------

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m || m[1] === undefined) throw new Error(`Ungültige Farbe: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
