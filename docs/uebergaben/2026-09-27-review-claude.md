# Übergabe Review-Claude: Sicherheits- und Korrektheitsreview Rechte, Zahlungen, Freigaben, Servicehistorie

> **Hinweis:** Dies ist ein Review durch einen Claude-Unteragenten, kein Codex-Review.
> C-01 bis C-03 bleiben für Codex offen.

| Feld | Wert |
|---|---|
| ID | Review-Claude (Bezug C-01, C-02, C-03) |
| Art | Review (adversarial) mit Tests und Korrekturen |
| Erstellt von, am | Claude Code (Unteragent, eigener Git-Worktree), 27.09.2026 |
| Ausführend | Claude Code (Unteragent) |
| Branch | `worktree-agent-a2564b543f5b5d446` auf Basis `0c0d977` (Integrationsstand), nicht gepusht |
| Prüfer | offen (Lead; unabhängiges Codex-Review C-01 bis C-03 steht weiter aus) |
| Status | zur Prüfung |

## 1. Aufgabe und Umfang

Unabhängiges, adversariales Review von `packages/domain/src/**`, `apps/api/src/**` und
`apps/api/test/**` gegen `AGENTS.md` Abschnitt 4 und "Code Review Rules",
`docs/rollen-und-rechte.md`, `docs/datenmodell.md`, `docs/zahlungen.md` und ADR-006 bis ADR-008.
Grundlage für die Szenarien waren die Prüfaufträge C-01 (Rechte), C-02 (Zahlungen) und C-03
(Servicehistorie). Nicht Teil: Oberflächen (`apps/app` liegt in diesem Stand nicht vor),
echte SumUp-Aufrufe (kein Zugang), Deployment.

## 2. Methode

1. Code gelesen: alle Routen in `apps/api/src/routes/*.ts`, Dienste, Anmeldung, Idempotenz,
   Dateispeicher, Echtzeit, Zahlungsadapter; Domain: Rechte, Objektregeln, Feldfilter,
   Freigaben, Zahlungsprüfung, Servicehistorie, Fälligkeiten, Freigaben für Dritte.
2. Für jeden Verdacht einen Integrationstest geschrieben (Vitest gegen PostgreSQL 16, über die
   API, Fake-Zahlungsanbieter bzw. `fetch`-Attrappe für den SumUp-Adapter). Der Test prüft das
   **Soll**-Verhalten. Ein Befund gilt nur als bestätigt, wenn der Test rot war.
3. Race-Bedingungen mit parallelen Anfragen (`Promise.all`) und, wo nicht deterministisch,
   mehreren Runden je frischer Datenbank.
4. Bestätigte Befunde mit kleiner, eindeutiger Korrektur behoben (Test danach grün, übrige
   Tests grün). Offene Befunde als `it.fails` im Test festgehalten: Der Test ist grün, solange
   der Befund besteht, und wird rot, sobald er behoben ist (dann auf `it` umstellen). Für jeden
   `it.fails`-Test wurde geprüft, dass er aus dem beschriebenen Grund fehlschlägt.
5. Keine Geschäftsregel eigenmächtig geändert; wo die Doku unklar ist, steht die Frage in
   Abschnitt 6.

Umgebung: Der Hauptcheckout betreibt bereits einen Cluster auf Port 54329, und
`test/globalSetup.ts` löscht die gemeinsame Vorlage-Datenbank. Um parallel arbeitende Agenten
nicht zu stören, lief dieses Review gegen einen eigenen Cluster dieses Worktrees:
`LOCAL_PG_PORT=54339 pnpm --filter @werkstatt/api db:start` und
`TEST_DATABASE_URL=postgres://werkstatt@127.0.0.1:54339/werkstatt_test`.

## 3. Testdateien

| Datei | Inhalt |
|---|---|
| `apps/api/test/review-rechte.test.ts` | R01 bis R14 (C-01): IDOR, Listen, Halterwechsel, Mechaniker, Einzelrechte, letzter Admin, Konten, Audit, Datenexport, Weiterleitung, Idempotenz, WebSocket |
| `apps/api/test/review-zahlungen.test.ts` | Z01 bis Z06 (C-02): Webhook, Anbieterprüfung, Beträge, alte Versuche, Storno, Parallelität, manuelle Zahlung, Erstattung, SumUp-Adapter |
| `apps/api/test/review-freigaben.test.ts` | F01 bis F06 (ADR-006): parallele Entscheidungen, Ändern und Entscheiden, Hash/Fassung, Ausführungssperren, Referenzen, Annahme |
| `apps/api/test/review-servicehistorie.test.ts` | H01 bis H07 (C-03): Entstehung, genau einmal, Recht, Korrekturen, Freigaben/QR, Fälligkeiten, Halterwechsel |
| `apps/api/test/review-allgemein.test.ts` | A01 bis A08: SQL, Dateispeicher, Uploads, Massenzuweisung, Idempotenz, Tokens, Audit-Abdeckung, Chat-Anhänge |

