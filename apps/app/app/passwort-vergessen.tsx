import { routes } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { toApiError } from '../src/data/errors';
import { useApiMutation } from '../src/data/hooks';
import { PublicPage, PublicPanel } from '../src/screens/common';
import { AppText, Banner, Button, TextField } from '../src/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Rücksetzlink anfordern. Die Bestätigung ist immer gleich (verrät nicht, ob ein Konto existiert). */
export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [done, setDone] = useState(false);
  const send = useApiMutation((api, value: string) => api.forgotPassword({ email: value }));
  const error = submitted && !EMAIL_RE.test(email.trim()) ? 'Bitte geben Sie eine gültige E-Mail-Adresse ein.' : null;

  return (
    <PublicPage>
      <PublicPanel>
        <AppText variant="display">Passwort vergessen</AppText>
        {done ? (
          <>
            <Banner
              tone="success"
              title="Anfrage erhalten"
              message="Wenn zu dieser Adresse ein Konto besteht, haben wir Ihnen einen Link zum Zurücksetzen gesendet. Der Link ist eine Stunde gültig."
            />
            <Button label="Zur Anmeldung" variant="primary" onPress={() => router.replace(routes.login() as Href)} />
          </>
        ) : (
          <>
            <AppText tone="muted">Geben Sie die E-Mail-Adresse Ihres Zugangs ein. Sie erhalten einen Link, mit dem Sie ein neues Passwort festlegen.</AppText>
            {send.error ? <Banner tone="danger" title="Nicht gesendet" message={send.error.isNetwork ? 'Keine Verbindung. Bitte versuchen Sie es erneut.' : toApiError(send.error).message} /> : null}
            <TextField label="E-Mail-Adresse" value={email} onChangeText={setEmail} error={error} keyboardType="email-address" autoCapitalize="none" autoComplete="email" required />
            <Button
              label="Link senden"
              variant="primary"
              loading={send.pending}
              fullWidth
              onPress={async () => {
                setSubmitted(true);
                if (!EMAIL_RE.test(email.trim())) return;
                try {
                  await send.mutate(email.trim());
                  setDone(true);
                } catch {
                  // Fehler wird angezeigt
                }
              }}
            />
            <Button label="Zurück zur Anmeldung" variant="quiet" icon="ArrowLeft" onPress={() => router.replace(routes.login() as Href)} />
          </>
        )}
      </PublicPanel>
    </PublicPage>
  );
}
