/** Neues Passwort über den Link aus der E-Mail. Danach sind alle Sitzungen beendet. */
import { routes } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { ERROR_CODES, type ApiError } from '../../src/data/errors';
import { useApiMutation } from '../../src/data/hooks';
import { PasswordForm } from '../../src/screens/PasswordForm';
import { PublicPage, PublicPanel } from '../../src/screens/common';
import { AppText, Banner, Button, EmptyState } from '../../src/ui';

export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const reset = useApiMutation((api, password: string) => api.resetPassword({ token: String(token), password }));
  const [state, setState] = useState<'form' | 'done' | 'invalid'>('form');
  const [reason, setReason] = useState('');

  if (state === 'done') {
    return (
      <PublicPage>
        <EmptyState
          icon="CheckCircle"
          title="Passwort gespeichert"
          message="Aus Sicherheitsgründen wurden alle bestehenden Anmeldungen beendet. Bitte melden Sie sich mit dem neuen Passwort an."
          action={<Button label="Zur Anmeldung" variant="primary" onPress={() => router.replace(routes.login() as Href)} />}
        />
      </PublicPage>
    );
  }
  if (state === 'invalid') {
    return (
      <PublicPage>
        <EmptyState
          icon="LinkSimple"
          title="Link nicht nutzbar"
          message={`${reason} Fordern Sie bitte einen neuen Link an.`}
          action={<Button label="Neuen Link anfordern" variant="primary" onPress={() => router.replace(routes.forgotPassword() as Href)} />}
        />
      </PublicPage>
    );
  }
  return (
    <PublicPage>
      <PublicPanel>
        <AppText variant="display">Neues Passwort</AppText>
        {reset.error && reset.error.status !== 404 && reset.error.status !== 410 ? (
          <Banner tone="danger" title="Nicht gespeichert" message={reset.error.isNetwork ? 'Keine Verbindung. Bitte versuchen Sie es erneut.' : reset.error.message} />
        ) : null}
        <PasswordForm
          submitLabel="Passwort speichern"
          pending={reset.pending}
          onSubmit={async (password) => {
            try {
              await reset.mutate(password);
              setState('done');
            } catch (e) {
              const err = e as ApiError;
              if (err.status === 404 || err.status === 410) {
                setReason(
                  err.code === ERROR_CODES.tokenExpired
                    ? 'Dieser Link ist abgelaufen (Links gelten eine Stunde).'
                    : err.code === ERROR_CODES.tokenUsed
                      ? 'Dieser Link wurde bereits verwendet.'
                      : 'Dieser Link ist ungültig.',
                );
                setState('invalid');
              }
            }
          }}
        />
      </PublicPanel>
    </PublicPage>
  );
}
