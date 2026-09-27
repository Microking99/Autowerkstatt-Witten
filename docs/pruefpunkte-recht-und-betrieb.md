# Prüfpunkte Recht und Betrieb

Bezug: R-ARCH-11, R-ARCH-6, R-ARCH-12.

> **Keine Rechtsberatung, keine Konformitätsbehauptung.** Diese Liste nennt Punkte, die vor dem
> Echtbetrieb zu prüfen sind, mit der offiziellen Quelle und ihrem Stand. Sie sagt **nicht**,
> dass die Software eine Vorschrift erfüllt. Alle Punkte haben derzeit den Status **offen**
> bzw. **zu prüfen**. Die Bewertung für die Werkstatt treffen der Inhaber und seine Berater
> (Steuerberatung, Rechtsberatung, ggf. Datenschutzbeauftragte Person).

Statuswerte: `offen` (noch nicht begonnen), `zu prüfen` (Grundlage in der Software angelegt,
Bewertung fehlt), `erledigt (Datum, von wem, Nachweis)`.

Abrufdatum aller Quellen: 26.09.2026, sofern nicht anders angegeben. Die Texte auf
gesetze-im-internet.de sind laut Seite nicht amtlich. EUR-Lex war aus der Arbeitsumgebung
nicht automatisch abrufbar (Antwort ohne Inhalt); die DSGVO-Artikel sind daher nur mit ihrer
Fundstelle angegeben und im amtlichen Text nachzulesen.

## 1. Datenschutz

Quelle für alle Punkte dieses Abschnitts: Verordnung (EU) 2016/679 (DSGVO),
https://eur-lex.europa.eu/eli/reg/2016/679/oj

