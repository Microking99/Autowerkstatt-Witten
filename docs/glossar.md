# Glossar: Fachbegriff, Bezeichner im Code, Erklärung

Bezeichner im Code sind englisch (TypeScript `camelCase`, Datenbank `snake_case`),
Oberflächen und Dokumentation deutsch. Quellen der Bezeichner: `docs/datenmodell.md`,
`packages/contracts/src/enums.ts`, `dto.ts`, `requests.ts`, `api.ts`, `routes.ts`.
Deutsche Statusbezeichnungen für die Oberfläche stehen in `packages/contracts/src/labels.ts`.

## Rollen, Konten, Zugang

| Fachbegriff | Code | Tabelle | Erklärung |
|---|---|---|---|
| Inhaber / Admin | `admin` (`Role`) | `users.role` | Volle Rechte inkl. Benutzerverwaltung und Einstellungen. |
| Sekretariat / Service | `service` | `users.role` | Werkstattverwaltung nach zugewiesenen Rechten. |
| Mechaniker | `mechanic` | `users.role` | Nur zugewiesene Aufträge und Positionen. |
| Kunde (Rolle) | `customer` | `users.role` | Konto eines Kunden; sieht nur eigene Daten. |
| Kaufinteressent / Dritter | kein Konto; Zugriff über `vehicleShare` | `vehicle_shares` | Sieht nur ausdrücklich freigegebene Serviceeinträge. |
| Benutzerkonto | `user`, `SessionUser`, `StaffUser` | `users` | Anmeldung mit E-Mail und Passwort; Status `invited`, `active`, `disabled`. |
| Kundendatensatz | `customer`, `CustomerSummary`, `CustomerDetail` | `customers` | Stammdaten eines Kunden; existiert auch ohne Konto. |
| Kundenkonto | `customerAccount` | `customer_accounts` | Verknüpft Kundendatensatz und Benutzerkonto 1:1. |
| Kontostatus (App-Zugang) | `CustomerAccessStatus` (`none`, `invited`, `active`, `disabled`) | abgeleitet | Zugangsstatus eines Kundendatensatzes zur App. |
| Einladung | `invitation`, `acceptInvitation` | `invitations` | Einmal verwendbarer Link, 7 Tage gültig. |
| Sitzung | `session` | `sessions` | Anmeldung mit undurchsichtigem Token; nur Hash gespeichert. |
| Passwort zurücksetzen | `passwordReset`, `forgotPassword`, `resetPassword` | `password_resets` | Link 1 Stunde gültig, beendet alle Sitzungen. |
| Recht | `permission` (`Permission`, `PERMISSIONS`) | | Feingranularer Schlüssel wie `invoices.write`. |
| Rechteabweichung | `userPermissionOverride` | `user_permission_overrides` | Vom Rollenstandard abweichend gewährtes oder entzogenes Recht. |
| Objektregel | `can(actor, action, resource)` | | Regel, **woran** jemand ein Recht ausüben darf (z. B. nur zugewiesene Aufträge). |
| Gerät | `device` | `devices` | Registriertes Gerät mit Push-Token. |

## Werkstatt und Stammdaten

| Fachbegriff | Code | Tabelle | Erklärung |
|---|---|---|---|
| Werkstattdaten | `WorkshopSettings` | `workshop_settings` | Name, Anschrift, Bankverbindung, Zahlungsziel, Zahlungsanbieter. |
| Wartungsart | `maintenanceType` | `maintenance_types` | Art einer Wartung mit Standardintervallen; nur Positionen mit Wartungsart erzeugen Serviceeinträge. |
| Intervall | `intervalKm`, `intervalMonths` | `work_items`, `service_entries` | Abstand bis zur nächsten Fälligkeit nach km bzw. Monaten. |
| Hebebühne / Arbeitsplatz | `resource` (`lift`, `bay`, `diagnosis`, `other`) | `resources` | Kapazität für die Planung. |
| Arbeitszeiten | `staffWorkingHours` | `staff_working_hours` | Verfügbarkeit der Mitarbeiter. |

