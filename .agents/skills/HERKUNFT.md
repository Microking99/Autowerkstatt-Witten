# Herkunft der eingebundenen Skills

Diese Skills sind bewusst als feste Kopie im Repository abgelegt ("vendored"), damit
Claude Code (lokal und in Cloud-Sitzungen) und Codex dieselbe, geprüfte Fassung nutzen.
Die gleiche Kopie liegt für Codex unter `.agents/skills/`.

| Skill | Quelle | Stand | Lizenz | Änderungen |
|---|---|---|---|---|
| `ui-ux-pro-max` | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | Tag `v2.15.0`, Commit `a38d04c3d5c298c851dbe5e6ee1965ee3de42cb5` | MIT | Skriptpfad in `SKILL.md`: `${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/` ersetzt durch `${CLAUDE_SKILL_DIR}/` (Claude) bzw. `.agents/skills/ui-ux-pro-max/` (Codex). Sonst unverändert. |
| `design-taste-frontend` (Taste Skill) | https://github.com/Leonxlnx/taste-skill, Datei `skills/taste-skill/SKILL.md` | Commit `ce26fc25c0e5e8cab638f883de62d9a86ee5e45b` (SHA-256 der Datei: `aa194351b246b8b4799099d4ed7b033d29eab6e6e3d58d8d2172978be7b3ec89`) | MIT | unverändert |

## Prüfung vor der Übernahme

- `ui-ux-pro-max`: Die Skripte (`scripts/*.py`) verwenden nur die Python-Standardbibliothek und
  durchsuchen lokale CSV-Dateien. Es gibt keinen Netzwerkzugriff und keine Installationsroutine.
  Aufruf immer mit `python3 -B` (verhindert `__pycache__`-Dateien im Skill-Ordner).
- `design-taste-frontend`: reine Anweisungsdatei ohne Skripte.
- Die übrigen zwölf Skills des Taste-Repositorys wurden **nicht** übernommen, weil sie
  Eingangs- oder Dauer-Animationen verlangen und damit dem Ziel "ruhige Arbeitssoftware"
  widersprechen.
- Es wurde kein Installationsskript (`npx skills`, `uipro init`, `/plugin install`) ausgeführt.

## Verhältnis der Skills zueinander

Maßgeblich für dieses Projekt ist `docs/designsystem.md`. Dort ist festgehalten, welche Regeln
aus beiden Skills gelten, welche bewusst nicht gelten (z. B. Landingpage-Regeln des
Taste-Skills auf Arbeitsansichten) und wie Konflikte aufgelöst werden. Der Taste-Skill
schließt Dashboards, Datentabellen, Formulare und native Mobile-Oberflächen selbst aus
(Abschnitt 13); er dient hier als Prüffilter gegen austauschbare "KI-Optik" und für die
öffentlichen Kundenseiten.

## Aktualisieren

Nur aus den oben genannten Original-Repositories, auf einen konkreten Commit gepinnt, mit
Prüfung der Skripte und Eintrag in dieser Tabelle. Danach die Kopie unter `.agents/skills/`
synchron halten.
