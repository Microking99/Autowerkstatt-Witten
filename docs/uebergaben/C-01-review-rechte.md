# Übergabe C-01: Unabhängiges Review Rechte und Objektregeln

| Feld | Wert |
|---|---|
| ID | C-01 |
| Art | Review (nur lesend, Befunde als Bericht bzw. PR-Kommentare; Korrekturvorschläge als eigener Branch) |
| Erstellt von, am | Claude Code (Unteragent Dokumentation), 26.09.2026 |
| Ausführend | Codex (Cloud oder lokal über `/codex:adversarial-review`) |
| Branch | Review auf dem Integrationszweig nach Zusammenführung von P-02 und P-03; Korrekturen auf `codex/review-rechte` |
| Prüfer | Claude Code |
| Status | blockiert (Codex nicht eingerichtet). Stand 27.09.2026: P-02 und P-03 sind zusammengeführt, der Code ist prüfbar. Ein Claude-Ersatz-Review mit Angriffstests liegt vor (`docs/uebergaben/2026-09-27-review-claude.md`, Tests `apps/api/test/review-*.test.ts`); es ersetzt dieses unabhängige Review nicht. Codex soll zusätzlich prüfen, ob diese Tests die Szenarien unten wirklich abdecken. |

## 1. Aufgabe

Unabhängig prüfen, ob Rollen, Rechte und Objektregeln aus `docs/rollen-und-rechte.md` in
`packages/domain` korrekt modelliert und in `apps/api` **in jeder Route, jedem Dateidownload,
jedem Deep-Link-Ziel und jeder WebSocket-Verbindung** serverseitig durchgesetzt sind. Fehlende
Tests für die Angriffsszenarien unten ergänzen (auf eigenem Branch). Nicht Teil: Oberflächen,
Zahlungslogik (C-02), Servicehistorie (C-03) außer deren Sichtbarkeit.

## 2. Kontext und Links

- Anforderungen: R-ROLLE-1 bis R-ROLLE-6, R-FZG-4, R-QR-2, R-QR-3, R-ARCH-3, R-ARCH-4, R-ARCH-5
- Regeln: `AGENTS.md` Abschnitt 4 (Regeln 1 bis 4, 9) und "Code Review Rules"
- `docs/rollen-und-rechte.md`, `docs/datenmodell.md`, `docs/ansichten-und-routen.md`
- ADR-004 (Anmeldung), ADR-005 (Rechte), ADR-009 (Dateien), ADR-012 (Echtzeit)
- Vertrag: `packages/contracts/src/api.ts` (Liste der öffentlichen Endpunkte ist per Test
  festgeschrieben), `packages/contracts/src/routes.ts` (`safeNextPath`)

## 3. Betroffene Dateien und Zuständigkeit

| Pfad | Zuständig | Darf geändert werden? |
|---|---|---|
| `packages/domain/src/permissions/**` (entsteht in P-02) | P-02 | Tests ergänzen ja; Logik nur als Vorschlag im eigenen Branch |
| `apps/api/src/**` Routen, Anmeldung, Sitzungen, Datei-Downloads, WebSocket (entsteht in P-03; genaue Pfade beim Start prüfen) | P-03 | wie oben |
| `apps/api/src/db/schema/**`, `apps/api/drizzle/**` (entsteht in P-03) | P-03 | nein, nur Befund |
| `apps/api/test/**` bzw. `*.test.ts` in `apps/api` (entsteht in P-03) | P-03 | Tests ergänzen ja |
| `packages/contracts/**` | Koordination | nein, nur Befund |

## 4. Schnittstellen

- `can(actor, action, resource)` und Rollenstandards in `packages/domain/src/permissions`
  (Signatur wird in P-02 festgelegt).
- Rechtekatalog `PERMISSIONS` in `packages/contracts/src/enums.ts`.
- Kunden erhalten für fremde und nicht vorhandene Objekte `404`, Mitarbeiter bei fehlendem
  Recht `403` (ADR-005).

## 5. Angriffs- und Fehlerszenarien (mindestens prüfen)