## Fahrzeuge

| Fachbegriff | Code | Tabelle | Erklärung |
|---|---|---|---|
| Fahrzeug, Fahrzeugakte | `vehicle`, `VehicleSummary`, `VehicleDetail` | `vehicles` | Stammdaten eines Fahrzeugs. |
| Kennzeichen | `licensePlate` | `vehicles.license_plate` | Normalisiert gespeichert. |
| FIN (Fahrzeug-Identifizierungsnummer) | `vin` | `vehicles.vin` | 17 Zeichen, geprüft durch `VinSchema`. |
| HSN / TSN | `hsn`, `tsn` | `vehicles` | Hersteller- und Typschlüsselnummer. |
| Halter, Halterzeitraum | `vehicleOwnership`, `Ownership` | `vehicle_ownerships` | Zeitraum, in dem ein Kunde Halter ist; höchstens ein aktueller. |
| Halterwechsel | `transferOwnership` | `vehicle_ownerships` | Beendet den aktuellen Halterzeitraum und beginnt einen neuen. |
| Kilometerstand | `odometerReading` | `odometer_readings` | Mit Datum und Quelle, nie überschrieben; unplausible Werte markiert. |
| QR-Serviceheft, QR-Code | `qrToken`, `resolveQr`, `QrResolution` | `vehicles.qr_token` | Stabiler Link am Fahrzeug; kein Generalschlüssel. |
| Öffentliche QR-Kurzansicht | `qrPublicViewEnabled`, `setQrPublicView` | `vehicles.qr_public_view_enabled` | Vom Halter einschaltbare Kurzansicht ohne Anmeldung, Standard aus. |
| Fahrzeugfreigabe für Dritte | `vehicleShare`, `VehicleShare`, `PublicVehicleView` | `vehicle_shares` | Befristeter, widerrufbarer Link auf ausgewählte Serviceeinträge. |

## Termine

| Fachbegriff | Code | Tabelle | Erklärung |
|---|---|---|---|
| Termin | `appointment` | `appointments` | Konkreter Werkstatttermin; getrennt von Fälligkeiten. |
| Terminart | `AppointmentKind` (`inspection_hu`, `service`, `repair`, `tire_change`, `other`) | | HU/AU, Service, Reparatur, Reifenwechsel, Sonstiges. |
| Terminanfrage | `requestAppointment`, Status `requested` | `appointments` | Wunsch des Kunden; **keine** Buchung. |
| Alternativvorschlag | `appointmentProposal` | `appointment_proposals` | Vorschlag der Werkstatt; Annahme bestätigt den Termin. |
| Konflikt | `SchedulingConflict`, `checkConflicts` | | Doppelbelegung, fehlende Teile, außerhalb der Arbeitszeit. |
| Teilebedarf | `partDemand` | `part_demands` | Benötigte Teile je Auftrag mit Status. |

## Aufträge und Ausführung

