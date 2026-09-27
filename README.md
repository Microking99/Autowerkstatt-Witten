# Autowerkstatt Witten

Werkstattsoftware mit Kunden-App für **eine** Kfz-Werkstatt: Termine, Kunden, Fahrzeuge,
digitale Fahrzeugannahme, Aufträge, Mechanikeransicht, Kundenfreigaben mit Versionen,
Chat, Dokumente, Rechnungen mit Online-Zahlung (SumUp), Servicehistorie mit QR-Serviceheft.
Kein SaaS, keine Mandanten.

Zielplattformen: native iPhone-App, native Android-App, Windows-Anwendung mit Installer und ein
geschützter Browserzugang, alle auf derselben Datenbasis. Oberflächen und Dokumentation sind
deutsch.

> **Stand (27.09.2026):** Domain-Logik, API, App (Kunde, Werkstatt, Mechaniker, Demo-Modus) und
> Windows-Hülle sind vorhanden. Unit-, Integrations- und Browser-Tests laufen grün, auch die App
> gegen die echte API mit Testdatenbank. Es gibt **keinen** iOS-, Android- oder Windows-Build,
> keinen Test auf echten Geräten und keinen Anschluss an echte Dienste (SumUp, E-Mail, Push).
> Das unabhängige Review durch Codex steht aus. Details: [`docs/status.md`](docs/status.md).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `apps/api` | Backend: Node.js 22, Fastify, PostgreSQL 16 (Drizzle ORM). Entscheidet Rechte, Freigaben, Zahlungen und Servicehistorie. |
| `apps/app` | Expo / React Native (Expo Router): iPhone, Android, Browser; enthält den Demo-Modus. |
| `apps/desktop` | Tauri-2-Hülle für Windows um den Web-Export, NSIS-Installer. |
| `packages/domain` | Reine Geschäftslogik ohne I/O, vollständig unit-getestet. |
| `packages/contracts` | Gemeinsame Schemas (zod), Endpunkte, Routen und Deep Links, deutsche Bezeichnungen. |
| `packages/design-tokens` | Farben, Typografie, Abstände, Radien. |
| `docs/` | Anforderungen, Architektur, Entscheidungen, Abläufe, Tests, Status. |

Architekturüberblick: [`docs/architektur.md`](docs/architektur.md).

## Voraussetzungen

- Node.js 22 (`.nvmrc`), pnpm 10 (`corepack enable`)
- PostgreSQL 16 für die API (lokal über `pnpm --filter @werkstatt/api db:start`; das Skript
  nutzt die installierten PostgreSQL-Programme und legt die Daten unter `apps/api/.data/` ab)
- Chromium für die Browser-Tests (Playwright; Pfad über `PLAYWRIGHT_BROWSERS_PATH`)
- Für Windows-Builds: Windows mit Rust und Microsoft C++ Build Tools, oder der
  GitHub-Actions-Workflow "Windows-Installer"
- Für iOS- und Android-Builds: Expo-Konto (EAS); kein eigener Mac nötig

## Befehle

```bash
pnpm install                              # Abhängigkeiten
pnpm --filter @werkstatt/api db:start     # lokale PostgreSQL-Instanz (für API-Tests und Entwicklung)
pnpm typecheck                            # TypeScript in allen Paketen
pnpm test                                 # alle Unit- und Integrationstests

pnpm --filter @werkstatt/api dev          # API lokal (Konfiguration: apps/api/.env.example)
pnpm --filter @werkstatt/app web          # App im Browser gegen EXPO_PUBLIC_API_URL
pnpm --filter @werkstatt/app demo         # klickbarer Entwurf mit Beispieldaten

# Browser-Tests im Demo-Modus
pnpm --filter @werkstatt/app export:demo
pnpm --filter @werkstatt/app e2e

# Browser-Tests gegen die echte API (frische Testdatenbank werkstatt_e2e, Test-Zahlungsanbieter)
pnpm --filter @werkstatt/app export:api-e2e
pnpm --filter @werkstatt/app e2e:api
```

