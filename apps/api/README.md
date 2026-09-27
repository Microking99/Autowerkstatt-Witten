# API-Server `@werkstatt/api`

Backend der Werkstattsoftware "Autowerkstatt Witten" (eine Werkstatt, kein SaaS). Einzige
Stelle, an der Rechte, Freigaben, Zahlungen und Servicehistorie verbindlich entschieden werden.
Die Regeln selbst liegen in `@werkstatt/domain`; die API lädt Daten, ruft die Regeln auf,
speichert in Transaktionen und protokolliert.

- Node 22, TypeScript (ESM), Fastify 5, Validierung mit den zod-Schemas aus `@werkstatt/contracts`
  (`fastify-type-provider-zod`), Antworten werden gegen die Vertrags-Schemas serialisiert.
- PostgreSQL 16 mit Drizzle ORM, Migrationen als SQL unter `drizzle/`.
- Vertrag: `packages/contracts/src/api.ts` (Endpunkte), `dto.ts` (Antworten), `requests.ts` (Eingaben).

## Schnellstart (lokal)

```bash
pnpm install
pnpm --filter @werkstatt/api db:start          # lokaler PostgreSQL-Cluster (Port 54329)
cp apps/api/.env.example apps/api/.env         # Werte anpassen, ADMIN_EMAIL setzen
pnpm --filter @werkstatt/api db:migrate
pnpm --filter @werkstatt/api db:seed --demo    # Grunddaten, Admin-Einladung, [TEST]-Daten
pnpm --filter @werkstatt/api dev               # http://127.0.0.1:3000/api/v1/health
pnpm --filter @werkstatt/api db:stop
```

Den Admin gibt es nicht mit Standardpasswort: `db:seed` erzeugt für `ADMIN_EMAIL` eine
Einladung (7 Tage, einmalig) und gibt Link und Token **einmalig** auf der Konsole aus.
Annahme per App (`/einladung/<token>`) oder direkt:

```bash
curl -X POST http://127.0.0.1:3000/api/v1/auth/invitations/accept \
  -H 'content-type: application/json' -d '{"token":"<token>","password":"<mind. 10 Zeichen>"}'
```

### Lokaler PostgreSQL-Cluster (`scripts/db.sh`)

- `db:start` legt bei Bedarf einen Cluster unter `apps/api/.data/pg` an (`initdb`), startet
  ihn mit `pg_ctl` auf `127.0.0.1:54329` und legt `werkstatt_dev` und `werkstatt_test` an.
- Nur TCP auf localhost, Anmeldung ohne Passwort (`trust`), `fsync=off`: ausschließlich für
  Entwicklung und Tests. Läuft das Skript als root (Container), werden `initdb`/`pg_ctl` als
  Benutzer `postgres` ausgeführt (`PG_RUN_AS` überschreibt das).
- `.data/` ist nicht versioniert.

## Skripte

| Skript | Zweck |
|---|---|
| `dev` | `tsx watch` mit `.env` |
| `build` / `start` | tsup-Build nach `dist/server.js` (Workspace-Pakete werden mitgebündelt) / Start aus `dist` |
| `db:start`, `db:stop`, `db:status` | lokaler Cluster |
| `db:generate` | Migration aus dem Schema erzeugen (`drizzle-kit generate`), SQL unter `drizzle/` committen |
| `db:migrate` | Migrationen anwenden (idempotent) |
| `db:seed [--demo]` | Werkstatt-Einstellungen, 7 Standard-Wartungsarten, Hebebühnen, Admin-Einladung; `--demo` zusätzlich gekennzeichnete Testdaten |
| `test` | Vitest-Integrationstests gegen PostgreSQL |
| `typecheck` | `tsc` |

## Konfiguration

Nur über Umgebungsvariablen, beim Start mit zod geprüft (`src/config.ts`); Vorlage ohne
echte Werte: `.env.example`. Fehlermeldungen nennen nur Variablennamen, nie Werte.

