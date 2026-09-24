// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Desktop binary. All wiring lives in the library — see `lib.rs`.

fn main() {
    app_lib::run()
}
