# Zahlungskonzept (SumUp)

Stand: 26.09.2026. Bezug: R-ZAHL-1 bis R-ZAHL-12, ADR-007. Quellenliste am Ende; Aussagen
ohne Quelle sind eigene Festlegungen dieses Projekts.

> **Stand der Prüfung:** Es gibt noch **keinen SumUp-Zugang** (weder Sandbox noch Live). Nichts
> in diesem Dokument ist gegen die echte SumUp-API getestet. Die Zahlungsseite
> `checkout.sumup.com` war aus der Cloud-Umgebung nicht erreichbar (HTTP 403,
> `x-vercel-mitigated: deny`, beobachtet am 26.09.2026). Solange kein Konto eingerichtet ist
> (O-2), ist Online-Zahlung abgeschaltet (`workshop_settings.payment_provider = none`) und nur
> die Überweisung sichtbar.

## 1. Grundsätze

1. Die Werkstatt nutzt ihren **eigenen SumUp-Händlerzugang**; die Software sammelt kein Geld
   ein (R-ZAHL-11).
2. **Keine Kartendaten** im eigenen System. Karte, Apple Pay, Google Pay und 3DS laufen auf
   der gehosteten Seite von SumUp (R-ZAHL-10).
3. **"Jetzt bezahlen" und die Erfolgsseite ändern nichts.** Bezahlt ist eine Rechnung erst,
   wenn der Server den Status beim Anbieter abgefragt und geprüft hat (R-ZAHL-4, R-ZAHL-5).
4. **Idempotent auf allen Ebenen:** doppelte Webhooks, wiederholte Abfragen, wiederholte
   Klicks und Wiederholungen nach Verbindungsabbruch erzeugen keine Doppelbuchung (R-ZAHL-7).
5. Arbeitsstatus, Freigabestatus und Zahlungsstatus bleiben getrennt; fachlicher Abschluss und
   Zahlung sind unabhängig (R-AUF-5, R-SERV-7).

## 2. Ablauf

Sequenzdiagramm: `docs/architektur.md` Abschnitt 4.2. Kundensicht mit Fehlerfällen:
`docs/ablaeufe.md` Klickweg C. Zustände: `docs/ablaeufe.md` Abschnitt 8.1 und 8.2.

### 2.1 Zahlungsversuch anlegen (`POST /api/v1/invoices/:id/checkout`)

1. Rechte prüfen: angemeldet ist das Kundenkonto des Rechnungskunden, Rechnung gestellt,
   offener Betrag größer 0, Online-Zahlung konfiguriert.
2. `Idempotency-Key` des Clients auswerten: gleicher Schlüssel liefert denselben Versuch.
3. Ältere offene Versuche der Rechnung beim Anbieter **deaktivieren**
   (`DELETE /v0.1/checkouts/{id}`); ist ein alter Versuch inzwischen bezahlt, wird erst
   gebucht und kein neuer angelegt.
4. Lokalen Versuch speichern (`checkouts`, Status `created`) mit eigener, eindeutiger
   Referenz (`checkout_reference`, z. B. Rechnungs-ID plus laufende Nummer des Versuchs).
5. `POST /v0.1/checkouts` beim Anbieter mit:
   - `amount` = offener Betrag, `currency` = `EUR`, `merchant_code` aus der Konfiguration,
   - `checkout_reference` = eigene Referenz,
   - `hosted_checkout: { enabled: true }`,
   - `return_url` = eigener Webhook-Endpunkt `/api/v1/webhooks/sumup` (optional mit zufälligem
     Kennzeichen je Versuch als zusätzliche Hürde, keine Sicherheitsgrundlage),
   - `redirect_url` = `https://<app-domain>/zahlung/rueckkehr?rechnung=<id>` (https; laut
     OpenAPI für alternative Zahlarten wie Apple Pay und Google Pay erforderlich und für 3DS
     empfohlen),
   - `valid_until` = kurze Frist (Vorschlag: 60 Minuten), damit ein vergessener Versuch
     später nicht mehr bezahlt werden kann.
6. Antwort speichern (`provider_checkout_id`, `hosted_url`, Status `pending`) und nur
   `hostedUrl` an den Client geben. Der Rechnungsstatus bleibt unverändert
   (`StartCheckoutResponse.invoicePaymentStatus`).

Doppelte Referenzen lehnt SumUp mit `409 DUPLICATED_CHECKOUT` ab; nach einer Zeitüberschreitung
wird der Versuch über `GET /v0.1/checkouts?checkout_reference=...` wiedergefunden statt neu
angelegt.

