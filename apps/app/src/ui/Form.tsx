/**
 * Formularbausteine: Beschriftung über dem Feld, Hilfe darunter, Fehler direkt am Feld
 * (Symbol + Text, als Live-Region angesagt). Nie Platzhalter als Beschriftung.
 */
import { forwardRef, useId, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  Switch as RNSwitch,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type PressableStateCallbackType,
  type TextInputProps,
} from 'react-native';
import { platformFont, useTheme } from '../theme';
import { Icon, iconSize, type IconName } from './icons';
import { AppText } from './Text';

type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

export function FieldLabel({ label, required, nativeID }: { label: string; required?: boolean; nativeID?: string }) {
  return (
    <AppText variant="caption" tone="muted" nativeID={nativeID} style={styles.label}>
      {label}
      {required ? <AppText variant="caption" tone="danger" accessibilityLabel="Pflichtfeld">{' *'}</AppText> : null}
    </AppText>
  );
}

export function FieldMessage({ error, help, nativeID }: { error?: string | null; help?: string | null; nativeID?: string }) {
  const t = useTheme();
  if (error) {
    return (
      <View style={styles.message} nativeID={nativeID} accessibilityLiveRegion="polite" role="alert">
        <Icon name="WarningCircle" size={iconSize.sm} color={t.colors.danger} />
        <AppText variant="small" tone="danger" style={styles.flex}>
          {error}
        </AppText>
      </View>
    );
  }
  if (help) {
    return (
      <AppText variant="small" tone="subtle" nativeID={nativeID} style={styles.help}>
        {help}
      </AppText>
    );
  }
  return null;
}

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'onChange'> {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  help?: string | null;
  error?: string | null;
  required?: boolean;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  secure?: boolean;
  leadingIcon?: IconName;
  trailing?: ReactNode;
  testID?: string;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, value, onChangeText, help, error, required, multiline, secure, leadingIcon, trailing, testID, ...rest },
  ref,
) {
  const t = useTheme();
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const labelId = `${id}-label`;
  const messageId = `${id}-message`;
  return (
    <View style={styles.field}>
      <FieldLabel label={label} required={required} nativeID={labelId} />
      <View
        style={[
          styles.inputWrap,
          {
            borderColor: error ? t.colors.danger : focused ? t.colors.accent : t.colors.borderStrong,
            backgroundColor: rest.editable === false ? t.colors.surfaceSunken : t.colors.surface,
            borderRadius: t.radius.control,
            minHeight: multiline ? 112 : 48,
            borderWidth: focused || error ? 2 : 1,
            paddingHorizontal: focused || error ? 11 : 12,
          },
        ]}
      >
        {leadingIcon ? <Icon name={leadingIcon} size={iconSize.md} color={t.colors.textSubtle} /> : null}
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          accessibilityLabel={label}
          aria-labelledby={labelId}
          aria-describedby={error || help ? messageId : undefined}
          aria-invalid={error ? true : undefined}
          aria-required={required}
          multiline={multiline}
          secureTextEntry={secure && !reveal}
          placeholderTextColor={t.colors.textSubtle}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          testID={testID}
          {...rest}
          style={[
            styles.input,
            platformFont,
            t.typography.body,
            { color: t.colors.text },
            multiline ? { textAlignVertical: 'top', paddingTop: 12, minHeight: 100 } : null,
            Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
          ]}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={reveal ? 'Passwort verbergen' : 'Passwort anzeigen'}
            onPress={() => setReveal((r) => !r)}
            style={styles.reveal}
          >
            <Icon name={reveal ? 'EyeSlash' : 'Eye'} size={iconSize.md} color={t.colors.textMuted} />
          </Pressable>
        ) : null}
        {trailing}
      </View>
      <FieldMessage error={error} help={help} nativeID={messageId} />
    </View>
  );
});

export function SearchField({ value, onChangeText, label = 'Suchen', placeholder }: { value: string; onChangeText: (v: string) => void; label?: string; placeholder?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.inputWrap, { borderColor: t.colors.borderStrong, backgroundColor: t.colors.surface, borderRadius: t.radius.control, minHeight: 48, borderWidth: 1, paddingHorizontal: 12 }]}>
      <Icon name="MagnifyingGlass" size={iconSize.md} color={t.colors.textSubtle} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={t.colors.textSubtle}
        returnKeyType="search"
        style={[styles.input, platformFont, t.typography.body, { color: t.colors.text }]}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Suche leeren" onPress={() => onChangeText('')} style={styles.reveal}>
          <Icon name="X" size={iconSize.md} color={t.colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Checkbox({ label, checked, onChange, description, testID }: { label: string; checked: boolean; onChange: (v: boolean) => void; description?: string; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      testID={testID}
      style={(s: PressState) => [styles.check, s.pressed ? { opacity: 0.8 } : null]}
    >
      <View
        style={[
          styles.box,
          { borderRadius: 6, borderColor: checked ? t.colors.accent : t.colors.borderStrong, backgroundColor: checked ? t.colors.accent : t.colors.surface },
        ]}
      >
        {checked ? <Icon name="Check" size={iconSize.sm} color={t.colors.accentText} /> : null}
      </View>
      <View style={styles.flex}>
        <AppText>{label}</AppText>
        {description ? (
          <AppText variant="small" tone="subtle">
            {description}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

export function SwitchRow({ label, value, onChange, description, disabled, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; description?: string; disabled?: boolean; testID?: string }) {
  const t = useTheme();
  return (
    <View style={styles.switchRow}>
      <View style={styles.flex}>
        <AppText>{label}</AppText>
        {description ? (
          <AppText variant="small" tone="subtle">
            {description}
          </AppText>
        ) : null}
      </View>
      <RNSwitch
        accessibilityLabel={label}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        testID={testID}
        trackColor={{ true: t.colors.accent, false: t.colors.borderStrong }}
        thumbColor={Platform.OS === 'android' ? t.colors.surfaceRaised : undefined}
        {...(Platform.OS === 'web' ? ({ activeThumbColor: t.colors.surfaceRaised } as object) : {})}
      />
    </View>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export function SegmentedControl<T extends string>({ options, value, onChange, label }: { options: SegmentOption<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segment, { backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.control }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={(s: PressState) => [
              styles.segmentItem,
              { borderRadius: t.radius.control - 2 },
              selected ? { backgroundColor: t.colors.surfaceRaised, borderColor: t.colors.border, borderWidth: 1 } : null,
              s.pressed ? { opacity: 0.8 } : null,
            ]}
          >
            {o.icon ? <Icon name={o.icon} size={iconSize.sm} color={selected ? t.colors.text : t.colors.textMuted} /> : null}
            <AppText variant="caption" tone={selected ? 'default' : 'muted'} numberOfLines={1} style={{ fontWeight: selected ? '600' : '500', fontSize: 14 }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6, alignSelf: 'stretch' },
  label: { fontSize: 14, lineHeight: 20 },
  message: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', paddingTop: 2 },
  help: { paddingTop: 2 },
  flex: { flex: 1, minWidth: 0 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minHeight: 44, paddingVertical: 10, minWidth: 0 },
  reveal: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  check: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', minHeight: 48, paddingVertical: 12 },
  box: { width: 24, height: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 0 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 56, paddingVertical: 8 },
  segment: { flexDirection: 'row', padding: 3, gap: 3, alignSelf: 'stretch' },
  segmentItem: { flex: 1, minHeight: 44, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
});
