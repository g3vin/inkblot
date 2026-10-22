//! Trackpad gesture phases. WKWebView hands the page a trackpad swipe as plain wheel
//! events: no phase, so it cannot tell the fingers lifting from the momentum after,
//! and a swipe that should turn one panel slides on with the coast. AppKit knows, so
//! this watches the scroll events on their way into the webview and tells the page
//! when the fingers go down, when they lift, and when the coast begins.
//!
//! The page hears a `trackpad-phase` event carrying `"began"`, `"ended"` or
//! `"momentum"`; `src/lib/wheelPhase.js` keeps the result.

use tauri::AppHandle;

pub const PHASE_EVENT: &str = "trackpad-phase";

/// Start watching. Called once from setup, on the main thread.
#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
pub fn install(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::install(app.clone());
}

#[cfg(target_os = "macos")]
mod macos {
    use super::PHASE_EVENT;
    use block2::RcBlock;
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{class, msg_send};
    use std::ptr::NonNull;
    use tauri::{AppHandle, Emitter};

    // NSEventMaskScrollWheel = 1 << NSEventTypeScrollWheel (22).
    const SCROLL_WHEEL_MASK: u64 = 1 << 22;
    // NSEventPhase.
    const PHASE_BEGAN: usize = 1;
    const PHASE_ENDED: usize = 8;
    const PHASE_CANCELLED: usize = 16;

    pub fn install(app: AppHandle) {
        let handler = RcBlock::new(move |event: NonNull<AnyObject>| -> *mut AnyObject {
            let event_ptr = event.as_ptr();
            unsafe {
                // A mouse wheel has no phases and no momentum: nothing to tell.
                let precise: Bool = msg_send![event_ptr, hasPreciseScrollingDeltas];
                if precise.as_bool() {
                    let phase: usize = msg_send![event_ptr, phase];
                    let momentum: usize = msg_send![event_ptr, momentumPhase];
                    let name = if phase & PHASE_BEGAN != 0 {
                        Some("began")
                    } else if phase & (PHASE_ENDED | PHASE_CANCELLED) != 0 {
                        Some("ended")
                    } else if momentum & PHASE_BEGAN != 0 {
                        Some("momentum")
                    } else {
                        None
                    };
                    if let Some(name) = name {
                        let _ = app.emit(PHASE_EVENT, name);
                    }
                }
            }
            // Hand the event on untouched: the webview still gets every wheel event.
            event_ptr
        });

        unsafe {
            // AppKit copies the block and keeps the monitor for the life of the app.
            let _monitor: *mut AnyObject = msg_send![
                class!(NSEvent),
                addLocalMonitorForEventsMatchingMask: SCROLL_WHEEL_MASK,
                handler: &*handler
            ];
        }
    }
}