### 2.2 Zahlungsseite öffnen

| Client | Öffnen | Rückkehr |
|---|---|---|
| iPhone | `expo-web-browser` `openBrowserAsync` → `SFSafariViewController` (unterstützt laut Apple Apple Pay) | Browser schließen oder Rückkehr-Knopf; App fragt beim Wiedererscheinen den Serverstatus ab |
| Android | `openBrowserAsync` → Chrome Custom Tab | wie iPhone |
| Browser | gleiche Registerkarte bzw. neue Registerkarte | `/zahlung/rueckkehr?rechnung=<id>` |
| Windows | Standardbrowser des Systems (die Tauri-Hülle öffnet externe Links dort) | Nutzer kehrt in die Anwendung zurück; Status über Echtzeit oder "Status prüfen" |

Nicht verwendet: eingebettete WebViews (in `WKWebView` ist Apple Pay bei Skripteinschleusung
deaktiviert; Google Pay in Android-WebView braucht zusätzliche Freigaben) und
`openAuthSessionAsync` (Apple Pay dort nicht dokumentiert).

Die gehostete Sitzung ist laut SumUp **30 Minuten** verfügbar. Die Seite leitet nicht
automatisch zurück; `redirect_url` erzeugt nur einen Knopf auf der Erfolgsseite.

### 2.3 Webhook (`POST /api/v1/webhooks/sumup`)

- SumUp meldet für Online-Checkouts nur das Ereignis `CHECKOUT_STATUS_CHANGED` mit dem Inhalt
  `{"event_type": "...", "id": "..."}`. Die Doku nennt **keine Signatur** und schreibt: "After
  receiving a webhook call, your application must always verify if the event really took
  place, by calling a relevant SumUp's API."
- Signierte Ereignisse (`X-SumUp-Webhook-Signature`) gibt es im TypeScript-SDK nur für
  Lesegeräte- und Mitgliederereignisse, nicht für Checkouts. Die abweichende Angabe in den
  SumUp-Agent-Skills (`x-payload-signature`) ist nicht durch die offizielle Doku gedeckt und
  wird nicht verwendet.
- Ablauf: Ereignis in `provider_events` ablegen (Zähler bei Wiederholung), schnell mit leerer
  `2xx`-Antwort bestätigen, danach `GET /v0.1/checkouts/{id}` und Prüfung (2.4). Unbekannte
  Ereignisarten werden protokolliert und ignoriert (SumUp kündigt neue Ereignisse ohne
  Vorankündigung an).
- SumUp wiederholt fehlgeschlagene Zustellungen nach 1 Minute, 5 Minuten, 20 Minuten und
  2 Stunden.
- Schutz: Rate-Limit; der Inhalt wird nie als Wahrheit verwendet; Aufrufe von außen können
  höchstens eine Abfrage auslösen.

### 2.4 Prüfung vor der Buchung (in `packages/domain`)

Eine Zahlung (`payments`) entsteht nur, wenn **alle** Bedingungen erfüllt sind:

| Prüfung | Quelle |
|---|---|
| Status `PAID` | Antwort von `GET /v0.1/checkouts/{id}` |
| Betrag gleich dem lokal gespeicherten Betrag des Versuchs | Antwort vs. `checkouts.amount_cents` |
| Währung `EUR` | Antwort vs. `checkouts.currency` |
| Händlercode gleich dem konfigurierten | Antwort vs. `workshop_settings.sumup_merchant_code` |
| Referenz gehört zu genau diesem Versuch und dieser Rechnung | `checkout_reference` |
| Transaktions-ID vorhanden | `transactions[].id` |

Buchung und Rechnungsstatus werden in einer Datenbanktransaktion geschrieben; der eindeutige
Schlüssel `(provider, provider_transaction_id)` verhindert Doppelbuchungen. Weicht ein Wert ab,
wird **nicht** gebucht, sondern ein Abgleichsfall für den Service angelegt (Protokoll ohne
Kartendaten). SumUp empfiehlt für das maßgebliche Ergebnis zusätzlich die
Transaktions-Endpunkte; ob diese Abfrage nötig ist, wird mit dem Testzugang geklärt.

### 2.5 Abgleichsjob

- Läuft regelmäßig (Vorschlag: alle 5 Minuten), fragt alle offenen Versuche ab und
  verarbeitet sie wie einen Webhook. Nach Ablauf von `valid_until` wird ein Versuch noch einmal
  abschließend abgefragt.
