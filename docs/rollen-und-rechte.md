# Rollen und Rechte

Verbindlich für API (`apps/api`), Geschäftslogik (`packages/domain/src/permissions`) und
Oberfläche. Die Oberfläche blendet nur aus, was die API ohnehin verweigert; maßgeblich ist
immer die serverseitige Prüfung (R-ROLLE-5).

## 1. Grundbegriffe

- **Benutzerkonto** (`users`): Anmeldung mit E-Mail + Passwort. Status: `invited`, `active`,
  `disabled`. Ein Konto hat genau eine Rolle.
- **Rolle**: `admin` (Inhaber), `service` (Sekretariat/Service), `mechanic` (Mechaniker/
  Werkstattmitarbeiter), `customer` (Kunde).
- **Recht** (Permission): feingranularer Schlüssel, z. B. `invoices.write`. Rollen haben
  Standardrechte; für Mitarbeiter kann der Admin einzelne Rechte zusätzlich gewähren oder
  entziehen (R-ROLLE-2). Kunden haben keine einstellbaren Rechte, nur Objektregeln.
- **Kundendatensatz** (`customers`) existiert unabhängig vom Konto. Ein Kundenkonto ist über
  `customer_accounts` mit genau einem Kundendatensatz verbunden (R-ROLLE-6).
- **Kaufinteressent / Dritter**: hat **kein** Konto. Zugriff nur über eine ausdrückliche,
  befristete und widerrufbare Fahrzeugfreigabe (Link/Token) auf ausgewählte Serviceeinträge.

## 2. Rechte (Schlüssel) und Standardzuordnung

✓ = Standard, ○ = durch Admin zuweisbar, – = nicht zuweisbar (für diese Rolle ausgeschlossen)

| Recht | Bedeutung | admin | service | mechanic |
|---|---|:-:|:-:|:-:|
| `dashboard.view` | Dashboard sehen | ✓ | ✓ | ✓ |
| `customers.read` | alle Kundenakten lesen | ✓ | ✓ | ○ |
| `customers.write` | Kunden anlegen/ändern/archivieren | ✓ | ✓ | – |
| `customerAccounts.manage` | Kunden zur App einladen, Kundenkonto sperren | ✓ | ✓ | – |
| `vehicles.read` | alle Fahrzeugakten lesen | ✓ | ✓ | ○ |
| `vehicles.write` | Fahrzeuge anlegen/ändern, km erfassen | ✓ | ✓ | – |
| `vehicles.transferOwnership` | Halterwechsel buchen | ✓ | ✓ | – |
| `appointments.read` | alle Termine sehen | ✓ | ✓ | ○ |
| `appointments.write` | Termine anlegen, Anfragen bestätigen/Alternative vorschlagen, absagen | ✓ | ✓ | – |
| `workOrders.read` | alle Aufträge lesen | ✓ | ✓ | ○ |
| `workOrders.write` | Aufträge anlegen/ändern, Positionen und Mitarbeiter planen | ✓ | ✓ | – |
| `workOrders.completeReview` | fachlichen Abschluss prüfen und bestätigen | ✓ | ✓ | ○ |
| `workItems.execute` | zugewiesene Positionen starten/pausieren/abschließen, Zeiten und Teile erfassen | ✓ | ○ | ✓ |
| `intake.write` | Fahrzeugannahme erfassen | ✓ | ✓ | ○ |
| `findings.write` | Feststellungen/Fotos erfassen, Zusatzarbeit an Service melden | ✓ | ✓ | ✓ |
| `approvals.request` | Angebote/Zusatzarbeiten als Freigabeanfrage an Kunden senden, zurückziehen | ✓ | ✓ | – |
| `documents.readInternal` | interne Dokumente lesen | ✓ | ✓ | ○ |
| `documents.write` | Dokumente hochladen, neue Versionen | ✓ | ✓ | – |
| `documents.publish` | Dokument für Kunden veröffentlichen/zurückziehen | ✓ | ✓ | – |
| `messages.customerChat` | Kunden-Chat lesen und schreiben | ✓ | ✓ | ○ |
| `invoices.read` | Rechnungen, offene Posten sehen | ✓ | ✓ | – |
| `invoices.write` | Rechnung anlegen/hochladen, stellen, stornieren | ✓ | ✓ | – |
| `payments.recordManual` | Überweisung/Barzahlung manuell zuordnen | ✓ | ○ | – |
| `payments.refund` | Erstattung auslösen | ✓ | ○ | – |
| `serviceHistory.read` | Servicehistorie aller Fahrzeuge lesen | ✓ | ✓ | ○ |
| `serviceHistory.correct` | Serviceeintrag korrigieren (neue Revision) | ✓ | ○ | – |
| `reports.export` | Exporte (CSV) | ✓ | ✓ | – |
| `users.manage` | Mitarbeiter einladen, Rollen/Rechte ändern, deaktivieren | ✓ | – | – |
| `settings.manage` | Werkstattdaten, Intervalle, Vorlagen, Benachrichtigungen, Zahlungsanbindung | ✓ | – | – |
| `audit.read` | Änderungsprotokoll einsehen | ✓ | ○ | – |