| Fachbegriff | Code | Tabelle | Erklärung |
|---|---|---|---|
| Auftrag | `workOrder`, `WorkOrderSummary`, `WorkOrderDetail` | `work_orders` | Verbindet Kunde, Fahrzeug, Positionen, Termine, Dokumente, Freigaben, Abrechnung; gehört dem Kunden, nicht dem Fahrzeug. |
| Auftragsnummer | `orderNumber` | `work_orders.order_number` | Format `A-2026-0001`. |
| Arbeitsstatus | `WorkOrderStatus`, `status.work` | `work_orders.status` | `draft`, `open`, `in_progress`, `work_completed`, `completed`, `picked_up`, `cancelled`. |
| Freigabestatus (Auftrag) | `ApprovalOverviewStatus`, `status.approval` | berechnet | `none`, `pending`, `decided`. |
| Zahlungsstatus | `PaymentStatus`, `status.payment` | berechnet | `no_invoice`, `open`, `partially_paid`, `paid`, `partially_refunded`, `refunded`, `cancelled`; zusätzlich Merkmal überfällig (`overdue`). |
| Status-Dreiklang | `StatusTriple` | | Die drei getrennten Status eines Auftrags plus Zusatzmerkmale. |
| Abholbereit | `readyForPickup`, `readyForPickupAt` | `work_orders.ready_for_pickup_at` | Zeitstempel, kein Status. |
| Fachlicher Abschluss | `completeReview`, Status `completed` | `work_orders.completion_reviewed_at` | Geprüfte Bestätigung der Arbeiten; einziger Auslöser für Serviceeinträge. |
| Position (Arbeitsposition) | `workItem`, `WorkItem` | `work_items` | Einzelne Leistung oder Teil im Auftrag. |
| Herkunft der Position | `WorkItemOrigin` (`intake`, `offer`, `additional`) | `work_items.origin` | Aus Annahme, Angebot oder Zusatzarbeit. |
| Autorisierung der Position | `WorkItemAuthorization` | `work_items.authorization` | `agreed` (vereinbart), `pending_approval`, `approved`, `rejected`, `withdrawn`. |
| Vereinbart | `agreed` | | Bei Annahme oder Anlage vereinbarte Leistung; ausführbar ohne Freigabeanfrage. |
| Ausführungsstatus | `WorkItemExecutionStatus` | `work_items.execution_status` | `planned`, `in_progress`, `paused`, `done`, `not_done`. |
| Zeitbuchung | `timeEntry` | `time_entries` | Zeitabschnitt aus Starten, Pausieren, Abschließen. |
| Verbautes Teil | `partUsed`, `addPart` | `parts_used` | Tatsächlich verbautes Teil. |
| Zuweisung | `assignees`, `setAssignees` | `work_order_assignees` | Zuständige Mechaniker eines Auftrags. |
| Fahrzeugannahme | `intake`, `Intake` | `intakes` | Beanstandung, km, Schäden, Fotos, vereinbarte Leistungen, Kostenrahmen, Bestätigung mit Hash. |
| Kundenbeanstandung | `customerComplaint` | `intakes.customer_complaint` | Was der Kunde bemängelt. |
| Kostenrahmen | `costLimitCents` | `work_orders`, `intakes` | Vereinbarte Obergrenze. |
| Feststellung | `finding`, `Finding` | `findings` | Vom Mechaniker dokumentierter Befund; kann an den Service gemeldet werden. |
| Dringlichkeit | `FindingSeverity` (`info`, `recommended`, `urgent`, `safety`) | `findings.severity` | Hinweis, empfohlen, dringend, sicherheitsrelevant. |
| An Service melden | `reportFinding`, Status `reported` | | Meldung einer Zusatzarbeit; keine Freigabe. |
| Foto | `photo`, `Photo` | `photos` | Mit Kontext und Sichtbarkeit; Inhalt nur über die API. |
| Sichtbarkeit | `Visibility` (`internal`, `customer`) | | Standard `internal`. |
| Abschlusscheckliste [E] | `checklistTemplate`, `checklistRun` | `checklist_templates`, `checklist_runs` | Ergänzung, O-10. |
| Verlauf | `timeline`, `TimelineEntry` | aus `audit_log` | Chronologie eines Auftrags. |

## Freigaben

