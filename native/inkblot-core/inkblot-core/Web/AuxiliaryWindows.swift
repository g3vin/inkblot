#if os(macOS)
import AppKit
#else
import UIKit
#endif
import WebKit
import os

/// Something that can raise a Tauri event in its page: the main window's controller,
/// and each detached document window.
@MainActor
protocol TauriEventTarget: AnyObject {
    func emitTauriEvent(_ event: String, payloadJSON: String, label: String?)
}

/// The windows the page opens with `new WebviewWindow(label, options)`.
///
/// Two kinds, told apart by their URL:
///  - **A detached document** (`index.html?project=…&doc=…`, from `docWindow.js`): the
///    same bundle, booted into one document. It gets the Tauri shim and its own
///    `TauriHost`, but not `native-host.js` — so the page draws all of its own chrome,
///    exactly as it does in a Tauri window, and the native sidebars stay the main
///    window's.
///  - **A Pinterest page** (`openPinterest.js`, `pinterestScrape.js`): pinterest.com,
///    with `scrape-bridge.js` and nothing else.
///
/// Window verbs arrive by label (`TauriHost`'s `window.op`), and `tauri://page-load` /
/// `tauri://destroyed` go back out to every app page, aimed at the window they are
/// about.
@MainActor
final class AuxiliaryWindows {
    static let shared = AuxiliaryWindows()
    nonisolated static let mainLabel = "main"

    private var windows: [String: AuxiliaryWindow] = [:]
    private var targets: [WeakTarget] = []
    /// The main window, for a detached page that addresses `main` by label.
    weak var mainWindow: PlatformWindow?

    private struct WeakTarget {
        weak var target: TauriEventTarget?
    }

    var labels: [String] { [Self.mainLabel] + windows.keys.sorted() }

    func window(_ label: String) -> AuxiliaryWindow? { windows[label] }

    /// A page that should hear window events.
    func register(_ target: TauriEventTarget) {
        targets.removeAll { $0.target == nil || $0.target === target }
        targets.append(WeakTarget(target: target))
    }

    func broadcast(_ event: String, label: String, payloadJSON: String = "null") {
        for entry in targets {
            entry.target?.emitTauriEvent(event, payloadJSON: payloadJSON, label: label)
        }
    }

    /// `plugin:webview|create_webview_window`. A label already in use is refused, as
    /// Tauri refuses it — `openPinterest.js` navigates an existing window instead.
    func create(_ options: [String: Any], core: CoreService, menus: WebMenus) throws {
        guard let label = options["label"] as? String, !label.isEmpty else {
            throw TauriHost.Failure("A window needs a label")
        }
        guard label != Self.mainLabel, windows[label] == nil else {
            throw TauriHost.Failure("a window with label `\(label)` already exists")
        }
        let raw = options["url"] as? String ?? "index.html"
        guard let url = URL(string: raw, relativeTo: EditorWebController.startURL)?.absoluteURL else {
            throw TauriHost.Failure("Not a URL: \(raw)")
        }
        let window = AuxiliaryWindow(label: label, url: url, options: options, core: core, menus: menus)
        windows[label] = window
        if let target = window as TauriEventTarget? { register(target) }
    }

    fileprivate func closed(_ label: String) {
        windows[label] = nil
        broadcast("tauri://destroyed", label: label)
    }
}

#if os(macOS)
/// One window the page opened.
@MainActor
final class AuxiliaryWindow: NSObject {
    let label: String
    let window: NSWindow
    let webView: WKWebView
    /// Only an app page has one; a remote page cannot reach the shell's commands.
    private var host: TauriHost?
    private let isAppPage: Bool
    private let log = Logger(subsystem: "inkblot", category: "windows")

