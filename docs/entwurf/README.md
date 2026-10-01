# Klickbarer Entwurf

Der klickbare Entwurf ist der Demo-Modus der echten App (`apps/app`, ADR-013): dieselben
Ansichten, Abläufe und Regeln wie im Betrieb, aber mit **gekennzeichneten Beispieldaten** im
Browser statt einer Verbindung zum Server. Es werden keine echten Zahlungen ausgelöst und keine
E-Mails oder Push-Nachrichten verschickt. Die Geschäftsregeln (Rechte, Freigabe-Hash,
Zahlungsabgleich, Servicehistorie, Fälligkeiten) kommen aus `@werkstatt/domain`, also aus
demselben Code wie in der API.

Stand: 27.09.2026. Geprüft nur im Browser (Chromium); kein Nachweis für iPhone, Android oder
Windows.

## Starten

```bash
pnpm install
pnpm --filter @werkstatt/app demo            # Entwicklungsserver, öffnet den Browser
# oder als statischer Export:
pnpm --filter @werkstatt/app export:demo
node apps/app/e2e/serve.mjs apps/app/dist-demo 4173   # dann http://127.0.0.1:4173/
```

Auf der Anmeldeseite stehen die Beispielzugänge; ein Klick meldet direkt an. Das
Beispielkennwort steht dort ebenfalls; es gilt nur im Demo-Modus.

| Zugang | Zweck |
|---|---|
| Kundin | Zwei Fahrzeuge, offene Freigaben und Rechnungen (Klickwege A bis G) |
| Vorbesitzer | Hat den Octavia an die Kundin verkauft; sieht eigene alte Aufträge, das Fahrzeug nicht mehr |
| Inhaber | Alle Rechte, Benutzer, Einstellungen, Protokoll |
| Service | Sekretariat und Service, darf Zahlungen manuell zuordnen |
| Service (Aushilfe) | Ohne Rechnungsrecht und ohne manuelle Zahlungen |
| Mechaniker | Nur zugewiesene Aufträge, keine Preise, Offline-Warteschlange |

Über "Demo-Steuerung" (Leiste oben) lassen sich Ereignisse simulieren, die sonst von außen
kommen: Bestätigung, Abbruch oder doppelte Meldung des Zahlungsanbieters, Verbindungsabbruch,
Offline-Betrieb, Mitteilungen. Neuladen behält den Zustand, ein neuer Tab beginnt mit frischen
Beispieldaten.

## Vorschauseite zum Zeigen

Für Vorführungen gibt es eine Vorschau mit Einstiegsseite `/vorschau`: Rollen wählen, vorgeschlagene
Rundgänge mit einem Klick, Rückweg über "Übersicht" in der Leiste oben. Sie enthält zusätzliche
Beispieldaten (12 Kunden, 16 Fahrzeuge, Aufträge in jedem Zustand, Kalender für heute, offene und
überfällige Rechnungen, fällige Wartungen). Die E2E-Tests nutzen weiter den kleineren Grundbestand.

```bash
pnpm --filter @werkstatt/app export:preview
# Ergebnis: apps/app/dist-preview/vorschau-seite.html (eine Datei, Skript eingebettet)
```

Die Datei ist für die Veröffentlichung als Seite in einem fremden Rahmen gebaut: Sie startet
unabhängig vom Pfad bei der Einstiegsseite und läuft ohne `eval` und ohne nachgeladene Dateien.
Erzeugt mit `apps/app/scripts/build-preview-page.mjs`; Konsistenz der Daten prüft
`apps/app/src/data/demo/seedPreview.test.ts`.

## Klickwege

Beschrieben in `docs/ablaeufe.md`, automatisiert in `apps/app/e2e/`:

| Klickweg | Inhalt | Test |
|---|---|---|
| A | Angebot ansehen und freigeben | `e2e/a-angebot.spec.ts` |
| B | Zusatzreparatur mit Foto freigeben oder ablehnen | `e2e/b-zusatzarbeit.spec.ts` |
| C | Rechnung bezahlen, Abbruch, doppelte Meldung | `e2e/c-rechnung.spec.ts` |
| D | Servicehistorie, Fälligkeiten, Freigabe für Kaufinteressenten | `e2e/d-servicehistorie.spec.ts` |
| E | QR-Serviceheft ohne Anmeldung | `e2e/e-qr.spec.ts` |
| F | Termin anfragen | `e2e/f-termin.spec.ts` |
| G | Rückfrage im Chat | `e2e/g-rueckfrage.spec.ts` |
| Werkstatt | Auftrag anlegen, Annahme, Rechnung, Halterwechsel, Kalenderkonflikt | `e2e/w-werkstatt.spec.ts`, `e2e/w-tastatur.spec.ts` |
| Mechaniker | Feststellung bis freigegebene Position, Abschluss mit km, offline | `e2e/m-mechaniker.spec.ts` |