## 4. Geprüfte Szenarien

Schweregrad: kritisch / hoch / mittel / niedrig. Zuordnung zu C-01: P0 ≈ kritisch/hoch,
P1 ≈ mittel, P2 ≈ niedrig. Commits: `829b43d` (Tests und erste Korrekturen), `014d174`
(Echtzeit, weitere Tests).

### 4.1 Rechte und Objektregeln (C-01)

| ID | Szenario | Ergebnis | Schweregrad | Test | Behebung |
|---|---|---|---|---|---|
| R01 | Kunde A ruft 22 Lese- und 11 Schreibrouten mit IDs von Kunde B auf (Auftrag, Annahme, Freigabe, Nachrichten, Fotos, interne Notizen, Feststellungen, Verlauf, Dokument-Download, Foto-Inhalt, Rechnung, Checkout, Statusabfrage, Termin, Fahrzeug, km, Historie, Fälligkeit, Freigabelinks, QR-Aufkleber, Kundenakte, Export, Serviceeintrag, Entscheidung, Annahmebestätigung, Terminabsage, km-Erfassung, QR-Kurzansicht, Widerruf) | kein Befund: überall 404 mit gleichem Fehlercode wie bei unbekannter ID, ohne Wirkung | – | review-rechte | – |
| R02 | Kunde listet Aufträge, Fahrzeuge, Rechnungen, Dokumente, Kunden mit fremdem `customerId`/`vehicleId`/`q` | kein Befund | – | review-rechte | – |
| R03a | Terminanfrage mit fremder `vehicleId` | kein Befund (404, kein Termin) | – | review-rechte | – |
| R03b | Fahrzeugfreigabe mit `serviceEntryIds` eines fremden Fahrzeugs | kein Befund (422) | – | review-rechte | – |
| R03c | Rechnung mit `workOrderId` eines anderen Kunden | kein Befund (422) | – | review-rechte | – |
| R04 | Vorbesitzer nach Halterwechsel: Fahrzeug, Historie, km, Fälligkeit, neuer Auftrag, Terminanfrage, QR-Direktzugang; eigener alter Auftrag | kein Befund | – | review-rechte | – |
| R05 | Neuer Halter: km-Historie enthält `workOrderId` von Aufträgen des Vorbesitzers | **Befund bestätigt** | niedrig | review-rechte | behoben `829b43d`: `GET /vehicles/:id/odometer` blendet für Kunden fremde Auftragsbezüge aus (`apps/api/src/routes/vehicles.ts`) |
| R06a | Mechaniker: nicht zugewiesen 403; zugewiesen keine Preis-/Betragsfelder in Auftrag, Annahme, Liste, Verlauf; keine Rechnungen, Freigabeanfragen, Kundenakte, Kontaktdaten | kein Befund | – | review-rechte | – |
| R06b | Mechaniker, Service, Admin entscheiden über Freigabe; zurückgezogene Position starten | kein Befund (403) | – | review-rechte | – |
| R07a | Service ohne `payments.recordManual`/`serviceHistory.correct`; Kunde; Mechaniker | kein Befund (403/404) | – | review-rechte | – |
| R07b | Kunde auf Mitarbeiter-Endpunkten (Auftrag/Rechnung anlegen, Benutzer, Audit, Einstellungen, Exporte, Halterwechsel, QR-Rotation) | kein Befund | – | review-rechte | – |
| R08a | Zwei Admins deaktivieren sich gleichzeitig gegenseitig | **Befund bestätigt** (in 6 von 8 Läufen null Admins) | mittel | review-rechte (3 Runden) | behoben `829b43d`: `countActiveAdmins` sperrt aktive Admin-Zeilen (`FOR UPDATE`, feste Reihenfolge), `apps/api/src/routes/users.ts` |
| R08b | Gleichzeitig Rollenwechsel des einen und Entzug von `users.manage` des anderen Admins | **Befund bestätigt** (null Admins mit `users.manage`) | mittel | review-rechte (3 Runden) | behoben mit R08a |
| R09a | Gesperrtes Kundenkonto (Sitzung, Anmeldung), eingeladenes Konto | kein Befund | – | review-rechte | – |
| R09b | Abgelaufene Sitzung | kein Befund (401) | – | review-rechte | – |
| R09c | Enumeration: nach 5 Fehlversuchen liefert eine bekannte E-Mail 429 (`too_many_attempts`), eine unbekannte weiter 401 | **Befund bestätigt** | niedrig | review-rechte (`it.fails`) | **offen**, siehe 5.1 |
| R10 | Audit für Rechteänderung, Deaktivierung, Halterwechsel, Anmeldung | kein Befund | – | review-rechte | – |
| R11a | Selbstauskunft `/me/export` enthält IP-Adresse, Browserkennung, Anfrage-ID und Benutzer-ID von Mitarbeitern im Aktivitätsprotokoll | **Befund bestätigt** | mittel | review-rechte | behoben `829b43d`: in der Selbstauskunft werden diese Felder fremder Handelnder geleert (`apps/api/src/services/dataExport.ts`) |
| R11b | Selbstauskunft enthält interne Mitarbeitertexte (Zahlungsnotiz, Erstattungsgrund, Konfliktbegründung, Halterwechsel-Notiz, die den Vorbesitzer nennen kann) | **Befund bestätigt** | mittel | review-rechte | behoben `829b43d`: Felder `note`, `reason`, `conflictOverrideReason` nur im vollständigen Export |
| R12 | `safeNextPath('/\t/boese.example')`: Browser entfernen Tab/Zeilenumbruch → `//boese.example` (offene Weiterleitung nach Anmeldung) | **Befund bestätigt** | mittel | review-rechte, `packages/contracts/src/contracts.test.ts` | behoben `829b43d`: Steuerzeichen und Leerraum werden abgelehnt (`packages/contracts/src/routes.ts`) |
| R13 | Gleicher `Idempotency-Key` durch anderen Benutzer | kein Befund (keine fremde Antwort) | – | review-rechte | – |
| R14a | WebSocket: Entwurf abonnieren; Token in der URL statt im ersten Frame | kein Befund | – | review-rechte | – |
| R14b | WebSocket bleibt nach Deaktivierung (Mitarbeiter, Kundenzugang) bis zur nächsten Sitzungsprüfung (bis 60 s) offen und erhält Ereignisse | **Befund bestätigt** | niedrig (Ereignisse ohne Inhalte) | review-rechte | behoben `014d174`: `RealtimeHub.disconnectUser` bei Deaktivierung, Passwort-Reset und Passwortänderung |
| R14c | Abo eines Mechanikers bleibt nach entzogener Zuweisung bestehen (Ereignisse mit IDs/Status kommen weiter an) | **Befund bestätigt** | niedrig | review-rechte (`it.fails`) | **offen**, siehe 5.1 |

