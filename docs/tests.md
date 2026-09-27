# Testplan und Testbericht

Stand: 27.09.2026. Bezug: Abschnitt 11 in `docs/anforderungen.md`, AGENTS.md Abschnitt 7.

> **Ein Browser-Test ist kein Nachweis für iOS, Android oder Windows.** Browser-Tests prüfen den
> Web-Export in Chromium, entweder im Demo-Modus oder gegen die echte API mit Testdatenbank. Ob
> eine Funktion auf einem iPhone, einem Android-Gerät oder in der Windows-Anwendung
> funktioniert, belegt nur ein Test auf dem jeweiligen Build und Gerät. Solche Tests sind
> **blockiert**: Es gibt keinen Build, keine Testgeräte und keine Konten (Apple, Google, Expo,
> Windows-Signatur).

## 1. Testebenen

| Ebene | Werkzeug | Ort | Befehl | Prüft |
|---|---|---|---|---|
| Domain-Unit | Vitest | `packages/domain/src/**/*.test.ts` | `pnpm --filter @werkstatt/domain test` | Reine Regeln: Rechte, Statusübergänge, Hash, Zahlungsprüfung, Servicehistorie, Fälligkeiten, Termine |
| Vertrag | Vitest | `packages/contracts/src/*.test.ts` | `pnpm --filter @werkstatt/contracts test` | Routen, Deep Links, `safeNextPath`, öffentliche Endpunkte, Schemas, Fehlercodes |
| Design-Tokens | Vitest | `packages/design-tokens/src/index.test.ts` | `pnpm --filter @werkstatt/design-tokens test` | Farbkontraste hell und dunkel |
| API-Integration | Vitest gegen PostgreSQL 16; SumUp, E-Mail und Push über Test-Adapter | `apps/api/test/*.test.ts` | `pnpm --filter @werkstatt/api db:start`, danach `pnpm test` | Rechte in allen Routen, Transaktionen, Idempotenz, Webhooks, Outbox, Servicehistorie |
| App-Unit | Vitest | `apps/app/src/**/*.test.ts` | `pnpm --filter @werkstatt/app test` | HttpApi, Offline-Warteschlange, Regeln des Demo-Modus |
| App-E2E Demo | Playwright (Chromium) gegen den Web-Export im Demo-Modus, Telefon 390x844 und PC 1440x900 | `apps/app/e2e/*.spec.ts` | `pnpm --filter @werkstatt/app export:demo`, dann `pnpm --filter @werkstatt/app e2e` | Klickwege A bis G, Werkstatt, Mechaniker, Tastatur, Zugang, alle Zustände |
| App-E2E echte API | Playwright (Chromium) gegen den Web-Export mit `EXPO_PUBLIC_API_URL` und die echte API mit frischer Datenbank `werkstatt_e2e` | `apps/app/e2e-api/*.spec.ts`, Server `apps/api/scripts/e2e-server.ts` | `pnpm --filter @werkstatt/app export:api-e2e`, dann `pnpm --filter @werkstatt/app e2e:api` | Jede Ansicht je Rolle ohne Vertragsabweichung; Freigabe, Zahlung, Abschluss, QR und Fremdzugriff über Oberfläche und Server |
| Gerätetest iOS/Android | Maestro-Abläufe auf Builds (z. B. über EAS) und manuelle Prüfung | entsteht mit dem ersten Build (Codex-Paket C-04) | noch keiner | Verhalten der nativen Apps |
| Gerätetest Windows | Manuelle Prüfung des NSIS-Installers nach Protokoll | entsteht mit dem ersten Build | noch keiner | Installation, Start, Anmeldung, Zahlung im Standardbrowser |

Testdaten sind ausschließlich Beispieldaten (`[TEST]`, `is_test_data = true`), nie echte
Kundendaten. Das Passwort der Testkonten für die E2E-Tests gegen die API wird je Lauf zufällig
erzeugt und nirgends gespeichert. Der Test-Zahlungsanbieter bucht nichts; seine Bestätigung
läuft wie im Betrieb über Webhook und Statusabfrage.

