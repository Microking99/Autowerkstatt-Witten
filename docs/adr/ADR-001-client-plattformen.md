# ADR-001: Client-Plattformen

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** R-PLAT-1 bis R-PLAT-5, R-IA-4

## Kontext

Gefordert sind eine native iPhone-App, eine native Android-App (keine PWA), eine
Windows-Anwendung mit echtem Installer und ein geschützter Browserzugang, alle auf derselben
Datenbasis. Entwickelt wird überwiegend in einem Linux-Container ohne Mac und ohne
Windows-Rechner. Das Team ist klein; Rechte, Routen und Schemas sollen zwischen Clients und
Backend geteilt werden (TypeScript).

## Entscheidung

1. **iPhone, Android und Browser:** ein Client mit **Expo / React Native, SDK 57** (React
   Native 0.86) und **Expo Router** in TypeScript (`apps/app`). iOS- und Android-Builds laufen
   über **EAS Build** in der Expo-Cloud; iOS braucht dadurch keinen eigenen Mac. Der Browserzugang
   ist der statische Web-Export desselben Clients.
2. **Windows:** eine **Tauri-2-Hülle** um den statischen Web-Export (`apps/desktop`) mit
   **NSIS-Installer** (`setup.exe`), gebaut auf einem GitHub-Actions-Windows-Runner.
3. **Electron** mit electron-builder bleibt Rückfallebene, falls Tauri scheitert oder die
   Microsoft-Store-Verteilung als MSIX gewählt wird (O-20).

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| Flutter (stabil 3.47.5) | Echte Windows-Ausgabe, aber iOS-Builds brauchen einen Mac oder einen Cloud-Mac-Dienst (z. B. Codemagic), `flutter build windows` braucht einen Windows-Rechner, und Flutter Web ist laut eigener Doku nicht für textlastige, dokumentartige Seiten geeignet (Kundenportal, Rechnungen). Keine gemeinsame Sprache mit einem TypeScript-Backend. |
| Kotlin / Compose Multiplatform | Web (Wasm) nur Beta; iOS braucht macOS; Desktop-Pakete lassen sich nicht querkompilieren ("Cross-compilation is currently not supported"). |
| react-native-windows | Hinkt React Native hinterher (0.84 gegenüber RN 0.86 in Expo SDK 57), Entwicklung nur unter Windows mit Visual Studio, von Expo nicht als Plattform unterstützt. Ein gemeinsamer RN-Stand für Mobil und Windows wäre nicht möglich. |
| Electron | Funktioniert, bringt aber ein eigenes Chromium mit (größere Installation, häufige Sicherheitsupdates). Vorteil nur beim Store-Weg über MSIX. Daher Rückfallebene. |
| PWA / reine Web-App | Vom Auftrag ausdrücklich ausgeschlossen (R-PLAT-1, R-PLAT-2). |

## Folgen

- **Offen benannt:** Die Windows-Oberfläche läuft in **WebView2** und rendert keine nativen
  Windows-Steuerelemente. Sie ist eine installierte Anwendung mit echtem Installer, aber
  technisch dieselbe Oberfläche wie im Browser. Tastaturbedienung und PC-Layout
  (`docs/designsystem.md`) gleichen das für die Arbeit am PC aus.
- Tauri akzeptiert nur statische Ausgaben (SPA/SSG), keine serverseitig gerenderten Routen.
  Alle Geschäftslogik liegt daher in der API.
- Die Tauri-Hülle stellt keine eigenen Befehle bereit; externe Links (Zahlungsseite) öffnen
  im Standardbrowser.
- Tauri erzeugt nur EXE/MSI, kein MSIX; ohne eigenes Code-Signing-Zertifikat warnt Windows
  SmartScreen (O-20). MSI entsteht nur unter Windows, NSIS-Querbau unter Linux ist nur
  Notlösung, daher Windows-Runner.
- Expo-SDK-Wechsel etwa alle paar Monate einplanen (SDK 58 ist seit 15.09.2026 in Beta und
  setzt das iOS-27-SDK voraus). Tauri 3 ist in Alpha; `apps/desktop` bleibt auf Tauri 2.
- Mobile Entwicklung nutzt Development Builds, nicht Expo Go.
- Push im Browser wird von `expo-notifications` nicht unterstützt (ADR-010, O-22).
- **Nichts davon ist bisher auf echten Geräten oder als Build getestet** (`docs/status.md`).

## Quellen (abgerufen 26.09.2026)

- Expo SDK 57: https://expo.dev/changelog/sdk-57, SDK 58 Beta: https://expo.dev/changelog/sdk-58-beta
- EAS Build: https://docs.expo.dev/build/introduction/, EAS Submit: https://docs.expo.dev/submit/introduction/
- Expo Web-Export: https://docs.expo.dev/guides/publishing-websites/
- Tauri Frontend (nur SSG/SPA/MPA): https://v2.tauri.app/start/frontend/
- Tauri Windows-Installer: https://v2.tauri.app/distribute/windows-installer/
- Tauri Microsoft Store (nur EXE/MSI): https://v2.tauri.app/distribute/microsoft-store/
- Flutter Web FAQ: https://docs.flutter.dev/platform-integration/web/faq
- Compose Multiplatform, Plattformen: https://kotlinlang.org/docs/multiplatform/supported-platforms.html, Desktop-Pakete: https://kotlinlang.org/docs/multiplatform/compose-native-distribution.html
- react-native-windows: https://microsoft.github.io/react-native-windows/, Expo-Plattformunterstützung: https://docs.expo.dev/modules/additional-platform-support/
- expo-notifications (Plattformen Android, iOS): https://docs.expo.dev/versions/latest/sdk/notifications/