### 4.2 Zahlungen (C-02)

| ID | Szenario | Ergebnis | Schweregrad | Test | Behebung |
|---|---|---|---|---|---|
| Z01a | Gefälschter Webhook mit `status: PAID`, `amount`, eigenen `transactions`; ungültige `id`; Nicht-JSON | kein Befund (nur Anbieterabfrage zählt; Nicht-JSON 415) | – | review-zahlungen | – |
| Z01b | Anbieter meldet PAID mit fremder Referenz, anderer Checkout-ID, USD, fremdem Händler in der Transaktion, zwei Transaktionen, ohne Transaktion | kein Befund (keine Buchung, Grund protokolliert) | – | review-zahlungen | – |
| Z01c | Beträge: 19,99 € ↔ 1999 Cent; `0.1 + 0.2` wird abgelehnt | kein Befund | – | review-zahlungen | – |
| Z01d | Webhook speichert den vollständigen, frei wählbaren Anfrageinhalt (z. B. Kartennummern, 64 KB Füllmaterial) in `provider_events.payload` | **Befund bestätigt** | niedrig | review-zahlungen | behoben `829b43d`: nur `event_type` und `id` gespeichert (`apps/api/src/routes/webhooks.ts`) |
| Z02a | `FAILED` und danach `PAID` im selben Versuch, parallel Webhook und Statusabfrage | kein Befund (genau eine Buchung) | – | review-zahlungen | – |
| Z02b | Neuer Versuch nach Teilzahlung deaktiviert den alten; alter wird trotzdem bezahlt | kein Befund (Überzahlung gebucht und sichtbar) | – | review-zahlungen | – |
| Z02c | Storno mit offenem Versuch; spätere Bestätigung | kein Befund (deaktiviert; gebucht; Rechnung bleibt storniert) | – | review-zahlungen | – |
| Z02d | Vier gleichzeitige Klicks auf "Jetzt bezahlen" | kein Befund (ein Versuch beim Anbieter) | – | review-zahlungen | – |
| Z02e | Checkout für bezahlte, fremde, Entwurfsrechnung; Mitarbeiter | kein Befund (409/404/404/403) | – | review-zahlungen | – |
| Z02f | Lokal deaktivierter Versuch wird beim Anbieter bezahlt, Webhook geht verloren: Abgleichslauf und Statusabfrage fragen deaktivierte Versuche nie ab, Geld bleibt ungebucht (widerspricht `docs/zahlungen.md` 2.5) | **Befund bestätigt** | mittel | review-zahlungen | behoben `829b43d`: `reconcilePendingCheckouts` und `payment-status/refresh` prüfen auch `deactivated` |
| Z03a | Manuelle Zahlung über offen, ≤ 0, in der Zukunft, leerer Beleg, `sumup_online`, Entwurf; Audit mit Person, Betrag, Beleg | kein Befund | – | review-zahlungen | – |
| Z03b | Drei gleichzeitige manuelle Zahlungen über den vollen offenen Betrag | kein Befund (eine) | – | review-zahlungen | – |
| Z04 | Drei gleichzeitige Erstattungen mit verschiedenen Schlüsseln (je 60 %); Wiederholung; gleicher Schlüssel, anderer Betrag; über erstattbar; Kunde | kein Befund | – | review-zahlungen | – |
| Z05a | Zahlung ändert Arbeitsstatus oder erzeugt Serviceeintrag | kein Befund | – | review-zahlungen | – |
| Z05b | Geheimnisse in Antworten; Kunde sieht Versuche/Erstattungen | kein Befund | – | review-zahlungen | – |
| Z06a | SumUp-Adapter legt Checkouts **ohne `valid_until`** an; ein vergessener Versuch bleibt unbegrenzt bezahlbar (widerspricht `docs/zahlungen.md` 2.1, ADR-007 Nr. 7) | **Befund bestätigt** | mittel | review-zahlungen (`fetch`-Attrappe) | behoben `829b43d`: Route übergibt 60 Minuten, Adapter setzt Rückfallwert (`provider.ts`, `sumupProvider.ts`, `invoices.ts`) |
| Z06b | Adapter: abschließende Schrägstriche, Pfadcodierung der Checkout-ID, Schlüssel/Kartendaten in Fehlermeldungen | kein Befund | – | review-zahlungen | – |