## 2. Ergebnis des letzten vollständigen Laufs

| Befehl | Ergebnis (27.09.2026, lokal, Linux) |
|---|---|
| `pnpm typecheck` | alle fünf Pakete ohne Fehler |
| `pnpm test` | design-tokens 8, contracts 13, domain 257, app 120, api 153 Tests grün |
| `pnpm --filter @werkstatt/app e2e` (Demo) | 106 bestanden, 2 übersprungen (Tastaturtests nur im Projekt "pc") |
| `pnpm --filter @werkstatt/app e2e:api` (echte API) | 15 bestanden |
| GitHub Actions `CI` | Jobs "Typen und Tests", "App (Web-Export und Browser-Tests)" und "App gegen echte API" |

Nicht ausgeführt: iOS-, Android- und Windows-Builds, Gerätetests, Tests gegen die
SumUp-Sandbox, echter E-Mail- oder Push-Versand.

## 3. Mindest-Testfälle T-01 bis T-13

Status: `grün (Datum)`, `blockiert (Grund)`. Anzahl = Tests in der Datei (bei Sammeldateien
nur die zum Fall gehörenden Gruppen).

### T-01 Kunde mit mehreren Fahrzeugen

Anforderungen: R-KUN-3, R-ROLLE-4, R-FZG-3.

| Ebene | Datei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/permissions/objectRules.test.ts` | Fahrzeugsicht nur mit aktuellem Halterzeitraum | grün (27.09.2026) |
| API-Integration | `apps/api/test/t01-kunde-mehrere-fahrzeuge.test.ts` (2) | Kundin sieht genau ihre zwei Fahrzeuge; Auftrag nur mit einem Fahrzeug des gewählten Kunden | grün (27.09.2026) |
| App-E2E Demo | `apps/app/e2e/d-servicehistorie.spec.ts` | Fahrzeugliste, Wechsel zu Golf, Fälligkeiten und Historie | grün (27.09.2026) |
| App-E2E API | `apps/app/e2e-api/00-rundgang.spec.ts` (Kundin) | Fahrzeugliste und Fahrzeugakte gegen die echte API | grün (27.09.2026) |
| Gerätetest | | wie E2E auf Gerät | blockiert: kein Build, keine Geräte, keine Konten |

### T-02 Keine Einsicht in fremde Akten und Dokumente

Anforderungen: R-ROLLE-4, R-ROLLE-5, R-DOK-2, AGENTS.md Regel 1.

| Ebene | Datei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/permissions/objectRules.test.ts` (43), `redaction.test.ts` (5) | Objektregeln für Auftrag, Dokument, Foto, Rechnung, Nachricht, Freigabe, Termin; Feldfilter | grün (27.09.2026) |
| API-Integration | `apps/api/test/t02-keine-fremden-daten.test.ts` (2), `review-rechte.test.ts` (24, u. a. R01 IDOR über alle Routen mit ID) | Kunde A erhält für Objekte von Kunde B `404`; Listen ohne fremde Einträge; Dateien und interne Dokumente `404` | grün (27.09.2026) |
| App-E2E Demo | `apps/app/e2e/a-angebot.spec.ts`, `c-rechnung.spec.ts` | Fremder Auftrag bzw. fremde Rechnung per URL zeigt "Nicht verfügbar" | grün (27.09.2026) |
| App-E2E API | `apps/app/e2e-api/10-ablaeufe.spec.ts` Schritt 2 | Andere Kundin: Auftrag, Freigabe, Rechnung, Fahrzeug nicht verfügbar, keine Namen oder Beträge sichtbar | grün (27.09.2026) |
| Gerätetest | | Deep Link auf fremden Vorgang in der App | blockiert: kein Build, keine Geräte, keine Konten |