| Variable | Bedeutung |
|---|---|
| `DATABASE_URL` | PostgreSQL (Pflicht) |
| `APP_ORIGINS` | erlaubte Herkünfte für CORS (Browser, Windows-Hülle), kommagetrennt |
| `APP_BASE_URL` | Basis der App-Links (Einladung, Passwort, QR, Freigabelink, Zahlungs-Rückkehrseite) |
| `API_PUBLIC_URL` | öffentliche Adresse der API (Webhook-Ziel für SumUp) |
| `FILE_STORAGE_DIR`, `MAX_UPLOAD_BYTES` | Dateiablage (lokal), Größenlimit (Standard 15 MB) |
| `SESSION_TTL_HOURS`, `LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_LOCK_MINUTES`, `AUTH_RATE_LIMIT_*` | Sitzungen, Sperre, Rate-Limit |
| `PAYMENT_PROVIDER` | `fake` (Entwicklung/Tests, in Produktion abgelehnt) oder `sumup` |
| `SUMUP_API_KEY`, `SUMUP_MERCHANT_CODE`, `SUMUP_API_BASE` | nur für `sumup`, Pflicht |
| `ALLOW_LIVE_PAYMENTS` | Live-Schlüssel (alles außer `sup_sk_test_…`) nur mit `true` (Freigabe des Inhabers) |
| `MAIL_MODE`, `MAIL_LOG_DIR`, `SMTP_*`, `MAIL_FROM` | E-Mail: `log` (nicht versenden, Inhalte nur als Datei in `MAIL_LOG_DIR`) oder `smtp` |
| `PUSH_MODE`, `EXPO_ACCESS_TOKEN` | Push: `log` oder `expo` (Expo Push API) |
| `BACKGROUND_JOBS`, `NOTIFICATION_INTERVAL_SECONDS`, `RECONCILE_INTERVAL_SECONDS` | Hintergrundläufe im Serverprozess |

Logs (pino) enthalten keine Passwörter, Tokens oder Kartendaten: Anfragekörper und Header
werden nicht geloggt, Tokens in öffentlichen Pfaden (`/public/qr/…`, `/public/shares/…`)
werden maskiert, zusätzliche Redaction für `authorization`, `password`, `token`.

## Aufbau

```
src/
  app.ts            Fastify-Instanz ohne Port (Tests: app.inject)
  server.ts         Start, Hintergrundläufe (Zustellung, Zahlungsabgleich, Fälligkeiten)
  config.ts         Umgebungsvariablen (zod)
  db/               Drizzle-Schema (alle Tabellen aus docs/datenmodell.md), Verbindung, Migration
  auth/             Sitzungen (256-Bit-Token, nur SHA-256 gespeichert), Einladungen, Rücksetzen
  lib/              Fehlerformat ApiError, Audit-Helfer, Idempotenz, Hilfen
  storage/          Dateispeicher (Interface + lokal), Signaturprüfung
  notifications/    Outbox, Zustellung mit Backoff, Mail/Push-Adapter
  payments/         PaymentProvider, FakePaymentProvider, SumUpPaymentProvider
  realtime/         Echtzeit-Verteiler (prozessintern)
  services/         Laden für Objektregeln, DTO-Aufbau, Zahlungsabgleich, Fälligkeiten
  routes/           ein Modul je Bereich (Vertrag api.ts)
drizzle/            0000 Erweiterungen (citext), 0001 Schema, 0002 Audit-Trigger
test/               Integrationstests (Vitest) gegen PostgreSQL
```

Grundsätze je Route: Actor laden, Recht prüfen, Objektregel der Geschäftslogik prüfen, erst
dann laden/ändern. Listen werden per SQL gefiltert (Kunden nur eigene, Mechaniker nur
zugewiesene Aufträge). Für Kunden sind nicht erlaubte und nicht vorhandene Objekte gleich
(404), Mitarbeiter erhalten 403 mit Begründung. Schreibende Anfragen dürfen einen
`Idempotency-Key` tragen (je Benutzer + Methode + Pfad gespeichert; Antworten mit Geheimnissen
wie Sitzungstoken oder Freigabelink werden nicht gespeichert).

## Zahlungen

- `POST /invoices/:id/checkout` legt über `planCheckout` (Geschäftslogik) höchstens einen neuen
  gehosteten Checkout an (mit `valid_until` = 60 Minuten), verwendet einen passenden offenen
  wieder und deaktiviert veraltete. Der Rechnungsstatus ändert sich dabei **nicht**.
- `POST /webhooks/sumup` speichert das Ereignis (nur `event_type` und `id`; dedupliziert, Empfangszähler), fragt den
  Checkout beim Anbieter ab, prüft ihn mit `verifyProviderCheckout` (Betrag, Währung, Händler,
  Referenz, Rechnung) und bucht idempotent (Transaktion mit Zeilensperre auf der Rechnung plus
  Unique `(provider, provider_transaction_id)`). Abweichungen werden als `payment.mismatch`
  protokolliert, nicht gebucht. Antwort an den Anbieter nach dem Speichern immer 204.
- Rückkehrseite: `POST /invoices/:id/payment-status/refresh` (gedrosselt); Hintergrundlauf
  `reconcilePendingCheckouts()` prüft offene, fehlgeschlagene und deaktivierte Versuche der
  letzten 7 Tage (ein trotz Deaktivierung bezahlter Versuch wird als Überzahlung gebucht).
