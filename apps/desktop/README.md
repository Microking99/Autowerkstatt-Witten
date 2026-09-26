# Windows-Anwendung (Tauri 2)

Die PC-Anwendung ist eine schlanke Tauri-2-Hülle um den Web-Export von `apps/app`
(Entscheidung und Begründung: `docs/adr/ADR-001-client-plattformen.md`). Sie bringt einen
echten Windows-Installer (NSIS, `setup.exe`) mit; die Oberfläche läuft in der
Windows-Webansicht (WebView2). Die Hülle stellt keine eigenen Befehle bereit: Alle Daten laufen
über die API mit serverseitiger Rechteprüfung. Externe Links (z. B. die Zahlungsseite des
Anbieters) öffnen im Standardbrowser.

## Bauen

Voraussetzungen unter Windows: Node 22, pnpm 10, Rust (stable), Microsoft C++ Build Tools,
WebView2 (in Windows 10/11 vorhanden; der Installer lädt ihn sonst nach).

```bash
pnpm install
pnpm --filter @werkstatt/app export:web      # erzeugt apps/app/dist
pnpm --filter @werkstatt/desktop build:windows
# Ergebnis: apps/desktop/src-tauri/target/release/bundle/nsis/Autowerkstatt Witten_0.1.0_x64-setup.exe
```

Alternativ ohne eigenen Windows-Rechner: GitHub Actions → "Windows-Installer" → "Run workflow"
(`.github/workflows/windows-desktop.yml`). Das Feld `api_origin` setzt die erlaubte
API-Adresse in der Content-Security-Policy; ohne Angabe sind nur lokale Adressen erlaubt.

## Stand der Prüfung

| Prüfung | Ergebnis |
|---|---|
| Rust-Kompilierprüfung (`cargo check`) unter Linux | siehe `docs/status.md` |
| Windows-Build (NSIS) | **nicht ausgeführt** (kein Windows-Rechner in dieser Umgebung; Workflow vorbereitet) |
| Start und Bedienung unter Windows | **nicht getestet** |
| Signatur | **nicht eingerichtet**: Der Installer ist unsigniert, Windows SmartScreen warnt. Optionen: Azure Artifact Signing (nur für Organisationen in der EU), OV-Zertifikat, Microsoft Store (MSIX). Offene Entscheidung O-20. |
| Automatische Updates | nicht eingerichtet (Tauri-Updater benötigt ein eigenes Signaturschlüsselpaar; offene Entscheidung O-20) |

## Konfiguration

- `src-tauri/tauri.conf.json`: Name, Fenster, Content-Security-Policy (Standard: nur
  `localhost:3000` für die lokale API), Installer-Einstellungen (Deutsch, Installation für alle
  Benutzer).
- Kennung `de.autowerkstattwitten.desktop` ist ein Platzhalter (offene Entscheidung O-12).
- Symbole: `src-tauri/icons/` aus `packages/design-tokens/assets/icon-rounded.png`
  (`pnpm --filter @werkstatt/desktop icons`).
