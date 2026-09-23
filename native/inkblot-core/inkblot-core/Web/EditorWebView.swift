import AppKit
import SwiftUI
import WebKit
import os

/// The document surface: one `WKWebView` running the built editor bundle, and the two
/// channels into it.
///
///  - `inkblotBridge` carries the protocol — `OutboundMessage` JSON from the page to
///    `ShellBridge`, and `InboundMessage` JSON back through `evaluateJavaScript`.
///  - `tauri` carries the compatibility calls the bundle still makes, answered by
///    `TauriHost` (see `Web/tauri-shim.js`). It is a reply handler, so each call is a
///    promise on the page side.
///
/// The controller owns the web view and outlives SwiftUI's view updates; the
/// representable below only hands it over. A web view recreated on a state change
/// would be a reload, and a reload loses whatever the user typed in the last 800ms.
@MainActor
final class EditorWebController: NSObject {
    /// The parts of the chrome this shell draws itself; the page stops drawing them.
    /// See `src/lib/host.ts`.
    static let nativeChrome = [
        "fileTree", "windowChrome", "rightSidebar", "notePreviews",
        "tabDock", "draftPane", "sentenceBubble",
    ]

    let webView: WKWebView
    private let bridge: ShellBridge
    private let host: TauriHost
    private let log = Logger(subsystem: "inkblot", category: "webview")

    init(bridge: ShellBridge, menus: WebMenus, core: CoreService) {
        self.bridge = bridge
        self.host = TauriHost(core: core, menus: menus)

        let configuration = WKWebViewConfiguration()
        let schemes = AppSchemeHandler(webRoot: Self.webRoot)
        configuration.setURLSchemeHandler(schemes, forURLScheme: AppSchemeHandler.appScheme)
        configuration.setURLSchemeHandler(schemes, forURLScheme: AppSchemeHandler.assetScheme)
        configuration.preferences.isElementFullscreenEnabled = true

        let content = configuration.userContentController
        // Order matters: the chrome list is read by native-host.js, and both have to
        // exist before the bundle's first module evaluates.
        let chrome = (try? JSONSerialization.data(withJSONObject: Self.nativeChrome))
            .map { String(decoding: $0, as: UTF8.self) } ?? "[]"
        content.addUserScript(Self.script("window.__inkblotNativeChrome = \(chrome);"))
        content.addUserScript(Self.script(Self.resource("native-host")))
        content.addUserScript(Self.script(Self.resource("tauri-shim")))

        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        content.add(WeakHandler(self), name: "inkblotBridge")
        #if DEBUG
        // The page's errors, in the unified log (`log stream --predicate
        // 'subsystem == "inkblot"'`). Without this a page that fails to boot is a blank
        // window and a Web Inspector nobody has open.
        content.add(WeakHandler(self), name: "inkblotConsole")
        content.addUserScript(Self.script(Self.consoleForwarder))
        #endif
        content.addScriptMessageHandler(WeakReplyHandler(self), contentWorld: .page, name: "tauri")

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isInspectable = true
        // The page paints its own background; letting the window's show through during
        // the first frame avoids a white flash in dark mode.
        webView.underPageBackgroundColor = .clear
        webView.setValue(false, forKey: "drawsBackground")

        menus.activate = { [weak self] rid in
            self?.webView.evaluateJavaScript("window.__inkblotTauri.activateMenuItem(\(rid))")
        }

        // Model progress and dictation, as the Tauri events the page already listens for.
        // The main window's page only: a detached window starting dictation too would
        // have its words typed into both.
        ModelService.shared.emit = { [weak self] event, payloadJSON in
            self?.emitTauriEvent(event, payloadJSON: payloadJSON)
        }
        // Detached and Pinterest windows opening, loading and closing.
        AuxiliaryWindows.shared.register(self)

        _ = MouseDownRecorder.shared
        webView.load(URLRequest(url: Self.startURL))
    }

    /// Where the window's chrome lives, for sheets and fullscreen checks.
    func attach(to window: NSWindow?) {
        host.window = window
        AuxiliaryWindows.shared.mainWindow = window
    }

    func reload() {
        webView.reload()
    }

    /* ---------------- where the page comes from ---------------- */

    static var webRoot: URL {
        Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
    }

    /// The bundle embedded at build time — or, with `INKBLOT_DEV_URL` set in the
    /// scheme's environment (e.g. `http://localhost:5173`), Vite's dev server, so a web
    /// edit shows up without rebuilding the app. Everything else is the same either way:
    /// the scripts are injected by WebKit, not served.
    static var startURL: URL {
        if let dev = ProcessInfo.processInfo.environment["INKBLOT_DEV_URL"], let url = URL(string: dev) {
            return url
        }
        return AppSchemeHandler.appURL
    }