- Manuelle Zahlung (`payments.recordManual`) und Erstattung (`payments.refund`, eigene
  Idempotenz über `idempotencyKey`, nie mehr als erstattbar).
- **SumUp ist nur mit dem Fake-Anbieter getestet.** Der echte Adapter
  (`src/payments/sumupProvider.ts`) wurde nie gegen die SumUp-API aufgerufen; ein Test mit
  Sandbox-/Testzugang steht aus (kein Zugang in dieser Umgebung). Annahme im Code:
  Testschlüssel beginnen mit `sup_sk_test_`.

## Tests

```bash
pnpm --filter @werkstatt/api db:start
pnpm --filter @werkstatt/api test        # nutzt TEST_DATABASE_URL, sonst den lokalen Cluster
```

Vor den Tests wird eine Vorlagedatenbank mit allen Migrationen gebaut; jede Testdatei erhält
eine eigene Kopie (`CREATE DATABASE … TEMPLATE`). Externe Dienste laufen über Fake-Anbieter,
Log-Mailer und Log-Push; die Uhr ist steuerbar. Antworten werden gegen die Vertrags-Schemas
geprüft.

| Datei | Inhalt |
|---|---|
| `t01-kunde-mehrere-fahrzeuge.test.ts` | T-01 Kunde mit mehreren Fahrzeugen, Einladung, Auftragsanlage mit Fahrzeugwahl |
| `t02-keine-fremden-daten.test.ts` | T-02 404 für fremde Akten, Aufträge, Dokumente (auch direkter Download interner Dokumente), Fotos, Rechnungen, Freigaben |
| `t03-mitarbeiterrechte.test.ts` | T-03 Mechaniker (nur zugewiesen, keine Preise/Rechnungen), Service ohne `payments.refund` → 403, Override, Admin-Schutz, Deaktivierung; Entwürfe für Kunden unsichtbar; Mechaniker und nicht zugewiesene Positionen |
| `t04-freigabe-ablehnung.test.ts` | T-04 nur der Kunde entscheidet, Ablehnung nur dieser Positionen, gesperrte Ausführung, Audit mit Hash |
| `t05-erneute-freigabe.test.ts` | T-05 neue Version nach Änderung, alter Hash → 409, Benachrichtigung |
| `t06-zahlungen.test.ts` | T-06 bezahlt, fehlgeschlagen/ausstehend/abgelaufen, Mehrfachmeldung (auch parallel), falscher Betrag/Händler, Teilzahlung, Erstattung |
| `t07-rechnung-bleibt-offen.test.ts` | T-07 Checkout und Rückkehrseite ändern keinen Status |
| `t08-servicehistorie.test.ts` | T-08 Einträge nur aus Abschluss, genau einmal, Korrektur als Revision |
| `t09-qr-und-freigabelink.test.ts` | T-09 QR ohne Anmeldung, Kurzansicht, Freigabelink (Hash, Ablauf, Widerruf, Zähler) |
| `t10-besitzerwechsel.test.ts` | T-10 Halterwechsel: technische Historie ja, Privates des Vorbesitzers nein |
| `t11-benachrichtigungslinks.test.ts` | T-11 Zielpfad je Ereignis, Ziel für Empfänger abrufbar, für andere nicht |
| `t12-neustart.test.ts` | T-12 neue App-Instanz gegen dieselbe Datenbank |
| `anmeldung.test.ts` | Fehlermeldung, Sperre, Einladung, Reset, Passwort ändern, Rate-Limit |
| `infrastruktur.test.ts` | Idempotency-Key, Datei-Upload, Audit-Trigger, WebSocket-Abo, Konfiguration, Zustellung mit Backoff, CSV |
| `endpunkte.test.ts` | alle Endpunkte aus `api.ts` registriert; übrige Endpunkte mit Vertragsprüfung |
| `smoke.test.ts` | Grundgerüst |

Nicht getestet: echter SumUp-Aufruf, SMTP-Versand, Expo-Push-Versand (nur Log-Adapter),
S3-Speicher (nicht implementiert), Betrieb mit mehreren API-Instanzen (Echtzeit ist
prozessintern; dafür wäre PostgreSQL LISTEN/NOTIFY nötig).

## Bekannte Lücken

- Teilebedarf (`part_demands`), Arbeitszeiten der Mitarbeiter (`staff_working_hours`),
  Checklisten und die Ergänzungen [E] (Lager, Reifen, Ersatzwagen) haben Tabellen, aber keine
  Endpunkte (nicht im Vertrag). Die Konfliktprüfung berücksichtigt Teilebedarf und
  Arbeitszeiten bereits.
- Dateispeicher nur lokal; S3-kompatible Implementierung folgt hinter demselben Interface.
