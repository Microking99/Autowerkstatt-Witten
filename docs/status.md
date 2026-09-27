# Status

Stand: 26.09.2026. Regeln: AGENTS.md Abschnitt 7. Diese Datei beschreibt, was **tatsächlich**
im Repository vorhanden und geprüft ist. Pakete, an denen gearbeitet wird, stehen als
"in Arbeit" ohne Ergebnisbehauptung. Arbeitspakete im Detail: `docs/zusammenarbeit.md`
Abschnitt 8.

> **Wichtig:** Es gibt noch **keinen** iOS-, Android- oder Windows-Build, keinen Test auf einem
> echten Gerät, keinen Server im Betrieb und keinen Zugang zu SumUp, E-Mail- oder
> Push-Diensten. Ein Browser-Test ist kein Nachweis für iPhone, Android oder Windows.

## 1. Vorhanden und geprüft

| Bestandteil | Inhalt | Geprüft mit | Ergebnis |
|---|---|---|---|
| Projektgrundlage (P-01) | Monorepo (pnpm 10, Node 22), `AGENTS.md`, `CLAUDE.md`, gepinnte Design-Skills | Sichtprüfung | vorhanden |
| `packages/contracts` | Rollen, Rechte, Status, DTOs, Anfragen, Endpunktliste `/api/v1`, Routen und Deep Links, deutsche Bezeichnungen | Vitest (`pnpm test`), `pnpm typecheck` | 9 Tests grün, Typprüfung grün (26.09.2026) |
| `packages/design-tokens` | Farben hell/dunkel, Typografie, Abstände, Radien | Vitest (Kontrastberechnung), `pnpm typecheck` | 8 Tests grün, Typprüfung grün (26.09.2026) |
| Dokumentation | Anforderungen, Rollen und Rechte, Datenmodell, Ansichten und Routen, Designsystem; neu: Architektur, ADR-001 bis ADR-014, Funktionsdiagramm, Abläufe, Zahlungen, Zusammenarbeit, Übergaben, offene Entscheidungen, Prüfpunkte, Glossar, Testplan, Status, README | Mermaid-Diagramme mit `@mermaid-js/mermaid-cli` 12.0.0 (Chromium, headless) einzeln gerendert | alle Diagramme ohne Syntaxfehler gerendert (26.09.2026); Inhalt nicht fachlich abgenommen |

## 2. In Arbeit (ohne Ergebnisbehauptung)

| Paket | Inhalt | Stand |
|---|---|---|
| P-02 | `packages/domain` (vorgesehen für Codex, ersatzweise Claude-Unteragent) | in Arbeit, nicht zusammengeführt |
| P-03 | `apps/api` | in Arbeit, nicht zusammengeführt |
| P-04 | `apps/app` Kern, Kundensicht, Demo-Modus | in Arbeit, nicht zusammengeführt |
| P-06 | `apps/desktop` (Tauri 2, NSIS) und `.github/workflows` | Erster Stand auf dem Integrationszweig (Commits `498afdf`, `9477348`). Laut Commit-Nachricht: `cargo check` unter Linux erfolgreich (Tauri 2.12.0); in diesem Dokumentationspaket nicht wiederholt. Windows-Build **nicht ausgeführt**, Start unter Windows **nicht getestet**, Installer **unsigniert**. Die Workflows für Windows und EAS wurden **nie ausgeführt**. |

## 3. Stand je Anforderungsbereich

