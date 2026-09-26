# Designsystem

Verbindlich für alle Oberflächen (iPhone, Android, Browser, Windows). Tokens im Code:
`packages/design-tokens/src/index.ts`. Komponenten: `apps/app/src/ui/`.

## 1. Grundlage und Herleitung

**Design Read** (Methode aus `design-taste-frontend`, Abschnitt 0.B):
Arbeitssoftware für eine einzelne Kfz-Werkstatt: Service am PC, Mechaniker mit Telefon
oder Tablet in der Halle, Kunden am Telefon. Sprache ruhig, sachlich, vertrauenswürdig.
Umsetzung als schlankes eigenes System auf Basis der Plattformkonventionen (Apple HIG,
Material 3, Fluent 2), keine Marketing-Ästhetik.

**Quellen und wie sie verwendet werden**

| Quelle | Verwendet für | Bewusst nicht übernommen |
|---|---|---|
| `ui-ux-pro-max` v2.15.0 (Projekt-Skill) | Prioritäten der Regeln (Barrierefreiheit, Bedienflächen, Formulare, Navigation), React-Native-Stack-Regeln (`Pressable`, `hitSlop`, `accessibilityRole`), Prüfliste `references/pro-rules.md` | Vorschlag des Generators für "booking appointment service operations tool": Trichter-Muster (Landingpage), Calistoga + Inter, Hellblau mit schwarzer Schrift auf Primärfarbe. Passt nicht zu Arbeitssoftware; `--motion` nicht verwendet. |
| `design-taste-frontend` (Taste) | Design Read, Regler, ein Akzent, Form-Konsistenz, vollständige Zustände, Kontrastprüfungen, Beschriftung über Feldern, Verbot austauschbarer "KI-Muster" (Emojis, Gedankenstriche, gleiche Dreier-Karten, Fantasie-Kennzahlen, generische Namen, dekorative Punkte) | Landingpage-Regeln (Hero, Bento, Bildpflicht, Scroll-Animationen); der Skill schließt Dashboards, Tabellen, Formulare und native Mobile selbst aus (Abschnitt 13). |
| Apple HIG, Material 3, Fluent 2 | Plattformverhalten: Navigation, Zurück-Gesten, Systemschrift, Bedienflächen (44 pt / 48 dp), Tastaturbedienung am PC | – |

**Regler** (Taste-Skala 1-10): Gestaltungsvarianz **2** (vorhersehbar, klare Raster),
Bewegung **2** (nur Rückmeldung auf Aktionen und Zustandswechsel), Dichte je Bereich:
Werkstatt am PC **7**, Mechaniker **4**, Kunde **3**.

## 2. Farben

Ein neutrales, leicht kühles Grau und **ein** Akzent (Petrol). Statusfarben sind reserviert
und werden nie dekorativ verwendet. Kein reines Schwarz/Weiß.

| Token | Hell | Dunkel | Verwendung |
|---|---|---|---|
| `bg` | `#F3F4F6` | `#0F1215` | Seitenhintergrund |
| `surface` | `#FCFCFD` | `#171B20` | Flächen, Listen, Formulare |
| `surfaceRaised` | `#FFFFFE` | `#1E242A` | Dialoge, Blätter |
| `surfaceSunken` | `#E9EBEE` | `#0B0E11` | Eingabehintergrund deaktiviert, Tabellenkopf |
| `border` | `#D9DDE3` | `#2C333B` | Trennlinien, Feldrahmen |
| `borderStrong` | `#B8BFC8` | `#46505B` | Feldrahmen aktiv/hover |
| `text` | `#16191D` | `#ECEFF2` | Haupttext |
| `textMuted` | `#4A515B` | `#A9B1BB` | Sekundärtext |
| `textSubtle` | `#5F6671` | `#8C95A0` | Hinweise (mind. 4.5:1 auf `surface`) |
| `accent` | `#0B5F6B` | `#5FB8C4` | Primäraktionen, Links, Fokusring, Auswahl |
| `accentText` | `#FCFCFD` | `#0B1A1D` | Text auf `accent` |
| `accentSoft` | `#E1F0F2` | `#12343A` | ausgewählte Zeilen, aktive Reiter |
| `success` / `successSoft` | `#1E7A46` / `#E3F3E9` | `#5BC98A` / `#123322` | bezahlt, freigegeben, abgeschlossen |
| `warning` / `warningSoft` | `#8A5A00` / `#FFF1CC` | `#E7B34A` / `#3A2C0C` | wartet, offen, nicht synchronisiert |
| `danger` / `dangerSoft` | `#B42318` / `#FDE7E5` | `#F07A70` / `#3D1614` | Fehler, überfällig, Löschen |
| `info` / `infoSoft` | `#35517A` / `#E6EDF7` | `#8FB0DD` / `#18253A` | in Arbeit, Hinweise |
| `focus` | `#0B5F6B` | `#5FB8C4` | 2 px Fokusring + 2 px Abstand |