### T-03 Unterschiedliche Mitarbeiterrechte

Anforderungen: R-ROLLE-2, R-ROLLE-3, R-ADM-1, R-MECH-3.

| Ebene | Datei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/permissions/catalog.test.ts` (21) | Rollenstandards, gewährte und entzogene Rechte, nicht zuweisbare Rechte | grün (27.09.2026) |
| API-Integration | `apps/api/test/t03-mitarbeiterrechte.test.ts` (6), `review-rechte.test.ts`, `kundenzugang.test.ts` (1), `mechaniker-schnittstellen.test.ts` (11) | Mechaniker nur zugewiesene Aufträge, keine Preise, keine Rechnungen; Service ohne `payments.refund` 403; nicht zuweisbare Rechte und Inhaber-Schutz; Deaktivierung beendet Sitzungen; gesperrter Kundenzugang nur mit Recht wieder frei | grün (27.09.2026) |
| App-E2E Demo | `apps/app/e2e/zugang.spec.ts`, `w-werkstatt.spec.ts` | Fremder Rollenbereich leitet um; ohne Recht keine manuelle Zahlung und kein Stellen | grün (27.09.2026) |
| App-E2E API | `apps/app/e2e-api/10-ablaeufe.spec.ts` Schritte 4 und 6, `20-werkstatt.spec.ts` Schritte 4 und 5 | Mechaniker sieht keine Preise; ohne Zuweisung kein Zugriff; Service ohne Recht erfasst keine Zahlung; interne Notiz für Kundin unsichtbar | grün (27.09.2026) |
| Gerätetest | | Mechanikeransicht auf Telefon | blockiert: kein Build, keine Geräte, keine Konten |

### T-04 Freigabe und Ablehnung von Zusatzarbeiten

Anforderungen: R-FRG-1 bis R-FRG-5, AGENTS.md Regeln 4 und 5.

| Ebene | Datei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/approvals/approvals.test.ts` (21), `totals.test.ts` (3) | Kanonischer Inhalt und Hash; Entscheidung nur zur aktuellen Version; Ablehnung sperrt nur diese Positionen | grün (27.09.2026) |
| API-Integration | `apps/api/test/t04-freigabe-ablehnung.test.ts` (2), `review-freigaben.test.ts` (12) | Nur Kunden entscheiden; gleichzeitige Entscheidungen; genau eine Entscheidung je Version; Audit mit Hash | grün (27.09.2026) |
| App-E2E Demo | `apps/app/e2e/b-zusatzarbeit.spec.ts` (3), `a-angebot.spec.ts` (5) | Klickwege A und B inkl. Abbruch, Ablehnung, Verbindungsfehler; "Ja" im Chat ist keine Freigabe | grün (27.09.2026) |
| App-E2E API | `apps/app/e2e-api/10-ablaeufe.spec.ts` Schritt 1 | Freigabe mit Prüfsumme, nach Neuladen vom Server bestätigt, Werkstatt sieht "Freigegeben" | grün (27.09.2026) |
| Gerätetest | | Klickweg B aus einer Push-Benachrichtigung | blockiert: kein Build, keine Geräte, keine Konten |

### T-05 Erneute Freigabe nach Änderung

Anforderungen: R-FRG-3, R-FRG-6.

