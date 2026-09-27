/**
 * Farbschema und Tokens aus @werkstatt/design-tokens (docs/designsystem.md).
 * Hell/Dunkel folgt der Systemeinstellung (userInterfaceStyle: automatic).
 */
import {
  breakpoints,
  colors,
  fontFamily,
  pagePadding,
  radius,
  space,
  touchTarget,
  typography,
  type ColorScheme,
  type ColorTokens,
} from '@werkstatt/design-tokens';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Platform, useColorScheme, useWindowDimensions, type TextStyle } from 'react-native';

export type TypographyVariant = keyof typeof typography;

export interface Theme {
  scheme: ColorScheme;
  colors: ColorTokens;
  space: typeof space;
  radius: typeof radius;
  typography: typeof typography;
  touchTarget: typeof touchTarget;
  /** Textstil inkl. Plattformschrift */
  text: (variant: TypographyVariant) => TextStyle;
}

/** Systemschrift: nativ die Plattformschrift (SF Pro / Roboto), im Browser system-ui. */
export const platformFont: TextStyle = Platform.select<TextStyle>({
  web: { fontFamily: fontFamily.web },
  default: {},
});

export const monoFont: TextStyle = Platform.select<TextStyle>({
  web: { fontFamily: fontFamily.mono },
  ios: { fontFamily: 'Menlo' },
  default: { fontFamily: 'monospace' },
});

function buildTheme(scheme: ColorScheme): Theme {
  const c = colors[scheme];
  return {
    scheme,
    colors: c,
    space,
    radius,
    typography,
    touchTarget,
    text: (variant) => ({ ...platformFont, ...typography[variant], color: c.text }),
  };
}

const themes: Record<ColorScheme, Theme> = { light: buildTheme('light'), dark: buildTheme('dark') };

const ThemeContext = createContext<Theme>(themes.light);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const scheme: ColorScheme = system === 'dark' ? 'dark' : 'light';
  const theme = themes[scheme];

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    // Seitenhintergrund, Fokusring und Sprache für den Browser (Fokus sichtbar im Web).
    const rootEl = document.documentElement;
    rootEl.lang = 'de';
    rootEl.style.setProperty('--focus-ring', theme.colors.focus);
    rootEl.style.setProperty('--page-bg', theme.colors.bg);
    rootEl.style.colorScheme = scheme;
    document.body.style.backgroundColor = theme.colors.bg;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', theme.colors.bg);
  }, [scheme, theme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export type DeviceClass = 'phone' | 'tablet' | 'desktop';

/** Telefon < 768 px, Tablet < 1024 px, PC ab 1024 px (design-tokens breakpoints). */
export function useBreakpoint(): { device: DeviceClass; width: number; pagePadding: number; isWide: boolean } {
  const { width } = useWindowDimensions();
  return useMemo(() => {
    const device: DeviceClass = width >= breakpoints.desktop ? 'desktop' : width >= breakpoints.tablet ? 'tablet' : 'phone';
    return { device, width, pagePadding: pagePadding[device], isWide: width >= breakpoints.wide };
  }, [width]);
}

export { breakpoints, fontFamily };
