# Testplan

Stand: 26.09.2026. Bezug: Abschnitt 11 in `docs/anforderungen.md`, AGENTS.md Abschnitt 7.

> **Ein Browser-Test ist kein Nachweis für iOS, Android oder Windows.** Browser-Tests prüfen den
> Web-Export (bzw. den Demo-Modus) in Chromium. Ob eine Funktion auf einem iPhone, einem
> Android-Gerät oder in der Windows-Anwendung funktioniert, belegt nur ein Test auf dem
> jeweiligen Build und Gerät. Solche Tests sind derzeit **blockiert**: Es gibt keinen Build,
> keine Testgeräte und keine Konten (Apple, Google, Expo, Windows-Signatur).

## 1. Testebenen

| Ebene | Werkzeug | Ort | Befehl | Prüft |
|---|---|---|---|---|
| Domain-Unit | Vitest | `packages/domain/src/**/*.test.ts` (entsteht in P-02) | `pnpm --filter @werkstatt/domain test` | Reine Regeln: Rechte, Statusübergänge, Hash, Zahlungsprüfung, Servicehistorie, Fälligkeiten |
| Vertrag | Vitest | `packages/contracts/src/contracts.test.ts` (vorhanden) | `pnpm --filter @werkstatt/contracts test` | Routen, öffentliche Endpunkte, Schemas |
| API-Integration | Vitest gegen PostgreSQL 16, externe Dienste über Test-Adapter | `apps/api/test/**` bzw. `apps/api/src/**/*.test.ts` (entsteht in P-03) | `pnpm --filter @werkstatt/api db:start`, danach `pnpm --filter @werkstatt/api test` | Rechte in Routen, Transaktionen, Eindeutigkeiten, Webhooks, Outbox |
| App-E2E Web | Playwright (Chromium) gegen den Web-Export des Demo-Modus, später gegen eine Test-API | `apps/app/e2e/**` (entsteht in P-04/P-05) | `pnpm --filter @werkstatt/app e2e` | Abläufe und Zustände der Oberfläche im Browser |
| Gerätetest iOS/Android | Maestro-Abläufe auf Builds (z. B. über EAS Workflows) und manuelle Prüfung | `apps/app/.maestro/**` (entsteht in C-04) | noch keiner | Verhalten der nativen Apps |
| Gerätetest Windows | Manuelle Prüfung des NSIS-Installers nach Protokoll | Protokoll entsteht mit dem ersten Build | noch keiner | Installation, Start, Anmeldung, Zahlung im Standardbrowser |

Testdaten sind ausschließlich Beispieldaten (`[TEST]`, `is_test_data = true`), nie echte
Kundendaten. Externe Dienste (SumUp, E-Mail, Push) laufen in Tests über Test-Implementierungen
der Adapter.

## 2. Mindest-Testfälle T-01 bis T-13

Status: `geplant`, `implementiert (Datei)`, `grün (Datum, Befehl)`, `blockiert (Grund)`.
Alle Dateipfade sind geplant und entstehen in den genannten Paketen; genaue Namen können
abweichen und werden hier nachgetragen.

### T-01 Kunde mit mehreren Fahrzeugen

Anforderungen: R-KUN-3, R-ROLLE-4, R-FZG-3.

| Ebene | Geplante Testdatei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/permissions/customer-rules.test.ts` (entsteht) | Kunde sieht alle Fahrzeuge mit aktuellem Halterzeitraum, keine beendeten | geplant |
| API-Integration | `apps/api/test/customers-vehicles.test.ts` (entsteht) | Auftragsanlage bietet alle Fahrzeuge des Kunden; `/vehicles` für Kunden liefert genau die eigenen aktuellen | geplant |
| App-E2E Web | `apps/app/e2e/kunde-fahrzeuge.spec.ts` (entsteht) | Liste "Meine Fahrzeuge" mit mehreren Fahrzeugen, Wechsel zwischen Fahrzeugen | geplant |
| Gerätetest iOS/Android/Windows | `apps/app/.maestro/kunde-fahrzeuge.yaml` (entsteht) | wie E2E auf Gerät | blockiert: kein Build, keine Geräte, keine Konten |

### T-02 Keine Einsicht in fremde Akten und Dokumente

Anforderungen: R-ROLLE-4, R-ROLLE-5, R-DOK-2, AGENTS.md Regel 1. Szenarien: C-01 R1, R2, R12.

| Ebene | Geplante Testdatei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/permissions/object-rules.test.ts` (entsteht) | Objektregeln für Auftrag, Dokument, Foto, Rechnung, Nachricht, Freigabe, Termin | geplant |
| API-Integration | `apps/api/test/access-foreign-objects.test.ts` (entsteht) | Kunde A erhält für jedes Objekt von Kunde B `404`; Listen ohne fremde Einträge; Dateidownload fremder und interner Dokumente `404` | geplant |
| App-E2E Web | `apps/app/e2e/nicht-verfuegbar.spec.ts` (entsteht) | Direkter Aufruf einer fremden Route zeigt "Nicht verfügbar" ohne Daten | geplant |
| Gerätetest | `apps/app/.maestro/deep-link-fremd.yaml` (entsteht) | Deep Link auf fremden Vorgang in der App | blockiert: kein Build, keine Geräte, keine Konten |

