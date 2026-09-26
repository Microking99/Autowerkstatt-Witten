# Anforderungen

Quelle: Projektauftrag des Werkstattinhabers (Gesprächsverlauf vom 26.09.2026). Diese Datei
gliedert den Auftrag in prüfbare Anforderungen mit IDs. Tests, Übergaben und `docs/status.md`
verweisen auf diese IDs.

Kennzeichnung:
- **[K]** Kernanforderung, eindeutig festgelegt.
- **[E]** Ergänzung aus dem Gesamtentwurf; Details sind offene Produktentscheidungen
  (siehe `docs/offene-entscheidungen.md`). Ergänzungen werden nicht mit Kernanforderungen
  vermischt.

## 1. Rahmen

| ID | Anforderung |
|---|---|
| R-ZIEL-1 [K] | Software für genau **eine** Kfz-Werkstatt. Keine SaaS-, Vertriebs-, Lizenz-, Abo- oder Mandantenverwaltung. |
| R-ZIEL-2 [K] | Vollständiger Funktionsumfang laut diesem Dokument; Umsetzung in geordneten Arbeitspaketen ohne eigenmächtige Reduktion auf ein MVP. |
| R-ZIEL-3 [K] | Oberflächen und Projektdokumentation auf Deutsch. |
| R-PLAT-1 [K] | Installierbare **native** iPhone-App (App Store / TestFlight). Keine PWA. |
| R-PLAT-2 [K] | Installierbare **native** Android-App (Google Play / interne Tests). Keine PWA. |
| R-PLAT-3 [K] | Installierbare Windows-Anwendung mit echtem Installer. |
| R-PLAT-4 [K] | Ergänzender geschützter Browserzugang, insbesondere für Kunden ohne App. |
| R-PLAT-5 [K] | Alle Anwendungen nutzen dieselbe Datenbasis; keine doppelte Datenpflege. |

## 2. Rollen und Zugriff

| ID | Anforderung |
|---|---|
| R-ROLLE-1 [K] | Rollen: Inhaber/Admin, Sekretariat/Service, Mechaniker, Kunde, Kaufinteressent (nur über ausdrückliche, widerrufbare Fahrzeugfreigabe, kein Konto nötig). Details: `docs/rollen-und-rechte.md`. |
| R-ROLLE-2 [K] | Sekretariat/Service arbeitet "entsprechend den zugewiesenen Berechtigungen": Rechte sind je Mitarbeiter anpassbar. |
| R-ROLLE-3 [K] | Mechaniker: nur zugewiesene Aufträge und Arbeitspositionen, Feststellungen, Fotos, Checklisten, Arbeitsstatus; kein Zugriff auf Buchhaltung oder Benutzerverwaltung. |
| R-ROLLE-4 [K] | Kunde: nur eigene Fahrzeuge (aktueller Halterzeitraum), eigene Aufträge, Termine, freigegebene Dokumente, Chat, Freigaben, Rechnungen, Zahlungen. |
| R-ROLLE-5 [K] | Rechte gelten serverseitig für Routen, direkte Links, Dateidownloads, Schnittstellen und Echtzeitkanäle. |
| R-ROLLE-6 [K] | Kundendatensatz und Kundenkonto sind getrennt; Kunden existieren ohne Konto; Konto wird per Einladung aktiviert. |

## 3. Werkstattmodule

### A. Dashboard
| ID | Anforderung |
|---|---|
| R-DASH-1 [K] | Rollenbezogene Kacheln: heutige Termine, offene Aufträge, ausstehende Kundenfreigaben, ungelesene Nachrichten, abholbereite Fahrzeuge, fällige Wartungen, offene Rechnungen. |
| R-DASH-2 [K] | Jede Kachel führt zur passend gefilterten Liste oder direkt zum Vorgang. |

