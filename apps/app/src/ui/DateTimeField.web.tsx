/**
 * Datum/Uhrzeit im Browser: native HTML-Eingaben (date, time, datetime-local), vollständig
 * mit Tastatur bedienbar. Werte in Ortszeit.
 */
import { useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fontFamily, useTheme } from '../theme';
import { FieldLabel, FieldMessage } from './Form';
import type { DateTimeFieldProps } from './DateTimeField';

export type { DateTimeFieldProps };

const pad = (n: number) => String(n).padStart(2, '0');

function toInput(value: Date | null, mode: DateTimeFieldProps['mode']): string {
  if (!value) return '';
  const d = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const t = `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  if (mode === 'date') return d;
  if (mode === 'time') return t;
  return `${d}T${t}`;
}

function fromInput(raw: string, mode: DateTimeFieldProps['mode'], previous: Date | null): Date | null {
  if (!raw) return null;
  if (mode === 'time') {
    const [h, m] = raw.split(':').map(Number) as [number, number];
    const base = previous ? new Date(previous) : new Date();
    base.setHours(h, m, 0, 0);
    return base;
  }
  if (mode === 'date') {
    const [y, mo, d] = raw.split('-').map(Number) as [number, number, number];
    return new Date(y, mo - 1, d, previous?.getHours() ?? 8, previous?.getMinutes() ?? 0);
  }
  const [datePart, timePart = '00:00'] = raw.split('T');
  const [y, mo, d] = (datePart ?? '').split('-').map(Number) as [number, number, number];
  const [h, m] = timePart.split(':').map(Number) as [number, number];
  const result = new Date(y, mo - 1, d, h, m);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function DateTimeField({ label, value, onChange, mode = 'datetime', minimumDate, maximumDate, help, error, required, testID }: DateTimeFieldProps) {
  const t = useTheme();
  const id = useId();
  const [focused, setFocused] = useState(false);
  const type = mode === 'date' ? 'date' : mode === 'time' ? 'time' : 'datetime-local';
  return (
    <View style={styles.field}>
      <FieldLabel label={label} required={required} nativeID={`${id}-label`} />
      <input
        id={id}
        type={type}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-required={required}
        data-testid={testID}
        value={toInput(value, mode)}
        min={minimumDate ? toInput(minimumDate, mode) : undefined}
        max={maximumDate ? toInput(maximumDate, mode) : undefined}
        step={mode === 'date' ? undefined : 900}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const next = fromInput(e.currentTarget.value, mode, value);
          if (next) onChange(next);
        }}
        style={{
          minHeight: 48,
          boxSizing: 'border-box',
          width: '100%',
          padding: focused || error ? '0 11px' : '0 12px',
          borderRadius: t.radius.control,
          border: `${focused || error ? 2 : 1}px solid ${error ? t.colors.danger : focused ? t.colors.accent : t.colors.borderStrong}`,
          background: t.colors.surface,
          color: t.colors.text,
          fontFamily: fontFamily.web,
          fontSize: 16,
          fontVariantNumeric: 'tabular-nums',
          colorScheme: t.scheme,
          outline: 'none',
        }}
      />
      <FieldMessage error={error} help={help} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6, alignSelf: 'stretch' },
});
