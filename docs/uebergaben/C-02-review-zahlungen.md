# Übergabe C-02: Unabhängiges Review Zahlungslogik inkl. SumUp-Abgleich

| Feld | Wert |
|---|---|
| ID | C-02 |
| Art | Review (nur lesend; Korrekturvorschläge und fehlende Tests auf eigenem Branch) |
| Erstellt von, am | Claude Code (Unteragent Dokumentation), 26.09.2026 |
| Ausführend | Codex |
| Branch | Review auf dem Integrationszweig nach Zusammenführung von P-02 und P-03; Korrekturen auf `codex/review-zahlungen` |
| Prüfer | Claude Code |
| Status | blockiert (Codex nicht eingerichtet). Stand 27.09.2026: P-02 und P-03 sind zusammengeführt, der Code ist prüfbar. Ein Claude-Ersatz-Review mit Angriffstests liegt vor (`docs/uebergaben/2026-09-27-review-claude.md`, Tests `apps/api/test/review-*.test.ts`); es ersetzt dieses unabhängige Review nicht. Codex soll zusätzlich prüfen, ob diese Tests die Szenarien unten wirklich abdecken. |

## 1. Aufgabe

Unabhängig prüfen, dass eine Rechnung **nur nach serverseitig geprüfter Anbieterbestätigung**
als bezahlt gilt, dass Webhooks, Abgleich und wiederholte Klicks keine Doppelbuchungen
erzeugen, dass alte Zahlungsversuche deaktiviert werden und dass Erstattungen und manuelle
Zahlungen berechtigt, idempotent und protokolliert sind. Fehlende Tests ergänzen. Nicht Teil:
echte Aufrufe gegen SumUp (es gibt keinen Testzugang), Oberflächen.

## 2. Kontext und Links

- Anforderungen: R-ZAHL-1 bis R-ZAHL-12, R-AUF-5, R-SERV-7
- `docs/zahlungen.md` (maßgeblich, mit SumUp-Quellen), ADR-007
- `docs/ablaeufe.md` Klickweg C und Zustandsdiagramme 8.1, 8.2
- `docs/datenmodell.md` Abschnitt 8 (`invoices`, `checkouts`, `payments`, `refunds`,
  `provider_events`)
- SumUp-OpenAPI: https://github.com/sumup/sumup-ts/blob/main/openapi.json
- SumUp-Webhooks: https://developer.sumup.com/online-payments/webhooks/

## 3. Betroffene Dateien und Zuständigkeit

| Pfad | Zuständig | Darf geändert werden? |
|---|---|---|
| `packages/domain/src/payments/**` (entsteht in P-02; Name beim Start prüfen) | P-02 | Tests ja; Logik als Vorschlag |
| `apps/api/src/**` Zahlungsrouten, SumUp-Adapter und Test-Implementierung, Webhook-Route, Abgleichsjob (entsteht in P-03) | P-03 | wie oben |
| `apps/api/src/db/schema/**` Zahlungs-Tabellen und Eindeutigkeiten (entsteht in P-03) | P-03 | nur Befund |

## 4. Schnittstellen

- Endpunkte: `startCheckout`, `refreshPaymentStatus`, `recordManualPayment`, `refundPayment`,
  `sumupWebhook`, `getInvoice` in `packages/contracts/src/api.ts`.
- `StartCheckoutResponse.invoicePaymentStatus` bleibt unverändert.
- Zahlungsstatus wird berechnet (`PAYMENT_STATUSES`), nie gespeichert.
- SumUp nur über den Adapter; Tests verwenden die Test-Implementierung.

## 5. Angriffs- und Fehlerszenarien (mindestens prüfen)