- Deaktiviert Versuche, deren Frist abgelaufen ist oder deren Rechnung storniert wurde.
- Meldet Abweichungen (Betrag, Währung, Händler, unbekannte Referenz) an den Service.
- Wird eine Zahlung für einen bereits deaktivierten oder abgelaufenen Versuch bestätigt
  (Überschneidung), wird sie gebucht, weil Geld eingegangen ist, und als **Überzahlung** zur
  Erstattung angezeigt.

## 3. Teilzahlungen

- Online wird immer der **gesamte offene Restbetrag** angeboten.
- Teilzahlungen entstehen durch manuelle Zuordnung (z. B. Anzahlung bar) oder Erstattungen.
  Der Zahlungsstatus wird berechnet (`partially_paid`), nie gesetzt.

## 4. Erstattungen

- Recht `payments.refund` (Standard nur Admin), Bestätigungsdialog, Pflichtbegründung.
- SumUp-Endpunkt: `POST /v1.0/merchants/{merchant_code}/payments/{transaction_id}/refunds`,
  voll oder teilweise (optionales `amount`). Der Endpunkt hat **keinen Idempotenzschlüssel**;
  SumUp lehnt manche Wiederholungen ab (`409` nicht erstattbar, `422` Betrag über dem
  erstattbaren Betrag), wiederholte Teilerstattungen innerhalb des Restbetrags könnten aber
  doppelt durchgehen.
- Daher eigene Idempotenz: zuerst `refunds`-Zeile mit eindeutigem `idempotency_key` und Status
  `requested`, dann Anbieteraufruf, dann Bestätigung durch erneutes Lesen der Transaktion,
  Status `succeeded` oder `failed`, Audit-Eintrag.
- Widerspruch in der SumUp-Doku: Die Erstattungsanleitung zeigt einen älteren Endpunkt und
  verlangt ein OAuth-Token aus dem Autorisierungscode-Verfahren, die OpenAPI erlaubt einen
  API-Schlüssel. **Mit dem Testzugang klären.**
- Erstattungsgebühren: **nicht recherchiert**.

## 5. Überweisung und andere Zahlwege (R-ZAHL-9)

- Die Rechnungsansicht zeigt Überweisungsdaten (Empfänger, IBAN, BIC, Verwendungszweck mit
  Rechnungsnummer) aus den Werkstattdaten.
- **Manuelle Zuordnung** (`POST /invoices/:id/payments/manual`) nur mit Recht
  `payments.recordManual`: Zahlweg (Überweisung, bar, Kartenterminal vor Ort), Betrag,
  Eingangsdatum, Referenztext Pflicht; Bestätigungsdialog; Audit-Eintrag mit Person und
  Zeitpunkt. Grundlage ist ein geprüfter Eingang (Kontoauszug), nicht die Aussage des Kunden.
- **Bankanbindung später** (offene Entscheidung O-15), Optionen:

  | Option | Kurzbeschreibung | Stand |
  |---|---|---|
  | CAMT.053-Import | Kontoauszug-Datei der Bank hochladen, Vorschläge für die Zuordnung, Bestätigung durch Mitarbeiter | nicht recherchiert |
  | FinTS/HBCI bzw. EBICS | direkte Abfrage bei der Hausbank | nicht recherchiert |
  | PSD2-Kontoinformationsdienst | Zugriff über einen lizenzierten Anbieter | nicht recherchiert; laut SumUp-Doku bietet ein SumUp-Geschäftskonto PSD2-Kontoinformationen über Token.io an |

  Auch mit Bankanbindung bleibt die Zuordnung ein geprüfter, protokollierter Schritt.

## 6. Gebühren (laut Anbieterseiten, Stand 26.09.2026)

| Punkt | Angabe | Quelle |
|---|---|---|
| Online-Zahlungen | "Für unsere Online-Zahlungsoptionen fallen für Sie 2,50 % pro Zahlung an. Es gibt keine Einrichtungsgebühren oder monatlichen Kosten." | [Q9] |
| API-/SDK-Integration | "Wenn Sie unsere SDK- oder API-Integrationen nutzen, können Sie die Preisgestaltung direkt mit unserem Vertriebsteam besprechen." | [Q9] |
| Fehlgeschlagene Zahlungen | werden laut Preisseite nicht berechnet | [Q10] |
| Zahlungslinks (Dashboard) | 2,50 % pro Zahlung, 0 € monatlich | [Q11] |
| Erstattungen, Rückbuchungen | **nicht recherchiert** | |

