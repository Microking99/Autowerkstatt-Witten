# ADR-012: Echtzeit über WebSocket

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** R-CHAT-1, R-ROLLE-5, R-AUF-5

## Kontext

Der auftragsbezogene Chat soll live sein; Statusänderungen (Freigabe entschieden, Zahlung
bestätigt, Fahrzeug abholbereit) sollen offene Ansichten ohne Neuladen aktualisieren. Rechte
gelten auch für Echtzeitkanäle.

## Entscheidung

- **Ein WebSocket-Endpunkt** `GET /api/v1/realtime` (Fastify WebSocket).
- **Anmeldung im ersten Frame:** Das Sitzungstoken wird nach dem Verbindungsaufbau gesendet,
  nicht in der URL (URLs landen in Logs). Ohne gültiges Token wird die Verbindung geschlossen.
- **Kanäle je Auftrag** (und je Benutzer für persönliche Hinweise). Jedes Abonnement wird mit
  derselben Rechte- und Objektprüfung wie der REST-Aufruf des Auftrags geprüft
  (`packages/domain`). Wird ein Konto deaktiviert oder ein Recht entzogen, schließt der Server
  betroffene Abonnements.
- **Ereignisse enthalten nur Art und IDs** (z. B. `message.created`, `approval.decided`,
  `invoice.payment_changed`); der Client lädt Inhalte über REST nach. So gilt die
  Feldfilterung je Rolle automatisch auch für Echtzeit.
- **Rückfall Polling:** Ist der Kanal nicht verfügbar, fragt der Client in Abständen ab,
  solange die Ansicht geöffnet ist; nach Rückkehr in die App wird immer einmal neu geladen.
- Bei mehreren API-Instanzen werden Ereignisse über PostgreSQL (`LISTEN/NOTIFY`) verteilt
  (Vorschlag, Umsetzung P-03).

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| Nur Polling | Einfach, aber träge im Chat und mehr Last. Bleibt Rückfall. |
| Server-Sent Events | Nur Server an Client; Chat-Senden liefe ohnehin über REST. Gleichwertig möglich, WebSocket ist in Fastify vorhanden und für die Windows-Hülle in der CSP freigegeben. |
| Supabase Realtime | Rechte über RLS-Richtlinien auf `realtime.messages`; Regeln doppelt gepflegt (ADR-002). |
| Inhalte im Ereignis senden | Feldfilter je Rolle müssten doppelt umgesetzt werden. |

## Folgen

- Tests: Abonnement fremder Aufträge wird abgelehnt; Ereignisse enthalten keine Inhalte;
  Rechteentzug schließt Abonnements (C-01).
- Push-Benachrichtigungen (ADR-010) bleiben für geschlossene Apps zuständig.
