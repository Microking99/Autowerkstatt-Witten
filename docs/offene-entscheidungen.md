# Offene Entscheidungen

Stand: 26.09.2026. Jede Zeile hat eine **Standardannahme**, mit der gebaut wird, bis der
Inhaber entscheidet. Standardannahmen sind so gewählt, dass sie ohne größeren Umbau
geändert werden können. Rechtliche Hinweise sind keine Rechtsberatung; Prüfpunkte stehen in
`docs/pruefpunkte-recht-und-betrieb.md`.

Spalte "Entscheidet": I = Inhaber, St = mit Steuerberater, R = mit rechtlicher Beratung,
K = Koordination (Claude Code) nach Rücksprache mit dem Inhaber.

## Übersicht

| ID | Frage | Standardannahme (reversibel) | Auswirkung | Kosten-/Rechtsbezug | Entscheidet | Stand |
|---|---|---|---|---|---|---|
| E-1 | Eigene Angebots- und Rechnungserstellung in der Software oder Hochladen fertiger Dokumente? | **Hochladen**: PDF plus Gesamtbetrag und USt-Aufschlüsselung; Rechnungsnummer wird beim Stellen erfasst. | Eigene Erstellung verlangt Pflichtangaben, fortlaufende Nummern, unveränderbare Archivierung und später E-Rechnung. | § 14 UStG (Pflichtangaben), GoBD, E-2 | I, St | offen |
| E-2 | Muss die Software E-Rechnungen (XRechnung/ZUGFeRD) erzeugen? | **Vorerst nein.** Datenmodell der Rechnung nah an EN 16931 halten; Empfang von E-Rechnungen läuft außerhalb der App (E-Mail-Postfach genügt laut BMF). | Betrifft nur Rechnungen an Unternehmen im Inland. Details unten. | BMF-FAQ E-Rechnung, Stand März 2026 | I, St | offen |
| E-3 | Schnittstelle zum Steuerberater (z. B. DATEV-Export)? | **CSV-Export** der Rechnungen und Zahlungen (R-DOK-3), kein DATEV-Format. | DATEV-Format und -Schnittstelle sind nicht recherchiert; Spike C-06. | Abstimmung mit dem Steuerberater | I, St | offen |
| O-2 | SumUp: Konto, Vertrag, Gebühren, Aktivierung von Apple Pay und Google Pay, Sandbox-Zugang | **Online-Zahlung aus** (`payment_provider = none`), nur Überweisung sichtbar, bis Konto und Sandbox-Schlüssel vorliegen. | Ohne Konto kein Ende-zu-Ende-Test (`docs/zahlungen.md` Abschnitt 12). | Laut SumUp 2,50 % je Online-Zahlung, keine Monatsgebühr, API-Konditionen verhandelbar (Stand 26.09.2026); für andere Rechtsformen als Einzelunternehmen Aktivierung der Wallets beim Support | I | offen |
| O-3 | Dürfen telefonisch erteilte Freigaben erfasst werden? | **Nein.** Freigaben nur durch das Kundenkonto in der App bzw. im Browser. | Bei "ja" wäre ein eigener, gekennzeichneter Kanal mit Mitarbeiter, Zeitpunkt und Gesprächsnotiz nötig, der nie wie eine Kundenentscheidung aussieht. | Beweisbarkeit; ggf. R | I | offen |
| O-4 | Sieht der neue Halter nach einem Halterwechsel die Servicehistorie? | **Ja, nur den technischen Teil** (Datum, km, Arbeit, Fälligkeit, Werkstatt), ohne Auftragsbezug, Preise, Dokumente des Vorbesitzers. | Umgesetzt in ADR-008; ändert die Sichtbarkeitsregel, nicht das Datenmodell. | Datenschutz (Vorbesitzerdaten), ggf. R | I | offen |
| O-5 | Hosting-Anbieter und Kosten (Server, PostgreSQL, Dateispeicher, Backups) | **EU, bevorzugt Deutschland**; verwaltetes PostgreSQL mit täglicher Sicherung; S3-kompatibler Speicher mit Versionierung. Kein öffentliches Deployment ohne Freigabe. | Anhaltspunkte: Supabase Pro ab 25 USD/Monat je Organisation, PITR zusätzlich; Hetzner Object Storage (Falkenstein, Nürnberg) mit Versionierung und Object Lock. Preise weiterer Anbieter nicht recherchiert. | Kosten; AV-Vertrag; Datenstandort | I | offen |
| O-6 | Lagerführung für Teile? | **Nein**, nur Teilebedarf je Auftrag (`part_demands`) mit Status. | Lager und Lieferantenanbindung wären eigenes Paket. | Aufwand | I | offen |
| O-7 | Reifeneinlagerung? | **Nicht umgesetzt**, Datenmodell vorbereitet (`tire_storage`). | Paket C-05 nach Entscheidung. | Aufwand | I | offen |
| O-8 | Ersatzwagen? | **Nicht umgesetzt**, Datenmodell vorbereitet. | Buchung, Übergabeprotokoll, Kosten. | Aufwand; ggf. Versicherung (R) | I | offen |
| O-9 | Diktierfunktion für Mechanikernotizen? | **Spracheingabe des Geräts** (Tastatur-Diktat von iOS/Android), **kein Cloud-Dienst** der Software. | Kennzeichnung `findings.dictated`. Ob die Gerätefunktion selbst Daten an Apple/Google sendet, hängt von deren Einstellungen ab. | Datenschutz | I | offen |
| O-10 | Abschlusschecklisten mit Pflichtpunkten? | **Optional**, ohne Pflichtpunkte; Vorlagen je Auftragsart vorbereitet. | Pflichtpunkte könnten den Abschluss blockieren. | Aufwand | I | offen |
| O-11 | Rechtsform der Werkstatt | **Keine Annahme möglich**, wird gebraucht. | Apple: Einzelunternehmer registrieren sich als Einzelperson, dann erscheint der persönliche Name als Verkäufer; Organisationen brauchen D-U-N-S-Nummer, Website, Domain-E-Mail. Google Play: Organisationskonto empfohlen; private Konten nach 13.11.2023 brauchen 12 Tester über 14 Tage vor der Produktion. Windows-Signatur mit Azure Artifact Signing nur für Organisationen in der EU, Einzelpersonen nur USA/Kanada. SumUp: Wallet-Aktivierung für Nicht-Einzelunternehmen beim Support. | Store-Konten, Signatur | I | offen |
| O-12 | App-Name, Bundle-ID, Domain | Platzhalter: Name "Autowerkstatt Witten", Kennung `de.autowerkstattwitten.*`, URL-Schema `autowerkstatt`, Domain offen. | Domain wird für Universal Links, E-Mail-Versand (SPF/DKIM/DMARC), Web-Zugang und Cookies (O-21) gebraucht. Bundle-IDs sind nach Store-Veröffentlichung praktisch nicht änderbar. | Markenrecht (R), Domainkosten | I | offen |
| O-13 | Bedienung mit Handschuhen, Tablets in der Halle | **Telefon**, Hauptaktionen für Mechaniker mindestens 56 pt hoch (`docs/designsystem.md`). | Tablets oder robuste Geräte ändern Layout und Anschaffungskosten. | Gerätekosten | I | offen |
| O-14 | Zwei-Faktor-Anmeldung für Mitarbeiter | **Nicht aktiv**, Datenmodell nicht blockiert. Empfehlung: mindestens für Admin. | Zusätzlicher Anmeldeschritt, Wiederherstellungsweg nötig. | Sicherheit (TOMs) | I | offen |
| O-15 | Bankanbindung für den Abgleich von Überweisungen | **Manuelle Zuordnung** mit Recht und Protokoll. | Optionen CAMT.053-Import, FinTS/EBICS, PSD2-Kontoinformationsdienst (nicht recherchiert; `docs/zahlungen.md` Abschnitt 5). | Kosten des Dienstes, Zugangsdaten der Bank | I | offen |
| O-16 | Aufbewahrungs- und Löschkonzept | **Nichts wird automatisch gelöscht**; fachlich relevante Daten werden archiviert statt gelöscht. | Gesetzliche Aufbewahrung (u. a. 10/8/6 Jahre nach AO und HGB, 8 Jahre für Rechnungen nach UStG) gegen Speicherbegrenzung der DSGVO abwägen; Löschfristen je Datenart festlegen. | AO § 147, HGB § 257, UStG § 14b, DSGVO; St, R | I, St, R | offen |
| O-17 | Kunden-Chat für Mechaniker | **Nein** (Recht `messages.customerChat` für Mechaniker nicht standardmäßig). | Bei "ja" pro Mechaniker zuweisbar. | | I | offen |
| O-18 | Öffentliche QR-Kurzansicht | **Aus**; der Halter kann sie für sein Fahrzeug einschalten. | Ohne Anmeldung zeigt der QR-Code nur einen Hinweis. | Datenschutz | I | offen |
| O-19 | E-Mail-Anbieter mit Datenhaltung in der EU | **SMTP-Adapter**, Anbieter offen; in Entwicklung nur Test-Postfach bzw. Protokoll. | Kandidaten laut Recherche: Amazon SES (Region Frankfurt), Brevo, Mailjet (EU-Datenhaltung nur aus Suchergebnissen der Anbieterseiten, nicht direkt geprüft). Resend speichert Kontodaten laut eigener Doku in den USA. Preise nicht recherchiert. | AV-Vertrag, Drittlandübermittlung (R) | I | offen |
| O-20 | Verteilung der Windows-Anwendung | **Unsignierter NSIS-Installer nur für interne Tests.** Für den Echtbetrieb Entscheidung nötig. | Optionen: signierter NSIS mit Azure Artifact Signing (ca. 9,99 USD/Monat, nur Organisationen in der EU) oder OV-Zertifikat (laut Microsoft typisch 150 bis 300 USD/Jahr); Microsoft Store kostenlos, aber freie Neusignatur nur für MSIX, das Tauri nicht erzeugt (dann Electron oder Umverpackung). Automatische Updates über den Tauri-Updater brauchen ein eigenes Schlüsselpaar. | Kosten, O-11 | I | offen |
| O-21 | Speicherung des Sitzungstokens im Browser | **`sessionStorage`** (Anmeldung endet mit dem Tab bzw. Fenster). | HttpOnly-Cookie schützt vor Auslesen durch Skripte, braucht aber CSRF-Schutz und gemeinsame Domain (O-12). | Sicherheit | K, I | offen |
| O-22 | Push-Benachrichtigungen im Browser | **Nein**; Browser-Kunden erhalten E-Mail und In-App-Hinweise. | Web-Push bräuchte eine eigene Umsetzung (Service Worker, VAPID), `expo-notifications` unterstützt nur Android und iOS. | Aufwand | I | offen |