### T-03 Unterschiedliche Mitarbeiterrechte

Anforderungen: R-ROLLE-2, R-ROLLE-3, R-ADM-1, R-MECH-3. Szenarien: C-01 R5 bis R10, R18.

| Ebene | Geplante Testdatei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/permissions/roles.test.ts` (entsteht) | Rollenstandards, gewährte und entzogene Rechte, nicht zuweisbare Rechte, letzter Admin | geplant |
| API-Integration | `apps/api/test/staff-permissions.test.ts` (entsteht) | Service ohne `payments.refund` erhält `403`; Mechaniker sieht nur zugewiesene Aufträge und keine Preise; Deaktivierung beendet Sitzungen | geplant |
| App-E2E Web | `apps/app/e2e/rollen.spec.ts` (entsteht) | Menüs und Aktionen je Rolle; Aufruf fremder Rollenbereiche leitet um | geplant |
| Gerätetest | `apps/app/.maestro/mechaniker-heute.yaml` (entsteht) | Mechanikeransicht auf Telefon | blockiert: kein Build, keine Geräte, keine Konten |

### T-04 Freigabe und Ablehnung von Zusatzarbeiten

Anforderungen: R-FRG-1 bis R-FRG-5, AGENTS.md Regeln 4 und 5.

| Ebene | Geplante Testdatei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/approvals/approvals.test.ts` (entsteht) | Entscheidung nur zur aktuellen Version mit gleichem Hash; Ablehnung sperrt Positionen; getrennte Anfragen bleiben unberührt | geplant |
| API-Integration | `apps/api/test/approvals.test.ts` (entsteht) | Freigeben und Ablehnen durch den Kunden; Mitarbeiter und Mechaniker können nicht entscheiden; genau eine Entscheidung je Version; Audit-Eintrag mit Person, Zeitpunkt, Betrag, Hash | geplant |
| App-E2E Web | `apps/app/e2e/kunde-zusatzarbeit.spec.ts` (entsteht) | Klickweg B inkl. Abbruch, Ablehnung, Verbindungsfehler | geplant |
| Gerätetest | `apps/app/.maestro/kunde-zusatzarbeit.yaml` (entsteht) | Klickweg B aus einer Push-Benachrichtigung | blockiert: kein Build, keine Geräte, keine Konten |

### T-05 Erneute Freigabe nach Änderung

Anforderungen: R-FRG-3, R-FRG-6.

| Ebene | Geplante Testdatei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/approvals/versioning.test.ts` (entsteht) | Änderung erzeugt neue Version mit neuem Hash; alte Entscheidung gilt nicht; Positionen wieder wartend | geplant |
| API-Integration | `apps/api/test/approvals-revision.test.ts` (entsteht) | Entscheidung zur alten Version liefert `409`; neue Version verlangt neue Entscheidung | geplant |
| App-E2E Web | `apps/app/e2e/kunde-angebot-geaendert.spec.ts` (entsteht) | Hinweis "Das Angebot wurde geändert" und Laden der neuen Fassung | geplant |
| Gerätetest | `apps/app/.maestro/kunde-angebot-geaendert.yaml` (entsteht) | wie E2E | blockiert: kein Build, keine Geräte, keine Konten |

### T-06 Erfolgreiche, abgebrochene und mehrfach gemeldete Zahlungen

Anforderungen: R-ZAHL-5 bis R-ZAHL-8. Szenarien: C-02 Z3 bis Z10.

| Ebene | Geplante Testdatei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/payments/verification.test.ts` (entsteht) | Prüfregeln (Status, Betrag, Währung, Händler, Referenz), Zahlungsstatusberechnung | geplant |
| API-Integration | `apps/api/test/payments-webhook.test.ts` (entsteht) | Erfolg über Test-Adapter; Abbruch und Ablauf; derselbe Webhook mehrfach und parallel ergibt genau eine Zahlung; gefälschter Webhook ohne Wirkung | geplant |
| App-E2E Web | `apps/app/e2e/kunde-rechnung-bezahlen.spec.ts` (entsteht) | Klickweg C mit simulierter Zahlungsseite im Demo-Modus | geplant |
| Gerätetest | `apps/app/.maestro/kunde-rechnung-bezahlen.yaml` (entsteht) | Zahlungsseite in SFSafariViewController bzw. Custom Tab, Rückkehr | blockiert: kein Build, keine Geräte, kein SumUp-Testzugang |
| Anbieter-Test | Sandbox-Checkliste `docs/zahlungen.md` Abschnitt 12 | Echter Ablauf gegen die SumUp-Sandbox | blockiert: kein SumUp-Testzugang (O-2) |

