# Zusammenarbeit Claude Code und Codex

Stand: 27.09.2026. Entscheidung: ADR-014. Gemeinsame Regeln: `AGENTS.md`.

## 1. Rollen

| Werkzeug | Zuständig für |
|---|---|
| **Claude Code** | Gesamtkoordination, Architektur, Informationsstruktur, UI/UX, Integration, Übergaben schreiben, Ergebnisse von Codex prüfen und zusammenführen. |
| **OpenAI Codex** (Zugang des Inhabers) | Abgegrenzte Implementierungspakete, Geschäftslogik, Tests, unabhängige Reviews der Ergebnisse von Claude Code (besonders Rechte, Zahlungen, Servicehistorie). |
| **Inhaber** | Einrichtung der Zugänge (Codex, GitHub, SumUp, Expo, Apple, Google), Freigabe von Kosten, Veröffentlichungen und echten Zahlungen, Entscheidungen in `docs/offene-entscheidungen.md`. |

## 2. Aktueller Stand (ehrlich)

- **Codex ist in dieser Umgebung nicht installiert und nicht angemeldet.** Claude Code läuft
  als Cloud-Sitzung; dort ist `codex` nicht vorhanden, es gibt kein `~/.codex`, und
  `/plugin` steht in Cloud-Sitzungen nicht zur Verfügung.
- **Codex hat bisher nicht mitgearbeitet.** Alle bisherigen Commits und Dokumente stammen von
  Claude Code (Hauptsitzung und Claude-Unteragenten).
- Das für Codex vorgesehene Paket P-02 (Domain-Logik) wurde wegen der fehlenden Anbindung von
  einem Claude-Unteragenten umgesetzt. Als Ersatz für das fehlende Gegen-Review hat ein
  **weiterer Claude-Unteragent** mit Angriffstests Rechte, Zahlungen, Freigaben und
  Servicehistorie geprüft (R-01, `docs/uebergaben/2026-09-27-review-claude.md`). Das ist
  **kein unabhängiges Review im Sinne von AGENTS.md**, weil dasselbe Modell prüft, das
  umgesetzt hat. Das Review durch Codex bleibt als C-01 bis C-03 offen und findet statt,
  sobald Codex eingerichtet ist.
- Vorbereitet für Codex: `AGENTS.md` mit Abschnitt "Code Review Rules", Übergabevorlage
  `docs/uebergaben/VORLAGE.md`, ausgefüllte Übergaben C-01 bis C-03, gepinnte Design-Skills
  unter `.agents/skills/`.

## 3. Einrichtung durch den Inhaber

Alle Anmeldungen macht der Inhaber selbst in seinem eigenen Konto. Zugangsdaten werden nie in
Claude eingegeben, nie ins Repository geschrieben und nie zwischen Konten kopiert.

### 3a. Lokal (eigener Rechner mit Claude Code CLI oder Desktop-App)

1. Codex CLI installieren: `npm i -g @openai/codex`
   (alternativ laut OpenAI: Installationsskript bzw. `brew install --cask codex`).
2. In einem **eigenen Terminal** anmelden: `codex login`, danach `codex login status`.
   **Nicht** über `!codex login` in Claude Code: Der Shell-Modus übernimmt Befehl und Ausgabe in
   den Gesprächskontext von Claude. Optional die Zugangsdaten im Schlüsselbund speichern:
   `cli_auth_credentials_store = "keyring"` in der Codex-Konfiguration.
3. In Claude Code:
   ```text
   /plugin marketplace add openai/codex-plugin-cc
   /plugin install codex@openai-codex
   /reload-plugins
   /codex:setup
   ```
   Das Review-Gate bleibt ausgeschaltet (Warnung im Plugin-README: lange Schleifen verbrauchen
   Nutzungskontingent).
4. Nutzung: `/codex:review --base main --background`, `/codex:adversarial-review --background
   <Schwerpunkt>`, `/codex:rescue --background <Aufgabe>`, Ergebnisse über `/codex:status`,
   `/codex:result`.
