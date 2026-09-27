/**
 * Tastaturbedienung am PC (docs/ansichten-und-routen.md, Abschnitt 1): Strg+K Schnellsuche,
 * Alt+1…8 Hauptbereiche, Strg+Enter speichern, Esc schließt Dialoge (Modal), J/K/Enter in
 * Listen. Nur im Browser bzw. in der Windows-Hülle aktiv; auf Telefonen ohne Wirkung.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/** Rückgabe `false`: nicht behandelt (Standardverhalten des Browsers bleibt erhalten). */
export type HotkeyHandler = (event: KeyboardEvent) => void | false;

/** Tippt der Nutzer gerade in ein Feld? Dann gelten einfache Buchstabentasten nicht. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

/** Ist gerade ein Dialog offen (dann gelten Listen-Kürzel nicht)? */
export function dialogOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return !!document.querySelector('[aria-modal="true"]');
}

/** "mod" = Strg (Windows/Linux) bzw. Cmd (macOS). */
export function matches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const mod = parts.includes('mod');
  const alt = parts.includes('alt');
  const shift = parts.includes('shift');
  if (mod !== (event.ctrlKey || event.metaKey)) return false;
  if (alt !== event.altKey) return false;
  if (shift !== event.shiftKey) return false;
  const pressed = event.key.toLowerCase();
  if (key === 'enter') return pressed === 'enter';
  if (key === 'escape') return pressed === 'escape';
  // Alt+Ziffer liefert auf manchen Tastaturen Sonderzeichen: Code prüfen
  if (/^\d$/.test(key ?? '')) return pressed === key || event.code === `Digit${key}`;
  return pressed === key;
}

/**
 * Tastenkürzel registrieren. Einfache Tasten (ohne Strg/Alt) wirken nicht, während in ein
 * Feld getippt wird oder ein Dialog offen ist.
 */
export function useHotkeys(bindings: Record<string, HotkeyHandler>, enabled = true): void {
  const ref = useRef(bindings);
  ref.current = bindings;
  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      for (const [combo, handler] of Object.entries(ref.current)) {
        if (!matches(event, combo)) continue;
        const plain = !combo.includes('mod') && !combo.includes('alt');
        if (plain && (isTypingTarget(event.target) || dialogOpen())) continue;
        if (handler(event) === false) continue;
        event.preventDefault();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/**
 * Strg+Enter speichert das Formular (auch aus einem Textfeld heraus). "page": nur, wenn kein
 * Dialog offen ist; "dialog": nur für das Formular im offenen Dialog.
 */
export function useSaveShortcut(onSave: () => void, enabled = true, scope: 'page' | 'dialog' = 'page'): void {
  useHotkeys(
    {
      'mod+enter': () => {
        const open = dialogOpen();
        if (scope === 'page' ? open : !open) return false;
        onSave();
      },
    },
    enabled,
  );
}

/** Hinweistext für Schaltflächen am PC. */
export const SAVE_HINT = Platform.OS === 'web' ? 'Strg+Enter' : '';
