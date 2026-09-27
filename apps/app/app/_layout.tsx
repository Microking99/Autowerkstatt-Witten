/**
 * Wurzel: Theme, Datenschicht, Sitzung, Rückmeldungen, Demo-Steuerung, Push-Ziele.
 * Deep Links (autowerkstatt://kunde/rechnungen/<id>, https://<domain>/<pfad>) löst
 * Expo Router über dieselben Routen auf; die Bereiche prüfen die Anmeldung.
 */
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../src/auth/session';
import { IS_DEMO } from '../src/config';
import { ApiProvider } from '../src/data/ApiProvider';
import { DemoProvider, useDemo } from '../src/demo/DemoPanel';
import { usePushNotifications } from '../src/notifications/push';
import { ThemeProvider, fontFamily, useTheme } from '../src/theme';
import { DemoBanner, ToastProvider } from '../src/ui';

/** Globale Regeln für den Browser: sichtbarer Fokus, Silbentrennung, Hintergrund. */
function WebGlobalStyles() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const id = 'werkstatt-global-css';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      html, body, #root { height: 100%; }
      body { margin: 0; background: var(--page-bg, #F3F4F6); font-family: ${fontFamily.web}; -webkit-font-smoothing: antialiased; }
      [dir] { hyphens: auto; -webkit-hyphens: auto; }
      input, textarea, select, button { font-family: inherit; }
      *:focus { outline: none; }
      *:focus-visible { outline: 2px solid var(--focus-ring, #0B5F6B) !important; outline-offset: 2px !important; border-radius: 4px; }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
    `;
    document.head.appendChild(style);
  }, []);
  return null;
}

function Chrome({ children }: { children: ReactNode }) {
  const t = useTheme();
  const { openPanel } = useDemo();
  usePushNotifications();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {IS_DEMO ? <DemoBanner onOpenControls={openPanel} /> : null}
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

function NavigationTheme({ children }: { children: ReactNode }) {
  const t = useTheme();
  const base = t.scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <NavigationThemeProvider
      value={{
        ...base,
        colors: { ...base.colors, primary: t.colors.accent, background: t.colors.bg, card: t.colors.surface, text: t.colors.text, border: t.colors.border, notification: t.colors.danger },
      }}
    >
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <WebGlobalStyles />
        <NavigationTheme>
          <ApiProvider>
            <SessionProvider>
              <ToastProvider>
                <DemoProvider>
                  <Chrome>
                    <RootStack />
                  </Chrome>
                </DemoProvider>
              </ToastProvider>
            </SessionProvider>
          </ApiProvider>
        </NavigationTheme>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RootStack() {
  const t = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.bg } }} />;
}