Kontrast: Text ≥ 4.5:1, große Schrift und Symbole ≥ 3:1, in beiden Modi geprüft
(`packages/design-tokens` enthält einen Test, der die Paare nachrechnet). Dunkelmodus folgt
der Systemeinstellung.

## 3. Typografie

Systemschrift der Plattform (SF Pro auf iOS, Roboto auf Android, Segoe UI auf Windows,
`system-ui` im Browser). Begründung: nativer Eindruck, keine Ladezeit, volle Abdeckung
deutscher Zeichen; entspricht der Empfehlung, native Oberflächen nach HIG/Material zu
gestalten. Zahlen (Beträge, km, Uhrzeiten, Nummern) mit Tabellenziffern (`tabular-nums`).
Kennzeichen und FIN mit leichtem Zeichenabstand, nie in einer Zierschrift.

| Token | Größe/Zeilenhöhe | Gewicht | Verwendung |
|---|---|---|---|
| `display` | 28/34 | 600 | Seitentitel mobil |
| `title` | 22/28 | 600 | Seitentitel PC, Abschnittstitel mobil |
| `heading` | 18/24 | 600 | Kartentitel, Registerüberschriften |
| `body` | 16/24 | 400 | Fließtext, Formulare (Minimum mobil) |
| `bodyStrong` | 16/24 | 600 | Hervorhebung |
| `dense` | 14/20 | 400 | Tabellen am PC |
| `small` | 14/20 | 400 | Hilfetexte |
| `caption` | 13/18 | 500 | Beschriftungen, Status-Chips (Minimum 12) |

Hervorhebung nur über Gewicht und Farbe, nicht über übergroße Überschriften.

## 4. Abstände, Raster, Formen