| Ebene | Datei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/approvals/approvals.test.ts` | Änderung erzeugt neue Version mit neuem Hash; alte Entscheidung gilt nicht | grün (27.09.2026) |
| API-Integration | `apps/api/test/t05-erneute-freigabe.test.ts` (2), `review-freigaben.test.ts` | Entscheidung zur alten Version `409`; keine Änderung laufender Arbeiten (`approval_in_execution`) | grün (27.09.2026) |
| App-E2E Demo | `apps/app/e2e/a-angebot.spec.ts` | Angebot ändert sich während der Ansicht: Hinweis und Laden der neuen Fassung | grün (27.09.2026) |
| Gerätetest | | wie E2E | blockiert: kein Build, keine Geräte, keine Konten |

### T-06 Erfolgreiche, abgebrochene und mehrfach gemeldete Zahlungen

Anforderungen: R-ZAHL-5 bis R-ZAHL-8.

| Ebene | Datei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/payments/sumup.test.ts` (14), `status.test.ts` (10), `manual.test.ts` (10) | Abgleich von Status, Betrag, Währung, Händler, Referenz; Zahlungsstatus; manuelle Zahlung | grün (27.09.2026) |
| API-Integration | `apps/api/test/t06-zahlungen.test.ts` (7), `review-zahlungen.test.ts` (17) | Erfolg, Abbruch, Ablauf; Webhook mehrfach und parallel ergibt eine Zahlung; gefälschte Webhooks ohne Wirkung; falscher Betrag oder Händler | grün (27.09.2026) |
| App-E2E Demo | `apps/app/e2e/c-rechnung.spec.ts` (6) | Klickweg C mit simulierter Anbieterseite, Abbruch, doppelte Meldung, Fehlschlag, Verbindungsfehler | grün (27.09.2026) |
| App-E2E API | `apps/app/e2e-api/10-ablaeufe.spec.ts` Schritt 3 | Bezahlt erst nach Anbieterbestätigung; zweiter Webhook bucht nicht doppelt; Werkstatt sieht genau eine Zahlung | grün (27.09.2026) |
| Anbieter-Test | Sandbox-Checkliste `docs/zahlungen.md` | Echter Ablauf gegen die SumUp-Sandbox | blockiert: kein SumUp-Testzugang (O-2) |
| Gerätetest | | Anbieterseite in SFSafariViewController bzw. Custom Tab, Rückkehr | blockiert: kein Build, keine Geräte, kein SumUp-Testzugang |

### T-07 Rechnung bleibt nach Klick auf "Bezahlen" offen

Anforderungen: R-ZAHL-4, AGENTS.md Regel 7.

| Ebene | Datei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/payments/checkout.test.ts` (6) | Checkout ohne bestätigte Zahlung ändert den Status nicht | grün (27.09.2026) |
| API-Integration | `apps/api/test/t07-rechnung-bleibt-offen.test.ts` (1) | "Jetzt bezahlen" und Rückkehrseite lassen die Rechnung offen | grün (27.09.2026) |
| App-E2E Demo | `apps/app/e2e/c-rechnung.spec.ts` | Nach Rückkehr ohne Bestätigung "Offen" | grün (27.09.2026) |
| App-E2E API | `apps/app/e2e-api/10-ablaeufe.spec.ts` Schritt 3 | Nach "Jetzt bezahlen" und Rückkehr steht die Rechnung auf "Offen", bis der Anbieter bestätigt | grün (27.09.2026) |
| Gerätetest | | wie E2E | blockiert: kein Build, keine Geräte, keine Konten |

### T-08 Serviceeintrag nur aus abgeschlossener Arbeit und nur einmal

Anforderungen: R-SERV-1, R-SERV-5, R-SERV-6, R-SERV-8.

| Ebene | Datei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/serviceHistory/entries.test.ts` (12), `due.test.ts` (13) | Ableitung nur aus ausgeführter Wartung; Revisionen; Fälligkeiten | grün (27.09.2026) |
| API-Integration | `apps/api/test/t08-servicehistorie.test.ts` (2), `review-servicehistorie.test.ts` (13) | Kein Eintrag ohne fachlichen Abschluss, nie aus Angebot, Freigabe, Rechnung oder Zahlung; zweifacher und paralleler Abschluss ergibt genau einen Eintrag; Korrektur als Revision | grün (27.09.2026) |
| App-Unit | `apps/app/src/data/demo/rules/serviceHistory.test.ts` (11) | Gleiche Regeln im Demo-Modus | grün (27.09.2026) |
| App-E2E Demo | `apps/app/e2e/m-mechaniker.spec.ts`, `b-zusatzarbeit.spec.ts` | Abschlussprüfung nennt die Anzahl; genau zwei Einträge mit km-Stand; abgelehnte Bremsen nicht in der Historie | grün (27.09.2026) |
| App-E2E API | `apps/app/e2e-api/10-ablaeufe.spec.ts` Schritt 4 | Mechaniker schließt mit km ab, Service prüft, genau ein Eintrag mit diesem km-Stand, bei der Kundin sichtbar | grün (27.09.2026) |

