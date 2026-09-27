# Übergabe <ID>: <Kurztitel>

<!--
Vorlage für jede Übergabe zwischen Claude Code und Codex (AGENTS.md Abschnitt 6).
Datei kopieren nach docs/uebergaben/<ID>-<kurz>.md und alle Abschnitte ausfüllen.
Nichts behaupten, was nicht nachweisbar geschehen ist. Keine Geheimnisse, keine echten
Kundendaten.
-->

| Feld | Wert |
|---|---|
| ID | z. B. C-01 |
| Art | Implementierung / Review / Spike |
| Erstellt von, am | z. B. Claude Code, 26.09.2026 |
| Ausführend | z. B. Codex (Cloud) |
| Branch | `codex/<thema>` (Review: nur lesend auf `<zu prüfender Branch>`) |
| Prüfer | z. B. Claude Code |
| Status | geplant / in Arbeit / zur Prüfung / erledigt / blockiert (Grund) |

## 1. Aufgabe

Was ist zu tun, in zwei bis fünf Sätzen. Was ausdrücklich **nicht** dazugehört.

## 2. Kontext und Links

- Anforderungen: `docs/anforderungen.md` (IDs)
- Entscheidungen: `docs/adr/ADR-0xx-...md`
- Weitere Dokumente, Pull Requests, Issues

## 3. Betroffene Dateien und Zuständigkeit

| Pfad | Zuständig | Darf geändert werden? |
|---|---|---|
| `packages/...` | Paket | ja / nein / nur nach Abstimmung |

Pfade, die noch nicht existieren, mit "(entsteht in P-0x)" kennzeichnen.

## 4. Schnittstellen

Welche Typen, Funktionen, Endpunkte oder Tabellen verbindlich sind (z. B. `packages/contracts`,
Funktionssignaturen in `packages/domain`). Änderungen daran nur nach Abstimmung.

## 5. Abnahmekriterien

- [ ] Kriterium 1 (prüfbar formuliert)
- [ ] Kriterium 2
- [ ] Regeln aus AGENTS.md Abschnitt 4, soweit berührt, durch Tests abgesichert
- [ ] `pnpm test` und `pnpm typecheck` grün

## 6. Tests

| Befehl | Erwartetes Ergebnis |
|---|---|
| `pnpm --filter @werkstatt/domain test` | alle Tests grün, neue Tests für ... enthalten |

## 7. Tatsächliches Ergebnis

Wird vom Ausführenden **nach** der Arbeit ausgefüllt:

- Geänderte Dateien:
- Ausgeführte Befehle und tatsächliche Ausgabe (Zusammenfassung, Anzahl Tests):
- Befunde (bei Reviews: Schweregrad P0/P1/P2, Datei und Zeile, Szenario, Vorschlag):
- Nicht erledigt und warum:

## 8. Offene Punkte

Fragen an die Koordination oder den Inhaber, Annahmen, die bestätigt werden müssen.

## 9. Prüfung

Wird vom Prüfer ausgefüllt: Datum, Ergebnis (angenommen / Nacharbeit), Hinweise.
