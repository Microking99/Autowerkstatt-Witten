# ADR-007: Zahlungen über SumUp Hosted Checkout

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** R-ZAHL-1 bis R-ZAHL-12, AGENTS.md Regel 7
- **Ausführlich:** `docs/zahlungen.md`

## Kontext

Kunden sollen Rechnungen in der iPhone-App, der Android-App, im Browser und aus der
Windows-Anwendung heraus bezahlen können. SumUp ist bevorzugter Anbieter (R-ZAHL-2). Der
Rechnungsstatus darf sich erst nach serverseitig geprüfter Anbieterbestätigung ändern;
doppelte Meldungen dürfen keine Doppelbuchung erzeugen; Kartendaten dürfen nicht ins eigene
System gelangen.

## Entscheidung

1. **Gehosteter Checkout über die Checkouts-API:** Der Server legt je Zahlungsversuch einen
   Checkout an (`POST /v0.1/checkouts` mit `hosted_checkout.enabled = true`) und gibt nur die
   `hosted_checkout_url` an den Client. Authentifizierung mit einem **API-Schlüssel**, der nur
   auf dem Server liegt (SumUp empfiehlt API-Schlüssel für einen einzelnen Händler).
2. **Webhook nur als Auslöser:** SumUp sendet für Online-Checkouts nur
   `{"event_type": "CHECKOUT_STATUS_CHANGED", "id": "..."}`; die Doku nennt **keine Signatur**
   und verlangt, das Ereignis immer über die API zu prüfen. Die API liest daher bei jedem
   Webhook `GET /v0.1/checkouts/{id}` und entscheidet nur auf Basis dieser Antwort.
3. **Prüfung vor Buchung:** Status `PAID`, Betrag und Währung gleich dem lokal gespeicherten
   Versuch, Händlercode gleich dem konfigurierten, eigene Referenz passt zur Rechnung,
   Transaktions-ID vorhanden. Erst dann entsteht ein Datensatz in `payments`.
4. **Abgleichsjob:** prüft regelmäßig alle offenen Versuche beim Anbieter, weil Webhooks
   verloren gehen, spät oder mehrfach kommen können.
5. **Eigene Idempotenz:** eindeutige eigene Referenz je Versuch (`checkout_reference`; SumUp
   lehnt Duplikate mit `409 DUPLICATED_CHECKOUT` ab), eindeutige Buchung je
   Anbietertransaktion (`payments (provider, provider_transaction_id)`), eindeutiges
   Anbieterereignis (`provider_events.dedupe_key`), eigener Idempotenzschlüssel für
   Erstattungen (`refunds.idempotency_key`), weil die Erstattungs-API keinen anbietet.
6. **Eigene Portal-Links statt statischer SumUp-Zahlungslinks:** SumUp-Zahlungslinks werden im
   Dashboard bzw. in der SumUp-App erstellt; die öffentliche API enthält dafür keinen Endpunkt.
   E-Mails und PDFs verlinken deshalb auf die eigene Rechnungsansicht; dort erzeugt
   "Jetzt bezahlen" einen frischen Checkout. (Eigene Entscheidung; SumUp selbst erlaubt, die
   URL auch später per E-Mail zu versenden.)
7. **Veraltete offene Checkouts deaktivieren** (`DELETE /v0.1/checkouts/{id}`) und
   `valid_until` setzen, damit ein alter Versuch nicht später zusätzlich bezahlt wird. Die
   gehostete Sitzung ist laut SumUp 30 Minuten verfügbar; der Checkout selbst hat ohne
   `valid_until` keinen Ablauf.
8. **Apple Pay / Google Pay** laufen über die gehostete Seite. Welche Zahlarten tatsächlich
   aktiv sind, prüft die API mit `GET /v0.1/merchants/{merchant_code}/payment-methods`; für
   andere Rechtsformen als Einzelunternehmen verlangt SumUp eine Aktivierung über den Support.
