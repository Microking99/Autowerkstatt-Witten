# ADR-002: Backend

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** R-ARCH-1 bis R-ARCH-5, R-ROLLE-5, R-ZAHL-5 bis R-ZAHL-7

## Kontext

Rechte mit Objektregeln (Mechaniker nur zugewiesene Aufträge, Kunde nur aktueller
Halterzeitraum, widerrufbare Freigaben für Dritte), versionierte Freigaben, geprüfte
Zahlungen und eine nur anfügbare Servicehistorie müssen an genau einer Stelle verbindlich
entschieden und gut testbar sein. Alle Clients teilen sich die Datenbasis.

## Entscheidung

- Eigener **TypeScript-Server** mit **Fastify** (`apps/api`, Node.js 22) als einzige
  Schreib- und Leseschnittstelle für alle Clients, versioniert unter `/api/v1`.
- **PostgreSQL 16** als einziges System of Record, Schema und Migrationen mit **Drizzle ORM**
  (`apps/api/src/db/schema`, SQL-Migrationen in `apps/api/drizzle/`).
- Geschäftslogik als reine Funktionen in `packages/domain`, von der API aufgerufen.
- Externe Dienste (SumUp, E-Mail, Push, Dateispeicher) nur über Adapter mit
  Test-Implementierung (AGENTS.md Abschnitt 5).
- **Supabase** ist nur als optionaler **verwalteter PostgreSQL-Anbieter** für später
  vorgesehen (Region `eu-central-1` Frankfurt). Supabase Auth, Storage, Realtime und Edge
  Functions werden nicht als tragende Bausteine verwendet.

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| Supabase als vollständiges Backend-as-a-Service (Auth, Storage, Realtime, RLS, Edge Functions) | Schnell, aber komplexe Objektregeln würden zu SQL-Richtlinien, die eigene Datenbanktests brauchen und mit API-Regeln auseinanderlaufen können. Befunde der Recherche: Datenbank-Backups enthalten keine Storage-Dateien, gelöschte Dateien sind nicht wiederherstellbar, Storage kennt keine Versionierung; signierte URLs lassen sich vor Ablauf nicht widerrufen (nur über den Support); Free-Plan pausiert nach einer Woche Inaktivität und hat keine Backups. Das offizielle Supabase-MCP ist ohne Einschränkung kontoweit schreibend (u. a. `execute_sql`, `create_project`, `confirm_cost`); Supabase warnt selbst vor Risiken und empfiehlt Projektbindung und `read_only`. |
| NestJS statt Fastify | Ebenfalls geeignet; Fastify ist schlanker und genügt für einen Mandanten. Kein fachlicher Unterschied für die Regeln. |
| Firebase oder andere BaaS | Gleiche Grundsatzbedenken wie oben, zusätzlich keine relationale Datenbank für Eindeutigkeitsregeln. |

## Folgen

- Mehr eigener Aufwand für Anmeldung (ADR-004), Echtzeit (ADR-012), Dateien (ADR-009) und
  Betrieb (Backups, Hosting, O-5).
- Rechte sind als TypeScript-Funktionen unit-testbar und für ein unabhängiges Review durch
  Codex gut zugänglich (C-01).
- Kein Anbieter-Lock-in: jeder verwaltete PostgreSQL-Dienst und jeder S3-kompatible Speicher
  in der EU ist möglich. Bei späterer Nutzung von Supabase als Datenbank gilt: MCP nur gegen
  ein Entwicklungsprojekt mit `project_ref` und `read_only`, nie gegen Produktion;
  Dateien trotzdem in einem Speicher mit Versionierung.
- Kosten eines Supabase-Tarifs als Anhaltspunkt: Pro ab 25 USD/Monat je Organisation inkl.
  10 USD Rechenguthaben, weitere Projekte ab 10 USD/Monat, Point-in-Time-Recovery zusätzlich
  (Stand 26.09.2026, Entscheidung O-5).

## Quellen (abgerufen 26.09.2026)

- Fastify (npm 5.12.5): https://www.npmjs.com/package/fastify
- Supabase Backups: https://supabase.com/docs/guides/platform/backups
- Supabase signierte URLs: https://supabase.com/docs/guides/storage/serving/downloads
- Supabase S3-Kompatibilität: https://supabase.com/docs/guides/storage/s3/compatibility
- Supabase Regionen: https://supabase.com/docs/guides/platform/regions
- Supabase Preise: https://supabase.com/pricing
- Supabase MCP (Sicherheitshinweise): https://supabase.com/docs/guides/getting-started/mcp
- Supabase-Plugin (MCP ohne `project_ref`/`read_only`): https://github.com/supabase-community/supabase-plugin
