# Funktionsdiagramm

Bezug: R-IA-1. Funktionen je Rolle mit getrennten Bereichen. Rechte und Objektregeln im Detail:
`docs/rollen-und-rechte.md`; Routen: `docs/ansichten-und-routen.md`. Alle Funktionen laufen
über die API mit serverseitiger Rechteprüfung; die Diagramme zeigen, **wer** eine Funktion
nutzt, nicht, wo sie geprüft wird.

Legende: durchgezogene Linie = Standard der Rolle; gestrichelte Linie = nur mit zusätzlich
zugewiesenem Recht (`○` in `docs/rollen-und-rechte.md`); **[E]** = Ergänzung, Details offen.

## 1. Überblick: Rollen, Bereiche, System

```mermaid
flowchart TB
  subgraph ROLLEN["Rollen"]
    RA["Inhaber / Admin"]
    RS["Sekretariat / Service"]
    RM["Mechaniker"]
    RK["Kunde"]
    RD["Kaufinteressent / Dritte<br/>ohne Konto"]
  end
  subgraph BEREICHE["Bereiche der App"]
    BW["Werkstatt<br/>Pfad /werkstatt"]
    BM["Mechaniker<br/>Pfad /mechaniker"]
    BK["Kunde<br/>Pfad /kunde"]
    BO["Öffentlich begrenzt<br/>QR /q und Freigabe /f"]
  end
  API["API /api/v1<br/>Anmeldung, Rechte, Objektregeln"]
  SYS["System und Hintergrund<br/>Outbox, Zahlungsabgleich, Fälligkeiten, Audit"]
  RA --> BW
  RS --> BW
  RM --> BM
  RA -.->|"mit workItems.execute"| BM
  RS -.->|"mit workItems.execute"| BM
  RK --> BK
  RD --> BO
  BW --> API
  BM --> API
  BK --> API
  BO --> API
  API --> SYS
```

## 2. Inhaber / Admin

Der Admin hat alle Werkstattfunktionen des Service (Abschnitt 3) und zusätzlich:

```mermaid
flowchart TB
  RA["Inhaber / Admin"]
  subgraph NURADMIN["Nur Admin"]
    A1["Mitarbeiter einladen, Rollen und Rechte ändern, deaktivieren"]
    A2["Einstellungen: Werkstattdaten, Wartungsarten und Intervalle, Hebebühnen, Benachrichtigungen, Vorlagen"]
    A3["Zahlungsanbindung konfigurieren<br/>ohne Anzeige von Schlüsseln"]
    A4["Änderungsprotokoll einsehen"]
  end
  subgraph STANDARDADMIN["Standard für Admin, für Service zuweisbar"]
    A5["Überweisung oder Barzahlung manuell zuordnen"]
    A6["Erstattung auslösen"]
    A7["Serviceeintrag korrigieren<br/>neue Revision"]
  end
  WS["alle Funktionen der Werkstatt<br/>siehe Abschnitt 3"]
  RA --> A1
  RA --> A2
  RA --> A3
  RA --> A4
  RA --> A5
  RA --> A6
  RA --> A7
  RA --> WS
```

Festlegungen: Der letzte aktive Admin kann nicht deaktiviert werden. Niemand, auch nicht der
Admin, kann im Namen eines Kunden freigeben oder ablehnen.

## 3. Sekretariat / Service

```mermaid
flowchart TB
  RS["Sekretariat / Service"]
  subgraph PLANUNG["Planung"]
    S1["Übersicht mit Kacheln"]
    S2["Kalender: Termine anlegen, Konflikte prüfen"]
    S3["Terminanfragen bestätigen oder Alternative vorschlagen"]
  end
  subgraph STAMM["Kunden und Fahrzeuge"]
    S4["Kunden anlegen, suchen, Akte pflegen"]
    S5["Kunden zur App einladen, Zugang sperren"]
    S6["Fahrzeuge anlegen, km erfassen"]
    S7["Halterwechsel buchen"]
    S8["QR-Aufkleber drucken, QR-Token erneuern"]
  end
  subgraph AUFTRAG["Aufträge"]
    S9["Auftrag anlegen: Kunde, Fahrzeug, Leistungen"]
    S10["Fahrzeugannahme erfassen, bestätigen lassen"]
    S11["Mechaniker zuweisen, Positionen planen"]
    S12["Freigabeanfrage erstellen, senden, ändern, zurückziehen"]
    S13["Dokumente hochladen, veröffentlichen"]
    S14["Kunden-Chat und interne Notizen"]
    S15["Fachlichen Abschluss bestätigen"]
    S16["Abholbereit und abgeholt melden"]
  end
  subgraph GELD["Rechnungen"]
    S17["Rechnung anlegen, PDF hochladen, stellen, stornieren"]
    S18["Offene Posten, Zahlungsversuche, Export CSV"]
  end
  S19["Fällige Wartungen: Kunde kontaktieren, Termin anlegen"]
  RS --> PLANUNG
  RS --> STAMM
  RS --> AUFTRAG
  RS --> GELD
  RS --> S19
  RS -.->|"optional"| S20["Positionen selbst ausführen<br/>workItems.execute"]
  RS -.->|"optional"| S21["Manuelle Zahlung, Erstattung, Korrektur Servicehistorie, Protokoll"]
```

