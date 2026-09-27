/**
 * Anmeldung (E-Mail, Passwort). Fehler verraten nicht, ob die E-Mail existiert.
 * Nach Erfolg zum Ziel aus "weiter" (nur interne Pfade) oder zur Startseite der Rolle.
 */
import { routes } from '@werkstatt/contracts';
import { Redirect, router, useLocalSearchParams, type Href } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';
import { targetAfterLogin } from '../src/auth/nextPath';
import { useSession } from '../src/auth/session';
import { IS_DEMO } from '../src/config';
import { DEMO_EMAILS, DEMO_PASSWORD } from '../src/data/demo/constants';
import { ERROR_CODES, toApiError } from '../src/data/errors';
import { useDemo } from '../src/demo/DemoPanel';
import { PublicPage, PublicPanel } from '../src/screens/common';
import { AppText, Banner, Button, ListGroup, ListRow, TextField } from '../src/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const params = useLocalSearchParams<{ weiter?: string }>();
  const session = useSession();
  const { demo } = useDemo();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<{ title: string; message: string } | null>(null);
  const passwordRef = useRef<TextInput>(null);

  if (session.status === 'signedIn' && session.user) {
    return <Redirect href={targetAfterLogin(session.user, params.weiter) as Href} />;
  }

  const emailError = (touched.email || submitted) && !EMAIL_RE.test(email.trim()) ? 'Bitte geben Sie eine gültige E-Mail-Adresse ein.' : null;
  const passwordError = (touched.password || submitted) && password.length === 0 ? 'Bitte geben Sie Ihr Passwort ein.' : null;

  const submit = async () => {
    setSubmitted(true);
    if (!EMAIL_RE.test(email.trim()) || password.length === 0) return;
    setPending(true);
    setFormError(null);
    try {
      const user = await session.signIn(email.trim(), password);
      router.replace(targetAfterLogin(user, params.weiter) as Href);
    } catch (e) {
      const err = toApiError(e);
      if (err.isNetwork) setFormError({ title: 'Keine Verbindung', message: 'Die Anmeldung ist gerade nicht möglich. Bitte prüfen Sie Ihre Internetverbindung.' });
      else if (err.code === ERROR_CODES.accountDisabled) setFormError({ title: 'Zugang gesperrt', message: err.message });
      else setFormError({ title: 'Anmeldung fehlgeschlagen', message: 'E-Mail-Adresse oder Passwort ist nicht korrekt.' });
    } finally {
      setPending(false);
    }
  };

  return (
    <PublicPage testID="anmeldung">
      <PublicPanel>
        <View style={styles.head}>
          <AppText variant="display" accessibilityRole="header">
            Anmelden
          </AppText>
          {params.weiter ? (
            <AppText tone="muted">Nach der Anmeldung geht es direkt weiter zu Ihrem Vorgang.</AppText>
          ) : (
            <AppText tone="muted">Für Kundinnen und Kunden sowie das Team der Werkstatt.</AppText>
          )}
        </View>
        {session.expired ? <Banner tone="info" title="Sitzung abgelaufen" message="Bitte melden Sie sich erneut an." /> : null}
        {formError ? <Banner tone="danger" title={formError.title} message={formError.message} testID="anmeldung-fehler" /> : null}
        <TextField
          label="E-Mail-Adresse"
          value={email}
          onChangeText={setEmail}
          onBlur={() => setTouched((s) => ({ ...s, email: true }))}
          error={emailError}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          required
          testID="email"
        />
        <TextField
          ref={passwordRef}
          label="Passwort"
          value={password}
          onChangeText={setPassword}
          onBlur={() => setTouched((s) => ({ ...s, password: true }))}
          error={passwordError}
          secure
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          required
          testID="passwort"
        />
        <Button label="Anmelden" variant="primary" onPress={() => void submit()} loading={pending} fullWidth testID="anmelden" />
        <Button label="Passwort vergessen" variant="quiet" onPress={() => router.push(routes.forgotPassword() as Href)} />
      </PublicPanel>

      {IS_DEMO && demo ? (
        <PublicPanel>
          <AppText variant="heading">Beispielzugänge (Demo)</AppText>
          <AppText tone="muted">
            Kennwort für alle Beispielzugänge: <AppText variant="bodyStrong" code>{DEMO_PASSWORD}</AppText>. Ein Klick meldet direkt an.
          </AppText>
          <ListGroup>
            {demo.controls.accounts().map((a, i) => (
              <ListRow
                key={a.key}
                first={i === 0}
                icon={a.key === 'customer' || a.key === 'previousOwner' ? 'UserCircle' : a.key === 'mechanic' ? 'Wrench' : 'Storefront'}
                title={`${a.label}: ${a.displayName}`}
                subtitle={a.description}
                testID={`demo-zugang-${a.key}`}
                onPress={async () => {
                  setPending(true);
                  try {
                    const user = await session.signIn(a.email, DEMO_PASSWORD);
                    router.replace(targetAfterLogin(user, params.weiter) as Href);
                  } catch (e) {
                    setFormError({ title: 'Anmeldung fehlgeschlagen', message: toApiError(e).message });
                  } finally {
                    setPending(false);
                  }
                }}
              />
            ))}
          </ListGroup>
          <Button
            label="Kundin eintragen"
            variant="quiet"
            icon="PencilSimple"
            onPress={() => {
              setEmail(DEMO_EMAILS.customer);
              setPassword(DEMO_PASSWORD);
            }}
          />
        </PublicPanel>
      ) : null}
    </PublicPage>
  );
}

const styles = StyleSheet.create({
  head: { gap: 6 },
});