### T-09 QR-Zugriff ohne private Unterlagen

Anforderungen: R-QR-1 bis R-QR-4, AGENTS.md Regel 9.

| Ebene | Datei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/shares/shares.test.ts` (7) | Freigabe für Dritte: gültig, abgelaufen, widerrufen, Umfang | grün (27.09.2026) |
| API-Integration | `apps/api/test/t09-qr-und-freigabelink.test.ts` (2), `review-rechte.test.ts` | Ohne Kurzansicht nur Hinweis; keine Namen, Preise, Dokumente | grün (27.09.2026) |
| App-E2E Demo | `apps/app/e2e/e-qr.spec.ts` (5), `d-servicehistorie.spec.ts` | Klickwege D und E ohne Anmeldung, Freigabelink | grün (27.09.2026) |
| App-E2E API | `apps/app/e2e-api/10-ablaeufe.spec.ts` Schritt 5 | QR ohne Anmeldung zeigt keine Kundendaten; fremde Kundin ohne Zugriff | grün (27.09.2026) |
| Gerätetest | | Scan mit der Kamera öffnet App bzw. Browser | blockiert: kein Build, keine Geräte, keine Konten |

### T-10 Besitzerwechsel ohne private Kommunikation

Anforderungen: R-FZG-4, AGENTS.md Regel 3.

| Ebene | Datei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/permissions/objectRules.test.ts`, `vehicles/vehicles.test.ts` (12) | Sichtbarkeit für Vorbesitzer und neuen Halter; Halterzeiträume | grün (27.09.2026) |
| API-Integration | `apps/api/test/t10-besitzerwechsel.test.ts` (1) | Neuer Halter sieht keine Aufträge, Nachrichten, Dokumente, Freigaben, Rechnungen des Vorbesitzers | grün (27.09.2026) |
| App-E2E Demo | `apps/app/e2e/w-werkstatt.spec.ts`, `d-servicehistorie.spec.ts`, `e-qr.spec.ts` | Hinweis zur Datentrennung; Vorbesitzer sieht das Fahrzeug nicht mehr, eigene alte Aufträge schon | grün (27.09.2026) |

### T-11 Benachrichtigungslinks führen zum richtigen Vorgang

Anforderungen: R-BEN-1, R-ARCH-8.

| Ebene | Datei | Prüft | Status |
|---|---|---|---|
| Vertrag | `packages/contracts/src/contracts.test.ts` | Deep-Link-Pfade ohne Inhalte; `safeNextPath` nur interne Ziele | grün (27.09.2026) |
| API-Integration | `apps/api/test/t11-benachrichtigungslinks.test.ts` (2) | Outbox im selben Transaktionsschritt; Zielpfad je Ereignis | grün (27.09.2026) |
| App-E2E Demo | `apps/app/e2e/zugang.spec.ts` | Link ohne Anmeldung führt nach Anmeldung zum Ziel; simulierte Mitteilung; offene Weiterleitung verhindert | grün (27.09.2026) |
| Gerätetest | | Echte Push-Nachricht öffnet den richtigen Vorgang | blockiert: kein Build, keine Geräte, keine Push-Zugänge |

### T-12 Daten nach Neustart erhalten

