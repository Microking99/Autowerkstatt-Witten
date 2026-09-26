# AGENTS.md: Autowerkstatt Witten

Gemeinsame Arbeitsanweisungen für **alle** KI-Agenten in diesem Repository (Claude Code und
OpenAI Codex) und für menschliche Mitwirkende. Claude Code liest diese Datei über
`CLAUDE.md` (`@AGENTS.md`), Codex liest sie direkt.

## 1. Projekt in einem Absatz

Werkstattsoftware mit Kunden-App für **eine** konkrete Kfz-Werkstatt ("Autowerkstatt Witten").
Kein SaaS, keine Mandanten, keine Lizenz- oder Abo-Verwaltung. Zielplattformen: native
iPhone-App, native Android-App (keine PWA), Windows-Anwendung mit echtem Installer und ein
geschützter Browserzugang. Alle Clients nutzen dasselbe Backend und dieselbe Datenbasis.
Sprache der Oberflächen und der Dokumentation: **Deutsch**.

Vollständige Anforderungen: `docs/anforderungen.md`. Aktueller Stand: `docs/status.md`.

## 2. Aufbau des Repositorys

| Pfad | Inhalt |
|---|---|
| `apps/api` | Backend: Node.js 22, TypeScript, Fastify, PostgreSQL (Drizzle ORM). Einzige Stelle, an der Rechte, Zahlungen, Freigaben und Servicehistorie verbindlich entschieden werden. |
| `apps/app` | Expo / React Native (TypeScript, Expo Router): iOS-, Android- und Web-Client. Enthält den Demo-Modus (klickbarer Entwurf mit gekennzeichneten Beispieldaten). |
| `apps/desktop` | Tauri-2-Hülle für Windows um den Web-Export von `apps/app`, mit NSIS-Installer. |
| `packages/domain` | Reine Geschäftslogik ohne I/O: Rechteprüfung, Statusmodelle, versionierte Freigaben, Zahlungsabgleich, Servicehistorie, Fälligkeiten. Vollständig unit-getestet. |
| `packages/contracts` | Gemeinsame Schemas (zod) und Typen für API-Anfragen/-Antworten, Routen- und Deep-Link-Definitionen. |
| `packages/design-tokens` | Farben, Typografie, Abstände, Radien als Tokens für alle Clients. |
| `docs/` | Anforderungen, Architektur, Datenmodell, Rollen/Rechte, Ansichten/Routen, Abläufe, Designsystem, Tests, offene Entscheidungen, Übergaben. |
| `.claude/skills`, `.agents/skills` | Gepinnte Kopien der Design-Skills (siehe `.claude/skills/HERKUNFT.md`). |

Bezeichner im Code sind **englisch**, Oberflächentexte und Doku **deutsch**. Die Zuordnung der
Fachbegriffe steht in `docs/glossar.md` (z. B. Auftrag = `workOrder`, Freigabe = `approval`).

## 3. Befehle

```bash
pnpm install                 # Abhängigkeiten (pnpm 10, Node 22)
pnpm test                    # alle Tests (domain, contracts, api)
pnpm typecheck               # TypeScript in allen Paketen
pnpm --filter @werkstatt/api db:start   # lokale PostgreSQL-Instanz für Tests/Entwicklung
pnpm --filter @werkstatt/api dev        # API lokal
pnpm --filter @werkstatt/app web        # App im Browser
pnpm --filter @werkstatt/app demo       # klickbarer Entwurf mit Beispieldaten
```

Details und Voraussetzungen: `README.md`.

## 4. Unverrückbare Geschäftsregeln

Diese Regeln haben Vorrang vor jeder Detailentscheidung. Wer eine davon berührt, schreibt
zuerst einen Test, der die Regel absichert. Ausführlich in `docs/anforderungen.md`.

1. **Rechte gelten serverseitig**, für jede Route, jeden Dateidownload, jeden Deep Link und
   jede Echtzeitverbindung. Ausblenden in der Oberfläche ist keine Rechteprüfung.
2. **Kundendatensatz ≠ Kundenkonto.** Ein Kunde kann ohne App-Zugang existieren.
3. **Besitzerwechsel** gibt dem neuen Halter keinen Zugriff auf Aufträge, Dokumente,
   Nachrichten, Freigaben oder Rechnungen des Vorbesitzers.
4. **Freigaben sind an genau eine Version gebunden** (Inhalts-Hash). Jede Änderung von Umfang
   oder Preis erzeugt eine neue Version und verlangt eine neue Entscheidung. Ein "Ja" im Chat
   ist keine Freigabe. Mechaniker können nie für Kunden freigeben.
5. **Abgelehnte Arbeiten** werden nicht ausgeführt und erscheinen nie in der Servicehistorie.
6. **Arbeitsstatus, Freigabestatus und Zahlungsstatus sind getrennt.**
7. **Zahlung gilt erst nach serverseitig geprüfter Anbieterbestätigung** (Betrag, Währung,
   Händler, Rechnungszuordnung). "Jetzt bezahlen" und eine Erfolgsseite ändern nichts.
   Doppelte Anbieterereignisse erzeugen keine Doppelbuchung. Keine Kartendaten speichern.
