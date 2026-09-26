@AGENTS.md

# Ergänzungen für Claude Code

- Claude Code ist in diesem Projekt für Gesamtkoordination, Architektur, Informationsstruktur,
  UI/UX und Integration zuständig (siehe `docs/zusammenarbeit.md`).
- Vor UI-Arbeit `docs/designsystem.md` lesen und die Skills nutzen:
  - `ui-ux-pro-max` (Projekt-Skill): Suche mit
    `python3 -B "${CLAUDE_SKILL_DIR}/scripts/search.py" "<anfrage>" --domain ux` bzw.
    `--stack react-native`. Vor Auslieferung von App-Oberflächen die Prüfliste in
    `references/pro-rules.md` durchgehen. `--motion` nicht setzen (hängt GSAP-Animationen an).
  - `design-taste-frontend` (Projekt-Skill): nur als Prüffilter gegen austauschbare
    "KI-Optik" und für öffentliche Kundenseiten; Abschnitt 13 (Out of Scope) beachten.
- Eine ältere `ui-ux-pro-max`-Kopie kann zusätzlich über das claude.ai-Konto geladen werden
  (`anthropic-skills:ui-ux-pro-max`). Maßgeblich ist die Projektkopie (v2.15.0).
- Codex-Aufträge: lokal über das offizielle Plugin `openai/codex-plugin-cc`
  (`/codex:review`, `/codex:adversarial-review`, `/codex:rescue`), in Cloud-Sitzungen über
  Pull Requests und `@codex review`. Keine Codex-Anmeldung in Claude-Umgebungen.
- Große Änderungen in mehreren Paketen: zuerst Schnittstelle in `packages/contracts` bzw.
  `packages/domain` festlegen, dann parallelisieren.
