# ADR-013: Klickbarer Entwurf als Demo-Modus der echten App

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** R-IA-4, AGENTS.md Abschnitt 5 (nur gekennzeichnete Testdaten)

## Kontext

Gefordert ist ein lokal ausführbarer, klickbarer Entwurf mit gekennzeichneten Beispieldaten
für Werkstatt-, Mechaniker- und Kundensicht. Ein separater Wegwerf-Prototyp würde
auseinanderlaufen und doppelte Arbeit erzeugen.

## Entscheidung

- Der Entwurf ist ein **Demo-Modus der echten App** (`apps/app`), gestartet mit
  `pnpm --filter @werkstatt/app demo` (Umgebungsvariable `EXPO_PUBLIC_DEMO=1`).
- Im Demo-Modus ersetzt ein **lokaler Demo-Datenadapter** die API. Er liefert dieselben
  Datenformen wie `packages/contracts`, damit Ansichten unverändert bleiben.
- **Beispieldaten** sind realistisch, deutsch und eindeutig gekennzeichnet; eine dauerhaft
  sichtbare Leiste zeigt "Entwurf mit Beispieldaten. Keine echten Kunden, Zahlungen oder
  Nachrichten." (`docs/designsystem.md`).
- Im Demo-Modus finden **keine** echten Zahlungen, E-Mails, Push-Nachrichten oder
  API-Aufrufe statt.
- Vorgesehen (Umsetzung und Details in P-04): "Jetzt bezahlen" zeigt eine gekennzeichnete
  Simulation, die den Ablauf nachstellt (Status bleibt zunächst offen, danach geprüfte
  Bestätigung), ohne einen Anbieter anzusprechen; einen Rollenwechsel zwischen Werkstatt,
  Mechaniker und Kunde gibt es nur im Demo-Modus.
- Der Web-Export des Demo-Modus (`export:demo`) ist Grundlage der Browser-Tests in der CI.

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| Separater Klick-Prototyp (Figma oder Wegwerf-Code) | Driftet von der echten App ab; Befunde aus Tests wären nicht übertragbar. |
| Demo gegen eine echte API mit Testdatenbank | Braucht laufenden Server und Datenbank; für eine schnelle Vorführung zu schwer. Bleibt für Integrationstests. |

## Folgen

- Die Trennung zwischen Demo-Adapter und echtem API-Adapter muss sauber sein; ein Build ohne
  `EXPO_PUBLIC_DEMO` darf keine Beispieldaten enthalten oder anzeigen (Prüfpunkt im Review).
- Der Demo-Modus beweist nur Abläufe und Oberflächen, nicht die serverseitigen Regeln
  (Rechte, Zahlungen, Servicehistorie). Diese prüfen Domain- und API-Tests.
