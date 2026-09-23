//! Trackpad haptics. WKWebView exposes no haptics API, so the page asks for them here.

use tauri::AppHandle;

/// Tap the trackpad: `"alignment"` (the light tick AppKit uses when a dragged object
/// snaps to a guide), `"level"` (a heavier one), or anything else for the generic
/// pattern. A no-op off macOS, on hardware without a Force Touch trackpad, and for a
/// user who has turned feedback off — the OS decides, so nothing here tries to.
#[tauri::command]
#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
pub fn perform_haptic(app_handle: AppHandle, pattern: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // NSHapticFeedbackPattern: Generic = 0, Alignment = 1, LevelChange = 2.
        let raw: isize = match pattern.as_str() {
            "alignment" => 1,
            "level" => 2,
            _ => 0,
        };

        // AppKit's feedback manager is main-thread only; commands are not.
        app_handle
            .run_on_main_thread(move || perform_haptic_pattern(raw))
            .map_err(|e| format!("Failed to perform haptic: {e}"))?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn perform_haptic_pattern(pattern: isize) {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    unsafe {
        let performer: *mut AnyObject =
            msg_send![class!(NSHapticFeedbackManager), defaultPerformer];
        if performer.is_null() {
            return;
        }

        // performanceTime: NSHapticFeedbackPerformanceTimeNow = 1.
        let _: () = msg_send![performer, performFeedbackPattern: pattern, performanceTime: 1isize];
    }
}