| Bereich | geplant | implementiert | getestet (womit) | blockiert (warum) |
|---|---|---|---|---|
| R-ZIEL (Rahmen) | Vollständiger Umfang in Arbeitspaketen | Anforderungen gegliedert (`docs/anforderungen.md`) | | |
| R-PLAT-1 iPhone | Expo SDK 57, EAS Build/Submit (ADR-001) | App in Arbeit (P-04); kein Build | nicht getestet | Apple-Developer-Konto, Expo-Konto/EAS |
| R-PLAT-2 Android | Expo SDK 57, EAS Build/Submit | App in Arbeit (P-04); kein Build | nicht getestet | Google-Play-Konto, Expo-Konto/EAS |
| R-PLAT-3 Windows | Tauri-2-Hülle, NSIS, Windows-Runner | Erster Stand P-06 (siehe Abschnitt 2) | nur Kompilierprüfung unter Linux laut Commit; kein Windows-Build | Windows-Signatur (O-20), kein Windows-Testrechner |
| R-PLAT-4 Browser | Expo-Web-Export, geschützter Zugang | in Arbeit (P-04); CI-Job für Web-Export und Browser-Tests vorbereitet (P-06) | nicht getestet | Hosting (O-5), Domain (O-12) |
| R-PLAT-5 eine Datenbasis | Eigene API mit PostgreSQL (ADR-002) | Vertrag in `packages/contracts`; API in Arbeit (P-03) | Vertrag: Vitest | |
| R-ROLLE Rollen und Rechte | `docs/rollen-und-rechte.md`, ADR-005 | Rechtekatalog und Bezeichnungen in `packages/contracts`; Logik in Arbeit (P-02) | Vitest: jede Berechtigung hat eine Bezeichnung; öffentliche Endpunkte abschließend | Codex-Review C-01 (Codex nicht eingerichtet) |
| R-DASH Dashboard | Kacheln je Rolle | Schema `DashboardTile` | | |
| R-KAL Kalender und Termine | Anfrage ≠ Buchung, Konfliktprüfung | Schemas und Endpunkte im Vertrag | | |
| R-KUN Kundenverwaltung | Kundenakte, Suche | Schemas und Endpunkte im Vertrag | Vitest: Pflichtfelder Privat-/Geschäftskunde | |
| R-FZG Fahrzeugverwaltung | km-Historie, Halterzeiträume, Halterwechsel | Schemas und Endpunkte im Vertrag | Vitest: FIN-Prüfung | |
| R-ANN Fahrzeugannahme | Annahme mit Hash | Schemas im Vertrag | | Kundenroute für App-Bestätigung fehlt noch (`docs/ablaeufe.md` Abschnitt 2) |
| R-AUF Aufträge | Ablauf R-AUF-2, drei getrennte Status | Schemas `StatusTriple` u. a. | | |
| R-MECH Mechaniker | Ausführung, Feststellungen, Offline (ADR-011) | Schemas im Vertrag; App P-05 geplant | | |
| R-DOK Dokumente, Buchhaltungsübersicht | Private Dateiablage (ADR-009), CSV-Export | Endpunkte im Vertrag | | Entscheidungen E-1 bis E-3 |
| R-ADM Benutzer und Einstellungen | Einladungen, Rechte, Einstellungen | Endpunkte im Vertrag | | |
| R-CHAT, R-FRG Chat und Freigaben | Versionierte Freigaben mit Hash (ADR-006), Echtzeit (ADR-012) | Schemas im Vertrag | Vitest: Entscheidung verlangt 64-stelligen Hash | Codex-Review C-01 |
| R-BEN Benachrichtigungen | Outbox, Push über Expo, E-Mail (ADR-010) | Deep-Link-Routen im Vertrag | Vitest: Deep-Link-Pfade, `safeNextPath` | Push: Apple-, Google-/Firebase-, Expo-Konto; E-Mail-Anbieter (O-19) |
| R-ZAHL Rechnungen und Zahlungen | SumUp Hosted Checkout (ADR-007, `docs/zahlungen.md`) | Endpunkte im Vertrag | | SumUp-Konto und Testzugang (O-2); `checkout.sumup.com` aus der Cloud-Umgebung nicht erreichbar; Codex-Review C-02 |
| R-SERV, R-QR Servicehistorie und QR | Ableitung nur aus fachlichem Abschluss (ADR-008) | Schemas im Vertrag | | Bestätigung O-4; Codex-Review C-03 |
| R-KUI Kundenoberfläche | Klickwege A bis G (`docs/ablaeufe.md`) | in Arbeit (P-04) | | |
| R-IA-1 bis R-IA-3, R-IA-5 Informationsarchitektur | Funktionsdiagramm, Routen, Abläufe als Mermaid | Dokumente vorhanden | Mermaid-CLI-Rendering (siehe Abschnitt 1) | |
| R-IA-4 Klickbarer Entwurf | Demo-Modus der App (ADR-013) | in Arbeit (P-04) | | |
| R-ARCH Architektur, Sicherheit, Betrieb | `docs/architektur.md`, ADR-002 bis ADR-012 | Konzept; Umsetzung in P-03 | | Hosting (O-5), E-Mail-Anbieter (O-19) |
| R-ARCH-11 Recht und Datenschutz | `docs/pruefpunkte-recht-und-betrieb.md` | Prüfpunkte mit Quellen | keine Prüfung erfolgt; alle Punkte offen | Bewertung durch Inhaber und Berater |
| R-ERG Ergänzungen | Datenmodell vorbereitet | | | Entscheidungen O-6 bis O-10 |
| Designsystem | `docs/designsystem.md` | Tokens in `packages/design-tokens` | Vitest: Kontraste | |

## 4. Blockiert: was fehlt und wer es liefern kann

| Blocker | Wofür | Wer |
|---|---|---|
| Apple-Developer-Konto (99 USD/Jahr; bei Organisation D-U-N-S-Nummer) | iOS-Builds für Geräte, TestFlight, APNs-Schlüssel | Inhaber (Rechtsform O-11) |
| Google-Play-Konto (25 USD einmalig) und Firebase-Projekt | Android-Veröffentlichung, interne Tests, FCM | Inhaber |
| Expo-Konto und EAS-Zugang (`EXPO_TOKEN` als GitHub-Secret) | iOS- und Android-Builds ohne eigenen Mac | Inhaber |
| Windows-Signatur | Installer ohne SmartScreen-Warnung, automatische Updates | Inhaber (O-20, O-11) |
| SumUp-Testzugang (Sandbox-Händler, API-Schlüssel als Umgebungsgeheimnis) | Ende-zu-Ende-Test der Zahlung | Inhaber (O-2) |
| Hosting (EU) | Staging- und Echtbetrieb, öffentliche Webhook-Adresse | Inhaber (O-5); Deployment nur mit Freigabe |
| E-Mail-Anbieter (EU) und Domain | Einladungen, Passwort-Reset, Benachrichtigungen | Inhaber (O-19, O-12) |
| Codex-Einrichtung (ChatGPT Plus oder höher, GitHub-Verbindung, Code-Review) | Unabhängige Reviews C-01 bis C-03, Codex-Pakete | Inhaber (`docs/zusammenarbeit.md` Abschnitt 3) |
| Testgeräte (iPhone, Android, Windows-PC) | Gerätetests T-13 | Inhaber |
