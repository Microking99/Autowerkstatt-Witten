# ADR-006: Versionierte Freigaben mit Inhalts-Hash

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** R-FRG-1 bis R-FRG-6, R-ANN-3, R-MECH-3, AGENTS.md Regeln 4 und 5

## Kontext

Eine Kundenfreigabe muss sich nachweisbar auf genau den Umfang und Preis beziehen, den der
Kunde gesehen hat. Änderungen nach dem Senden dürfen alte Entscheidungen nicht
weiterverwenden. Ein "Ja" im Chat, eine Freigabe durch Mitarbeiter oder eine offline
erfasste Zusage sind keine Freigabe.

## Entscheidung

- Eine **Freigabeanfrage** (`approval_requests`) bündelt zusammengehörige Positionen
  (Angebot oder Zusatzarbeit). Ihr Inhalt liegt in **unveränderlichen Versionen**
  (`approval_versions`).
- Beim Senden wird die Version eingefroren: Kundentext, Positionen (Titel, Beschreibung,
  Menge, Einheit, Einzelpreis, USt), Summen, Währung, Terminänderung, neuer Fertigstellungstermin,
  Foto-IDs, Dokumentversion. Daraus wird ein **kanonischer Inhalt** (feste Feldreihenfolge,
  Beträge in Cent) gebildet und mit **SHA-256** gehasht (`content_hash`, 64 Hex-Zeichen).
  Die genaue Kanonisierung legt `packages/domain` fest und sichert sie mit Tests.
- Die Kundenentscheidung (`POST /approvals/:id/decision`) enthält `versionId` und
  `contentHash`. Die API akzeptiert sie nur, wenn
  1. das angemeldete Konto das Kundenkonto des Auftragskunden ist,
  2. die Version die aktuelle, gesendete, nicht ersetzte Version ist,
  3. der Hash dem gespeicherten Hash entspricht.
  Sonst `409` mit Hinweis "Das Angebot wurde geändert" bzw. `404` für fremde Anfragen.
- **Genau eine Entscheidung je Version** (`approval_decisions.version_id` eindeutig).
  Gespeichert werden Person, Kunde, Zeitpunkt, Hash, Kanal, Kommentar, IP, User-Agent und ein
  Audit-Eintrag (R-FRG-4).
- **Änderung = neue Version.** Die alte Version wird `superseded`, betroffene Positionen gehen
  auf `pending_approval`, eine vorherige Entscheidung gilt nicht für die neue Version.
- **Ganze Version:** Eine Version wird als Ganzes freigegeben oder abgelehnt. Positionen, die
  der Kunde getrennt entscheiden können soll, werden als getrennte Anfragen gesendet. So bleiben
  separat freigegebene Arbeiten bei einer Ablehnung unberührt (R-FRG-5).
- **Ablehnung:** Positionen erhalten `rejected`, sind für die Ausführung gesperrt und erzeugen
  nie einen Serviceeintrag.
- Mechaniker melden nur Feststellungen; das Recht, Freigaben anzufragen, hat der Service.
  Ein Recht, im Namen des Kunden zu entscheiden, existiert nicht (telefonische Freigabe: O-3,
  Standard nicht erlaubt).
- Die bei der **Fahrzeugannahme** vereinbarten Leistungen erhalten `agreed`; die Bestätigung der
  Annahme hat einen eigenen Hash (`intakes.content_hash`) und deckt nie spätere Zusatzarbeiten
  (R-ANN-3).

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| Freigabe als Statusfeld an der Position | Kein Nachweis, welcher Umfang und Preis freigegeben wurde; Änderungen überschreiben still. |
| Freigabe per Chat-Nachricht oder E-Mail-Antwort | Nicht eindeutig einer Version zuordenbar (R-FRG-3). |
| Teilfreigabe einzelner Positionen innerhalb einer Version | Erhöht die Komplexität der Hash-Bindung; getrennte Anfragen erreichen dasselbe nachvollziehbarer. |
| Digitale Signatur | Für den Zweck nicht gefordert; Anmeldung, Hash und Audit-Protokoll bilden den Nachweis. Rechtliche Bewertung außerhalb dieser Entscheidung. |

## Folgen

- Kundenoberfläche zeigt immer die Versionsnummer und lädt bei `409` die neue Version
  (`docs/ablaeufe.md`, Klickwege A und B).
- Offen für P-02 und Review C-01: Umgang mit einer Änderung, wenn eine betroffene Position
  bereits begonnen oder erledigt ist (Vorschlag: Änderung dann nur als neue, zusätzliche
  Anfrage).
- Freigaben sind nur online möglich (ADR-011).
- Tests T-04, T-05 (`docs/tests.md`).