    static func resource(_ name: String) -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8)
        else {
            fatalError("\(name).js is missing from the app bundle — it is in Web/, which the target copies.")
        }
        return source
    }

    static func script(_ source: String) -> WKUserScript {
        WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    /* ---------------- the bridge ---------------- */

    fileprivate func receiveBridge(_ body: Any) {
        guard let json = body as? String else {
            log.error("The page posted a bridge message that is not a string.")
            return
        }
        bridge.receive(json: json)
    }

    private func deliver(_ json: String) {
        // The message is a JSON document; encoding it again as a JSON *string* is what
        // makes it a safe JavaScript literal, quotes and newlines included.
        guard let data = try? JSONEncoder().encode(json) else { return }
        let literal = String(decoding: data, as: UTF8.self)
        webView.evaluateJavaScript("window.__inkblotNative.deliver(\(literal))") { [log] _, error in
            if let error { log.error("Delivering to the page failed: \(error.localizedDescription, privacy: .public)") }
        }
    }

    /// Raise a Tauri event in the page, through the shim's listener table — aimed at
    /// one window's listeners when `label` names one.
    func emitTauriEvent(_ event: String, payloadJSON: String, label: String? = nil) {
        webView.evaluateJavaScript(TauriEvents.script(event, payloadJSON: payloadJSON, label: label)) { [log] _, error in
            if let error { log.error("Emitting \(event, privacy: .public) failed: \(error.localizedDescription, privacy: .public)") }
        }
    }

    fileprivate func receiveConsole(_ body: Any) {
        log.error("page: \(String(describing: body), privacy: .public)")
    }

    #if DEBUG
    private static let consoleForwarder = """
    (() => {
      const post = (text) => { try { window.webkit.messageHandlers.inkblotConsole.postMessage(String(text)) } catch {} }
      const original = console.error.bind(console)
      console.error = (...args) => { post(args.map((a) => (a && a.stack) || String(a)).join(' ')); original(...args) }
      window.addEventListener('error', (e) => post(`${e.message} at ${e.filename}:${e.lineno}`))
      window.addEventListener('unhandledrejection', (e) => post(`unhandled rejection: ${(e.reason && e.reason.stack) || e.reason}`))
    })()
    """
    #endif

    fileprivate func receiveTauri(_ body: Any) async -> String {
        guard let json = body as? String else { return #"{"ok":false,"error":"Request was not a string"}"# }
        return await host.handle(json: json)
    }
}

/* ---------------- navigation ---------------- */

extension EditorWebController: TauriEventTarget {}

extension EditorWebController: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        // A new page with fresh counters is about to start talking; the old one's
        // pending requests will never be answered.
        bridge.detach()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        bridge.attach { [weak self] json in self?.deliver(json) }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The page crashed. Reloading is the only recovery, and autosave has already
        // put everything but the last moment on disk.
        log.fault("The web content process terminated; reloading.")
        bridge.detach()
        webView.reload()
    }

    /// Links out of the app open in the browser; the web view only ever shows the app.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = action.request.url, action.targetFrame?.isMainFrame != false else {
            decisionHandler(.allow)
            return
        }
        let isApp = url.scheme == AppSchemeHandler.appScheme
            || url.scheme == AppSchemeHandler.assetScheme
            || url.host == Self.startURL.host
            || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data"
        if isApp {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    /// `window.open` and `target=_blank`: out to the browser.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo
    ) async {
        let alert = NSAlert()
        alert.messageText = message
        if let window = webView.window { await alert.beginSheetModal(for: window) } else { alert.runModal() }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo
    ) async -> Bool {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        let response = if let window = webView.window {
            await alert.beginSheetModal(for: window)
        } else {
            alert.runModal()
        }
        return response == .alertFirstButtonReturn
    }
}

/* ---------------- message handlers ----------------
   `WKUserContentController` retains its handlers, and the controller owns the content
   controller through the web view — so handing it `self` would be a cycle that keeps
   every window's page alive after the window closes. */

private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var controller: EditorWebController?
    init(_ controller: EditorWebController) { self.controller = controller }

    func userContentController(_ content: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "inkblotConsole" {
            controller?.receiveConsole(message.body)
        } else {
            controller?.receiveBridge(message.body)
        }
    }
}

private final class WeakReplyHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var controller: EditorWebController?
    init(_ controller: EditorWebController) { self.controller = controller }

    func userContentController(
        _ content: WKUserContentController,
        didReceive message: WKScriptMessage
    ) async -> (Any?, String?) {
        guard let controller else { return (nil, "The window closed") }
        return (await controller.receiveTauri(message.body), nil)
    }
}

/* ---------------- SwiftUI ---------------- */

/// Hands the controller's web view to SwiftUI, and tells the controller which window
/// it ended up in.
struct EditorWebView: NSViewRepresentable {
    let controller: EditorWebController

    func makeNSView(context: Context) -> WindowReportingContainer {
        let container = WindowReportingContainer()
        container.onWindow = { [weak controller] window in controller?.attach(to: window) }
        container.embed(controller.webView)
        return container
    }

    func updateNSView(_ view: WindowReportingContainer, context: Context) {}

    final class WindowReportingContainer: NSView {
        var onWindow: ((NSWindow?) -> Void)?

        func embed(_ child: NSView) {
            child.translatesAutoresizingMaskIntoConstraints = false
            addSubview(child)
            NSLayoutConstraint.activate([
                child.leadingAnchor.constraint(equalTo: leadingAnchor),
                child.trailingAnchor.constraint(equalTo: trailingAnchor),
                child.topAnchor.constraint(equalTo: topAnchor),
                child.bottomAnchor.constraint(equalTo: bottomAnchor),
            ])
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            onWindow?(window)
        }
    }
}
