//! The macOS traffic lights. They sit at one place for the window's life, the landing
//! page's (the left sidebar's first row is centred on the same line), placed at launch
//! before the first frame so they never jump; the page only shows and hides them with
//! the left sidebar.
//!
//! The main window sets no `trafficLightPosition`: tao would re-apply that inset on
//! every resize, over this placement, and how high it puts the buttons depends on
//! AppKit's own offset inside the titlebar, so the page could not line a row up with it. Here the page says
//! where the buttons' centre line is, and the buttons are put there exactly: the
//! titlebar container is made twice that tall and the buttons centred in it. AppKit
//! (and tao) lay the titlebar out again on a resize, on leaving fullscreen and at other
//! times of their own, so the window's last placement is kept and re-applied after a
//! resize and whenever the titlebar's container or buttons move.

use tauri::WebviewWindow;

/// Where the buttons sit until the page says otherwise: the close button's left edge,
/// and their centre line, in logical px from the window's top-left. Matches
/// `DEFAULT_TRAFFIC_LIGHTS` in src/lib/trafficLights.js.
pub const DEFAULT_X: f64 = 20.0;
pub const DEFAULT_CENTER_Y: f64 = 30.0;

/// Put the window's lights at the default placement. Called from setup, after the
/// config's windows are built and before the run loop draws them.
#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
pub fn place_default(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    if let Ok(ns_window) = window.ns_window() {
        let placement = macos::Placement {
            visible: true,
            x: DEFAULT_X,
            center_y: DEFAULT_CENTER_Y,
        };
        macos::place(window.label(), ns_window as usize, placement);
    }
}

