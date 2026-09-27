# ADR-009: Private Dateiablage

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** R-ARCH-2, R-DOK-1, R-DOK-2, R-CHAT-1, R-ANN-1

## Kontext

Fotos (Annahme, Feststellungen, Chat), Angebote, Rechnungen und Protokolle enthalten
personenbezogene und geschäftliche Daten. Interne Dokumente dürfen nie automatisch beim
Kunden erscheinen. Dokumente brauchen Versionen. Rechnungen müssen unverändert aufbewahrt
werden (Prüfpunkte GoBD und Aufbewahrung in `docs/pruefpunkte-recht-und-betrieb.md`).

## Entscheidung

- **Speicher:** in der Entwicklung ein lokales Verzeichnis (`apps/api/storage/`, nicht im Git),
  im Betrieb ein **S3-kompatibler Objektspeicher in der EU**, Bucket privat, mit
  **Versionierung**. Der Zugang liegt nur beim Server. Anbieter: O-5.
- **Metadaten** in `files`: zufälliger `storage_key`, Originalname, MIME-Typ, Größe,
  **SHA-256-Prüfsumme** (serverseitig berechnet), Hochladender.
- **Hochladen** nur über die API (`POST /api/v1/files`, multipart) mit Rechteprüfung,
  Größenlimit und Liste erlaubter Typen (Fotos, PDF). Offline erfasste Fotos werden mit
  Client-UUID nachgereicht (ADR-011).
- **Herunterladen und Anzeigen** nur über die API (`/documents/:id/download`,
  `/photos/:id/content`) mit derselben Rechte- und Objektprüfung wie die zugehörigen Daten.
  Keine öffentlichen URLs. Die API streamt die Datei; kurzlebige vorsignierte URLs sind nur als
  spätere Optimierung denkbar, weil sie sich vor Ablauf nicht widerrufen lassen.
- **Versionen:** `documents` mit `document_versions`; alte Versionen bleiben erhalten.
  Sichtbarkeit `internal` ist Standard; kundensichtbar nur mit `visibility = customer`,
  Veröffentlichung (Recht `documents.publish`) und `customer_id`.
- **Prüfsumme** wird beim Lesen stichprobenartig bzw. beim Wiederherstellungstest geprüft.

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| Dateien in der Datenbank (bytea) | Datenbank und Backups wachsen stark; Streaming und Versionierung schwerer. |
| Öffentliche Buckets mit unratbaren Namen | Kein Widerruf, keine Rechteprüfung (R-ROLLE-5). |
| Supabase Storage mit signierten URLs | Signierte URLs vor Ablauf nicht widerrufbar, keine Versionierung, Backups der Datenbank ohne Dateien (ADR-002). |

## Folgen

- Dateien laufen durch die API; Bandbreite und Zeitlimits sind bei der Hosting-Wahl zu
  beachten.
- Backups der Dateien getrennt von der Datenbank (`docs/architektur.md` Abschnitt 7).
- Virenprüfung hochgeladener Dateien ist nicht entschieden (Prüfpunkt Betrieb).

## Quellen (abgerufen 26.09.2026)

- Supabase signierte URLs: https://supabase.com/docs/guides/storage/serving/downloads
- Supabase S3-Kompatibilität: https://supabase.com/docs/guides/storage/s3/compatibility
- Hetzner Object Storage (vorsignierte URLs, Versionierung, Object Lock): https://docs.hetzner.com/storage/object-storage/faq/buckets-objects/
