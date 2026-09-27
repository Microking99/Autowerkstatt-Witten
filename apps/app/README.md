# @werkstatt/app

Gemeinsamer Client der Autowerkstatt Witten für iPhone, Android und Browser (Expo SDK 57,
React Native 0.86, Expo Router, React Native Web, TypeScript). Der Web-Export ist zugleich die
Grundlage der Windows-Anwendung (`apps/desktop`, Tauri).

Stand: Pakete APP-1 und APP-2. Öffentliche Ansichten, alle Kundenansichten, alle
Werkstattansichten (`/werkstatt/*`) und alle Mechanikeransichten (`/mechaniker/*`) nach
`docs/ansichten-und-routen.md` sind umgesetzt, einschließlich Offline-Warteschlange für
Mechaniker (ADR-011) und Tastaturbedienung am PC. Lager, Reifen und Ersatzwagen zeigen ehrlich
"Ergänzung, Details offen" (O-6 bis O-8). Einzelheiten und Grenzen:
`docs/uebergaben/2026-09-27-app-2.md`.

## Schnellstart

Voraussetzungen: Node 22.12 oder neuer, pnpm 10. Im Repository-Wurzelverzeichnis:

```bash
pnpm install
pnpm --filter @werkstatt/app demo      # klickbarer Entwurf mit Beispieldaten im Browser
pnpm --filter @werkstatt/app web       # Browser gegen die echte API (EXPO_PUBLIC_API_URL)
pnpm --filter @werkstatt/app start     # Expo-Entwicklungsserver (Expo Go / Entwicklungs-Build)
```

| Skript | Zweck |
|---|---|
| `start`, `web`, `android`, `ios` | Expo-Entwicklungsserver (für `android`/`ios` wird ein Emulator bzw. Gerät gebraucht) |
| `demo` | Entwicklungsserver im Browser mit `EXPO_PUBLIC_DEMO=1` |
| `export:web` | statischer Web-Export nach `dist/` |
| `export:demo` | statischer Web-Export des Demo-Modus nach `dist-demo/` |
| `typecheck` | `tsc --noEmit` |
| `test` | Unit-Tests (Vitest), vor allem Geschäftsregeln des Demo-Modus und der HTTP-Schicht |
| `e2e` | Playwright gegen `dist-demo/` (vorher `export:demo`), Telefon 390x844 und PC 1440x900 |
| `screenshots` | erzeugt die Bildschirmfotos unter `docs/entwurf/screenshots/` (Werkstatt und Mechaniker mit fester Uhr: Dienstag, 29.09.2026) |

Playwright nutzt ein vorhandenes Chromium: `PLAYWRIGHT_BROWSERS_PATH=/pfad/zu/pw-browsers`
oder `PW_CHROMIUM_EXECUTABLE=/pfad/zu/chrome`. Die Tests laden keine Browser herunter.

## Umgebungsvariablen

Nur öffentliche Werte (`EXPO_PUBLIC_*` landen im ausgelieferten Code, also nie Geheimnisse):

| Variable | Bedeutung | Vorgabe |
|---|---|---|
| `EXPO_PUBLIC_DEMO` | `1` schaltet den Demo-Modus ein (Beispieldaten im Speicher, keine Netzwerkaufrufe) | aus |
| `EXPO_PUBLIC_API_URL` | Basis-URL der API (ohne `/api/v1`) | leer: gleiche Herkunft, also relativ `/api/v1` |
| `EXPO_PUBLIC_WEB_URL` | öffentliche Web-Adresse für Links (im Demo-Modus nativ; im Browser gilt die aufgerufene Adresse) | leer |

Bundle-ID und Paketname `de.autowerkstattwitten.app` sowie die Domain sind Platzhalter
(offene Entscheidung O-12). Die App-Symbole unter `assets/images/` sind neutrale Platzhalter
(Schraubenschlüssel im Akzentton), kein endgültiges Logo.

## Demo-Modus