### T-07 Rechnung bleibt nach Klick auf "Bezahlen" offen

Anforderungen: R-ZAHL-4, AGENTS.md Regel 7. Szenarien: C-02 Z1, Z2.

| Ebene | Geplante Testdatei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/payments/status.test.ts` (entsteht) | Checkout ohne bestätigte Zahlung ändert den Zahlungsstatus nicht | geplant |
| API-Integration | `apps/api/test/payments-start-checkout.test.ts` (entsteht) | `POST /invoices/:id/checkout` liefert `invoicePaymentStatus = open`; Rückkehr und `PENDING` lassen die Rechnung offen | geplant |
| App-E2E Web | `apps/app/e2e/kunde-rechnung-bezahlen.spec.ts` (entsteht) | Nach "Jetzt bezahlen" und Rückkehr ohne Bestätigung zeigt die Rechnung "Offen" | geplant |
| Gerätetest | `apps/app/.maestro/kunde-rechnung-offen.yaml` (entsteht) | wie E2E | blockiert: kein Build, keine Geräte, keine Konten |

### T-08 Serviceeintrag nur aus abgeschlossener Arbeit und nur einmal

Anforderungen: R-SERV-1, R-SERV-5, R-SERV-6, R-SERV-8. Szenarien: C-03 H1 bis H7, H14.

| Ebene | Geplante Testdatei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/service-history/derive.test.ts` (entsteht) | Ableitung nur aus `done` mit Wartungsart und `agreed`/`approved`; nichts aus Angebot, Freigabe, Rechnung, Zahlung; Revisionen | geplant |
| API-Integration | `apps/api/test/complete-review.test.ts` (entsteht) | Abschluss zweimal und parallel ergibt genau einen Eintrag je Position; Korrektur als Revision mit Audit | geplant |
| App-E2E Web | `apps/app/e2e/werkstatt-abschluss.spec.ts` (entsteht) | Bestätigungsdialog nennt Anzahl der Einträge; Historie zeigt Eintrag | geplant |
| Gerätetest | keiner vorgesehen (Serverlogik) | | nicht nötig |

### T-09 QR-Zugriff ohne private Unterlagen

Anforderungen: R-QR-1 bis R-QR-4, AGENTS.md Regel 9. Szenarien: C-01 R13, C-03 H12, H13.

| Ebene | Geplante Testdatei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/permissions/public-access.test.ts` (entsteht) | Felder der Kurzansicht und der Freigabe für Dritte | geplant |
| API-Integration | `apps/api/test/public-qr-share.test.ts` (entsteht) | Ohne Kurzansicht nur Hinweis; mit Kurzansicht keine Namen, Kennzeichen, FIN, Preise, Dokumente; Freigabe nur ausgewählte Einträge, abgelaufen und widerrufen ohne Inhalt; Zugriffe gezählt | geplant |
| App-E2E Web | `apps/app/e2e/qr-und-freigabe.spec.ts` (entsteht) | Klickwege D und E ohne Anmeldung | geplant |
| Gerätetest | `apps/app/.maestro/qr-scan.yaml` (entsteht) | Scan mit der Kamera öffnet die App bzw. den Browser | blockiert: kein Build, keine Geräte, keine Konten |

### T-10 Besitzerwechsel ohne private Kommunikation

Anforderungen: R-FZG-4, AGENTS.md Regel 3. Szenarien: C-01 R3, R4, C-03 H11.

| Ebene | Geplante Testdatei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/permissions/ownership.test.ts` (entsteht) | Sichtbarkeit für Vorbesitzer und neuen Halter | geplant |
| API-Integration | `apps/api/test/ownership-transfer.test.ts` (entsteht) | Neuer Halter sieht keine Aufträge, Nachrichten, Dokumente, Freigaben, Rechnungen des Vorbesitzers; Serviceeinträge ohne Auftragsbezug; Vorbesitzer behält eigene Unterlagen, verliert Fahrzeug | geplant |
| App-E2E Web | `apps/app/e2e/halterwechsel.spec.ts` (entsteht) | Warnhinweis im Dialog; Kundensicht beider Halter | geplant |
| Gerätetest | keiner vorgesehen (Serverlogik) | | nicht nötig |

