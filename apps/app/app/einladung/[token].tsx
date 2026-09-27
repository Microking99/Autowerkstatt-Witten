/**
 * Einladung annehmen: Passwort festlegen, danach angemeldet zur Startseite.
 * Ungültig, abgelaufen oder benutzt → Hinweis und Kontakt zur Werkstatt.
 */
import { homeForRole, routes } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { useSession } from '../../src/auth/session';
import { ERROR_CODES, type ApiError } from '../../src/data/errors';
import { useApiMutation } from '../../src/data/hooks';
import { PasswordForm } from '../../src/screens/PasswordForm';
import { PublicPage, PublicPanel } from '../../src/screens/common';
import { AppText, Banner, Button, EmptyState } from '../../src/ui';

function tokenProblem(error: ApiError | null): string | null {
  if (!error) return null;
  // Die API meldet ungültige, abgelaufene und benutzte Einladungen einheitlich (invitation_invalid)
  // und nennt den Grund nur in der Meldung.
  if (error.code === ERROR_CODES.invitationInvalid || error.status === 404 || error.status === 410) {
    return error.message || 'Diese Einladung ist ungültig, abgelaufen oder wurde bereits verwendet.';
  }
  return null;
}

export default function InvitationScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const session = useSession();
  const accept = useApiMutation((api, password: string) => api.acceptInvitation({ token: String(token), password }));
  const [problem, setProblem] = useState<string | null>(null);

  if (problem) {
    return (
      <PublicPage>
        <EmptyState
          icon="LinkSimple"
          title="Einladung nicht nutzbar"
          message={`${problem} Bitte wenden Sie sich an die Autowerkstatt Witten; wir senden Ihnen gern eine neue Einladung.`}
          action={<Button label="Zur Anmeldung" variant="primary" onPress={() => router.replace(routes.login() as Href)} />}
        />
      </PublicPage>
    );
  }

  return (
    <PublicPage>
      <PublicPanel>
        <AppText variant="display">Zugang einrichten</AppText>
        <AppText tone="muted">Legen Sie ein Passwort für Ihren Zugang zur Autowerkstatt Witten fest. Danach sind Sie direkt angemeldet.</AppText>
        {accept.error && !tokenProblem(accept.error) ? (
          <Banner tone="danger" title="Nicht gespeichert" message={accept.error.isNetwork ? 'Keine Verbindung. Bitte versuchen Sie es erneut.' : accept.error.message} />
        ) : null}
        <PasswordForm
          submitLabel="Passwort speichern"
          pending={accept.pending}
          onSubmit={async (password) => {
            try {
              const res = await accept.mutate(password);
              const user = await session.adopt(res);
              router.replace(homeForRole(user.role) as Href);
            } catch (e) {
              const p = tokenProblem(e as ApiError);
              if (p) setProblem(p);
            }
          }}
        />
      </PublicPanel>
    </PublicPage>
  );
}