`EXPO_PUBLIC_DEMO=1` ersetzt die HTTP-Schicht durch `DemoApi` (`src/data/demo/`): alle Daten
sind erfundene, gekennzeichnete Beispieldaten; es gibt keine echten Kunden, Zahlungen oder
Nachrichten. Ein gelber Hinweisstreifen ist immer sichtbar. Der Zustand liegt im Browser-Tab
(`sessionStorage`) und lässt sich in der Demo-Steuerung zurücksetzen.

- Anmeldung: auf `/anmelden` gibt es Knöpfe für die Beispielzugänge (Kundin Miriam Kowalczyk,
  Vorbesitzer Günter Rohde, Inhaber Ralf Lindemann, Service Petra Wiesmann mit Recht für manuelle
  Zahlungen, Service-Aushilfe Nadine Kurz ohne Rechnungs- und Zahlungsrecht, Mechaniker Emre
  Aydın). Das Kennwort steht auf der Anmeldeseite (nur Beispielzugänge).
- Rollenwechsel: abmelden und anderen Beispielzugang wählen; der Demo-Zustand bleibt im Tab
  erhalten. So lässt sich z. B. Feststellung (Mechaniker) → Freigabeanfrage (Service) →
  Entscheidung (Kundin) → Ausführung (Mechaniker) durchspielen.
- Demo-Steuerung (Zahnrad im Hinweisstreifen): Rolle wechseln, simulierte Mitteilungen öffnen,
  Zahlungsanbieter simulieren (bezahlt, doppelt gemeldet, fehlgeschlagen, abgebrochen,
  Betrag passt nicht), Werkstatt-Aktionen (Termin bestätigen oder Alternative vorschlagen,
  Angebot ändern, antworten, Auftrag abschließen), Verbindungsfehler für die nächste Anfrage,
  Offline-Modus (für die Offline-Warteschlange der Mechaniker), Zurücksetzen.
- Einstiege ohne Anmeldung (Beispiel-Codes aus `src/data/demo/constants.ts`):
  `/q/qr-golf-M4k8Tz2Wp7` (öffentliche Kurzansicht), `/q/qr-octavia-R3n9Xb5Lq1` (nur Hinweis),
  `/f/fzg-golf-verkauf-8Kd3Rt6Wm1Qx` (Freigabe für Kaufinteressenten),
  `/einladung/einladung-brinkhoff-7Qm2Xr9Kd4Lp`, `/passwort-neu/neues-passwort-kowalczyk-5Tg8Wp3Nv`.
- Zahlung: "Jetzt bezahlen" öffnet eine deutlich als Simulation gekennzeichnete Anbieterseite.
  Die Rechnung wird erst "Bezahlt", wenn in der Demo-Steuerung eine Anbieterbestätigung
  simuliert und (wie später im Server) Betrag, Währung, Händler und Rechnung geprüft wurden.

Die Geschäftsregeln der DemoApi (`src/data/demo/rules/`) nutzen wie die API
`@werkstatt/domain` (Rechte, Freigabe-Hash, Zahlungsabgleich, Servicehistorie, Fälligkeiten,
Arbeitsstatus) und bilden die 409-Regeln der API nach (`approval_required` nach bestätigter
Annahme, `approval_in_execution`, Stornierung zieht offene Anfragen zurück, Mechaniker sehen
Fahrzeugakte und interne Dokumente nur über laufende Zuweisungen). Verbindlich entscheidet
allein der Server (`apps/api`); die Demo ist kein Ersatz dafür.

## Aufbau