### 4.3 Freigaben (ADR-006)

| ID | Szenario | Ergebnis | Schweregrad | Test | Behebung |
|---|---|---|---|---|---|
| F01 | Freigabe und Ablehnung gleichzeitig (3 Anfragen) | kein Befund (genau eine Entscheidung) | – | review-freigaben | – |
| F02 | Gleichzeitig neue Fassung und Entscheidung (4 Runden) | kein Befund (keine Position auf nicht entschiedene Fassung freigegeben) | – | review-freigaben | – |
| F03a | Falscher Hash, alte Fassung, Hash der neuen mit ID der alten, fremder Kunde, bereits entschieden, zurückgezogen | kein Befund | – | review-freigaben | – |
| F03b | Ablehnung betrifft nur Positionen der Anfrage | kein Befund | – | review-freigaben | – |
| F04a | Wartende Position (auch Admin) starten; neue Fassung während Ausführung; direkte Änderung einer Freigabeposition | kein Befund (gesperrt, pausiert, 409) | – | review-freigaben | – |
| F04b | Fotos, Dokumentversion, Feststellung eines anderen Auftrags in einer Fassung | kein Befund (422; fremdes Foto bleibt intern) | – | review-freigaben | – |
| F04c | Entwurf eines stornierten Auftrags wird an den Kunden gesendet (Benachrichtigung, entscheidbar) | **Befund bestätigt** | niedrig | review-freigaben | behoben `829b43d`: Senden und neue Fassung nur bei offenem Auftrag, wie bei der Anlage (`apps/api/src/routes/approvals.ts`) |
| F05a | R-ANN-3: Nach bestätigter Annahme ändert der Service eine Annahmeposition (Bestätigung verfällt still) und legt danach neue Positionen als `agreed` an, ohne Freigabe | **Befund bestätigt** | mittel | review-freigaben (`it.fails`) | **offen**, Geschäftsregel-Frage, siehe 5.1 |
| F05b | USt-Satz einer bestätigten Annahmeposition ändern (Bruttobetrag ändert sich): Bestätigung bleibt gültig, weil `vatRateBp` nicht im Annahme-Hash ist | **Befund bestätigt** | niedrig | review-freigaben (`it.fails`) | **offen**, siehe 5.1 |
| F06 | Neue Fassung ohne die bereits erledigte Zeile: Zuordnung "Zeile i ↔ i-te Position" verschiebt sich, die freigegebene Zeile wird nie ausführbar (bzw. eine Position erhält den Inhalt einer anderen Zeile) | **Befund bestätigt** | mittel (fachliche Integrität) | review-freigaben (`it.fails`) | **offen**, siehe 5.1 |

### 4.4 Servicehistorie (C-03)