| Nr. | Szenario | Erwartung |
|---|---|---|
| R1 | Kunde A ruft Auftrag, Rechnung, Dokument, Foto, Freigabe, Termin oder Nachricht von Kunde B per ID auf (REST und Deep Link) | `404`, keine Daten, keine Existenzpreisgabe; gleiche Antwortzeit-Größenordnung wie bei nicht vorhandener ID |
| R2 | Kunde listet `/vehicles`, `/work-orders`, `/invoices`, `/documents` mit fremden Filtern (`?customerId=`) | Filter wird ignoriert bzw. auf eigenen Kunden erzwungen |
| R3 | Vorbesitzer nach Halterwechsel: Fahrzeug, Servicehistorie, neue Aufträge des neuen Halters | kein Zugriff; eigene alte Aufträge, Rechnungen, Dokumente, Nachrichten weiter sichtbar |
| R4 | Neuer Halter: Aufträge, Dokumente, Preise, Nachrichten, Freigaben, Rechnungen des Vorbesitzers; Serviceeintrag aus Vorbesitzer-Auftrag | kein Zugriff; Serviceeintrag ohne `workOrderId` |
| R5 | Mechaniker öffnet nicht zugewiesenen Auftrag, sieht Preise, Kundenkontakt, Rechnung | `403`/`404` bzw. Felder fehlen |
| R6 | Mechaniker startet Position mit `pending_approval`, `rejected`, `withdrawn` oder eine fremde Position | abgelehnt |
| R7 | Mechaniker, Service oder Admin sendet `POST /approvals/:id/decision` | abgelehnt; es gibt kein Recht dafür |
| R8 | Service ohne `payments.refund`/`payments.recordManual`/`serviceHistory.correct` ruft diese Endpunkte | `403` |
| R9 | Rechteentzug oder Deaktivierung während laufender Sitzung und offener WebSocket-Verbindung | Sitzungen sofort ungültig, Abonnements geschlossen |
| R10 | Letzter aktiver Admin deaktiviert sich oder entzieht sich `users.manage` | abgelehnt |
| R11 | WebSocket: Abonnement eines fremden Auftrags; Token in der URL statt im ersten Frame; Ereignisse enthalten Inhalte | abgelehnt; keine Inhalte in Ereignissen |
| R12 | Datei-Download mit geratener oder fremder ID, interne Datei durch Kunden, Pfadmanipulation im `storage_key` | `404`; kein Zugriff außerhalb des Speichers |
| R13 | Öffentliche Endpunkte: QR ohne Kurzansicht, QR mit Kurzansicht (keine Namen, Kennzeichen, FIN, Preise), abgelaufene/widerrufene Fahrzeugfreigabe, Freigabe zeigt nur ausgewählte Einträge | wie `docs/rollen-und-rechte.md` Abschnitt 4 |
| R14 | Anmeldung: falsches Passwort (keine Auskunft, ob E-Mail existiert), Sperre nach Fehlversuchen, Einladung abgelaufen/benutzt, Reset beendet alle Sitzungen, Tokens nur als Hash gespeichert | wie ADR-004 |
| R15 | Offene Weiterleitung über `weiter`-Parameter | nur interne Pfade |
| R16 | Kunde ohne aktives Konto (eingeladen, gesperrt) | keine Anmeldung, keine Daten |
| R17 | Audit: Rechteänderungen, Deaktivierung, Halterwechsel, Anmeldungen werden protokolliert; `UPDATE`/`DELETE` auf `audit_log` schlägt fehl | Trigger aktiv |
| R18 | Rechte-Overrides: entzogenes Standardrecht wirkt, zusätzlich gewährtes wirkt, in der Tabelle als nicht zuweisbar markierte Rechte lassen sich nicht vergeben | wie Tabelle |

## 6. Abnahmekriterien

- [ ] Für jede Route in `packages/contracts/src/api.ts` ist dokumentiert oder per Test
      belegt, welche Prüfung greift; keine Route ohne Prüfung außer den festgelegten
      öffentlichen.
- [ ] Szenarien R1 bis R18 durch automatisierte Tests abgedeckt (Domain-Unit bzw.
      API-Integration mit Testdatenbank) oder als Befund mit Begründung gemeldet.
- [ ] Befunde mit Schweregrad (P0 Datenleck oder Rechteumgehung, P1 Regelverstoß ohne
      direkte Ausnutzung, P2 Härtung), Datei, Szenario und Vorschlag.
- [ ] Keine echten Personendaten in Tests (nur `[TEST]`/Beispieldaten).
- [ ] `pnpm test` und `pnpm typecheck` grün.

## 7. Tests

| Befehl | Erwartetes Ergebnis |
|---|---|
| `pnpm --filter @werkstatt/domain test` | grün; Tests für Rollenstandards, Overrides, Objektregeln Kunde/Mechaniker/Vorbesitzer/neuer Halter |
| `pnpm --filter @werkstatt/api db:start` | lokale PostgreSQL-Testinstanz läuft |
| `pnpm --filter @werkstatt/api test` | grün; Integrationstests R1 bis R18 |
| `pnpm typecheck` | grün |

(Befehlsnamen für die API entstehen in P-03 und sind vor dem Start zu prüfen.)

## 8. Tatsächliches Ergebnis

Noch nicht durchgeführt.

## 9. Offene Punkte

- Umgang mit "Ändern" einer Freigabeanfrage, wenn Positionen bereits begonnen wurden
  (ADR-006, `docs/ablaeufe.md` 8.4).
- Beim Halterwechsel vorgesehen: Freigaben für Dritte des Vorbesitzers widerrufen,
  QR-Kurzansicht zurücksetzen (`docs/ablaeufe.md` Abschnitt 6). Prüfen, ob umgesetzt.
- O-4 (Sichtbarkeit der Servicehistorie für den neuen Halter) ist noch nicht vom Inhaber
  bestätigt.