| Fachbegriff | Code | Tabelle | Erklärung |
|---|---|---|---|
| Freigabe, Freigabeanfrage | `approvalRequest`, `ApprovalRequest` | `approval_requests` | Bündelt zusammengehörige Positionen, die der Kunde entscheiden soll. |
| Angebot | `ApprovalKind` `offer` | | Freigabeanfrage für angebotene Leistungen. |
| Zusatzarbeit | `ApprovalKind` `additional_work` | | Freigabeanfrage für nachträglich festgestellte Arbeiten. |
| Version | `approvalVersion`, `ApprovalVersion` | `approval_versions` | Unveränderlicher Inhalt einer Anfrage; Änderung = neue Version. |
| Inhalts-Hash | `contentHash` | `approval_versions.content_hash`, `intakes.content_hash` | SHA-256 des kanonischen Inhalts (64 Hex-Zeichen). |
| Entscheidung | `approvalDecision`, `ApprovalDecision`, `decideApproval` | `approval_decisions` | Freigeben oder Ablehnen einer Version; genau eine je Version. |
| Freigeben / Ablehnen | `approved` / `rejected` (`ApprovalDecisionValue`) | | Nur durch das Kundenkonto des Auftragskunden. |
| Zurückziehen | `withdrawApproval`, Status `withdrawn` | | Werkstatt zieht eine Anfrage zurück. |
| Ersetzt (Version) | `supersededAt` | `approval_versions.superseded_at` | Ältere Version nach einer Änderung. |
| Kanal | `ClientChannel` (`ios`, `android`, `web`, `windows`) | | Plattform, auf der entschieden wurde. |

## Dokumente und Kommunikation

| Fachbegriff | Code | Tabelle | Erklärung |
|---|---|---|---|
| Datei | `file`, `FileRef` | `files` | Binärdatei im privaten Speicher mit Prüfsumme. |
| Dokument | `document`, `DocumentDto` | `documents` | Angebot, Rechnung, Annahmeprotokoll, Bericht, Sonstiges. |
| Dokumentversion | `documentVersion` | `document_versions` | Alte Versionen bleiben erhalten. |
| Veröffentlichen | `publishDocument`, `publishedAt` | `documents.published_at` | Macht ein Dokument für den Kunden sichtbar. |
| Nachricht, Chat | `message`, `Message`, `sendMessage` | `messages` | Auftragsbezogene Nachricht; `clientMessageId` verhindert Dubletten. |
| Gespräch | `conversation`, `Conversation` | abgeleitet | Nachrichten eines Auftrags mit Ungelesen-Zähler. |
| Gelesen-Stand | `conversationRead`, `markRead` | `conversation_reads` | Zeitpunkt der zuletzt gelesenen Nachricht. |
| Interne Notiz | `internalNote` | `internal_notes` | Nur für Mitarbeiter, nie für Kunden. |
| Benachrichtigung | `notification`, `NotificationDto` | `notifications` | In-App, Push oder E-Mail mit Zielpfad. |
| Postausgang (Outbox) | Tabelle `notifications` mit `status`, `attempts`, `next_attempt_at` | `notifications` | Im selben Transaktionsschritt geschrieben, danach vom Worker zugestellt. |
| Benachrichtigungsereignis | `NotificationEvent` (z. B. `approval.requested`) | | Auslöser einer Benachrichtigung. |
| Benachrichtigungseinstellung | `notificationPreference` | `notification_preferences` | Je Benutzer, Ereignis und Kanal. |
| Deep Link, Zielpfad | `routes`, `targetPath` | | Pfad mit IDs, nie Inhalte oder Tokens. |

## Rechnungen und Zahlungen