/// Show or hide the window's traffic lights and centre them on `center_y` (logical px
/// from the window's top), the close button's left edge at `x`. A no-op off macOS, and
/// in fullscreen, where AppKit owns the buttons.
#[tauri::command]
#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
pub fn window_traffic_lights(
    window: WebviewWindow,
    visible: bool,
    x: f64,
    center_y: f64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let ns_window = window
            .ns_window()
            .map_err(|e| format!("No native window: {e}"))? as usize;
        let label = window.label().to_string();
        let placement = macos::Placement {
            visible,
            x,
            center_y,
        };
        window
            .run_on_main_thread(move || macos::place(&label, ns_window, placement))
            .map_err(|e| format!("Failed to place the traffic lights: {e}"))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use block2::RcBlock;
    use objc2::encode::{Encode, Encoding};
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{class, msg_send};
    use std::collections::HashMap;
    use std::ffi::CString;
    use std::ptr::NonNull;
    use std::sync::{Mutex, OnceLock};

    #[derive(Clone, Copy)]
    pub struct Placement {
        pub visible: bool,
        pub x: f64,
        pub center_y: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Point {
        x: f64,
        y: f64,
    }
    unsafe impl Encode for Point {
        const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Size {
        width: f64,
        height: f64,
    }
    unsafe impl Encode for Size {
        const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect {
        origin: Point,
        size: Size,
    }
    unsafe impl Encode for Rect {
        const ENCODING: Encoding = Encoding::Struct("CGRect", &[Point::ENCODING, Size::ENCODING]);
    }

    // NSWindowButton: Close = 0, Miniaturize = 1, Zoom = 2.
    const BUTTONS: [usize; 3] = [0, 1, 2];
    // NSWindowStyleMaskFullScreen.
    const FULLSCREEN_MASK: usize = 1 << 14;
    // AppKit spaces the buttons 20px apart; used if it reports nothing better.
    const BUTTON_SPACING: f64 = 20.0;
    // After these, AppKit has laid the titlebar out again.
    const RELAYOUT_NOTIFICATIONS: [&str; 2] = [
        "NSWindowDidResizeNotification",
        "NSWindowDidExitFullScreenNotification",
    ];

    // Posted for any view whose frame changes; the titlebar's container and its buttons
    // are matched by hand, as AppKit can swap them out (leaving fullscreen does).
    const FRAME_CHANGED_NOTIFICATION: &str = "NSViewFrameDidChangeNotification";

    /// Each window's last placement, by label, and whether it is being watched.
    static PLACEMENTS: Mutex<Option<HashMap<String, (Placement, bool)>>> = Mutex::new(None);

    /// The gap AppKit leaves between the buttons' left edges.
    static NATIVE_SPACING: OnceLock<f64> = OnceLock::new();

    thread_local! {
        // Set while `apply` moves the views, whose own frame changes would call it again.
        static APPLYING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    }

    /// Record the placement, watch the window if it isn't yet, and apply it now.
    pub fn place(label: &str, ns_window: usize, placement: Placement) {
        let watch = {
            let mut guard = PLACEMENTS.lock().unwrap_or_else(|e| e.into_inner());
            let map = guard.get_or_insert_with(HashMap::new);
            let watched = map.get(label).map(|(_, watched)| *watched).unwrap_or(false);
            map.insert(label.to_string(), (placement, true));
            !watched
        };
        if watch {
            observe(label.to_string(), ns_window);
        }
        unsafe { apply(ns_window as *mut AnyObject, placement) };
    }

    fn observe(label: String, ns_window: usize) {
        unsafe {
            let center: *mut AnyObject = msg_send![class!(NSNotificationCenter), defaultCenter];
            for name in RELAYOUT_NOTIFICATIONS {
                let label = label.clone();
                let block = RcBlock::new(move |_note: NonNull<AnyObject>| {
                    reapply(&label, ns_window);
                    // AppKit lays the titlebar out again after the notification, in the
                    // same pass as the resize, so place them once more on the next turn
                    // of the run loop, when it has finished.
                    let label = label.clone();
                    let later = RcBlock::new(move || reapply(&label, ns_window));
                    let queue: *mut AnyObject = msg_send![class!(NSOperationQueue), mainQueue];
                    let _: () = msg_send![queue, addOperationWithBlock: &*later];
                });
                let Ok(cname) = CString::new(name) else {
                    continue;
                };
                let ns_name: *mut AnyObject =
                    msg_send![class!(NSString), stringWithUTF8String: cname.as_ptr()];
                // Kept for the window's life: the observer token is never removed, and
                // the block is a no-op once the window has gone (no notifications come).
                let _token: *mut AnyObject = msg_send![
                    center,
                    addObserverForName: ns_name,
                    object: ns_window as *mut AnyObject,
                    queue: std::ptr::null_mut::<AnyObject>(),
                    usingBlock: &*block
                ];
            }

            // AppKit also lays the titlebar out on its own (on focus, a screen or scale
            // change, an appearance change), shrinking the container back under the
            // buttons and clipping them at the window's top. Any move of the container or
            // a button puts them back.
            let block = RcBlock::new(move |note: NonNull<AnyObject>| {
                if APPLYING.with(|applying| applying.get()) {
                    return;
                }
                let view: *mut AnyObject = msg_send![note.as_ptr(), object];
                if !view.is_null() && is_titlebar_view(ns_window as *mut AnyObject, view) {
                    reapply(&label, ns_window);
                }
            });
            let Ok(cname) = CString::new(FRAME_CHANGED_NOTIFICATION) else {
                return;
            };
            let ns_name: *mut AnyObject =
                msg_send![class!(NSString), stringWithUTF8String: cname.as_ptr()];
            let _token: *mut AnyObject = msg_send![
                center,
                addObserverForName: ns_name,
                object: std::ptr::null_mut::<AnyObject>(),
                queue: std::ptr::null_mut::<AnyObject>(),
                usingBlock: &*block
            ];
        }
    }

    /// Whether `view` is the window's titlebar container or one of its buttons.
    unsafe fn is_titlebar_view(ns_window: *mut AnyObject, view: *mut AnyObject) -> bool {
        let owner: *mut AnyObject = msg_send![view, window];
        if owner != ns_window {
            return false;
        }
        let close: *mut AnyObject = msg_send![ns_window, standardWindowButton: BUTTONS[0]];
        if close.is_null() {
            return false;
        }
        if BUTTONS.iter().any(|&kind| {
            let button: *mut AnyObject = msg_send![ns_window, standardWindowButton: kind];
            button == view
        }) {
            return true;
        }
        let titlebar: *mut AnyObject = msg_send![close, superview];
        if titlebar.is_null() {
            return false;
        }
        let container: *mut AnyObject = msg_send![titlebar, superview];
        container == view
    }

    /// Apply the window's last placement, if it has one.
    fn reapply(label: &str, ns_window: usize) {
        let placement = PLACEMENTS.lock().ok().and_then(|guard| {
            guard
                .as_ref()
                .and_then(|map| map.get(label).map(|(p, _)| *p))
        });
        if let Some(placement) = placement {
            unsafe { apply(ns_window as *mut AnyObject, placement) };
        }
    }

    unsafe fn apply(ns_window: *mut AnyObject, placement: Placement) {
        APPLYING.with(|applying| applying.set(true));
        place_buttons(ns_window, placement);
        APPLYING.with(|applying| applying.set(false));
    }

    unsafe fn place_buttons(ns_window: *mut AnyObject, placement: Placement) {
        if ns_window.is_null() {
            return;
        }
        let style: usize = msg_send![ns_window, styleMask];
        if style & FULLSCREEN_MASK != 0 {
            return;
        }

        let buttons: Vec<*mut AnyObject> = BUTTONS
            .iter()
            .map(|&kind| msg_send![ns_window, standardWindowButton: kind])
            .collect();
        if buttons.iter().any(|button| button.is_null()) {
            return;
        }
        for &button in &buttons {
            let _: () = msg_send![button, setHidden: Bool::new(!placement.visible)];
        }
        if !placement.visible {
            return;
        }

        // The buttons' container: their view's view, the titlebar AppKit lays out.
        let titlebar: *mut AnyObject = msg_send![buttons[0], superview];
        if titlebar.is_null() {
            return;
        }
        let container: *mut AnyObject = msg_send![titlebar, superview];
        if container.is_null() {
            return;
        }

        let close: Rect = msg_send![buttons[0], frame];
        let mini: Rect = msg_send![buttons[1], frame];
        let window_frame: Rect = msg_send![ns_window, frame];
        let height = (placement.center_y * 2.0).max(close.size.height);

        let mut frame: Rect = msg_send![container, frame];
        frame.size.height = height;
        frame.origin.y = window_frame.size.height - height;
        let _: () = msg_send![container, setFrame: frame];

        // Measured once, from AppKit's own layout at the first placement: measured after
        // that, it is our spacing, and a read taken while AppKit is halfway through a
        // relayout (one button moved back, the others not) would carry over to every
        // later placement and leave the buttons overlapping.
        let spacing = *NATIVE_SPACING.get_or_init(|| match mini.origin.x - close.origin.x {
            gap if gap >= close.size.width => gap,
            _ => BUTTON_SPACING,
        });
        // AppKit's coordinates run up from the bottom; the container is centred on the line.
        let y = (height - close.size.height) / 2.0;
        for (i, &button) in buttons.iter().enumerate() {
            let origin = Point {
                x: placement.x + i as f64 * spacing,
                y,
            };
            let _: () = msg_send![button, setFrameOrigin: origin];
        }
    }
}