| ID | Szenario | Ergebnis | Schweregrad | Test | Behebung |
|---|---|---|---|---|---|
| H01 | Freigabe, Positionsabschluss, Rechnung, Zahlung, Abholbereit ohne fachlichen Abschluss; direkter Anlage-Endpunkt | kein Befund (kein Eintrag; kein Endpunkt) | – | review-servicehistorie | – |
| H02 | Abgelehnte, zurückgezogene, wartende, nicht durchgeführte Positionen und Positionen ohne Wartungsart | kein Befund (nur die ausgeführte, vereinbarte Wartungsposition) | – | review-servicehistorie | – |
| H03a | Vier gleichzeitige Abschlüsse, dann Wiederholung mit `Idempotency-Key` | kein Befund (ein Eintrag, ein Audit-Eintrag, ein Statuswechsel) | – | review-servicehistorie | – |
| H03b | Abschluss aus `in_progress`, aus `cancelled` | kein Befund (409, kein Eintrag) | – | review-servicehistorie | – |
| H04 | Mechaniker ohne Recht; nicht zugewiesener Mechaniker mit Recht; Kunde | kein Befund | – | review-servicehistorie | – |
| H05a | Zwei gleichzeitige Korrekturen; Korrektur der alten Fassung; ohne Begründung; `PATCH`/`DELETE`; Stornierung als Revision; Fälligkeit; Audit | kein Befund | – | review-servicehistorie | – |
| H05b | Freigabelink und QR-Kurzansicht nach Korrektur und Stornierung; keine privaten Felder | kein Befund | – | review-servicehistorie | – |
| H06a–d | Fälligkeit: km zuerst erreicht, Datum zuerst erreicht, ohne km-Daten, Schätzung gekennzeichnet | kein Befund | – | review-servicehistorie | – |
| H06e | Unplausibler km-Stand (niedriger) | kein Befund (gespeichert, markiert, verfälscht Fälligkeit nicht) | – | review-servicehistorie | – |
| H07 | Neuer Halter: Liste und Einzelabruf ohne Auftragsbezug; Vorbesitzer 404 | kein Befund | – | review-servicehistorie | – |

### 4.5 Allgemein

| ID | Szenario | Ergebnis | Schweregrad | Test | Behebung |
|---|---|---|---|---|---|
| A01 | SQL-Injektion und `LIKE`-Platzhalter in Suchen (Kunden, Fahrzeuge, Aufträge) und Audit-Filtern | kein Befund (parametrisiert, Platzhalter maskiert, kein `sql.raw`) | – | review-allgemein | – |
| A02a | Pfad-Traversal im Dateispeicher | kein Befund (Schlüsselmuster und Wurzelprüfung) | – | review-allgemein | – |
| A02b | Dateinamen mit `../`, Anführungszeichen, CRLF; `Content-Disposition` | kein Befund | – | review-allgemein | – |
| A03 | SVG/HTML/Skript als Bild; PNG-Polyglot; PDF als Foto | kein Befund (Signaturprüfung, Auslieferung mit erkanntem Typ, `nosniff`, CSP) | – | review-allgemein | – |
| A04 | Massenzuweisung: `status`, `customerId`, `vehicleId`, `orderNumber` am Auftrag; `authorization`, `executionStatus` an Positionen; `qrToken`, `qrPublicViewEnabled`, `archivedAt` am Fahrzeug; `customerNumber` am Kunden; `status`, `email`, Rolle `customer` am Benutzer; `paymentProviderConfigured` | kein Befund | – | review-allgemein | – |
| A05 | `Idempotency-Key` mit anderem Inhalt, ungültig, anderer Pfad | kein Befund | – | review-allgemein | – |
| A06a | Einladung gleichzeitig zweimal angenommen; neue Einladung macht alte ungültig | kein Befund | – | review-allgemein | – |
| A06b | Rücksetzlink gleichzeitig, abgelaufen, älterer Link nach neuem | kein Befund | – | review-allgemein | – |
| A07 | Audit-Abdeckung der Aktionen aus `docs/rollen-und-rechte.md` Abschnitt 5 (18 Aktionen, u. a. Freigabe gesendet/geändert/zurückgezogen/entschieden mit Hash und Fassung, Rechnung gestellt/storniert, manuelle Zahlung, Erstattung, Dokument veröffentlicht/zurückgezogen, Freigabelink angelegt/abgerufen/widerrufen, Einstellungen, Exporte) | kein Befund | – | review-allgemein | – |
| A08 | Chat-Anhang einer Mitarbeiterdatei durch Kunden; Mechaniker ohne Chat-Recht | kein Befund | – | review-allgemein | – |

Summe: **74 Szenarien als Tests** (24 Rechte, 17 Zahlungen, 10 Freigaben, 13 Servicehistorie,
10 Allgemein). **16 Szenarien mit bestätigtem Befund**, davon **11 behoben** (R08a und R08b
haben dieselbe Ursache) und **5 offen**. Kein Befund mit Schweregrad kritisch oder hoch.

## 5. Offene Befunde und Beobachtungen ohne Test