### B. Kalender und Termine
| ID | Anforderung |
|---|---|
| R-KAL-1 [K] | Konkrete Werkstatttermine sind getrennt von Wartungsfälligkeiten und Erinnerungen. |
| R-KAL-2 [K] | Terminarten: HU, Service, Reparatur, Sonstiges (erweiterbar). |
| R-KAL-3 [K] | Termine sind mit Kunde, Fahrzeug, Auftrag und zuständigen Mitarbeitern verknüpft. |
| R-KAL-4 [K] | Planung berücksichtigt Hebebühnen, Kapazitäten und benötigte Teile; Konflikte und fehlende Voraussetzungen werden verständlich angezeigt. |
| R-KAL-5 [K] | Terminanfrage des Kunden ≠ Buchung. Bestätigung oder Alternativvorschlag durch die Werkstatt ist ein eigener, erkennbarer Schritt. |

### C. Kundenverwaltung
| ID | Anforderung |
|---|---|
| R-KUN-1 [K] | Kundenliste mit Suche und Filtern. |
| R-KUN-2 [K] | Kundenakte: Stammdaten, Kontaktdaten, Fahrzeuge, Termine, Aufträge, Dokumente, Kommunikation, Kontostatus. |
| R-KUN-3 [K] | Ein Kunde kann mehrere Fahrzeuge haben; bei Auftragsanlage sind seine Fahrzeuge direkt auswählbar. |

### D. Fahrzeugverwaltung
| ID | Anforderung |
|---|---|
| R-FZG-1 [K] | Fahrzeugakte: Kennzeichen, FIN, HSN/TSN, Marke, Modell, Kilometerstände, Kundenbezug, Aufträge, Wartungshistorie, Dokumente, QR-Serviceheft. |
| R-FZG-2 [K] | Kilometerstände mit Erfassungsdatum und Quelle speichern (Historie, keine Überschreibung). |
| R-FZG-3 [K] | Halter-/Kundenzuordnung zeitlich nachvollziehbar (Zeiträume). |
| R-FZG-4 [K] | Besitzerwechsel gibt dem neuen Besitzer keinen Zugriff auf private Dokumente, Nachrichten, Aufträge, Freigaben oder Rechnungen des Vorbesitzers. |

### E. Digitale Fahrzeugannahme
| ID | Anforderung |
|---|---|
| R-ANN-1 [K] | Erfassung: Kundenbeanstandung, Kilometerstand, vorhandene Schäden, Fotos, vereinbarte Leistungen, ggf. Kostenrahmen. |
| R-ANN-2 [K] | Interne Hinweise und kundenbestimmte Inhalte sind getrennt. |
| R-ANN-3 [K] | Bestätigung der Annahme deckt nur die dort vereinbarten Leistungen, nie spätere Zusatzarbeiten. |

### F. Aufträge
| ID | Anforderung |
|---|---|
| R-AUF-1 [K] | Auftrag verbindet Kunde, konkretes Fahrzeug, Leistungen, Termine, Mitarbeiter, Dokumente, Nachrichten, Freigaben und Abrechnung. |
| R-AUF-2 [K] | Ablauf: anlegen → Kunde → Fahrzeug → Leistungen → Angebot/Unterlagen → ggf. Kundenfreigabe → Arbeiten → Abschluss prüfen → Rechnung bereitstellen → Zahlung und Abholung. |
| R-AUF-3 [K] | Neue Kunden und Fahrzeuge während der Auftragserfassung anlegen, ohne den Entwurf zu verlieren. |
| R-AUF-4 [K] | Register im Auftrag: Übersicht, Arbeiten, Fotos, Dokumente, Chat, Freigaben, Rechnung/Zahlung, Verlauf. |
| R-AUF-5 [K] | Arbeitsstatus, Freigabestatus und Zahlungsstatus sind getrennte Felder/Anzeigen. |

