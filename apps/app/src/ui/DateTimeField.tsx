/**
 * Datum/Uhrzeit nativ: plattformeigener Picker (@react-native-community/datetimepicker).
 * Android: Systemdialog (bei Datum und Uhrzeit nacheinander). iOS: Rad im Blatt mit
 * "Übernehmen". Browser: siehe DateTimeField.web.tsx.
 */
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useId, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { formatDate, formatDateTime, formatTime } from '../lib/format';
import { useTheme } from '../theme';
import { Button } from './Button';
import { FieldLabel, FieldMessage } from './Form';
import { Icon, iconSize } from './icons';
import { Sheet } from './Overlay';
import { AppText } from './Text';

export interface DateTimeFieldProps {
  label: string;
  value: Date | null;
  onChange: (value: Date) => void;
  mode?: 'date' | 'time' | 'datetime';
  minimumDate?: Date;
  maximumDate?: Date;
  help?: string | null;
  error?: string | null;
  required?: boolean;
  testID?: string;
}

function display(value: Date | null, mode: DateTimeFieldProps['mode']): string {
  if (!value) return 'Bitte auswählen';
  if (mode === 'date') return formatDate(value);
  if (mode === 'time') return `${formatTime(value)} Uhr`;
  return formatDateTime(value);
}

export function DateTimeField({ label, value, onChange, mode = 'datetime', minimumDate, maximumDate, help, error, required, testID }: DateTimeFieldProps) {
  const t = useTheme();
  const id = useId();
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(value ?? new Date());

  const openPicker = () => {
    const base = value ?? minimumDate ?? new Date();
    if (Platform.OS === 'android') {
      const pick = (pickMode: 'date' | 'time', from: Date, then?: (d: Date) => void) =>
        DateTimePickerAndroid.open({
          value: from,
          mode: pickMode,
          is24Hour: true,
          minimumDate,
          maximumDate,
          onChange: (event: DateTimePickerEvent, date?: Date) => {
            if (event.type !== 'set' || !date) return;
            if (then) then(date);
            else onChange(date);
          },
        });
      if (mode === 'datetime') pick('date', base, (d) => pick('time', d));
      else pick(mode, base);
      return;
    }
    setDraft(base);
    setIosOpen(true);
  };

  return (
    <View style={styles.field}>
      <FieldLabel label={label} required={required} nativeID={`${id}-label`} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${display(value, mode)}`}
        accessibilityHint="Öffnet die Auswahl"
        onPress={openPicker}
        testID={testID}
        style={({ pressed }) => [
          styles.control,
          { borderColor: error ? t.colors.danger : t.colors.borderStrong, backgroundColor: t.colors.surface, borderRadius: t.radius.control },
          pressed ? { opacity: 0.85 } : null,
        ]}
      >
        <Icon name={mode === 'time' ? 'Clock' : 'CalendarBlank'} size={iconSize.md} color={t.colors.textMuted} />
        <AppText numeric tone={value ? 'default' : 'subtle'} style={styles.flex}>
          {display(value, mode)}
        </AppText>
      </Pressable>
      <FieldMessage error={error} help={help} />
      {Platform.OS === 'ios' ? (
        <Sheet
          visible={iosOpen}
          onClose={() => setIosOpen(false)}
          title={label}
          footer={
            <Button
              label="Übernehmen"
              variant="primary"
              onPress={() => {
                onChange(draft);
                setIosOpen(false);
              }}
            />
          }
        >
          <DateTimePicker
            value={draft}
            mode={mode}
            display="spinner"
            locale="de-DE"
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onChange={(_e: DateTimePickerEvent, d?: Date) => d && setDraft(d)}
          />
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6, alignSelf: 'stretch' },
  control: { minHeight: 48, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
});