5. **Getrennte Klone statt verknüpfter Worktrees:** Das Plugin (Version 1.0.6) kann in einem
   verknüpften Git-Worktree keine Git-Metadaten schreiben (openai/codex-plugin-cc#765). Für
   Codex-Pakete daher einen eigenen Klon verwenden, z. B.
   `git clone <repo> ../aw-codex && cd ../aw-codex && git switch -c codex/<thema>`.

Bekannte Einschränkungen des Plugins (Stand 26.09.2026): seit 07.07.2026 keine Commits, offene
Fehler u. a. #783 (Umgebungsdatei wächst bei jedem Sitzungsstart) und #781 (hängende Aufträge);
die Modellnamen im Plugin-README (`gpt-5.4-mini`) sind für die ChatGPT-Anmeldung laut OpenAI
seit 31.08.2026 nicht mehr verfügbar, daher kein Modell aus dem README übernehmen. Unter
Linux/WSL braucht die Codex-Sandbox `bubblewrap`. Windows-Unterstützung des Plugins ist
upstream nicht getestet.

### 3b. Cloud (Codex Cloud mit GitHub)

1. `https://chatgpt.com/codex` öffnen und mit dem eigenen ChatGPT-Konto anmelden. Bei Anmeldung
   mit E-Mail und Passwort verlangt OpenAI vor der Nutzung von Codex Cloud eine
   **Mehrfaktor-Anmeldung (MFA)**.
2. GitHub verbinden und **nur** das Repository `Microking99/Autowerkstatt-Witten` freigeben.
3. Eine Umgebung für das Repository anlegen (Einrichtungsskript z. B. `corepack enable &&
   pnpm install --frozen-lockfile`). Internetzugang des Agenten bleibt aus, solange er nicht
   gebraucht wird; Geheimnisse sind nur im Einrichtungsskript verfügbar.
4. Unter `https://chatgpt.com/codex/settings/code-review` das **Code-Review für das Repository
   aktivieren**, bevorzugt mit "Automatic reviews" für neue Pull Requests.
5. **"Smart detect" nicht aktivieren:** Laut einem Bericht im Codex-Repository (#40606)
   löst dieser experimentelle Auslöser Codex-Aufgaben auch bei normalen PR-Kommentaren aus.
   Weil Claude Kommentare unter dem GitHub-Konto des Inhabers schreibt, drohen Schleifen.
6. Voraussetzung: **ChatGPT Plus oder höher** (Codex Cloud, `@codex`-Delegation und
   GitHub-Code-Review sind laut OpenAI-Preisseite ab Plus verfügbar, nicht mit API-Schlüssel).
   **Keine zusätzlichen Credits ohne Freigabe des Inhabers.**
7. Datenschutz: Die OpenAI-Preisseite weist "No training on API or business data by default"
   für Plus und Pro als nicht enthalten aus. Die Datensteuerung im ChatGPT-Konto prüfen; echte
   Kundendaten gehören ohnehin nicht ins Repository.

Nicht verifiziert: ob ein `@codex review`-Kommentar, den diese Claude-Sitzung schreibt, Codex
auslöst. "Automatic reviews" umgeht die Frage.

### 3c. Nicht empfohlen

| Weg | Grund |
|---|---|
| Codex-Anmeldung in Claude-Umgebungen (Gerätecode-Login im Container, Kopie von `~/.codex/auth.json`, API-Schlüssel als Claude-Umgebungsgeheimnis) | Token wären für Claude lesbar; OpenAI sagt, `auth.json` sei wie ein Passwort zu behandeln; widerspricht "Anmeldungen bleiben im Werkzeug". |
| `codex mcp-server` | In Codex CLI 0.154.0 entfernt. |
| Community-Plugin "Codex Dispatch" | Setzt den entfernten MCP-Server voraus. |
| `/codex:transfer` | Überträgt das gesamte Claude-Gespräch an OpenAI; nur ohne personenbezogene Daten im Gespräch. |
| Codex GitHub Action mit API-Schlüssel | Zusätzliche API-Kosten; nur mit ausdrücklicher Freigabe. |

## 4. Arbeitsteilung und Branches

- Branches: `claude/<thema>` für Claude Code, `codex/<thema>` für Codex. Nie schreiben beide
  gleichzeitig auf denselben Branch.
- Codex arbeitet in der Cloud auf eigenen Branches und liefert Pull Requests; `@codex fix`
  wird nicht auf `claude/*`-Branches eingesetzt, solange Claude daran arbeitet.
- Claude schreibt in PR-Kommentaren `@codex` nur, wenn eine Codex-Aufgabe beabsichtigt ist.
- Zusammenführen nur mit grüner CI (`.github/workflows/ci.yml`) und nach Review durch das
  jeweils andere Werkzeug bei Rechten, Zahlungen und Servicehistorie. Empfehlung: Schutz des
  Hauptzweigs (Pull Request und grüne CI verpflichtend), Einrichtung durch den Inhaber.

## 5. Dateizuständigkeiten

| Pfad | Zuständiges Paket | Prüfung durch |
|---|---|---|
| `AGENTS.md`, `CLAUDE.md`, `docs/**` | Koordination (Claude) | Inhaber; fachliche Abschnitte je Paket |
| `packages/contracts/**` | Koordination (Claude); Änderungen nur abgestimmt | Paket, das sie nutzt |
| `packages/design-tokens/**` | Koordination (Claude) | |
| `packages/domain/**` | P-02 | Codex (C-01 bis C-03) |
| `apps/api/**` | P-03 | Codex (C-01, C-02, C-03) |
| `apps/app/**` Kern und Kundensicht | P-04 | Claude-Koordination; UI-Prüfliste `docs/designsystem.md` |
| `apps/app/**` Werkstatt und Mechaniker | P-05 | Claude-Koordination |
| `apps/desktop/**`, `.github/workflows/**` | P-06 | Claude-Koordination |
| `apps/app/.maestro/**` (entsteht) | C-04 | Claude |

Wer eine Datei außerhalb seiner Zuständigkeit ändern muss, beschreibt das in der Übergabe und
stimmt es vorher ab.

## 6. Übergabeprozess

1. Claude schreibt die Übergabe nach `docs/uebergaben/VORLAGE.md` (Aufgabe, Kontext, Dateien
   mit Zuständigkeit, Schnittstellen, Abnahmekriterien, Tests mit Befehl und erwartetem
   Ergebnis).
2. Der Inhaber startet die Aufgabe (Codex Cloud: Aufgabe mit Verweis auf die Datei; lokal:
   `/codex:rescue` bzw. `/codex:adversarial-review` mit Verweis).
3. Codex arbeitet auf `codex/<thema>` und öffnet einen Pull Request.
4. Codex trägt im Abschnitt "Tatsächliches Ergebnis" ein, was es geändert und welche Tests es
   mit welchem Ergebnis ausgeführt hat.
5. Claude prüft (Tests lokal bzw. in CI, Review gegen Abnahmekriterien), führt zusammen oder
   gibt Rückmeldung im Pull Request.
6. `docs/status.md` und die Tabelle in Abschnitt 8 werden aktualisiert.
7. Umgekehrt gilt dasselbe: Ergebnisse von Claude in den kritischen Bereichen gehen als
   Review-Auftrag an Codex.

## 7. Gegenseitige Prüfung

| Bereich | Umsetzung | Review | Schwerpunkt | Übergabe |
|---|---|---|---|---|
| Rechte und Objektregeln | P-02, P-03 (Claude) | Codex | Umgehbare Prüfungen, fremde Akten, Vorbesitzer, 404 statt 403, Dateien, Deep Links, WebSocket | `docs/uebergaben/C-01-review-rechte.md` |
| Zahlungen | P-02, P-03 (Claude) | Codex | Nur geprüfte Anbieterbestätigung, Idempotenz, Doppelzahlung, Erstattung, Abgleich | `docs/uebergaben/C-02-review-zahlungen.md` |
| Servicehistorie und Fälligkeiten | P-02, P-03 (Claude) | Codex | Nur aus fachlichem Abschluss, genau einmal, Revisionen, Halterwechsel, Fälligkeitsgrenzen | `docs/uebergaben/C-03-review-servicehistorie.md` |
| Von Codex umgesetzte Pakete | Codex | Claude | Architekturtreue, Schnittstellen, Oberflächenregeln | je Paket |

## 8. Arbeitspakete

Statuswerte: `geplant`, `in Arbeit`, `zur Prüfung`, `erledigt`, `blockiert (Grund)`,
`zurückgestellt (Grund)`. "Umgesetzt von" nennt, wer tatsächlich gearbeitet hat.

| ID | Inhalt | Vorgesehen für | Umgesetzt von | Status | Stand | Notiz |
|---|---|---|---|---|---|---|
| P-01 | Projektgrundlage: Monorepo, AGENTS.md, Anforderungen, Rechte, Datenmodell, Routen, Designsystem, `packages/contracts`, `packages/design-tokens` | Claude | Claude | erledigt | 26.09.2026 | Commit `a42708c` |
| P-02 | Domain-Logik `packages/domain`: Rechte, Statusübergänge, Freigabe-Hash, Zahlungsprüfung, Servicehistorie, Fälligkeiten | Codex | Claude-Unteragent (Codex nicht angebunden) | erledigt, Codex-Review offen | 27.09.2026 | Zusammengeführt (`f129e99`); 247 Tests grün; Review C-01 bis C-03 offen |
| P-03 | API `apps/api`: Fastify, Drizzle-Schema und Migrationen, Anmeldung, Routen, SumUp-Adapter (Test-Anbieter), Outbox, WebSocket | Claude-Unteragent | Claude-Unteragent | erledigt, Codex-Review offen | 27.09.2026 | Zusammengeführt (`f5bbc05`); 142 Integrationstests gegen PostgreSQL grün; nie gegen die SumUp-Sandbox getestet (O-2) |
| P-04 (APP-1) | App Kern und Kundensicht `apps/app`: Navigation, Anmeldung, Kundenbereich, Demo-Modus, Browser-Tests | Claude-Unteragent | Claude-Unteragent | erledigt | 27.09.2026 | Zusammengeführt (`e393fb9`); nur im Browser geprüft |
| P-05 (APP-2) | App Werkstatt und Mechaniker, Offline-Warteschlange, Tastatur | Claude-Unteragent | Claude-Unteragent | erledigt | 27.09.2026 | Zusammengeführt (`9e3cf31`); Playwright 104 bestanden im Demo-Modus; nur im Browser geprüft |
| P-06 | Windows-Hülle `apps/desktop` (Tauri 2, NSIS) und CI-Workflows | Claude | Claude | erledigt (ohne Windows-Build) | 27.09.2026 | `cargo check` Linux und Ziel `x86_64-pc-windows-msvc` erfolgreich; Windows-Build nie ausgeführt, Installer unsigniert |
| P-07 | Datenexport für Betroffene (DSGVO Art. 15/20): `/me/export`, `/customers/:id/export`, Kundenroute `/kunde/konto/datenexport` | Claude | Claude | erledigt | 27.09.2026 | API `0c0d977`, Oberfläche in P-05; Tests `apps/api/test/datenexport.test.ts` |
| P-08 | Integration: App gegen die echte API im Browser (`apps/app/e2e-api`, `apps/api/scripts/e2e-server.ts`, CI-Job) | Claude | Claude | erledigt | 27.09.2026 | Commit `81b567a`; 10 Abläufe grün; ein Fehler gefunden und behoben (Kennzeichen doppelt) |
| API-3 | Zuweisbare Mitarbeiter, Teile und laufende Zeit je Position, Gerätezeitpunkt für Offline-Zeiten | Claude-Unteragent | Claude-Unteragent | in Arbeit | 27.09.2026 | Vertrag festgelegt (`43f946f`); Übergabe folgt unter `docs/uebergaben/2026-09-27-api-3.md` |
| D-01 | Architektur-, Ablauf- und Prozessdokumentation (`docs/architektur.md`, `docs/adr/`, `docs/ablaeufe.md` u. a.) | Claude | Claude-Unteragent | erledigt | 27.09.2026 | Zusammengeführt (`1b89363`); 32 Mermaid-Diagramme mit mermaid-cli gerendert |
| R-01 | Ersatz-Review Rechte, Zahlungen, Freigaben, Servicehistorie (Angriffstests) | Codex | Claude-Unteragent (Ersatz, **nicht unabhängig**) | erledigt | 27.09.2026 | Zusammengeführt (`263bd70`); Befunde behoben (`829b43d`, `d12dc26`, `bb882be`) |
| C-01 | Unabhängiges Review Rechte und Objektregeln (domain und api) | Codex | | blockiert (Codex nicht eingerichtet) | 27.09.2026 | Übergabe vorbereitet; Code liegt vor |
| C-02 | Unabhängiges Review Zahlungslogik inkl. SumUp-Abgleich | Codex | | blockiert (Codex nicht eingerichtet) | 27.09.2026 | Übergabe vorbereitet; Code liegt vor |
| C-03 | Unabhängiges Review Servicehistorie und Fälligkeiten | Codex | | blockiert (Codex nicht eingerichtet) | 27.09.2026 | Übergabe vorbereitet; Code liegt vor |
| C-04 | Maestro-E2E-Abläufe für iOS und Android | Codex | | blockiert (keine Builds, keine Geräte, kein Expo-Konto) | 26.09.2026 | Möglichkeit: EAS Workflows für E2E-Läufe |
| C-05 | Ergänzung Reifeneinlagerung | Codex | | zurückgestellt (Entscheidung O-7) | 26.09.2026 | Datenmodell vorbereitet |
| C-06 | CSV/DATEV-Export-Spike | Codex | | zurückgestellt (Entscheidung E-3) | 26.09.2026 | CSV-Export der Rechnungen ist in der API vorhanden |

## Quellen (abgerufen 26.09.2026)

- Plugin und README: https://github.com/openai/codex-plugin-cc, https://github.com/openai/codex-plugin-cc/blob/main/README.md
- Worktree-Fehler: https://github.com/openai/codex-plugin-cc/issues/765; weitere Fehler: https://github.com/openai/codex-plugin-cc/issues/783, https://github.com/openai/codex-plugin-cc/issues/781
- Codex CLI: https://learn.chatgpt.com/docs/codex/cli.md, Anmeldung und `auth.json`: https://learn.chatgpt.com/docs/auth.md
- Entfernung `codex mcp-server`: https://github.com/openai/codex/releases/tag/rust-v0.154.0
- Modelle (ausgelaufene Namen): https://learn.chatgpt.com/docs/models.md
- Sandbox (bubblewrap): https://learn.chatgpt.com/docs/sandboxing.md
- Codex Cloud und Umgebungen: https://learn.chatgpt.com/docs/cloud, https://learn.chatgpt.com/docs/environments/cloud-environment
- Code-Review auf GitHub: https://learn.chatgpt.com/docs/third-party/github
- Smart-detect-Bericht: https://github.com/openai/codex/issues/40606
- Preise und Pläne: https://learn.chatgpt.com/docs/pricing
- Claude Code in der Cloud (kein `/plugin`, keine Repository-Plugins): https://code.claude.com/docs/en/claude-code-on-the-web, https://code.claude.com/docs/en/cloud-environments
- Shell-Modus von Claude Code: https://code.claude.com/docs/en/interactive-mode.md
