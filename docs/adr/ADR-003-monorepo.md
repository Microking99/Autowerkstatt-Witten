# ADR-003: Monorepo mit pnpm

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** R-PLAT-5, R-ARCH-1

## Kontext

API, App und Windows-Hülle müssen dieselben Schemas, Routen, Statusbezeichnungen und
Geschäftsregeln verwenden. Zwei KI-Agenten (Claude Code, Codex) arbeiten parallel in
abgegrenzten Paketen und brauchen feste Schnittstellen.

## Entscheidung

Ein Repository mit **pnpm-Workspaces** (`pnpm-workspace.yaml`: `apps/*`, `packages/*`),
Node.js 22, pnpm 10, TypeScript überall:

| Paket | Inhalt | Abhängig von |
|---|---|---|
| `packages/contracts` | zod-Schemas, Endpunktliste, Routen, Deep Links, deutsche Bezeichnungen | zod |
| `packages/domain` | reine Geschäftslogik ohne I/O | contracts |
| `packages/design-tokens` | Farben, Typografie, Abstände, Radien | keine |
| `apps/api` | Fastify-Server, Datenbank, Adapter | contracts, domain |
| `apps/app` | Expo-Client | contracts, domain (nur reine Funktionen), design-tokens |
| `apps/desktop` | Tauri-Hülle um den Web-Export | Web-Export von `apps/app` |

Regel: Große Änderungen legen zuerst die Schnittstelle in `packages/contracts` bzw.
`packages/domain` fest, danach wird parallelisiert (CLAUDE.md).

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| Getrennte Repositories je App | Schemas und Regeln müssten kopiert oder als Pakete veröffentlicht werden; Versionsdrift zwischen Client und API. |
| npm- oder Yarn-Workspaces | Möglich; pnpm ist strenger bei Abhängigkeiten und bereits im Lockfile festgelegt (`packageManager: pnpm@10.33.0`). |
| Turborepo/Nx zusätzlich | Für die Projektgröße nicht nötig; `pnpm -r` genügt. |

## Folgen

- `pnpm test` und `pnpm typecheck` laufen über alle Pakete (`package.json` im Root).
- Expo/Metro muss im Monorepo korrekt aufgelöst werden (Aufgabe in P-04).
- Dateizuständigkeiten je Arbeitspaket sind entlang der Paketgrenzen festgelegt
  (`docs/zusammenarbeit.md`).

## Quellen

- pnpm Workspaces: https://pnpm.io/workspaces (nicht Teil der Recherche; allgemeine Produktdoku)
