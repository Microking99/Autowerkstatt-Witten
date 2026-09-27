# Status

Stand: 27.09.2026. Regeln: AGENTS.md Abschnitt 7. Diese Datei beschreibt, was **tatsächlich**
im Repository vorhanden und geprüft ist. Arbeitspakete im Detail: `docs/zusammenarbeit.md`
Abschnitt 8, Testfälle T-01 bis T-13: `docs/tests.md`.

> **Wichtig:** Es gibt **keinen** iOS-, Android- oder Windows-Build, keinen Test auf einem
> echten Gerät, keinen Server im Betrieb und keinen Zugang zu SumUp, E-Mail- oder
> Push-Diensten. Alle Oberflächentests liefen im Browser (Chromium). Ein Browser-Test ist kein
> Nachweis für iPhone, Android oder Windows. Codex hat nicht mitgearbeitet; das unabhängige
> Review (C-01 bis C-03) steht aus.

## 1. Vorhanden und geprüft

| Bestandteil | Inhalt | Geprüft mit | Ergebnis |
|---|---|---|---|
| Projektgrundlage | Monorepo (pnpm 10, Node 22, TypeScript 6), `AGENTS.md`, `CLAUDE.md`, gepinnte Design-Skills | Sichtprüfung | vorhanden |
| `packages/contracts` | Rollen, Rechte, Status, DTOs, Anfragen, Endpunktliste `/api/v1`, Fehlercodes, Routen und Deep Links, deutsche Bezeichnungen | Vitest, `pnpm typecheck` | 13 Tests grün (27.09.2026) |
| `packages/design-tokens` | Farben hell/dunkel, Typografie, Abstände, Radien, App-Symbol | Vitest (Kontraste) | 8 Tests grün (27.09.2026) |
| `packages/domain` | Rechte und Objektregeln, Arbeits-/Freigabe-/Zahlungsstatus, Freigabe-Hash (SHA-256), Annahme-Hash, SumUp-Abgleich, manuelle Zahlung, Servicehistorie mit Revisionen, Fälligkeiten (Zeit und km, gekennzeichnete Schätzung), Termine und Konflikte, Zeiterfassung, Freigaben für Dritte | Vitest | 247 Tests grün (27.09.2026) |
| `apps/api` | Fastify 5, PostgreSQL 16 (Drizzle, 4 Migrationen), Anmeldung (argon2id, Sitzungstoken, Sperre), Rechte in jeder Route, Dateiablage, Idempotency-Key, Outbox für E-Mail und Push (Test-Adapter), WebSocket mit laufender Rechteprüfung, SumUp-Adapter mit Test-Anbieter, Webhook mit Statusabfrage, Servicehistorie nur aus Abschlussprüfung, QR und Freigabelinks, Datenexport (DSGVO Art. 15/20), CSV-Export | Vitest gegen PostgreSQL 16 | 142 Tests grün (27.09.2026), davon 76 Angriffstests (`review-*.test.ts`) |
| `apps/app` | Expo SDK 57 (Expo Router): Kundenbereich (Klickwege A bis G), Werkstattbereich (Übersicht, Kalender, Kunden, Fahrzeuge, Aufträge mit Annahme, Arbeiten, Fotos, Dokumente, Chat, Freigaben, Rechnung, Verlauf; Nachrichten, Rechnungen, Wartungen, Benutzer, Einstellungen, Protokoll), Mechanikerbereich mit Offline-Warteschlange, Tastaturbedienung am PC, Demo-Modus mit Beispieldaten | Vitest; Playwright im Demo-Modus (Telefon 390x844, PC 1440x900); Playwright gegen die echte API | 99 Unit-Tests; 104 Browser-Tests im Demo-Modus; 15 Abläufe gegen die echte API (27.09.2026). **Nur Browser.** |
| `apps/desktop` | Tauri-2-Hülle um den Web-Export, NSIS-Installer, CSP auf die API-Adresse beschränkt | `cargo check` unter Linux (auch Ziel `x86_64-pc-windows-msvc`) | kompiliert; **Windows-Build nie ausgeführt**, Installer unsigniert |
| CI (`.github/workflows/ci.yml`) | Typen und Tests mit Postgres; Web-Export, native JS-Bundles (iOS/Android, kein nativer Build), Browser-Tests Demo; Browser-Tests gegen die echte API | GitHub Actions | grün seit Lauf 6 für die jeweils vorhandenen Jobs; Job "App gegen echte API" neu am 27.09.2026 |
| `windows-desktop.yml`, `mobile-eas.yml` | Windows-Installer auf Windows-Runner, EAS-Builds | nur manuell auslösbar | **nie ausgeführt** (EAS braucht Expo-Konto) |
| Dokumentation | Anforderungen, Rollen und Rechte, Datenmodell, Ansichten und Routen, Designsystem, Architektur, ADR-001 bis ADR-014, Funktionsdiagramm, Abläufe, Zahlungen, Zusammenarbeit, Übergaben, offene Entscheidungen, Prüfpunkte Recht und Betrieb, Glossar, Testplan | Mermaid-CLI-Rendering | Diagramme ohne Syntaxfehler; Inhalt nicht fachlich durch den Inhaber abgenommen |

