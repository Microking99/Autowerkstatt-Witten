# ADR-011: Offline-Umfang, lokale Speicherung, Synchronisierung

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** R-ARCH-9, R-ARCH-10, R-MECH-2, AGENTS.md Regel 10

## Kontext

In der Werkstatthalle ist die Verbindung nicht immer stabil. Mechaniker sollen trotzdem
dokumentieren können, ohne Daten zu verlieren. Gleichzeitig dürfen offline erfasste Daten nie
als bestätigte Freigabe oder Zahlung gelten, und der Server bleibt maßgeblich für alle
Statusentscheidungen.

## Entscheidung

### Umfang

| Offline möglich | Nur online |
|---|---|
| Mechaniker: Feststellungen anlegen und an den Service melden (Meldung wird übertragen, sobald online) | Kundenfreigaben (Entscheidung) und Freigabeanfragen senden |
| Mechaniker: Fotos aufnehmen und zuordnen | Zahlungen, "Jetzt bezahlen", manuelle Zahlungszuordnung, Erstattungen |
| Mechaniker: Zeiten (Start, Pause), verbaute Teile, Notizen | Fachlicher Abschluss (`complete-review`) und damit Serviceeinträge |
| Mechaniker: Position starten und pausieren | Rechnungen anlegen, stellen, stornieren |
| Alle Rollen: Chat-Entwürfe (Senden erfolgt, sobald online) | Halterwechsel, Benutzer- und Rechteänderungen, Veröffentlichung von Dokumenten |

Das Abschließen einer Position durch den Mechaniker ist offline erfassbar, wird aber erst mit
der Serverantwort wirksam und erzeugt nie selbst einen Serviceeintrag (ADR-008).

### Lokale Speicherung

- iOS/Android: lokale Datenbank auf dem Gerät (SQLite) für die Warteschlange, Entwürfe und
  einen Lesezwischenspeicher der zugewiesenen Aufträge; Fotos als Dateien im App-Speicher bis
  zum erfolgreichen Hochladen. Das Sitzungstoken liegt im sicheren Speicher (ADR-004).
- Browser und Windows-Hülle: nur Entwürfe (z. B. Auftragsentwurf, Chat-Entwurf); keine
  Offline-Warteschlange für Statusänderungen.
- Die konkrete Bibliothek legt P-05 fest. Beim Abmelden werden lokale Daten des Kontos
  gelöscht, nachdem der Benutzer auf nicht übertragene Einträge hingewiesen wurde.

### Synchronisierung

- Jede offline erfasste Aktion erhält eine **Client-UUID** (Feststellungen, Fotos,
  Zeitabschnitte, Nachrichten über `clientMessageId`) bzw. einen **`Idempotency-Key`**
  (Statusaktionen). Die API führt Wiederholungen nicht doppelt aus.
- Die Warteschlange wird in Erfassungsreihenfolge abgearbeitet, sobald eine Verbindung besteht;
  Fotos werden zuerst hochgeladen, danach die Datensätze, die sie referenzieren.
- Nach einer Ablehnung (Konflikt) sendet "Erneut senden" mit neuem `Idempotency-Key`
  (`<Client-UUID>.r<n>`): Die API speichert auch 4xx-Antworten je Schlüssel und würde sonst nur
  die alte Ablehnung wiederholen. Eine Ablehnung bedeutet, dass nichts ausgeführt wurde; bei
  Verbindungsfehlern bleibt der Schlüssel gleich.

### Gerätezeit (Ergänzung API-3, 27.09.2026)

- Start, Pause, Abschluss und "nicht durchgeführt" senden den **Erfassungszeitpunkt auf dem
  Gerät** als `occurredAt` (Vertrag: `StartWorkItemRequestSchema`, `PauseWorkItemRequestSchema`,
  `FinishWorkItemRequestSchema`, `NotDoneWorkItemRequestSchema`). So zählt eine offline
  gestartete Arbeit ab dem Start in der Halle, nicht ab der Übertragung.