Verbindlich sind nur die Konditionen im Vertrag der Werkstatt (O-2). Auszahlungen kommen laut
Recherche abzüglich Gebühren; für die Buchhaltung liefern die Auszahlungs- und
Transaktions-Endpunkte die Einzelheiten (mit Testzugang prüfen).

## 7. Apple Pay und Google Pay (R-ZAHL-3)

- Die gehostete Seite zeigt laut SumUp-Doku Karte, Apple Pay und Google Pay. Eine eigene
  Domainprüfung ist nur für direkte Integrationen und das Widget dokumentiert.
- **Aktivierung:** Für Einzelunternehmen werden alternative Zahlarten laut SumUp nach der
  Registrierung und einer Testtransaktion automatisch aktiviert; für alle anderen
  Rechtsformen muss die Aktivierung beim Support bzw. über das Kontaktformular mit der
  Händler-ID beantragt werden (Bezug zu O-11).
- **Verfügbarkeit prüfen:** `GET /v0.1/merchants/{merchant_code}/payment-methods` liefert die
  für den Händler aktiven Zahlarten; SumUp: "Treat the payment methods returned for a checkout
  as the source of truth for that checkout." Die Oberfläche verspricht Apple Pay oder Google
  Pay nur, wenn sie dort aktiv sind.
- Google Pay ist laut SumUp lokal nicht testbar, nur auf einer Staging-Umgebung mit geprüfter
  Domain.

## 8. Store-Regeln

| Store | Regel | Folge |
|---|---|---|
| Apple App Store | Guideline 3.1.3(e): "If your app enables people to purchase physical goods or services that will be consumed outside of the app, you must use purchase methods other than in-app purchase to collect those payments, such as Apple Pay or traditional credit card entry." | Werkstattleistungen werden außerhalb der App erbracht; Zahlung über SumUp statt In-App-Kauf. |
| Google Play | Payments-Richtlinie: Das Play-Abrechnungssystem darf für physische Dienstleistungen (Beispiele dort: Transport, Reinigung, Flüge, Fitness, Essenslieferung, Tickets) **nicht** verwendet werden. | Externer Zahlungsanbieter ist vorgeschrieben. Autoreparatur ist nicht ausdrücklich genannt; Einordnung als physische Dienstleistung ist eine Bewertung. |

## 9. PCI DSS

SumUp schreibt zum eingebetteten Widget: Die Kartendaten gehen direkt an SumUp, "This reduces
the PCI DSS scope of your integration, but it does not make your business automatically
compliant. You are still responsible for validating your PCI DSS compliance". Für die
gehostete Seite gilt sinngemäß dasselbe: **Die jährliche Selbstauskunft (SAQ) bleibt Pflicht
der Werkstatt.** Welcher SAQ-Typ passt, ist **nicht verifiziert** und mit SumUp bzw. dem
Acquirer zu klären (Prüfpunkt in `docs/pruefpunkte-recht-und-betrieb.md`).

## 10. Zahlungslinks von SumUp

SumUp-Zahlungslinks werden im Dashboard bzw. in der SumUp-App erstellt; die aktuelle
öffentliche API (OpenAPI) enthält keinen Endpunkt dafür (SumUp sagt das nicht ausdrücklich, es
folgt aus dem Fehlen in der API-Referenz). Deshalb:

- E-Mails und PDFs verlinken auf die **eigene Rechnungsansicht**; dort erzeugt
  "Jetzt bezahlen" einen frischen Checkout. Das ist eine eigene Entscheidung: SumUp selbst
  erlaubt, die URL des gehosteten Checkouts zu speichern und später per E-Mail zu versenden.
- Manuell erstellte SumUp-Zahlungslinks (z. B. für einen Telefonkunden ohne Konto) sind ein
  Notbehelf und werden wie eine Überweisung manuell zugeordnet.

## 11. Grenzen (ehrlich benannt, R-ZAHL-12)