- Grundraster 4 px: `0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.
- Seitenrand: 16 (Telefon), 24 (Tablet), 32 (PC). Inhaltsbreite Formulare max. 720 px,
  Lesetexte max. 65 Zeichen.
- **Eine Radius-Skala**: Eingaben und Schaltflächen 8, Flächen/Panels 12, Blätter/Dialoge 16,
  Status-Chips voll gerundet. Keine anderen Werte.
- Tiefe: Rahmen statt Schatten. Schatten nur für schwebende Ebenen (Dialog, Menü), leicht
  und im Farbton des Hintergrunds.
- Karten nur, wenn sie eine echte Einheit bilden (z. B. Auftrag in einer Liste mobil); sonst
  Gruppierung über Abstand und Trennlinien.

## 5. Bedienung

- Mindestgröße Bedienfläche 44 × 44 pt (iOS) bzw. 48 × 48 dp (Android). **Mechanikeransicht:
  Hauptaktionen mindestens 56 pt hoch** (Annahme: Bedienung mit Handschuhen, O-13).
- Abstand zwischen Bedienflächen mindestens 8.
- Jede Berührung gibt Rückmeldung (Android Ripple, iOS Abdunkeln), jede Aktion zeigt
  Laden → Erfolg/Fehler.
- PC: vollständige Tastaturbedienung (Abschnitt 1 in `docs/ansichten-und-routen.md`),
  sichtbarer Fokus, keine reinen Hover-Funktionen.
- Symbole: **Phosphor** (eine Familie, Stärke "regular"); Symbol-Schaltflächen immer mit
  zugänglicher Beschriftung. Keine Emojis.

## 6. Bewegung

Nur für Rückmeldung und Zustandswechsel, 150-200 ms, `transform`/`opacity`. Keine
Eingangsanimationen, keine Dauerschleifen, kein Parallax. "Bewegung reduzieren" des
Systems schaltet alle Übergänge ab.

## 7. Komponenten

| Komponente | Regeln |
|---|---|
| Schaltfläche | Varianten: primär (Akzent, eine je Ansicht), sekundär (Rahmen), leise (nur Text), destruktiv (Danger). Beschriftung = Verb ("Speichern", "Freigeben", "Jetzt bezahlen"), einzeilig. Deaktiviert nur mit erklärendem Hinweis. |
| Textfeld | Beschriftung über dem Feld, Hilfetext darunter, Fehlertext direkt am Feld (Symbol + Text), nie Platzhalter als Beschriftung. Pflichtfelder markiert. Validierung beim Verlassen und beim Speichern. |
| Auswahl/Datum/Zeit | Plattformeigene Picker; am PC mit Tastatur bedienbar. |
| Status-Chip | **Text + Symbol + Farbe**, nie nur Farbe. Drei getrennte Chips für Arbeit, Freigabe, Zahlung. |
| Liste/Tabelle | PC: Tabelle mit Sortierung, Filterleiste (Chips umbrechen), Tastaturnavigation, feste Kopfzeile. Mobil: dieselben Daten als Zeilen mit den zwei wichtigsten Angaben. Keine Linie unter jeder Zeile bei kurzen Listen; Zebra/Trenner nur bei dichten Tabellen. |
| Register (Tabs) | Im Auftrag und in Akten; mobil horizontal scrollbar, Auswahl bleibt in der URL. |
| Bestätigungsdialog | Für kritische Aktionen: Freigeben, Ablehnen, Bezahlen starten, Rechnung stellen/stornieren, Zahlung manuell buchen, Erstattung, Halterwechsel, Veröffentlichen, Deaktivieren, Löschen. Titel nennt die Folge ("Zusatzarbeit für 184,90 € freigeben?"), Bestätigungsknopf nennt die Aktion, "Abbrechen" ist immer da. |
| Zustände | Laden: Skeleton in der Form des Inhalts (kein Kreisel bei ganzen Seiten). Leer: Satz + nächster Schritt. Fehler: verständliche Ursache + "Erneut versuchen". Erfolg: kurze Bestätigung (Banner/Toast), bei Freigabe und Zahlung eigene Ergebnisansicht. |
| Offline-Hinweis | Leiste "Offline. Änderungen werden gespeichert und später übertragen." Nicht übertragene Einträge tragen den Chip "Nicht synchronisiert". |
| Demo-Hinweis | Im Demo-Modus dauerhaft sichtbare Leiste "Entwurf mit Beispieldaten. Keine echten Kunden, Zahlungen oder Nachrichten." |

## 8. Texte

- Kunden werden gesiezt; Texte kurz, konkret, ohne Fachjargon ("Bremsbeläge vorne sind
  abgefahren" statt "VA-Beläge < 2 mm").
- Mitarbeiteroberfläche sachlich und knapp.
- Formate: Datum `26.09.2026`, Uhrzeit `14:30`, Betrag `1.234,56 €`, Laufleistung
  `123.456 km`, Zeiträume mit Bindestrich (`8-17 Uhr`).
- Keine Gedankenstriche (— / –) in Oberflächentexten, keine Emojis, keine Fantasie-Kennzahlen.
  Beispieldaten sind realistisch, deutsch und als Beispieldaten gekennzeichnet.
- Schätzungen immer als solche benennen ("voraussichtlich", "geschätzt anhand ...").

## 9. Prüfliste vor Auslieferung einer Ansicht

1. Alle vier Zustände vorhanden (Laden, Leer, Fehler, Erfolg).
2. Kontrast hell und dunkel geprüft; Status nie nur über Farbe.
3. Bedienflächen ≥ 44 pt / 48 dp (Mechaniker ≥ 56 pt für Hauptaktionen).
4. Tastatur: Reihenfolge logisch, Fokus sichtbar, `Esc` schließt Dialoge.
5. Screenreader-Beschriftungen (`accessibilityLabel`, Rollen) gesetzt.
6. Kritische Aktion mit Bestätigung und klarer Folge.
7. Deutsche Texte geprüft: keine abgeschnittenen Wörter, lange Komposita umbrechen
   (Silbentrennung/`hyphens`), keine Gedankenstriche.
8. Prüfliste `references/pro-rules.md` aus `ui-ux-pro-max` durchgegangen.