### 5.1 Bestätigt, offen (als `it.fails` im Test)

| ID | Datei | Beschreibung | Vorschlag |
|---|---|---|---|
| R09c | `apps/api/src/routes/auth.ts:64` | Sperre nach Fehlversuchen antwortet mit 429, unbekannte Adressen immer mit 401. Nach sechs Versuchen ist erkennbar, ob ein Konto existiert (R14 in C-01). Rate-Limit je IP+E-Mail begrenzt, verhindert aber nicht. | Bei Sperre dieselbe Antwort wie bei falschem Passwort (401, gleicher Text) oder Sperrhinweis nur per E-Mail an den Kontoinhaber. Entscheidung Koordination, weil `anmeldung.test.ts` die 429 festschreibt. |
| R14c | `apps/api/src/routes/realtime.ts:48` | Die periodische Prüfung erneuert nur den Actor, nicht die Abonnements. Ein Mechaniker behält nach entzogener Zuweisung sein Abo; Ereignisse enthalten nur IDs und Status. | Bei der Prüfung jedes Abo mit `canViewWorkOrder` neu bewerten oder nach `PUT /work-orders/:id/assignees` betroffene Abos schließen. |
| F05a | `apps/api/src/routes/workOrders.ts:643`, `apps/api/src/services/workOrderOps.ts:93` | Nach bestätigter Annahme lehnt `POST /work-orders/:id/items` neue Positionen ab. Ändert der Service aber eine Annahmeposition (auch nur den Preis), verfällt die Bestätigung still (nur Audit), die geänderte Position bleibt `agreed` und ausführbar, und danach sind neue `agreed`-Positionen wieder möglich. Das umgeht R-ANN-3 und AGENTS.md Regel 4 sinngemäß. | Geschäftsregel klären (siehe 6.1). Vorschlag: Wurde die Annahme einmal bestätigt, neue Positionen nur über Freigabe; Preis-/Umfangsänderungen an bestätigten Annahmepositionen nur über Freigabe oder erneute Bestätigung vor der Ausführung. |
| F05b | `packages/domain/src/intake/intake.ts:65` | `vatRateBp` (und `kind`) der Annahmepositionen fehlen im kanonischen Annahme-Inhalt; eine USt-Änderung ändert den Bruttobetrag ohne neue Bestätigung. | `vatRateBp` in `agreedItems` aufnehmen (Format `v: 2`); Paket P-02 (Domain). |
| F06 | `apps/api/src/services/approvals.ts:151` | Zeilen einer neuen Fassung werden über die Position in der Liste den Auftragspositionen zugeordnet; erledigte Positionen werden übersprungen, ohne die Zuordnung zu verschieben. Fehlt in der neuen Fassung eine bereits erledigte Zeile oder ändert sich die Reihenfolge, wird die freigegebene Zeile nie ausführbar (Position `withdrawn`) bzw. eine Position erhält den Inhalt einer anderen Zeile. | Stabile Zeilenkennung in den Fassungszeilen (z. B. `workItemId` bzw. Zeilen-ID im Snapshot und im Hash) und Zuordnung darüber; alternativ erledigte Positionen verpflichtend unverändert in der neuen Fassung führen und prüfen. |

### 5.2 Nur per Code-Inspektion (kein Test, nicht als Befund gezählt)

| Thema | Beobachtung | Einschätzung |
|---|---|---|
| Erstattung, Absturz nach Anbieteraufruf | Bricht der Prozess zwischen `provider.refund` und dem Status-Update ab, bleibt die Erstattung `requested`; das in `docs/zahlungen.md` 4 beschriebene "Bestätigung durch erneutes Lesen der Transaktion" fehlt. Keine Doppelerstattung. | niedrig; mit SumUp-Testzugang umsetzen |
| SumUp-Erstattungsendpunkt | Adapter nutzt `POST /v0.1/me/refund/{id}`, `docs/zahlungen.md` 4 nennt `POST /v1.0/merchants/{code}/payments/{id}/refunds` (Widerspruch in der SumUp-Doku ist dort beschrieben). | mit Testzugang klären |
| Zeitüberschreitung beim Anlegen | Kein Wiederfinden über `checkout_reference` (docs 2.1); der lokale Versuch wird zurückgerollt, ein beim Anbieter angelegter Checkout verwaist (Kunde kennt die URL nicht). | niedrig |
| Upload | Kein Kontingent und kein Rate-Limit für `POST /files` (angemeldete Nutzer können Speicher füllen); kein Aufräumlauf (bekannt aus P-03). | niedrig |
| Push-Token | `POST /devices` mit einem fremden Push-Token übernimmt das Gerät (Kenntnis des Tokens nötig). | niedrig |
| Rate-Limit Webhook | Schlüssel ist die IP; hinter einem Proxy ohne `TRUST_PROXY` teilen sich alle Aufrufer 300/min, ein Angreifer könnte echte Webhooks verdrängen (Abgleichslauf fängt auf). | Betriebshinweis |
| Fahrzeugdaten nicht historisiert | Alte Aufträge des Vorbesitzers zeigen das aktuelle Kennzeichen (ggf. vom neuen Halter geändert). | niedrig, Modellfrage |
| Manuelle Überzahlung | `acceptOverpayment` ist nicht über die API erreichbar; eine bar überzahlte Rechnung kann nicht erfasst werden. | funktional |
| Gesperrter Kundenzugang | Kann nicht wieder freigeschaltet werden (Einladung 409, `/users/:id/enable` nur für Mitarbeiter). | funktional |
| Antwortzeiten | C-01 R1 verlangt gleiche Antwortzeit-Größenordnung für fremde und unbekannte IDs; nicht gemessen (In-Process-Tests sind dafür ungeeignet). Code-seitig kein zusätzlicher Aufwand für fremde Objekte erkennbar. | nicht geprüft |
| Idempotenz-Wiederholung | Eine gespeicherte Antwort wird ohne erneute Rechteprüfung wiederholt (nur für denselben Benutzer, Pfad und Inhalt). | niedrig |