## E-2 im Detail: E-Rechnung (laut BMF-FAQ, Stand März 2026)

Quelle: Bundesministerium der Finanzen, "Fragen und Antworten zur Einführung der
obligatorischen (verpflichtenden) E-Rechnung zum 1. Januar 2025", Stand März 2026, Seite
datiert 23.03.2026: https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.htm

- **Empfang:** "Allerdings muss ein Unternehmen seit dem 1. Januar 2025 den Empfang einer
  E-Rechnung sicherstellen. Dazu reicht bereits ein E-Mail-Postfach aus." Betrifft die
  Werkstatt als Empfänger (z. B. Teilelieferanten), nicht diese Software.
- **Ausstellung:** Vom 1. Januar 2025 bis 31. Dezember 2026 dürfen alle Aussteller statt einer
  E-Rechnung eine sonstige Rechnung ausstellen (Papier immer; PDF per E-Mail nur mit
  Zustimmung des Empfängers). "Bei einem Vorjahresumsatz des Rechnungsausstellers bis
  800.000 Euro verlängert sich diese Frist noch bis zum Ablauf des Jahres 2027." Danach ist
  bei Umsätzen zwischen inländischen Unternehmen die E-Rechnung Pflicht, also **ab 2027**
  bzw. **ab 2028** bei Vorjahresumsatz bis 800.000 Euro.