| Nr. | Szenario | Erwartung |
|---|---|---|
| Z1 | Klick auf "Jetzt bezahlen", danach nichts | Rechnung bleibt `open` |
| Z2 | Aufruf von `/zahlung/rueckkehr` bzw. `refreshPaymentStatus`, Anbieter meldet `PENDING` | bleibt `open` |
| Z3 | Gefälschter Webhook mit beliebiger `id` oder mit Zusatzfeldern `status: PAID`, `amount` | Inhalt wird ignoriert; nur Abfrage beim Anbieter zählt; unbekannte ID ohne Wirkung |
| Z4 | Derselbe Webhook zehnmal, gleichzeitig und nacheinander; Webhook und Abgleichsjob gleichzeitig | genau eine Zahlung |
| Z5 | Anbieter meldet `PAID` mit abweichendem Betrag, anderer Währung, anderem Händlercode oder fremder Referenz | keine Buchung, Abgleichsfall |
| Z6 | Zwei offene Versuche für dieselbe Rechnung; neuer Versuch deaktiviert den alten; alter wird trotzdem bezahlt | Überzahlung wird gebucht und angezeigt, nicht verschluckt |
| Z7 | `FAILED` gefolgt von `PAID` im selben Versuch | Buchung erlaubt |
| Z8 | Zeitüberschreitung beim Anlegen des Checkouts, Wiederholung mit demselben `Idempotency-Key` bzw. `409 DUPLICATED_CHECKOUT` | kein zweiter Versuch; Wiederfinden über Referenz |
| Z9 | Rechnung storniert, während ein Versuch offen ist | Versuch wird deaktiviert; spätere Zahlung als Überzahlung behandelt |
| Z10 | Erstattung doppelt ausgelöst (Doppelklick, Wiederholung nach Zeitüberschreitung) | eigener Idempotenzschlüssel verhindert zweite Erstattung; Status nach erneutem Lesen |
| Z11 | Erstattung über den erstattbaren Betrag, Erstattung ohne Recht | abgelehnt |
| Z12 | Manuelle Zahlung ohne Recht, ohne Referenztext, mit negativem Betrag | abgelehnt; mit Recht: Audit-Eintrag mit Person und Zeitpunkt |
| Z13 | Kunde startet Checkout für fremde Rechnung oder Entwurf | `404` |
| Z14 | Teilzahlung manuell, danach Online-Zahlung | Online-Betrag = offener Rest; Status `partially_paid` → `paid` |
| Z15 | Webhook-Endpunkt unter Last | Rate-Limit greift; keine personenbezogenen Daten im Log |
| Z16 | Kartendaten oder vollständige Anbieterantworten mit Kartendetails in Logs, `provider_events.payload` oder Tests | nicht vorhanden bzw. auf nötige Felder reduziert |
| Z17 | Zahlung verändert Arbeitsstatus oder erzeugt Serviceeintrag | nein (R-SERV-7) |
| Z18 | Offline-Warteschlange enthält Zahlungsaktion | nicht möglich (ADR-011) |

## 6. Abnahmekriterien

- [ ] Z1 bis Z18 durch Tests abgedeckt (Domain-Unit für Prüfregeln und Statusberechnung,
      API-Integration mit Test-Implementierung des SumUp-Adapters) oder als Befund gemeldet.
- [ ] Eindeutigkeiten in der Datenbank vorhanden: `payments (provider,
      provider_transaction_id)`, `checkouts.checkout_reference`,
      `checkouts.provider_checkout_id`, `refunds.idempotency_key`,
      `provider_events.dedupe_key`.
- [ ] Buchung und Statusänderung in einer Transaktion; parallele Verarbeitung getestet.
- [ ] Adapter hält sich an die OpenAPI (keine abschließenden Schrägstriche in URLs).
- [ ] Befunde mit Schweregrad, Datei, Szenario, Vorschlag.
- [ ] `pnpm test` und `pnpm typecheck` grün.

## 7. Tests

| Befehl | Erwartetes Ergebnis |
|---|---|
| `pnpm --filter @werkstatt/domain test` | grün; Prüfregeln (Betrag, Währung, Händler, Referenz, Status) und Zahlungsstatusberechnung |
| `pnpm --filter @werkstatt/api db:start` | Testdatenbank läuft |
| `pnpm --filter @werkstatt/api test` | grün; Szenarien Z1 bis Z18 mit Test-Adapter |

(Befehlsnamen für die API entstehen in P-03 und sind vor dem Start zu prüfen.)

## 8. Tatsächliches Ergebnis

Noch nicht durchgeführt.

## 9. Offene Punkte

- Ob zusätzlich die Transaktions-Endpunkte als maßgebliche Bestätigung abgefragt werden
  sollen, klärt der Test mit Sandbox-Zugang (`docs/zahlungen.md` 2.4, 12).
- Erstattung mit API-Schlüssel laut OpenAPI erlaubt, laut Anleitung nicht: mit Testzugang
  klären.
- Kein Test gegen die echte SumUp-API möglich, bis O-2 entschieden und ein Sandbox-Schlüssel
  als Umgebungsgeheimnis hinterlegt ist.