```
app/                      Routen (Expo Router), genau nach docs/ansichten-und-routen.md
  anmelden, einladung/, passwort-*, q/, f/, zahlung/rueckkehr, nicht-verfuegbar
  kunde/                  alle Kundenansichten (inkl. Annahme bestätigen, Datenexport)
  werkstatt/              Übersicht, Kalender, Termine, Kunden, Fahrzeuge, Aufträge mit Registern,
                          Nachrichten, Rechnungen, Wartungen, Benutzer, Einstellungen, Protokoll
  mechaniker/             Heute, Auftrag, Position, Feststellung, Checkliste [E], Sync, Konto
src/
  theme/                  Tokens aus @werkstatt/design-tokens, hell/dunkel, Breakpoints
  ui/                     Bausteine (Button, TextField, Select, DateTimeField, Tabs, DataTable,
                          StatusChip/StatusTriple, Banner/Toast, ConfirmDialog, Sheet, PageHeader,
                          KeyValueList, Timeline, PhotoGrid, ChatBubble, MoneyText, ...)
  data/                   WerkstattApi (Schnittstelle), HttpApi, DemoApi, ApiError, Hooks
  auth/                   Sitzung, Token-Speicher (SecureStore nativ, sessionStorage im Web),
                          Bereichsschutz, sichere Weiterleitung nach der Anmeldung
  navigation/             Rahmen je Rolle (Telefon: Tabs unten, Tablet/PC: Leiste bzw. Seitenleiste)
  notifications/          Push-Registrierung und Öffnen von Mitteilungen (nicht im Demo-Modus)
  demo/                   Demo-Steuerung und simulierte Anbieterseite
  offline/                Offline-Warteschlange (Client-IDs, Idempotency-Key, Reihenfolge,
                          Konflikte), Lesecache für Mechaniker, Fotos dauerhaft ablegen
  screens/                gemeinsam genutzte Ansichtsteile (workshop/, mechanic/, customer/)
e2e/                      Playwright: Klickwege A bis G, Zugang, Werkstatt (w-*), Mechaniker (m-*),
                          Bildschirmfotos (*screenshots.spec.ts, nur mit SCREENSHOTS=1)
```

Datenzugriff läuft ausschließlich über `useApi()` und die Schnittstelle `WerkstattApi`
(`src/data/api.ts`); die Methodennamen entsprechen den Endpunkten in
`packages/contracts/src/api.ts`. `HttpApi` setzt Bearer-Token und Idempotency-Key, prüft im
Entwicklungsmodus die Antworten mit den zod-Schemas und bildet Fehler auf `ApiError` ab.

## Was getestet ist und womit

- Unit-Tests (Vitest, Node): Regeln der DemoApi (versionierte Freigaben mit Hash, Zahlungsabgleich
  und Doppelmeldungen, Servicehistorie mit Revisionen, Fälligkeiten, Zugriff auf fremde Akten,
  QR und Freigabelinks, 409-Regeln aus dem API-Review), HTTP-Schicht, Offline-Warteschlange
  (Wiederholung, Idempotenz, Reihenfolge, Konflikt).
- End-to-End (Playwright, Chromium) gegen den Web-Export im Demo-Modus, in zwei Größen, für
  Kunden-, Werkstatt- und Mechanikerabläufe (Liste in der Übergabe APP-2).

Nicht getestet: iOS-, Android- und Windows-Builds. Ein Browser-Test ist kein Nachweis für diese
Plattformen. Es wurden keine EAS- oder Store-Befehle ausgeführt.

## Bekannte Grenzen

- Push: Registrierung braucht später eine EAS-Projekt-ID und einen Entwicklungs-Build; im Web
  und im Demo-Modus aus.
- Dokumente öffnen: im Web als Blob, nativ über `expo-file-system` und das Teilen-Menü (nur
  typgeprüft, nicht auf einem Gerät getestet).
- Bilder mit Anmeldung: nativ über Header, im Web über `useAuthImage` (Abruf mit Token, Blob-URL).
- Offline-Warteschlange liegt in AsyncStorage (ADR-011 nennt SQLite); Fotos werden nativ in das
  Dokumentverzeichnis kopiert, im Web bis 4 MB als Daten-URL gespeichert (größere gehen nach
  Neuladen verloren).
- Token im Web liegt in `sessionStorage` (Tab-gebunden); HttpOnly-Cookie ist eine offene
  Entscheidung für das Backend.
- Weitere Punkte: `docs/uebergaben/2026-09-26-app-1.md`, `docs/uebergaben/2026-09-27-app-2.md`.