    init(label: String, url: URL, options: [String: Any], core: CoreService, menus: WebMenus) {
        self.label = label
        isAppPage = url.scheme == AppSchemeHandler.appScheme || url.host == EditorWebController.startURL.host

        let configuration = WKWebViewConfiguration()
        let content = configuration.userContentController
        if isAppPage {
            let schemes = AppSchemeHandler(webRoot: EditorWebController.webRoot)
            configuration.setURLSchemeHandler(schemes, forURLScheme: AppSchemeHandler.appScheme)
            configuration.setURLSchemeHandler(schemes, forURLScheme: AppSchemeHandler.assetScheme)
            let labelLiteral = (try? JSONEncoder().encode(label)).map { String(decoding: $0, as: UTF8.self) } ?? "\"\""
            content.addUserScript(EditorWebController.script("window.__inkblotWindowLabel = \(labelLiteral);"))
            content.addUserScript(EditorWebController.script(EditorWebController.resource("tauri-shim")))
        } else {
            content.addUserScript(EditorWebController.script(EditorWebController.resource("scrape-bridge")))
        }

        let width = (options["width"] as? NSNumber)?.doubleValue ?? 900
        let height = (options["height"] as? NSNumber)?.doubleValue ?? 700
        var style: NSWindow.StyleMask = options["decorations"] as? Bool == false
            ? [.borderless]
            : [.titled, .closable, .miniaturizable]
        if options["resizable"] as? Bool != false, !style.contains(.borderless) { style.insert(.resizable) }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: width, height: height),
            styleMask: style,
            backing: .buffered,
            defer: false
        )
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        window.isReleasedWhenClosed = false
        window.title = options["title"] as? String ?? "Inkblot"
        window.contentView = webView
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isInspectable = true

        if isAppPage {
            let host = TauriHost(core: core, menus: menus, label: label)
            host.window = window
            self.host = host
            content.addScriptMessageHandler(AuxReplyHandler(self), contentWorld: .page, name: "tauri")
        } else {
            content.add(AuxMessageHandler(self), name: "inkblotScrape")
        }

        place(options)
        if options["alwaysOnBottom"] as? Bool == true {
            window.level = NSWindow.Level(rawValue: NSWindow.Level.normal.rawValue - 1)
        }
        if options["visible"] as? Bool != false {
            if options["focus"] as? Bool == false || options["focusable"] as? Bool == false {
                window.orderFront(nil)
            } else {
                window.makeKeyAndOrderFront(nil)
                NSApp.activate()
            }
        }

        webView.load(URLRequest(url: url))
    }

    /// Tauri's `x`/`y` are from the top left of the main screen; AppKit's are from the
    /// bottom left. Without them, a new window cascades from the key window.
    private func place(_ options: [String: Any]) {
        if let x = (options["x"] as? NSNumber)?.doubleValue, let y = (options["y"] as? NSNumber)?.doubleValue {
            let screenTop = NSScreen.screens.first?.frame.maxY ?? 0
            window.setFrameTopLeftPoint(NSPoint(x: x, y: screenTop - y))
        } else if let key = NSApp.keyWindow {
            window.setFrameTopLeftPoint(window.cascadeTopLeft(from: NSPoint(x: key.frame.minX, y: key.frame.maxY)))
        } else {
            window.center()
        }
    }

    /* ---------------- what the page can ask of it ---------------- */

    func perform(_ op: String, value: Any?) -> Any? {
        WindowOps.perform(op, value: value, on: window)
    }

    func navigate(to url: URL) {
        webView.load(URLRequest(url: url))
    }

    func evaluate(_ script: String) {
        webView.evaluateJavaScript(script) { [log, label] _, error in
            if let error { log.debug("eval in \(label, privacy: .public): \(error.localizedDescription, privacy: .public)") }
        }
    }

    var currentURL: String { webView.url?.absoluteString ?? "" }

    fileprivate func receiveTauri(_ body: Any) async -> String {
        guard let host, let json = body as? String else { return #"{"ok":false,"error":"Request was not a string"}"# }
        return await host.handle(json: json)
    }

    fileprivate func receiveScrape(_ body: Any) {
        guard let json = body as? String,
              let report = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
        else { return }
        Task { _ = try? await ModelService.shared.invoke("pinterest_report_scrape", args: ["report": report]) }
    }
}

extension AuxiliaryWindow: TauriEventTarget {
    func emitTauriEvent(_ event: String, payloadJSON: String, label: String?) {
        guard isAppPage else { return }
        webView.evaluateJavaScript(TauriEvents.script(event, payloadJSON: payloadJSON, label: label))
    }
}

extension AuxiliaryWindow: NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        AuxiliaryWindows.shared.closed(label)
    }
}

extension AuxiliaryWindow: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let payload = (try? JSONSerialization.data(withJSONObject: ["url": currentURL, "event": "finished"]))
            .map { String(decoding: $0, as: UTF8.self) } ?? "null"
        AuxiliaryWindows.shared.broadcast("tauri://page-load", label: label, payloadJSON: payload)
    }

    /// An app page keeps to the app, as the main window does; a Pinterest page goes
    /// wherever Pinterest sends it, login redirects included.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
        guard isAppPage, let url = action.request.url, action.targetFrame?.isMainFrame != false,
              url.scheme != AppSchemeHandler.appScheme, url.scheme != AppSchemeHandler.assetScheme,
              url.host != EditorWebController.startURL.host,
              !["about", "blob", "data"].contains(url.scheme ?? "")
        else {
            decisionHandler(.allow)
            return
        }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}