## 4. Mechaniker

```mermaid
flowchart TB
  RM["Mechaniker"]
  subgraph HEUTE["Nur zugewiesene Aufträge und Positionen"]
    M1["Heute: meine Aufträge"]
    M2["Auftrag: Fahrzeug, Annahme mit internen Hinweisen, bisherige Servicehistorie"]
    M3["Position starten, pausieren, abschließen<br/>nur vereinbart oder freigegeben"]
    M4["Zeiten und verbaute Teile erfassen"]
    M5["Feststellung mit Fotos erfassen"]
    M6["Zusatzarbeit an Service melden<br/>kein Freigabeknopf"]
    M7["Notiz diktieren [E]"]
    M8["Abschlusscheckliste [E]"]
  end
  M9["Synchronisierung: nicht übertragene Einträge, Konflikte"]
  RM --> HEUTE
  RM --> M9
  RM -.->|"optional"| M10["Alle Aufträge, Kunden, Fahrzeuge, Termine lesen"]
  RM -.->|"optional"| M11["Fahrzeugannahme erfassen"]
  RM -.->|"optional, O-17 Standard nein"| M12["Kunden-Chat"]
  RM -.->|"optional"| M13["Fachlichen Abschluss bestätigen"]
```

Nie für Mechaniker: Preise, Rechnungen, Zahlungen, Kontaktdaten der Kunden,
Benutzerverwaltung, Einstellungen, Kundenfreigaben.

## 5. Kunde

```mermaid
flowchart TB
  RK["Kunde<br/>Konto per Einladung"]
  subgraph FZG["Meine Fahrzeuge, nur aktueller Halterzeitraum"]
    K1["Fahrzeugdaten, letzter km-Stand, Fälligkeiten"]
    K2["Servicehistorie ansehen"]
    K3["Fahrzeug für Dritte freigeben, widerrufen"]
    K4["Öffentliche QR-Kurzansicht ein oder aus"]
  end
  subgraph AUF["Meine Aufträge"]
    K5["Arbeitsstand, drei getrennte Status"]
    K6["Angebot oder Zusatzarbeit freigeben oder ablehnen"]
    K7["Chat mit der Werkstatt, Fotos senden"]
    K8["Veröffentlichte Dokumente öffnen"]
  end
  subgraph ZAHL["Rechnungen"]
    K9["Rechnung ansehen, PDF laden"]
    K10["Jetzt bezahlen über SumUp"]
    K11["Überweisungsdaten anzeigen"]
  end
  subgraph TERM["Termine"]
    K12["Termin anfragen"]
    K13["Alternative annehmen oder ablehnen, absagen"]
  end
  K14["Konto: Profil, Benachrichtigungen, Passwort, Geräte"]
  RK --> FZG
  RK --> AUF
  RK --> ZAHL
  RK --> TERM
  RK --> K14
```

## 6. Kaufinteressent / Dritte

```mermaid
flowchart LR
  RD["Kaufinteressent oder Dritter<br/>kein Konto"]
  D1["Link /f/token öffnen"]
  D2["Nur vom Halter ausgewählte Serviceeinträge<br/>Marke, Modell, optional FIN"]
  D3["Hinweis: abgelaufen oder widerrufen"]
  Q1["QR-Code scannen /q/token"]
  Q2["Öffentliche Kurzansicht<br/>nur wenn vom Halter eingeschaltet"]
  Q3["Hinweis Serviceheft und Anmeldung"]
  RD --> D1
  D1 -->|"gültig"| D2
  D1 -->|"abgelaufen oder widerrufen"| D3
  RD --> Q1
  Q1 -->|"Kurzansicht an"| Q2
  Q1 -->|"Standard"| Q3
```

Nie sichtbar: Namen, Kontaktdaten, Kennzeichen, Preise, Rechnungen, Dokumente, Nachrichten,
Aufträge.

## 7. System / Hintergrund

