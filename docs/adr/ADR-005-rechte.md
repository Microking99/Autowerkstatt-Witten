# ADR-005: Rechte und Objektregeln

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** R-ROLLE-1 bis R-ROLLE-6, R-ARCH-4, R-FZG-4, R-QR-3

## Kontext

Die Rechte müssen für Routen, direkte Links, Dateidownloads, Schnittstellen und
Echtzeitkanäle gleich gelten (R-ROLLE-5). Service-Mitarbeiter erhalten individuell
angepasste Rechte (R-ROLLE-2). Kunden dürfen fremde Akten nicht einmal als "vorhanden"
erkennen können.

## Entscheidung

- **Rollen + Rechte + Objektregeln** wie in `docs/rollen-und-rechte.md`. Rollen haben
  Standardrechte; der Admin gewährt oder entzieht einzelne Rechte je Mitarbeiter
  (`user_permission_overrides`). Kunden haben keine einstellbaren Rechte, nur Objektregeln.
- **Umsetzung in `packages/domain/src/permissions`:** Rechtekatalog, Rollenstandards,
  `effectivePermissions(user)`, `can(actor, action, resource)` als reine Funktionen mit
  Unit-Tests. Objektregeln erhalten die nötigen Beziehungen (z. B. Zuweisung, aktueller Halter,
  Auftragskunde) als Eingabe.
- **Durchsetzung in jeder API-Route** vor dem Laden oder Ändern. Listen werden in der
  Datenbankabfrage mit denselben Regeln gefiltert. Dateidownloads, Deep-Link-Ziele und
  WebSocket-Abonnements nutzen dieselben Prüfungen.
- **404 statt 403 für Kunden:** Nicht vorhandene und nicht erlaubte Objekte liefern
  gleichermaßen `404`. Mitarbeiter erhalten bei fehlendem Recht `403`, damit die Oberfläche
  "Keine Berechtigung" erklären kann.
- **Feldfilter je Rolle:** Mechaniker erhalten keine Preise, Rechnungen, Zahlungen und keine
  Kontaktdaten; Kunden keine internen Notizen und internen Dokumente. Die DTOs in
  `packages/contracts/src/dto.ts` markieren diese Felder als optional.
- **Unverrückbar:** Niemand außer dem Kundenkonto des Auftragskunden kann eine Freigabe
  entscheiden; der letzte aktive Admin kann nicht deaktiviert werden; Deaktivierung beendet
  alle Sitzungen.

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| Nur Rollen ohne Einzelrechte | Widerspricht R-ROLLE-2 ("entsprechend den zugewiesenen Berechtigungen"). |
| Row Level Security in PostgreSQL als Hauptschutz | Regeln wären in SQL-Richtlinien verteilt, schwerer zu testen und zu reviewen; kann später als zweite Schicht ergänzt werden (ADR-002). |
| Prüfung im Client | Keine Sicherheit (AGENTS.md Regel 1). |
| 403 auch für Kunden | Würde verraten, dass eine Auftrags- oder Rechnungs-ID existiert. |

## Folgen

- Jede neue Route braucht einen Rechtetest (erlaubt, verboten, fremdes Objekt); Pflicht im
  Review (C-01).
- Die Oberfläche blendet nur aus, was die API ohnehin verweigert.
- Tests T-02, T-03, T-09, T-10 (`docs/tests.md`).
