//! The app's own windows — the main one and each detached document — built here
//! rather than from tauri.conf.json or the page, so their webviews never show Apple
//! Intelligence's Writing Tools ("Write with Siri"). A writer's words are theirs.
//!
//! WebKit reads `WKWebViewConfiguration.writingToolsBehavior` once, when the webview
//! is made; setting it on a live webview does nothing, and the page has no attribute
//! for it. So the main window is `"create": false` in the config and built in setup,
//! and the page asks for a detached window with `open_document_window` instead of
//! `new WebviewWindow`. Both hand wry a configuration with the behaviour set to none.
//!
//! On macOS 27 that no longer hides the "Edit with Siri" affordance by a selection:
//! AppKit asks the view's `allowsWritingToolsAffordance`, and WKWebView answers yes
//! whatever the behaviour. So the webview's class also answers no for a view whose
//! behaviour is none.
//! The Pinterest browser windows keep the default: they are not for writing.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};

type Builder<'a> = WebviewWindowBuilder<'a, Wry, AppHandle>;

/// Build the main window from its entry in tauri.conf.json. Called from setup.
pub fn build_main(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .unwrap_or_default();
    build(WebviewWindowBuilder::from_config(app, &config)?)
}

fn build(builder: Builder<'_>) -> tauri::Result<WebviewWindow> {
    let window = without_writing_tools(builder).build()?;
    #[cfg(target_os = "macos")]
    window.with_webview(|platform| {
        static INSTALLED: std::sync::Once = std::sync::Once::new();
        let view = platform.inner() as *mut objc2::runtime::AnyObject;
        // SAFETY: `view` is the window's live WKWebView.
        INSTALLED.call_once(|| unsafe { hide_affordance_when_off(&*view) });
    })?;
    Ok(window)
}

/// Open a detached document window (src/lib/docWindow.js says what goes in it).
/// `x`/`y` put its top-left corner at that screen point, in logical px.
#[tauri::command]
// A command's parameters are its IPC arguments, named by the page's invoke().
#[allow(clippy::too_many_arguments)]
pub async fn open_document_window(
    app_handle: AppHandle,
    label: String,
    url: String,
    title: String,
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(), String> {
    if let Some(existing) = app_handle.get_webview_window(&label) {
        let _ = existing.show();
        return existing.set_focus().map_err(|e| e.to_string());
    }

    // The configuration is main-thread only in AppKit, and commands are not.
    let (sent, received) = std::sync::mpsc::channel();
    let app = app_handle.clone();
    app_handle
        .run_on_main_thread(move || {
            let mut builder = WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()))
                .title(title)
                .inner_size(width, height)
                .resizable(true)
                .focused(true);
            if let (Some(x), Some(y)) = (x, y) {
                builder = builder.position(x, y);
            }
            let _ = sent.send(build(builder).map(|_| ()));
        })
        .map_err(|e| format!("run_on_main_thread failed: {e}"))?;
    received
        .recv()
        .map_err(|e| format!("window was not built: {e}"))?
        .map_err(|e| format!("Failed to open document window: {e}"))
}

#[cfg(target_os = "macos")]
fn without_writing_tools(builder: Builder<'_>) -> Builder<'_> {
    use objc2::runtime::{AnyObject, NSObjectProtocol};
    use objc2::{msg_send, sel, MainThreadMarker};
    use objc2_web_kit::WKWebViewConfiguration;

    // Building a window happens on the main thread (setup, or the closure above).
    let Some(mtm) = MainThreadMarker::new() else {
        return builder;
    };
    // SAFETY: a fresh configuration, made on the main thread.
    let config = unsafe { WKWebViewConfiguration::new(mtm) };
    // NSWritingToolsBehaviorNone = -1. macOS 15.1 added the property; before it there
    // are no Writing Tools to turn off.
    if config.respondsToSelector(sel!(setWritingToolsBehavior:)) {
        let raw: &AnyObject = &config;
        // SAFETY: the selector exists (checked) and takes an NSInteger.
        let _: () = unsafe { msg_send![raw, setWritingToolsBehavior: -1isize] };
    }
    builder.with_webview_configuration(config)
}

/// Override `allowsWritingToolsAffordance` on the class of `view` (wry's WKWebView
/// subclass, shared by every webview), deferring to WebKit unless Writing Tools are off.
#[cfg(target_os = "macos")]
unsafe fn hide_affordance_when_off(view: &objc2::runtime::AnyObject) {
    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use objc2::{class, ffi, msg_send, sel};

    extern "C-unwind" fn allows_affordance(this: &AnyObject, _cmd: Sel) -> Bool {
        // SAFETY: `this` is a WKWebView, which has both methods (checked at install).
        unsafe {
            let behavior: isize = msg_send![this, writingToolsBehavior];
            if behavior == -1 {
                return Bool::NO;
            }
            msg_send![super(this, class!(WKWebView)), allowsWritingToolsAffordance]
        }
    }

    let selector = sel!(allowsWritingToolsAffordance);
    // Older WebKit has no affordance to hide.
    if class!(WKWebView).instance_method(selector).is_none() {
        return;
    }
    let cls: *const AnyClass = view.class();
    // SAFETY: the signature matches the "B@:" types, and wry's class defines no
    // method of this name, so this adds an override rather than replacing one.
    let imp: Imp =
        std::mem::transmute(allows_affordance as extern "C-unwind" fn(&AnyObject, Sel) -> Bool);
    ffi::class_addMethod(cls as *mut AnyClass, selector, imp, c"B@:".as_ptr());
}

#[cfg(not(target_os = "macos"))]
fn without_writing_tools(builder: Builder<'_>) -> Builder<'_> {
    builder
}
