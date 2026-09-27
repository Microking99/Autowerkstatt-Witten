//! Windows-Hülle der Werkstattsoftware.
//!
//! Die Oberfläche ist der Web-Export von `apps/app` (Expo Router). Die Hülle stellt keine
//! eigenen Befehle bereit: Alle Daten laufen über die API mit serverseitiger Rechteprüfung.
//! Externe Links (z. B. die Zahlungsseite des Anbieters) öffnen im Standardbrowser.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("Fehler beim Start der Anwendung");
}