8. **Serviceeinträge entstehen nur** aus tatsächlich ausgeführter und fachlich abgeschlossener
   Wartungsarbeit, genau einmal, nie aus Angebot, Freigabe, Rechnung oder Zahlung.
   Korrekturen erzeugen eine neue Revision, sie überschreiben nichts.
9. **Der QR-Code ist kein Generalschlüssel.** Ohne Anmeldung und Berechtigung zeigt er nur,
   was der Kunde ausdrücklich freigegeben hat.
10. **Offline erfasste Daten** gelten nie als bestätigte Freigabe oder Zahlung.

## 5. Sicherheit und Daten

- Keine Passwörter, Tokens, API-Schlüssel oder anderen Geheimnisse in Dateien, Commits, Logs,
  Tests oder Nachrichten. Konfiguration über Umgebungsvariablen (`.env` ist in `.gitignore`,
  Vorlage `apps/api/.env.example` ohne echte Werte).
- Anmeldungen bleiben im jeweiligen Werkzeug (Claude Code, Codex, SumUp, Expo, Apple, Google).
  Zugangsdaten werden nie zwischen Konten kopiert.
- Nur **klar gekennzeichnete Testdaten** (`[TEST]`/"Beispieldaten"). Keine echten Kundendaten
  in Tests, Fixtures, Screenshots oder Prompts.
- **Ohne ausdrückliche Freigabe des Inhabers verboten:** echte Zahlungen, Nachrichten an reale
  Kunden, öffentliche Deployments, Store-Veröffentlichungen, kostenpflichtige Buchungen.
- Externe Dienste (SumUp, E-Mail, Push) nur über Adapter mit Test-Implementierung; die echte
  Implementierung wird nur mit Sandbox-/Testzugang benutzt.

## 6. Zusammenarbeit Claude Code und Codex

Rollen, Arbeitspakete und aktueller Stand: `docs/zusammenarbeit.md`.

- **Claude Code:** Gesamtkoordination, Architektur, Informationsstruktur, UI/UX, Integration.
- **Codex:** abgegrenzte Implementierungspakete, Geschäftslogik, Tests, unabhängige Reviews.
- Wichtige Ergebnisse prüft jeweils der andere, besonders **Berechtigungen, Zahlungslogik und
  Servicehistorie**.
- Parallele Arbeit nur in getrennten Branches bzw. Klonen: `claude/<thema>` und
  `codex/<thema>`. Jedes Paket hat klare Dateizuständigkeiten (siehe Paketbeschreibung).
  Hinweis: Das offizielle Codex-Plugin für Claude Code kann in verknüpften Git-Worktrees
  keine Git-Metadaten schreiben (openai/codex-plugin-cc#765); dann separate Klone nutzen.
- Niemand behauptet Arbeit des anderen Werkzeugs, die nicht nachweisbar stattgefunden hat.

### Übergabeformat (Pflicht)

Jede Übergabe liegt als Datei unter `docs/uebergaben/` (Vorlage `docs/uebergaben/VORLAGE.md`)
und enthält: Aufgabe, betroffene Dateien, Schnittstellen, Abnahmekriterien, Tests
(Befehl + erwartetes Ergebnis) und nach Abschluss das **tatsächliche Ergebnis**.

## 7. Definition of Done

- Tests für neue Logik vorhanden und grün (`pnpm test`), Typprüfung grün (`pnpm typecheck`).
- Regeln aus Abschnitt 4 durch Tests abgedeckt, wenn berührt.
- Betroffene Doku aktualisiert (`docs/…`), `docs/status.md` ehrlich gepflegt:
  geplant / implementiert / getestet (womit) / blockiert (warum).
- Ein Browser-Test ist kein Nachweis für einen iPhone-, Android- oder Windows-Build.

## 8. Oberflächen

Verbindlich ist `docs/designsystem.md` (auf Basis der Skills `ui-ux-pro-max` und
`design-taste-frontend`, siehe `.claude/skills/HERKUNFT.md`). Kurzfassung: ruhige, sachliche
Arbeitssoftware; ein Akzent; Status immer als Text + Symbol + Farbe; große Bedienflächen auf
Mobilgeräten; Tastaturbedienung am PC; Lade-, Leer-, Fehler- und Erfolgszustände für jede
Ansicht; Bestätigung bei kritischen Aktionen; keine dekorativen Animationen; keine Emojis;
keine Gedankenstriche (—, –) in Oberflächentexten.

## Code Review Rules

Für Reviews (auch `@codex review` auf GitHub) mit Priorität prüfen:

- Fehlende oder umgehbare serverseitige Rechteprüfung (Route, Datei, Deep Link, WebSocket).
- Zugriff auf fremde Kundenakten, Vorbesitzer-Daten, interne Dokumente/Notizen.
- Freigabe ohne Bindung an Version/Hash, Freigabe durch Nicht-Kunden, Wiederverwendung alter
  Entscheidungen nach Änderungen.
- Zahlungsstatus ohne verifizierte Anbieterbestätigung, fehlende Idempotenz, Doppelbuchung,
  Betrags-/Währungs-/Rechnungsabgleich.
- Serviceeinträge aus falschen Ereignissen, doppelte Einträge, stilles Überschreiben.
- Geheimnisse, echte Personendaten oder Kartendaten in Code, Logs oder Tests.