## 6. Offene Fragen an Koordination bzw. Inhaber

1. **R-ANN-3 nach Änderung (F05a):** Soll eine einmal bestätigte Annahme dauerhaft bedeuten,
   dass neue und geänderte Positionen nur noch über eine Freigabe entstehen? Oder genügt eine
   erneute Bestätigung, und bis dahin sind geänderte Positionen gesperrt?
2. **Mechaniker mit `documents.readInternal`:** `canViewDocument` erlaubt dann alle Dokumente
   (außer Angebot/Rechnung) aller Kunden, nicht nur die zugewiesener Aufträge. Gewollt?
   (`packages/domain/src/permissions/objectRules.ts:281`)
3. **Mechaniker und alte Aufträge:** Fahrzeugakte und Servicehistorie bleiben über jede frühere
   Zuweisung dauerhaft sichtbar, auch nach Abschluss und Halterwechsel
   (`apps/api/src/services/access.ts:52`). Soll das auf aktive Aufträge begrenzt werden?
4. **Stornierter Auftrag mit wartender Freigabeanfrage:** Die Anfrage bleibt entscheidbar
   (Positionen sind danach ohnehin nicht ausführbar). Soll die Stornierung wartende Anfragen
   automatisch zurückziehen?
5. **Sperrhinweis bei der Anmeldung (R09c):** Datenschutz (keine Auskunft über Konten) gegen
   Nutzerfreundlichkeit (Hinweis auf Sperre) abwägen.

## 7. Tatsächliches Ergebnis

Geänderte Dateien (Korrekturen):

- `apps/api/src/routes/users.ts` (Sperre der Admin-Zeilen, Echtzeit trennen)
- `apps/api/src/routes/vehicles.ts` (km-Historie ohne fremde Auftragsbezüge)
- `apps/api/src/services/dataExport.ts` (Selbstauskunft ohne Daten Dritter und interne Texte)
- `apps/api/src/routes/webhooks.ts` (nur nötige Felder speichern)
- `apps/api/src/payments/provider.ts`, `sumupProvider.ts`, `fakeProvider.ts`, `apps/api/src/routes/invoices.ts` (`valid_until`, deaktivierte Versuche abfragen)
- `apps/api/src/services/payments.ts` (Abgleich inkl. deaktivierter Versuche)
- `apps/api/src/routes/approvals.ts` (Senden/neue Fassung nur bei offenem Auftrag)
- `apps/api/src/realtime/hub.ts`, `apps/api/src/routes/realtime.ts`, `auth.ts`, `customers.ts` (Verbindungen sofort trennen)
- `packages/contracts/src/routes.ts`, `packages/contracts/src/contracts.test.ts` (`safeNextPath`)
- `apps/api/README.md` (Zahlungsabschnitt nachgeführt)
- neue Tests `apps/api/test/review-*.test.ts` (5 Dateien, 74 Tests)

Ausgeführte Befehle (27.09.2026, im Worktree, eigene Datenbank auf Port 54339):

| Befehl | Ergebnis |
|---|---|
| `pnpm typecheck` | Exit 0 (design-tokens, contracts, domain, api) |
| `TEST_DATABASE_URL=… pnpm test` | design-tokens 8/8, contracts 9/9, domain 20 Dateien 246/246, api 22 Dateien: 130 bestanden + 5 erwartete Fehlschläge (`it.fails`, offene Befunde), 0 fehlgeschlagen |
| Vor dem Review (Basis `0c0d977`) | api 17 Dateien, 61 Tests bestanden |