Festlegungen:
- Kein Mitarbeiter und kein Admin kann **im Namen des Kunden** freigeben oder ablehnen
  (R-MECH-3, R-FRG-3). Das Recht dazu existiert für Mitarbeiter nicht. Eine telefonisch
  erteilte Freigabe ist eine offene Produktentscheidung (O-3).
- Der letzte aktive Admin kann nicht deaktiviert werden und `users.manage` nicht verlieren.
- Deaktivierung beendet alle Sitzungen des Kontos sofort.

## 3. Objektregeln

Rechte sagen, **was** jemand tun darf; Objektregeln sagen, **woran**. Beide müssen erfüllt sein.

### Mechaniker
- Sieht Aufträge nur, wenn er dem Auftrag oder einer Position zugewiesen ist (außer mit
  `workOrders.read`).
- Sieht zu diesen Aufträgen: Fahrzeugdaten, Annahme (inkl. interner Hinweise), Positionen,
  Feststellungen, Fotos, Checklisten, bisherige Servicehistorie des Fahrzeugs.
- Sieht keine Preise, Rechnungen, Zahlungen und keine Kontaktdaten des Kunden (nur Anzeigename).
  Den Zahlungsstatus eines Auftrags sieht er nur als Kennzeichen (z. B. "Offen", ohne Beträge),
  damit er weiß, ob ein Fahrzeug herausgegeben werden kann.
- Kann Positionen ausführen, die ihm zugewiesen sind, sowie Positionen ohne Zuweisung in
  Aufträgen, denen er zugewiesen ist; nie Positionen eines anderen Mitarbeiters. Ausführbar
  sind nur Positionen mit Autorisierung `agreed` (bei der Annahme vereinbart) oder `approved`
  (vom Kunden freigegeben), und nur in Aufträgen mit Arbeitsstatus `open` oder `in_progress`.

### Kunde (Konto verknüpft mit Kundendatensatz K)
| Objekt | Sichtbar, wenn … |
|---|---|
| Fahrzeug | aktueller Halterzeitraum des Fahrzeugs gehört zu K (`vehicle_ownerships.ended_at IS NULL`). |
| Auftrag | `work_orders.customer_id = K` (Aufträge gehören dem Kunden, nicht dem Fahrzeug) und Status nicht `draft`. |
| Nachrichten | zu einem Auftrag von K. Interne Notizen nie. |
| Freigabeanfrage | zu einem Auftrag von K, Status nicht `draft`. Entscheiden nur mit aktivem Konto von K. |
| Dokument | `visibility = customer`, veröffentlicht, und `documents.customer_id = K`. Interne Dokumente nie. |
| Rechnung / Zahlung | `invoices.customer_id = K`, Status nicht `draft`. |
| Termin | `appointments.customer_id = K`. |
| Serviceeintrag | Fahrzeug gehört aktuell K (siehe Abschnitt 4). |
| Fahrzeugfreigabe (Link für Dritte) | nur für aktuell eigene Fahrzeuge anlegen/widerrufen. |

