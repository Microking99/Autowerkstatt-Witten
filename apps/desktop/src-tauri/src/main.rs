// Unter Windows im Release-Build kein zusätzliches Konsolenfenster öffnen.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    autowerkstatt_witten_lib::run()
}