## 2. In Arbeit

| Paket | Inhalt | Stand |
|---|---|---|
| API-3 | Zuweisbare Mitarbeiter (`GET /staff/assignable`), Teile und laufende Zeit je Position, Gerätezeitpunkt für offline erfasste Zeiten | Vertrag festgelegt (`43f946f`); Umsetzung in API und App läuft, nicht zusammengeführt |

## 3. Stand je Anforderungsbereich

"Getestet" heißt: automatisierte Tests grün am 27.09.2026. Oberflächentests nur im Browser.

| Bereich | implementiert | getestet (womit) | blockiert (warum) |
|---|---|---|---|
| R-PLAT-1 iPhone | App-Code und EAS-Profile vorhanden; native JS-Bundle wird in CI erzeugt | kein Build, kein Gerätetest | Apple-Developer-Konto, Expo-Konto/EAS |
| R-PLAT-2 Android | wie iPhone | kein Build, kein Gerätetest | Google-Play-Konto, Expo-Konto/EAS |
| R-PLAT-3 Windows | Tauri-Hülle mit NSIS | nur `cargo check` | Windows-Signatur (O-20), kein Windows-Testrechner |
| R-PLAT-4 Browser | Web-Export, Anmeldung im Browser (Token nur im Tab) | Playwright Demo und echte API | Hosting (O-5), Domain (O-12) |
| R-PLAT-5 eine Datenbasis | eine API mit PostgreSQL für alle Clients | API-Integration, E2E gegen API | |
| R-ROLLE Rollen und Rechte | Rechtekatalog, Überschreibungen je Person, Objektregeln, 404 für Fremdes | Domain, API (T-02, T-03, Angriffstests), E2E | Codex-Review C-01 |
| R-DASH Dashboard | Kacheln je Rolle | API, E2E Demo | |
| R-KAL Kalender und Termine | Anfrage ≠ Buchung, Konflikte (Hebebühne, Mitarbeiter, Teile, Öffnungszeiten), Speichern bei Konflikt nur mit Begründung | Domain, API, E2E Demo | |
| R-KUN Kundenverwaltung | Kundenakte, Suche, Kundenzugang einladen, sperren, freischalten | API, E2E Demo | |
| R-FZG Fahrzeugverwaltung | km-Historie mit Plausibilität, Halterzeiträume, Halterwechsel | Domain, API (T-10), E2E Demo | |
| R-ANN Fahrzeugannahme | Annahme mit Inhalts-Hash, vor Ort oder in der Kunden-App bestätigt; danach Änderungen nur über Freigabe | Domain, API, E2E Demo | |
| R-AUF Aufträge | Ablauf mit drei getrennten Status, Zuweisung, Abschlussprüfung, abholbereit, Storno | Domain, API, E2E Demo und API | |
| R-MECH Mechaniker | Ausführung ohne Preise, Feststellungen mit Fotos, Offline-Warteschlange mit Idempotenz | Domain, API, App-Unit, E2E Demo und API | Checkliste nur lokal (O-10); Diktat nur über Gerätetastatur (O-9); Gerätezeitpunkt in API-3 |
| R-DOK Dokumente, Buchhaltungsübersicht | private Dateiablage mit Freigabe für Kunden, CSV-Export der Rechnungen | API, E2E Demo | Dokumentvorlagen, Archivierung, DATEV (E-1 bis E-3) |
| R-ADM Benutzer und Einstellungen | Einladungen, Rollen, Rechte je Person, Inhaber-Schutz, Werkstattdaten, Wartungsarten, Hebebühnen | API, E2E Demo | |
| R-CHAT Chat | Gespräche je Auftrag, interne Notizen getrennt, Anhänge, Echtzeit | API, E2E Demo | |
| R-FRG Freigaben | Versionen mit Inhalts-Hash, Entscheidung nur zur aktuellen Version, nur durch Kunden | Domain, API (T-04, T-05), E2E Demo und API | Codex-Review C-01 |
| R-BEN Benachrichtigungen | Outbox, Deep Links, Präferenzen; E-Mail und Push nur über Test-Adapter | Vertrag, API (T-11), E2E Demo | Push: Apple-, Firebase-, Expo-Konto; E-Mail-Anbieter (O-19) |
| R-ZAHL Rechnungen und Zahlungen | SumUp Hosted Checkout über Adapter, Webhook mit Statusabfrage, Abgleich von Betrag, Währung, Händler und Rechnung, Idempotenz, manuelle Zahlung und Erstattung mit Recht | Domain, API (T-06, T-07, Angriffstests), E2E Demo und API mit Test-Anbieter | SumUp-Testzugang (O-2); Codex-Review C-02 |
| R-SERV, R-QR Servicehistorie und QR | Einträge nur aus Abschlussprüfung, genau einmal, Korrektur als Revision; QR ohne Anmeldung nur freigegebene Kurzansicht; Freigabelinks für Dritte | Domain, API (T-08, T-09), E2E Demo und API | Bestätigung O-4; Codex-Review C-03 |
| R-KUI Kundenoberfläche | Klickwege A bis G | E2E Demo, E2E API (A, B, C, D, E) | |
| R-IA Informationsarchitektur, klickbarer Entwurf | Funktionsdiagramm, Routen, Abläufe (Mermaid); Demo-Modus (`pnpm --filter @werkstatt/app demo`), Bildschirmfotos `docs/entwurf/` | Mermaid-CLI, E2E Demo | |
| R-ARCH Architektur, Sicherheit, Betrieb | `docs/architektur.md`, ADRs, Rate-Limits, Sicherheitskopfzeilen, Audit-Protokoll | API (Angriffstests) | Hosting (O-5), Backups und Monitoring erst mit Hosting |
| R-ARCH-11 Recht und Datenschutz | Prüfpunkte mit Quellen; Datenexport für Betroffene umgesetzt | API (`datenexport.test.ts`) | Bewertung durch Inhaber und Berater |
| R-ERG Ergänzungen | Lager, Reifen, Ersatzwagen als Platzhalter; Datenmodell vorbereitet | | Entscheidungen O-6 bis O-10 |

