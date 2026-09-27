# Übergabe C-03: Unabhängiges Review Servicehistorie und Fälligkeiten

| Feld | Wert |
|---|---|
| ID | C-03 |
| Art | Review (nur lesend; Korrekturvorschläge und fehlende Tests auf eigenem Branch) |
| Erstellt von, am | Claude Code (Unteragent Dokumentation), 26.09.2026 |
| Ausführend | Codex |
| Branch | Review auf dem Integrationszweig nach Zusammenführung von P-02 und P-03; Korrekturen auf `codex/review-servicehistorie` |
| Prüfer | Claude Code |
| Status | blockiert (Codex nicht eingerichtet; P-02 und P-03 noch nicht zusammengeführt) |

## 1. Aufgabe

Unabhängig prüfen, dass Serviceeinträge **nur** beim fachlichen Abschluss aus tatsächlich
ausgeführter Wartungsarbeit entstehen, genau einmal, nie aus Angebot, Freigabe, Rechnung oder
Zahlung, dass Korrekturen als Revision gespeichert werden, dass die Sichtbarkeit nach einem
Halterwechsel stimmt und dass Fälligkeiten nach Zeit und km korrekt und ehrlich (Schätzungen
gekennzeichnet) berechnet werden. Fehlende Tests ergänzen. Nicht Teil: Oberflächen.

## 2. Kontext und Links

- Anforderungen: R-SERV-1 bis R-SERV-9, R-QR-1 bis R-QR-4, R-FZG-2, R-FZG-4, R-KAL-1
- ADR-008, `docs/datenmodell.md` Abschnitte 3, 5 und 9, `docs/rollen-und-rechte.md`
  Abschnitte 3 und 4
- `docs/architektur.md` Abschnitt 4.3 (Datenfluss), `docs/ablaeufe.md` 8.3 und 8.5
- DTOs: `ServiceEntrySchema`, `MaintenanceDueSchema`, `PublicServiceEntrySchema` in
  `packages/contracts/src/dto.ts`

## 3. Betroffene Dateien und Zuständigkeit

| Pfad | Zuständig | Darf geändert werden? |
|---|---|---|
| `packages/domain/src/service-history/**`, `packages/domain/src/maintenance/**` (entsteht in P-02; Namen beim Start prüfen) | P-02 | Tests ja; Logik als Vorschlag |
| `apps/api/src/**` Abschluss (`complete-review`), Korrektur, Fälligkeiten, QR und Freigaben für Dritte (entsteht in P-03) | P-03 | wie oben |
| `apps/api/src/db/schema/**` `service_entries`, `vehicle_shares`, `odometer_readings` (entsteht in P-03) | P-03 | nur Befund |

## 4. Schnittstellen

- `POST /work-orders/:id/complete-review`, `POST /service-entries/:id/corrections`,
  `GET /vehicles/:id/service-entries`, `GET /vehicles/:id/maintenance-due`,
  `GET /maintenance-due`, `GET /public/qr/:token`, `GET /public/shares/:token`.
- Partieller Unique-Index `(work_item_id) WHERE revision_of_id IS NULL`.
- `MaintenanceDue.basis`: `date`, `km_recorded`, `km_estimated`, `unknown`;
  `governingLimit`: `date`, `km`, `none`.

## 5. Angriffs- und Fehlerszenarien (mindestens prüfen)

| Nr. | Szenario | Erwartung |
|---|---|---|
| H1 | Freigabe erteilt, Rechnung gestellt, Zahlung bestätigt, Auftrag abgeholt, aber kein fachlicher Abschluss | kein Serviceeintrag |
| H2 | Position `done` ohne Wartungsart | kein Eintrag |
| H3 | Position `rejected`, `withdrawn`, `pending_approval` oder `not_done` beim Abschluss | kein Eintrag |
| H4 | `complete-review` zweimal, gleichzeitig, und nach Wiederholung mit `Idempotency-Key` | genau ein Eintrag je Position |
| H5 | Abschluss ohne Recht `workOrders.completeReview` (z. B. Mechaniker ohne zugewiesenes Recht) | abgelehnt |
| H6 | Korrektur: neue Revision mit Begründung, alte `superseded`; Stornierung als `voided`; direkte Änderung per `PATCH` | Revision; kein Überschreiben möglich; Audit-Eintrag |
| H7 | Korrektur ohne Recht oder ohne Begründung | abgelehnt |
| H8 | Fälligkeit 15.000 km / 12 Monate: km-Grenze zuerst erreicht, Datum zuerst erreicht | maßgebliche Grenze richtig, `governingLimit` gesetzt |
| H9 | Kein aktueller km-Stand | keine km-Fälligkeit als sicher ausgegeben; nur Datum oder `km_estimated` mit Kennzeichnung und Erklärung |
| H10 | Unplausibler km-Stand (niedriger als vorher) | gespeichert und markiert, Fälligkeit nicht verfälscht |
| H11 | Halterwechsel: neuer Halter sieht technische Einträge ohne `workOrderId` des Vorbesitzers; Vorbesitzer sieht Servicehistorie nicht mehr | wie ADR-008 |
| H12 | QR ohne Kurzansicht; mit Kurzansicht nur Felder aus `PublicServiceEntrySchema` | keine Preise, Namen, Kennzeichen, FIN, Auftragsbezug |
| H13 | Fahrzeugfreigabe für Dritte: nur ausgewählte Einträge, Ablauf, Widerruf, Zugriffe gezählt, FIN nur wenn gewählt; Freigabe eines korrigierten Eintrags zeigt gültige Revision | wie beschrieben |
| H14 | Serviceeintrag entsteht aus Angebot oder Freigabeanfrage per direktem API-Aufruf | nicht möglich; es gibt keinen solchen Endpunkt |
| H15 | Abschluss storniert oder Auftrag nachträglich storniert | vorhandene Einträge bleiben, Korrektur nur als Revision (`voided`) |

## 6. Abnahmekriterien

- [ ] H1 bis H15 durch Tests abgedeckt oder als Befund gemeldet.
- [ ] Ableitung und Fälligkeitsberechnung sind reine Funktionen in `packages/domain` mit
      Grenzfällen (Monatsende, Schaltjahr, Intervall nur km, nur Zeit, beides).
- [ ] Einfügen und Statuswechsel in einer Transaktion.
- [ ] Befunde mit Schweregrad, Datei, Szenario, Vorschlag.
- [ ] `pnpm test` und `pnpm typecheck` grün.

## 7. Tests

| Befehl | Erwartetes Ergebnis |
|---|---|
| `pnpm --filter @werkstatt/domain test` | grün; Ableitung, Revisionen, Fälligkeiten |
| `pnpm --filter @werkstatt/api db:start` | Testdatenbank läuft |
| `pnpm --filter @werkstatt/api test` | grün; H1 bis H15 |

(Befehlsnamen für die API entstehen in P-03 und sind vor dem Start zu prüfen.)

## 8. Tatsächliches Ergebnis

Noch nicht durchgeführt.

## 9. Offene Punkte

- O-4: Sichtbarkeit für den neuen Halter ist Standardannahme, nicht bestätigt.
- Wie km-Schätzungen berechnet werden (z. B. aus der bisherigen Fahrleistung), legt P-02 fest;
  im Review auf Verständlichkeit der `explanation` achten.