Nicht erledigt: offene Befunde aus 5.1 (Geschäftsregel- bzw. Domain-Entscheidungen), Punkte aus
5.2, Messung der Antwortzeiten, Tests gegen die echte SumUp-API (kein Zugang).

## 8. Prüfung

Durch den Lead: Korrekturen und offene Punkte prüfen. **Das unabhängige Codex-Review C-01 bis
C-03 ist damit nicht erledigt** und bleibt offen, bis Codex eingerichtet ist.

## 9. Nachtrag Lead (27.09.2026): Entscheidungen und Behebung der offenen Befunde

Entscheidungen (reversibel, in den Fachdokumenten nachgetragen):

| Frage/Befund | Entscheidung | Umsetzung | Test |
|---|---|---|---|
| F05a / Frage 1 (R-ANN-3) | Wurde die Annahme einmal bestätigt, entstehen neue Leistungen und Änderungen an Umfang oder Preis (Art, Titel, Beschreibung, Menge, Einheit, Preis, USt) vereinbarter Leistungen nur noch über eine Freigabeanfrage. Das gilt dauerhaft, auch wenn eine spätere Änderung am Annahmetext die Bestätigung ungültig macht. Zuweisung, Wartungsart und Intervall bleiben änderbar. | Spalte `intakes.first_confirmed_at` (Migration `0003`), Prüfung in `POST /work-orders/:id/items` und `PATCH /work-items/:id` (409 `approval_required`) | `review-freigaben.test.ts` F05, `endpunkte.test.ts` |
| F05b | USt-Satz und Art der vereinbarten Positionen sind Teil des Annahme-Hashs (Format `v: 2`). | `packages/domain/src/intake/intake.ts`, `apps/api/src/services/intake.ts` | Domain `intake.test.ts`, API F05b |
| F06 | Eine Freigabeanfrage kann nur überarbeitet werden, solange aus ihr keine Arbeit begonnen wurde. Danach läuft jede Änderung (z. B. Mehraufwand) über eine eigene neue Freigabeanfrage. Damit entfällt die Zuordnung von Zeilen zu bereits bearbeiteten Positionen. | `PUT /approvals/:id` → 409 `approval_in_execution` | `review-freigaben.test.ts` F06 (2 Tests), angepasster Test "laufende Arbeit sperrt die Überarbeitung" |
| R09c / Frage 5 | Datenschutz vor Komfort: Bei gesperrtem Konto antwortet die Anmeldung wie bei falschen Daten (401). Die Sperre bleibt wirksam und wird protokolliert. | `apps/api/src/routes/auth.ts` | `review-rechte.test.ts` R09c, `anmeldung.test.ts` |
| R14c | Nach geänderter Zuweisung werden die Echtzeit-Abonnements des Auftrags sofort neu geprüft; die regelmäßige Sitzungsprüfung prüft zusätzlich alle Abonnements. | `RealtimeHub.revalidateWorkOrder`, `routes/realtime.ts`, `PUT /work-orders/:id/assignees` | `review-rechte.test.ts` R14c |
| Frage 2 | Mechaniker mit `documents.readInternal` sehen nur Dokumente aktiver, ihnen zugewiesener Aufträge (bzw. deren Fahrzeuge), nie Angebote oder Rechnungen. | Domain `canViewDocument` (`actorAssignedViaActiveWorkOrder`), `services/access.ts` `activeAssignmentScope`, `routes/documents.ts` | Domain `objectRules.test.ts`, API "Mechaniker: Zugriff nur über aktive Zuweisungen" |
| Frage 3 | Zugriff von Mitarbeitern ohne Leserecht auf Fahrzeugakte, Servicehistorie und Dokumente über eine Zuweisung besteht nur bei laufenden Aufträgen (Status draft, open, in_progress, work_completed). Den Auftrag selbst sehen zugewiesene Mitarbeiter weiterhin. | `services/access.ts` | wie Frage 2 |
| Frage 4 | Die Stornierung eines Auftrags zieht gesendete, noch offene Freigabeanfragen automatisch zurück (Audit mit Grund). Entwürfe bleiben unsichtbare Entwürfe. | `POST /work-orders/:id/transition` | `review-freigaben.test.ts` "Stornierung zieht offene Freigabeanfragen zurück" |

Ergebnis nach dem Nachtrag (27.09.2026, Hauptcheckout): `pnpm typecheck` grün; `pnpm test`:
design-tokens 8, contracts 9, app 82, domain 246, api 138 (22 Dateien), **0 erwartete
Fehlschläge, 0 fehlgeschlagen**. Die Punkte aus 5.2 (nur Code-Inspektion) bleiben offen bzw.
brauchen den SumUp-Testzugang. Das Codex-Review C-01 bis C-03 bleibt offen.
