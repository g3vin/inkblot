//! Printing the webview on paper of an exact size.
//!
//! `window.print()` cannot choose the paper, and in a WKWebView it does nothing at
//! all. Print Layout needs more than a print: it has already laid out every sheet at
//! its real size, so the print must use exactly that paper, no margins and no
//! scaling, or every page would be shrunk to fit a default Letter page with margins.
//! So this drives WebKit's own print operation (`-[WKWebView printOperationWithPrintInfo:]`)
//! with a print info set up for the job.
//!
//! PDF export is the same operation with the "save" disposition: a real multi-page
//! PDF at the page size, which `createPDF` (one tall page) cannot give.

use tauri::Webview;

#[cfg(target_os = "macos")]
mod mac {
    use objc2::encode::{Encode, Encoding};
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{class, msg_send};

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    unsafe impl Encode for CGSize {
        const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
    }

    /// An autoreleased NSString.
    unsafe fn ns_string(value: &str) -> *mut AnyObject {
        let bytes = value.as_ptr();
        let len = value.len();
        let alloc: *mut AnyObject = msg_send![class!(NSString), alloc];
        // NSUTF8StringEncoding = 4.
        let string: *mut AnyObject = msg_send![alloc, initWithBytes: bytes, length: len, encoding: 4usize];
        msg_send![string, autorelease]
    }

    /// Run the print operation on `webview` (a `WKWebView *`). Main thread only.
    pub unsafe fn print(webview: *mut AnyObject, job_name: &str, width_pt: f64, height_pt: f64, pdf_path: Option<&str>) {
        let shared: *mut AnyObject = msg_send![class!(NSPrintInfo), sharedPrintInfo];
        let info: *mut AnyObject = msg_send![shared, copy];
        let info: *mut AnyObject = msg_send![info, autorelease];

        let _: () = msg_send![info, setPaperSize: CGSize { width: width_pt, height: height_pt }];
        // NSPaperOrientationPortrait = 0, Landscape = 1: must agree with the paper, or
        // AppKit rotates the job.
        let orientation: isize = if width_pt > height_pt { 1 } else { 0 };
        let _: () = msg_send![info, setOrientation: orientation];
        let _: () = msg_send![info, setTopMargin: 0.0f64];
        let _: () = msg_send![info, setBottomMargin: 0.0f64];
        let _: () = msg_send![info, setLeftMargin: 0.0f64];
        let _: () = msg_send![info, setRightMargin: 0.0f64];
        // NSPrintingPaginationModeClip = 2: never scale a sheet to fit the paper.
        let _: () = msg_send![info, setHorizontalPagination: 2isize];
        let _: () = msg_send![info, setVerticalPagination: 0isize];
        let _: () = msg_send![info, setHorizontallyCentered: Bool::NO];
        let _: () = msg_send![info, setVerticallyCentered: Bool::NO];
        let _: () = msg_send![info, setScalingFactor: 1.0f64];

        if let Some(path) = pdf_path {
            let _: () = msg_send![info, setJobDisposition: ns_string("NSPrintSaveJob")];
            let url: *mut AnyObject = msg_send![class!(NSURL), fileURLWithPath: ns_string(path)];
            let dict: *mut AnyObject = msg_send![info, dictionary];
            let _: () = msg_send![dict, setObject: url, forKey: ns_string("NSJobSavingURL")];
        }

        let op: *mut AnyObject = msg_send![webview, printOperationWithPrintInfo: info];
        if op.is_null() {
            return;
        }
        let show_panel = if pdf_path.is_some() { Bool::NO } else { Bool::YES };
        let _: () = msg_send![op, setShowsPrintPanel: show_panel];
        let _: () = msg_send![op, setShowsProgressPanel: Bool::YES];
        let _: () = msg_send![op, setJobTitle: ns_string(job_name)];

        // WKWebView renders a print asynchronously: a synchronous -runOperation prints
        // blank pages. The window-modal variant waits for it.
        let window: *mut AnyObject = msg_send![webview, window];
        let nil: *mut AnyObject = std::ptr::null_mut();
        let _: () = msg_send![
            op,
            runOperationModalForWindow: window,
            delegate: nil,
            didRunSelector: None::<objc2::runtime::Sel>,
            contextInfo: std::ptr::null_mut::<std::ffi::c_void>()
        ];
    }
}

#[tauri::command]
pub fn print_webview(
    webview: Webview,
    job_name: String,
    paper_width_pt: f64,
    paper_height_pt: f64,
    pdf_path: Option<String>,
) -> Result<(), String> {
    if !(paper_width_pt > 0.0 && paper_height_pt > 0.0) {
        return Err("paper size must be positive".into());
    }

    #[cfg(target_os = "macos")]
    {
        webview
            .with_webview(move |platform| {
                let wk = platform.inner() as *mut objc2::runtime::AnyObject;
                unsafe { mac::print(wk, &job_name, paper_width_pt, paper_height_pt, pdf_path.as_deref()) };
            })
            .map_err(|e| format!("Failed to print: {e}"))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (webview, job_name, pdf_path);
        Err("printing is only implemented on macOS".into())
    }
}