| Grenze | Folge |
|---|---|
| Webhook unsigniert | Nur Auslöser; jede Entscheidung über API-Abfrage. |
| Sandbox-Unterstützung für Hosted Checkout (Rückkehr-Knopf, Webhooks, Wallets) nicht dokumentiert | Ende-zu-Ende-Test erst mit Testzugang und ggf. Rückfrage bei SumUp. |
| `checkout.sumup.com` aus dem Cloud-Container nicht erreichbar | Tests der Zahlungsseite nur mit echtem Browser bzw. Gerät gegen eine Staging-Umgebung. |
| Deutsche Sprache der Zahlungsseite nicht verifiziert; kein Sprachparameter in der API | Mit Testzugang prüfen. |
| Rückkehr in die App per Universal Link bzw. App Link aus `SFSafariViewController`/Custom Tab nicht verifiziert; eigenes URL-Schema als `redirect_url` nicht verifiziert | Status kommt ohnehin vom Server; Rückkehr notfalls durch Schließen des Browsers. |
| `@sumup/sdk` vor Version 1.0 | Aufrufe hinter eigenem Adapter; Test-Implementierung für Tests. |
| URLs mit abschließendem Schrägstrich funktionieren seit 17.01.2026 nicht mehr | Im Adapter und in Testattrappen beachten. |

## 12. Mit Testzugang zu prüfen

1. Sandbox-Händler anlegen (durch den Inhaber) und API-Schlüssel als Umgebungsgeheimnis
   hinterlegen, nie im Chat oder Repository.
2. Checkout anlegen mit `hosted_checkout`, `redirect_url`, `return_url`, `valid_until`.
3. Erfolgreiche Zahlung (Testkarte laut SumUp-Doku), abgelehnte Zahlung (Beträge, die laut
   Doku absichtlich fehlschlagen), 3DS-Abfrage, Ablauf der Sitzung.
4. Webhook-Zustellung an eine öffentliche Staging-Adresse, Wiederholungen, doppelte
   Zustellung.
5. Deaktivieren eines offenen Checkouts; Verhalten der Seite danach.
6. `payment-methods` für das Händlerkonto; Anzeige von Apple Pay und Google Pay.
7. Erstattung voll und teilweise mit API-Schlüssel; Antworten `409` und `422`.
8. Sprache der Zahlungsseite, Rückkehr in die App auf iPhone und Android.
9. Transaktions- und Auszahlungsdaten für die Buchhaltung.

## Quellen (abgerufen 26.09.2026)

- [Q1] Hosted Checkout: https://developer.sumup.com/online-payments/checkouts/hosted-checkout/
- [Q2] Webhooks: https://developer.sumup.com/online-payments/webhooks/
- [Q3] OpenAPI der SumUp-API (Checkouts, `valid_until`, `redirect_url`, `DELETE`, `payment-methods`, Erstattungen, `409 DUPLICATED_CHECKOUT`): https://github.com/sumup/sumup-ts/blob/main/openapi.json
- [Q4] TypeScript-SDK, signierte Ereignisse: https://github.com/sumup/sumup-ts/blob/main/sdk/src/events-handler.ts
- [Q5] Erstattungen: https://developer.sumup.com/online-payments/guides/refund/
- [Q6] Testen, Testkarten: https://developer.sumup.com/online-payments/testing/
- [Q7] Zahlarten und Aktivierung: https://developer.sumup.com/online-payments/payment-methods/, https://developer.sumup.com/online-payments/apm/, Google Pay: https://developer.sumup.com/online-payments/apm/google-pay/
- [Q8] API-Schlüssel: https://developer.sumup.com/tools/authorization/api-keys/
- [Q9] Online-Zahlungen, Gebühren: https://www.sumup.com/de-de/online-zahlungen/
- [Q10] Preise: https://www.sumup.com/de-de/preise/
- [Q11] Zahlungslinks: https://www.sumup.com/de-de/zahlungslinks/
- [Q12] Abschaffung abschließender Schrägstriche: https://developer.sumup.com/changelog/api-trailing-slash-deprecation/
- [Q13] Gesamtdoku für Werkzeuge (PCI-Hinweis, PSD2 Open Banking): https://developer.sumup.com/llms-full.txt
- [Q14] Apple Pay im Web: https://developer.apple.com/documentation/applepayontheweb
- [Q15] App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- [Q16] Google Play Payments-Richtlinie: https://support.google.com/googleplay/android-developer/answer/9858738
- [Q17] expo-web-browser: https://docs.expo.dev/versions/latest/sdk/webbrowser/
- [Q18] PCI SSC FAQ (verlinkt aus der SumUp-Doku): https://www.pcisecuritystandards.org/faqs/does-pci-dss-apply-to-merchants-who-outsource-all-payment-processing-operations-and-never-store-process-or-transmit-cardholder-data/