| Fachbegriff | Code | Tabelle | Erklärung |
|---|---|---|---|
| Rechnung | `invoice`, `Invoice` | `invoices` | Status `draft`, `issued`, `cancelled`; Zahlungsstatus berechnet. |
| Rechnung stellen | `issueInvoice` | | Nummer vergeben, für Kunden sichtbar, Benachrichtigung. |
| Storno | `cancelInvoice` | | Rechnung storniert. |
| Offener Posten, offener Betrag | `openCents` | berechnet | Aus Rechnungsbetrag und bestätigten Zahlungen berechnet; die Behandlung von Erstattungen legt `packages/domain` fest (P-02). |
| Zahlungsversuch | `checkout`, `Checkout`, `startCheckout` | `checkouts` | Ein gehosteter SumUp-Checkout; ändert den Rechnungsstatus nicht. |
| Eigene Zahlungsreferenz | `checkoutReference` | `checkouts.checkout_reference` | Eindeutige Referenz je Versuch. |
| Zahlung (bestätigt) | `payment`, `Payment` | `payments` | Nur nach geprüfter Bestätigung bzw. manueller Zuordnung mit Recht. |
| Zahlweg | `PaymentMethod` (`sumup_online`, `bank_transfer`, `cash`, `card_terminal`) | | Online, Überweisung, bar, Terminal vor Ort. |
| Manuelle Zahlungszuordnung | `recordManualPayment` | `payments` | Mit Recht `payments.recordManual`, Pflichtfeldern und Audit. |
| Erstattung | `refund`, `Refund`, `refundPayment` | `refunds` | Mit eigenem Idempotenzschlüssel. |
| Anbieterereignis | `providerEvent` | `provider_events` | Eingegangener Webhook; nur Auslöser. |
| Zahlungsabgleich | `refreshPaymentStatus`, Abgleichsjob | | Abfrage des Status beim Anbieter. |
| Anbietertransaktion | `providerTransactionId` | `payments.provider_transaction_id` | Eindeutig je Anbieter; verhindert Doppelbuchung. |

## Servicehistorie und Fälligkeiten

| Fachbegriff | Code | Tabelle | Erklärung |
|---|---|---|---|
| Servicehistorie, Serviceeintrag | `serviceEntry`, `ServiceEntry` | `service_entries` | Nachweis ausgeführter, fachlich abgeschlossener Wartungsarbeit. |
| Revision | `revisionOfId`, `revisionNo`, `correctServiceEntry` | `service_entries.revision_of_id` | Korrektur als neue Zeile; alte wird `superseded`. |
| Status des Eintrags | `ServiceEntryStatus` (`valid`, `superseded`, `voided`) | | Gültig, ersetzt, storniert. |
| Fälligkeit | `maintenanceDue`, `MaintenanceDue` | berechnet | Nächste Wartung nach Datum und/oder km. |
| Maßgebliche Grenze | `governingLimit` (`date`, `km`, `none`) | | Die zuerst erreichte Grenze. |
| Grundlage der Fälligkeit | `DueBasis` (`date`, `km_recorded`, `km_estimated`, `unknown`) | | Zeigt, ob eine km-Fälligkeit auf einem erfassten Stand beruht oder geschätzt ist. |

## Technik und Betrieb

| Fachbegriff | Code | Tabelle | Erklärung |
|---|---|---|---|
| Änderungsprotokoll (Audit) | `auditLog`, `AuditEntry`, `listAudit` | `audit_log` | Nur anfügbar, per Trigger geschützt. |
| Idempotenzschlüssel | Header `Idempotency-Key` | `idempotency_keys` | Verhindert doppelte Ausführung bei Wiederholungen. |
| Client-UUID | `id` in `FindingInputSchema`, `AttachPhotoRequestSchema`; `clientMessageId` | | Vom Gerät vergebene ID für offline erfasste Objekte. |
| Nicht synchronisiert | Offline-Warteschlange (P-05) | lokal auf dem Gerät | Noch nicht übertragene Einträge. |
| Beispieldaten, Testdaten | `isTestData`, Demo-Modus `EXPO_PUBLIC_DEMO` | `customers.is_test_data`, `vehicles.is_test_data` | Eindeutig gekennzeichnete, nicht echte Daten. |
| Übersicht (Dashboard) | `DashboardTile`, `dashboard` | berechnet | Kacheln je Rolle mit Ziel. |
| API-Fehler | `ApiError` | | Einheitliches Fehlerformat `{ error: { code, message, details } }`. |
| Seite (Blättern) | `PageSchema`, `nextCursor` | | Listen mit Cursor. |