- **Privatkunden:** "Insbesondere private Endverbraucher sind von diesen Regelungen nicht
  betroffen."
- **Ausnahmen** u. a.: Kleinbeträge bis 250 Euro brutto (§ 33 UStDV), Leistungen von
  Kleinunternehmern (§ 34a UStDV).
- **Formate:** "Insbesondere die in Deutschland üblichen Formate XRechnung und ZUGFeRD ab
  Version 2.0.1 (mit Ausnahme der Profile MINIMUM und BASIC-WL) erfüllen die
  umsatzsteuerlichen Voraussetzungen für eine E-Rechnung."
- **Aufbewahrung:** Laut FAQ gilt nach § 14b Abs. 1 UStG eine Aufbewahrung von acht Jahren; bei
  einer E-Rechnung ist zumindest der strukturierte Teil unversehrt aufzubewahren.

Für die Entscheidung benötigt: Vorjahresumsatz (bis oder über 800.000 Euro) und Anteil der
Geschäftskunden mit Rechnungen über 250 Euro. Die Bewertung für die Werkstatt trifft der
Inhaber mit dem Steuerberater.

## Weitere Quellen (abgerufen 26.09.2026)

- SumUp Gebühren: https://www.sumup.com/de-de/online-zahlungen/; Aktivierung Wallets: https://developer.sumup.com/online-payments/apm/
- Supabase Preise: https://supabase.com/pricing; Hetzner Object Storage: https://docs.hetzner.com/storage/object-storage/faq/buckets-objects/
- Apple Developer Program: https://developer.apple.com/programs/enroll/
- Google Play Testanforderungen: https://support.google.com/googleplay/android-developer/answer/14151465, Kontotyp: https://support.google.com/googleplay/android-developer/answer/13634885
- Azure Artifact Signing: https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart; Code-Signing-Optionen: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- Tauri Microsoft Store: https://v2.tauri.app/distribute/microsoft-store/; Tauri-Updater: https://v2.tauri.app/plugin/updater/
- E-Mail: Amazon SES: https://docs.aws.amazon.com/general/latest/gr/ses.html; Resend Regionen: https://resend.com/docs/dashboard/domains/regions
- expo-notifications: https://docs.expo.dev/versions/latest/sdk/notifications/
- Aufbewahrung: https://www.gesetze-im-internet.de/ao_1977/__147.html, https://www.gesetze-im-internet.de/hgb/__257.html, https://www.gesetze-im-internet.de/ustg_1980/__14b.html