Windows-Installer: siehe `apps/desktop/README.md`. iOS und Android: EAS-Profile in
`apps/app/eas.json`, Workflow `mobile-eas.yml` (nur manuell, braucht Expo-Konto).

## Demo-Modus und Beispieldaten

`pnpm --filter @werkstatt/app demo` startet den klickbaren Entwurf für Werkstatt-, Mechaniker-
und Kundensicht mit **gekennzeichneten Beispieldaten** (Leiste "Entwurf mit Beispieldaten").
Im Demo-Modus gibt es keine echten Kunden, Zahlungen, E-Mails oder Push-Nachrichten
([ADR-013](docs/adr/ADR-013-demo-modus.md)).

## Sicherheitsregeln (Kurzfassung)

- Rechte gelten nur serverseitig, für jede Route, jeden Download, jeden Deep Link und jede
  Echtzeitverbindung.
- Keine Geheimnisse (Passwörter, Tokens, API-Schlüssel) in Dateien, Commits, Logs, Tests oder
  Nachrichten; Konfiguration über Umgebungsvariablen.
- Keine echten Kundendaten in Tests, Fixtures, Screenshots oder Prompts; nur gekennzeichnete
  Beispieldaten.
- Ohne ausdrückliche Freigabe des Inhabers keine echten Zahlungen, keine Nachrichten an reale
  Kunden, keine öffentlichen Deployments, keine Store-Veröffentlichungen, keine
  kostenpflichtigen Buchungen.
- Zahlung gilt erst nach serverseitig geprüfter Bestätigung des Anbieters; keine Kartendaten
  im System.

Vollständige Regeln: [`AGENTS.md`](AGENTS.md).

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Arbeitsregeln für alle Agenten und Mitwirkenden |
| [`docs/anforderungen.md`](docs/anforderungen.md) | Anforderungen mit IDs |
| [`docs/architektur.md`](docs/architektur.md) | Architektur, Sicherheit, Datenflüsse, Betrieb, Builds |
| [`docs/adr/`](docs/adr/) | Architekturentscheidungen ADR-001 bis ADR-014 |
| [`docs/rollen-und-rechte.md`](docs/rollen-und-rechte.md) | Rollen, Rechte, Objektregeln |
| [`docs/datenmodell.md`](docs/datenmodell.md) | Tabellen und Statusmodelle |
| [`docs/ansichten-und-routen.md`](docs/ansichten-und-routen.md) | Ansichten, Routen, Deep Links |
| [`docs/funktionsdiagramm.md`](docs/funktionsdiagramm.md) | Funktionen je Rolle |
| [`docs/ablaeufe.md`](docs/ablaeufe.md) | Nutzerabläufe, Klickwege A bis G, Zustandsdiagramme |
| [`docs/designsystem.md`](docs/designsystem.md) | Gestaltungsregeln und Tokens |
| [`docs/zahlungen.md`](docs/zahlungen.md) | Zahlungskonzept SumUp |
| [`docs/glossar.md`](docs/glossar.md) | Fachbegriffe und Bezeichner im Code |
| [`docs/tests.md`](docs/tests.md) | Testplan und Testbericht T-01 bis T-13 |
| [`docs/entwurf/`](docs/entwurf/) | Klickbarer Entwurf: Start, Rollen, Bildschirmfotos |
| [`docs/status.md`](docs/status.md) | Aktueller Stand, Blocker |
| [`docs/offene-entscheidungen.md`](docs/offene-entscheidungen.md) | Offene Entscheidungen mit Standardannahmen |
| [`docs/pruefpunkte-recht-und-betrieb.md`](docs/pruefpunkte-recht-und-betrieb.md) | Prüfpunkte Recht und Betrieb (keine Rechtsberatung) |
| [`docs/zusammenarbeit.md`](docs/zusammenarbeit.md) | Zusammenarbeit Claude Code und Codex, Arbeitspakete |
| [`docs/uebergaben/`](docs/uebergaben/) | Übergaben zwischen Claude Code und Codex |