/// The window verbs `@tauri-apps/api/window` sends, on any window.
@MainActor
enum WindowOps {
    static func perform(_ op: String, value: Any?, on window: NSWindow) -> Any? {
        switch op {
        case "show":
            window.orderFront(nil)
        case "hide":
            window.orderOut(nil)
        case "set_focus":
            window.makeKeyAndOrderFront(nil)
            NSApp.activate()
        case "set_always_on_top":
            window.level = (value as? Bool == true) ? .floating : .normal
        case "set_title":
            window.title = value as? String ?? ""
        case "close", "destroy":
            window.close()
        case "is_visible":
            return window.isVisible
        case "is_focused":
            return window.isKeyWindow
        case "is_minimized":
            return window.isMiniaturized
        case "minimize":
            window.miniaturize(nil)
        case "unminimize":
            window.deminiaturize(nil)
        case "center":
            window.center()
        default:
            // Everything else the page might ask (`onResized` and friends' plumbing, a
            // theme) answers with nothing, as the shim does in the page.
            return nil
        }
        return nil
    }
}

#else
/// One web view the page opened, on iPadOS and iOS — where an app does not open
/// windows of its own.
///
/// Shown, it is presented over the app with a Done button (what a Pinterest login needs);
/// hidden, it is parked off-screen in the key window, still loading and still running
/// script, because a web view in no window at all is suspended and a scrape would stall.
/// Done, a swipe down and `close` all end it, as closing its window does on a Mac. A
/// detached document opens the same way: iPadOS's own multitasking is the way to see
/// two documents side by side, and the app's scene is one page (see `AppModel`).
@MainActor
final class AuxiliaryWindow: NSObject {
    let label: String
    let webView: WKWebView
    private var host: TauriHost?
    private let isAppPage: Bool
    private let controller = UIViewController()
    private var presented: UINavigationController?

    init(label: String, url: URL, options: [String: Any], core: CoreService, menus: WebMenus) {
        self.label = label
        isAppPage = url.scheme == AppSchemeHandler.appScheme || url.host == EditorWebController.startURL.host

        let configuration = WKWebViewConfiguration()
        let content = configuration.userContentController
        if isAppPage {
            let schemes = AppSchemeHandler(webRoot: EditorWebController.webRoot)
            configuration.setURLSchemeHandler(schemes, forURLScheme: AppSchemeHandler.appScheme)
            configuration.setURLSchemeHandler(schemes, forURLScheme: AppSchemeHandler.assetScheme)
            let labelLiteral = (try? JSONEncoder().encode(label)).map { String(decoding: $0, as: UTF8.self) } ?? "\"\""
            content.addUserScript(EditorWebController.script("window.__inkblotWindowLabel = \(labelLiteral);"))
            content.addUserScript(EditorWebController.script(EditorWebController.resource("tauri-shim")))
        } else {
            content.addUserScript(EditorWebController.script(EditorWebController.resource("scrape-bridge")))
        }
        let width = (options["width"] as? NSNumber)?.doubleValue ?? 900
        let height = (options["height"] as? NSNumber)?.doubleValue ?? 700
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: width, height: height), configuration: configuration)
        super.init()

        controller.view = webView
        controller.title = options["title"] as? String ?? "Inkblot"
        webView.navigationDelegate = self
        webView.isInspectable = true
        if isAppPage {
            let host = TauriHost(core: core, menus: menus, label: label)
            self.host = host
            content.addScriptMessageHandler(AuxReplyHandler(self), contentWorld: .page, name: "tauri")
        } else {
            content.add(AuxMessageHandler(self), name: "inkblotScrape")
        }

        if options["visible"] as? Bool != false, options["focus"] as? Bool != false {
            show()
        } else {
            park()
        }
        webView.load(URLRequest(url: url))
    }

    /* ---------------- showing ---------------- */

    private func show() {
        guard presented == nil, let presenter = TauriHost.presenter(for: nil) else { return }
        webView.removeFromSuperview()
        controller.view = webView
        let navigation = UINavigationController(rootViewController: controller)
        controller.navigationItem.rightBarButtonItem = UIBarButtonItem(
            systemItem: .done, primaryAction: UIAction { [weak self] _ in self?.close() })
        navigation.presentationController?.delegate = self
        presented = navigation
        host?.window = presenter.view.window
        presenter.present(navigation, animated: true)
    }

    /// Off-screen in the key window: laid out at a real size, so a page that measures
    /// itself (Pinterest's grid) loads as it would on screen.
    private func park() {
        guard let window = TauriHost.presenter(for: nil)?.view.window else { return }
        webView.frame.origin = CGPoint(x: -20_000, y: 0)
        window.addSubview(webView)
    }

    private func hide() {
        if let presented {
            self.presented = nil
            presented.dismiss(animated: true) { [weak self] in self?.park() }
        }
    }

    private func close() {
        presented?.dismiss(animated: true)
        presented = nil
        webView.removeFromSuperview()
        AuxiliaryWindows.shared.closed(label)
    }

    /* ---------------- what the page can ask of it ---------------- */

    func perform(_ op: String, value: Any?) -> Any? {
        switch op {
        case "show", "set_focus": show()
        case "hide": hide()
        case "close", "destroy": close()
        case "set_title": controller.title = value as? String
        case "is_visible": return presented != nil
        case "is_focused": return presented != nil
        default: return nil
        }
        return nil
    }

    func navigate(to url: URL) {
        webView.load(URLRequest(url: url))
    }

    func evaluate(_ script: String) {
        webView.evaluateJavaScript(script) { _, _ in }
    }

    var currentURL: String { webView.url?.absoluteString ?? "" }

    fileprivate func receiveTauri(_ body: Any) async -> String {
        guard let host, let json = body as? String else { return #"{"ok":false,"error":"Request was not a string"}"# }
        return await host.handle(json: json)
    }

    fileprivate func receiveScrape(_ body: Any) {
        guard let json = body as? String,
              let report = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
        else { return }
        Task { _ = try? await ModelService.shared.invoke("pinterest_report_scrape", args: ["report": report]) }
    }
}