| ID | Prüfpunkt | Bezug zur Software | Status |
|---|---|---|---|
| PR-D1 | Verzeichnis von Verarbeitungstätigkeiten (Art. 30) | Kategorien: Kundenstammdaten, Fahrzeuge und Halterzeiträume, Aufträge, Annahmen, Fotos, Dokumente, Chat, Freigaben mit IP und Gerät, Rechnungen und Zahlungen, Termine, Mitarbeiterkonten, Zeitbuchungen, Audit-Protokoll, Benachrichtigungen, Push-Tokens. | offen |
| PR-D2 | Verträge zur Auftragsverarbeitung (Art. 28) bzw. Klärung der Rolle | Hosting und Datenbank (O-5), Dateispeicher, E-Mail-Anbieter (O-19), Expo Push Service, Apple (APNs), Google (FCM), SumUp (Rolle als Zahlungsdienstleister klären), ggf. Fehlerüberwachung. Drittlandübermittlung prüfen: Expo ist laut Recherche ein Zwischenschritt mit Sitz in den USA; direkter Versand an APNs/FCM ist möglich (ADR-010). | offen |
| PR-D3 | Informationspflichten (Art. 13) in App und Web | Datenschutzhinweise im Browserzugang, in beiden Apps (Apple verlangt zusätzlich einen Link zur Datenschutzerklärung, Guideline 5.1.1(i)) und in Einladungs-E-Mails. Hinweis bei Fotos, Chat, Freigaben (IP und Gerät werden gespeichert). | offen |
| PR-D4 | Betroffenenrechte (Art. 15 bis 22), inkl. Datenexport (Art. 20) | Auskunft und Export je Kundendatensatz (Stammdaten, Fahrzeuge, Aufträge, Dokumente, Nachrichten, Freigaben, Rechnungen); Berichtigung; Löschung unter Beachtung der Aufbewahrungspflichten (Abschnitt 2). Funktion für Export ist noch nicht geplant (Ergänzung zu R-ARCH-6). | offen |
| PR-D5 | Technische und organisatorische Maßnahmen (Art. 32) | Serverseitige Rechte, Tokens nur als Hash, argon2id, Rate-Limits, Audit-Protokoll, HTTPS, private Dateiablage, Backups und Wiederherstellungstest (`docs/architektur.md` Abschnitte 3 und 7); Zwei-Faktor für Mitarbeiter offen (O-14). Dokumentation der TOMs fehlt. | zu prüfen |
| PR-D6 | Löschkonzept, Speicherbegrenzung (Art. 5 Abs. 1 Buchst. e, Art. 17) | Derzeit wird nichts automatisch gelöscht (O-16). Fristen je Datenart festlegen und gegen Aufbewahrungspflichten abwägen; Backups einbeziehen. | offen |
| PR-D7 | Meldung von Datenschutzverletzungen (Art. 33, 34) | Ablauf im Störungsfall festlegen (wer bemerkt, wer bewertet, wer meldet). Audit-Protokoll und Logs ohne Personendaten helfen bei der Aufklärung. | offen |
| PR-D8 | Fotos mit Personen oder fremden Kennzeichen | Hinweis für Mitarbeiter, Fotos auf das Fahrzeug zu beschränken; Standard-Sichtbarkeit `internal`. | offen |
| PR-D9 | Mitarbeiterdaten und Leistungskontrolle | Zeitbuchungen je Position (`time_entries`) können Verhalten oder Leistung erkennbar machen. Falls ein Betriebsrat besteht: Mitbestimmung bei technischen Einrichtungen zur Überwachung von Verhalten oder Leistung, § 87 Abs. 1 Nr. 6 BetrVG (https://www.gesetze-im-internet.de/betrvg/__87.html). | offen |
| PR-D10 | KI-Werkzeuge in der Entwicklung | Keine echten Kundendaten in Repository, Tests, Prompts oder Sitzungen (AGENTS.md Abschnitt 5). Die OpenAI-Preisseite weist "No training on API or business data by default" für Plus und Pro als nicht enthalten aus (https://learn.chatgpt.com/docs/pricing); Datensteuerung im Konto prüfen. | zu prüfen |

## 2. Aufbewahrung und Buchführung

| ID | Prüfpunkt | Offizielle Quelle, Stand | Bezug zur Software | Status |
|---|---|---|---|---|
| PR-A1 | Aufbewahrungsfristen nach § 147 AO. Abs. 3 der abgerufenen Fassung: Unterlagen nach Abs. 1 Nr. 1 und 4a **zehn Jahre**, Buchungsbelege (Nr. 4) **acht Jahre**, sonstige Unterlagen nach Abs. 1 (u. a. empfangene und Wiedergaben abgesandter Handels- oder Geschäftsbriefe) **sechs Jahre**; Beginn mit Schluss des Kalenderjahres (Abs. 4); kein Ablauf, solange die Festsetzungsfrist offen ist. Anwendungsregel laut Fußnote Art. 97 §§ 19a, 19b, 37 EGAO, nicht geprüft. | https://www.gesetze-im-internet.de/ao_1977/__147.html (abgerufen 26.09.2026) | Welche Datensätze sind Buchungsbelege (Rechnungen, Zahlungen, Erstattungen), welche Geschäftsbriefe (Angebote, Freigabeanfragen, E-Mails)? Zuordnung mit Steuerberater. | zu prüfen |
| PR-A2 | Aufbewahrung nach § 257 HGB, Abs. 4 der abgerufenen Fassung: Nr. 1 **zehn Jahre**, Buchungsbelege (Nr. 4) **acht Jahre**, sonstige **sechs Jahre**. Gilt für Kaufleute (hängt von Rechtsform bzw. Eintragung ab, O-11). Anwendungsregel laut Fußnote Art. 95 HGBEG, nicht geprüft. | https://www.gesetze-im-internet.de/hgb/__257.html (abgerufen 26.09.2026) | wie PR-A1 | zu prüfen |
| PR-A3 | Aufbewahrung von Rechnungen nach § 14b Abs. 1 UStG: Doppel ausgestellter und alle erhaltenen Rechnungen **acht Jahre**; bei E-Rechnungen mindestens der strukturierte Teil unversehrt (BMF-FAQ). | https://www.gesetze-im-internet.de/ustg_1980/__14b.html (abgerufen 26.09.2026); BMF-FAQ E-Rechnung, Stand März 2026: https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.htm | Rechnungs-PDFs unveränderbar aufbewahren (Versionierung, ggf. Object Lock im Speicher, ADR-009). | zu prüfen |
| PR-A4 | Änderung durch das Bürokratieentlastungsgesetz IV. Offiziell bestätigt: Laut Bundestag hat er den Entwurf (Drucksache 20/11306) am 26.09.2024 in geänderter Fassung angenommen; der Gesetzentwurf sah die "Reduzierung der Aufbewahrungsfristen für Buchungsbelege im Handels- und Steuerrecht von zehn auf acht Jahre" vor. Das BMF schreibt am 06.08.2025: "Für die restlichen Steuerpflichtigen gilt für Buchungsbelege weiter die achtjährige Aufbewahrungsfrist" (längere Frist nur für Banken, Versicherungen, Wertpapierinstitute). Die abgerufenen Gesetzestexte (PR-A1, PR-A2) nennen acht Jahre. Übergangsregeln nicht geprüft. | https://www.bundestag.de/dokumente/textarchiv/2024/kw39-de-buerokratieentlastungsgesetz-1017656; https://www.bundesfinanzministerium.de/Content/DE/Pressemitteilungen/Finanzpolitik/2025/08/2025-08-06-aufbewahrungsfristen-buchungsbelege.html | Fristen im Löschkonzept (O-16) nach Rücksprache mit dem Steuerberater festlegen; Übergang für ältere Belege klären. | zu prüfen |
| PR-A5 | GoBD (Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form sowie zum Datenzugriff): BMF-Schreiben vom 28.11.2019, zuletzt geändert durch BMF-Schreiben vom 14.07.2025 (laut BMF-FAQ E-Rechnung). | https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2025-07-14-GoBD-2-aenderung.html | Unveränderbarkeit (Rechnungen, Zahlungen, Audit-Protokoll nur anfügbar), Nachvollziehbarkeit (Revisionen statt Überschreiben), Verfahrensdokumentation, Datenzugriff bei Außenprüfung (§ 147 Abs. 6 AO: maschinell auswertbarer Export). Inhalte des Schreibens nicht im Einzelnen geprüft. | offen |
| PR-A6 | Pflichtangaben in Rechnungen (§ 14 Abs. 4 UStG), nur falls die Software Rechnungen selbst erstellt (E-1) | https://www.gesetze-im-internet.de/ustg_1980/__14.html (abgerufen 26.09.2026) | Beim Standard "Hochladen" liegt die Verantwortung beim erstellenden Programm; die Software speichert Rechnungsnummer und Betrag. | offen |
| PR-A7 | E-Rechnung: Empfang seit 2025, Ausstellung im Inland B2B ab 2027 bzw. 2028 bei Vorjahresumsatz bis 800.000 Euro, B2C nicht betroffen, Formate XRechnung und ZUGFeRD ab 2.0.1 (ohne MINIMUM und BASIC-WL) | BMF-FAQ, Stand März 2026 (Link oben) | Entscheidung E-2 (`docs/offene-entscheidungen.md`) | offen |

## 3. Zahlungen

| ID | Prüfpunkt | Quelle, Stand | Bezug zur Software | Status |
|---|---|---|---|---|
| PR-Z1 | Starke Kundenauthentifizierung (PSD2/SCA) | Richtlinie (EU) 2015/2366, https://eur-lex.europa.eu/eli/dir/2015/2366/oj (nicht abgerufen); SumUp zu 3DS: bei Hosted Checkout "SumUp presents the payment and authentication flow on the hosted page. Your backend verifies the final checkout status." (https://developer.sumup.com/llms-full.txt, abgerufen 26.09.2026) | Keine eigene Umsetzung; Zahlung und 3DS auf der Seite des Anbieters; Status nur nach Serverprüfung. | zu prüfen |
| PR-Z2 | PCI-DSS-Selbstauskunft der Werkstatt | SumUp: "it does not make your business automatically compliant. You are still responsible for validating your PCI DSS compliance" (https://developer.sumup.com/llms-full.txt); PCI SSC FAQ: https://www.pcisecuritystandards.org/faqs/does-pci-dss-apply-to-merchants-who-outsource-all-payment-processing-operations-and-never-store-process-or-transmit-cardholder-data/ | Keine Kartendaten im System (ADR-007). SAQ-Typ mit SumUp bzw. Acquirer klären (nicht verifiziert). | offen |
| PR-Z3 | Vertrag mit SumUp, Konditionen, Datenschutzrolle | https://www.sumup.com/de-de/online-zahlungen/, https://www.sumup.com/de-de/preise/ (abgerufen 26.09.2026) | O-2 | offen |
| PR-Z4 | Store-Regeln für externe Zahlungen | Apple App Review Guidelines 3.1.3(e): https://developer.apple.com/app-store/review/guidelines/ (Stand der Guidelines 08.06.2026); Google Play Payments: https://support.google.com/googleplay/android-developer/answer/9858738 | Zahlung über SumUp für Werkstattleistungen; Einordnung als "physische Dienstleistung" ist eine Bewertung (`docs/zahlungen.md` Abschnitt 8). | zu prüfen |
| PR-Z5 | Manuelle Zahlungszuordnung und Erstattungen | GoBD (PR-A5) | Nur mit Recht, Pflichtfeldern und Audit-Eintrag (`docs/zahlungen.md` Abschnitte 4 und 5). | zu prüfen |

## 4. Barrierefreiheit (BFSG)

| ID | Prüfpunkt | Quelle, Stand | Bezug zur Software | Status |
|---|---|---|---|---|
| PR-B1 | Fällt die Kunden-App bzw. der Browserzugang unter "Dienstleistungen im elektronischen Geschäftsverkehr" (§ 1 Abs. 3 Nr. 5 BFSG; Definition § 2 Nr. 26: digitale Dienste über Webseiten und mobile Anwendungen, die elektronisch und auf individuelle Anfrage eines Verbrauchers im Hinblick auf den Abschluss eines Verbrauchervertrags erbracht werden)? | https://www.gesetze-im-internet.de/bfsg/__1.html, https://www.gesetze-im-internet.de/bfsg/__2.html (abgerufen 26.09.2026) | Terminanfrage, Freigabe von Zusatzarbeiten und Bezahlen könnten als solche Dienste gelten. Bewertung offen. | offen |
| PR-B2 | Ausnahme für Kleinstunternehmen: "Absatz 1 gilt nicht für Kleinstunternehmen, die Dienstleistungen anbieten oder erbringen." (§ 3 Abs. 3 BFSG). Kleinstunternehmen: weniger als zehn Beschäftigte und Jahresumsatz oder Jahresbilanzsumme höchstens 2 Mio. Euro (§ 2 Nr. 17 BFSG). | https://www.gesetze-im-internet.de/bfsg/__3.html (abgerufen 26.09.2026) | Beschäftigtenzahl und Umsatz der Werkstatt klären. Unabhängig davon folgt das Designsystem Barrierefreiheitsregeln (Kontraste mit Test, Bedienflächen, Screenreader-Beschriftungen, Tastatur); das ist **kein** Nachweis der Anforderungen der BFSG-Verordnung. | offen |

## 5. Endgeräte, Tracking, Impressum, Stores

| ID | Prüfpunkt | Quelle, Stand | Bezug zur Software | Status |
|---|---|---|---|---|
| PR-T1 | Speichern und Auslesen auf dem Endgerät nur mit Einwilligung, außer wenn unbedingt erforderlich für den ausdrücklich gewünschten Dienst (§ 25 Abs. 1 und Abs. 2 Nr. 2 TDDDG) | https://www.gesetze-im-internet.de/ttdsg/__25.html (abgerufen 26.09.2026) | Gespeichert werden Sitzungstoken, Offline-Warteschlange, Entwürfe, Push-Token. **Kein Tracking, keine Analyse, keine Werbung** vorgesehen. Ob damit kein Einwilligungsbanner nötig ist, ist zu bewerten; jede spätere Analyse- oder Fehlerüberwachung im Client ändert die Bewertung. | zu prüfen |
| PR-T2 | Anbieterkennzeichnung (Impressum) nach § 5 DDG, leicht erkennbar und unmittelbar erreichbar, in Browserzugang und Apps | https://www.gesetze-im-internet.de/ddg/__5.html (abgerufen 26.09.2026) | Werkstattdaten liegen in `workshop_settings`; Anzeige in Anmeldung, Kontobereich und öffentlichen Seiten (`/q`, `/f`). Angaben hängen von der Rechtsform ab (O-11). | offen |
| PR-T3 | Apple: Datenschutzangaben ("App Privacy Details") in App Store Connect | https://developer.apple.com/app-store/app-privacy-details/ | Aus PR-D1 ableiten (Kontaktdaten, Fotos, Nutzerinhalte, Kennungen, Kaufdaten). | offen |
| PR-T4 | Google Play: Abschnitt "Datensicherheit" (Data safety) | https://support.google.com/googleplay/android-developer/answer/10787469 | wie PR-T3 | offen |
| PR-T5 | Apple-Regeln mit Bezug zur App: Kontolöschung in der App, wenn die App Kontoerstellung unterstützt (5.1.1(v)); Demo-Zugang für die Prüfung (2.1); Push nicht verpflichtend (4.5.4); mehr als eine verpackte Website (4.2) | https://developer.apple.com/app-store/review/guidelines/ (Stand 08.06.2026) | Konten entstehen nur per Einladung; ob 5.1.1(v) dennoch eine Löschfunktion verlangt, ist zu klären. Demo-Zugang mit Beispieldaten auf einer Prüfumgebung. Entsprechende Google-Vorgaben zur Kontolöschung wurden nicht recherchiert. | offen |
| PR-T6 | Händlerangaben für den Vertrieb in der EU in App Store Connect (Digital Services Act) | laut Recherche erforderlich; offizielle Apple-Quelle nicht gesondert geprüft | Angaben hängen von der Rechtsform ab (O-11). | offen |

## 6. Betrieb

| ID | Prüfpunkt | Festlegung bzw. Vorschlag | Status |
|---|---|---|---|
| PR-O1 | Backup und Wiederherstellung | Datenbank und Dateien getrennt sichern, Dateien mit Versionierung; Wiederherstellungstest vor Echtbetrieb und danach regelmäßig, mit Protokoll (`docs/architektur.md` Abschnitt 7). | offen |
| PR-O2 | Notfallzugang | Mindestens zwei aktive Admin-Konten; Zugangsdaten eines Notfallkontos versiegelt beim Inhaber; der letzte aktive Admin kann nicht deaktiviert werden. Zugang zur Hosting-Konsole und zum Domain- und E-Mail-Konto (für Passwort-Resets) absichern und dokumentieren. | offen |
| PR-O3 | Schlüsselverwaltung | Geheimnisse nur in Umgebungsvariablen bzw. Geheimnisspeichern: SumUp-API-Schlüssel, SMTP-Zugang, APNs-Schlüssel, FCM-Dienstkonto, Expo-Token (`EXPO_TOKEN` als GitHub-Secret), App-Store-Connect-API-Schlüssel, Windows-Signatur, Tauri-Updater-Schlüssel. Liste, Verantwortliche, Rotation und Widerruf dokumentieren. Signaturdateien (`*.p8`, `*.p12`, `*.jks`, `*.keystore`) sind in `.gitignore` ausgeschlossen. | offen |
| PR-O4 | Protokollaufbewahrung | Anwendungslogs ohne Personendaten, kurze Aufbewahrung (Vorschlag: 30 Tage); Audit-Protokoll so lange wie die zugehörigen Aufbewahrungspflichten (Abschnitt 2); Anbieterereignisse (`provider_events.payload`) auf nötige Felder beschränken. | offen |
| PR-O5 | Aktualisierungen und Sicherheitsupdates | Regelmäßige Aktualisierung von Node.js, Abhängigkeiten, Expo SDK (SDK 58 in Beta), Tauri (Version 3 in Alpha), PostgreSQL; Store-Anforderungen (z. B. Android-Ziel-API, Xcode-Version) beobachten. | offen |
| PR-O6 | Hochgeladene Dateien | Größenlimit und erlaubte Typen (ADR-009); Virenprüfung nicht entschieden. | offen |
| PR-O7 | Freigaben durch den Inhaber | Keine echten Zahlungen, Kundennachrichten, öffentlichen Deployments, Store-Veröffentlichungen oder kostenpflichtigen Buchungen ohne ausdrückliche Freigabe (R-ARCH-12). Freigaben schriftlich festhalten (z. B. im Pull Request). | zu prüfen |
