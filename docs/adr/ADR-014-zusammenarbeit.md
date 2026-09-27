# ADR-014: Zusammenarbeit Claude Code und Codex

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** AGENTS.md Abschnitt 6
- **Ausführlich:** `docs/zusammenarbeit.md`

## Kontext

Der Inhaber möchte, dass Claude Code und OpenAI Codex (mit seinem eigenen Codex-Zugang)
zusammenarbeiten und sich gegenseitig prüfen, besonders bei Rechten, Zahlungen und
Servicehistorie. Claude Code läuft derzeit in einer Cloud-Sitzung; Codex ist dort weder
installiert noch angemeldet. Anmeldungen sollen in ihrem jeweiligen Werkzeug bleiben.

## Entscheidung

- **Rollen:** Claude Code koordiniert, verantwortet Architektur, Informationsstruktur, UI/UX
  und Integration. Codex übernimmt abgegrenzte Implementierungspakete, Tests und
  unabhängige Reviews.
- **Gemeinsame Anweisungen** in `AGENTS.md` (Codex liest sie direkt, Claude Code über
  `CLAUDE.md` mit `@AGENTS.md`), inklusive Abschnitt "Code Review Rules" für
  `@codex review`.
- **Übergabe über Dateien** in `docs/uebergaben/` nach `VORLAGE.md`; Ergebnis wird dort
  eingetragen.
- **Getrennte Branches** `claude/<thema>` und `codex/<thema>`; bei lokaler Nutzung des
  Codex-Plugins getrennte Klone statt verknüpfter Worktrees (bekannter Fehler
  openai/codex-plugin-cc#765).
- **Kanäle:** lokal das offizielle Plugin `openai/codex-plugin-cc` mit der lokal vom Inhaber
  angemeldeten Codex CLI; in der Cloud Codex Cloud mit GitHub-Anbindung und Pull Requests
  (`@codex review`, automatische Reviews).
- **Keine Codex-Anmeldung in Claude-Umgebungen**, kein Kopieren von `~/.codex/auth.json`.
- **Ehrlichkeit:** Niemand behauptet Arbeit des anderen Werkzeugs, die nicht nachweisbar
  stattgefunden hat. Solange Codex nicht eingerichtet ist, werden für Codex vorgesehene Pakete
  entweder zurückgestellt oder ausdrücklich als "von Claude umgesetzt" gekennzeichnet.

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| `codex mcp-server` als MCP-Server in Claude Code | In Codex CLI 0.154.0 entfernt. |
| Community-Plugin "Codex Dispatch" | Baut auf dem entfernten MCP-Server auf; nicht mehr funktionsfähig. |
| Codex-Login per Gerätecode oder kopierter `auth.json` in der Claude-Cloud-Sitzung | Token wären für Claude lesbar; widerspricht "Anmeldungen bleiben im Werkzeug". |
| Codex GitHub Action mit API-Schlüssel | Zusätzliche API-Kosten; nur mit ausdrücklicher Freigabe. |

## Folgen

- Bis zur Einrichtung durch den Inhaber hat Codex **nicht** mitgearbeitet; P-02 wird
  ersatzweise von einem Claude-Unteragenten umgesetzt und später von Codex geprüft (C-01 bis
  C-03).
- Voraussetzung auf Codex-Seite: ChatGPT Plus oder höher; zusätzliche Credits nur mit
  Freigabe des Inhabers.

## Quellen (abgerufen 26.09.2026)

- Codex-Plugin für Claude Code: https://github.com/openai/codex-plugin-cc
- Fehler in verknüpften Worktrees: https://github.com/openai/codex-plugin-cc/issues/765
- Entfernung von `codex mcp-server`: https://github.com/openai/codex/releases/tag/rust-v0.154.0, https://learn.chatgpt.com/docs/mcp-server.md
- Codex Cloud: https://learn.chatgpt.com/docs/cloud
- Codex und GitHub: https://learn.chatgpt.com/docs/third-party/github
- Preise und Pläne: https://learn.chatgpt.com/docs/pricing