extension AuxiliaryWindow: TauriEventTarget {
    func emitTauriEvent(_ event: String, payloadJSON: String, label: String?) {
        guard isAppPage else { return }
        webView.evaluateJavaScript(TauriEvents.script(event, payloadJSON: payloadJSON, label: label))
    }
}

extension AuxiliaryWindow: UIAdaptivePresentationControllerDelegate {
    /// Swiped away: the same as Done.
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        presented = nil
        close()
    }
}

extension AuxiliaryWindow: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let payload = (try? JSONSerialization.data(withJSONObject: ["url": currentURL, "event": "finished"]))
            .map { String(decoding: $0, as: UTF8.self) } ?? "null"
        AuxiliaryWindows.shared.broadcast("tauri://page-load", label: label, payloadJSON: payload)
    }
}

/// The window verbs, on the one window an iOS app has: there is nothing to move, hide
/// or retitle, so they answer as a window that is simply there would.
@MainActor
enum WindowOps {
    static func perform(_ op: String, value: Any?, on window: UIWindow) -> Any? {
        switch op {
        case "is_visible", "is_focused": true
        case "is_minimized": false
        default: nil
        }
    }
}
#endif

/// The one line that raises a Tauri event in a page.
enum TauriEvents {
    static func script(_ event: String, payloadJSON: String, label: String?) -> String {
        func literal(_ string: String) -> String {
            (try? JSONEncoder().encode(string)).map { String(decoding: $0, as: UTF8.self) } ?? "\"\""
        }
        // Everything goes in as a JSON string literal and the payload is parsed on the
        // other side, so nothing in it can close the script early.
        let target = label.map(literal) ?? "null"
        return "window.__inkblotTauri && window.__inkblotTauri.emit(\(literal(event)), JSON.parse(\(literal(payloadJSON))), \(target))"
    }
}

/* ---------------- message handlers, held weakly (see EditorWebView.swift) ---------------- */

private final class AuxReplyHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: AuxiliaryWindow?
    init(_ owner: AuxiliaryWindow) { self.owner = owner }

    func userContentController(
        _ content: WKUserContentController,
        didReceive message: WKScriptMessage
    ) async -> (Any?, String?) {
        guard let owner else { return (nil, "The window closed") }
        return (await owner.receiveTauri(message.body), nil)
    }
}

private final class AuxMessageHandler: NSObject, WKScriptMessageHandler {
    weak var owner: AuxiliaryWindow?
    init(_ owner: AuxiliaryWindow) { self.owner = owner }

    func userContentController(_ content: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.receiveScrape(message.body)
    }
}