```mermaid
flowchart LR
  subgraph AUSLOESER["Auslöser"]
    E1["Fachliche Ereignisse in der API<br/>Freigabe gesendet, Rechnung gestellt, Termin bestätigt"]
    E2["SumUp-Webhook"]
    E3["Zeitplan"]
  end
  subgraph JOBS["Hintergrundfunktionen"]
    J1["Outbox-Zustellung<br/>Push, E-Mail, In-App mit Wiederholung"]
    J2["Zahlungsabgleich<br/>Status beim Anbieter abfragen, veraltete Checkouts deaktivieren"]
    J3["Fälligkeiten berechnen, Erinnerungen vormerken"]
    J4["Aufräumen: abgelaufene Sitzungen, Einladungen, Idempotenzschlüssel"]
  end
  subgraph IMMER["In jeder Anfrage"]
    J5["Rechte- und Objektprüfung"]
    J6["Audit-Protokoll, nur anfügbar"]
    J7["Idempotenz bei Wiederholungen"]
  end
  E1 --> J1
  E2 --> J2
  E3 --> J2
  E3 --> J3
  E3 --> J4
```

## 8. Modul, Funktionen, Rollen

A = Admin, S = Service, M = Mechaniker, K = Kunde, D = Dritte; (o) = nur mit zugewiesenem
Recht; "eigene" = Objektregel (zugewiesen bzw. eigener Kundendatensatz).

| Modul | Funktionen | Rollen |
|---|---|---|
| Anmeldung und Konto | Anmelden, Einladung annehmen, Passwort vergessen/ändern, Geräte, Benachrichtigungseinstellungen | A, S, M, K |
| Dashboard / Start | Kacheln je Rolle mit gefilterten Zielen; Kunde: offene Entscheidungen, Rechnungen, Termin | A, S, M (eigene), K (eigene) |
| Kalender und Termine | Termine planen, Konflikte (Hebebühne, Mitarbeiter, Teile), Anfragen bestätigen, Alternative, Absage | A, S; M (o) lesen; K eigene anfragen, Alternative annehmen/ablehnen, absagen |
| Kunden | Liste, Suche, Akte, anlegen, ändern, archivieren, zur App einladen, sperren | A, S; M (o) lesen |
| Fahrzeuge | Akte, km-Historie, Halterzeiträume, Halterwechsel, QR-Aufkleber, QR-Token erneuern | A, S; M (o) lesen; K eigene aktuelle lesen |
| Fahrzeugannahme | Beanstandung, km, Schäden, Fotos, vereinbarte Leistungen, Kostenrahmen, Bestätigung | A, S; M (o) |
| Aufträge | Anlegen mit Kunde/Fahrzeug im Entwurf, planen, zuweisen, Status, fachlicher Abschluss, abholbereit | A, S; M (o) Abschluss; K eigene lesen |
| Ausführung | Positionen starten/pausieren/abschließen, Zeiten, Teile, Feststellungen, Fotos, Zusatzarbeit melden | M (eigene), A, S (o) |
| Freigaben | Anfrage erstellen, senden, ändern (neue Version), zurückziehen; entscheiden | A, S erstellen; **nur K** entscheidet (eigene Aufträge) |
| Dokumente und Fotos | Hochladen, Versionen, veröffentlichen, zurückziehen, herunterladen | A, S; M (o) interne lesen; K veröffentlichte eigene |
| Chat | Nachrichten mit Fotos, interne Notizen getrennt | A, S; M (o, O-17); K eigene Aufträge; interne Notizen nie K |
| Rechnungen und Zahlungen | Rechnung anlegen/stellen/stornieren, Checkout, Abgleich, manuelle Zahlung, Erstattung, Export | A, S; manuelle Zahlung und Erstattung A, S (o); K eigene ansehen und bezahlen |
| Servicehistorie und Fälligkeiten | Einträge aus Abschluss, Korrektur als Revision, Fälligkeiten, fällige Wartungen | System erzeugt; A korrigiert, S (o); A, S, M (o) lesen; K eigene aktuelle Fahrzeuge |
| QR und Freigaben für Dritte | QR-Einstieg, öffentliche Kurzansicht, befristete Freigabe ausgewählter Einträge | K steuert eigene; D sieht nur Freigegebenes |
| Benutzerverwaltung | Einladen, Rollen, Rechte, deaktivieren | nur A |
| Einstellungen | Werkstattdaten, Wartungsarten, Hebebühnen, Vorlagen, Benachrichtigungen, Zahlungsanbindung | nur A |
| Änderungsprotokoll | Protokoll mit Filter, Auftragsverlauf | A; S (o); Auftragsverlauf für berechtigte Mitarbeiter |
| Benachrichtigungen | In-App, Push, E-Mail mit Deep Link | alle Rollen mit Konto; System stellt zu |
| Offline-Synchronisierung | Warteschlange, Konflikte ansehen | M; Chat-Entwürfe alle |
| Ergänzungen [E] | Lager (O-6), Reifeneinlagerung (O-7), Ersatzwagen (O-8), Diktat (O-9), Checklisten (O-10) | offen |