### G. Mechanikeransicht
| ID | Anforderung |
|---|---|
| R-MECH-1 [K] | Zugewiesene Aufträge und Arbeitspositionen. |
| R-MECH-2 [K] | Arbeit starten, pausieren, abschließen; Feststellungen dokumentieren; Fotos aufnehmen; Teile und Arbeitszeiten erfassen; Zusatzarbeiten an den Service melden. |
| R-MECH-3 [K] | Mechaniker kann Zusatzarbeiten nicht für den Kunden freigeben. |

### H. Dokumente und einfache Buchhaltungsübersicht
| ID | Anforderung |
|---|---|
| R-DOK-1 [K] | Angebote, Rechnungen und sonstige Dokumente hochladen, eindeutig zuordnen, anzeigen, herunterladen (mit Versionen). |
| R-DOK-2 [K] | Nur veröffentlichte Kundendokumente erscheinen im Kundenzugang; interne Dokumente werden nie automatisch freigegeben. |
| R-DOK-3 [K] | Rechnungsübersicht, Zahlungsstatus, offene Posten, Export (CSV). |
| R-DOK-4 [K] | Abgrenzung zur Finanzbuchhaltung; eigene Angebots-/Rechnungserstellung, E-Rechnung und Steuerberater-Schnittstelle sind gesonderte Entscheidungen (E-1 bis E-3 in `docs/offene-entscheidungen.md`). |

### I. Benutzerverwaltung und Einstellungen
| ID | Anforderung |
|---|---|
| R-ADM-1 [K] | Mitarbeiter einladen, Rollen vergeben, Rechte ändern, Zugänge deaktivieren. |
| R-ADM-2 [K] | Konfiguration: Werkstattdaten, Benachrichtigungen, Wartungsintervalle, Dokumentvorlagen, Zahlungsanbindung. |

## 4. Chat, Zusatzarbeiten, Kundenfreigaben

| ID | Anforderung |
|---|---|
| R-CHAT-1 [K] | Auftragsbezogener Live-Chat Werkstatt ↔ Kunde mit Text und Fotos. |
| R-FRG-1 [K] | Zusatzmangel: Mitarbeiter dokumentiert mit Foto und Beschreibung; Werkstatt sendet konkreten Vorschlag mit Umfang, Preis, ggf. Terminänderung. |
| R-FRG-2 [K] | Kunde sieht verständliche Beschreibung, Fotos, Zusatzkosten, ggf. Terminänderung und die Schaltflächen "Freigeben" und "Ablehnen". |
| R-FRG-3 [K] | Entscheidung ist an genau die vorgelegte Version gebunden; freies "Ja" im Chat ersetzt keine Freigabe. |
| R-FRG-4 [K] | Protokoll: Person, Zeitpunkt, Leistungsumfang, Betrag, Dokumentversion (Inhalts-Hash). |
| R-FRG-5 [K] | Ablehnung: betroffene Zusatzarbeiten werden nicht durchgeführt und nicht als Service übernommen; separat freigegebene Arbeiten bleiben unberührt. |
| R-FRG-6 [K] | Änderung von Umfang oder Preis erfordert eine neue Entscheidung. |
| R-BEN-1 [K] | E-Mail- und App-Benachrichtigungen nach Einstellungen; Link führt nach Anmeldung direkt zum Vorgang. |

## 5. Rechnungen und Zahlungen