Anforderungen: R-ARCH-9, R-ARCH-10, R-AUF-3.

| Ebene | Datei | Prüft | Status |
|---|---|---|---|
| API-Integration | `apps/api/test/t12-neustart.test.ts` (1), `infrastruktur.test.ts` (12), `mechaniker-schnittstellen.test.ts` | Daten nach Neustart der API; Wiederholung mit gleichem `Idempotency-Key` erzeugt nichts doppelt; Gerätezeit offline erfasster Arbeit mit Grenzen | grün (27.09.2026) |
| App-Unit | `apps/app/src/offline/queue.test.ts` (19) | Reihenfolge, Idempotenz, Konflikte, neuer Schlüssel je Wiederholung, Gerätezeit der Offline-Warteschlange | grün (27.09.2026) |
| App-E2E Demo | `apps/app/e2e/w-werkstatt.spec.ts`, `m-mechaniker.spec.ts` | Auftragsentwurf übersteht Neuladen; Feststellung offline, danach übertragen | grün (27.09.2026) |
| Gerätetest | | App offline beenden, neu starten, übertragen | blockiert: kein Build, keine Geräte, keine Konten |

### T-13 Kritische Abläufe auf den Plattformen

Anforderungen: R-PLAT-1 bis R-PLAT-4.

| Ebene | Datei | Prüft | Status |
|---|---|---|---|
| App-E2E Web (Demo und echte API) | `apps/app/e2e/**`, `apps/app/e2e-api/**` | Kritische Abläufe im Browser (Chromium) | grün (27.09.2026); **kein Nachweis für die Plattformen** |
| Gerätetest iOS | | Kritische Abläufe auf iPhone | blockiert: kein Build, keine Geräte, kein Apple- und Expo-Konto |
| Gerätetest Android | | Kritische Abläufe auf Android | blockiert: kein Build, keine Geräte, kein Google- und Expo-Konto |
| Gerätetest Windows | | Installation per NSIS, Start, Anmeldung, Werkstattablauf mit Tastatur, Zahlung im Standardbrowser | blockiert: Installer nie gebaut, kein Windows-Testrechner, keine Signatur |

## 4. Weitere automatisierte Prüfungen

| Datei | Prüft |
|---|---|
| `apps/api/test/anmeldung.test.ts`, `review-allgemein.test.ts` | Anmeldung, Sperre nach Fehlversuchen, Einladungen, Passwort-Reset, Suchbegriffe als Daten, Dateinamen und Dateitypen, keine Einschleusung geschützter Felder, Protokollierung |
| `apps/api/test/datenexport.test.ts` | Datenexport für Betroffene ohne Passwort-Hashes, Tokens oder Speicherschlüssel |
| `apps/api/test/endpunkte.test.ts`, `smoke.test.ts` | Jeder Endpunkt aus `packages/contracts/src/api.ts` ist registriert; Abläufe je Bereich (Kunden, Termine, Annahme, Dokumente, Einstellungen); Grundgerüst |
| `packages/domain/src/appointments/appointments.test.ts`, `workOrders/*.test.ts`, `intake/intake.test.ts` | Termine und Konflikte, Arbeitsstatus, Positionen, Zeiterfassung, Annahme-Hash |
| `apps/app/e2e/f-termin.spec.ts`, `g-rueckfrage.spec.ts`, `w-tastatur.spec.ts` | Klickwege F und G, Tastaturbedienung am PC |
| `apps/app/e2e-api/00-rundgang.spec.ts` | Jede Ansicht je Rolle gegen die echte API; Antworten mit den zod-Schemas geprüft |
| `apps/app/e2e-api/20-werkstatt.spec.ts` | Schreibende Werkstattabläufe gegen die echte API: Auftrag mit neuem Kunden und Fahrzeug, Annahme, Freigabeanfrage, Rechnung, manuelle Zahlung nur mit Recht, Chat und interne Notiz |
