# ADR-010: Benachrichtigungen über eine Outbox

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** R-BEN-1, R-ARCH-8, R-ARCH-9

## Kontext

Kunden und Mitarbeiter sollen per App-Benachrichtigung und E-Mail auf Vorgänge hingewiesen
werden (neue Freigabeanfrage, Rechnung, bestätigte Zahlung, Termin, Nachricht). Eine
Benachrichtigung darf weder verloren gehen, wenn der Versand kurz ausfällt, noch doppelt
kommen, und sie darf keine vertraulichen Inhalte über Dritte (Apple, Google, E-Mail-Anbieter)
transportieren.

## Entscheidung

- **Outbox:** Das auslösende Ereignis und die Benachrichtigungen (`notifications`, je Empfänger
  und Kanal) werden **in derselben Datenbanktransaktion** geschrieben. `dedupe_key` ist
  eindeutig, damit ein wiederholtes Ereignis keine zweite Benachrichtigung erzeugt.
- **Zustell-Worker:** liest offene Einträge, versendet, setzt `sent` oder plant mit
  **Wiederholung und exponentiellem Backoff** neu (`attempts`, `next_attempt_at`,
  `last_error` ohne Personendaten). Nach der letzten Wiederholung `failed` mit Hinweis im
  Betrieb.
- **Kanäle:**
  - **In-App:** immer (Liste `/notifications`).
  - **Push (iOS/Android):** über den **Expo Push Service**, der an **APNs** bzw. **FCM**
    weitergibt. Der Versand ist laut Expo kostenlos, Grenze 600 Benachrichtigungen je Sekunde
    und Projekt. Direkter Versand an APNs/FCM ist als Alternative dokumentiert und bleibt
    möglich (entfernt den Zwischenschritt über Expo).
  - **E-Mail:** über einen Anbieter mit Datenhaltung in der EU (O-19), angebunden über SMTP.
- **Inhalt:** neutraler deutscher Text ohne vertrauliche Details ("Neue Freigabeanfrage zu
  Ihrem Auftrag") und ein **Deep Link nur mit Pfad und IDs**
  (`docs/ansichten-und-routen.md` Abschnitt 6). Die Zielroute prüft nach Anmeldung die
  Berechtigung wie jeder andere Aufruf.
- **Einstellungen:** je Benutzer, Ereignis und Kanal (`notification_preferences`), sonst
  Werkstatt-Voreinstellung.
- **Browser:** `expo-notifications` unterstützt nur Android und iOS. Browser-Kunden erhalten
  **E-Mail und In-App-Hinweise**, kein Web-Push (O-22). Die Windows-Hülle ebenso.
- **Kritische Ereignisse** (Freigabeanfrage, Rechnung) gehen standardmäßig per Push **und**
  E-Mail, weil Push nicht garantiert ankommt.

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| Direkter Versand in der Anfrage | Geht bei Ausfall des Anbieters verloren oder verzögert die Antwort; keine Wiederholung. |
| Nachrichtenwarteschlange als eigener Dienst | Für eine Werkstatt unnötiger Betriebsaufwand; die Datenbank genügt. |
| Web-Push (VAPID, Service Worker) sofort | Zusätzliche Implementierung außerhalb von Expo; erst nach Bedarf (O-22). |
| Inhalte in der Push-Nachricht | Vertrauliche Daten würden über Apple/Google laufen; App-Review-Regel 4.5.4 rät davon ab. |

## Folgen

- Zustellung ist nachvollziehbar (Status, Versuche, Fehler) und im Test mit
  Test-Implementierungen der Adapter prüfbar.
- Für Push werden ein Apple-Developer-Konto (APNs-Schlüssel) und ein Firebase-Projekt (FCM)
  benötigt; beides legt der Inhaber an. Auftragsverarbeitungsverträge mit Expo, Apple, Google
  und dem E-Mail-Anbieter sind Prüfpunkte.
- Test T-11 (`docs/tests.md`).

## Quellen (abgerufen 26.09.2026)

- Expo Push FAQ (kostenlos, 600/s): https://docs.expo.dev/push-notifications/faq/
- Versand direkt über FCM/APNs: https://docs.expo.dev/push-notifications/sending-notifications-custom/
- expo-notifications Plattformen: https://docs.expo.dev/versions/latest/sdk/notifications/
- Firebase-Preise (FCM kostenlos): https://firebase.google.com/pricing
- App Review Guidelines 4.5.4: https://developer.apple.com/app-store/review/guidelines/