| ID | Anforderung |
|---|---|
| R-ZAHL-1 [K] | Ablauf: Rechnung öffnen → "Jetzt bezahlen" → Zahlungsseite des Anbieters → Zahlung → geprüfte Bestätigung → aktualisierter Status. |
| R-ZAHL-2 [K] | SumUp als bevorzugter Anbieter; gehosteter Checkout in iOS, Android und Browser erreichbar. |
| R-ZAHL-3 [K] | Apple Pay / Google Pay, soweit Anbieter und Gerät es unterstützen; Überweisung als weiterer Weg. |
| R-ZAHL-4 [K] | "Jetzt bezahlen" allein und eine Erfolgsseite ändern keinen Rechnungsstatus. |
| R-ZAHL-5 [K] | Bezahlt erst nach serverseitig geprüfter Anbieterbestätigung inkl. Betrag, Währung, Empfänger, Rechnungszuordnung. |
| R-ZAHL-6 [K] | Anbieterereignisse nach vorgesehenem Verfahren prüfen, Status zusätzlich beim Anbieter abfragen. |
| R-ZAHL-7 [K] | Mehrfach eintreffende Meldungen erzeugen keine Doppelbuchungen. |
| R-ZAHL-8 [K] | Abbruch, Fehler, ausstehend, Teilzahlung, Erstattung nachvollziehbar. |
| R-ZAHL-9 [K] | Überweisungen: Zuordnung nach geprüftem Eingang, manuell mit Berechtigung und Protokoll (Bankanbindung nur nach späterer ausdrücklicher Einrichtung). |
| R-ZAHL-10 [K] | Keine vollständigen Kartendaten im eigenen System. |
| R-ZAHL-11 [K] | Zahlung geht über den eigenen Anbieterzugang der Werkstatt; keine Plattform, die Kundengelder einsammelt. |
| R-ZAHL-12 [K] | Grenzen des Anbieters werden benannt; kein simulierter Automatismus (siehe `docs/zahlungen.md`). |

## 6. Servicehistorie und QR-Serviceheft

| ID | Anforderung |
|---|---|
| R-SERV-1 [K] | Tatsächlich ausgeführte, fachlich abgeschlossene und bestätigte Wartungsarbeit erzeugt automatisch einen Eintrag. |
| R-SERV-2 [K] | Eintrag: Datum, Kilometerstand, Arbeit, Details, Werkstatt, Auftragsbezug, nächste Fälligkeit (Zeit und/oder km). |
| R-SERV-3 [K] | Intervalle je Wartungsart auswählbar (z. B. 10.000/15.000 km, 1/2 Jahre). |
| R-SERV-4 [K] | Kombinierte Intervalle: zuerst erreichte Grenze maßgeblich. Ohne aktuellen km-Stand keine vorgetäuschte km-Fälligkeit; Schätzungen gekennzeichnet. |
| R-SERV-5 [K] | Keine Einträge aus Angebot, Freigabe, Rechnung oder Zahlung. |
| R-SERV-6 [K] | Nicht ausgeführte/abgelehnte Arbeiten erscheinen nie; wiederholte Abschlussereignisse erzeugen keine Duplikate. |
| R-SERV-7 [K] | Fachlicher Abschluss und Zahlung sind unabhängig. |
| R-SERV-8 [K] | Korrekturen nachvollziehbar (Revision), kein stilles Überschreiben. |
| R-SERV-9 [K] | Keine Anbindung an Hersteller-Servicehefte behaupten. |
| R-QR-1 [K] | QR-Aufkleber je Fahrzeug, stabiler Link, kein Neudruck nach Wartungen. |
| R-QR-2 [K] | Getrennt: geschützter Zugang des berechtigten Kunden / ausdrücklich freigegebene Ansicht für Dritte. |
| R-QR-3 [K] | QR-Code ist kein Generalschlüssel; öffentliche Inhalte ausdrücklich begrenzt, private Inhalte nur nach Berechtigungsprüfung. |
| R-QR-4 [K] | Gezielte, widerrufbare Freigabe ausgewählter Wartungsnachweise für Verkauf/Kaufinteressenten. |

## 7. Kundenoberfläche

| ID | Anforderung |
|---|---|
| R-KUI-1 [K] | Bereiche: Start, Meine Fahrzeuge, Meine Aufträge, Termine, Nachrichten, Dokumente, Rechnungen/Zahlungen, Servicehistorie. |
| R-KUI-2 [K] | Klickwege A-G (Angebot, Zusatzreparatur, Rechnung, Servicehistorie, QR, Termin, Rückfrage), jeweils inkl. fehlender Berechtigung, ungültigem Link, Verbindungsfehler, Ablehnung, Abbruch. Ausgearbeitet in `docs/ablaeufe.md`. |