### T-11 Benachrichtigungslinks führen zum richtigen Vorgang

Anforderungen: R-BEN-1, R-ARCH-8.

| Ebene | Geplante Testdatei | Prüft | Status |
|---|---|---|---|
| Vertrag | `packages/contracts/src/contracts.test.ts` (vorhanden) | Deep-Link-Pfade ohne Inhalte; `safeNextPath` lässt nur interne Ziele zu | **grün** (26.09.2026, `pnpm test`, 9 Tests im Paket) |
| API-Integration | `apps/api/test/notifications-outbox.test.ts` (entsteht) | Outbox im selben Transaktionsschritt; Zielpfad je Ereignis laut `docs/ansichten-und-routen.md` Abschnitt 6; Wiederholung mit Backoff; kein Doppelversand | geplant |
| App-E2E Web | `apps/app/e2e/deep-links.spec.ts` (entsteht) | Link ohne Anmeldung führt nach Anmeldung zum Ziel; fremder Vorgang "Nicht verfügbar" | geplant |
| Gerätetest | `apps/app/.maestro/push-deep-link.yaml` (entsteht) | Echte Push-Nachricht öffnet den richtigen Vorgang, auch bei geschlossener App | blockiert: kein Build, keine Geräte, keine Push-Zugänge |

### T-12 Daten nach Neustart erhalten

Anforderungen: R-ARCH-9, R-ARCH-10, R-AUF-3.

| Ebene | Geplante Testdatei | Prüft | Status |
|---|---|---|---|
| Domain-Unit | `packages/domain/src/sync/queue.test.ts` (entsteht, falls Warteschlangenlogik dort liegt) | Reihenfolge, Idempotenz, Konfliktregeln | geplant |
| API-Integration | `apps/api/test/idempotency.test.ts` (entsteht) | Wiederholung mit gleichem `Idempotency-Key` bzw. Client-UUID erzeugt nichts doppelt | geplant |
| App-E2E Web | `apps/app/e2e/entwurf-erhalten.spec.ts` (entsteht) | Auftragsentwurf und Chat-Entwurf nach Neuladen erhalten | geplant |
| Gerätetest | `apps/app/.maestro/offline-neustart.yaml` (entsteht) | Mechaniker offline: Feststellung mit Foto erfassen, App beenden, neu starten, online gehen, Übertragung prüfen | blockiert: kein Build, keine Geräte, keine Konten |

### T-13 Kritische Abläufe auf den Plattformen

Anforderungen: R-PLAT-1 bis R-PLAT-4. Kritische Abläufe: Anmeldung, Einladung annehmen,
Freigabe (A, B), Bezahlen (C), QR (E), Push-Deep-Link, Mechaniker offline, Werkstatt
Auftragsablauf am PC.

| Ebene | Geplante Testdatei | Prüft | Status |
|---|---|---|---|
| App-E2E Web | `apps/app/e2e/**` (entsteht) | Alle kritischen Abläufe im Browser | geplant |
| Gerätetest iOS | `apps/app/.maestro/**` auf iOS-Build | Kritische Abläufe auf iPhone | blockiert: kein Build, keine Geräte, kein Apple- und Expo-Konto |
| Gerätetest Android | `apps/app/.maestro/**` auf Android-Build | Kritische Abläufe auf Android | blockiert: kein Build, keine Geräte, kein Google- und Expo-Konto |
| Gerätetest Windows | Manuelles Protokoll (entsteht) | Installation per NSIS, Start, Anmeldung, Werkstattablauf mit Tastatur, Zahlung im Standardbrowser | blockiert: Installer nie gebaut, kein Windows-Testrechner, keine Signatur |

## 3. Bereits vorhandene automatisierte Tests

| Datei | Anzahl | Prüft | Ergebnis |
|---|---|---|---|
| `packages/contracts/src/contracts.test.ts` | 9 | Startseiten je Rolle, Deep-Link-Pfade, `safeNextPath`, Pfadparameter, abschließende Liste öffentlicher Endpunkte, FIN-Prüfung, Pflichtfelder Kunde, 64-stelliger Inhalts-Hash für Entscheidungen, deutsche Bezeichnung je Recht | grün am 26.09.2026 (`pnpm test`) |
| `packages/design-tokens/src/index.test.ts` | 8 | Farbkontraste hell und dunkel (Text, Akzent, Statusfarben) | grün am 26.09.2026 (`pnpm test`) |

`pnpm typecheck` war am 26.09.2026 für beide Pakete grün.
