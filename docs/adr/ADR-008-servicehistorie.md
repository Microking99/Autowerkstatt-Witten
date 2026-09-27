# ADR-008: Servicehistorie aus fachlichem Abschluss

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** R-SERV-1 bis R-SERV-9, R-FZG-4, R-QR-1 bis R-QR-4, AGENTS.md Regeln 3, 5, 8, 9

## Kontext

Die Servicehistorie ist das digitale Serviceheft eines Fahrzeugs. Sie darf nur echte,
abgeschlossene Wartungsarbeit enthalten, nie Angebote, Freigaben, Rechnungen oder Zahlungen,
keine abgelehnten Arbeiten und keine Duplikate. Korrekturen müssen nachvollziehbar bleiben.
Bei einem Halterwechsel geht das Serviceheft mit dem Fahrzeug, private Unterlagen bleiben bei
der Person.

## Entscheidung

- **Einziger Auslöser** ist der Übergang des Auftrags auf `completed` über
  `POST /work-orders/:id/complete-review` (Recht `workOrders.completeReview`). Andere
  Ereignisse (Freigabe, Rechnung, Zahlung, Abholung, einzelne erledigte Position) erzeugen
  keinen Eintrag.
- **Ableitung** in `packages/domain`: je Position mit `execution_status = done`,
  `authorization ∈ {agreed, approved}` und gesetzter Wartungsart (`maintenance_type_id`)
  entsteht ein Eintrag mit Datum, km-Stand (aus der Position bzw. dem Abschluss; unbekannt =
  `null`), Arbeit, Details, Werkstatt, Auftragsbezug, Intervall und nächster Fälligkeit.
- **Genau einmal:** partieller Unique-Index `(work_item_id) WHERE revision_of_id IS NULL`;
  das Einfügen in derselben Transaktion wie der Statuswechsel ignoriert bestehende Einträge.
  Wiederholte Abschlussaufrufe erzeugen keine Duplikate.
- **Fälligkeit:** kombinierte Intervalle, die zuerst erreichte Grenze ist maßgeblich. Ohne
  aktuellen km-Stand keine vorgetäuschte km-Fälligkeit; Schätzungen sind als solche
  gekennzeichnet (`basis = km_estimated`).
- **Revisionen statt Überschreiben:** Korrektur (`serviceHistory.correct`, Begründung Pflicht)
  erzeugt eine neue Zeile mit `revision_of_id` und höherer `revision_no`; die alte wird
  `superseded`. Stornierung eines Eintrags ist eine Revision mit Status `voided`. Audit-Eintrag
  bei Anlage und Korrektur.
- **Sichtbarkeit nach Halterwechsel:** Der technische Teil (Datum, km, Arbeit, Details,
  nächste Fälligkeit, Werkstatt) gehört zum Fahrzeug und ist für den aktuellen Halter sichtbar.
  Der Auftragsbezug zu Aufträgen des Vorbesitzers wird ausgeblendet (`workOrderId = null`);
  Preise, Dokumente, Nachrichten, Freigaben und Rechnungen bleiben beim Vorbesitzer.
  **Bestätigung durch den Inhaber: O-4.**
- **QR und Dritte:** Der QR-Code zeigt ohne Anmeldung nur einen Hinweis, außer der Halter hat
  die öffentliche Kurzansicht eingeschaltet (O-18, Standard aus). Kaufinteressenten sehen nur
  ausgewählte Einträge über eine befristete, widerrufbare Freigabe (`vehicle_shares`).
- **Keine Herstelleranbindung** wird behauptet (R-SERV-9).

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| Eintrag beim Erledigen jeder einzelnen Position | Arbeit ist dann noch nicht fachlich geprüft (R-SERV-1). |
| Eintrag bei Rechnung oder Zahlung | Ausdrücklich ausgeschlossen (R-SERV-5, R-SERV-7). |
| Korrektur durch Überschreiben | Nicht nachvollziehbar (R-SERV-8). |
| Servicehistorie nach Halterwechsel ganz ausblenden | Widerspricht dem Zweck eines Fahrzeug-Servicehefts; Entscheidung O-4 kann das ändern. |

## Folgen

- Positionen ohne Wartungsart (z. B. Reparaturen) erscheinen nicht in der Servicehistorie.
  Welche Arbeiten als Wartung gelten, steuert die Liste der Wartungsarten
  (`/werkstatt/einstellungen`).
- Ein Abschluss ohne km-Stand ist möglich; der Eintrag trägt dann `odometer_km = null` und keine
  km-Fälligkeit.
- Tests T-08, T-09, T-10 (`docs/tests.md`); unabhängiges Review C-03.
