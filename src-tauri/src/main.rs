// Release builds on Windows run without a console window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Desktop binary. All wiring lives in the library — see `lib.rs`.

fn main() {
    inkblot_lib::run()
}