## 8. Informationsarchitektur und Entwurf

| ID | Anforderung |
|---|---|
| R-IA-1 [K] | Funktionsdiagramm mit getrennten Rollen/Bereichen (`docs/funktionsdiagramm.md`). |
| R-IA-2 [K] | Seiten- und Navigationsübersicht, Verzeichnis der Ansichten und Routen (`docs/ansichten-und-routen.md`). |
| R-IA-3 [K] | Wesentliche Nutzerabläufe (`docs/ablaeufe.md`). |
| R-IA-4 [K] | Lokal ausführbarer klickbarer Entwurf mit gekennzeichneten Beispieldaten für Werkstatt-, Mechaniker- und Kundensicht (`apps/app`, Demo-Modus). |
| R-IA-5 [K] | Diagramme als bearbeitbare Quellen (Mermaid). |

## 9. Architektur, Sicherheit, Betrieb

| ID | Anforderung |
|---|---|
| R-ARCH-1 [K] | Gemeinsames Backend, dauerhafte Datenhaltung. |
| R-ARCH-2 [K] | Dateiablage mit Zugriffskontrolle. |
| R-ARCH-3 [K] | Sichere Anmeldung, Einladungen, Kontowiederherstellung. |
| R-ARCH-4 [K] | Serverbasierte Rollen- und Objektberechtigungen. |
| R-ARCH-5 [K] | Nachvollziehbare Änderungen an Freigaben, Rechnungen, Serviceeinträgen (Audit-Protokoll). |
| R-ARCH-6 [K] | Backups, Wiederherstellung, Datenexport. |
| R-ARCH-7 [K] | Datenmigrationen und kontrollierte Updates. |
| R-ARCH-8 [K] | Benachrichtigungszustellung mit Fehlerbehandlung (Wiederholung, Protokoll). |
| R-ARCH-9 [K] | Schutz vor Datenverlust bei Verbindungsabbrüchen. |
| R-ARCH-10 [K] | Offline: Umfang, lokale Speicherung, Synchronisierung, Konfliktbehandlung festgelegt; offline Erfasstes gilt nie als bestätigte Freigabe/Zahlung. |
| R-ARCH-11 [K] | Datenschutz-, Aufbewahrungs-, Rechnungs- und Zahlungsanforderungen als eigene Prüfpunkte (`docs/pruefpunkte-recht-und-betrieb.md`); keine pauschale Konformitätsbehauptung. |
| R-ARCH-12 [K] | Keine echten Zahlungen, realen Kundennachrichten, öffentlichen Deployments, kostenpflichtigen Buchungen ohne Freigabe des Inhabers. |

## 10. Ergänzungen [E]

| ID | Ergänzung | Offene Punkte |
|---|---|---|
| R-ERG-1 [E] | Teilebedarf / Lager | Umfang Lagerführung, Lieferantenanbindung (O-6) |
| R-ERG-2 [E] | Reifeneinlagerung | Lagerplätze, Saisonwechsel-Erinnerung, Preise (O-7) |
| R-ERG-3 [E] | Ersatzwagen | Buchung, Übergabeprotokoll, Kosten (O-8) |
| R-ERG-4 [E] | Diktierfunktion für Mechanikernotizen | Gerätefunktion vs. Cloud-Dienst, Datenschutz (O-9) |
| R-ERG-5 [E] | Abschlusschecklisten | Vorlagen je Auftragsart, Pflichtpunkte (O-10) |

## 11. Tests und Abnahme

Die Mindest-Testfälle aus dem Auftrag stehen mit Zuordnung zu automatisierten Tests in
`docs/tests.md` (T-01 bis T-13).