9. **Mobile Rückkehr:** Die App öffnet die Zahlungsseite in `SFSafariViewController` (iOS)
   bzw. einem Chrome Custom Tab (Android) über `expo-web-browser` (`openBrowserAsync`), nicht in
   einer eingebetteten WebView. `redirect_url` (https) zeigt nur einen Rückkehr-Knopf auf der
   Erfolgsseite. Der angezeigte Status kommt **immer vom Server** (Abfrage nach Rückkehr,
   Echtzeitereignis, Push). Windows: Zahlungsseite im Standardbrowser.

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| SumUp-Zahlungslinks aus dem Dashboard | Keine API, keine automatische Zuordnung zur Rechnung; nur manueller Notbehelf. |
| SumUp React-Native-SDK (`sumup-react-native-alpha`) | Alpha, zuletzt 2024 veröffentlicht, nur Englisch/Schwedisch, legt einen geheimen Schlüssel in die App. |
| Payment Widget (eingebettet) | Mehr Einrichtungsaufwand (Domainprüfung, CSP, Google-Registrierung) für dasselbe Ergebnis; in nativen Apps nur per WebView, dort sind Apple Pay und Google Pay eingeschränkt. |
| Zahlung per In-App-Kauf (Apple/Google) | Für außerhalb der App erbrachte Dienstleistungen nicht vorgesehen: Apple 3.1.3(e) verlangt andere Zahlwege; Google Play verbietet sein Abrechnungssystem für physische Dienstleistungen. |
| Status aus Webhook-Inhalt oder Erfolgsseite übernehmen | Webhook ist unsigniert; Erfolgsseite ist kein Nachweis (R-ZAHL-4). |

## Folgen und Grenzen (ehrlich benannt)

- **Webhook unsigniert:** Jeder kann den Endpunkt aufrufen, er löst aber nur eine Abfrage aus.
  Rate-Limit und Protokollierung ohne Personendaten.
- **Sandbox:** SumUp bietet Sandbox-Händler und Testkarten; ob der gehostete Checkout
  (inkl. Rückkehr-Knopf, Webhooks, Wallets) in der Sandbox vollständig funktioniert, ist
  **nicht dokumentiert**. Google Pay ist lokal laut SumUp nicht testbar.
- **Aus dem Cloud-Container nicht erreichbar:** `checkout.sumup.com` antwortete am 26.09.2026
  mit HTTP 403 (`x-vercel-mitigated: deny`). Tests der Zahlungsseite brauchen einen echten
  Browser bzw. ein Gerät auf einer Staging-Umgebung.
- Nicht verifiziert: deutsche Sprache der Zahlungsseite, ob der Rückkehr-Knopf die App über
  einen Universal Link wieder öffnet, eigenes URL-Schema als `redirect_url`.
- `@sumup/sdk` ist vor 1.0 (0.2.0); Aufrufe liegen hinter einem eigenen Adapter mit
  Test-Implementierung.
- Solange kein SumUp-Konto und Testzugang vorliegen (O-2), ist Online-Zahlung ausgeschaltet
  (`payment_provider = none`) und nur die Überweisung sichtbar.
- Tests T-06, T-07 (`docs/tests.md`); unabhängiges Review C-02.

## Quellen (abgerufen 26.09.2026)

- Hosted Checkout: https://developer.sumup.com/online-payments/checkouts/hosted-checkout/
- Webhooks: https://developer.sumup.com/online-payments/webhooks/
- OpenAPI (Checkout-Status, `valid_until`, `DELETE`, `payment-methods`, `409 DUPLICATED_CHECKOUT`): https://github.com/sumup/sumup-ts/blob/main/openapi.json
- API-Schlüssel: https://developer.sumup.com/tools/authorization/api-keys/
- Zahlarten und APM-Aktivierung: https://developer.sumup.com/online-payments/payment-methods/, https://developer.sumup.com/online-payments/apm/
- Testen: https://developer.sumup.com/online-payments/testing/
- React-Native-SDK: https://developer.sumup.com/online-payments/sdks/react-native/
- Zahlungslinks: https://www.sumup.com/de-de/zahlungslinks/
- Apple Pay in SFSafariViewController: https://developer.apple.com/documentation/applepayontheweb
- expo-web-browser: https://docs.expo.dev/versions/latest/sdk/webbrowser/
- App Review Guidelines 3.1.3(e): https://developer.apple.com/app-store/review/guidelines/
- Google Play Zahlungsrichtlinie: https://support.google.com/googleplay/android-developer/answer/9858738