Jeder für Kunden sichtbare Datensatz trägt den Kunden, dem er gehört (`customer_id`).
Dadurch bleibt nach einem Halterwechsel alles Private beim Vorbesitzer (R-FZG-4).

### Nach einem Halterwechsel
- Vorbesitzer: verliert den Zugriff auf das Fahrzeug, die Servicehistorie und neue
  Vorgänge; behält Zugriff auf **seine** Aufträge, Rechnungen, Dokumente und Nachrichten.
- Neuer Halter: sieht das Fahrzeug und die **technische** Servicehistorie (Datum, km,
  Arbeit, nächste Fälligkeit, Werkstatt), aber keine Aufträge, Preise, Dokumente,
  Nachrichten, Freigaben oder Rechnungen des Vorbesitzers. Bei Einträgen aus Aufträgen des
  Vorbesitzers wird der Auftragsbezug ausgeblendet.
- Begründung: Das Serviceheft gehört wie das Papier-Serviceheft zum Fahrzeug, private
  Unterlagen gehören der Person. Bestätigung durch den Inhaber: O-4.

## 4. Öffentliche Zugänge ohne Anmeldung

| Zugang | Zeigt | Zeigt nie |
|---|---|---|
| QR-Code `/q/<qrToken>` | Standard: nur Hinweis "Serviceheft der Autowerkstatt Witten" und Anmeldung. Nur wenn der aktuelle Halter die **öffentliche Kurzansicht** eingeschaltet hat: Marke, Modell, Liste der Serviceeinträge (Datum, km, Arbeit, nächste Fälligkeit). | Kundennamen, Kontaktdaten, Kennzeichen, FIN, Preise, Rechnungen, Dokumente, Nachrichten, Aufträge. |
| Fahrzeugfreigabe `/f/<shareToken>` | Nur die vom Halter ausgewählten Serviceeinträge, Marke/Modell, optional FIN (Halter entscheidet). Befristet, widerrufbar, Zugriffe werden gezählt. | Alles andere. |

Angemeldete, berechtigte Personen, die den QR-Code scannen, werden direkt zur vollständigen
Fahrzeugansicht geleitet (nach normaler Rechteprüfung). Tokens sind zufällig (≥ 128 Bit),
in der Datenbank nur als Hash gespeichert (Freigaben) bzw. rotierbar (QR).

## 5. Protokollierte Aktionen (Audit)

Anmeldungen (erfolgreich/fehlgeschlagen), Einladungen, Aktivierungen, Deaktivierungen,
Rollen- und Rechteänderungen, Halterwechsel, Versand/Änderung/Zurückziehen von
Freigabeanfragen, jede Kundenentscheidung, Rechnungsstellung/-storno, jede Zahlungsbuchung,
manuelle Zahlungszuordnung, Erstattung, Anlage und Korrektur von Serviceeinträgen,
Veröffentlichung/Zurückziehen von Dokumenten, Anlage/Widerruf/Abruf von Fahrzeugfreigaben,
Einstellungsänderungen, Exporte. Das Protokoll ist nur anfügbar (keine Änderung, kein Löschen;
per Datenbank-Trigger abgesichert).

## 6. Umsetzung

- `packages/domain/src/permissions`: Rechtekatalog, Rollenstandards, `can(actor, action,
  resource)`-Prüfungen, reine Funktionen mit Unit-Tests.
- `apps/api`: jede Route ruft die Prüfung auf, bevor Daten geladen oder verändert werden;
  Listen werden serverseitig gefiltert (nie clientseitig). Dateidownloads laufen über die API
  mit derselben Prüfung. Nicht vorhandene und nicht erlaubte Objekte liefern für Kunden
  gleichermaßen `404` (keine Existenzpreisgabe).
- Tests T-02, T-03, T-09, T-10 in `docs/tests.md`.