- Die API übernimmt den Zeitpunkt nur, wenn er höchstens 5 Minuten nach der Serverzeit und
  höchstens 72 Stunden davor liegt (`OCCURRED_AT_MAX_FUTURE_MS`, `OCCURRED_AT_MAX_PAST_MS`) und
  nicht vor dem letzten erfassten Zeitpunkt der Position (letzter Beginn bzw. letztes Ende eines
  Zeitabschnitts). Sonst 422 `invalid_occurred_at`; geprüft wird nach dem Statusübergang, ein
  unzulässiger Übergang (409) hat Vorrang. Regel: `resolveOccurredAt` in `packages/domain`,
  gleich in API und Demo-Modus.
- Der Zeitpunkt gilt für den Zeitabschnitt (Beginn bzw. Ende), `doneAt` und den km-Stand beim
  Abschluss (`recordedAt`). Weicht er von der Serverzeit ab, steht er als `occurredAt` im
  Audit-Protokoll. Ohne `occurredAt` (bzw. ohne Körper) gilt wie bisher die Serverzeit.
- 422 `invalid_occurred_at` ist in der Warteschlange ein Konflikt. `/mechaniker/sync` zeigt den
  Grund und bietet "Ohne Gerätezeit senden" (neuer Schlüssel, kein `occurredAt`, es gilt der
  Zeitpunkt der Übertragung) oder "Verwerfen".
- Sofort übertragene Aktionen (Verbindung besteht): Lehnt die API nur den Zeitpunkt ab (Geräteuhr
  falsch gestellt), sendet die App einmal ohne Gerätezeit; Erfassung und Übertragung fallen hier
  zusammen. Andere Ablehnungen werden wie bisher direkt angezeigt.
- Die Gerätezeit gilt nur für Arbeitszeiten und Ausführungsstatus, nie für Freigaben oder
  Zahlungen (AGENTS.md Regel 10).
- Anzeige: Laufende Zeit und Teileliste kommen vom Server (`runningSince`, `trackedMinutes`,
  `parts`); lokal ergänzt wird nur, was noch in der Warteschlange steht (gekennzeichnet
  "Nicht übertragen" bzw. "noch nicht übertragen").

### Konflikte

| Art | Regel |
|---|---|
| Angehängte Daten (Feststellungen, Fotos, Zeitabschnitte, Teile, Nachrichten) | Werden zusammengeführt; nichts überschreibt Einträge anderer. |
| Statusfelder (Position starten/pausieren/abschließen) | **Der Server entscheidet** nach den aktuellen Regeln (Zuweisung, Freigabestatus, Auftragsstatus). Abgelehnte Übergänge erscheinen in `/mechaniker/sync` mit Grund (z. B. "Position wurde inzwischen vom Kunden abgelehnt") und Aktion "Verwerfen" bzw. "Erneut versuchen". |
| Rechte entzogen während offline | Server lehnt ab; Einträge bleiben lokal sichtbar, bis der Benutzer sie verwirft. |

### Kennzeichnung

Leiste "Offline. Änderungen werden gespeichert und später übertragen." und Chip
"Nicht synchronisiert" an jedem nicht übertragenen Eintrag (`docs/designsystem.md`).
Nicht übertragene Daten erscheinen für andere Benutzer nicht.

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| Vollständige Offline-Fähigkeit aller Rollen mit Sync-Engine | Hoher Aufwand und Konfliktrisiko bei Freigaben und Zahlungen, die ohnehin nur online zulässig sind. |
| Kein Offline | Datenverlust in der Halle (R-ARCH-9). |
| "Letzter Schreiber gewinnt" für Statusfelder | Könnte abgelehnte Arbeiten ausführbar machen (AGENTS.md Regel 5). |

## Folgen

- Die API muss für alle offline erzeugbaren Objekte vom Client vergebene UUIDs akzeptieren
  (`docs/datenmodell.md`, Konventionen) und `Idempotency-Key` auswerten.
- Test T-12 (Daten nach Neustart erhalten) braucht Gerätetests; ein Browsertest genügt nicht.
