//! The macOS accent color. WebKit's `-apple-system-control-accent` keyword reports stock
//! blue to page content whatever the user picked, so the page asks for it here.

/// The accent color (System Settings → Appearance) as `#rrggbb`, or `None` elsewhere.
///
/// Synchronous on purpose: Tauri runs non-async commands on the main thread, which is
/// where AppKit wants NSColor read.
#[tauri::command]
pub fn system_accent_color() -> Option<String> {
    #[cfg(target_os = "macos")]
    return read_system_accent_color();

    #[cfg(not(target_os = "macos"))]
    None
}

#[cfg(target_os = "macos")]
fn read_system_accent_color() -> Option<String> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    unsafe {
        let accent: *mut AnyObject = msg_send![class!(NSColor), controlAccentColor];
        let srgb_space: *mut AnyObject = msg_send![class!(NSColorSpace), sRGBColorSpace];
        if accent.is_null() || srgb_space.is_null() {
            return None;
        }
        let srgb: *mut AnyObject = msg_send![accent, colorUsingColorSpace: srgb_space];
        if srgb.is_null() {
            return None;
        }
        let channel = |value: f64| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
        let r: f64 = msg_send![srgb, redComponent];
        let g: f64 = msg_send![srgb, greenComponent];
        let b: f64 = msg_send![srgb, blueComponent];
        Some(format!("#{:02x}{:02x}{:02x}", channel(r), channel(g), channel(b)))
    }
}
