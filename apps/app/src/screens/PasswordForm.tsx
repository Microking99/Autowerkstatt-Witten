import { PasswordSchema } from '@werkstatt/contracts';
import { useState } from 'react';
import { Button, TextField } from '../ui';

/** Neues Passwort festlegen (mindestens 10 Zeichen, keine Zusammensetzungsregeln). */
export function PasswordForm({ submitLabel, pending, onSubmit }: { submitLabel: string; pending: boolean; onSubmit: (password: string) => void }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const tooShort = !PasswordSchema.safeParse(password).success;
  const mismatch = password !== repeat;
  return (
    <>
      <TextField
        label="Neues Passwort"
        value={password}
        onChangeText={setPassword}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
        help="Mindestens 10 Zeichen. Ein Satz aus mehreren Wörtern ist gut zu merken."
        error={submitted && tooShort ? 'Das Passwort muss mindestens 10 Zeichen haben.' : null}
        required
        testID="neues-passwort"
      />
      <TextField
        label="Passwort wiederholen"
        value={repeat}
        onChangeText={setRepeat}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
        error={submitted && mismatch ? 'Die Passwörter stimmen nicht überein.' : null}
        required
        testID="passwort-wiederholen"
      />
      <Button
        label={submitLabel}
        variant="primary"
        loading={pending}
        fullWidth
        testID="passwort-speichern"
        onPress={() => {
          setSubmitted(true);
          if (tooShort || mismatch) return;
          onSubmit(password);
        }}
      />
    </>
  );
}