Dieselben Kernabläufe laufen zusätzlich gegen die echte API (`apps/app/e2e-api/`).

## Bildschirmfotos

Alle Bilder zeigen Beispieldaten. Erzeugt mit
`pnpm --filter @werkstatt/app screenshots` (Playwright, Chromium).

### Kundin

| Ansicht | Telefon | PC |
|---|---|---|
| Anmeldung | [anmeldung-telefon](screenshots/anmeldung-telefon.png) | |
| Start | [hell](screenshots/kunde-start-telefon.png), [dunkel](screenshots/kunde-start-telefon-dunkel.png) | [kunde-start-pc](screenshots/kunde-start-pc.png) |
| Freigabe | [kunde-freigabe-telefon](screenshots/kunde-freigabe-telefon.png) | [hell](screenshots/kunde-freigabe-pc.png), [dunkel](screenshots/kunde-freigabe-pc-dunkel.png), [Dialog](screenshots/kunde-freigabe-dialog-pc.png) |
| Chat | [hell](screenshots/kunde-chat-telefon.png), [dunkel](screenshots/kunde-chat-telefon-dunkel.png) | |
| Fahrzeug | [kunde-fahrzeug-telefon](screenshots/kunde-fahrzeug-telefon.png) | [kunde-fahrzeug-pc](screenshots/kunde-fahrzeug-pc.png) |
| Servicehistorie | [dunkel](screenshots/kunde-servicehistorie-telefon-dunkel.png) | [kunde-servicehistorie-pc](screenshots/kunde-servicehistorie-pc.png) |
| Rechnung und Zahlung | [Rechnung](screenshots/kunde-rechnung-telefon.png), [Anbieterseite (simuliert)](screenshots/demo-anbieterseite-telefon.png), [wird geprüft](screenshots/zahlung-wird-geprueft-telefon.png), [bestätigt](screenshots/zahlung-bestaetigt-telefon.png) | |
| QR und Freigabelink | [QR ohne Anmeldung](screenshots/qr-einstieg-ohne-anmeldung-telefon.png), [QR-Kurzansicht](screenshots/qr-kurzansicht-telefon.png), [Freigabelink](screenshots/freigabe-link-telefon.png) | [Freigabelink](screenshots/freigabe-link-pc.png) |

### Werkstatt

| Ansicht | Telefon | PC |
|---|---|---|
| Übersicht | | [hell](screenshots/werkstatt-uebersicht-pc.png), [dunkel](screenshots/werkstatt-uebersicht-pc-dunkel.png) |
| Kalender | | [hell](screenshots/werkstatt-kalender-pc.png), [dunkel](screenshots/werkstatt-kalender-pc-dunkel.png) |
| Aufträge | [Liste](screenshots/werkstatt-auftraege-telefon.png), [Auftrag](screenshots/werkstatt-auftrag-telefon.png) | [Anlegen](screenshots/werkstatt-auftrag-anlegen-pc.png), [Übersicht](screenshots/werkstatt-auftrag-uebersicht-pc.png) |
| Freigabeanfrage mit Vorschau | | [werkstatt-freigabe-vorschau-pc](screenshots/werkstatt-freigabe-vorschau-pc.png) |
| Rechnung | | [werkstatt-rechnung-pc](screenshots/werkstatt-rechnung-pc.png) |
| Kundenakte, Fahrzeug und Halter | | [Kundenakte](screenshots/werkstatt-kundenakte-pc.png), [Halter](screenshots/werkstatt-fahrzeug-halter-pc.png) |
| Benutzer und Rechte | | [Benutzer](screenshots/werkstatt-benutzer-pc.png), [Rechte](screenshots/werkstatt-benutzer-rechte-pc.png) |

### Mechaniker

| Ansicht | Telefon |
|---|---|
| Heute | [hell](screenshots/mechaniker-heute-telefon.png), [dunkel](screenshots/mechaniker-heute-telefon-dunkel.png) |
| Position | [hell](screenshots/mechaniker-position-telefon.png), [dunkel](screenshots/mechaniker-position-telefon-dunkel.png) |
| Feststellung | [mechaniker-feststellung-telefon](screenshots/mechaniker-feststellung-telefon.png) |
| Übertragung offline | [mechaniker-sync-offline-telefon](screenshots/mechaniker-sync-offline-telefon.png) |

## Grenzen des Entwurfs

- Lager, Reifeneinlagerung und Ersatzwagen sind Platzhalter (Entscheidungen O-6 bis O-8).
- Die Checkliste der Mechaniker bleibt auf dem Gerät (O-10); Dokumentvorlagen fehlen (E-1).
- Der QR-Aufkleber wird im Demo-Modus nicht als Bild erzeugt.
- Datums- und Zeitfelder folgen der Sprache des Browsers.