## 4. Bekannte Einschränkungen

- Offline erfasste Zeiten bucht der Server bis zum Abschluss von API-3 zum Empfangszeitpunkt.
- Offline-Warteschlange liegt in AsyncStorage statt SQLite (ADR-011); im Browser werden
  Offline-Fotos über 4 MB nicht dauerhaft gespeichert.
- Datums- und Zeitfelder im Browser folgen der Sprache des Browsers.
- Die Rückkehrseite nach der Zahlung nennt keinen genauen Fehlergrund des Anbieters.
- Gesperrtes Konto: Mit richtigem Passwort antwortet die API mit 403 `account_disabled`, damit
  gesperrte Personen einen Hinweis bekommen; die vorübergehende Sperre nach Fehlversuchen
  antwortet wie ein falsches Passwort (401). Entscheidung der Koordination vom 27.09.2026.

## 5. Blockiert: was fehlt und wer es liefern kann

| Blocker | Wofür | Wer |
|---|---|---|
| Apple-Developer-Konto (99 USD/Jahr; bei Organisation D-U-N-S-Nummer) | iOS-Builds für Geräte, TestFlight, APNs-Schlüssel | Inhaber (Rechtsform O-11) |
| Google-Play-Konto (25 USD einmalig) und Firebase-Projekt | Android-Veröffentlichung, interne Tests, FCM | Inhaber |
| Expo-Konto und EAS-Zugang (`EXPO_TOKEN` als GitHub-Secret) | iOS- und Android-Builds ohne eigenen Mac | Inhaber |
| Windows-Signatur | Installer ohne SmartScreen-Warnung, automatische Updates | Inhaber (O-20, O-11) |
| SumUp-Testzugang (Sandbox-Händler, API-Schlüssel als Umgebungsgeheimnis) | Ende-zu-Ende-Test der Zahlung | Inhaber (O-2) |
| Hosting (EU) | Staging- und Echtbetrieb, öffentliche Webhook-Adresse | Inhaber (O-5); Deployment nur mit Freigabe |
| E-Mail-Anbieter (EU) und Domain | Einladungen, Passwort-Reset, Benachrichtigungen | Inhaber (O-19, O-12) |
| Codex-Einrichtung (ChatGPT Plus oder höher, GitHub-Verbindung, Code-Review) | Unabhängige Reviews C-01 bis C-03 | Inhaber (`docs/zusammenarbeit.md` Abschnitt 3) |
| Testgeräte (iPhone, Android, Windows-PC) | Gerätetests T-13 | Inhaber |
