import { useId, useState } from 'react';
import { Pressable, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import { useTheme } from '../theme';
import { FieldLabel, FieldMessage } from './Form';
import { Icon, iconSize } from './icons';
import { Sheet } from './Overlay';
import { AppText } from './Text';

type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export interface SelectProps<T extends string> {
  label: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  help?: string | null;
  error?: string | null;
  required?: boolean;
  testID?: string;
}

/**
 * Auswahl: öffnet eine Liste im Blatt. Funktioniert gleich auf Telefon, Tablet und PC
 * (per Tastatur mit Tab und Enter bedienbar).
 */
export function Select<T extends string>({ label, value, options, onChange, placeholder = 'Bitte auswählen', help, error, required, testID }: SelectProps<T>) {
  const t = useTheme();
  const id = useId();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={styles.field}>
      <FieldLabel label={label} required={required} nativeID={`${id}-label`} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        accessibilityHint="Öffnet die Auswahl"
        onPress={() => setOpen(true)}
        testID={testID}
        style={(s: PressState) => [
          styles.control,
          {
            borderColor: error ? t.colors.danger : s.hovered ? t.colors.accent : t.colors.borderStrong,
            backgroundColor: t.colors.surface,
            borderRadius: t.radius.control,
          },
          s.pressed ? { opacity: 0.85 } : null,
        ]}
      >
        <AppText tone={current ? 'default' : 'subtle'} style={styles.flex} numberOfLines={1}>
          {current?.label ?? placeholder}
        </AppText>
        <Icon name="CaretDown" size={iconSize.md} color={t.colors.textMuted} />
      </Pressable>
      <FieldMessage error={error} help={help} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={label} width={480}>
        <View accessibilityRole="radiogroup" style={styles.list}>
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <Pressable
                key={o.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={o.label}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={(s: PressState) => [
                  styles.option,
                  { borderRadius: t.radius.control, borderColor: selected ? t.colors.accent : t.colors.border, backgroundColor: selected ? t.colors.accentSoft : t.colors.surface },
                  s.hovered ? { borderColor: t.colors.accent } : null,
                  s.pressed ? { opacity: 0.85 } : null,
                ]}
              >
                <View style={styles.flex}>
                  <AppText variant={selected ? 'bodyStrong' : 'body'}>{o.label}</AppText>
                  {o.description ? (
                    <AppText variant="small" tone="subtle">
                      {o.description}
                    </AppText>
                  ) : null}
                </View>
                {selected ? <Icon name="Check" size={iconSize.md} color={t.colors.accent} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6, alignSelf: 'stretch' },
  control: { minHeight: 48, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  list: { gap: 8 },
  option: { minHeight: 52, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
